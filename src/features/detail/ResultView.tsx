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

const RED = "#E03131"
const RED_DARK = "#C92A2A"
const RED_TINT = "#FFF5F5"
const INK = "#212529"
const SUB = "#495057"
const MUTE = "#868E96"
const BG_SOFT = "#F8F9FA"
const LINE = "#E9ECEF"
const PLACEHOLDER = "#ADB5BD"
const WARM_BEIGE = "#FFF8E7"
const SOFT_GREEN = "#E8F5E9"

/** 헤드라인 폰트 체인. 산스 굵은 헤드용 (G마켓산스/본고딕 대체로 BlackHanSans). */
const HEAD_FONT =
  '"BlackHanSans", "NotoSansKR", "DoHyeon", Pretendard, -apple-system, sans-serif'
/** 산뜻한 산스 (G마켓산스/SCoreDream 대체로 DoHyeon/Jua). */
const HEAD_SANS =
  '"DoHyeon", "Jua", "NotoSansKR", Pretendard, -apple-system, sans-serif'
/** 본문 폰트. */
const BODY_FONT =
  'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif'
/** 손글씨 강조 폰트 (카페24단정해/KoHandwriting 대체로 NanumPenScript/Jua). */
const HANDWRITING_FONT =
  '"NanumPenScript", "Jua", "GowunDodum", Pretendard, cursive'
/** 명조 폰트 (본고딕 Heavy 대체로 GowunBatang). */
const SERIF_FONT =
  '"GowunBatang", "NotoSansKR", "Apple SD Gothic Neo", serif'

/** 빈 CopyOutput — 미리보기 placeholder/초기값용. */
export function emptyCopy(): CopyOutput {
  return {
    headline: "",
    subheadline: "",
    story: "",
    spec: [],
    storage: "",
    faq: [],
    highlightBadges: [],
    keyPoints: [],
    highlightBox: "",
    cautions: [],
    recommendFor: [],
    farmStory: "",
  }
}

/** 빈 문자열이면 placeholder 회색 텍스트를 렌더. */
function Placeholder({ text }: { text: string }) {
  return (
    <span style={{ color: PLACEHOLDER, fontWeight: 400, fontStyle: "italic" }}>
      여기에 {text}가 들어갑니다
    </span>
  )
}

/** 섹션 사이 빨강 점 + 작은 사과 구분자. */
function DotDivider() {
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 10,
        padding: "14px 0",
        background: "#FFFFFF",
        color: RED,
        fontSize: 12,
        letterSpacing: 2,
      }}
    >
      <span>•</span>
      <span>•</span>
      <span style={{ fontSize: 14, opacity: 0.9 }}>🍎</span>
    </div>
  )
}

