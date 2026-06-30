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
  TrustInfo,
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
  const [price, setPrice] = useState("")
  const [variety, setVariety] = useState("")
  const [origin, setOrigin] = useState("")
  const [weight, setWeight] = useState("")
  const [brix, setBrix] = useState("")
  const [avgWeightG, setAvgWeightG] = useState("")
  const [sizeGrade, setSizeGrade] = useState("")
  const [extraDescription, setExtraDescription] = useState("")
  const [farmIntro, setFarmIntro] = useState("")
  const [producerName, setProducerName] = useState("")
  const [producerRegion, setProducerRegion] = useState("")
  const [farmerYears, setFarmerYears] = useState("")
  const [presetKeywords, setPresetKeywords] = useState<string[]>([])
  const [customKeywords, setCustomKeywords] = useState<string[]>([])
  const tone: CopyTone = "sincere"
  /** 일반 농산물 확인 게이트 — 건강기능식품/숙취해소 표시 상품 차단 (식약처 §10). */
  const [isOrdinaryProduce, setIsOrdinaryProduce] = useState(true)
  /** 현재 입력에서 합성한 trust 객체 — 미리보기/SellingPointsSuggester에 인입. */
  const trustForPreview: TrustInfo = useMemo(() => {
    const out: TrustInfo = {}
    if (producerName.trim()) out.producerName = producerName.trim()
    if (producerRegion.trim()) out.producerRegion = producerRegion.trim()
    if (farmerYears.trim()) out.farmerYears = Number(farmerYears) || undefined
    return out
  }, [producerName, producerRegion, farmerYears])
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
        setPrice(String(input.price ?? ""))
        setVariety(input.variety ?? "")
        setOrigin(input.origin ?? "")
        setWeight(input.weight ?? "")
        setBrix(input.brix != null ? String(input.brix) : "")
        setFarmIntro(input.farmIntro ?? "")
        setExtraDescription(extra)
        setPresetKeywords(preset)
        setCustomKeywords(custom)
        setWorkId(work.id)
        setCurrentInput(input)

        if (work.copy) {
          setResult(work.copy)
          setResultMeta({
            priceNum: input.price,
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
    images.length >= 1 && productName.trim() && price.trim() && isOrdinaryProduce

  /** 우측 미리보기에 전달할 카피 — 실제 result가 있으면 그것, 없으면 emptyCopy + 임시 spec. */
  const liveCopy = useMemo<CopyOutput>(() => {
    if (result) return result
    const base = emptyCopy()
    base.spec = buildLiveSpec({ origin, variety, weight, brix })
    return base
  }, [result, origin, variety, weight, brix])

  /** 우측 미리보기에 전달할 메타 — 실제 result가 있으면 그 시점의 값, 없으면 현재 입력. */
  const liveResultMeta = useMemo(() => {
    if (result && resultMeta) return resultMeta
    const priceNum = Number(price.replace(/[^\d]/g, "")) || 0
    return {
      priceNum,
      productName: productName.trim(),
      origin: origin.trim(),
      weight: weight.trim(),
    }
  }, [result, resultMeta, price, productName, origin, weight])

  const handleSubmit = async () => {
    if (!hasMin) {
      if (images.length === 0) setErrorMsg(t.detail.minImages)
      else if (!productName.trim()) setErrorMsg(t.detail.needName)
      else if (!price.trim()) setErrorMsg(t.detail.needPrice)
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

    const priceNum = Number(price.replace(/[^\d]/g, ""))

    const trustData: TrustInfo | undefined =
      producerName.trim() || producerRegion.trim() || farmerYears.trim()
        ? {
            producerName: producerName.trim() || undefined,
            producerRegion: producerRegion.trim() || undefined,
            farmerYears: farmerYears.trim() ? Number(farmerYears) : undefined,
          }
        : undefined

    const input: CopyInput = {
      category,
      productType: productName.trim(),
      variety: variety.trim() || undefined,
      origin: origin.trim(),
      weight: weight.trim(),
      price: priceNum,
      brix: brix.trim() ? Number(brix) : undefined,
      avgWeightG: avgWeightG.trim() ? Number(avgWeightG) : undefined,
      sizeGrade: sizeGrade.trim() || undefined,
      farmIntro: farmIntro.trim() || undefined,
      trust: trustData,
      highlightKeywords: allKeywords,
      recommendBadge: undefined,
      tone: "sincere",
      isOrdinaryProduce,
    }

    try {
      const res = await getAIProvider().generateCopy(input)
      setResult(res.output)
      setCurrentInput(input)
      setResultMeta({
        priceNum,
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

      {/* 일반 농산물 게이트 — 식약처 §10 자율심의 대상 차단 (v1.8) */}
      <section
        style={{
          padding: "12px 14px",
          marginBottom: 20,
          background: isOrdinaryProduce
            ? "var(--color-bg-subtle)"
            : "var(--color-danger-tint)",
          border: `1px solid ${isOrdinaryProduce ? "var(--color-neutral-300)" : "var(--color-danger)"}`,
          borderRadius: "var(--radius-xs)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isOrdinaryProduce}
            onChange={(e) => setIsOrdinaryProduce(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span style={{ color: "var(--color-neutral-900)", lineHeight: 1.6 }}>
            <strong>이 상품은 일반 농산물입니다.</strong>
            <br />
            <span style={{ color: "var(--color-neutral-700)" }}>
              (건강기능식품·기능성표시식품·숙취해소 표시 상품 아님)
            </span>
          </span>
        </label>
        {!isOrdinaryProduce && (
          <p
            style={{
              marginTop: 8,
              padding: 8,
              background: "var(--color-bg-surface)",
              borderRadius: "var(--radius-xs)",
              color: "var(--color-danger)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            ⚠️ 건강기능식품·숙취해소 표시 상품은 식약처 §10 자율심의가 필요합니다. 본 사이트는 일반 농산물 카피만 안전하게 지원합니다.
          </p>
        )}
      </section>

      <Step number={1} title={t.detail.step1Image} hint={t.detail.step1Hint}>
        <ImageUploader images={images} onChange={setImages} />
      </Step>

      <Step number={2} title={t.detail.step2Basic}>
        <SeasonHint productName={productName} category={category} />
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
          </Field>
          <Field label={t.detail.field.priceRequired}>
            <input
              type="text"
              inputMode="numeric"
              value={price ? Number(price).toLocaleString("ko-KR") : ""}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))}
              placeholder={t.detail.field.pricePh}
              style={inputStyle}
            />
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
              onChange={(e) => setOrigin(e.target.value)}
              placeholder={t.detail.field.originPh}
              style={inputStyle}
            />
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
          <Field label="개당 평균 g (선택)">
            <input
              type="text"
              inputMode="numeric"
              value={avgWeightG}
              onChange={(e) => setAvgWeightG(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="예) 300"
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
          price={price.trim() ? Number(price) : undefined}
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
          price={price.trim() ? Number(price) : undefined}
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
      {!isWide && (
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

      <ResultView
        copy={liveCopy}
        images={images}
        productName={liveResultMeta.productName}
        price={liveResultMeta.priceNum}
        origin={liveResultMeta.origin}
        weight={liveResultMeta.weight}
        trust={currentInput?.trust ?? undefined}
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
