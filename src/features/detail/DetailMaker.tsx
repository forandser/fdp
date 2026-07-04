"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ImageUploader, type UploadedImage } from "./ImageUploader"
import { KeywordPicker } from "./KeywordPicker"
import { ResultView, emptyCopy } from "./ResultView"
import { SeasonHint } from "./SeasonHint"
import { SellingPointsSuggester } from "./SellingPointsSuggester"
import { getAIProvider } from "@/lib/ai/provider"
import type {
  CopyInput,
  CopyOutput,
  CopySpec,
  CopyTone,
  ProductCategory,
  SellerReview,
  TrustInfo,
  UsageInfo,
} from "@/lib/ai/types"
import {
  regenerateSection,
  mergeSection,
  type SectionId,
} from "@/lib/ai/section-regenerate"
import {
  saveWork,
  newWorkId,
  makeThumbDataUrl,
  getWork,
  type Work,
} from "@/lib/storage/works-db"
import { PRESET_KEYWORDS } from "@/domain/keywords"
import { t } from "@/lib/i18n"
import { validateProductNameSeo } from "@/lib/ai/validate"
import { detectFruitFactKey, FRUIT_FACTS } from "@/domain/fruit-facts"
import { DEMO_COPY } from "./demo-copy"

type Stage = "restoring" | "input" | "generating" | "result" | "error"

const EXTRA_DESC_PREFIX = "상품 추가 설명: "

const PRESET_LABEL_SET = new Set(PRESET_KEYWORDS.map((k) => k.label))

/** 좌/우 분할 분기점 (px). 이 아래는 적층 레이아웃. */
const SPLIT_BREAKPOINT = 1280

async function blobToUploadedImage(blob: Blob, idx: number): Promise<UploadedImage | null> {
  if (typeof window === "undefined") return null
  try {
    const type = blob.type || "image/jpeg"
    const ext = type.includes("png") ? "png" : "jpg"
    const file = new File([blob], `restored-${idx}.${ext}`, { type })
    const url = URL.createObjectURL(file)
    const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new window.Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error("img load"))
      }
      img.src = url
    })
    return {
      id: `restored-${Date.now()}-${idx}`,
      file,
      url,
      ...dims,
    }
  } catch {
    return null
  }
}

const CATEGORY_OPTIONS: { value: ProductCategory; label: string }[] = [
  { value: "fruit", label: "🍑 과일" },
  { value: "veggie", label: "🥬 야채" },
  { value: "other", label: "그 외" },
]

const GENERATION_STEPS = [
  "이미지를 분석하고 있어요",
  "한국 신선식품 카피라이팅 패턴 적용 중",
  "헤드라인·스토리·스펙·FAQ 구성 중",
  "마무리 검토 중",
]

/** 입력값으로 임시 spec 배열 구성 — 실제 AI 결과가 없을 때 미리보기용. */
function buildLiveSpec(args: {
  origin: string
  variety: string
  weight: string
  brix: string
}): CopySpec[] {
  const spec: CopySpec[] = []
  if (args.origin.trim()) spec.push({ label: "산지", value: args.origin.trim() })
  if (args.variety.trim()) spec.push({ label: "품종", value: args.variety.trim() })
  if (args.weight.trim()) spec.push({ label: "중량", value: args.weight.trim() })
  if (args.brix.trim()) spec.push({ label: "당도", value: `${args.brix.trim()} Brix` })
  return spec
}