export function ResultView({
  copy,
  images,
  productName,
  price: _price,
  origin,
  weight,
  trust,
  onRetry,
  onCopyChange,
  onSectionRegenerate,
  busySection,
}: ResultViewProps) {
  const [enhance, setEnhance] = useState(true)
  const captureRef = useRef<HTMLDivElement>(null)
  const previewWidth = 860
  const isMobile = true

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
            {/* 0. Top thick red bar with center dot */}
            <div
              aria-hidden
              style={{
                margin: "28px 20px 24px",
                position: "relative",
                height: 6,
                background: RED,
                borderRadius: 3,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: -5,
                  left: "50%",
                  transform: "translateX(-50%)",
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  background: RED,
                  border: "3px solid #FFFFFF",
                  boxShadow: `0 0 0 1px ${RED}`,
                }}
              />
            </div>

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

            <DotDivider />

            {/* 2. HERO + HEADLINE BIG TITLE */}
            <HeroBlock
              heroImage={heroImage}
              copy={copy}
              onCopyChange={onCopyChange}
              onRegenHeadline={renderRegen("headline")}
              onRegenSub={renderRegen("subheadline")}
              isMobile={isMobile}
            />

            <DotDivider />

            {/* 3. STORY + HIGHLIGHT BOX */}
            <StoryBlock
              copy={copy}
              onCopyChange={onCopyChange}
              onRegen={renderRegen("story")}
              isMobile={isMobile}
            />

            {/* 3a. RECOMMEND FOR */}
            {copy.recommendFor && copy.recommendFor.length > 0 && (
              <>
                <DotDivider />
                <RecommendForBlock items={copy.recommendFor} isMobile={isMobile} />
              </>
            )}

            {/* 4. GALLERY (2x2) */}
            {galleryImages.length > 0 && (
              <>
                <DotDivider />
                <GalleryBlock images={galleryImages} productName={productName} />
              </>
            )}

            <DotDivider />

            {/* 5. SPEC + PRICE */}
            <SpecBlock
              copy={copy}
              onCopyChange={onCopyChange}
              onRegen={renderRegen("spec")}
              isMobile={isMobile}
            />

            {/* 6. POINT BIG CARDS */}
            {keyPoints.length > 0 && (
              <>
                <DotDivider />
                <KeyPointsBig
                  points={keyPoints}
                  copy={copy}
                  onCopyChange={onCopyChange}
                  pointImageFor={pointImageFor}
                  isMobile={isMobile}
                />
              </>
            )}

            {/* 6a. FARM STORY */}
            {copy.farmStory && (
              <>
                <DotDivider />
                <FarmStoryBlock farmStory={copy.farmStory} isMobile={isMobile} />
              </>
            )}

            {/* 7. STORAGE */}
            {copy.storage && (
              <>
                <DotDivider />
                <StorageBlock
                  copy={copy}
                  onCopyChange={onCopyChange}
                  onRegen={renderRegen("storage")}
                  isMobile={isMobile}
                />
              </>
            )}

            {/* 8. FAQ */}
            {copy.faq.length > 0 && (
              <>
                <DotDivider />
                <FaqBlock
                  copy={copy}
                  onCopyChange={onCopyChange}
                  onRegen={renderRegen("faq")}
                  isMobile={isMobile}
                />
              </>
            )}

            <DotDivider />

            {/* 9. DELIVERY (정형) */}
            <DeliveryBlock isMobile={isMobile} />

            <DotDivider />

            {/* 9a. RETURNS (정형) */}
            <ReturnsBlock isMobile={isMobile} />

            {/* 10. CAUTIONS */}
            {copy.cautions && copy.cautions.length > 0 && (
              <>
                <DotDivider />
                <CautionsBlock cautions={copy.cautions} isMobile={isMobile} />
              </>
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
        padding: isMobile ? "36px 20px" : "44px 40px",
        background: "#FFFFFF",
        borderBottom: `1px solid ${LINE}`,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 26 }}>
        <div
          style={{
            display: "inline-block",
            padding: "4px 12px",
            background: RED,
            color: "#FFF",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 3,
            marginBottom: 14,
            fontFamily: HEAD_SANS,
          }}
          aria-hidden
        >
          WHY FRUIT
        </div>
        <h2
          style={{
            fontSize: isMobile ? 26 : 32,
            fontWeight: 900,
            margin: 0,
            lineHeight: 1.3,
            color: INK,
            fontFamily: HEAD_FONT,
            letterSpacing: -0.5,
          }}
        >
          {productName || <Placeholder text="상품명" />}{" "}
          <span style={{ color: RED }}>{t.detail.result.whatsDifferentTitle}</span>
        </h2>
        <p
          style={{
            fontSize: isMobile ? 13 : 15,
            color: SUB,
            marginTop: 10,
            margin: 0,
            fontFamily: BODY_FONT,
          }}
        >
          {t.detail.result.whatsDifferentHint}
        </p>
      </div>

      {keyPoints.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {keyPoints.map((p, i) => (
            <div
              key={`kp-compact-${i}`}
              style={{
                display: "flex",
                alignItems: "stretch",
                gap: 0,
                background: "#FFFFFF",
                border: `1px solid ${LINE}`,
                borderLeft: `4px solid ${RED}`,
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 72,
                  padding: isMobile ? "10px 8px" : "12px 10px",
                  background: RED,
                  color: "#FFF",
                  fontSize: isMobile ? 10 : 11,
                  fontWeight: 800,
                  letterSpacing: 1.5,
                  fontFamily: HEAD_SANS,
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span style={{ fontSize: 9, opacity: 0.85 }}>POINT</span>
                <span style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900 }}>
                  {p.num}
                </span>
              </span>
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: isMobile ? "12px 16px" : "14px 22px",
                  fontSize: isMobile ? 15 : 17,
                  fontWeight: 700,
                  color: INK,
                  lineHeight: 1.4,
                  fontFamily: BODY_FONT,
                  flex: 1,
                }}
              >
                {p.title ? (
                  <EditableResultText
                    copy={copy}
                    onChange={onCopyChange}
                    path={["keyPoints", i, "title"]}
                    maxLength={40}
                  />
                ) : (
                  <Placeholder text="핵심 포인트" />
                )}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: "16px 18px",
            background: BG_SOFT,
            borderRadius: 12,
            textAlign: "center",
            color: PLACEHOLDER,
            fontSize: 13,
            fontStyle: "italic",
          }}
        >
          여기에 핵심 포인트 3가지가 들어갑니다
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
      <div style={{ position: "relative" }}>
        {heroImage ? (
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
        ) : (
          <div
            style={{
              width: "100%",
              aspectRatio: "1",
              background: BG_SOFT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: PLACEHOLDER,
              fontSize: 14,
              fontStyle: "italic",
            }}
          >
            여기에 대표 이미지가 들어갑니다
          </div>
        )}
        {/* 하단 흰색 그라데이션 오버레이 — 텍스트와 자연스럽게 연결 */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: "35%",
            background:
              "linear-gradient(180deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 70%, #FFFFFF 100%)",
            pointerEvents: "none",
          }}
        />
        {/* 이미지 위 좌측 상단 작은 라벨 */}
        <div
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            padding: "5px 11px",
            background: "rgba(224, 49, 49, 0.92)",
            color: "#FFFFFF",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 2,
            borderRadius: 2,
            fontFamily: HEAD_SANS,
          }}
          aria-hidden
        >
          FRESH PICK
        </div>
      </div>

      <div
        style={{
          padding: isMobile ? "16px 20px 40px" : "20px 40px 48px",
          textAlign: "center",
          marginTop: -40,
          position: "relative",
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 17 : 20,
            color: SUB,
            margin: 0,
            marginBottom: 14,
            lineHeight: 1.5,
            fontFamily: SERIF_FONT,
            fontStyle: "italic",
          }}
        >
          {copy.subheadline ? (
            <EditableResultText
              copy={copy}
              onChange={onCopyChange}
              path={["subheadline"]}
              maxLength={60}
            />
          ) : (
            <Placeholder text="서브 카피" />
          )}
        </p>
        <h1
          style={{
            fontSize: isMobile ? 42 : 58,
            fontWeight: 900,
            margin: 0,
            color: INK,
            lineHeight: 1.15,
            letterSpacing: -1,
            fontFamily: HEAD_FONT,
          }}
        >
          {copy.headline ? (
            <EditableResultText
              copy={copy}
              onChange={onCopyChange}
              path={["headline"]}
              maxLength={40}
            />
          ) : (
            <Placeholder text="메인 헤드라인" />
          )}
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
              gap: 8,
              justifyContent: "center",
              marginTop: 22,
            }}
          >
            {copy.highlightBadges.slice(0, 4).map((b, i) => (
              <span
                key={`b-${i}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "7px 14px",
                  borderRadius: 999,
                  background: RED,
                  color: "#FFFFFF",
                  fontSize: isMobile ? 12 : 13,
                  fontWeight: 700,
                  fontFamily: BODY_FONT,
                  boxShadow: "0 2px 6px rgba(224,49,49,0.25)",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "#FFFFFF",
                    color: RED,
                    fontSize: 10,
                    fontWeight: 900,
                  }}
                  aria-hidden
                >
                  ✓
                </span>
                {b}
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
  const hasStory = !!copy.story
  const hasHighlight = !!copy.highlightBox
  // 드롭캡용 첫 글자 추출
  const storyText = copy.story ?? ""
  const firstChar = storyText.trim().charAt(0)
  return (
    <div
      style={{
        padding: isMobile ? "44px 24px" : "56px 56px",
        background: "#FFFFFF",
        position: "relative",
      }}
    >
      {/* 양쪽 큰따옴표 — 상단 가운데 */}
      {hasStory && (
        <div
          aria-hidden
          style={{
            textAlign: "center",
            fontSize: isMobile ? 56 : 72,
            color: RED,
            lineHeight: 0.4,
            fontFamily: SERIF_FONT,
            fontWeight: 900,
            marginBottom: 18,
            opacity: 0.6,
          }}
        >
          “
        </div>
      )}

      {hasStory ? (
        <div
          style={{
            position: "relative",
            textAlign: "center",
            maxWidth: 640,
            margin: "0 auto",
          }}
        >
          {firstChar && (
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: isMobile ? 0 : -20,
                top: -8,
                fontSize: isMobile ? 56 : 72,
                color: RED,
                fontFamily: HEAD_FONT,
                fontWeight: 900,
                lineHeight: 1,
                opacity: 0.12,
                pointerEvents: "none",
                userSelect: "none",
              }}
            >
              {firstChar}
            </span>
          )}
          <p
            style={{
              fontSize: isMobile ? 16 : 18,
              color: INK,
              lineHeight: 1.85,
              whiteSpace: "pre-line",
              margin: 0,
              textAlign: "center",
              fontFamily: SERIF_FONT,
              position: "relative",
              zIndex: 1,
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
        </div>
      ) : (
        <p
          style={{
            fontSize: isMobile ? 15 : 17,
            lineHeight: 1.75,
            margin: 0,
            textAlign: "center",
            color: PLACEHOLDER,
            fontStyle: "italic",
            fontFamily: BODY_FONT,
          }}
        >
          여기에 상품 스토리가 들어갑니다
        </p>
      )}

      {hasStory && (
        <div
          aria-hidden
          style={{
            textAlign: "center",
            fontSize: isMobile ? 56 : 72,
            color: RED,
            lineHeight: 0.4,
            fontFamily: SERIF_FONT,
            fontWeight: 900,
            marginTop: 24,
            opacity: 0.6,
          }}
        >
          ”
        </div>
      )}

      {hasHighlight && (
        <div
          style={{
            marginTop: 32,
            padding: isMobile ? "26px 20px" : "32px 28px",
            background: WARM_BEIGE,
            border: `1px dashed ${RED}`,
            borderRadius: 4,
            textAlign: "center",
            position: "relative",
          }}
        >
          {/* 도장 마크 */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: -16,
              right: -10,
              width: 56,
              height: 56,
              borderRadius: "50%",
              border: `2px solid ${RED}`,
              background: "#FFFFFF",
              color: RED,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: 1,
              transform: "rotate(-9deg)",
              fontFamily: HEAD_SANS,
            }}
          >
            FRESH
          </div>
          <p
            style={{
              fontSize: isMobile ? 32 : 38,
              fontWeight: 700,
              color: RED_DARK,
              margin: 0,
              lineHeight: 1.4,
              fontFamily: HANDWRITING_FONT,
              transform: "rotate(-1.5deg)",
              display: "inline-block",
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
        gap: 18,
        background: "#FFFFFF",
        padding: "20px 16px",
      }}
    >
      {images.slice(0, 4).map((img, i) => (
        <div
          key={img.id}
          style={{
            background: "#FFFFFF",
            padding: 6,
            border: "6px solid #FFFFFF",
            borderRadius: 2,
            boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
            transform: `rotate(${i % 2 === 0 ? "-1.2deg" : "1deg"})`,
            display: "block",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={img.url}
            alt={`${productName} ${i + 2}`}
            style={{
              width: "100%",
              aspectRatio: "1",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      ))}
    </div>
  )
}

/** spec label 기반 아이콘 매핑. 라벨 부분 일치(포함)로 결정. */
function iconForSpecLabel(label: string): string {
  const l = label.trim()
  if (/(산지|원산지|지역)/.test(l)) return "🏠"
  if (/(품종|종류|품목)/.test(l)) return "🍑"
  if (/(중량|용량|수량|박스|개수|과수)/.test(l)) return "⚖️"
  if (/(당도|Brix|brix|맛)/.test(l)) return "🌡"
  if (/(등급|선별|규격)/.test(l)) return "⭐"
  if (/(보관|냉장|냉동)/.test(l)) return "❄️"
  if (/(수확|출하)/.test(l)) return "📅"
  if (/(인증|GAP|친환경|유기|무농약)/.test(l)) return "✅"
  if (/(배송|발송|택배)/.test(l)) return "📦"
  return "🍃"
}

function SpecBlock({
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
  const specCount = copy.spec.length
  // 4개 이상이면 2열, 3개면 1열(좁은 모바일)/2열(데스크탑) 자동 — 항상 2열로 통일하되 홀수 시 마지막 카드가 가득 차도록 grid auto-fit 흉내
  const columns = specCount <= 1 ? "1fr" : "repeat(2, minmax(0, 1fr))"
  return (
    <div
      style={{
        padding: isMobile ? "36px 20px" : "48px 40px",
        background: BG_SOFT,
      }}
    >
      <SectionTitle title={t.detail.result.spec} regen={onRegen} />

      {specCount > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: columns,
            gap: 8,
          }}
        >
          {copy.spec.map((s, i) => {
            const icon = iconForSpecLabel(s.label)
            return (
              <div
                key={`spec-${i}`}
                style={{
                  background: "#FFFFFF",
                  border: `1px solid ${RED}`,
                  borderRadius: 10,
                  padding: 16,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    color: SUB,
                    fontWeight: 600,
                  }}
                >
                  <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>
                    {icon}
                  </span>
                  <span>{s.label}</span>
                </div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: INK,
                    lineHeight: 1.4,
                    wordBreak: "keep-all",
                  }}
                >
                  {s.value ? (
                    <EditableResultText
                      copy={copy}
                      onChange={onCopyChange}
                      path={["spec", i, "value"]}
                      maxLength={100}
                    />
                  ) : (
                    <Placeholder text={s.label} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 10,
            border: `1px solid ${LINE}`,
            padding: "20px",
            textAlign: "center",
            color: PLACEHOLDER,
            fontSize: 13,
            fontStyle: "italic",
          }}
        >
          여기에 상품 정보 카드가 들어갑니다
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
          padding: isMobile ? "48px 20px 28px" : "64px 40px 36px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-block",
            fontSize: isMobile ? 12 : 13,
            fontWeight: 800,
            letterSpacing: 4,
            color: RED,
            marginBottom: 10,
            fontFamily: HEAD_SANS,
          }}
        >
          KEY POINTS
        </div>
        <h2
          style={{
            fontSize: isMobile ? 30 : 42,
            fontWeight: 900,
            margin: 0,
            color: INK,
            lineHeight: 1.25,
            fontFamily: HEAD_FONT,
            letterSpacing: -0.5,
          }}
        >
          {t.detail.result.keyPointsSectionTitle}
        </h2>
      </div>

      {points.map((p, i) => {
        const img = pointImageFor(i)
        const polaroidRot = i % 2 === 0 ? "-1.4deg" : "1.6deg"
        return (
          <div
            key={`kp-big-${i}`}
            style={{
              position: "relative",
              padding: isMobile ? "32px 24px 48px" : "44px 48px 64px",
            }}
          >
            {/* 좌측 세로 6px 빨강 바 */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: isMobile ? 12 : 24,
                top: isMobile ? 32 : 44,
                bottom: isMobile ? 48 : 64,
                width: 6,
                background: RED,
                borderRadius: 3,
              }}
            />
            <div style={{ paddingLeft: isMobile ? 12 : 24, position: "relative" }}>
              {/* 흐릿한 회색 큰 영문 숫자 배경 */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  right: 0,
                  top: -28,
                  fontSize: isMobile ? 110 : 140,
                  fontWeight: 900,
                  color: "#F1F3F5",
                  fontFamily: HEAD_FONT,
                  lineHeight: 1,
                  letterSpacing: -4,
                  userSelect: "none",
                  pointerEvents: "none",
                  zIndex: 0,
                }}
              >
                0{p.num}
              </span>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 12px",
                  background: RED,
                  color: "#FFF",
                  fontSize: isMobile ? 11 : 12,
                  fontWeight: 800,
                  letterSpacing: 2,
                  marginBottom: 14,
                  fontFamily: HEAD_SANS,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                POINT {p.num}
              </div>
              <h3
                style={{
                  fontSize: isMobile ? 30 : 38,
                  fontWeight: 900,
                  margin: 0,
                  marginBottom: 16,
                  color: INK,
                  lineHeight: 1.3,
                  fontFamily: HEAD_FONT,
                  letterSpacing: -0.5,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {p.title ? (
                  <EditableResultText
                    copy={copy}
                    onChange={onCopyChange}
                    path={["keyPoints", i, "title"]}
                    maxLength={40}
                  />
                ) : (
                  <Placeholder text="포인트 제목" />
                )}
              </h3>
              <p
                style={{
                  fontSize: isMobile ? 15 : 17,
                  color: SUB,
                  lineHeight: 1.8,
                  margin: 0,
                  marginBottom: 28,
                  whiteSpace: "pre-line",
                  fontFamily: BODY_FONT,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                {p.body ? (
                  <EditableResultText
                    copy={copy}
                    onChange={onCopyChange}
                    path={["keyPoints", i, "body"]}
                    multiline
                    maxLength={300}
                    preserveWhitespace
                  />
                ) : (
                  <Placeholder text="포인트 본문" />
                )}
              </p>
              {img && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    margin: "8px 0",
                  }}
                >
                  <div
                    style={{
                      background: "#FFFFFF",
                      padding: "10px 10px 32px",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
                      transform: `rotate(${polaroidRot})`,
                      maxWidth: "85%",
                      width: "85%",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt=""
                      style={{
                        width: "100%",
                        aspectRatio: "4/3",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
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
        padding: isMobile ? "36px 20px" : "48px 40px",
        background: WARM_BEIGE,
      }}
    >
      <SectionTitle title={t.detail.result.storage} regen={onRegen} />
      <div
        style={{
          padding: isMobile ? "20px 20px" : "26px 30px",
          background: "#FFFFFF",
          borderRadius: 4,
          border: `1px solid ${LINE}`,
        }}
      >
        {copy.storage ? (
          <p
            style={{
              fontSize: isMobile ? 15 : 16,
              color: INK,
              lineHeight: 1.85,
              whiteSpace: "pre-line",
              margin: 0,
              fontFamily: BODY_FONT,
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
        ) : (
          <p
            style={{
              fontSize: isMobile ? 14 : 15,
              lineHeight: 1.75,
              margin: 0,
              color: PLACEHOLDER,
              fontStyle: "italic",
            }}
          >
            여기에 보관·먹는 법이 들어갑니다
          </p>
        )}
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
        padding: isMobile ? "36px 20px" : "48px 40px",
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
              borderBottom:
                i < copy.faq.length - 1 ? `1px solid ${LINE}` : "none",
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
              <span style={{ color: RED, marginRight: 4, fontSize: 10 }} aria-hidden>
                ▼
              </span>
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
                lineHeight: 1.75,
                margin: 0,
              }}
            >
              <span style={{ color: RED, marginRight: 4, fontSize: 10 }} aria-hidden>
                ▼
              </span>
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
        padding: isMobile ? "36px 20px" : "48px 40px",
        background: SOFT_GREEN,
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
              lineHeight: 1.75,
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
  // 항목별 좌측 컬러 점
  const DOT_COLORS = [RED, "#F59F00", "#37B24D", "#1C7ED6", "#AE3EC9", "#F76707"]
  return (
    <div
      style={{
        padding: isMobile ? "40px 20px" : "52px 40px",
        background: SOFT_GREEN,
      }}
    >
      <SectionTitle title={t.detail.result.recommendForTitle} />
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 4,
          border: `1px solid ${LINE}`,
          padding: isMobile ? "20px 22px" : "28px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {items.slice(0, 6).map((it, i) => (
          <div
            key={`r-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              fontSize: isMobile ? 15 : 17,
              color: INK,
              lineHeight: 1.5,
              fontFamily: BODY_FONT,
              paddingBottom: i < Math.min(items.length, 6) - 1 ? 12 : 0,
              borderBottom:
                i < Math.min(items.length, 6) - 1
                  ? `1px dashed ${LINE}`
                  : "none",
            }}
          >
            {/* 좌측 컬러 점 */}
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: DOT_COLORS[i % DOT_COLORS.length],
                boxShadow: `0 0 0 3px ${DOT_COLORS[i % DOT_COLORS.length]}22`,
              }}
            />
            {/* 손글씨 풍 ★ */}
            <span
              style={{
                flexShrink: 0,
                color: RED,
                fontSize: isMobile ? 22 : 26,
                lineHeight: 1,
                fontFamily: HANDWRITING_FONT,
                fontWeight: 700,
              }}
              aria-hidden
            >
              ★
            </span>
            <span style={{ fontWeight: 600 }}>{it}</span>
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
        padding: isMobile ? "40px 20px" : "56px 40px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.farmStoryTitle} />
      <div
        style={{
          padding: isMobile ? "28px 22px" : "36px 36px",
          background: `linear-gradient(135deg, ${WARM_BEIGE} 0%, ${SOFT_GREEN} 100%)`,
          borderRadius: 4,
          border: `1px dashed ${RED}`,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 18,
          }}
        >
          {/* 농부 사진 placeholder — 회색 원 */}
          <div
            aria-hidden
            style={{
              width: isMobile ? 76 : 92,
              height: isMobile ? 76 : 92,
              borderRadius: "50%",
              background: "#E9ECEF",
              border: "4px solid #FFFFFF",
              boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: isMobile ? 36 : 44,
            }}
          >
            🧑‍🌾
          </div>
          <div
            style={{
              position: "relative",
              textAlign: "center",
              maxWidth: 540,
            }}
          >
            <span
              aria-hidden
              style={{
                position: "absolute",
                left: -8,
                top: -22,
                color: RED,
                fontSize: isMobile ? 52 : 64,
                fontFamily: SERIF_FONT,
                fontWeight: 900,
                lineHeight: 1,
                opacity: 0.5,
              }}
            >
              “
            </span>
            <p
              style={{
                fontSize: isMobile ? 22 : 28,
                color: INK,
                lineHeight: 1.7,
                margin: 0,
                whiteSpace: "pre-line",
                fontFamily: HANDWRITING_FONT,
                padding: isMobile ? "0 14px" : "0 24px",
              }}
            >
              {farmStory}
            </p>
            <span
              aria-hidden
              style={{
                position: "absolute",
                right: -8,
                bottom: -42,
                color: RED,
                fontSize: isMobile ? 52 : 64,
                fontFamily: SERIF_FONT,
                fontWeight: 900,
                lineHeight: 1,
                opacity: 0.5,
              }}
            >
              ”
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ReturnsBlock({ isMobile }: { isMobile: boolean }) {
  return (
    <div
      style={{
        padding: isMobile ? "36px 20px" : "48px 40px",
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
              lineHeight: 1.75,
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
        padding: isMobile ? "36px 20px 40px" : "48px 40px 64px",
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
            fontSize: isMobile ? 17 : 19,
            fontWeight: 900,
            color: "#92400E",
            margin: 0,
            marginBottom: 14,
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: HEAD_SANS,
            letterSpacing: -0.3,
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
            gap: 8,
          }}
        >
          {cautions.map((c, i) => (
            <li
              key={`c-${i}`}
              style={{
                fontSize: isMobile ? 14 : 15,
                color: "#78350F",
                lineHeight: 1.65,
                fontFamily: BODY_FONT,
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
          fontSize: 24,
          fontWeight: 900,
          color: INK,
          margin: 0,
          paddingLeft: 14,
          borderLeft: `5px solid ${RED}`,
          lineHeight: 1.05,
          fontFamily: HEAD_FONT,
          letterSpacing: -0.5,
        }}
      >
        {title}
      </h2>
      {regen}
    </div>
  )
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
