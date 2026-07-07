"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ImageUploader, SingleSlotUploader, type UploadedImage } from "./ImageUploader"
import { KeywordPicker } from "./KeywordPicker"
import { ResultView, emptyCopy, type LayoutVariant } from "./ResultView"
import { SeasonHint } from "./SeasonHint"
import { SellingPointsSuggester } from "./SellingPointsSuggester"
import { getAIProvider } from "@/lib/ai/provider"
import type {
  CopyInput,
  CopyOutput,
  CopySpec,
  CopyTone,
  PhotoAnalysisItem,
  PhotoAnalysisResult,
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
import { getEnhancedUrl } from "@/lib/image-enhance/enhance-runner"
import { t } from "@/lib/i18n"
import { validateProductNameSeo } from "@/lib/ai/validate"
import { detectFruitFactKey, FRUIT_FACTS } from "@/domain/fruit-facts"
import { DEMO_COPY } from "./demo-copy"
import { BrandKitPanel } from "./BrandKitPanel"
import {
  listBrands,
  getDefaultBrandId,
  toSnapshot,
  type BrandProfile,
  type BrandSnapshot,
} from "@/lib/storage/brand-db"

type Stage = "restoring" | "input" | "generating" | "result" | "error"

const EXTRA_DESC_PREFIX = "상품 추가 설명: "

const PRESET_LABEL_SET = new Set(PRESET_KEYWORDS.map((k) => k.label))

/** 좌/우 분할 분기점 (px). 이 아래는 적층 레이아웃. */
const SPLIT_BREAKPOINT = 1280

async function blobToUploadedImage(
  blob: Blob,
  idx: number,
  preferredId?: string,
): Promise<UploadedImage | null> {
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
      // v4.4: 저장된 원본 upload id 를 그대로 되살린다(있을 때). 없으면 신규 restored id.
      //   이 정합이 있어야 복원 후에도 photoAnalysis[].imageId 가 매칭된다(재분석 캐시·배치·캡션).
      id: preferredId && preferredId.trim() ? preferredId : `restored-${Date.now()}-${idx}`,
      file,
      url,
      // 복원 직후엔 원본을 표시(url=rawUrl). 보정 ON이면 아래 동기화 effect가 보정본으로 스왑.
      rawUrl: url,
      ...dims,
    }
  } catch {
    return null
  }
}

/**
 * 단일 슬롯(포장/크기) 사진의 자동 보정 표시 상태를 토글에 맞춰 동기화.
 * - ON: 현재 원본을 표시 중이면(url===rawUrl) 보정본 URL로 스왑(캐시 dedup).
 * - OFF: 보정본을 표시 중이면 원본(rawUrl)으로 되돌림(재보정 없음).
 * setImages 계열과 동일하게, 변화가 없으면 이전 값을 그대로 반환해 불필요한 렌더/루프를 막는다.
 */