export function DetailMaker({ initialWorkId }: { initialWorkId?: string }) {
  const [stage, setStage] = useState<Stage>(initialWorkId ? "restoring" : "input")
  const [images, setImages] = useState<UploadedImage[]>([])
  const [category, setCategory] = useState<ProductCategory>("fruit")
  const [productName, setProductName] = useState("")
  const [variety, setVariety] = useState("")
  const [origin, setOrigin] = useState("")
  /**
   * 산지가 "예시 채우기"로 채워졌는지 표시 — 실제 산지가 아닌 참고 지역명이므로
   * 셀러가 실제 산지로 바꾸도록 힌트를 띄운다(허위 표시 방지). 사용자가 직접
   * 산지를 수정하면 해제한다.
   */
  const [originFromDemo, setOriginFromDemo] = useState(false)
  const [weight, setWeight] = useState("")
  const [brix, setBrix] = useState("")
  const [sizeGrade, setSizeGrade] = useState("")
  const [extraDescription, setExtraDescription] = useState("")
  const [farmIntro, setFarmIntro] = useState("")
  const [producerName, setProducerName] = useState("")
  const [producerRegion, setProducerRegion] = useState("")
  const [farmerYears, setFarmerYears] = useState("")
  /** 운영 방식 체크 — 실제로 지키는 약속만 페이지에 표시(허위광고 방지). */
  const [sameDayHarvest, setSameDayHarvest] = useState(false)
  const [coldChain, setColdChain] = useState(false)
  const [refundGuarantee, setRefundGuarantee] = useState(false)
  /**
   * 고객 후기 — 셀러가 실제 받은 후기만 직접 입력(AI 생성 금지). 최대 3개.
   * 저장/복원 하위호환: 구버전 저장본엔 input.reviews 없음(옵셔널).
   */
  const [reviews, setReviews] = useState<SellerReview[]>([])
  const [presetKeywords, setPresetKeywords] = useState<string[]>([])
  const [customKeywords, setCustomKeywords] = useState<string[]>([])
  /**
   * v3.5: AI 리서치 모드 토글 — 기본 ON. localStorage "fdp:research-enabled"에 저장.
   * 생성 시 web_search로 품종 일반 참고 정보를 조사해 카피 깊이를 높인다(회당 약 30~70원·10~20초 추가).
   */
  const [researchEnabled, setResearchEnabled] = useState(true)
  const tone: CopyTone = "sincere"
  /** v2.7: 게이트 UI 삭제. 내부 상수 true 유지 (API 안전망 / 규칙 5 준수) */
  const isOrdinaryProduce = true
  /** 현재 입력에서 합성한 trust 객체 — 미리보기/SellingPointsSuggester에 인입. */
  const trustForPreview: TrustInfo = useMemo(() => {
    const out: TrustInfo = {}
    if (producerName.trim()) out.producerName = producerName.trim()
    if (producerRegion.trim()) out.producerRegion = producerRegion.trim()
    if (farmerYears.trim()) out.farmerYears = Number(farmerYears) || undefined
    if (sameDayHarvest) out.sameDayHarvest = true
    if (coldChain) out.coldChain = true
    if (refundGuarantee) out.refundGuarantee = true
    return out
  }, [producerName, producerRegion, farmerYears, sameDayHarvest, coldChain, refundGuarantee])

  /** 상품명 실시간 SEO 검증 — v1.9. */
  const seoCheck = useMemo(() => {
    if (!productName.trim()) return null
    return validateProductNameSeo(productName)
  }, [productName])

  /** 상품명에서 fruit-facts 매칭 — placeholder/힌트 풍부화. */
  const factHint = useMemo(() => {
    const key = detectFruitFactKey(productName)
    if (!key) return null
    const fact = FRUIT_FACTS[key]
    return {
      name: fact.name,
      goodBrix: fact.goodBrix,
      regions: fact.regions.slice(0, 3).join(", "),
      varieties: fact.varieties.slice(0, 3).map((v) => v.name).join(", "),
      storage: fact.storage.mode === "ripen-then-fridge"
        ? "후숙형 — 받자마자 냉장 X"
        : fact.storage.mode === "fridge"
          ? "도착 즉시 냉장"
          : "실온 보관",
    }
  }, [productName])

  /**
   * v2.0: 예시 채우기 한 클릭 — fruit-facts 기반 자동 채움.
   * 초보 셀러가 "이렇게 쓰면 되겠구나" 즉시 학습 + AI 생성 즉시 시도 가능.
   */
  const canFillDemo = useMemo(() => {
    const key = detectFruitFactKey(productName)
    return !!key
  }, [productName])

  const handleFillDemo = () => {
    const key = detectFruitFactKey(productName)
    if (!key) return
    const fact = FRUIT_FACTS[key]
    const firstVariety = fact.varieties[0]
    if (!variety.trim() && firstVariety) setVariety(firstVariety.name)
    // 산지는 빈 칸일 때만 예시 지역명으로 채우고, 예시값임을 표시(실제 산지로 교체 유도).
    if (!origin.trim() && fact.regions[0]) {
      setOrigin(fact.regions[0])
      setOriginFromDemo(true)
    }
    if (!weight.trim()) {
      const kg =
        fact.category === "fruit"
          ? fact.name === "수박" || fact.name === "멜론"
            ? "1통"
            : "3kg 한 박스"
          : "1kg"
      setWeight(kg)
    }
    if (!brix.trim()) setBrix(String(fact.goodBrix))
    if (!sizeGrade.trim()) setSizeGrade("특")
    if (!farmIntro.trim() && fact.hookHeadlines[0]) setFarmIntro(fact.hookHeadlines[0])
    // 추가 설명에 감각어 살짝
    if (!extraDescription.trim() && fact.sensoryWords.length > 0) {
      setExtraDescription(
        `강조 포인트:\n- ${fact.sensoryWords.slice(0, 3).join(" / ")}\n- ${fact.hookHeadlines.slice(1, 3).join("\n- ")}`,
      )
    }
    // 농부 정보 예시
    if (!producerName.trim()) setProducerName("김 농부")
    if (!producerRegion.trim() && fact.regions[0]) setProducerRegion(fact.regions[0])
    if (!farmerYears.trim()) setFarmerYears("20")
  }
  const [generationStep, setGenerationStep] = useState(0)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [result, setResult] = useState<CopyOutput | null>(null)
  const [resultMeta, setResultMeta] = useState<{
    priceNum: number
    productName: string
    origin: string
    weight: string
  } | null>(null)
  /** 결과 받은 시점의 입력 — 섹션 재생성에 재사용 */
  const [currentInput, setCurrentInput] = useState<CopyInput | null>(null)
  // v3.5: 마지막 생성의 토큰·검색 사용량 — 결과 화면에 비용 투명성 한 줄 표시용.
  const [lastUsage, setLastUsage] = useState<UsageInfo | null>(null)
  /** 섹션 재생성 진행 중인 섹션 (null이면 idle) */
  const [busySection, setBusySection] = useState<SectionId | null>(null)
  /** 현재 작업 ID — 저장/업데이트에 사용 */
  const [workId, setWorkId] = useState<string | null>(null)
  /** 복원 시 생성된 objectURL — 언마운트 시 일괄 해제 */
  const restoredUrlsRef = useRef<string[]>([])

  /** 데스크탑(>=1280) 좌우 분할 여부 */
  const [isWide, setIsWide] = useState(() => {
    if (typeof window === "undefined") return true
    return window.innerWidth >= SPLIT_BREAKPOINT
  })

  useEffect(() => {
    if (typeof window === "undefined") return
    const onResize = () => setIsWide(window.innerWidth >= SPLIT_BREAKPOINT)
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  /** v3.5: 리서치 토글 localStorage 복원 — 저장값이 "0"이면 OFF, 그 외/미설정이면 기본 ON. */
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const saved = window.localStorage.getItem("fdp:research-enabled")
      if (saved === "0") setResearchEnabled(false)
    } catch {
      /* localStorage 접근 불가(프라이빗 모드 등) — 기본 ON 유지 */
    }
  }, [])

  /** v3.5: 리서치 토글 변경 시 localStorage 저장. */
  const handleResearchToggle = (next: boolean) => {
    setResearchEnabled(next)
    try {
      window.localStorage.setItem("fdp:research-enabled", next ? "1" : "0")
    } catch {
      /* 저장 실패는 무시 */
    }
  }

  useEffect(() => {
    if (!initialWorkId) return
    let cancelled = false
    void (async () => {
      try {
        const work = await getWork(initialWorkId)
        if (!work || cancelled) {
          if (!cancelled) setStage("input")
          return
        }
        const restored: UploadedImage[] = []
        for (let i = 0; i < work.imageBlobs.length; i++) {
          const blob = work.imageBlobs[i]
          if (!blob) continue
          const img = await blobToUploadedImage(blob, i)
          if (img) {
            restored.push(img)
            restoredUrlsRef.current.push(img.url)
          }
        }
        if (cancelled) {
          restoredUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
          restoredUrlsRef.current = []
          return
        }

        const input = work.input
        const preset: string[] = []
        const custom: string[] = []
        let extra = ""
        for (const kw of input.highlightKeywords || []) {
          if (kw.startsWith(EXTRA_DESC_PREFIX)) {
            extra = kw.slice(EXTRA_DESC_PREFIX.length)
          } else if (PRESET_LABEL_SET.has(kw)) {
            preset.push(kw)
          } else {
            custom.push(kw)
          }
        }

        setImages(restored)
        setCategory(input.category)
        setProductName(input.productType)
        setVariety(input.variety ?? "")
        setOrigin(input.origin ?? "")
        setWeight(input.weight ?? "")
        setBrix(input.brix != null ? String(input.brix) : "")
        setFarmIntro(input.farmIntro ?? "")
        // 운영 방식 체크 복원 (구버전 저장본엔 trust 없음 — 하위호환)
        setProducerName(input.trust?.producerName ?? "")
        setProducerRegion(input.trust?.producerRegion ?? "")
        setFarmerYears(input.trust?.farmerYears != null ? String(input.trust.farmerYears) : "")
        setSameDayHarvest(!!input.trust?.sameDayHarvest)
        setColdChain(!!input.trust?.coldChain)
        setRefundGuarantee(input.trust?.refundGuarantee === true)
        // 고객 후기 복원 — 구버전 저장본엔 없음(하위호환).
        setReviews(
          Array.isArray(input.reviews)
            ? input.reviews.filter((r) => r && typeof r.text === "string")
            : [],
        )
        setExtraDescription(extra)
        setPresetKeywords(preset)
        setCustomKeywords(custom)
        setWorkId(work.id)
        setCurrentInput(input)

        if (work.copy) {
          setResult(work.copy)
          setResultMeta({
            priceNum: 0,
            productName: input.productType,
            origin: input.origin,
            weight: input.weight,
          })
          setStage("result")
        } else {
          setStage("input")
        }
      } catch (e) {
        console.error("[restoreWork]", e)
        if (!cancelled) setStage("input")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initialWorkId])

  useEffect(() => {
    const ref = restoredUrlsRef
    return () => {
      ref.current.forEach((u) => URL.revokeObjectURL(u))
      ref.current = []
    }
  }, [])

  const hasMin =
    images.length >= 1 && productName.trim() && isOrdinaryProduce

  /** v2.2: 사용자 입력 감지 — 아무것도 안 넣었으면 데모 카피 표시. */
  const hasUserInput = useMemo(() => {
    return (
      images.length > 0 ||
      productName.trim().length > 0 ||
      variety.trim().length > 0 ||
      origin.trim().length > 0 ||
      weight.trim().length > 0 ||
      brix.trim().length > 0 ||
      farmIntro.trim().length > 0 ||
      extraDescription.trim().length > 0 ||
      presetKeywords.length > 0 ||
      customKeywords.length > 0
    )
  }, [
    images.length,
    productName,
    variety,
    origin,
    weight,
    brix,
    farmIntro,
    extraDescription,
    presetKeywords.length,
    customKeywords.length,
  ])

  const isDemoMode = !result && !hasUserInput

  /** 우측 미리보기에 전달할 카피
   *  - result 있으면 실제 결과
   *  - 사용자 입력 있으면 emptyCopy + spec
   *  - 아무 입력 없으면 DEMO_COPY (첫 진입 학습용)
   */
  const liveCopy = useMemo<CopyOutput>(() => {
    if (result) return result
    if (!hasUserInput) return DEMO_COPY
    const base = emptyCopy()
    base.spec = buildLiveSpec({ origin, variety, weight, brix })
    return base
  }, [result, hasUserInput, origin, variety, weight, brix])

  /** 우측 미리보기에 전달할 메타 — 실제 result가 있으면 그 시점의 값, 없으면 현재 입력. */
  const liveResultMeta = useMemo(() => {
    if (result && resultMeta) return resultMeta
    return {
      priceNum: 0,
      productName: productName.trim(),
      origin: origin.trim(),
      weight: weight.trim(),
    }
  }, [result, resultMeta, productName, origin, weight])

  const handleSubmit = async () => {
    if (!hasMin) {
      if (images.length === 0) setErrorMsg(t.detail.minImages)
      else if (!productName.trim()) setErrorMsg(t.detail.needName)
      return
    }

    setErrorMsg(null)
    setStage("generating")
    setGenerationStep(0)
    const stepTimer = setInterval(() => {
      setGenerationStep((s) => Math.min(s + 1, GENERATION_STEPS.length - 1))
    }, 4000)

    const allKeywords = [...presetKeywords, ...customKeywords]
    if (extraDescription.trim()) {
      allKeywords.push(`상품 추가 설명: ${extraDescription.trim()}`)
    }

    const hasTrust =
      producerName.trim() ||
      producerRegion.trim() ||
      farmerYears.trim() ||
      sameDayHarvest ||
      coldChain ||
      refundGuarantee
    const trustData: TrustInfo | undefined = hasTrust
      ? {
          producerName: producerName.trim() || undefined,
          producerRegion: producerRegion.trim() || undefined,
          farmerYears: farmerYears.trim() ? Number(farmerYears) : undefined,
          sameDayHarvest: sameDayHarvest || undefined,
          coldChain: coldChain || undefined,
          refundGuarantee: refundGuarantee || undefined,
        }
      : undefined

    // 고객 후기 — 본문 있는 것만(최대 3개), 200자 컷. 셀러 직접 입력(AI 생성 아님).
    const cleanReviews: SellerReview[] = reviews
      .map((r) => ({
        text: r.text.trim().slice(0, 200),
        highlight: r.highlight?.trim().slice(0, 200) || undefined,
      }))
      .filter((r) => r.text.length > 0)
      .slice(0, 3)

    const input: CopyInput = {
      category,
      productType: productName.trim(),
      variety: variety.trim() || undefined,
      origin: origin.trim(),
      weight: weight.trim(),
      price: 0,
      brix: brix.trim() ? Number(brix) : undefined,
      sizeGrade: sizeGrade.trim() || undefined,
      farmIntro: farmIntro.trim() || undefined,
      trust: trustData,
      reviews: cleanReviews.length > 0 ? cleanReviews : undefined,
      highlightKeywords: allKeywords,
      recommendBadge: undefined,
      tone: "sincere",
      isOrdinaryProduce,
      researchEnabled,
    }

    try {
      const res = await getAIProvider().generateCopy(input)
      setResult(res.output)
      setLastUsage(res.usage)
      setCurrentInput(input)
      setResultMeta({
        priceNum: 0,
        productName: productName.trim(),
        origin: origin.trim(),
        weight: weight.trim(),
      })
      setStage("result")

      // 작업 저장 (실패해도 결과 화면은 보여줌)
      try {
        const id = newWorkId()
        setWorkId(id)
        const thumb = images[0] ? await makeThumbDataUrl(images[0].file) : null
        const work: Work = {
          id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          productName: productName.trim(),
          thumbDataUrl: thumb,
          input,
          copy: res.output,
          imageBlobs: images.map((i) => i.file),
        }
        void saveWork(work)
      } catch (saveErr) {
        console.error("[saveWork]", saveErr)
      }
    } catch (err) {
      console.error(err)
      setErrorMsg(t.detail.errors.copy_failed)
      setStage("error")
    } finally {
      clearInterval(stepTimer)
    }
  }

  /** 결과 카피 인라인 편집 → 작업 자동 갱신 */
  const handleCopyChange = (next: CopyOutput) => {
    setResult(next)
    if (workId && currentInput && resultMeta) {
      void (async () => {
        try {
          const work: Work = {
            id: workId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            productName: resultMeta.productName,
            thumbDataUrl: images[0] ? await makeThumbDataUrl(images[0].file) : null,
            input: currentInput,
            copy: next,
            imageBlobs: images.map((i) => i.file),
          }
          await saveWork(work)
        } catch (e) {
          console.error("[saveWork-update]", e)
        }
      })()
    }
  }

  /** 섹션 단위 재생성 */
  const handleSectionRegenerate = async (sectionId: SectionId) => {
    if (!result || !currentInput) return
    setBusySection(sectionId)
    try {
      const patch = await regenerateSection(currentInput, result, sectionId)
      const merged = mergeSection(result, patch)
      setResult(merged)
      handleCopyChange(merged)
    } catch (e) {
      console.error("[regenerateSection]", e)
    } finally {
      setBusySection(null)
    }
  }

  const handleRetry = () => {
    setStage("input")
    setResult(null)
    setResultMeta(null)
    setCurrentInput(null)
    setWorkId(null)
  }

  if (stage === "restoring") {
    return (
      <div
        style={{
          minHeight: "60vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-neutral-500)",
          fontSize: "var(--font-size-md)",
        }}
      >
        {t.works.restoring}
      </div>
    )
  }

  const isGenerating = stage === "generating"

  // ---------- 좌측 폼 ----------
  const formColumn = (
    <div
      style={{
        maxWidth: 540,
        width: "100%",
        margin: isWide ? "0" : "0 auto",
      }}
    >
      <h1
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 24,
        }}
      >
        {t.detail.pageTitle}
      </h1>

      {errorMsg && (
        <div
          style={{
            padding: 14,
            background: "var(--color-danger-tint)",
            border: "1px solid var(--color-danger)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-danger)",
            fontSize: "var(--font-size-md)",
            marginBottom: 16,
          }}
        >
          ⚠️ {errorMsg}
        </div>
      )}

      {/* v2.7: 일반 농산물 게이트 UI 삭제 — isOrdinaryProduce는 내부 상수 true 유지 (API에는 계속 전달, 규칙 5 안전망) */}

      <Step number={1} title={t.detail.step1Image} hint={t.detail.step1Hint}>
        <ImageUploader images={images} onChange={setImages} />
      </Step>

      <Step number={2} title={t.detail.step2Basic}>
        <SeasonHint productName={productName} category={category} />

        {/* v2.0: 예시 채우기 한 클릭 — 신규 셀러 학습용 */}
        {canFillDemo && (
          <div
            style={{
              padding: "10px 12px",
              marginBottom: 12,
              background: "linear-gradient(90deg, #FFF5F5 0%, #FFF8E7 100%)",
              border: "1px dashed #E03131",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              gap: 10,
              justifyContent: "space-between",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: "#212529",
                  marginBottom: 2,
                }}
              >
                ✨ 처음이신가요? 예시로 자동 채워드릴게요
              </div>
              <div style={{ fontSize: 11, color: "#495057", lineHeight: 1.4 }}>
                산지·품종·중량·가격 등 빈 칸을 그 과일 표준값으로 채웁니다. 눈으로 확인하고 수정하세요.
              </div>
            </div>
            <button
              type="button"
              onClick={handleFillDemo}
              style={{
                flexShrink: 0,
                padding: "8px 14px",
                background: "#E03131",
                color: "#FFFFFF",
                border: "none",
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                boxShadow: "0 2px 6px rgba(224,49,49,0.25)",
                whiteSpace: "nowrap",
              }}
            >
              ✨ 예시 채우기
            </button>
          </div>
        )}


        <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
          {CATEGORY_OPTIONS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setCategory(c.value)}
              style={{
                flex: 1,
                padding: "10px 12px",
                border:
                  category === c.value
                    ? "2px solid var(--color-primary-600)"
                    : "1px solid var(--color-neutral-300)",
                borderRadius: "var(--radius-xs)",
                background:
                  category === c.value
                    ? "var(--color-primary-50)"
                    : "var(--color-bg-surface)",
                color: "var(--color-neutral-900)",
                fontSize: "var(--font-size-sm)",
                cursor: "pointer",
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <FormGrid>
          <Field label={t.detail.field.productNameRequired}>
            <input
              type="text"
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder={t.detail.field.productNamePh}
              style={inputStyle}
            />
            {/* v1.9: SEO 실시간 검증 */}
            {seoCheck && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 4,
                  fontSize: 11,
                  color: seoCheck.ok
                    ? "var(--color-success, #047857)"
                    : "var(--color-danger)",
                }}
              >
                <span aria-hidden>{seoCheck.ok ? "✅" : "⚠️"}</span>
                <span>{seoCheck.length}자 / 49자</span>
                {seoCheck.warnings.length > 0 && (
                  <span style={{ color: "var(--color-neutral-500)" }}>
                    — {seoCheck.warnings.map((w) => w.detail).join(" · ")}
                  </span>
                )}
              </div>
            )}
            {/* v2.1: fruit-facts 자동 힌트 — 심플 details로 접힘 */}
            {factHint && (
              <details
                style={{
                  marginTop: 6,
                  padding: "6px 10px",
                  background: "#FFF8E7",
                  borderLeft: "3px solid #FFB186",
                  borderRadius: 4,
                  fontSize: 11.5,
                  color: "var(--color-neutral-700)",
                  lineHeight: 1.6,
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontWeight: 700,
                    color: "var(--color-neutral-900)",
                    userSelect: "none",
                  }}
                >
                  💡 {factHint.name} 사전 매칭 — 산지·품종·Brix 참고
                </summary>
                <div style={{ marginTop: 4 }}>
                  · 추천 산지: {factHint.regions}
                  <br />
                  · 추천 품종: {factHint.varieties}
                  <br />
                  · &quot;달다/꿀맛&quot; 표현은 <strong>{factHint.goodBrix} Brix 이상</strong>에서만 허용
                  <br />
                  · 보관: {factHint.storage}
                </div>
              </details>
            )}
          </Field>
          <Field label={t.detail.field.weight}>
            <input
              type="text"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder={t.detail.field.weightPh}
              style={inputStyle}
            />
          </Field>
          <Field label={t.detail.field.origin}>
            <input
              type="text"
              value={origin}
              onChange={(e) => {
                setOrigin(e.target.value)
                // 사용자가 직접 손대면 예시값 힌트 해제.
                if (originFromDemo) setOriginFromDemo(false)
              }}
              placeholder={t.detail.field.originPh}
              style={inputStyle}
            />
            {originFromDemo && origin.trim() && (
              <p style={demoHintStyle}>{t.detail.field.originDemoHint}</p>
            )}
          </Field>
          <Field label={t.detail.field.variety}>
            <input
              type="text"
              value={variety}
              onChange={(e) => setVariety(e.target.value)}
              placeholder={t.detail.field.varietyPh}
              style={inputStyle}
            />
          </Field>
          <Field label={t.detail.field.brix}>
            <input
              type="text"
              value={brix}
              onChange={(e) => setBrix(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={t.detail.field.brixPh}
              style={inputStyle}
            />
          </Field>
          <Field label="등급 표기 (선택)">
            <input
              type="text"
              value={sizeGrade}
              onChange={(e) => setSizeGrade(e.target.value.slice(0, 20))}
              placeholder="예) 특 / 상 / 흠집 등급"
              style={inputStyle}
            />
          </Field>
        </FormGrid>
      </Step>

      <Step number={3} title={t.detail.step3Keywords}>
        <KeywordPicker
          selected={presetKeywords}
          onChange={setPresetKeywords}
          customKeywords={customKeywords}
          onCustomChange={setCustomKeywords}
          category={category}
          productName={productName}
          variety={variety}
          origin={origin}
          weight={weight}
          brix={brix.trim() ? Number(brix) : undefined}
          price={undefined}
          tone={tone}
        />
      </Step>

      <Step number={4} title={t.detail.step4Extra} hint={t.detail.step4ExtraHint}>
        <Field label={t.detail.farmIntroLabel}>
          <input
            type="text"
            value={farmIntro}
            onChange={(e) => setFarmIntro(e.target.value.slice(0, 120))}
            placeholder={t.detail.farmIntroPh}
            style={inputStyle}
          />
          <p
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-neutral-500)",
              marginTop: 4,
            }}
          >
            {t.detail.farmIntroHint}
          </p>
        </Field>
        <div style={{ height: 16 }} />

        {/* 운영 방식 체크 (선택) — 실제 지키는 약속만 페이지에 표시(허위광고 방지) */}
        <TrustPromiseChecks
          sameDayHarvest={sameDayHarvest}
          coldChain={coldChain}
          refundGuarantee={refundGuarantee}
          onSameDayHarvest={setSameDayHarvest}
          onColdChain={setColdChain}
          onRefundGuarantee={setRefundGuarantee}
        />
        <div style={{ height: 12 }} />

        {/* 고객 후기 (선택) — 실제 받은 후기만 직접 입력(AI 생성 아님). 최대 3개. */}
        <ReviewsInput reviews={reviews} onChange={setReviews} />
        <div style={{ height: 12 }} />

        {/* 농부 정식 정보 (선택) — 신뢰 카드용. v1.8 */}
        <details style={{ marginBottom: 12 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              color: "var(--color-neutral-900)",
              marginBottom: 8,
            }}
          >
            👨‍🌾 농부 정보 추가 (선택 — 신뢰 카드 노출용)
          </summary>
          <FormGrid>
            <Field label="농부 이름 (예: 김 농부)">
              <input
                type="text"
                value={producerName}
                onChange={(e) => setProducerName(e.target.value.slice(0, 20))}
                placeholder="예) 김 농부"
                style={inputStyle}
              />
            </Field>
            <Field label="농가 산지 (시·군)">
              <input
                type="text"
                value={producerRegion}
                onChange={(e) => setProducerRegion(e.target.value.slice(0, 30))}
                placeholder="예) 경북 청송"
                style={inputStyle}
              />
            </Field>
            <Field label="재배 연차 (년)">
              <input
                type="text"
                inputMode="numeric"
                value={farmerYears}
                onChange={(e) => setFarmerYears(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                placeholder="예) 20"
                style={inputStyle}
              />
            </Field>
          </FormGrid>
        </details>
        <div style={{ height: 12 }} />

        <SellingPointsSuggester
          category={category}
          productName={productName}
          variety={variety}
          origin={origin}
          weight={weight}
          brix={brix.trim() ? Number(brix) : undefined}
          price={undefined}
          tone={tone}
          trust={trustForPreview}
          customKeywords={customKeywords}
          onToggle={(p) => {
            setCustomKeywords((curr) =>
              curr.includes(p) ? curr.filter((k) => k !== p) : [...curr, p],
            )
          }}
        />
        <textarea
          value={extraDescription}
          onChange={(e) => setExtraDescription(e.target.value)}
          placeholder={t.detail.step4ExtraPh}
          rows={5}
          style={{
            ...inputStyle,
            resize: "vertical",
            fontFamily: "inherit",
            lineHeight: 1.6,
          }}
        />
      </Step>

      {/* v3.5: AI 리서치 모드 토글 — 기본 ON. 생성 시 web_search로 품종 일반 참고 정보 조사. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 14px",
          marginBottom: 12,
          background: "var(--color-bg-subtle)",
          border: "1px solid var(--color-neutral-200)",
          borderRadius: "var(--radius-xs)",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "var(--color-neutral-900)",
            }}
          >
            🔍 AI 리서치
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-neutral-600)",
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            품종 일반 특성·제철·보관법을 실시간 검색해 카피에 반영해요 (회당 약 30~70원·10~20초 추가).
          </div>
        </div>
        <label
          style={{
            position: "relative",
            display: "inline-block",
            width: 44,
            height: 24,
            flexShrink: 0,
            cursor: isGenerating ? "not-allowed" : "pointer",
          }}
        >
          <input
            type="checkbox"
            role="switch"
            aria-label="AI 리서치 모드"
            checked={researchEnabled}
            disabled={isGenerating}
            onChange={(e) => handleResearchToggle(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              transition: "background 0.15s",
              background: researchEnabled
                ? "var(--color-primary-600)"
                : "var(--color-neutral-300)",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 3,
              left: researchEnabled ? 23 : 3,
              width: 18,
              height: 18,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 0.15s",
              boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            }}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!hasMin || isGenerating}
        style={{
          width: "100%",
          padding: "16px 18px",
          background:
            hasMin && !isGenerating
              ? "var(--color-primary-600)"
              : "var(--color-neutral-300)",
          color: "var(--color-text-on-primary)",
          border: "none",
          borderRadius: "var(--radius-xs)",
          fontSize: 18,
          fontWeight: 700,
          cursor: hasMin && !isGenerating ? "pointer" : "not-allowed",
        }}
      >
        ✨ {isGenerating ? t.detail.submitting : t.detail.submit}
      </button>
    </div>
  )

  // ---------- 우측 미리보기 ----------
  const previewColumn = (
    <div style={{ position: "relative", width: "100%" }}>
      {/* v2.2: 데모 모드 배너 — 첫 진입 시 학습용 예시임을 명시 */}
      {isDemoMode && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            background: "linear-gradient(90deg, #FFF5F5 0%, #FFF8E7 100%)",
            border: "1px dashed #E03131",
            borderRadius: 8,
            color: "#212529",
            fontSize: 13,
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          📌 <strong>예시 미리보기</strong> (청송 홍로 사과) — 왼쪽에 상품명을 입력하면 실제 미리보기로 바뀝니다
        </div>
      )}

      {!isWide && !isDemoMode && (
        <div
          style={{
            padding: "10px 14px",
            marginBottom: 12,
            background: "var(--color-primary-50)",
            border: "1px dashed var(--color-primary-600)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-neutral-900)",
            fontSize: "var(--font-size-sm)",
            textAlign: "center",
          }}
        >
          👆 위 폼에서 입력하면 여기에 반영됩니다
        </div>
      )}

      {result && lastUsage && (
        <div
          className="fdp-no-print"
          style={{
            padding: "8px 14px",
            marginBottom: 12,
            background: "var(--color-bg-surface)",
            border: "1px solid var(--color-neutral-300)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-neutral-700)",
            fontSize: 12,
            textAlign: "right",
          }}
        >
          이번 생성: 토큰 {(lastUsage.inputTokens + lastUsage.outputTokens).toLocaleString()}
          {lastUsage.webSearchRequests ? ` · 리서치 검색 ${lastUsage.webSearchRequests}회` : ""}
          {" · 약 ₩"}
          {Math.max(1, Math.round(lastUsage.estimatedCostKRW)).toLocaleString()}
        </div>
      )}

      <ResultView
        copy={liveCopy}
        images={images}
        productName={liveResultMeta.productName}
        price={liveResultMeta.priceNum}
        origin={liveResultMeta.origin}
        weight={liveResultMeta.weight}
        trust={currentInput?.trust ?? trustForPreview}
        reviews={currentInput?.reviews ?? reviews}
        onCopyChange={handleCopyChange}
        onSectionRegenerate={result ? handleSectionRegenerate : undefined}
        busySection={busySection}
        onRetry={handleRetry}
      />

      {isGenerating && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(255, 255, 255, 0.85)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 80,
            borderRadius: "var(--radius-md)",
            zIndex: 10,
          }}
        >
          <GeneratingOverlay step={generationStep} totalSteps={GENERATION_STEPS.length} />
        </div>
      )}
    </div>
  )

  return (
    <div
      style={{
        maxWidth: 1480,
        margin: "0 auto",
        padding: isWide ? "var(--space-7) var(--space-5)" : "var(--space-10) var(--space-5)",
        display: "grid",
        gridTemplateColumns: isWide ? "minmax(440px, 540px) minmax(0, 1fr)" : "1fr",
        gap: isWide ? 32 : 24,
        alignItems: "start",
      }}
    >
      <div
        style={{
          position: isWide ? "sticky" : "static",
          top: isWide ? 16 : undefined,
          maxHeight: isWide ? "calc(100vh - 32px)" : undefined,
          overflowY: isWide ? "auto" : undefined,
        }}
      >
        {formColumn}
      </div>
      {previewColumn}
    </div>
  )
}

