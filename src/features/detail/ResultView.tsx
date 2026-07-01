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
// v2.6: WorkJsonExporter 삭제 (사이드바 3개 액션 제거 지시)
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
const INK = "#212529"
const SUB = "#495057"
const MUTE = "#868E96"
const BG_SOFT = "#F8F9FA"
const LINE = "#E9ECEF"
const PLACEHOLDER = "#ADB5BD"

/**
 * v2.5 폰트 계층 — 잘 팔리는 스마트스토어 톤 (임팩트 강력).
 *
 * DISPLAY (Hero 초대형, highlightBox 슬로건, POINT 넘버)
 *   = BlackHanSans — 검은 고딕, 스마트스토어·쿠팡 상위 셀러 표준
 * HEAD (섹션 타이틀 h2, POINT title, 스펙 큰 값)
 *   = Pretendard 900 — 가독성 + 임팩트 균형
 * BODY (본문·스토리·설명)
 *   = Pretendard 500/700
 * CAPTION (라벨·뱃지·소형 강조)
 *   = Pretendard 700 + letterSpacing 강조
 */
const DISPLAY_FONT =
  '"BlackHanSans", "Pretendard", "NotoSansKR", sans-serif'
const BODY_FONT = '"Pretendard", "NotoSansKR", sans-serif'

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

/** v2.4: 섹션 구분자 — 사과 이모지·빨강 점 제거, 여백만. */
function DotDivider() {
  return <div aria-hidden style={{ height: 8, background: "#FFFFFF" }} />
}

/**
 * v2.5 상단 배지 스트립 — 잘 팔리는 스마트스토어 표준 4대 신뢰 요소.
 * Hero 아래에 항상 노출. 검정 배경 + 흰 텍스트 + 얇은 라인 구분.
 */
