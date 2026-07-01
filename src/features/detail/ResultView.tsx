"use client"

import { useMemo, useRef, useState } from "react"
import { t } from "@/lib/i18n"
import type { CopyOutput, CopyKeyPoint, TrustInfo } from "@/lib/ai/types"
import type { SectionId } from "@/lib/ai/section-regenerate"
import type { UploadedImage } from "./ImageUploader"
import { ExportPanel } from "./ExportPanel"
import { EditableResultText } from "./EditableResultText"
import { RegenButton } from "./RegenButton"
import { CertCaption } from "./CertCaption"
import { CheckoutTrustStrip } from "./CheckoutTrustStrip"
import { FreshnessTimeline } from "./FreshnessTimeline"
import { ProducerCard } from "./ProducerCard"
import { DisclosureBlock } from "./DisclosureBlock"
import { StickyMobileCta } from "./StickyMobileCta"
import { QualityScoreCard } from "./QualityScoreCard"
import { WidthPresetSwitcher, WIDTH_PRESETS, type WidthPresetKey } from "./WidthPresetSwitcher"
import { WorkJsonExporter } from "./WorkJsonExporter"
import { checkComplianceReport } from "@/lib/ai/compliance-report"
import { scoreCopyQuality } from "@/lib/ai/copy-quality-score"
import { detectFruitFactKey, FRUIT_FACTS } from "@/domain/fruit-facts"

/** CopyOutput을 사람 친화적 텍스트로 평탄화 (전체 복사용). */
function flattenCopyToText(copy: CopyOutput, productName: string): string {
  const lines: string[] = []
  lines.push(`【${productName || copy.headline}】`)
  if (copy.headline) lines.push(copy.headline)
  if (copy.subheadline) lines.push(copy.subheadline)
  lines.push("")
  if (copy.highlightBox) {
    lines.push(`▶ ${copy.highlightBox}`)
    lines.push("")
  }
  if (copy.story) {
    lines.push(copy.story)
    lines.push("")
  }
  if (copy.keyPoints.length > 0) {
    lines.push("── 구매 포인트 ──")
    for (const kp of copy.keyPoints) {
      lines.push(`POINT ${kp.num}. ${kp.title}`)
      lines.push(kp.body)
      lines.push("")
    }
  }
  if (copy.spec.length > 0) {
    lines.push("── 상품 정보 ──")
    for (const s of copy.spec) {
      lines.push(`• ${s.label}: ${s.value}`)
    }
    lines.push("")
  }
  if (copy.storage) {
    lines.push("── 보관·먹는 법 ──")
    lines.push(copy.storage)
    lines.push("")
  }
  if (copy.faq.length > 0) {
    lines.push("── 자주 묻는 질문 ──")
    for (const f of copy.faq) {
      lines.push(`Q. ${f.q}`)
      lines.push(`A. ${f.a}`)
      lines.push("")
    }
  }
  if (copy.recommendFor.length > 0) {
    lines.push("── 이런 분께 추천 ──")
    for (const r of copy.recommendFor) lines.push(`• ${r}`)
    lines.push("")
  }
  if (copy.farmStory) {
    lines.push("── 농가에서 한 마디 ──")
    lines.push(copy.farmStory)
    lines.push("")
  }
  if (copy.cautions.length > 0) {
    lines.push("── 구매 전 확인 ──")
    for (const c of copy.cautions) lines.push(`• ${c}`)
  }
  return lines.join("\n").trim()
}

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

/** 헤드라인 폰트 (HeroBlock, KeyPointsBig title, SectionTitle 헤더용). */
const HEAD_FONT =
  '"BlackHanSans", "NotoSansKR", Pretendard, sans-serif'
/** 라벨/도장 (FRESH 도장, POINT 라벨 등 작은 강조). */
const HEAD_SANS =
  '"Jua", "DoHyeon", sans-serif'