function GeneratingOverlay({ step, totalSteps }: { step: number; totalSteps: number }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 20,
        padding: 28,
        background: "var(--color-bg-surface)",
        border: "1px solid var(--color-neutral-100)",
        borderRadius: "var(--radius-md)",
        boxShadow: "0 6px 24px rgba(0,0,0,0.08)",
        minWidth: 320,
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          border: "4px solid var(--color-primary-100)",
          borderTopColor: "var(--color-primary-600)",
          animation: "spin 1s linear infinite",
        }}
      />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <h2
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
        }}
      >
        {t.detail.submitting}
      </h2>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          fontSize: "var(--font-size-sm)",
          color: "var(--color-neutral-500)",
          minWidth: 260,
        }}
      >
        {GENERATION_STEPS.map((s, i) => {
          const state = step > i ? "done" : step === i ? "active" : "wait"
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color:
                  state === "wait"
                    ? "var(--color-neutral-400)"
                    : "var(--color-neutral-900)",
              }}
            >
              {state === "done" && "✅"}
              {state === "active" && "⏳"}
              {state === "wait" && "⚪"}
              <span>
                {i + 1}/{totalSteps} {s}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Step({
  number,
  title,
  hint,
  children,
}: {
  number: number
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 4,
        }}
      >
        {title}
      </h2>
      {hint && (
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-neutral-500)",
            marginBottom: 12,
          }}
        >
          {hint}
        </p>
      )}
      <div
        style={{
          background: "var(--color-bg-surface)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-7)",
          border: "1px solid var(--color-neutral-100)",
        }}
      >
        {children}
      </div>
      <input type="hidden" name={`step-${number}`} />
    </section>
  )
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 14,
      }}
    >
      {children}
    </div>
  )
}

