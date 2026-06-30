"use client"

/**
 * 썸네일 메이커 v1.5.
 *
 * 리서치 결과 (2026-06-30):
 *  - 쿠팡(2025년 5월~): 광고 썸네일에 텍스트/배지/할인표기 전면 금지.
 *    → "쿠팡 안전 모드"는 텍스트 오버레이 비활성화 + 흰 배경 + 1:1.
 *  - 스마트스토어 대표이미지: 텍스트 부가요소 없는 클린 컷.
 *  - 스마트스토어 서브/상세 + 마켓컬리/오아시스: 한 줄 카피 허용.
 *
 * v1.5 추가:
 *  - AI 사진 합성 (Gemini Flash Image / BYOK 키)
 *  - 배경 흰색으로 (provider.removeBackground 또는 generate fallback)
 *  - 텍스트 미세 조정 (폰트 크기·offsetX/Y 슬라이더)
 *  - 가격 표시 옵션 (선택)
 *
 * 출력:
 *  - 1:1 1000×1000 또는 4:5 1000×1250
 *  - html-to-image로 JPG 다운로드 (단일 한 장)
 */

import { useRef, useState } from "react"
import { toJpeg } from "html-to-image"
import type { UploadedImage } from "@/features/detail/ImageUploader"
import { ImageUploader } from "@/features/detail/ImageUploader"
import { t } from "@/lib/i18n"
import { getImageProvider } from "@/lib/ai/image-providers/registry"

type Mode = "free" | "coupang"
type Ratio = "1:1" | "4:5"
type Position = "top" | "middle" | "bottom"
type PricePos = "br" | "tl"
type Stamp = "none" | "freshDirect" | "sameDay" | "domestic" | "new" | "best"
type Theme =
  | "redOnWhite"
  | "whiteOnDark"
  | "blackOnWhite"
  | "yellowPunch"
  | "freshGreen"
  | "premiumGold"

const THEME_PRESETS: Record<
  Theme,
  { bg: string; fg: string; accent: string; overlay: string }
> = {
  redOnWhite: { bg: "#FFFFFF", fg: "#212529", accent: "#E03131", overlay: "rgba(255,255,255,0.92)" },
  whiteOnDark: { bg: "#212529", fg: "#FFFFFF", accent: "#FAB005", overlay: "rgba(0,0,0,0.45)" },
  blackOnWhite: { bg: "#FFFFFF", fg: "#212529", accent: "#212529", overlay: "rgba(255,255,255,0.94)" },
  yellowPunch: { bg: "#FFE066", fg: "#212529", accent: "#E03131", overlay: "rgba(255,224,102,0.85)" },
  freshGreen: { bg: "#F1F8E9", fg: "#1B5E20", accent: "#388E3C", overlay: "rgba(241,248,233,0.9)" },
  premiumGold: { bg: "#1B1B1B", fg: "#FFFFFF", accent: "#D4AF37", overlay: "rgba(0,0,0,0.55)" },
}

