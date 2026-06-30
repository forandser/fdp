"use client"

import { useEffect, useRef, useState } from "react"
import { ImageUploader, type UploadedImage } from "./ImageUploader"
import { KeywordPicker } from "./KeywordPicker"
import { ResultView } from "./ResultView"
import { SeasonHint } from "./SeasonHint"
import { SellingPointsSuggester } from "./SellingPointsSuggester"
import { TrustEditor } from "./TrustEditor"
import { getAIProvider } from "@/lib/ai/provider"
import type {
  CopyInput,
  CopyOutput,
  CopyTone,
  ProductCategory,
  RecommendBadge,
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

const TONE_OPTIONS: { value: CopyTone; label: string }[] = [
  { value: "sincere", label: t.detail.tone.sincere },
  { value: "friendly", label: t.detail.tone.friendly },
  { value: "premium", label: t.detail.tone.premium },
]

const BADGE_OPTIONS: { value: RecommendBadge | "none"; label: string }[] = [
  { value: "none", label: t.detail.badge.none },
  { value: "top", label: t.detail.badge.top },
  { value: "best", label: t.detail.badge.best },
  { value: "new", label: t.detail.badge.new },
]

function hasTrust(t: TrustInfo): boolean {
  return !!(
    t.sameDayHarvest ||
    t.coldChain ||
    t.directFromFarm ||
    t.refundGuarantee ||
    t.gapNumber?.trim() ||
    t.organicNumber?.trim() ||
    t.pesticideFreeNumber?.trim() ||
    t.harvestDateLabel?.trim()
  )
}

const GENERATION_STEPS = [
  "이미지를 분석하고 있어요",
  "한국 신선식품 카피라이팅 패턴 적용 중",
  "헤드라인·스토리·스펙·FAQ 구성 중",
  "마무리 검토 중",
]

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
  const [extraDescription, setExtraDescription] = useState("")
  const [farmIntro, setFarmIntro] = useState("")
  const [presetKeywords, setPresetKeywords] = useState<string[]>([])
  const [customKeywords, setCustomKeywords] = useState<string[]>([])
  const [tone, setTone] = useState<CopyTone>("sincere")
  const [badge, setBadge] = useState<RecommendBadge | "none">("none")
  const [trust, setTrust] = useState<TrustInfo>({})
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
        setTone(input.tone ?? "sincere")
        setBadge(input.recommendBadge ?? "none")
        setTrust(input.trust ?? {})
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

  const hasMin = images.length >= 1 && productName.trim() && price.trim()

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

    const input: CopyInput = {
      category,
      productType: productName.trim(),
      variety: variety.trim() || undefined,
      origin: origin.trim(),
      weight: weight.trim(),
      price: priceNum,
      brix: brix.trim() ? Number(brix) : undefined,
      farmIntro: farmIntro.trim() || undefined,
      trust: hasTrust(trust) ? trust : undefined,
      highlightKeywords: allKeywords,
      recommendBadge: badge === "none" ? undefined : badge,
      tone,
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

  if (stage === "result" && result && resultMeta) {
    return (
      <div style={{ padding: "var(--space-7)", maxWidth: 1320, margin: "0 auto" }}>
        <ResultView
          copy={result}
          images={images}
          productName={resultMeta.productName}
          price={resultMeta.priceNum}
          origin={resultMeta.origin}
          weight={resultMeta.weight}
          trust={currentInput?.trust}
          onCopyChange={handleCopyChange}
          onSectionRegenerate={handleSectionRegenerate}
          busySection={busySection}
          onRetry={() => {
            setStage("input")
            setResult(null)
            setCurrentInput(null)
            setWorkId(null)
          }}
        />
      </div>
    )
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

  if (stage === "generating") {
    return (
      <GeneratingView step={generationStep} totalSteps={GENERATION_STEPS.length} />
    )
  }

  return (
    <div
      style={{
        maxWidth: 720,
        margin: "0 auto",
        padding: "var(--space-10) var(--space-5)",
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
        </FormGrid>
      </Step>

      <Step number={3} title={t.detail.step3Keywords}>
        <KeywordPicker
          selected={presetKeywords}
          onChange={setPresetKeywords}
          customKeywords={customKeywords}
          onCustomChange={setCustomKeywords}
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
        <SellingPointsSuggester
          category={category}
          productName={productName}
          variety={variety}
          origin={origin}
          weight={weight}
          brix={brix.trim() ? Number(brix) : undefined}
          price={price.trim() ? Number(price) : undefined}
          tone={tone}
          trust={trust}
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

      <Step number={5} title={t.detail.step5Trust} hint={t.detail.step5TrustHint}>
        <TrustEditor value={trust} onChange={setTrust} />
      </Step>

      <Step number={6} title={t.detail.step5Tone}>
        <FormGrid>
          <Field label={t.detail.badgeLabel}>
            <select
              value={badge}
              onChange={(e) => setBadge(e.target.value as RecommendBadge | "none")}
              style={inputStyle}
            >
              {BADGE_OPTIONS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.detail.toneLabel}>
            <select
              value={tone}
              onChange={(e) => setTone(e.target.value as CopyTone)}
              style={inputStyle}
            >
              {TONE_OPTIONS.map((to) => (
                <option key={to.value} value={to.value}>
                  {to.label}
                </option>
              ))}
            </select>
          </Field>
        </FormGrid>
      </Step>

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

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!hasMin}
        style={{
          width: "100%",
          padding: "16px 18px",
          background: hasMin
            ? "var(--color-primary-600)"
            : "var(--color-neutral-300)",
          color: "var(--color-text-on-primary)",
          border: "none",
          borderRadius: "var(--radius-xs)",
          fontSize: 18,
          fontWeight: 700,
          cursor: hasMin ? "pointer" : "not-allowed",
        }}
      >
        ✨ {t.detail.submit}
      </button>
    </div>
  )
}

function GeneratingView({ step, totalSteps }: { step: number; totalSteps: number }) {
  return (
    <div
      style={{
        minHeight: "70vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        padding: 32,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
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
          fontSize: "var(--font-size-xl)",
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
          fontSize: "var(--font-size-md)",
          color: "var(--color-neutral-500)",
          minWidth: 280,
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
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
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