function ValuePropStrip({ isMobile }: { isMobile: boolean }) {
  const items = ["산지 직송", "당일 수확", "100% 환불", "신선 보장"]
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        background: INK,
        color: "#FFFFFF",
        padding: isMobile ? "16px 0" : "20px 0",
      }}
    >
      {items.map((label, i) => (
        <div
          key={`vp-${i}`}
          style={{
            textAlign: "center",
            fontSize: isMobile ? 12 : 14,
            fontWeight: 800,
            fontFamily: BODY_FONT,
            letterSpacing: 0.5,
            borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.15)" : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <span aria-hidden style={{ color: RED, fontWeight: 900 }}>✓</span>
          <span>{label}</span>
        </div>
      ))}
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

            {/* v2.5: 가치 제안 스트립 (산지직송·당일수확·100%환불·신선보장) */}
            <ValuePropStrip isMobile={isMobile} />

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

      {/* Side panel — v2.6: 스크롤 추가 (뷰포트 초과 시 내부 스크롤) */}
      <aside
        className="fdp-no-print"
        style={{
          position: "sticky",
          top: 20,
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
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

            {/* v2.6: 전체 카피 복사·JSON 내보내기·불러오기 삭제 (사용자 지시) */}
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
      {/* v2.5: 큰 상품명 + 빨강 강조구 대비 (스마트스토어 잘 팔리는 톤) */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div
          style={{
            fontSize: isMobile ? 11 : 12,
            color: RED,
            fontWeight: 800,
            letterSpacing: 3,
            marginBottom: 14,
            fontFamily: BODY_FONT,
          }}
        >
          WHY BUY HERE
        </div>
        <h2
          style={{
            fontSize: isMobile ? 34 : 52,
            fontWeight: 400,
            margin: 0,
            lineHeight: 1.15,
            color: INK,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1.5,
          }}
        >
          {productName || <Placeholder text="상품명을 입력해 주세요" />}
          <br />
          <span style={{ color: RED }}>{t.detail.result.whatsDifferentTitle}</span>
        </h2>
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
        {/* v2.5: 스마트스토어 임팩트 톤 — 서브 캡션 스타일(작고 굵음) + 대형 헤드 대비 */}
        <p
          style={{
            fontSize: isMobile ? 13 : 14,
            color: RED,
            margin: 0,
            marginBottom: 18,
            lineHeight: 1.4,
            fontFamily: BODY_FONT,
            fontWeight: 800,
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
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
            fontSize: isMobile ? 52 : 84,
            fontWeight: 400,
            margin: 0,
            color: INK,
            lineHeight: 1.05,
            letterSpacing: -2,
            fontFamily: DISPLAY_FONT,
          }}
        >
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
  return (
    <div
      style={{
        padding: isMobile ? "44px 24px" : "56px 56px",
        background: "#FFFFFF",
        position: "relative",
      }}
    >
      {/* v2.5: 큰따옴표 삭제 → STORY 캡션 라벨로 대체 (스마트스토어 톤) */}
      {hasStory && (
        <div
          style={{
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          <span
            style={{
              display: "inline-block",
              padding: "6px 14px",
              background: INK,
              color: "#FFFFFF",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 3,
              fontFamily: BODY_FONT,
            }}
          >
            STORY
          </span>
        </div>
      )}

      <div
        style={{
          position: "relative",
          textAlign: "center",
          maxWidth: 640,
          margin: "0 auto",
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 18 : 21,
            color: INK,
            lineHeight: 1.85,
            whiteSpace: "pre-line",
            margin: 0,
            textAlign: "center",
            fontFamily: BODY_FONT,
            fontWeight: 500,
            position: "relative",
            zIndex: 1,
            wordBreak: "keep-all",
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

      {/* v2.5: highlightBox — 초대형 BlackHanSans 슬로건 + 축색 강조 (임팩트 톤) */}
      <div
        style={{
          marginTop: 56,
          padding: isMobile ? "36px 24px" : "56px 32px",
          background: INK,
          textAlign: "center",
          maxWidth: 720,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 40 : 60,
            fontWeight: 400,
            color: "#FFFFFF",
            margin: 0,
            lineHeight: 1.15,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1.5,
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
  // v2.6: 첫 이미지 대형 통 이미지 + 나머지는 2열 그리드 (아보카도·복숭아 페이지 톤)
  const gallery = images.slice(0, 5)
  const [featured, ...rest] = gallery
  return (
    <div
      style={{
        background: "#FFFFFF",
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {featured && (
        <div
          style={{
            background: "#FFFFFF",
            borderRadius: 8,
            overflow: "hidden",
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={featured.url}
            alt={`${productName} 대표`}
            style={{
              width: "100%",
              aspectRatio: "4/3",
              objectFit: "cover",
              display: "block",
            }}
          />
        </div>
      )}
      {rest.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: rest.length === 1 ? "1fr" : "repeat(2, 1fr)",
            gap: 12,
          }}
        >
          {rest.map((img, i) => (
            <div
              key={img.id}
              style={{
                background: "#FFFFFF",
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={`${productName} ${i + 3}`}
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
      )}
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
                      gap: 6,
                      lineHeight: 1,
                      color: RED,
                      fontFamily: DISPLAY_FONT,
                    }}
                  >
                    {/* v2.5: 당도 숫자 44→80px (Spec 카드에서 시각 앵커) */}
                    <span style={{ fontSize: 80, fontWeight: 400, letterSpacing: -3 }}>
                      {sweetnessMatch[1]}
                    </span>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: RED_DARK,
                        fontFamily: BODY_FONT,
                        letterSpacing: 1,
                      }}
                    >
                      {sweetnessMatch[2] ?? "Brix"}
                    </span>
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: INK,
                      lineHeight: 1.35,
                      wordBreak: "keep-all",
                      fontFamily: BODY_FONT,
                      letterSpacing: -0.3,
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
        {/* v2.5: 섹션 헤드 크기 42→60 (임팩트 강화) */}
        <h2
          style={{
            fontSize: isMobile ? 38 : 60,
            fontWeight: 400,
            margin: 0,
            color: INK,
            lineHeight: 1.1,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1.5,
          }}
        >
          {t.detail.result.keyPointsSectionTitle}
        </h2>
      </div>

      {/* v2.6: POINT별 배경색 살짝 변주 (아보카도·수플린 페이지 톤 참조) */}
      {points.map((p, i) => {
        const img = pointImageFor(i)
        const bgTints = ["#FFFFFF", "#FAFBFC", "#FFF9F9"]
        const bg = bgTints[i % bgTints.length]
        return (
          <div
            key={`kp-big-${i}`}
            style={{
              position: "relative",
              padding: isMobile ? "40px 24px 56px" : "56px 48px 72px",
              background: bg,
            }}
          >
            {/* 좌측 세로 6px 빨강 바 */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: isMobile ? 12 : 24,
                top: isMobile ? 40 : 56,
                bottom: isMobile ? 56 : 72,
                width: 6,
                background: RED,
                borderRadius: 3,
              }}
            />
            <div style={{ paddingLeft: isMobile ? 12 : 24, position: "relative" }}>
              {/* v2.5: 배경 숫자 크기·색상 강화 (110→180, 얇은 회색선) */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  right: 0,
                  top: -40,
                  fontSize: isMobile ? 130 : 200,
                  fontWeight: 900,
                  color: "transparent",
                  WebkitTextStroke: `2px ${LINE}`,
                  fontFamily: DISPLAY_FONT,
                  lineHeight: 1,
                  letterSpacing: -6,
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
                  padding: "6px 14px",
                  background: RED,
                  color: "#FFF",
                  fontSize: isMobile ? 11 : 12,
                  fontWeight: 800,
                  letterSpacing: 2.5,
                  marginBottom: 18,
                  fontFamily: BODY_FONT,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                POINT {p.num}
              </div>
              <h3
                style={{
                  fontSize: isMobile ? 32 : 46,
                  fontWeight: 400,
                  margin: 0,
                  marginBottom: 20,
                  color: INK,
                  lineHeight: 1.2,
                  fontFamily: DISPLAY_FONT,
                  letterSpacing: -1.2,
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
                  fontSize: isMobile ? 16 : 18,
                  color: SUB,
                  lineHeight: 1.8,
                  margin: 0,
                  marginBottom: 32,
                  whiteSpace: "pre-line",
                  fontFamily: BODY_FONT,
                  fontWeight: 500,
                  wordBreak: "keep-all",
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
                    marginTop: 20,
                  }}
                >
                  <div
                    style={{
                      background: "#FFFFFF",
                      borderRadius: 8,
                      overflow: "hidden",
                      maxWidth: "100%",
                      width: "100%",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                    }}
                  >
                    {/* v2.6: 4:3 → 1:1 대형 이미지 (아보카도·복숭아 페이지 톤) */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={img.url}
                      alt=""
                      style={{
                        width: "100%",
                        aspectRatio: "1",
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
        background: "#FFFFFF",
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
            {/* v2.4: ▼ 화살표·빨강 Q. 삭제 → Q./A. 미니멀 표기 */}
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
              <span style={{ color: INK, marginRight: 8, fontWeight: 900 }}>Q.</span>
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
              <span style={{ color: MUTE, marginRight: 8, fontWeight: 700 }}>A.</span>
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
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.deliveryTitle} />
      {/* v2.4: 초록 배경·주황 원형 이모지 삭제 → 얇은 라인 카드 */}
      <div
        style={{
          padding: isMobile ? "20px 22px" : "26px 30px",
          background: "#FFFFFF",
          borderRadius: 4,
          border: `1px solid ${LINE}`,
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 14 : 15,
            color: INK,
            lineHeight: 1.85,
            margin: 0,
            fontFamily: BODY_FONT,
          }}
        >
          {t.detail.result.deliveryBody}
        </p>
      </div>
    </div>
  )
}

function TrustBadgesRow({ trust }: { trust: TrustInfo }) {
  const items: string[] = []
  if (trust.sameDayHarvest) items.push("당일 수확·발송")
  if (trust.coldChain) items.push("콜드체인 배송")
  if (trust.directFromFarm) items.push("산지 직거래")
  if (trust.refundGuarantee) items.push("환불 보장")
  if (trust.gapNumber?.trim()) items.push("GAP 인증")
  if (trust.organicNumber?.trim()) items.push("친환경 인증")
  if (trust.pesticideFreeNumber?.trim()) items.push("무농약 인증")
  if (trust.harvestDateLabel?.trim())
    items.push(`수확 ${trust.harvestDateLabel.trim()}`)

  if (items.length === 0) return null

  // v2.4: 이모지·dashed·회전 도트 삭제 → 흰 배경 미니멀 칩 (컬리·오늘의집 톤)
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: "14px 20px 20px",
        justifyContent: "center",
        borderBottom: `1px solid ${LINE}`,
      }}
    >
      {items.map((label, i) => (
        <span
          key={`tb-${i}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "5px 10px",
            background: "#FFFFFF",
            border: `1px solid ${LINE}`,
            color: SUB,
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 600,
            fontFamily: BODY_FONT,
          }}
        >
          {label}
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
        background: "#FFFFFF",
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
            {/* v2.5: 판매문구 느낌 — Pretendard 700 + 굵기 대비 (세리프 X) */}
            <p
              style={{
                fontSize: isMobile ? 18 : 22,
                color: INK,
                lineHeight: 1.65,
                margin: 0,
                whiteSpace: "pre-line",
                fontFamily: BODY_FONT,
                fontWeight: 700,
                wordBreak: "keep-all",
                letterSpacing: -0.3,
              }}
            >
              {farmStory}
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
      {/* v2.4: 원형 이모지·BG_SOFT 배경 삭제 → 얇은 라인 카드 */}
      <div
        style={{
          padding: isMobile ? "20px 22px" : "26px 30px",
          background: "#FFFFFF",
          borderRadius: 4,
          border: `1px solid ${LINE}`,
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 14 : 15,
            color: INK,
            lineHeight: 1.85,
            margin: 0,
            fontFamily: BODY_FONT,
          }}
        >
          {t.detail.result.returnsBody}
        </p>
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
      {/* v2.4: 빨강·노랑 경고 박스 삭제 → 얇은 회색 라인 카드 하나로 통합 */}
      <div
        style={{
          padding: isMobile ? "20px 22px" : "26px 30px",
          background: "#FFFFFF",
          borderRadius: 4,
          border: `1px solid ${LINE}`,
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 13 : 14,
            color: SUB,
            lineHeight: 1.75,
            margin: 0,
            marginBottom: cautions.length > 0 ? 16 : 0,
            fontFamily: BODY_FONT,
          }}
        >
          {t.detail.result.cautionsAutoNotice}
        </p>
        {cautions.length > 0 && (
          <>
            <h3
              style={{
                fontSize: isMobile ? 14 : 15,
                fontWeight: 700,
                color: INK,
                margin: 0,
                marginBottom: 10,
                fontFamily: BODY_FONT,
              }}
            >
              {t.detail.result.cautionsTitle}
            </h3>
            <ul
              style={{
                margin: 0,
                paddingLeft: 16,
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
                    color: SUB,
                    lineHeight: 1.7,
                    fontFamily: BODY_FONT,
                  }}
                >
                  {c}
                </li>
              ))}
            </ul>
          </>
        )}
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
      {/* v2.5: 섹션 h2 임팩트 강화 — 크기 24→34, BlackHanSans 계열 */}
      <h2
        style={{
          fontSize: 34,
          fontWeight: 400,
          color: INK,
          margin: 0,
          lineHeight: 1.05,
          fontFamily: DISPLAY_FONT,
          letterSpacing: -1,
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
