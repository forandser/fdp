"use client"

import { useMemo, useRef, useState } from "react"
import { t } from "@/lib/i18n"
import type { CopyOutput, CopyKeyPoint, TrustInfo } from "@/lib/ai/types"
import type { SectionId } from "@/lib/ai/section-regenerate"
import type { UploadedImage } from "./ImageUploader"
import { ExportPanel } from "./ExportPanel"
import { EditableResultText } from "./EditableResultText"
import { RegenButton } from "./RegenButton"

/**
 * 결과 미리보기.
 * dolfarmer.com 레퍼런스 13건 분석 기반 — POINT형 헤더 → 큰 비주얼 헤드 →
 * 스토리/강조박스 → 상품 구성 → POINT 큰 카드 3개 → 보관 → FAQ → 배송/주의사항.
 *
 * - 폭은 모바일 420 / 데스크탑 860 (스마트스토어 표준).
 * - 컬러: 흰 배경 + 검정 텍스트 + 빨강(#E03131 계열) 포인트.
 */
interface ResultViewProps {
  copy: CopyOutput
  images: UploadedImage[]
  productName: string
  price: number
  origin?: string
  weight?: string
  trust?: TrustInfo
  onRetry: () => void
  onCopyChange: (next: CopyOutput) => void
  onSectionRegenerate?: (sectionId: SectionId) => Promise<void>
  busySection?: SectionId | null
}

type PreviewMode = "desktop" | "mobile"

const RED = "#E03131"
const RED_DARK = "#C92A2A"
const RED_TINT = "#FFF5F5"
const INK = "#212529"
const SUB = "#495057"
const MUTE = "#868E96"
const BG_SOFT = "#F8F9FA"
const LINE = "#E9ECEF"