/** 본문 폰트. */
const BODY_FONT = 'Pretendard, sans-serif'
/** 손글씨 강조 폰트 (HighlightBox, FarmStoryBlock 인용). */
const HANDWRITING_FONT =
  '"NanumPenScript", "Gugi", Pretendard, cursive'
/** 명조 폰트 (StoryBlock, cautionsTitle). */
const SERIF_FONT = '"GowunBatang", serif'

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
  /** v2.3: 편집 모드 토글 — off면 다시 버튼/편집 UI 완전 감춤 (진짜 상세페이지처럼) */
  const [editMode, setEditMode] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)
  /** v1.9: 폭 프리셋 토글 — 셀러 플랫폼 폭에 맞게 캡처. */
  const [widthPreset, setWidthPreset] = useState<WidthPresetKey>("smartstore-860")
  const previewWidth = useMemo(() => {
    const p = WIDTH_PRESETS.find((x) => x.key === widthPreset)
    return p?.width ?? 860
  }, [widthPreset])
  // 모바일 폭(360/414/780)일 때는 모바일 레이아웃 — 패딩·폰트 크기 축소
  const isMobile = previewWidth < 900

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

  /** 식약처 자동 검수 — 결과 카피 기준으로 매번 계산. */
  const complianceReport = useMemo(
    () => checkComplianceReport(copy, trust),
    [copy, trust],
  )

  /** 카피 품질 점수 — v1.9. */
  const qualityScore = useMemo(
    () => scoreCopyQuality({ copy, productName, trust }),
    [copy, productName, trust],
  )

  /** 신선도 타임라인 — harvestDateLabel + fruit-facts.storage.days로 계산. */
  const freshnessProps = useMemo(() => {
    const harvest = trust?.harvestDateLabel?.trim()
    if (!harvest) return null
    const key = detectFruitFactKey(productName)
    if (!key) return null
    const days = FRUIT_FACTS[key]?.storage?.days
    if (!days || days < 1) return null
    // ISO 변환 시도
    const norm = harvest.replace(/[년월일\s]+/g, "-").replace(/-+$/, "")
    return { harvestDate: norm, daysGood: days }
  }, [trust?.harvestDateLabel, productName])

  const renderRegen = (sectionId: SectionId) => {
    if (!onSectionRegenerate) return null
    if (!editMode) return null
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

  /** v1.9: fact 기반 카피 placeholder — 빈 상태일 때 그 과일의 예시 카피를 옅게 노출. */
  const factPlaceholder = useMemo(() => {
    const key = detectFruitFactKey(productName)
    if (!key) return null
    const fact = FRUIT_FACTS[key]
    return {
      headline: fact.hookHeadlines[0] ?? "",
      sub: fact.hookHeadlines[1] ?? "",
      highlightBox: fact.sensoryWords.slice(0, 2).join(" · "),
    }
  }, [productName])

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
            {/* v2.2: 상단 리본 — 시즌 자동 삽입 대신 얇은 포인트 바만 유지 */}
            <div
              aria-hidden
              style={{
                position: "relative",
                height: 4,
                background: RED,
                margin: 0,
              }}
            />

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

            {/* v2.3: mini POINT 카드 제거된 헤더만 (KeyPointsBig와 중복 방지) */}
            <WhyHeader productName={productName} isMobile={isMobile} />

            {/* 1a. TRUST BADGES */}
            {trust && <TrustBadgesRow trust={trust} />}

            {/* 1b. CertCaption — 공식 인증 above-fold (v1.8) */}
            {trust && (trust.gapNumber?.trim() || trust.organicNumber?.trim() || trust.pesticideFreeNumber?.trim()) && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  padding: "10px 20px 12px",
                  justifyContent: "center",
                  background: "#FFFFFF",
                }}
              >
                {trust.gapNumber?.trim() && (
                  <CertCaption
                    certType="gap"
                    certNumber={trust.gapNumber}
                    producerName={trust.producerName}
                    producerRegion={trust.producerRegion}
                  />
                )}
                {trust.organicNumber?.trim() && (
                  <CertCaption
                    certType="organic"
                    certNumber={trust.organicNumber}
                    producerName={trust.producerName}
                    producerRegion={trust.producerRegion}
                  />
                )}
                {trust.pesticideFreeNumber?.trim() && (
                  <CertCaption
                    certType="pesticide-free"
                    certNumber={trust.pesticideFreeNumber}
                    producerName={trust.producerName}
                    producerRegion={trust.producerRegion}
                  />
                )}
              </div>
            )}

            <DotDivider />

            {/* 2. HERO + HEADLINE BIG TITLE */}
            <HeroBlock
              heroImage={heroImage}
              copy={copy}
              onCopyChange={onCopyChange}
              onRegenHeadline={renderRegen("headline")}
              onRegenSub={renderRegen("subheadline")}
              isMobile={isMobile}
              factPlaceholder={factPlaceholder}
            />

            {/* 2a. FreshnessTimeline — 수확일 + fruit-facts 보관 일수 (v1.8) */}
            {freshnessProps && (
              <div style={{ padding: "0 20px 16px" }}>
                <FreshnessTimeline
                  harvestDate={freshnessProps.harvestDate}
                  daysGood={freshnessProps.daysGood}
                />
              </div>
            )}

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
                <FarmStoryBlock
                  farmStory={copy.farmStory}
                  isMobile={isMobile}
                  trust={trust}
                />
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

            {/* 9b. CheckoutTrustStrip — 결제 인접 신뢰 줄 (v1.8) */}
            {trust && (
              <div style={{ padding: "0 20px" }}>
                <CheckoutTrustStrip
                  coldChain={trust.coldChain}
                  sealed={trust.sealedPackage}
                  refundCondition={
                    typeof trust.refundGuarantee === "object"
                      ? trust.refundGuarantee.condition
                      : trust.refundGuarantee
                        ? "맛 이상 시 환불 보장"
                        : undefined
                  }
                  sameDayShipping={trust.sameDayHarvest}
                />
              </div>
            )}

            {/* 10. CAUTIONS — 신선식품 면책 박스 자동 표시 (cautions 비어 있어도 노출) */}
            <DotDivider />
            <CautionsBlock cautions={copy.cautions ?? []} isMobile={isMobile} />
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

        {/* QualityScoreCard — 카피 종합 점수 (v2.1 심플 모드) */}
        <QualityScoreCard score={qualityScore} />

        {/* DisclosureBlock — 식약처 자동 검수 + 면책 (v1.8 — 위반 있으면 자동 강조) */}
        <DisclosureBlock report={complianceReport} />

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

        {/* v2.1 심플: 주요 액션 2개만 상단에 */}
        <ExportPanel targetRef={captureRef} baseName={sanitizedName} />

        <ActionButton onClick={onRetry}>{t.detail.result.retry}</ActionButton>

        {/* v2.3: 다시 버튼 토글 — off면 "🔄 다시" 버튼 감춰서 진짜 상세페이지처럼 */}
        <label
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            padding: "10px 12px",
            background: editMode ? "#FFF5F5" : "var(--color-bg-subtle)",
            border: `1px solid ${editMode ? RED : "var(--color-neutral-300)"}`,
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 700,
            color: editMode ? RED : "var(--color-neutral-700)",
          }}
        >
          <span>🔄 재생성 버튼 표시</span>
          <input
            type="checkbox"
            checked={editMode}
            onChange={(e) => setEditMode(e.target.checked)}
            style={{ accentColor: RED, width: 18, height: 18 }}
          />
        </label>
        <p style={{ fontSize: 11, color: "var(--color-neutral-600)", margin: "-6px 0 0", lineHeight: 1.5 }}>
          텍스트 편집은 언제든 미리보기 위 텍스트를 클릭하면 됩니다. 이 토글은 각 섹션의 "🔄 다시" 버튼 노출 여부만 조절합니다.
        </p>

        {/* v2.1: 나머지 옵션은 "고급 설정" details로 접기 */}
        <details style={{ marginTop: 4 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-neutral-700)",
              padding: "6px 0",
              userSelect: "none",
            }}
          >
            ⚙️ 고급 설정
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {/* 폭 변경 */}
            <WidthPresetSwitcher value={widthPreset} onChange={setWidthPreset} />

            {/* 사진 자동 보정 */}
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                background: "var(--color-bg-subtle)",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 12,
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

            {/* 전체 카피 텍스트 복사 */}
            <button
              type="button"
              onClick={async () => {
                try {
                  const text = flattenCopyToText(copy, productName)
                  if (navigator.clipboard && text) {
                    await navigator.clipboard.writeText(text)
                    alert("전체 카피를 클립보드에 복사했어요!")
                  }
                } catch (e) {
                  console.error("[copy-to-clipboard]", e)
                  alert("복사에 실패했어요.")
                }
              }}
              style={{
                padding: "8px 12px",
                background: "var(--color-bg-surface)",
                border: "1px solid var(--color-neutral-300)",
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--color-neutral-900)",
                cursor: "pointer",
              }}
            >
              📋 전체 카피 텍스트 복사
            </button>

            {/* JSON 백업 */}
            <WorkJsonExporter
              copy={copy}
              productName={productName}
              price={_price}
              origin={origin}
              weight={weight}
              trust={trust}
              onImport={onCopyChange}
            />
          </div>
        </details>
      </aside>

      {/* v1.8: 모바일 sticky CTA — 스크롤 30% 이상에서 표시 */}
      <StickyMobileCta
        onCopy={async () => {
          try {
            const text = flattenCopyToText(copy, productName)
            if (navigator.clipboard && text) {
              await navigator.clipboard.writeText(text)
              alert("전체 카피를 복사했어요!")
            }
          } catch (e) {
            console.error("[sticky-copy]", e)
          }
        }}
        onDownload={() => {
          // ExportPanel 영역으로 스크롤
          const panel = document.querySelector('[data-fdp-export-panel="true"]') as HTMLElement | null
          panel?.scrollIntoView({ behavior: "smooth", block: "center" })
        }}
      />
    </div>
  )
}