function syncSingleEnhance(
  img: UploadedImage | null,
  enabled: boolean,
  isCancelled: () => boolean,
  setImg: React.Dispatch<React.SetStateAction<UploadedImage | null>>,
): void {
  if (!img || !img.rawUrl) return
  if (enabled) {
    if (img.url !== img.rawUrl) return // 이미 보정본 표시 중
    const { id, file } = img
    void getEnhancedUrl(file)
      .then((enhUrl) => {
        if (isCancelled()) return
        setImg((cur) =>
          cur && cur.id === id && cur.file === file && cur.rawUrl && cur.url === cur.rawUrl
            ? { ...cur, url: enhUrl }
            : cur,
        )
      })
      .catch(() => {
        /* 보정 실패 시 원본 유지 */
      })
  } else {
    setImg((cur) =>
      cur && cur.rawUrl && cur.url !== cur.rawUrl ? { ...cur, url: cur.rawUrl } : cur,
    )
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

/**
 * v4.4: 사진 분석 입력용 512px 다운스케일 dataURL 생성.
 * img.url(원본/보정본 objectURL)을 fetch → bitmap → canvas → JPEG dataURL로 축소.
 * works-db의 makeThumbDataUrl 패턴을 따르되 maxSize 512·품질 0.8. 실패 시 null(해당 사진만 제외).
 */
async function toAnalysisDataUrl(url: string, maxSize = 512): Promise<string | null> {
  if (typeof window === "undefined") return null
  try {
    const res = await fetch(url)
    const blob = await res.blob()
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return canvas.toDataURL("image/jpeg", 0.8)
  } catch {
    return null
  }
}

/**
 * v4.4: 기존 사진 분석이 현재 이미지 목록과 정확히 일치하는지(재분석 스킵 판단).
 * imageId 집합이 완전히 같을 때만 재사용 — 한 장이라도 추가/삭제/교체되면 재분석.
 */
function photoAnalysisMatchesImages(
  analysis: PhotoAnalysisItem[] | null,
  imgs: UploadedImage[],
): boolean {
  if (!analysis || analysis.length === 0 || imgs.length === 0) return false
  const analyzed = new Set(analysis.map((p) => p.imageId))
  if (analyzed.size !== imgs.length) return false
  for (const img of imgs) {
    if (!analyzed.has(img.id)) return false
  }
  return true
}

/** v4.4: 카피 생성 usage에 사진 분석 usage를 합산(비용 표시 투명성). extra 없으면 base 그대로. */
function mergeUsage(base: UsageInfo, extra?: UsageInfo): UsageInfo {
  if (!extra) return base
  const ws = (base.webSearchRequests ?? 0) + (extra.webSearchRequests ?? 0)
  return {
    inputTokens: base.inputTokens + extra.inputTokens,
    outputTokens: base.outputTokens + extra.outputTokens,
    estimatedCostKRW: base.estimatedCostKRW + extra.estimatedCostKRW,
    truncated: base.truncated || extra.truncated,
    webSearchRequests: ws > 0 ? ws : undefined,
  }
}

export function DetailMaker({ initialWorkId }: { initialWorkId?: string }) {
  const [stage, setStage] = useState<Stage>(initialWorkId ? "restoring" : "input")
  const [images, setImages] = useState<UploadedImage[]>([])
  /**
   * v3.7: 포장·크기비교 전용 슬롯 사진 — 일반 풀(images)과 분리 관리한다.
   * planImages에 넣지 않고 ResultView에 별도 prop으로 전달한다.
   * - packagingImage 없으면 PackagingBlock 섹션 자체 미노출(풀 사진 대체 금지).
   * - sizeImage 있으면 크기 섹션에 사진 렌더, 없으면 기존 동작(무게 데이터만).
   */
  const [packagingImage, setPackagingImage] = useState<UploadedImage | null>(null)
  const [sizeImage, setSizeImage] = useState<UploadedImage | null>(null)
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
  /**
   * 사진 자동 보정 토글 — 기본 ON. Work 레코드(enhanceImages)에 저장·복원.
   * ON이면 업로드/복원된 이미지의 url을 보정본으로 스왑, OFF면 원본 유지.
   * 저장 blob은 항상 원본(보정본 저장 안 함 → 알고리즘 개선 시 재적용 가능).
   */
  const [enhanceImages, setEnhanceImages] = useState(true)
  /**
   * v4.4: 사진 분석 토글 — 기본 ON. Work 레코드(photoAnalysisEnabled)에 저장·복원.
   * ON이면 생성 시 리서치와 병렬로 AI가 사진을 보고 역할·대표컷·품질을 분석한다.
   */
  const [photoAnalysisEnabled, setPhotoAnalysisEnabled] = useState(true)
  /**
   * v4.4: 마지막 사진 분석 결과 — 생성 시 채워지고 ResultView 배치 로직에 전달.
   * 복원 시 Work.photoAnalysis로 채운다. 같은 사진 재생성 시 재분석 스킵 캐시로도 쓰인다.
   * 분석 실패/OFF면 null → ResultView가 순서 기반 로직으로 폴백.
   */
  const [photoAnalysis, setPhotoAnalysis] = useState<PhotoAnalysisItem[] | null>(null)
  /**
   * v4.6: 레이아웃 무드 변주 — 기본 "standard"(기존 렌더와 픽셀 동일). Work(layoutVariant)에
   * 저장·복원. 결과 화면에서 즉시 전환되며 섹션 순서·게이팅·카피는 불변, 디자인 토큰만 달라진다.
   */
  const [layoutVariant, setLayoutVariant] = useState<LayoutVariant>("standard")
  /**
   * v5.0-B: "우리 가게" 브랜드 배선.
   * - brands/defaultBrandId: 패널 표시용 목록·기본 지정(부모가 소유·재로딩).
   * - selectedBrandId: 현재 선택 프로필(신규 스냅샷의 원천).
   * - brandSnapshot: ResultView 로 넘어가고 Work 에 박제되는 값(단일 진실).
   * 복원 시 work.brandSnapshot 이 있으면 그것을 우선(스냅샷 불변 — 프로필 목록과 무관).
   */
  const [brands, setBrands] = useState<BrandProfile[]>([])
  const [defaultBrandId, setDefaultBrandId] = useState<string | null>(null)
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null)
  const [brandSnapshot, setBrandSnapshot] = useState<BrandSnapshot | null>(null)
  /**
   * 복원된 작업이 자체 박제 스냅샷을 실었는지. true 면 초기 기본-프로필 자동선택이
   * 그 스냅샷을 덮어쓰지 않는다(불변). 사용자가 프로필을 직접 고르면 해제된다.
   */
  const brandFromWorkRef = useRef(false)
  /**
   * 복원 결정(스냅샷 유무)이 끝났는지 — 기본 프로필 자동선택이 복원보다 앞질러
   * 스냅샷을 덮어쓰지 않도록 게이트. initialWorkId 없으면 즉시 resolved.
   */
  const [brandRestoreResolved, setBrandRestoreResolved] = useState(() => !initialWorkId)
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
          // v4.4: 저장된 이미지 id 를 그대로 복원(imageBlobs 와 같은 인덱스)해 photoAnalysis 와 정합.
          const img = await blobToUploadedImage(blob, i, work.imageIds?.[i])
          if (img) {
            restored.push(img)
            restoredUrlsRef.current.push(img.url)
          }
        }
        // v3.7: 전용 슬롯 사진 복원 — 구버전 저장본엔 필드 없음(옵셔널·하위호환).
        let restoredPackaging: UploadedImage | null = null
        if (work.packagingBlob) {
          const img = await blobToUploadedImage(work.packagingBlob, 1000)
          if (img) {
            restoredPackaging = img
            restoredUrlsRef.current.push(img.url)
          }
        }
        let restoredSize: UploadedImage | null = null
        if (work.sizeBlob) {
          const img = await blobToUploadedImage(work.sizeBlob, 1001)
          if (img) {
            restoredSize = img
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
        setPackagingImage(restoredPackaging)
        setSizeImage(restoredSize)
        // 사진 자동 보정 토글 복원 — 구버전 저장본엔 없음(undefined → 기본 ON, 하위호환).
        setEnhanceImages(work.enhanceImages ?? true)
        // v4.4: 사진 분석 토글·결과 복원 — 구버전 저장본엔 없음(undefined → 기본 ON, 하위호환).
        setPhotoAnalysisEnabled(work.photoAnalysisEnabled ?? true)
        setPhotoAnalysis(work.photoAnalysis ?? null)
        // v4.6: 레이아웃 변주 복원 — 구버전 저장본엔 없음(undefined → "standard", 하위호환).
        setLayoutVariant(work.layoutVariant ?? "standard")
        // v5.0-B: 작업에 박제된 브랜드 스냅샷 복원(있으면 우선 — 불변, 프로필 목록과 무관).
        //   구버전 저장본엔 없음(옵셔널 — 하위호환). ref 를 세워 기본-프로필 자동선택이 덮지 않게 한다.
        if (work.brandSnapshot) {
          setBrandSnapshot(work.brandSnapshot)
          brandFromWorkRef.current = true
        }
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
      } finally {
        // v5.0-B: 복원 결정 완료 통지 — 기본 프로필 자동선택 게이트 해제(브랜드 초기화 effect 실행).
        if (!cancelled) setBrandRestoreResolved(true)
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

  /**
   * v5.0-B: 브랜드 초기화 — 복원 결정(brandRestoreResolved) 후 1회.
   * 목록·기본값을 로드하고, 복원 스냅샷이 없을 때만 기본 프로필을 자동 선택해 스냅샷을 만든다.
   * 복원 스냅샷이 있으면(brandFromWorkRef) 목록만 로드하고 선택/스냅샷은 건드리지 않는다(불변).
   */
  useEffect(() => {
    if (!brandRestoreResolved) return
    let cancelled = false
    void (async () => {
      try {
        const [list, defId] = await Promise.all([listBrands(), getDefaultBrandId()])
        if (cancelled) return
        setBrands(list)
        setDefaultBrandId(defId)
        if (brandFromWorkRef.current) return // 작업 박제 스냅샷 우선 — 자동선택 스킵
        const def = list.find((b) => b.id === defId) ?? null
        setSelectedBrandId(def?.id ?? null)
        const snap = def ? await toSnapshot(def) : null
        if (!cancelled) setBrandSnapshot(snap)
      } catch (e) {
        console.error("[brand-init]", e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [brandRestoreResolved])

  /**
   * 사진 자동 보정 동기화 — images(추가/복원)·enhanceImages(토글) 변화에 맞춰 각 이미지의 url을 스왑.
   * - ON: 아직 원본을 표시 중인(url===rawUrl) 이미지를 보정본으로(캐시 dedup, 동시 2개 제한).
   * - OFF: 보정본 표시 중인 이미지를 원본(rawUrl)으로 즉시 되돌림(재보정 없음).
   * 변화 없으면 이전 배열 참조를 그대로 반환해 렌더/effect 재실행 루프를 끊는다.
   */
  useEffect(() => {
    if (typeof window === "undefined") return
    let cancelled = false
    if (enhanceImages) {
      for (const img of images) {
        if (!img.rawUrl || img.url !== img.rawUrl) continue // 이미 보정본 표시 중
        const { id, file } = img
        void getEnhancedUrl(file)
          .then((enhUrl) => {
            if (cancelled) return
            setImages((prev) => {
              let changed = false
              const next = prev.map((im) => {
                if (im.id === id && im.file === file && im.rawUrl && im.url === im.rawUrl) {
                  changed = true
                  return { ...im, url: enhUrl }
                }
                return im
              })
              return changed ? next : prev
            })
          })
          .catch(() => {
            /* 보정 실패 시 원본 유지 */
          })
      }
    } else {
      setImages((prev) => {
        let changed = false
        const next = prev.map((im) => {
          if (im.rawUrl && im.url !== im.rawUrl) {
            changed = true
            return { ...im, url: im.rawUrl }
          }
          return im
        })
        return changed ? next : prev
      })
    }
    return () => {
      cancelled = true
    }
  }, [images, enhanceImages])

  /** 포장 슬롯 사진 보정 동기화. */
  useEffect(() => {
    if (typeof window === "undefined") return
    let cancelled = false
    syncSingleEnhance(packagingImage, enhanceImages, () => cancelled, setPackagingImage)
    return () => {
      cancelled = true
    }
  }, [packagingImage, enhanceImages])

  /** 크기 비교 슬롯 사진 보정 동기화. */
  useEffect(() => {
    if (typeof window === "undefined") return
    let cancelled = false
    syncSingleEnhance(sizeImage, enhanceImages, () => cancelled, setSizeImage)
    return () => {
      cancelled = true
    }
  }, [sizeImage, enhanceImages])

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

    // v4.4: 사진 분석 — generateCopy와 병렬 실행. 실패해도(내부 catch → null) 카피 생성은 진행한다.
    // 재사용: 기존 분석의 imageId 집합이 현재 images와 정확히 일치하면 재분석 스킵(비용 절약).
    const reusableAnalysis =
      photoAnalysisEnabled && photoAnalysisMatchesImages(photoAnalysis, images)
        ? photoAnalysis
        : null
    const analysisPromise: Promise<PhotoAnalysisResult | null> = (async () => {
      if (!photoAnalysisEnabled || images.length === 0) return null
      if (reusableAnalysis) return { items: reusableAnalysis } // 재사용 — 추가 비용 없음
      try {
        // 대상: 일반 사진(images)만. packaging/size 슬롯은 전용이라 분석 제외.
        const photos: { id: string; dataUrl: string }[] = []
        for (const img of images) {
          const dataUrl = await toAnalysisDataUrl(img.url, 512)
          if (dataUrl) photos.push({ id: img.id, dataUrl })
        }
        if (photos.length === 0) return null
        return await getAIProvider().analyzePhotos(photos, {
          productType: productName.trim(),
          category,
        })
      } catch (e) {
        console.error("[analyzePhotos]", e)
        return null
      }
    })()

    try {
      // generateCopy는 실패 시 throw(→ 아래 catch로 에러 화면). analysisPromise는 절대 reject 안 함.
      const [res, analysisRes] = await Promise.all([
        getAIProvider().generateCopy(input),
        analysisPromise,
      ])
      const analysisItems = analysisRes?.items ?? null
      setResult(res.output)
      // 분석 usage(신규 분석일 때만 존재 — 재사용/OFF/실패면 없음)를 생성 비용에 합산 표시.
      setLastUsage(mergeUsage(res.usage, analysisRes?.usage))
      setPhotoAnalysis(analysisItems)
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
          // v4.4: 이미지 id 도 저장 — 복원 후 photoAnalysis imageId 정합(재분석 캐시·배치·캡션).
          imageIds: images.map((i) => i.id),
          // v3.7: 전용 슬롯 사진 — 일반 imageBlobs와 별도 저장(없으면 null).
          packagingBlob: packagingImage?.file ?? null,
          sizeBlob: sizeImage?.file ?? null,
          // 사진 자동 보정 토글 — 표시 옵션. 저장 blob은 항상 원본.
          enhanceImages,
          // v4.4: 사진 분석 토글·결과 저장(같은 사진 재생성 시 재분석 스킵 캐시).
          photoAnalysisEnabled,
          photoAnalysis: analysisItems ?? undefined,
          // v4.6: 레이아웃 변주 저장(현재 선택값 — 기본 standard).
          layoutVariant,
          // v5.0-B: 선택 브랜드 스냅샷 박제(없으면 undefined). 이후 브랜드 편집/삭제와 무관하게 고정.
          brandSnapshot: brandSnapshot ?? undefined,
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
            // v4.4: 이미지 id 유지(인라인 편집 저장 시에도 photoAnalysis 정합 유지).
            imageIds: images.map((i) => i.id),
            // v3.7: 전용 슬롯 사진 유지(인라인 편집 저장 시에도 유실 방지).
            packagingBlob: packagingImage?.file ?? null,
            sizeBlob: sizeImage?.file ?? null,
            // 사진 자동 보정 토글 유지.
            enhanceImages,
            // v4.4: 사진 분석 토글·결과 유지(인라인 편집 저장 시에도 유실 방지).
            photoAnalysisEnabled,
            photoAnalysis: photoAnalysis ?? undefined,
            // v4.6: 레이아웃 변주 유지(인라인 편집 저장 시에도 현재 선택값 보존).
            layoutVariant,
            // v5.0-B: 브랜드 스냅샷 유지(인라인 편집 저장 시에도 유실 방지).
            brandSnapshot: brandSnapshot ?? undefined,
          }
          await saveWork(work)
        } catch (e) {
          console.error("[saveWork-update]", e)
        }
      })()
    }
  }

  /**
   * v4.6: 레이아웃 변주 전환 — 즉시 state 반영(미리보기 갱신) + 저장된 작업이 있으면 persist.
   * handleCopyChange 와 동일한 Work 구성으로, 현재 copy(result)를 유지한 채 layoutVariant만 갱신 저장.
   * 아직 생성 전(workId 없음)이면 state만 바꾸고, 이후 handleSubmit 저장 시 함께 기록된다.
   */
  const handleLayoutVariantChange = (next: LayoutVariant) => {
    setLayoutVariant(next)
    if (workId && currentInput && resultMeta && result) {
      void (async () => {
        try {
          const work: Work = {
            id: workId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            productName: resultMeta.productName,
            thumbDataUrl: images[0] ? await makeThumbDataUrl(images[0].file) : null,
            input: currentInput,
            copy: result,
            imageBlobs: images.map((i) => i.file),
            imageIds: images.map((i) => i.id),
            packagingBlob: packagingImage?.file ?? null,
            sizeBlob: sizeImage?.file ?? null,
            enhanceImages,
            photoAnalysisEnabled,
            photoAnalysis: photoAnalysis ?? undefined,
            layoutVariant: next,
            // v5.0-B: 브랜드 스냅샷 유지(레이아웃 변주 저장 시에도 유실 방지).
            brandSnapshot: brandSnapshot ?? undefined,
          }
          await saveWork(work)
        } catch (e) {
          console.error("[saveWork-layout]", e)
        }
      })()
    }
  }

  /** v5.0-B: 브랜드 목록·기본값 재로딩(패널 DB 변경 후). 최신 리스트를 반환. */
  const reloadBrands = async (): Promise<BrandProfile[]> => {
    const [list, defId] = await Promise.all([listBrands(), getDefaultBrandId()])
    setBrands(list)
    setDefaultBrandId(defId)
    return list
  }

  /**
   * v5.0-B: 결과 화면에서 브랜드가 바뀌면 현재 작업에 즉시 저장.
   * workId·currentInput·resultMeta·result 가 모두 있어야(결과 단계) 저장 — 그 외엔 no-op(가드).
   * handleLayoutVariantChange 와 동일한 Work 구성에 brandSnapshot 만 교체한다.
   */
  const persistBrandToWork = (snap: BrandSnapshot | null) => {
    if (!(workId && currentInput && resultMeta && result)) return
    void (async () => {
      try {
        const work: Work = {
          id: workId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          productName: resultMeta.productName,
          thumbDataUrl: images[0] ? await makeThumbDataUrl(images[0].file) : null,
          input: currentInput,
          copy: result,
          imageBlobs: images.map((i) => i.file),
          imageIds: images.map((i) => i.id),
          packagingBlob: packagingImage?.file ?? null,
          sizeBlob: sizeImage?.file ?? null,
          enhanceImages,
          photoAnalysisEnabled,
          photoAnalysis: photoAnalysis ?? undefined,
          layoutVariant,
          brandSnapshot: snap ?? undefined,
        }
        await saveWork(work)
      } catch (e) {
        console.error("[saveWork-brand]", e)
      }
    })()
  }

  /**
   * v5.0-B: 사용자가 드롭다운에서 프로필 선택. 스냅샷을 그 프로필로 갱신(불변 해제) +
   * 결과 단계면 즉시 저장. 신규 추가 직후처럼 목록에 아직 없을 수 있어 항상 재로딩해 해석한다.
   */
  const handleBrandSelect = async (brandId: string | null) => {
    brandFromWorkRef.current = false
    setSelectedBrandId(brandId)
    if (!brandId) {
      setBrandSnapshot(null)
      persistBrandToWork(null)
      return
    }
    const list = await reloadBrands()
    const brand = list.find((b) => b.id === brandId) ?? null
    const snap = brand ? await toSnapshot(brand) : null
    setBrandSnapshot(snap)
    persistBrandToWork(snap)
  }

  /**
   * v5.0-B: 패널이 DB 를 바꾼 뒤(추가/편집/삭제/기본지정/불러오기) 부모 목록 재로딩.
   * 선택 프로필이 사라졌으면 해제하고, 남아 있고 작업 박제가 아니면 최신 프로필로 스냅샷 재계산.
   */
  const handleBrandsChanged = async () => {
    const list = await reloadBrands()
    if (!selectedBrandId) return
    if (!list.some((b) => b.id === selectedBrandId)) {
      // 선택 중이던 프로필이 삭제됨 — 해제(작업 박제 중이면 스냅샷은 유지).
      setSelectedBrandId(null)
      if (!brandFromWorkRef.current) {
        setBrandSnapshot(null)
        persistBrandToWork(null)
      }
      return
    }
    if (!brandFromWorkRef.current) {
      // 선택 프로필 내용이 편집됐을 수 있으니 스냅샷 최신화(로고/색 반영).
      const brand = list.find((b) => b.id === selectedBrandId) ?? null
      const snap = brand ? await toSnapshot(brand) : null
      setBrandSnapshot(snap)
      persistBrandToWork(snap)
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

        {/*
          v3.7: 포장·크기비교 전용 사진 슬롯 (옵션 카드 2개).
          여기 넣은 사진은 일반 풀에 섞이지 않고 해당 섹션에만 쓰인다.
          - 포장 사진 없으면 배송 구성 섹션 자체가 안 나온다(무관한 풀 사진 대체 금지).
          - 크기 사진 넣으면 크기 섹션에 사진이 붙는다(없으면 무게 데이터만).
        */}
        <div
          style={{
            marginTop: 16,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <SingleSlotUploader
            image={packagingImage}
            onChange={setPackagingImage}
            title="포장 사진 (선택)"
            tip="송장·완충재가 보이게"
            emoji="📦"
          />
          <SingleSlotUploader
            image={sizeImage}
            onChange={setSizeImage}
            title="크기 비교 사진 (선택)"
            tip="손이나 500원 동전과 함께"
            emoji="📏"
          />
        </div>
        <p
          style={{
            marginTop: 8,
            fontSize: "var(--font-size-xs)",
            color: "var(--color-neutral-500)",
            lineHeight: 1.5,
          }}
        >
          이 두 슬롯 사진은 위 일반 사진 목록과 섞이지 않고, 각 전용 섹션(배송 구성 · 크기 비교)에만 쓰여요. 포장 사진을 넣지 않으면 배송 구성 섹션은 표시되지 않아요.
        </p>
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

      {/* v5.0-B: "우리 가게" 브랜드 키트 — 로고·대표색·서명·문의를 상세페이지에 자동 반영. */}
      <BrandKitPanel
        brands={brands}
        selectedBrandId={selectedBrandId}
        defaultBrandId={defaultBrandId}
        appliedSnapshotName={selectedBrandId === null && brandSnapshot ? brandSnapshot.name : null}
        onSelect={handleBrandSelect}
        onBrandsChanged={handleBrandsChanged}
        disabled={isGenerating}
      />

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

      {/* v4.4: 사진 분석 토글 — 기본 ON. 생성 시 리서치와 병렬로 AI가 사진 역할·대표컷·품질을 분석. */}
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
            🔍 사진 분석
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-neutral-600)",
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            AI가 사진을 보고 대표컷·배치를 정해요 (회당 약 십몇~수십 원 추가).
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
            aria-label="사진 분석"
            checked={photoAnalysisEnabled}
            disabled={isGenerating}
            onChange={(e) => setPhotoAnalysisEnabled(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              transition: "background 0.15s",
              background: photoAnalysisEnabled
                ? "var(--color-primary-600)"
                : "var(--color-neutral-300)",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 3,
              left: photoAnalysisEnabled ? 23 : 3,
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

      {/* 사진 자동 보정 토글 — 기본 ON. 업로드/복원된 사진을 과일 특화 자동 보정으로 표시(내보내기 반영). */}
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
            🎨 사진 자동 보정
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--color-neutral-600)",
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            밝기·색감·선명도를 과일 사진에 맞게 자동 보정해요. 원본은 그대로 보관돼요.
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
            aria-label="사진 자동 보정"
            checked={enhanceImages}
            disabled={isGenerating}
            onChange={(e) => setEnhanceImages(e.target.checked)}
            style={{ opacity: 0, width: 0, height: 0 }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 999,
              transition: "background 0.15s",
              background: enhanceImages
                ? "var(--color-primary-600)"
                : "var(--color-neutral-300)",
            }}
          />
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: 3,
              left: enhanceImages ? 23 : 3,
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

      {/* v4.6: 레이아웃 무드 변주 스위처 — 오른쪽 결과 미리보기에 즉시 반영(디자인 토큰만 변경). */}
      <LayoutVariantSwitcher value={layoutVariant} onChange={handleLayoutVariantChange} />

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
        packagingImage={packagingImage}
        sizeImage={sizeImage}
        photoAnalysis={photoAnalysis ?? undefined}
        productName={liveResultMeta.productName}
        price={liveResultMeta.priceNum}
        origin={liveResultMeta.origin}
        weight={liveResultMeta.weight}
        category={currentInput?.category ?? category}
        trust={currentInput?.trust ?? trustForPreview}
        reviews={currentInput?.reviews ?? reviews}
        onCopyChange={handleCopyChange}
        onSectionRegenerate={result ? handleSectionRegenerate : undefined}
        busySection={busySection}
        layoutVariant={layoutVariant}
        brandSnapshot={brandSnapshot}
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

/**
 * v4.6: 레이아웃 무드 변주 스위처 — 라디오 3버튼(기본/소프트/매거진).
 * 디자인 토큰만 바꾸며(섹션 순서·게이팅·카피 불변) 오른쪽 결과 미리보기에 즉시 반영된다.
 */
const LAYOUT_VARIANT_OPTIONS: { value: LayoutVariant; label: string; desc: string }[] = [
  { value: "standard", label: "기본", desc: "깔끔한 기본 레이아웃" },
  { value: "soft", label: "소프트", desc: "둥근 카드 · 포근한 톤" },
  { value: "editorial", label: "매거진", desc: "명조 헤딩 · 넓은 여백" },
]

function LayoutVariantSwitcher({
  value,
  onChange,
}: {
  value: LayoutVariant
  onChange: (next: LayoutVariant) => void
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        marginBottom: 12,
        background: "var(--color-bg-subtle)",
        border: "1px solid var(--color-neutral-200)",
        borderRadius: "var(--radius-xs)",
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 2,
        }}
      >
        🎨 레이아웃 무드
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--color-neutral-600)",
          lineHeight: 1.5,
          marginBottom: 10,
        }}
      >
        같은 내용을 다른 분위기로 — 순서·문구는 그대로, 디자인만 달라져요.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {LAYOUT_VARIANT_OPTIONS.map((opt) => {
          const active = value === opt.value
          return (
            <label
              key={opt.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                border: active
                  ? "2px solid var(--color-primary-600)"
                  : "1px solid var(--color-neutral-300)",
                borderRadius: "var(--radius-xs)",
                background: active ? "var(--color-primary-50)" : "var(--color-bg-surface)",
                cursor: "pointer",
              }}
            >
              <input
                type="radio"
                name="fdp-layout-variant"
                value={opt.value}
                checked={active}
                onChange={() => onChange(opt.value)}
                style={{ accentColor: "#E03131", flexShrink: 0 }}
              />
              <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontSize: "var(--font-size-md)",
                    fontWeight: 700,
                    color: "var(--color-neutral-900)",
                  }}
                >
                  {opt.label}
                </span>
                <span style={{ fontSize: 11, color: "var(--color-neutral-500)" }}>{opt.desc}</span>
              </span>
            </label>
          )
        })}
      </div>
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