export function ResultView({
  copy,
  images,
  productName,
  price,
  origin,
  weight,
  trust,
  onRetry,
  onCopyChange,
  onSectionRegenerate,
  busySection,
}: ResultViewProps) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop")
  const [enhance, setEnhance] = useState(true)
  const [copiedToast, setCopiedToast] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)
  const previewWidth = previewMode === "mobile" ? 420 : 860
  const isMobile = previewMode === "mobile"

  const heroImage = images[0]
  const galleryImages = images.slice(1)

  const keyPoints: CopyKeyPoint[] = useMemo(() => {
    if (copy.keyPoints && copy.keyPoints.length >= 1) return copy.keyPoints.slice(0, 3)
    return []
  }, [copy.keyPoints])

  const missing = useMemo(() => {
    const m: string[] = []
    if (!origin?.trim()) m.push(t.detail.result.missing.origin)
    if (!weight?.trim()) m.push(t.detail.result.missing.weight)
    return m
  }, [origin, weight])

  const sanitizedName =
    productName.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "detail"

  const renderRegen = (sectionId: SectionId) => {
    if (!onSectionRegenerate) return null
    return (
      <RegenButton
        sectionId={sectionId}
        onRegenerate={onSectionRegenerate}
        disabled={busySection != null && busySection !== sectionId}
        alwaysVisible
      />
    )
  }

  // POINT 큰 카드용 이미지 매핑: 갤러리 이미지를 순환 배치
  const pointImageFor = (idx: number): UploadedImage | undefined => {
    if (images.length === 0) return undefined
    return images[(idx + 1) % images.length] || heroImage
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 340px)",
        gap: 24,
        alignItems: "start",
      }}
    >
      <div>
        {/* Preview toggle */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            marginBottom: 8,
          }}
        >
          <PreviewToggle
            active={previewMode === "desktop"}
            label={t.detail.result.previewDesktop}
            onClick={() => setPreviewMode("desktop")}
          />
          <PreviewToggle
            active={previewMode === "mobile"}
            label={t.detail.result.previewMobile}
            onClick={() => setPreviewMode("mobile")}
          />
        </div>

        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: MUTE,
            marginBottom: 14,
          }}
        >
          {t.detail.result.inlineEdit.hint}
        </p>

        <div style={{ display: "flex", justifyContent: "center", width: "100%" }}>
          <div
            ref={captureRef}
            className={`fdp-print ${enhance ? "fdp-photo-enhance" : ""}`}
            style={{
              width: previewWidth,
              maxWidth: "100%",
              background: "#FFFFFF",
              borderRadius: 12,
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              transition: "width 0.2s",
              overflow: "hidden",
              color: INK,
              fontFamily:
                'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
            }}
          >
            {/* 1. WHY HEADER + Compact POINT cards */}
            <WhyHeader
              productName={productName}
              keyPoints={keyPoints}
              copy={copy}
              onCopyChange={onCopyChange}
              isMobile={isMobile}
            />

            {/* 1a. TRUST BADGES */}
            {trust && <TrustBadgesRow trust={trust} />}

            {/* 2. HERO + HEADLINE BIG TITLE */}
            <HeroBlock
              heroImage={heroImage}
              copy={copy}
              onCopyChange={onCopyChange}
              onRegenHeadline={renderRegen("headline")}
              onRegenSub={renderRegen("subheadline")}
              isMobile={isMobile}
            />

            {/* 3. STORY + HIGHLIGHT BOX */}
            <StoryBlock
              copy={copy}
              onCopyChange={onCopyChange}
              onRegen={renderRegen("story")}
              isMobile={isMobile}
            />

            {/* 3a. RECOMMEND FOR */}
            {copy.recommendFor && copy.recommendFor.length > 0 && (
              <RecommendForBlock items={copy.recommendFor} isMobile={isMobile} />
            )}

            {/* 4. GALLERY (2x2) */}
            {galleryImages.length > 0 && (
              <GalleryBlock images={galleryImages} productName={productName} />
            )}

            {/* 5. SPEC + PRICE */}
            <SpecBlock
              copy={copy}
              onCopyChange={onCopyChange}
              onRegen={renderRegen("spec")}
              price={price}
              isMobile={isMobile}
            />

            {/* 6. POINT BIG CARDS */}
            {keyPoints.length > 0 && (
              <KeyPointsBig
                points={keyPoints}
                copy={copy}
                onCopyChange={onCopyChange}
                pointImageFor={pointImageFor}
                isMobile={isMobile}
              />
            )}

            {/* 6a. FARM STORY */}
            {copy.farmStory && (
              <FarmStoryBlock farmStory={copy.farmStory} isMobile={isMobile} />
            )}

            {/* 7. STORAGE */}
            {copy.storage && (
              <StorageBlock
                copy={copy}
                onCopyChange={onCopyChange}
                onRegen={renderRegen("storage")}
                isMobile={isMobile}
              />
            )}

            {/* 8. FAQ */}
            {copy.faq.length > 0 && (
              <FaqBlock
                copy={copy}
                onCopyChange={onCopyChange}
                onRegen={renderRegen("faq")}
                isMobile={isMobile}
              />
            )}

            {/* 9. DELIVERY (정형) */}
            <DeliveryBlock isMobile={isMobile} />

            {/* 9a. RETURNS (정형) */}
            <ReturnsBlock isMobile={isMobile} />

            {/* 10. CAUTIONS */}
            {copy.cautions && copy.cautions.length > 0 && (
              <CautionsBlock cautions={copy.cautions} isMobile={isMobile} />
            )}
          </div>
        </div>
      </div>

      {/* Side panel */}
      <aside
        className="fdp-no-print"
        style={{
          position: "sticky",
          top: 20,
          background: "var(--color-bg-surface)",
          borderRadius: 12,
          padding: 24,
          boxShadow: "var(--shadow-card)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <h3
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: "var(--color-neutral-900)",
            margin: 0,
          }}
        >
          {t.detail.result.title}
        </h3>

        {missing.length > 0 && (
          <div
            style={{
              padding: 10,
              background: "var(--color-danger-tint)",
              border: "1px solid var(--color-danger)",
              borderRadius: 6,
              color: "var(--color-danger)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            ⚠️ {t.detail.result.missingRequired}
            <br />
            <strong>{missing.join(", ")}</strong>
            <br />
            <span style={{ color: "var(--color-neutral-700)" }}>
              이 항목이 없으면 플랫폼에서 미노출 처리될 수 있어요.
            </span>
          </div>
        )}

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px",
            background: "var(--color-bg-subtle)",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            color: "var(--color-neutral-700)",
          }}
        >
          <input
            type="checkbox"
            checked={enhance}
            onChange={(e) => setEnhance(e.target.checked)}
            style={{ accentColor: RED }}
          />
          {t.detail.result.enhanceLabel}
        </label>

        <ExportPanel targetRef={captureRef} baseName={sanitizedName} />

        <ActionButton
          onClick={() => {
            const txt = buildPlainCopy(copy)
            if (typeof navigator !== "undefined" && navigator.clipboard) {
              void navigator.clipboard.writeText(txt).then(() => {
                setCopiedToast(true)
                setTimeout(() => setCopiedToast(false), 1800)
              })
            }
          }}
        >
          📋 {copiedToast ? t.detail.result.copiedToast : t.detail.result.copyText}
        </ActionButton>

        <ActionButton
          onClick={() => {
            if (typeof window !== "undefined") window.print()
          }}
        >
          🖨️ {t.detail.result.print}
        </ActionButton>

        <ActionButton onClick={onRetry}>{t.detail.result.retry}</ActionButton>
      </aside>
    </div>
  )
}