/** dataURL → File (썸네일 이미지 교체용) */
async function dataUrlToUploadedImage(dataUrl: string): Promise<UploadedImage | null> {
  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const file = new File([blob], `ai-${Date.now()}.png`, { type: blob.type || "image/png" })
    const url = URL.createObjectURL(file)
    const meta = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const img = new window.Image()
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
      img.onerror = () => reject(new Error("image load failed"))
      img.src = url
    })
    return {
      id: `ai-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      file,
      url,
      width: meta.width,
      height: meta.height,
    }
  } catch (e) {
    console.error("[dataUrlToUploadedImage]", e)
    return null
  }
}

export function ThumbnailMaker() {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [mode, setMode] = useState<Mode>("free")
  const [ratio, setRatio] = useState<Ratio>("1:1")
  const [headline, setHeadline] = useState("")
  const [sub, setSub] = useState("")
  const [position, setPosition] = useState<Position>("bottom")
  const [theme, setTheme] = useState<Theme>("redOnWhite")
  const [stamp, setStamp] = useState<Stamp>("none")
  const [downloading, setDownloading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // v1.5: 텍스트 미세 조정
  const [fontSize, setFontSize] = useState(72)
  const [subFontSize, setSubFontSize] = useState(32)
  const [offsetX, setOffsetX] = useState(0) // -40 ~ 40 (%)
  const [offsetY, setOffsetY] = useState(0) // -30 ~ 30 (%)

  // v1.5: 가격 표시
  const [priceStr, setPriceStr] = useState("")
  const [pricePos, setPricePos] = useState<PricePos>("br")

  // v1.5: AI 합성
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState("")
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState<string | null>(null)

  // v1.5: 배경 제거
  const [bgBusy, setBgBusy] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)

  const image = images[0]
  const canDownload = !!image

  const ratioDims = ratio === "1:1" ? { w: 1000, h: 1000 } : { w: 1000, h: 1250 }
  const previewScale = 0.42
  const previewW = Math.round(ratioDims.w * previewScale)
  const previewH = Math.round(ratioDims.h * previewScale)

  const isCoupang = mode === "coupang"
  const themePreset = THEME_PRESETS[theme]

  const formattedPrice = priceStr
    ? `₩${Number(priceStr.replace(/[^\d]/g, "") || "0").toLocaleString("ko-KR")}`
    : ""

  const handleDownload = async () => {
    if (!canvasRef.current || !canDownload) return
    setDownloading(true)
    setErrorMsg(null)
    try {
      const dataUrl = await toJpeg(canvasRef.current, {
        quality: 0.92,
        pixelRatio: 1 / previewScale,
        backgroundColor: themePreset.bg,
      })
      const safeName = (headline || "thumbnail")
        .replace(/[^\p{L}\p{N}_-]+/gu, "_")
        .slice(0, 40)
      const a = document.createElement("a")
      a.href = dataUrl
      a.download = `${safeName}_${ratioDims.w}x${ratioDims.h}.jpg`
      a.click()
    } catch (e) {
      console.error("[thumbnailDownload]", e)
      setErrorMsg(t.thumbnail.errors.failed)
    } finally {
      setDownloading(false)
    }
  }

  /** AI 합성: 참조 이미지가 있으면 합성, 없으면 텍스트→이미지 */
  const handleAiCompose = async () => {
    const prompt = aiPrompt.trim()
    if (!prompt) return
    setAiBusy(true)
    setAiMsg(null)
    try {
      const provider = await getImageProvider()
      if (!provider) {
        setAiMsg(t.thumbnail.aiComposeMissing)
        return
      }
      const result = await provider.generate({
        prompt,
        referenceImage: image?.file,
        ratio,
      })
      const newImg = await dataUrlToUploadedImage(result.dataUrl)
      if (!newImg) {
        setAiMsg(t.thumbnail.errors.failed)
        return
      }
      // 참조 이미지가 있으면 교체, 없으면 추가
      if (image) {
        URL.revokeObjectURL(image.url)
        setImages([newImg, ...images.slice(1)])
      } else {
        setImages([newImg])
      }
      setAiOpen(false)
      setAiPrompt("")
    } catch (e) {
      console.error("[aiCompose]", e)
      setAiMsg(e instanceof Error ? e.message : t.thumbnail.errors.failed)
    } finally {
      setAiBusy(false)
    }
  }

  /** 배경 흰색으로 — provider.removeBackground 우선, 없으면 generate fallback */
  const handleRemoveBg = async () => {
    if (!image) return
    setBgBusy(true)
    setErrorMsg(null)
    try {
      const provider = await getImageProvider()
      if (!provider) {
        setErrorMsg(t.thumbnail.aiComposeMissing)
        return
      }
      let dataUrl: string
      if (provider.removeBackground) {
        const result = await provider.removeBackground(image.file)
        dataUrl = result.dataUrl
      } else {
        // Gemini fallback — generate with white-bg replacement prompt
        const result = await provider.generate({
          prompt:
            "Replace the background with pure solid white (#FFFFFF). Keep the main subject exactly as-is, sharp, centered, product-photo style. No shadow on the background.",
          referenceImage: image.file,
          ratio,
        })
        dataUrl = result.dataUrl
      }
      const newImg = await dataUrlToUploadedImage(dataUrl)
      if (!newImg) {
        setErrorMsg(t.thumbnail.errors.failed)
        return
      }
      URL.revokeObjectURL(image.url)
      setImages([newImg, ...images.slice(1)])
    } catch (e) {
      console.error("[removeBg]", e)
      setErrorMsg(e instanceof Error ? e.message : t.thumbnail.errors.failed)
    } finally {
      setBgBusy(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: "var(--font-size-sm)",
    fontWeight: 600,
    color: "var(--color-neutral-900)",
    marginBottom: 6,
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

  return (
    <div
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "var(--space-7) var(--space-5)",
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 440px)",
        gap: 28,
        alignItems: "start",
      }}
    >
      {/* Left — Controls */}
      <div>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "var(--color-neutral-900)",
            margin: 0,
            marginBottom: 6,
          }}
        >
          {t.thumbnail.title}
        </h1>
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-neutral-500)",
            margin: 0,
            marginBottom: 20,
          }}
        >
          {t.thumbnail.subtitle}
        </p>

        <Section title={t.thumbnail.step1Image}>
          <ImageUploader images={images} onChange={setImages} maxCount={3} />

          {/* AI 합성 / 배경 제거 액션 */}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => setAiOpen((v) => !v)}
              style={ghostBtnStyle}
            >
              ✨ {t.thumbnail.aiCompose}
            </button>
            {images.length > 0 && (
              <button
                type="button"
                onClick={() => void handleRemoveBg()}
                disabled={bgBusy}
                style={{ ...ghostBtnStyle, opacity: bgBusy ? 0.6 : 1 }}
              >
                {bgBusy ? t.thumbnail.removingBg : `🧽 ${t.thumbnail.removeBg}`}
              </button>
            )}
          </div>

          {aiOpen && (
            <div
              style={{
                marginTop: 10,
                padding: 12,
                background: "var(--color-bg-subtle)",
                borderRadius: "var(--radius-xs)",
                border: "1px solid var(--color-neutral-100)",
              }}
            >
              <p
                style={{
                  fontSize: "var(--font-size-xs)",
                  color: "var(--color-neutral-500)",
                  margin: 0,
                  marginBottom: 6,
                  lineHeight: 1.5,
                }}
              >
                {t.thumbnail.aiComposeHint}
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={t.thumbnail.aiComposePh}
                rows={3}
                style={{ ...inputStyle, resize: "vertical" }}
              />
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  marginTop: 8,
                  alignItems: "center",
                }}
              >
                <button
                  type="button"
                  onClick={() => void handleAiCompose()}
                  disabled={aiBusy || !aiPrompt.trim()}
                  style={{
                    padding: "8px 14px",
                    background: "var(--color-primary-600)",
                    color: "var(--color-text-on-primary)",
                    border: "none",
                    borderRadius: "var(--radius-xs)",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: aiBusy ? "wait" : "pointer",
                    opacity: aiBusy || !aiPrompt.trim() ? 0.6 : 1,
                  }}
                >
                  {aiBusy ? t.thumbnail.aiComposing : "Generate (~53원)"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAiOpen(false)
                    setAiMsg(null)
                  }}
                  style={ghostBtnStyle}
                >
                  {t.common.cancel}
                </button>
              </div>
              {aiMsg && (
                <p
                  style={{
                    marginTop: 8,
                    fontSize: "var(--font-size-xs)",
                    color: "var(--color-danger)",
                  }}
                >
                  {aiMsg}
                </p>
              )}
            </div>
          )}
        </Section>

        <Section title={t.thumbnail.step2Mode} hint={t.thumbnail.modeHint}>
          <div style={{ display: "flex", gap: 10 }}>
            <ModeButton
              active={mode === "free"}
              title={t.thumbnail.mode.free}
              desc={t.thumbnail.mode.freeDesc}
              onClick={() => setMode("free")}
            />
            <ModeButton
              active={mode === "coupang"}
              title={t.thumbnail.mode.coupang}
              desc={t.thumbnail.mode.coupangDesc}
              onClick={() => setMode("coupang")}
            />
          </div>
          {isCoupang && (
            <p
              style={{
                marginTop: 10,
                padding: 10,
                background: "var(--color-bg-subtle)",
                borderRadius: "var(--radius-xs)",
                fontSize: "var(--font-size-xs)",
                color: "var(--color-neutral-700)",
                lineHeight: 1.5,
              }}
            >
              ℹ️ {t.thumbnail.coupangNotice}
            </p>
          )}
        </Section>

        <Section title={t.thumbnail.step3Ratio}>
          <div style={{ display: "flex", gap: 10 }}>
            <RatioButton
              active={ratio === "1:1"}
              label="1 : 1"
              hint="1000×1000"
              onClick={() => setRatio("1:1")}
            />
            <RatioButton
              active={ratio === "4:5"}
              label="4 : 5"
              hint="1000×1250"
              onClick={() => setRatio("4:5")}
            />
          </div>
        </Section>

        {!isCoupang && (
          <>
            <Section title={t.thumbnail.step4Headline}>
              <label style={labelStyle}>{t.thumbnail.field.headline}</label>
              <input
                type="text"
                value={headline}
                onChange={(e) => setHeadline(e.target.value.slice(0, 24))}
                placeholder={t.thumbnail.field.headlinePh}
                style={inputStyle}
                maxLength={24}
              />
              <p
                style={{
                  fontSize: "var(--font-size-xs)",
                  color: "var(--color-neutral-400)",
                  marginTop: 4,
                }}
              >
                {headline.length} / 24
              </p>

              <label style={{ ...labelStyle, marginTop: 12 }}>
                {t.thumbnail.field.sub}
              </label>
              <input
                type="text"
                value={sub}
                onChange={(e) => setSub(e.target.value.slice(0, 30))}
                placeholder={t.thumbnail.field.subPh}
                style={inputStyle}
                maxLength={30}
              />

              {/* v1.5: 텍스트 미세 조정 슬라이더 */}
              <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                <Slider
                  label={t.thumbnail.fontSize}
                  value={fontSize}
                  min={40}
                  max={120}
                  unit="px"
                  onChange={setFontSize}
                />
                <Slider
                  label={t.thumbnail.subFontSize}
                  value={subFontSize}
                  min={20}
                  max={60}
                  unit="px"
                  onChange={setSubFontSize}
                />
                <Slider
                  label={t.thumbnail.offsetX}
                  value={offsetX}
                  min={-40}
                  max={40}
                  unit="%"
                  onChange={setOffsetX}
                />
                <Slider
                  label={t.thumbnail.offsetY}
                  value={offsetY}
                  min={-30}
                  max={30}
                  unit="%"
                  onChange={setOffsetY}
                />
              </div>
            </Section>

            <Section title={t.thumbnail.step5Style}>
              <label style={labelStyle}>{t.thumbnail.field.position}</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                {(["top", "middle", "bottom"] as Position[]).map((p) => (
                  <ChipButton
                    key={p}
                    active={position === p}
                    onClick={() => setPosition(p)}
                  >
                    {t.thumbnail.position[p]}
                  </ChipButton>
                ))}
              </div>

              <label style={labelStyle}>{t.thumbnail.field.stamp}</label>
              <div
                style={{
                  display: "flex",
                  gap: 6,
                  flexWrap: "wrap",
                  marginBottom: 14,
                }}
              >
                {(
                  ["none", "freshDirect", "sameDay", "domestic", "new", "best"] as Stamp[]
                ).map((s) => (
                  <ChipButton key={s} active={stamp === s} onClick={() => setStamp(s)}>
                    {t.thumbnail.stamp[s]}
                  </ChipButton>
                ))}
              </div>

              <label style={labelStyle}>{t.thumbnail.field.theme}</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                {(
                  [
                    "redOnWhite",
                    "whiteOnDark",
                    "blackOnWhite",
                    "yellowPunch",
                    "freshGreen",
                    "premiumGold",
                  ] as Theme[]
                ).map((th) => (
                  <ChipButton
                    key={th}
                    active={theme === th}
                    onClick={() => setTheme(th)}
                  >
                    {t.thumbnail.theme[th]}
                  </ChipButton>
                ))}
              </div>

              {/* v1.5: 가격 표시 (선택) */}
              <label style={labelStyle}>가격 (선택)</label>
              <input
                type="text"
                inputMode="numeric"
                value={priceStr}
                onChange={(e) => setPriceStr(e.target.value.replace(/[^\d]/g, "").slice(0, 9))}
                placeholder="예) 29000"
                style={inputStyle}
              />
              {priceStr && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <ChipButton active={pricePos === "br"} onClick={() => setPricePos("br")}>
                    우하단
                  </ChipButton>
                  <ChipButton active={pricePos === "tl"} onClick={() => setPricePos("tl")}>
                    좌상단
                  </ChipButton>
                </div>
              )}
            </Section>
          </>
        )}

        {errorMsg && (
          <div
            style={{
              padding: 12,
              background: "var(--color-danger-tint)",
              border: "1px solid var(--color-danger)",
              borderRadius: "var(--radius-xs)",
              color: "var(--color-danger)",
              fontSize: "var(--font-size-sm)",
              marginBottom: 12,
            }}
          >
            ⚠️ {errorMsg}
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleDownload()}
          disabled={!canDownload || downloading}
          style={{
            width: "100%",
            padding: "14px 18px",
            background: canDownload
              ? "var(--color-primary-600)"
              : "var(--color-neutral-300)",
            color: "var(--color-text-on-primary)",
            border: "none",
            borderRadius: "var(--radius-xs)",
            fontSize: 16,
            fontWeight: 700,
            cursor: canDownload && !downloading ? "pointer" : "not-allowed",
          }}
        >
          {downloading ? t.thumbnail.downloading : `📥 ${t.thumbnail.download}`}
        </button>
      </div>

      {/* Right — Preview */}
      <aside
        style={{
          position: "sticky",
          top: 20,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
        }}
      >
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--color-neutral-500)",
          }}
        >
          {t.thumbnail.preview}
        </p>
        <div
          ref={canvasRef}
          style={{
            width: previewW,
            height: previewH,
            background: themePreset.bg,
            position: "relative",
            overflow: "hidden",
            boxShadow: "0 2px 10px rgba(0,0,0,0.15)",
            borderRadius: 4,
            fontFamily:
              'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
          }}
        >
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={image.url}
              alt=""
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <div
              style={{
                width: "100%",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--color-neutral-400)",
                fontSize: 14,
              }}
            >
              {t.thumbnail.previewEmpty}
            </div>
          )}

          {/* Text overlay (free mode only) */}
          {!isCoupang && (headline || sub) && image && (
            <Overlay
              headline={headline}
              sub={sub}
              position={position}
              theme={themePreset}
              scale={previewScale}
              headSizePx={fontSize}
              subSizePx={subFontSize}
              offsetXPct={offsetX}
              offsetYPct={offsetY}
            />
          )}

          {/* Stamp (free mode only) */}
          {!isCoupang && stamp !== "none" && image && (
            <StampMark stamp={stamp} scale={previewScale} />
          )}

          {/* Price tag (free mode only) */}
          {!isCoupang && formattedPrice && image && (
            <PriceTag
              text={formattedPrice}
              pos={pricePos}
              scale={previewScale}
              theme={themePreset}
            />
          )}
        </div>
        <p
          style={{
            fontSize: 11,
            color: "var(--color-neutral-400)",
            margin: 0,
          }}
        >
          {t.thumbnail.previewHint.replace("{w}", String(ratioDims.w)).replace("{h}", String(ratioDims.h))}
        </p>
      </aside>
    </div>
  )
}

function Overlay({
  headline,
  sub,
  position,
  theme,
  scale,
  headSizePx,
  subSizePx,
  offsetXPct,
  offsetYPct,
}: {
  headline: string
  sub: string
  position: Position
  theme: { bg: string; fg: string; accent: string; overlay: string }
  scale: number
  headSizePx?: number
  subSizePx?: number
  offsetXPct?: number
  offsetYPct?: number
}) {
  const padScaled = Math.round(60 * scale)
  const headSize = Math.round((headSizePx ?? 72) * scale)
  const subSize = Math.round((subSizePx ?? 32) * scale)
  const gap = Math.round(12 * scale)
  const ox = offsetXPct ?? 0
  const oy = offsetYPct ?? 0

  // Compose transform (offsetX/Y is % of container width/height respectively)
  const baseTransform =
    position === "middle" ? "translateY(-50%)" : ""
  const offsetTransform = `translate(${ox}%, ${oy}%)`
  const transform = [baseTransform, offsetTransform].filter(Boolean).join(" ")

  const align: React.CSSProperties =
    position === "top"
      ? { top: 0, paddingTop: padScaled }
      : position === "bottom"
        ? { bottom: 0, paddingBottom: padScaled }
        : { top: "50%" }

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        padding: `0 ${padScaled}px`,
        background:
          position === "middle"
            ? theme.overlay
            : `linear-gradient(${position === "top" ? "180deg" : "0deg"}, ${theme.overlay} 0%, rgba(0,0,0,0) 100%)`,
        ...align,
        transform,
        display: "flex",
        flexDirection: "column",
        gap,
      }}
    >
      {headline && (
        <p
          style={{
            margin: 0,
            color: theme.fg,
            fontSize: headSize,
            fontWeight: 900,
            lineHeight: 1.15,
            letterSpacing: -0.5,
            wordBreak: "keep-all",
          }}
        >
          {headline}
        </p>
      )}
      {sub && (
        <p
          style={{
            margin: 0,
            color: theme.accent,
            fontSize: subSize,
            fontWeight: 700,
            lineHeight: 1.3,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  )
}

function StampMark({ stamp, scale }: { stamp: Stamp; scale: number }) {
  const labels: Record<Exclude<Stamp, "none">, { lines: string[]; tint: string }> = {
    freshDirect: { lines: ["산지", "직송"], tint: "#E03131" },
    sameDay: { lines: ["당일", "수확"], tint: "#E03131" },
    domestic: { lines: ["100%", "국내산"], tint: "#1F3B2D" },
    new: { lines: ["NEW"], tint: "#E03131" },
    best: { lines: ["BEST"], tint: "#D4AF37" },
  }
  if (stamp === "none") return null
  const meta = labels[stamp]
  const size = Math.round(140 * scale)
  const borderW = Math.max(2, Math.round(4 * scale))
  const fontSize = Math.round((meta.lines.length === 1 ? 36 : 28) * scale)
  const right = Math.round(20 * scale)
  const top = Math.round(20 * scale)

  return (
    <div
      style={{
        position: "absolute",
        top,
        right,
        width: size,
        height: size,
        borderRadius: "50%",
        border: `${borderW}px solid ${meta.tint}`,
        color: meta.tint,
        background: "rgba(255,255,255,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        fontWeight: 900,
        fontSize,
        lineHeight: 1.05,
        transform: "rotate(-8deg)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        textAlign: "center",
      }}
      aria-hidden
    >
      {meta.lines.map((l, i) => (
        <span key={i}>{l}</span>
      ))}
    </div>
  )
}

function PriceTag({
  text,
  pos,
  scale,
  theme,
}: {
  text: string
  pos: PricePos
  scale: number
  theme: { bg: string; fg: string; accent: string; overlay: string }
}) {
  const padX = Math.round(20 * scale)
  const padY = Math.round(10 * scale)
  const fontSize = Math.round(40 * scale)
  const inset = Math.round(20 * scale)
  const corner: React.CSSProperties =
    pos === "br"
      ? { bottom: inset, right: inset }
      : { top: inset, left: inset }

  return (
    <div
      style={{
        position: "absolute",
        ...corner,
        padding: `${padY}px ${padX}px`,
        background: theme.accent,
        color: "#FFFFFF",
        fontSize,
        fontWeight: 900,
        borderRadius: Math.round(8 * scale),
        boxShadow: "0 2px 8px rgba(0,0,0,0.18)",
        letterSpacing: -0.3,
      }}
    >
      {text}
    </div>
  )
}

/* ─────────────── Small bits ─────────────── */

function Slider({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  onChange: (v: number) => void
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "var(--font-size-xs)",
          color: "var(--color-neutral-700)",
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span style={{ fontWeight: 600 }}>
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%" }}
      />
    </div>
  )
}

const ghostBtnStyle: React.CSSProperties = {
  padding: "8px 12px",
  background: "var(--color-bg-surface)",
  color: "var(--color-neutral-900)",
  border: "1px solid var(--color-neutral-300)",
  borderRadius: "var(--radius-xs)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginBottom: 22 }}>
      <h2
        style={{
          fontSize: "var(--font-size-md)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          margin: 0,
          marginBottom: 4,
        }}
      >
        {title}
      </h2>
      {hint && (
        <p
          style={{
            fontSize: "var(--font-size-xs)",
            color: "var(--color-neutral-500)",
            margin: 0,
            marginBottom: 10,
          }}
        >
          {hint}
        </p>
      )}
      <div
        style={{
          background: "var(--color-bg-surface)",
          borderRadius: "var(--radius-md)",
          padding: 16,
          border: "1px solid var(--color-neutral-100)",
        }}
      >
        {children}
      </div>
    </section>
  )
}

function ModeButton({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        textAlign: "left",
        padding: "12px 14px",
        border: active
          ? "2px solid var(--color-primary-600)"
          : "1px solid var(--color-neutral-300)",
        borderRadius: "var(--radius-xs)",
        background: active
          ? "var(--color-primary-50)"
          : "var(--color-bg-surface)",
        cursor: "pointer",
      }}
    >
      <div
        style={{
          fontSize: "var(--font-size-md)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 2,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-neutral-500)",
          lineHeight: 1.4,
        }}
      >
        {desc}
      </div>
    </button>
  )
}

function RatioButton({
  active,
  label,
  hint,
  onClick,
}: {
  active: boolean
  label: string
  hint: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "12px 14px",
        border: active
          ? "2px solid var(--color-primary-600)"
          : "1px solid var(--color-neutral-300)",
        borderRadius: "var(--radius-xs)",
        background: active
          ? "var(--color-primary-50)"
          : "var(--color-bg-surface)",
        cursor: "pointer",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--color-neutral-500)",
        }}
      >
        {hint}
      </div>
    </button>
  )
}

function ChipButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        border: active
          ? "1px solid var(--color-primary-600)"
          : "1px solid var(--color-neutral-300)",
        background: active ? "var(--color-primary-600)" : "var(--color-bg-surface)",
        color: active ? "var(--color-text-on-primary)" : "var(--color-neutral-900)",
        fontSize: "var(--font-size-sm)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  )
}