/**
 * 운영 방식 체크박스 — 셀러가 실제로 지키는 약속만 켜서 페이지에 노출.
 * 미체크 시 상세페이지의 강한 주장("당일 수확"·"100% 환불"·"콜드체인")은
 * 노출되지 않고 안전 문구로 대체됨(허위광고 방지).
 */
function TrustPromiseChecks({
  sameDayHarvest,
  coldChain,
  refundGuarantee,
  onSameDayHarvest,
  onColdChain,
  onRefundGuarantee,
}: {
  sameDayHarvest: boolean
  coldChain: boolean
  refundGuarantee: boolean
  onSameDayHarvest: (v: boolean) => void
  onColdChain: (v: boolean) => void
  onRefundGuarantee: (v: boolean) => void
}) {
  const c = t.detail.trustPromise
  const rows: { label: string; on: boolean; onChange: (v: boolean) => void }[] = [
    { label: c.sameDayHarvest, on: sameDayHarvest, onChange: onSameDayHarvest },
    { label: c.coldChain, on: coldChain, onChange: onColdChain },
    { label: c.refundGuarantee, on: refundGuarantee, onChange: onRefundGuarantee },
  ]
  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid var(--color-neutral-100)",
        borderRadius: "var(--radius-xs)",
        background: "var(--color-bg-surface)",
      }}
    >
      <div
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 4,
        }}
      >
        {c.title}
      </div>
      <p
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-neutral-500)",
          margin: "0 0 12px",
          lineHeight: 1.5,
        }}
      >
        {c.hint}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.map((row) => (
          <label
            key={row.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              cursor: "pointer",
              fontSize: "var(--font-size-md)",
              color: "var(--color-neutral-900)",
            }}
          >
            <input
              type="checkbox"
              checked={row.on}
              onChange={(e) => row.onChange(e.target.checked)}
              style={{ accentColor: "#E03131", width: 18, height: 18, flexShrink: 0 }}
            />
            {row.label}
          </label>
        ))}
      </div>
    </div>
  )
}