/* ============================================================ */
/* Section blocks                                                */
/* ============================================================ */

function WhyHeader({
  productName,
  keyPoints,
  copy,
  onCopyChange,
  isMobile,
}: {
  productName: string
  keyPoints: CopyKeyPoint[]
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  isMobile: boolean
}) {
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px 24px" : "44px 40px 32px",
        background: "#FFFFFF",
        borderBottom: `1px solid ${LINE}`,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: RED,
            color: "#FFF",
            fontSize: 18,
            fontWeight: 700,
            marginBottom: 16,
          }}
          aria-hidden
        >
          ✓
        </div>
        <h2
          style={{
            fontSize: isMobile ? 22 : 28,
            fontWeight: 800,
            margin: 0,
            lineHeight: 1.35,
            color: INK,
          }}
        >
          {productName} <span style={{ color: RED }}>{t.detail.result.whatsDifferentTitle}</span>
        </h2>
        <p
          style={{
            fontSize: isMobile ? 13 : 15,
            color: SUB,
            marginTop: 8,
            margin: 0,
          }}
        >
          {t.detail.result.whatsDifferentHint}
        </p>
      </div>

      {keyPoints.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {keyPoints.map((p, i) => (
            <div
              key={`kp-compact-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: isMobile ? "12px 14px" : "14px 20px",
                background: BG_SOFT,
                borderRadius: 999,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 56,
                  padding: "6px 10px",
                  background: RED,
                  color: "#FFF",
                  borderRadius: 999,
                  fontSize: isMobile ? 11 : 12,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                }}
              >
                Point {p.num}
              </span>
              <span
                style={{
                  fontSize: isMobile ? 14 : 16,
                  fontWeight: 600,
                  color: INK,
                  lineHeight: 1.4,
                }}
              >
                <EditableResultText
                  copy={copy}
                  onChange={onCopyChange}
                  path={["keyPoints", i, "title"]}
                  maxLength={40}
                />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function HeroBlock({
  heroImage,
  copy,
  onCopyChange,
  onRegenHeadline,
  onRegenSub,
  isMobile,
}: {
  heroImage?: UploadedImage
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  onRegenHeadline: React.ReactNode
  onRegenSub: React.ReactNode
  isMobile: boolean
}) {
  return (
    <div style={{ background: "#FFFFFF" }}>
      {heroImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={heroImage.url}
          alt=""
          style={{
            width: "100%",
            aspectRatio: "1",
            objectFit: "cover",
            display: "block",
          }}
        />
      )}
      <div
        style={{
          padding: isMobile ? "28px 20px" : "44px 40px",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 14 : 17,
            color: SUB,
            margin: 0,
            marginBottom: 10,
            lineHeight: 1.5,
          }}
        >
          <EditableResultText
            copy={copy}
            onChange={onCopyChange}
            path={["subheadline"]}
            maxLength={60}
          />
        </p>
        <h1
          style={{
            fontSize: isMobile ? 34 : 48,
            fontWeight: 800,
            margin: 0,
            color: INK,
            lineHeight: 1.2,
            letterSpacing: -0.5,
          }}
        >
          <EditableResultText
            copy={copy}
            onChange={onCopyChange}
            path={["headline"]}
            maxLength={40}
          />
        </h1>

        {(onRegenHeadline || onRegenSub) && (
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "center",
              marginTop: 16,
            }}
          >
            {onRegenSub}
            {onRegenHeadline}
          </div>
        )}

        {copy.highlightBadges.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              justifyContent: "center",
              marginTop: 18,
            }}
          >
            {copy.highlightBadges.slice(0, 4).map((b, i) => (
              <span
                key={`b-${i}`}
                style={{
                  padding: "5px 12px",
                  borderRadius: 999,
                  background: RED_TINT,
                  color: RED_DARK,
                  fontSize: isMobile ? 11 : 12,
                  fontWeight: 700,
                }}
              >
                #{b}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StoryBlock({
  copy,
  onCopyChange,
  onRegen,
  isMobile,
}: {
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  onRegen: React.ReactNode
  isMobile: boolean
}) {
  if (!copy.story && !copy.highlightBox) return null
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px" : "48px 40px",
        background: "#FFFFFF",
      }}
    >
      {copy.story && (
        <p
          style={{
            fontSize: isMobile ? 15 : 17,
            color: INK,
            lineHeight: 1.85,
            whiteSpace: "pre-line",
            margin: 0,
            textAlign: "center",
          }}
        >
          <EditableResultText
            copy={copy}
            onChange={onCopyChange}
            path={["story"]}
            multiline
            maxLength={1000}
            preserveWhitespace
          />
        </p>
      )}

      {copy.highlightBox && (
        <div
          style={{
            marginTop: 28,
            padding: isMobile ? "18px 16px" : "24px 24px",
            background: RED_TINT,
            border: `2px solid ${RED}`,
            borderRadius: 12,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: isMobile ? 17 : 22,
              fontWeight: 800,
              color: RED_DARK,
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            <EditableResultText
              copy={copy}
              onChange={onCopyChange}
              path={["highlightBox"]}
              maxLength={60}
            />
          </p>
        </div>
      )}

      {onRegen && (
        <div style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          {onRegen}
        </div>
      )}
    </div>
  )
}

function GalleryBlock({
  images,
  productName,
}: {
  images: UploadedImage[]
  productName: string
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: images.length === 1 ? "1fr" : "repeat(2, 1fr)",
        gap: 2,
        background: LINE,
      }}
    >
      {images.slice(0, 4).map((img, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={img.id}
          src={img.url}
          alt={`${productName} ${i + 2}`}
          style={{
            width: "100%",
            aspectRatio: "1",
            objectFit: "cover",
            display: "block",
          }}
        />
      ))}
    </div>
  )
}

function SpecBlock({
  copy,
  onCopyChange,
  onRegen,
  price,
  isMobile,
}: {
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  onRegen: React.ReactNode
  price: number
  isMobile: boolean
}) {
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px" : "48px 40px",
        background: BG_SOFT,
      }}
    >
      <SectionTitle title={t.detail.result.spec} regen={onRegen} />

      {/* Price card */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          background: "#FFFFFF",
          borderRadius: 10,
          marginBottom: 14,
          border: `1px solid ${LINE}`,
        }}
      >
        <span style={{ fontSize: 14, color: SUB }}>{t.detail.result.priceLabel}</span>
        <span style={{ fontSize: isMobile ? 22 : 26, fontWeight: 800, color: RED }}>
          ₩{price.toLocaleString("ko-KR")}
        </span>
      </div>

      {copy.spec.length > 0 && (
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 10,
            overflow: "hidden",
            border: `1px solid ${LINE}`,
          }}
        >
          {copy.spec.map((s, i) => (
            <div
              key={`spec-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "90px 1fr" : "120px 1fr",
                borderBottom: i < copy.spec.length - 1 ? `1px solid ${LINE}` : "none",
              }}
            >
              <div
                style={{
                  padding: "14px 16px",
                  background: BG_SOFT,
                  fontSize: 13,
                  fontWeight: 600,
                  color: SUB,
                }}
              >
                {s.label}
              </div>
              <div
                style={{
                  padding: "14px 16px",
                  fontSize: 14,
                  color: INK,
                }}
              >
                <EditableResultText
                  copy={copy}
                  onChange={onCopyChange}
                  path={["spec", i, "value"]}
                  maxLength={100}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function KeyPointsBig({
  points,
  copy,
  onCopyChange,
  pointImageFor,
  isMobile,
}: {
  points: CopyKeyPoint[]
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  pointImageFor: (idx: number) => UploadedImage | undefined
  isMobile: boolean
}) {
  return (
    <div style={{ background: "#FFFFFF" }}>
      <div
        style={{
          padding: isMobile ? "44px 20px 24px" : "60px 40px 32px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-block",
            fontSize: isMobile ? 13 : 14,
            fontWeight: 700,
            letterSpacing: 2,
            color: MUTE,
            marginBottom: 8,
          }}
        >
          WHY
        </div>
        <h2
          style={{
            fontSize: isMobile ? 26 : 36,
            fontWeight: 800,
            margin: 0,
            color: INK,
            lineHeight: 1.3,
          }}
        >
          {t.detail.result.keyPointsSectionTitle}
        </h2>
      </div>

      {points.map((p, i) => {
        const img = pointImageFor(i)
        return (
          <div
            key={`kp-big-${i}`}
            style={{
              padding: isMobile ? "20px 20px 40px" : "32px 40px 56px",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                alignItems: "baseline",
                gap: 8,
                padding: "6px 14px",
                background: RED,
                color: "#FFF",
                borderRadius: 999,
                fontSize: isMobile ? 12 : 13,
                fontWeight: 700,
                letterSpacing: 1,
                marginBottom: 14,
              }}
            >
              POINT {p.num}
            </div>
            <h3
              style={{
                fontSize: isMobile ? 24 : 32,
                fontWeight: 800,
                margin: 0,
                marginBottom: 14,
                color: INK,
                lineHeight: 1.3,
              }}
            >
              <EditableResultText
                copy={copy}
                onChange={onCopyChange}
                path={["keyPoints", i, "title"]}
                maxLength={40}
              />
            </h3>
            <p
              style={{
                fontSize: isMobile ? 14 : 16,
                color: SUB,
                lineHeight: 1.8,
                margin: 0,
                marginBottom: 20,
                whiteSpace: "pre-line",
              }}
            >
              <EditableResultText
                copy={copy}
                onChange={onCopyChange}
                path={["keyPoints", i, "body"]}
                multiline
                maxLength={300}
                preserveWhitespace
              />
            </p>
            {img && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.url}
                alt=""
                style={{
                  width: "100%",
                  aspectRatio: "4/3",
                  objectFit: "cover",
                  borderRadius: 10,
                  display: "block",
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function StorageBlock({
  copy,
  onCopyChange,
  onRegen,
  isMobile,
}: {
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  onRegen: React.ReactNode
  isMobile: boolean
}) {
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px" : "48px 40px",
        background: BG_SOFT,
      }}
    >
      <SectionTitle title={t.detail.result.storage} regen={onRegen} />
      <div
        style={{
          padding: isMobile ? "18px 18px" : "24px 28px",
          background: "#FFFFFF",
          borderRadius: 10,
          border: `1px solid ${LINE}`,
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 14 : 15,
            color: INK,
            lineHeight: 1.8,
            whiteSpace: "pre-line",
            margin: 0,
          }}
        >
          <EditableResultText
            copy={copy}
            onChange={onCopyChange}
            path={["storage"]}
            multiline
            maxLength={500}
            preserveWhitespace
          />
        </p>
      </div>
    </div>
  )
}

function FaqBlock({
  copy,
  onCopyChange,
  onRegen,
  isMobile,
}: {
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  onRegen: React.ReactNode
  isMobile: boolean
}) {
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px" : "48px 40px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.faq} regen={onRegen} />
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 10,
          border: `1px solid ${LINE}`,
          overflow: "hidden",
        }}
      >
        {copy.faq.map((_f, i) => (
          <div
            key={`faq-${i}`}
            style={{
              padding: isMobile ? "16px 18px" : "20px 24px",
              borderBottom: i < copy.faq.length - 1 ? `1px solid ${LINE}` : "none",
            }}
          >
            <p
              style={{
                fontSize: isMobile ? 14 : 15,
                fontWeight: 700,
                color: INK,
                margin: 0,
                marginBottom: 8,
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: RED, marginRight: 6 }}>Q.</span>
              <EditableResultText
                copy={copy}
                onChange={onCopyChange}
                path={["faq", i, "q"]}
                maxLength={100}
              />
            </p>
            <p
              style={{
                fontSize: isMobile ? 13 : 14,
                color: SUB,
                lineHeight: 1.7,
                margin: 0,
              }}
            >
              <span style={{ color: MUTE, marginRight: 6, fontWeight: 700 }}>A.</span>
              <EditableResultText
                copy={copy}
                onChange={onCopyChange}
                path={["faq", i, "a"]}
                multiline
                maxLength={500}
                preserveWhitespace
              />
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function DeliveryBlock({ isMobile }: { isMobile: boolean }) {
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px" : "48px 40px",
        background: BG_SOFT,
      }}
    >
      <SectionTitle title={t.detail.result.deliveryTitle} />
      <div
        style={{
          padding: isMobile ? "18px 18px" : "24px 28px",
          background: "#FFFFFF",
          borderRadius: 10,
          border: `1px solid ${LINE}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: RED_TINT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              flexShrink: 0,
            }}
            aria-hidden
          >
            📦
          </div>
          <p
            style={{
              fontSize: isMobile ? 14 : 15,
              color: INK,
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            {t.detail.result.deliveryBody}
          </p>
        </div>
      </div>
    </div>
  )
}

function TrustBadgesRow({ trust }: { trust: TrustInfo }) {
  const items: { icon: string; label: string }[] = []
  if (trust.sameDayHarvest) items.push({ icon: "🌅", label: "당일 수확·발송" })
  if (trust.coldChain) items.push({ icon: "❄️", label: "콜드체인 배송" })
  if (trust.directFromFarm) items.push({ icon: "🚜", label: "산지 직거래" })
  if (trust.refundGuarantee) items.push({ icon: "🛡️", label: "환불 보장" })
  if (trust.gapNumber?.trim()) items.push({ icon: "✅", label: "GAP 인증" })
  if (trust.organicNumber?.trim()) items.push({ icon: "🌿", label: "친환경 인증" })
  if (trust.pesticideFreeNumber?.trim()) items.push({ icon: "🍃", label: "무농약 인증" })
  if (trust.harvestDateLabel?.trim())
    items.push({ icon: "📅", label: `수확 ${trust.harvestDateLabel.trim()}` })

  if (items.length === 0) return null

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "14px 20px 18px",
        justifyContent: "center",
        borderBottom: `1px solid ${LINE}`,
      }}
    >
      {items.map((it, i) => (
        <span
          key={`tb-${i}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 10px",
            background: "#FFFFFF",
            border: `1px solid ${RED}`,
            color: RED_DARK,
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <span aria-hidden>{it.icon}</span>
          {it.label}
        </span>
      ))}
    </div>
  )
}

function RecommendForBlock({
  items,
  isMobile,
}: {
  items: string[]
  isMobile: boolean
}) {
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px" : "48px 40px",
        background: BG_SOFT,
      }}
    >
      <SectionTitle title={t.detail.result.recommendForTitle} />
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 10,
          border: `1px solid ${LINE}`,
          padding: isMobile ? "16px 18px" : "22px 26px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {items.slice(0, 6).map((it, i) => (
          <div
            key={`r-${i}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              fontSize: isMobile ? 14 : 15,
              color: INK,
              lineHeight: 1.5,
            }}
          >
            <span
              style={{
                flexShrink: 0,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: RED,
                color: "#FFF",
                fontSize: 11,
                fontWeight: 700,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 1,
              }}
              aria-hidden
            >
              ✓
            </span>
            <span>{it}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FarmStoryBlock({
  farmStory,
  isMobile,
}: {
  farmStory: string
  isMobile: boolean
}) {
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px" : "48px 40px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.farmStoryTitle} />
      <div
        style={{
          padding: isMobile ? "20px 18px" : "28px 32px",
          background: `linear-gradient(135deg, ${RED_TINT} 0%, ${BG_SOFT} 100%)`,
          borderRadius: 12,
          borderLeft: `4px solid ${RED}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <span style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }} aria-hidden>
            🧑‍🌾
          </span>
          <p
            style={{
              fontSize: isMobile ? 15 : 17,
              color: INK,
              lineHeight: 1.7,
              margin: 0,
              fontStyle: "italic",
              whiteSpace: "pre-line",
            }}
          >
            “{farmStory}”
          </p>
        </div>
      </div>
    </div>
  )
}

function ReturnsBlock({ isMobile }: { isMobile: boolean }) {
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px" : "48px 40px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.returnsTitle} />
      <div
        style={{
          padding: isMobile ? "18px 18px" : "24px 28px",
          background: BG_SOFT,
          borderRadius: 10,
          border: `1px solid ${LINE}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: RED_TINT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
              flexShrink: 0,
            }}
            aria-hidden
          >
            ↩️
          </div>
          <p
            style={{
              fontSize: isMobile ? 14 : 15,
              color: INK,
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            {t.detail.result.returnsBody}
          </p>
        </div>
      </div>
    </div>
  )
}

function CautionsBlock({
  cautions,
  isMobile,
}: {
  cautions: string[]
  isMobile: boolean
}) {
  return (
    <div
      style={{
        padding: isMobile ? "32px 20px 40px" : "48px 40px 64px",
        background: "#FFFFFF",
      }}
    >
      <div
        style={{
          padding: isMobile ? "18px 18px" : "24px 28px",
          background: "#FFFBEB",
          borderRadius: 10,
          border: "1px solid #FBBF24",
        }}
      >
        <h3
          style={{
            fontSize: isMobile ? 15 : 17,
            fontWeight: 800,
            color: "#92400E",
            margin: 0,
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span aria-hidden>⚠️</span>
          {t.detail.result.cautionsTitle}
        </h3>
        <ul
          style={{
            margin: 0,
            paddingLeft: 18,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {cautions.map((c, i) => (
            <li
              key={`c-${i}`}
              style={{
                fontSize: isMobile ? 13 : 14,
                color: "#78350F",
                lineHeight: 1.6,
              }}
            >
              {c}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/* ============================================================ */
/* Reusable bits                                                 */
/* ============================================================ */

function SectionTitle({
  title,
  regen,
}: {
  title: string
  regen?: React.ReactNode
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 18,
      }}
    >
      <h2
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: INK,
          margin: 0,
          paddingLeft: 12,
          borderLeft: `4px solid ${RED}`,
          lineHeight: 1,
        }}
      >
        {title}
      </h2>
      {regen}
    </div>
  )
}

function PreviewToggle({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 16px",
        borderRadius: 999,
        border: active
          ? "1px solid var(--color-primary-600)"
          : "1px solid var(--color-neutral-300)",
        background: active
          ? "var(--color-primary-600)"
          : "var(--color-bg-surface)",
        color: active ? "var(--color-text-on-primary)" : "var(--color-neutral-700)",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  )
}

function buildPlainCopy(copy: CopyOutput): string {
  const lines: string[] = []
  if (copy.headline) lines.push(`[${copy.headline}]`)
  if (copy.subheadline) lines.push(copy.subheadline)
  if (copy.highlightBox) lines.push("", copy.highlightBox)
  if (copy.story) lines.push("", copy.story)

  if (copy.keyPoints?.length) {
    lines.push("")
    copy.keyPoints.forEach((p) => {
      lines.push(`POINT ${p.num} ${p.title}`)
      if (p.body) lines.push(p.body)
      lines.push("")
    })
  }

  if (copy.recommendFor?.length) {
    lines.push("[이런 분께 추천드려요]")
    copy.recommendFor.forEach((r) => lines.push(`- ${r}`))
    lines.push("")
  }

  if (copy.spec?.length) {
    lines.push("[상품 정보]")
    copy.spec.forEach((s) => lines.push(`${s.label}: ${s.value}`))
    lines.push("")
  }

  if (copy.farmStory) lines.push("[농가에서]", copy.farmStory, "")
  if (copy.storage) lines.push("[보관·먹는 법]", copy.storage, "")

  if (copy.faq?.length) {
    lines.push("[자주 묻는 질문]")
    copy.faq.forEach((f) => {
      lines.push(`Q. ${f.q}`)
      lines.push(`A. ${f.a}`)
      lines.push("")
    })
  }

  if (copy.cautions?.length) {
    lines.push("[구매 전 꼭 확인해주세요]")
    copy.cautions.forEach((c) => lines.push(`- ${c}`))
  }

  return lines.join("\n").trim()
}

function ActionButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        padding: "12px 16px",
        background: "var(--color-bg-surface)",
        color: "var(--color-neutral-900)",
        border: "1px solid var(--color-neutral-300)",
        borderRadius: 6,
        fontSize: 14,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}