/* ============================================================ */
/* Section blocks                                                */
/* ============================================================ */

function WhyHeader({
  productName,
  isMobile,
}: {
  productName: string
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
      {/* v2.2: WHY FRUIT 영어 라벨 삭제. 상품명 + 한글 문구만 노출 */}
      <div style={{ textAlign: "center", marginBottom: 26 }}>
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
          {productName || <Placeholder text="상품명을 입력해 주세요" />}{" "}
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

      {/* v2.3: mini POINT 카드 삭제 — 아래 KeyPointsBig와 중복이라 정리 */}
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
  factPlaceholder,
}: {
  heroImage?: UploadedImage
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  onRegenHeadline: React.ReactNode
  onRegenSub: React.ReactNode
  isMobile: boolean
  factPlaceholder?: { headline: string; sub: string; highlightBox: string } | null
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
        {/* v2.2: FRESH PICK 영어 라벨 삭제 — 이미지에 방해되고 뜬금없음 */}
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
          {/* v2.2: 값 유무 상관 없이 항상 EditableResultText 렌더링 (편집 진입 가능) */}
          <EditableResultText
            copy={copy}
            onChange={onCopyChange}
            path={["subheadline"]}
            maxLength={60}
            placeholder={factPlaceholder?.sub ?? "여기에 서브 카피를 적어보세요"}
          />
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
          {/* v2.2: 값 유무 상관 없이 항상 EditableResultText 렌더링 */}
          <EditableResultText
            copy={copy}
            onChange={onCopyChange}
            path={["headline"]}
            maxLength={40}
            placeholder={factPlaceholder?.headline ?? "여기에 상품 헤드라인을 적어보세요"}
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

      {/* v2.2: 값 유무 상관 없이 항상 편집 가능 */}
      <div
        style={{
          position: "relative",
          textAlign: "center",
          maxWidth: 640,
          margin: "0 auto",
        }}
      >
        {/* v2.3: 드롭캡 워터마크 삭제 — 첫 글자 반투명 표기가 아마추어 느낌을 줌 */}
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
            placeholder="한 입 베면 어떤 맛인지, 어떤 향이 나는지 3~5문장으로 적어보세요"
          />
        </p>
      </div>

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

      {/* v2.2: 값 유무 상관 없이 항상 편집 가능 (도장은 값 있을 때만) */}
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
        {hasHighlight && (
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
            신선
          </div>
        )}
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
            placeholder="한 줄 슬로건 (예: 청송의 겸손한 자랑)"
          />
        </p>
      </div>

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
          {/* v2.3: 이모지 아이콘 삭제, 카드 테두리 얇은 회색, 라벨/값 리듬 통일 */}
          {copy.spec.map((s, i) => {
            const isSweetness = /(당도|Brix|brix)/.test(s.label)
            const sweetnessMatch = isSweetness && s.value
              ? s.value.trim().match(/^(\d+(?:\.\d+)?)\s*([A-Za-z가-힣]+)?/)
              : null
            return (
              <div
                key={`spec-${i}`}
                style={{
                  background: "#FFFFFF",
                  border: `1px solid ${LINE}`,
                  borderRadius: 12,
                  padding: "20px 22px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    color: SUB,
                    fontWeight: 700,
                    fontFamily: BODY_FONT,
                    letterSpacing: 0.5,
                  }}
                >
                  {s.label}
                </div>
                {isSweetness && sweetnessMatch ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 4,
                      lineHeight: 1.1,
                      color: RED,
                      fontFamily: HEAD_FONT,
                    }}
                  >
                    <span style={{ fontSize: 44, fontWeight: 900, letterSpacing: -1 }}>
                      {sweetnessMatch[1]}
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: RED_DARK,
                        fontFamily: HEAD_SANS,
                      }}
                    >
                      {sweetnessMatch[2] ?? "Brix"}
                    </span>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 700,
                      color: INK,
                      lineHeight: 1.4,
                      wordBreak: "keep-all",
                      fontFamily: BODY_FONT,
                    }}
                  >
                    <EditableResultText
                      copy={copy}
                      onChange={onCopyChange}
                      path={["spec", i, "value"]}
                      maxLength={100}
                      placeholder={s.label}
                    />
                  </div>
                )}
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
        {/* v2.2: KEY POINTS 영어 라벨 삭제 — 아래 큰 한글 헤드만 유지 */}
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
                <EditableResultText
                  copy={copy}
                  onChange={onCopyChange}
                  path={["keyPoints", i, "title"]}
                  maxLength={40}
                  placeholder={`POINT ${i + 1} 큰 제목 (예: 새벽 5시에 따 보내요)`}
                />
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
                <EditableResultText
                  copy={copy}
                  onChange={onCopyChange}
                  path={["keyPoints", i, "body"]}
                  multiline
                  maxLength={300}
                  preserveWhitespace
                  placeholder="구체 사실 + 숫자 (Brix / kg / 시간 / 재구매율 등)를 담아 2~3문장"
                />
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
        {/* v2.2: 값 유무 상관 없이 항상 EditableResultText — 편집 진입 가능 */}
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
            placeholder="보관법을 알려주시면 셀러 신뢰가 올라가요"
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

  // 칩별 약한 회전 (-2 ~ +2도, 결정론적)
  const rotFor = (i: number) => {
    const seq = [-1.6, 1.2, -2, 0.8, 1.8, -1, 2, -1.4]
    return seq[i % seq.length]
  }
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "16px 20px 20px",
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
            gap: 5,
            padding: "6px 12px",
            background: "#FFFFFF",
            border: `1.5px dashed ${RED}`,
            color: RED_DARK,
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            fontFamily: HEAD_SANS,
            letterSpacing: 0.3,
            boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
            transform: `rotate(${rotFor(i)}deg)`,
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
        padding: isMobile ? "40px 20px" : "52px 40px",
        background: SOFT_GREEN,
      }}
    >
      <SectionTitle title={t.detail.result.recommendForTitle} />
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 12,
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
              alignItems: "flex-start",
              gap: 12,
              fontSize: isMobile ? 15 : 17,
              color: INK,
              lineHeight: 1.55,
              fontFamily: BODY_FONT,
              paddingBottom: i < Math.min(items.length, 6) - 1 ? 12 : 0,
              borderBottom:
                i < Math.min(items.length, 6) - 1
                  ? `1px solid ${LINE}`
                  : "none",
            }}
          >
            {/* v2.3: 색점 삭제 → 체크 아이콘 하나만 */}
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                marginTop: 2,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: RED,
                color: "#FFFFFF",
                fontSize: 12,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              ✓
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
  trust,
}: {
  farmStory: string
  isMobile: boolean
  trust?: TrustInfo
}) {
  // trust에 농부 정보 있으면 ProducerCard로, 없으면 placeholder.
  const hasProducer = !!(trust?.producerName || trust?.producerRegion || trust?.farmerYears)
  const farmerMeta = hasProducer
    ? [
        trust!.farmerYears && trust!.farmerYears > 0 ? `${trust!.farmerYears}년차` : null,
        trust!.producerRegion || null,
        trust!.producerName ? `${trust!.producerName} 농가` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : "20년차 청송 김 농부"
  return (
    <div
      style={{
        padding: isMobile ? "40px 20px" : "56px 40px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.farmStoryTitle} />

      {/* v1.8: trust에 농부 정보 있으면 ProducerCard로 노출 */}
      {hasProducer && (
        <div style={{ marginBottom: 16 }}>
          <ProducerCard
            name={trust!.producerName ?? "농부"}
            region={trust!.producerRegion ?? ""}
            years={trust!.farmerYears ?? 0}
            photoUrl={trust!.farmerPhotoUrl}
          />
        </div>
      )}

      <div
        style={{
          padding: isMobile ? "28px 24px" : "36px 40px",
          background: BG_SOFT,
          borderRadius: 12,
          border: `1px solid ${LINE}`,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
            <p
              style={{
                fontSize: isMobile ? 26 : 30,
                color: INK,
                lineHeight: 1.55,
                margin: 0,
                whiteSpace: "pre-line",
                fontFamily: HANDWRITING_FONT,
              }}
            >
              <span
                aria-hidden
                style={{
                  color: RED,
                  fontFamily: SERIF_FONT,
                  fontWeight: 900,
                  marginRight: 4,
                  opacity: 0.6,
                }}
              >
                “
              </span>
              {farmStory}
              <span
                aria-hidden
                style={{
                  color: RED,
                  fontFamily: SERIF_FONT,
                  fontWeight: 900,
                  marginLeft: 4,
                  opacity: 0.6,
                }}
              >
                ”
              </span>
            </p>
            <p
              style={{
                fontSize: isMobile ? 12 : 13,
                color: SUB,
                margin: 0,
                fontFamily: BODY_FONT,
                fontWeight: 600,
                letterSpacing: 0.2,
              }}
            >
              — {farmerMeta}
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
      {/* 신선식품 면책 자동 박스 — cautions 유무와 관계없이 항상 노출 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px",
          marginBottom: 14,
          background: RED_TINT,
          border: `1px solid ${RED}`,
          borderRadius: 8,
          color: RED_DARK,
          fontSize: isMobile ? 13 : 14,
          fontWeight: 600,
          fontFamily: BODY_FONT,
        }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: RED,
            color: "#FFFFFF",
            fontSize: 11,
            fontWeight: 900,
            flexShrink: 0,
            fontFamily: HEAD_SANS,
          }}
        >
          ⓘ
        </span>
        <span>{t.detail.result.cautionsAutoNotice}</span>
      </div>

      {cautions.length > 0 && (
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
              fontFamily: SERIF_FONT,
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
      )}
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