/**
 * 고객 후기 입력 — 셀러가 실제 받은 후기만 직접 입력(AI 생성 금지). 최대 3개.
 * 각 후기: 본문(최대 200자) + 강조할 핵심 문장(선택).
 * "실제 받은 후기만 넣어주세요 — 지어내면 안 돼요" 안내를 명시.
 */
const REVIEW_MAX = 3
const REVIEW_TEXT_MAX = 200

function ReviewsInput({
  reviews,
  onChange,
}: {
  reviews: SellerReview[]
  onChange: (next: SellerReview[]) => void
}) {
  const c = t.detail.reviews
  const update = (idx: number, patch: Partial<SellerReview>) => {
    onChange(reviews.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }
  const add = () => {
    if (reviews.length >= REVIEW_MAX) return
    onChange([...reviews, { text: "" }])
  }
  const remove = (idx: number) => {
    onChange(reviews.filter((_, i) => i !== idx))
  }

  return (
    <div
      style={{
        padding: "14px 16px",
        border: "1px solid var(--color-neutral-100)",
        borderRadius: "var(--radius-xs)",
        background: "var(--color-bg-surface)",
      }}
    >
      <div
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 4,
        }}
      >
        {c.title}
      </div>
      <p
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-danger)",
          margin: "0 0 12px",
          lineHeight: 1.5,
          fontWeight: 600,
        }}
      >
        {c.hint}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {reviews.map((r, i) => (
          <div
            key={`review-input-${i}`}
            style={{
              border: "1px solid var(--color-neutral-100)",
              borderRadius: "var(--radius-xs)",
              padding: "12px 12px",
              background: "var(--color-bg-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 700,
                  color: "var(--color-neutral-900)",
                }}
              >
                {c.textLabel.replace("{n}", String(i + 1))}
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-danger)",
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 700,
                  cursor: "pointer",
                  padding: "2px 4px",
                }}
              >
                {c.remove}
              </button>
            </div>
            <textarea
              value={r.text}
              onChange={(e) => update(i, { text: e.target.value.slice(0, REVIEW_TEXT_MAX) })}
              placeholder={c.textPh}
              rows={2}
              maxLength={REVIEW_TEXT_MAX}
              style={{
                ...inputStyle,
                resize: "vertical",
                fontFamily: "inherit",
                lineHeight: 1.5,
              }}
            />
            <div style={{ fontSize: 10, color: "var(--color-neutral-500)", textAlign: "right" }}>
              {r.text.length} / {REVIEW_TEXT_MAX}
            </div>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span
                style={{
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 600,
                  color: "var(--color-neutral-700)",
                }}
              >
                {c.highlightLabel}
              </span>
              <input
                type="text"
                value={r.highlight ?? ""}
                onChange={(e) => update(i, { highlight: e.target.value.slice(0, REVIEW_TEXT_MAX) })}
                placeholder={c.highlightPh}
                style={inputStyle}
              />
            </label>
            <p
              style={{
                fontSize: 10,
                color: "var(--color-neutral-500)",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {c.highlightHint}
            </p>
          </div>
        ))}
      </div>

      {reviews.length < REVIEW_MAX && (
        <button
          type="button"
          onClick={add}
          style={{
            marginTop: reviews.length > 0 ? 12 : 0,
            width: "100%",
            padding: "10px 12px",
            background: "var(--color-bg-subtle)",
            border: "1px dashed var(--color-neutral-300)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-neutral-700)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          {c.add}
        </button>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--color-neutral-900)",
        }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1px solid var(--color-neutral-100)",
  borderRadius: "var(--radius-xs)",
  fontSize: "var(--font-size-md)",
  background: "var(--color-bg-surface)",
  color: "var(--color-neutral-900)",
  fontFamily: "inherit",
}

/** 예시 채우기로 채워진 산지 값 옆 경고 힌트 — 실제 산지로 교체 유도(허위 표시 방지). */
const demoHintStyle: React.CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-danger)",
  fontWeight: 700,
  marginTop: 4,
}
