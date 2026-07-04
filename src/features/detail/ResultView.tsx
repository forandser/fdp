"use client"

import { createContext, useContext, useMemo, useRef, useState } from "react"
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
// v2.7: StickyMobileCta 삭제 (중앙 하단 복사/다운로드 버튼 제거 지시)
import { QualityScoreCard } from "./QualityScoreCard"
import { WidthPresetSwitcher, WIDTH_PRESETS, type WidthPresetKey } from "./WidthPresetSwitcher"
// v2.6: WorkJsonExporter 삭제 (사이드바 3개 액션 제거 지시)
import { checkComplianceReport } from "@/lib/ai/compliance-report"
import { scoreCopyQuality } from "@/lib/ai/copy-quality-score"
import {
  MAX_HEADLINE_CANDIDATES,
  normalizeHeadlineCandidate,
} from "@/lib/ai/validate"
import { detectFruitFactKey, FRUIT_FACTS } from "@/domain/fruit-facts"
import { resolveAccent, DEFAULT_ACCENT, type AccentPalette } from "./fruit-accent"

/**
 * v2.8: 과일별 축색 Context.
 * ResultView가 productName에서 팔레트를 계산해 Provider로 내려주고,
 * 각 블록이 useAccent()로 소비. export(toCanvas) 시엔 구체 색으로 인라인되어 안전.
 */
const AccentContext = createContext<AccentPalette>(DEFAULT_ACCENT)
function useAccent(): AccentPalette {
  return useContext(AccentContext)
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

const RED = "#E03131" // 사이드바 편집 컨트롤용 브랜드 색 (내보내는 페이지엔 accent 사용)
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

/**
 * v3.0 중앙 이미지 배정기 (임무 C).
 *
 * 문제: 예전엔 각 블록이 제각기 images 인덱스를 계산해 같은 사진이 2~3번 붙어 나왔고
 * (Hero 직후 WhyBrandCard가 hero 사진 재사용, POINT·PACKAGE가 갤러리와 중복),
 * 갤러리는 5장 고정이라 7장 이상 올린 사진은 어디에도 안 쓰였다.
 *
 * 이 함수가 모든 블록의 이미지 슬롯을 한곳에서 결정한다.
 * 원칙:
 *  1. hero = images[0] 전용 예약. 다른 슬롯은 사진이 부족할 때만 최후순위로 hero를 재사용.
 *  2. "아직 안 쓴 사진 우선" — 사진이 슬롯보다 많으면 중복 0,
 *     적으면 사용 횟수가 가장 적은 사진부터 골라 재사용을 골고루 분산.
 *  3. 같은 사진 연속 배치 금지 — 직전 슬롯과 같은 사진은 피한다.
 *     특히 Hero 바로 다음 WhyBrandCard에는 hero 사진을 절대 안 넣는다.
 *     대체 사진이 없으면 whyBrand는 undefined(텍스트 카드로 렌더).
 *  4. 갤러리가 남는 사진을 흡수 — 5장 고정 대신 남은 사진 수에 맞춰 유연하게(최대 8장).
 *  5. 결정적(deterministic) — 같은 입력이면 항상 같은 결과. Math.random 금지.
 *
 * 반환: 각 블록이 그대로 쓰는 배정 결과. keyPoints/recipe는 요청 개수만큼의 배열.
 */
export interface ImagePlan {
  hero?: UploadedImage
  whyBrand?: UploadedImage
  keyPoints: (UploadedImage | undefined)[]
  recipe: (UploadedImage | undefined)[]
  packaging?: UploadedImage
  gallery: UploadedImage[]
}

const GALLERY_MAX = 8

export function planImages(
  images: UploadedImage[],
  opts: { keyPointCount: number; recipeCount: number },
): ImagePlan {
  const keyPointCount = Math.max(0, opts.keyPointCount)
  const recipeCount = Math.max(0, opts.recipeCount)

  // 사진이 없으면 전부 빈 슬롯 (기존 폴백과 동일: 각 블록이 이미지 없이 렌더).
  if (images.length === 0) {
    return {
      hero: undefined,
      whyBrand: undefined,
      keyPoints: Array<UploadedImage | undefined>(keyPointCount).fill(undefined),
      recipe: Array<UploadedImage | undefined>(recipeCount).fill(undefined),
      packaging: undefined,
      gallery: [],
    }
  }

  const hero = images[0]
  // hero를 뺀 후보 풀. 이 풀에서 "안 쓴 사진 우선"으로 특징 슬롯을 채운다.
  const rest = images.slice(1)

  // 사용 횟수 추적 — key는 image.id. rest에 있는 사진만 카운트한다.
  const useCount = new Map<string, number>()
  for (const img of rest) useCount.set(img.id, 0)

  let prevId: string | undefined = hero?.id // 직전 슬롯 = hero (whyBrand가 hero 사진 못 쓰게)

  /**
   * 특징 슬롯 1칸 배정: rest 중 (사용 횟수 최소) & (직전과 다른) 사진을 고른다.
   * rest가 비어 있으면 undefined (호출부가 hero 폴백 여부를 결정).
   * 동점일 땐 원본 순서가 앞선 사진 우선 → 결정적.
   */
  const pickFeature = (): UploadedImage | undefined => {
    if (rest.length === 0) return undefined
    let best: UploadedImage | undefined
    let bestCount = Infinity
    let bestSameAsPrev: UploadedImage | undefined
    let bestSameCount = Infinity
    for (const img of rest) {
      const c = useCount.get(img.id) ?? 0
      if (img.id === prevId) {
        // 직전과 같은 사진은 마지막 후보로만 (다른 선택지가 전혀 없을 때).
        if (c < bestSameCount) {
          bestSameCount = c
          bestSameAsPrev = img
        }
        continue
      }
      if (c < bestCount) {
        bestCount = c
        best = img
      }
    }
    const chosen = best ?? bestSameAsPrev
    if (chosen) {
      useCount.set(chosen.id, (useCount.get(chosen.id) ?? 0) + 1)
      prevId = chosen.id
    }
    return chosen
  }

  // whyBrand — Hero 직후. hero 사진 금지. rest 없으면 undefined(텍스트 카드).
  const whyBrand = pickFeature()

  const keyPoints: (UploadedImage | undefined)[] = []
  for (let i = 0; i < keyPointCount; i++) {
    const img = pickFeature()
    // rest가 아예 없을 때만 hero로 폴백 (직전이 hero면 중복이라 그냥 hero 허용 — 이 경우 사진 1장뿐).
    keyPoints.push(img ?? hero)
  }

  const recipe: (UploadedImage | undefined)[] = []
  for (let i = 0; i < recipeCount; i++) {
    const img = pickFeature()
    recipe.push(img ?? hero)
  }

  // packaging — 갤러리 그리드와 겹치지 않게 특징 슬롯으로 먼저 배정.
  const packaging = pickFeature() ?? hero

  // 갤러리 — 특징 슬롯에서 "아직 한 번도 안 쓴" rest 사진만 흡수한다.
  // (hero 및 특징 블록에 이미 노출된 사진은 넣지 않아 블록 간 중복 0 — 임무 C.)
  // rest가 비거나(사진 1장뿐) 특징 슬롯이 rest를 전부 소진하면 unused가 빈 배열이라
  // 갤러리도 빈 배열 → 블록 자체가 숨겨진다(line 573 게이트). 7~8장 구간에서
  // 예전 `rest.slice(...)` 무조건 폴백이 특징+갤러리 전량 중복을 만들던 문제를 제거.
  const unused = rest.filter((img) => (useCount.get(img.id) ?? 0) === 0)
  const gallery = unused.slice(0, GALLERY_MAX)

  return { hero, whyBrand, keyPoints, recipe, packaging, gallery }
}

/** fruit-facts에서 무료로 합류시킬 hookHeadlines 최대 개수 (기획 Should: 2~3개). */
const FREE_CANDIDATE_MAX = 3

/**
 * 화면에 노출할 헤드라인 후보 목록을 만든다.
 *  1. AI가 생성한 copy.headlineCandidates (있으면)
 *  2. 상품명이 fruit-facts에 매칭되면 그 hookHeadlines 2~3개를 API 비용 없이 합류
 * 정규화 기준 중복 제거 후 최대 MAX_HEADLINE_CANDIDATES(8)개.
 * 후보가 하나도 없으면 빈 배열 → 칩 영역 자체를 렌더하지 않는다(하위호환).
 */
export function buildDisplayCandidates(
  copy: CopyOutput,
  productName: string,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (raw: string) => {
    const s = raw.trim()
    if (!s) return
    const norm = normalizeHeadlineCandidate(s)
    if (!norm || seen.has(norm)) return
    seen.add(norm)
    if (out.length < MAX_HEADLINE_CANDIDATES) out.push(s)
  }

  for (const c of copy.headlineCandidates ?? []) push(c)

  // 무료 후보 합류 — fruit-facts 매칭 시 hookHeadlines 일부를 비용 없이 추가.
  const key = detectFruitFactKey(productName)
  if (key) {
    const hooks = FRUIT_FACTS[key]?.hookHeadlines ?? []
    for (const h of hooks.slice(0, FREE_CANDIDATE_MAX)) push(h)
  }

  return out
}

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


/** v2.4: 섹션 구분자 — 사과 이모지·빨강 점 제거, 여백만. */
function DotDivider() {
  return <div aria-hidden style={{ height: 8, background: "#FFFFFF" }} />
}

/**
 * v2.5 상단 배지 스트립 — 잘 팔리는 스마트스토어 표준 4대 신뢰 요소.
 * Hero 아래에 항상 노출. 검정 배경 + 흰 텍스트 + 얇은 라인 구분.
 *
 * 허위광고 방지: 강한 주장("당일 수확"/"100% 환불"/"콜드체인·봉인")은
 * 셀러가 trust에서 실제로 체크한 경우에만 노출한다. 미체크 슬롯은
 * 검증이 필요 없는 안전 문구("꼼꼼 선별"/"신선 포장")로 대체해 항상 4칸 유지.
 * TrustBadgesRow/CheckoutTrustStrip의 기존 게이팅 패턴과 동일한 원칙.
 */
function ValuePropStrip({ isMobile, trust }: { isMobile: boolean; trust?: TrustInfo }) {
  const accent = useAccent()
  const vp = t.detail.result.valueProp

  // 강한 주장(체크된 것만) 후보를 앞에 채우고, 4칸이 안 차면 안전 문구로 보충한다.
  const strong: string[] = []
  if (trust?.sameDayHarvest) strong.push(vp.sameDayHarvest)
  if (trust?.coldChain) strong.push(vp.coldChain)
  else if (trust?.sealedPackage) strong.push(vp.sealed)
  if (trust?.refundGuarantee) strong.push(vp.refund)

  // 검증 불필요한 안전 문구 (항상 참인 일반적 신선식품 표현)
  const safe: string[] = [vp.directFromFarm, vp.carefulSort, vp.freshPack]

  // 강한 주장 우선 + 안전 문구로 4칸 채움 (중복 없이)
  const items: string[] = []
  for (const s of strong) {
    if (items.length >= 4) break
    if (!items.includes(s)) items.push(s)
  }
  for (const s of safe) {
    if (items.length >= 4) break
    if (!items.includes(s)) items.push(s)
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        background: INK,
        color: "#FFFFFF",
        padding: isMobile ? "18px 0" : "32px 0",
      }}
    >
      {items.map((label, i) => (
        <div
          key={`vp-${i}`}
          style={{
            textAlign: "center",
            fontSize: isMobile ? 13 : 23,
            fontWeight: 800,
            fontFamily: BODY_FONT,
            letterSpacing: 0.5,
            borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.15)" : "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: isMobile ? 6 : 10,
          }}
        >
          <span aria-hidden style={{ color: accent.accent, fontWeight: 900 }}>✓</span>
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
  // 폰 미리보기(360/414)만 모바일 레이아웃(패딩·폰트 축소).
  // 쿠팡 780·11번가 831·스토어 860·자사몰 1000 프리셋과 ExportPanel 내보내기 폭
  // (780/831/860/1000)은 전부 이미지 매체 = 데스크톱 취급.
  // 임계값 500 = 폰 프리셋(≤414)과 쿠팡(780) 사이.
  const isMobile = previewWidth < 500

  const keyPoints: CopyKeyPoint[] = useMemo(() => {
    if (copy.keyPoints && copy.keyPoints.length >= 1) return copy.keyPoints.slice(0, 3)
    return []
  }, [copy.keyPoints])

  /**
   * v3.0: 즐기는 법(RecipeBlock)이 실제로 렌더될 때의 이미지 슬롯 수.
   * RecipeBlock 내부의 pairings.slice(0,3)와 동일한 개수를 미리 계산해
   * 이미지 배정기가 recipe 슬롯을 정확히 잡게 한다. 미매칭이면 0.
   */
  const recipeImageCount = useMemo(() => {
    const key = detectFruitFactKey(productName)
    const n = key ? FRUIT_FACTS[key]?.pairings?.length ?? 0 : 0
    return Math.min(3, n)
  }, [productName])

  /**
   * v3.0 중앙 이미지 배정 — 모든 블록이 여기서 나온 imagePlan을 소비한다.
   * (예전처럼 블록마다 images 인덱스를 따로 계산하지 않는다 → 중복·낭비 제거)
   */
  const imagePlan = useMemo(
    () => planImages(images, { keyPointCount: keyPoints.length, recipeCount: recipeImageCount }),
    [images, keyPoints.length, recipeImageCount],
  )
  const heroImage = imagePlan.hero
  const galleryImages = imagePlan.gallery

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

  // POINT 큰 카드용 이미지: 중앙 배정기(imagePlan)가 정한 슬롯 사용.
  const pointImageFor = (idx: number): UploadedImage | undefined =>
    imagePlan.keyPoints[idx]

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

  /**
   * 헤드라인 후보 칩 목록 — AI 후보 + fruit-facts 무료 후보 합류(중복 제거, 최대 8).
   * 비어 있으면(구버전 저장본/생성 실패 + 미매칭) 칩 영역 자체를 렌더하지 않는다.
   */
  const headlineCandidates = useMemo(
    () => buildDisplayCandidates(copy, productName),
    [copy, productName],
  )

  /** v2.8: 과일별 축색 팔레트 — 상품명 기반 자동 전환. */
  const accent = useMemo(() => resolveAccent(productName), [productName])

  /** v2.9: 즐기는 법 블록 노출 여부 — 과일 매칭 + pairings 있을 때만. */
  const hasRecipe = useMemo(() => {
    const key = detectFruitFactKey(productName)
    return !!(key && FRUIT_FACTS[key]?.pairings?.length)
  }, [productName])

  return (
    <AccentContext.Provider value={accent}>
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
            {/* v2.2: 상단 리본 — 시즌 자동 삽입 대신 얇은 포인트 바만 유지 (v2.8 축색) */}
            <div
              aria-hidden
              style={{
                position: "relative",
                height: 4,
                background: accent.accent,
                margin: 0,
              }}
            />

            {/* v2.4-b: 슬라이더로 오해되던 굵은 바+중앙 점 장식 삭제 (사용자 지적) */}

            {/* v2.9: HERO를 최상단으로 (수플린 레퍼런스 — 헤드/이미지/CTA가 먼저) */}
            <HeroBlock
              heroImage={heroImage}
              copy={copy}
              productName={productName}
              origin={origin}
              trust={trust}
              onCopyChange={onCopyChange}
              onRegenHeadline={renderRegen("headline")}
              onRegenSub={renderRegen("subheadline")}
              isMobile={isMobile}
              factPlaceholder={factPlaceholder}
              headlineCandidates={headlineCandidates}
              onRegenCandidates={renderRegen("headlineCandidates")}
            />

            {/* v2.5: 가치 제안 스트립 — 강한 주장은 trust 체크 시에만, 미체크는 안전 문구 */}
            <ValuePropStrip isMobile={isMobile} trust={trust} />

            {/* 2a. FreshnessTimeline — 수확일 + fruit-facts 보관 일수 (v1.8) */}
            {freshnessProps && (
              <div style={{ padding: isMobile ? "20px 24px" : "28px 44px" }}>
                <FreshnessTimeline
                  harvestDate={freshnessProps.harvestDate}
                  daysGood={freshnessProps.daysGood}
                />
              </div>
            )}

            <DotDivider />

            {/* v2.9: WHY 카드 (수플린 레퍼런스 — Hero 다음) */}
            <WhyBrandCard
              productName={productName}
              image={imagePlan.whyBrand}
              isMobile={isMobile}
            />

            {/* 1a. TRUST BADGES */}
            {trust && <TrustBadgesRow trust={trust} isMobile={isMobile} />}

            {/* 1b. CertCaption — 공식 인증 (v1.8) */}
            {trust && (trust.gapNumber?.trim() || trust.organicNumber?.trim() || trust.pesticideFreeNumber?.trim()) && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: isMobile ? 8 : 14,
                  padding: isMobile ? "12px 24px 16px" : "16px 44px 20px",
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

            {/* v2.8: 5a. 크기·중량 안내 (수플린 중량 다이어그램) */}
            <DotDivider />
            <SizeDiagramBlock
              productName={productName}
              weight={weight}
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

            {/* v2.9: 7a. 즐기는 법 (수플린 RECIPE 레퍼런스, 과일 매칭 시만) */}
            {hasRecipe && (
              <>
                <DotDivider />
                <RecipeBlock productName={productName} images={imagePlan.recipe} isMobile={isMobile} />
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

            {/* v2.8: 8a. 배송 시 구성 (수플린 박스 이미지 레퍼런스) */}
            <PackagingBlock
              image={imagePlan.packaging}
              weight={weight}
              isMobile={isMobile}
            />

            <DotDivider />

            {/* v2.8: 8b. 신선함을 잇는 4단계 (수플린 배송 흐름 레퍼런스) */}
            <DeliveryFlowBlock trust={trust} isMobile={isMobile} />

            <DotDivider />

            {/* 9. DELIVERY (정형 텍스트 상세) — 당일 발송 문구는 trust 체크 시에만 */}
            <DeliveryBlock isMobile={isMobile} trust={trust} />

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

      {/* v2.7: StickyMobileCta 삭제 (사이드바에 이미 있으므로 중복 제거) */}
    </div>
    </AccentContext.Provider>
  )
}

/* ============================================================ */
/* Section blocks                                                */
/* ============================================================ */

/**
 * v2.9 WHY 카드 (수플린 "WHY 베르데아 일까요?" 레퍼런스).
 * 흰 카드 안: WHY {상품명}일까요? 헤딩 + 중앙 이미지 + 공정 라벨 2개.
 *
 * 라벨은 keyPoints(상품 특징, KeyPointsBig에서 노출)와 겹치지 않게
 * 서비스/공정 관점(손 선별 / 안전 포장) — 고정 안전 문구.
 */
function WhyBrandCard({
  productName,
  image,
  isMobile,
}: {
  productName: string
  image?: UploadedImage
  isMobile: boolean
}) {
  const accent = useAccent()
  const name = productName.trim()
  return (
    <div style={{ padding: isMobile ? "48px 24px" : "96px 44px", background: BG_SOFT }}>
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 16,
          border: `1px solid ${LINE}`,
          padding: isMobile ? "40px 26px" : "72px 56px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: isMobile ? 30 : 52,
            fontWeight: 400,
            margin: 0,
            marginBottom: isMobile ? 28 : 40,
            lineHeight: 1.2,
            color: INK,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1,
          }}
        >
          WHY <span style={{ color: accent.accent }}>{name || "이 상품"}</span>일까요?
        </h2>

        {image && (
          <div
            style={{
              width: isMobile ? 220 : 360,
              maxWidth: "100%",
              margin: isMobile ? "0 auto 32px" : "0 auto 44px",
              borderRadius: 12,
              overflow: "hidden",
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image.url}
              alt=""
              style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}
            />
          </div>
        )}

        {/* v2.9-b: 공정 라벨(손 선별/안전 포장) 삭제 — 배송·포장 블록과 중복(리뷰 지적).
            맛 자신감 한 줄로 대체 (다른 블록과 안 겹치는 각도). */}
        <p
          style={{
            fontSize: isMobile ? 18 : 32,
            fontWeight: 700,
            color: INK,
            margin: 0,
            lineHeight: 1.6,
            fontFamily: BODY_FONT,
            letterSpacing: -0.3,
            wordBreak: "keep-all",
          }}
        >
          한 번 드셔보면, <span style={{ color: accent.accent }}>왜 여기서 사는지</span> 아실 거예요.
        </p>
      </div>
    </div>
  )
}

/**
 * v2.9 즐기는 법 (수플린 RECIPE 1/2/3 레퍼런스).
 * fruit-facts.pairings 기반 3개 페어링 카드 + 이미지 슬롯.
 * 과일 미매칭 or pairings 없으면 렌더 안 함 (환각 방지 — 없으면 안 만든다).
 */
function RecipeBlock({
  productName,
  images,
  isMobile,
}: {
  productName: string
  /** v3.0: 중앙 배정기가 pairing 순서대로 배정한 이미지(각 슬롯 1장, 없으면 undefined). */
  images: (UploadedImage | undefined)[]
  isMobile: boolean
}) {
  const accent = useAccent()
  const key = detectFruitFactKey(productName)
  const pairings = key ? FRUIT_FACTS[key]?.pairings ?? [] : []
  const items = pairings.slice(0, 3)
  if (items.length === 0) return null

  const name = productName.trim() || "이 상품"
  return (
    <div style={{ padding: isMobile ? "52px 24px" : "104px 44px", background: "#FFFFFF" }}>
      <div style={{ textAlign: "center", marginBottom: isMobile ? 32 : 48 }}>
        <div
          style={{
            fontSize: isMobile ? 13 : 22,
            color: accent.accent,
            fontWeight: 800,
            letterSpacing: 2,
            marginBottom: isMobile ? 10 : 14,
            fontFamily: BODY_FONT,
          }}
        >
          HOW TO ENJOY
        </div>
        <h2
          style={{
            fontSize: isMobile ? 30 : 50,
            fontWeight: 400,
            margin: 0,
            color: INK,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1.5,
            lineHeight: 1.15,
          }}
        >
          {name} <span style={{ color: accent.accent }}>이렇게 즐겨보세요</span>
        </h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 18 : 28 }}>
        {items.map((pairing, i) => {
          const img = images[i]
          return (
            <div
              key={`recipe-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: isMobile ? 16 : 28,
                background: "#FFFFFF",
                border: `1px solid ${LINE}`,
                borderRadius: 16,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: isMobile ? 118 : 190,
                  height: isMobile ? 118 : 190,
                  background: accent.soft,
                }}
              >
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={img.url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0, padding: isMobile ? "0 18px 0 0" : "0 32px 0 0" }}>
                <div
                  style={{
                    fontSize: isMobile ? 12 : 20,
                    color: accent.accent,
                    fontWeight: 800,
                    letterSpacing: 1.5,
                    marginBottom: isMobile ? 6 : 10,
                    fontFamily: BODY_FONT,
                  }}
                >
                  IDEA {String(i + 1).padStart(2, "0")}
                </div>
                {/* v2.9-b: "{pairing}와 함께" 삭제 — pairings에 용도(선물·이유식)가
                    섞여 조사(선물→선물과)·의미가 깨짐. pairing만 깔끔히 노출. */}
                <div
                  style={{
                    fontSize: isMobile ? 20 : 34,
                    fontWeight: 800,
                    color: INK,
                    fontFamily: BODY_FONT,
                    letterSpacing: -0.3,
                    lineHeight: 1.3,
                    wordBreak: "keep-all",
                  }}
                >
                  {pairing}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 헤드라인 후보 칩 — 편집 화면 전용 UI.
 *
 * data-edit-chrome: html-to-jpg.ts가 캡처 클론에서 [data-edit-chrome]을 제거하므로
 * (line 65: `clone.querySelectorAll("[data-edit-chrome]").forEach((el) => el.remove())`)
 * 이 칩 영역은 최종 JPG에 절대 찍히지 않는다. 따라서 편집용 작은 크기/보조 색을 써도 안전.
 *
 * - 칩 클릭 → onPick(후보) → copy.headline 즉시 교체 (인라인 편집과 공존)
 * - 현재 headline과 정규화 기준 일치하는 후보는 선택 상태로 표시
 * - 후보가 없으면 null (칩 영역 자체를 렌더하지 않음 — 하위호환)
 */
function HeadlineCandidateChips({
  candidates,
  currentHeadline,
  onPick,
  onRegenCandidates,
}: {
  candidates: string[]
  currentHeadline: string
  onPick: (next: string) => void
  onRegenCandidates: React.ReactNode
}) {
  const accent = useAccent()
  if (candidates.length === 0) return null

  const currentNorm = normalizeHeadlineCandidate(currentHeadline)
  const c = t.detail.result.headlineCandidates

  return (
    <div
      data-edit-chrome
      style={{
        marginTop: 18,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: MUTE,
          letterSpacing: 0.3,
          fontFamily: BODY_FONT,
        }}
      >
        {c.label}
      </span>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 8,
          maxWidth: 640,
        }}
      >
        {candidates.map((cand, i) => {
          const selected = normalizeHeadlineCandidate(cand) === currentNorm
          return (
            <button
              key={`hc-${i}`}
              type="button"
              onClick={() => onPick(cand)}
              aria-pressed={selected}
              title={selected ? c.selected : c.pick}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "6px 13px",
                borderRadius: 999,
                fontSize: 13.5,
                fontWeight: selected ? 700 : 500,
                fontFamily: BODY_FONT,
                lineHeight: 1.3,
                cursor: "pointer",
                whiteSpace: "nowrap",
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: selected ? "#FFFFFF" : SUB,
                background: selected ? accent.accent : "#FFFFFF",
                border: `1px solid ${selected ? accent.accent : LINE}`,
                transition: "background 0.12s ease, border-color 0.12s ease",
              }}
            >
              {selected && (
                <span aria-hidden style={{ fontSize: 11, fontWeight: 900 }}>
                  ✓
                </span>
              )}
              <span
                style={{ overflow: "hidden", textOverflow: "ellipsis" }}
              >
                {cand}
              </span>
            </button>
          )
        })}
        {onRegenCandidates}
      </div>
    </div>
  )
}

function HeroBlock({
  heroImage,
  copy,
  productName,
  origin,
  trust,
  onCopyChange,
  onRegenHeadline,
  onRegenSub,
  isMobile,
  factPlaceholder,
  headlineCandidates,
  onRegenCandidates,
}: {
  heroImage?: UploadedImage
  copy: CopyOutput
  productName: string
  origin?: string
  trust?: TrustInfo
  onCopyChange: (next: CopyOutput) => void
  onRegenHeadline: React.ReactNode
  onRegenSub: React.ReactNode
  isMobile: boolean
  factPlaceholder?: { headline: string; sub: string; highlightBox: string } | null
  /** AI + fruit-facts 무료 합류 후보(중복 제거·최대 8). 비면 칩 미표시. */
  headlineCandidates: string[]
  /** "후보 새로 받기" 재생성 노드 (data-edit-chrome — JPG 제외). */
  onRegenCandidates: React.ReactNode
}) {
  const accent = useAccent()
  const name = productName.trim()
  const originText = origin?.trim()
  const producer = trust?.producerName?.trim()
  const ctaText = producer
    ? `${producer} 농가를 만나보세요`
    : `신선한 ${name || "이 상품"}, 지금 담아보세요`
  return (
    <div style={{ background: "#FFFFFF" }}>
      {/* v2.9: 상단 캡션 + 대형 헤드 (수플린 레퍼런스 — 헤드가 이미지 위) */}
      <div
        style={{
          padding: isMobile ? "44px 24px 30px" : "72px 44px 40px",
          textAlign: "center",
          background: accent.soft,
        }}
      >
        {(name || originText) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexWrap: "wrap",
              gap: isMobile ? 8 : 12,
              marginBottom: isMobile ? 18 : 24,
            }}
          >
            {name && (
              <span
                style={{
                  fontSize: isMobile ? 15 : 26,
                  color: SUB,
                  fontWeight: 600,
                  fontFamily: BODY_FONT,
                }}
              >
                오늘도 신선한 {name}
              </span>
            )}
            {originText && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: isMobile ? "5px 14px" : "8px 20px",
                  borderRadius: 999,
                  background: accent.accent,
                  color: "#FFFFFF",
                  fontSize: isMobile ? 13 : 22,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  fontFamily: BODY_FONT,
                }}
              >
                From. {originText}
              </span>
            )}
          </div>
        )}
        <h1
          style={{
            fontSize: isMobile ? 52 : 90,
            fontWeight: 400,
            margin: 0,
            color: INK,
            lineHeight: 1.08,
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

        {/* 헤드라인 후보 칩 — 편집 전용(data-edit-chrome → JPG 캡처 제외). */}
        <HeadlineCandidateChips
          candidates={headlineCandidates}
          currentHeadline={copy.headline}
          onPick={(next) => onCopyChange({ ...copy, headline: next })}
          onRegenCandidates={onRegenCandidates}
        />
      </div>

      {/* 대표 이미지 */}
      <div style={{ position: "relative", background: accent.soft }}>
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
              fontSize: isMobile ? 15 : 24,
              fontStyle: "italic",
            }}
          >
            여기에 대표 이미지가 들어갑니다
          </div>
        )}
      </div>

      {/* 하단: 설명 서브카피 + CTA pill */}
      <div
        style={{
          padding: isMobile ? "32px 24px 44px" : "52px 44px 64px",
          textAlign: "center",
        }}
      >
        {/* v2.9: 서브카피 — 대문자 액센트 → 설명형 회색 (수플린 톤) */}
        <p
          style={{
            fontSize: isMobile ? 17 : 30,
            color: SUB,
            margin: 0,
            marginBottom: isMobile ? 24 : 32,
            lineHeight: 1.6,
            fontFamily: BODY_FONT,
            fontWeight: 500,
            wordBreak: "keep-all",
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

        {/* CTA pill (수플린 "○○를 선택하세요!" 레퍼런스) */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: isMobile ? "14px 28px" : "20px 44px",
            borderRadius: 999,
            background: INK,
            color: "#FFFFFF",
            fontSize: isMobile ? 17 : 30,
            fontWeight: 800,
            fontFamily: BODY_FONT,
            letterSpacing: -0.3,
          }}
        >
          {ctaText}
        </div>

        {(onRegenHeadline || onRegenSub) && (
          <div
            data-edit-chrome
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
              gap: isMobile ? 8 : 12,
              justifyContent: "center",
              marginTop: isMobile ? 24 : 32,
            }}
          >
            {copy.highlightBadges.slice(0, 4).map((b, i) => (
              <span
                key={`b-${i}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: isMobile ? 5 : 8,
                  padding: isMobile ? "8px 16px" : "12px 24px",
                  borderRadius: 999,
                  background: accent.accent,
                  color: "#FFFFFF",
                  fontSize: isMobile ? 13 : 22,
                  fontWeight: 700,
                  fontFamily: BODY_FONT,
                  boxShadow: `0 2px 6px ${accent.accent}40`,
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: isMobile ? 18 : 26,
                    height: isMobile ? 18 : 26,
                    borderRadius: "50%",
                    background: "#FFFFFF",
                    color: accent.accent,
                    fontSize: isMobile ? 11 : 15,
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
        padding: isMobile ? "52px 24px" : "104px 56px",
        background: "#FFFFFF",
        position: "relative",
      }}
    >
      {/* v2.5: 큰따옴표 삭제 → STORY 캡션 라벨로 대체 (스마트스토어 톤) */}
      {hasStory && (
        <div
          style={{
            textAlign: "center",
            marginBottom: isMobile ? 28 : 36,
          }}
        >
          <span
            style={{
              display: "inline-block",
              padding: isMobile ? "7px 16px" : "10px 22px",
              background: INK,
              color: "#FFFFFF",
              fontSize: isMobile ? 13 : 20,
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
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 18 : 30,
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
          marginTop: isMobile ? 56 : 88,
          padding: isMobile ? "44px 24px" : "80px 40px",
          background: INK,
          textAlign: "center",
          maxWidth: 760,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 44 : 84,
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
        <div data-edit-chrome style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
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
  // v3.0: 5장 고정 제거 — 중앙 배정기(imagePlan.gallery)가 남은 사진 수에 맞춰
  // 최대 8장까지 넘겨준다. 여기선 그대로 전부 렌더(featured 1 + grid 나머지).
  const [featured, ...rest] = images
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
  const accent = useAccent()
  const specCount = copy.spec.length
  // 4개 이상이면 2열, 3개면 1열(좁은 모바일)/2열(데스크탑) 자동 — 항상 2열로 통일하되 홀수 시 마지막 카드가 가득 차도록 grid auto-fit 흉내
  const columns = specCount <= 1 ? "1fr" : "repeat(2, minmax(0, 1fr))"
  return (
    <div
      style={{
        padding: isMobile ? "44px 24px" : "96px 44px",
        background: BG_SOFT,
      }}
    >
      <SectionTitle title={t.detail.result.spec} regen={onRegen} isMobile={isMobile} />

      {specCount > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: columns,
            gap: isMobile ? 10 : 16,
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
                  borderRadius: 14,
                  padding: isMobile ? "24px 24px" : "32px 34px",
                  display: "flex",
                  flexDirection: "column",
                  gap: isMobile ? 12 : 16,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    fontSize: isMobile ? 14 : 22,
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
                      gap: isMobile ? 6 : 10,
                      lineHeight: 1,
                      color: accent.accent,
                      fontFamily: DISPLAY_FONT,
                    }}
                  >
                    {/* v2.5: 당도 대형 숫자 — 임무D 확대(모바일 64 / 데스크톱 108, 시각 앵커) */}
                    <span style={{ fontSize: isMobile ? 64 : 108, fontWeight: 400, letterSpacing: -3 }}>
                      {sweetnessMatch[1]}
                    </span>
                    <span
                      style={{
                        fontSize: isMobile ? 15 : 26,
                        fontWeight: 800,
                        color: accent.dark,
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
                      fontSize: isMobile ? 22 : 40,
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
            borderRadius: 12,
            border: `1px solid ${LINE}`,
            padding: isMobile ? "24px" : "36px",
            textAlign: "center",
            color: PLACEHOLDER,
            fontSize: isMobile ? 15 : 24,
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
  const accent = useAccent()
  return (
    <div style={{ background: "#FFFFFF" }}>
      <div
        style={{
          padding: isMobile ? "56px 24px 32px" : "112px 44px 52px",
          textAlign: "center",
        }}
      >
        {/* 임무D: 섹션 헤드 — 히어로급 임팩트 (모바일 42 / 데스크톱 76) */}
        <h2
          style={{
            fontSize: isMobile ? 42 : 76,
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
        // v2.8: POINT 배경 변주 — 흰 / 옅은 회색 / 과일 축색 soft 틴트
        const bgTints = ["#FFFFFF", "#FAFBFC", accent.soft]
        const bg = bgTints[i % bgTints.length]
        return (
          <div
            key={`kp-big-${i}`}
            style={{
              position: "relative",
              padding: isMobile ? "48px 24px 64px" : "88px 56px 104px",
              background: bg,
            }}
          >
            {/* 좌측 세로 축색 바 */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: isMobile ? 12 : 24,
                top: isMobile ? 48 : 88,
                bottom: isMobile ? 64 : 104,
                width: isMobile ? 6 : 9,
                background: accent.accent,
                borderRadius: 4,
              }}
            />
            <div style={{ paddingLeft: isMobile ? 16 : 32, position: "relative" }}>
              {/* 임무D: 배경 넘버 — 스케일에 맞춰 강화(모바일 150 / 데스크톱 240), 얇은 회색선 */}
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  right: 0,
                  top: isMobile ? -48 : -60,
                  fontSize: isMobile ? 150 : 240,
                  fontWeight: 900,
                  color: "transparent",
                  WebkitTextStroke: `${isMobile ? 2 : 3}px ${LINE}`,
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
                  padding: isMobile ? "7px 16px" : "10px 22px",
                  background: accent.accent,
                  color: "#FFF",
                  fontSize: isMobile ? 13 : 22,
                  fontWeight: 800,
                  letterSpacing: 2.5,
                  marginBottom: isMobile ? 20 : 28,
                  fontFamily: BODY_FONT,
                  position: "relative",
                  zIndex: 1,
                }}
              >
                POINT {p.num}
              </div>
              <h3
                style={{
                  fontSize: isMobile ? 34 : 56,
                  fontWeight: 400,
                  margin: 0,
                  marginBottom: isMobile ? 22 : 28,
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
                  fontSize: isMobile ? 17 : 28,
                  color: SUB,
                  lineHeight: 1.8,
                  margin: 0,
                  marginBottom: isMobile ? 32 : 44,
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
        padding: isMobile ? "44px 24px" : "96px 44px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.storage} regen={onRegen} isMobile={isMobile} />
      <div
        style={{
          padding: isMobile ? "24px 24px" : "40px 44px",
          background: "#FFFFFF",
          borderRadius: 6,
          border: `1px solid ${LINE}`,
        }}
      >
        {/* v2.2: 값 유무 상관 없이 항상 EditableResultText — 편집 진입 가능 */}
        <p
          style={{
            fontSize: isMobile ? 16 : 27,
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
        padding: isMobile ? "44px 24px" : "96px 44px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.faq} regen={onRegen} isMobile={isMobile} />
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 12,
          border: `1px solid ${LINE}`,
          overflow: "hidden",
        }}
      >
        {copy.faq.map((_f, i) => (
          <div
            key={`faq-${i}`}
            style={{
              padding: isMobile ? "20px 22px" : "32px 38px",
              borderBottom:
                i < copy.faq.length - 1 ? `1px solid ${LINE}` : "none",
            }}
          >
            {/* v2.4: ▼ 화살표·빨강 Q. 삭제 → Q./A. 미니멀 표기 */}
            <p
              style={{
                fontSize: isMobile ? 17 : 30,
                fontWeight: 700,
                color: INK,
                margin: 0,
                marginBottom: isMobile ? 10 : 14,
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
                fontSize: isMobile ? 16 : 28,
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

/**
 * v2.8 크기·중량 안내 (수플린 아보카도 중량 다이어그램 레퍼런스).
 * 3단계 상대 크기 원(소과/중과/대과) + 중량 표기 + 정직한 편차 안내.
 * 실제 g 수치는 환각 방지를 위해 만들지 않고, 셀러가 입력한 weight만 노출.
 */
function SizeDiagramBlock({
  productName,
  weight,
  isMobile,
}: {
  productName?: string
  weight?: string
  isMobile: boolean
}) {
  const accent = useAccent()
  // 임무D: scale을 0.5/0.75/1.0으로 더 벌려 대·중·소 대비를 명확히.
  const tiers = [
    { label: "소과", scale: 0.5 },
    { label: "중과", scale: 0.75 },
    { label: "대과", scale: 1 },
  ]
  // 전체 크기 확대 — 흰 배경에서 뭉개지지 않도록 원을 키운다.
  const maxSize = isMobile ? 120 : 190
  const name = productName?.trim() || "이 상품"
  return (
    <div style={{ padding: isMobile ? "44px 24px" : "96px 44px", background: "#FFFFFF" }}>
      <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, marginBottom: 8 }}>
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: isMobile ? 30 : 44,
            height: isMobile ? 30 : 44,
            borderRadius: "50%",
            background: accent.accent,
            color: "#FFFFFF",
            fontSize: isMobile ? 16 : 24,
            fontWeight: 900,
            flexShrink: 0,
          }}
        >
          ✓
        </span>
        <h2
          style={{
            fontSize: isMobile ? 30 : 52,
            fontWeight: 400,
            margin: 0,
            color: INK,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1,
            lineHeight: 1.1,
          }}
        >
          {name} 크기가 <span style={{ color: accent.accent }}>궁금해요</span>
        </h2>
      </div>

      {/* 상대 크기 3원 + 라벨 — 채움은 3개 동일(등급 오독 방지), 대비는 굵은 테두리로 확보 */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          gap: isMobile ? 32 : 60,
          padding: isMobile ? "36px 0 32px" : "56px 0 44px",
        }}
      >
        {tiers.map((tier) => {
          const d = Math.round(maxSize * tier.scale)
          return (
            <div key={tier.label} style={{ textAlign: "center" }}>
              <div
                aria-hidden
                style={{
                  width: d,
                  height: d,
                  borderRadius: "50%",
                  background: accent.soft,
                  // 임무D: 테두리 2→4px(모바일 3)로 굵혀 흰 배경 대비 확보. 크기별 색 농도 차이는 두지 않음.
                  border: `${isMobile ? 3 : 4}px solid ${accent.accent}`,
                  margin: isMobile ? "0 auto 16px" : "0 auto 22px",
                }}
              />
              <div
                style={{
                  fontSize: isMobile ? 16 : 26,
                  fontWeight: 800,
                  color: INK,
                  fontFamily: BODY_FONT,
                }}
              >
                {tier.label}
              </div>
            </div>
          )
        })}
      </div>

      {weight?.trim() && (
        <div
          style={{
            textAlign: "center",
            fontSize: isMobile ? 16 : 26,
            color: SUB,
            marginBottom: isMobile ? 20 : 28,
            fontFamily: BODY_FONT,
          }}
        >
          중량 구성 · <strong style={{ color: INK }}>{weight.trim()}</strong>
        </div>
      )}

      {/* 정직한 편차 안내 — 경고 톤 회피: 중립 회색 배경/회색 강조로 (accent 제거) */}
      <div
        style={{
          padding: isMobile ? "18px 20px" : "26px 32px",
          background: BG_SOFT,
          border: `1px solid ${LINE}`,
          borderRadius: 12,
          fontSize: isMobile ? 15 : 24,
          color: SUB,
          lineHeight: 1.7,
          fontFamily: BODY_FONT,
        }}
      >
        <strong style={{ color: INK }}>꼭 확인해 주세요</strong>
        <br />
        과일 특성상 크기가 일정하지 않아요. 실제 크기와 외형에 다소 차이가 있을 수 있으니 참고 부탁드려요.
      </div>
    </div>
  )
}

/**
 * v2.8 신선함을 잇는 4단계 (수플린 FARM→AIR→COLD→HOME 레퍼런스).
 * 국내 산지직송에 맞게 각색: 수확 → 손 선별·포장 → 출고 → 문 앞 도착.
 *
 * v2.8-b: "당일 수확 / 당일 포장 / 콜드체인" 은 셀러가 trust에서 실제 체크한 경우에만 강한 문구로.
 * 미체크 시 일반화 문구 — 다른 신뢰 요소(TrustBadgesRow 등)와 동일한 게이팅 원칙 준수 (허위광고 방지).
 */
function DeliveryFlowBlock({ trust, isMobile }: { trust?: TrustInfo; isMobile: boolean }) {
  const accent = useAccent()
  const sameDay = !!trust?.sameDayHarvest
  const cold = !!trust?.coldChain
  const steps = [
    {
      title: "산지 수확",
      desc: sameDay ? "아침 일찍 산지에서 그날 딴 것만" : "산지에서 수확한 신선한 상품을",
    },
    {
      title: "손 선별·포장",
      desc: sameDay ? "상태 좋은 것만 하나씩 골라 당일 포장" : "상태 좋은 것만 하나씩 골라 포장",
    },
    {
      title: cold ? "콜드체인 출고" : "포장·출고",
      desc: cold ? "신선도를 지키는 냉장 상태로 출고" : "신선하게 포장해 바로 출고",
    },
    { title: "문 앞 도착", desc: "완충 포장으로 신선하게 문 앞까지" },
  ]
  return (
    <div style={{ padding: isMobile ? "52px 24px" : "104px 44px", background: BG_SOFT }}>
      <div style={{ textAlign: "center", marginBottom: isMobile ? 32 : 48 }}>
        <div
          style={{
            fontSize: isMobile ? 15 : 26,
            color: SUB,
            fontWeight: 600,
            marginBottom: isMobile ? 10 : 14,
            fontFamily: BODY_FONT,
          }}
        >
          산지에서 문 앞까지
        </div>
        <h2
          style={{
            fontSize: isMobile ? 34 : 60,
            fontWeight: 400,
            margin: 0,
            color: INK,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1.5,
            lineHeight: 1.1,
          }}
        >
          신선함을 잇는 <span style={{ color: accent.accent }}>4단계</span>
        </h2>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {steps.map((step, i) => (
          <div
            key={step.title}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: isMobile ? 16 : 28,
              padding: isMobile ? "20px 0" : "32px 0",
              borderBottom: i < steps.length - 1 ? `1px solid ${LINE}` : "none",
            }}
          >
            <div
              aria-hidden
              style={{
                flexShrink: 0,
                width: isMobile ? 48 : 72,
                height: isMobile ? 48 : 72,
                borderRadius: "50%",
                background: accent.accent,
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: isMobile ? 24 : 38,
                fontWeight: 400,
                fontFamily: DISPLAY_FONT,
              }}
            >
              {i + 1}
            </div>
            <div style={{ flex: 1, minWidth: 0, paddingTop: isMobile ? 4 : 8 }}>
              <div
                style={{
                  fontSize: isMobile ? 20 : 30,
                  fontWeight: 800,
                  color: INK,
                  marginBottom: isMobile ? 6 : 10,
                  fontFamily: BODY_FONT,
                  letterSpacing: -0.3,
                }}
              >
                {step.title}
              </div>
              <div
                style={{
                  fontSize: isMobile ? 15 : 26,
                  color: SUB,
                  lineHeight: 1.6,
                  fontFamily: BODY_FONT,
                }}
              >
                {step.desc}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * v2.8 배송 시 구성 (수플린 박스 이미지 + 옵션 레퍼런스).
 * 대표 이미지 + 중량 구성 + 완충 포장 안내. 이미지 없으면 안내만.
 */
function PackagingBlock({
  image,
  weight,
  isMobile,
}: {
  image?: UploadedImage
  weight?: string
  isMobile: boolean
}) {
  const accent = useAccent()
  return (
    <div style={{ padding: isMobile ? "52px 24px" : "104px 44px", background: "#FFFFFF" }}>
      <div style={{ textAlign: "center", marginBottom: isMobile ? 32 : 48 }}>
        <div
          style={{
            fontSize: isMobile ? 13 : 22,
            color: accent.accent,
            fontWeight: 800,
            letterSpacing: 2,
            marginBottom: isMobile ? 10 : 14,
            fontFamily: BODY_FONT,
          }}
        >
          PACKAGE
        </div>
        <h2
          style={{
            fontSize: isMobile ? 30 : 52,
            fontWeight: 400,
            margin: 0,
            color: INK,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1.5,
            lineHeight: 1.15,
          }}
        >
          배송 시 이렇게 <span style={{ color: accent.accent }}>구성돼요</span>
        </h2>
      </div>

      {image && (
        <div
          style={{
            borderRadius: 12,
            overflow: "hidden",
            marginBottom: isMobile ? 24 : 32,
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt="배송 구성"
            style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }}
          />
        </div>
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isMobile ? 12 : 18,
          padding: isMobile ? "22px 24px" : "34px 40px",
          background: accent.soft,
          borderRadius: 12,
        }}
      >
        {weight?.trim() && (
          <div style={{ display: "flex", alignItems: "baseline", gap: isMobile ? 12 : 18 }}>
            <span
              style={{
                flexShrink: 0,
                fontSize: isMobile ? 14 : 22,
                fontWeight: 800,
                color: accent.dark,
                fontFamily: BODY_FONT,
              }}
            >
              중량
            </span>
            <span style={{ fontSize: isMobile ? 16 : 28, fontWeight: 700, color: INK, fontFamily: BODY_FONT }}>
              {weight.trim()}
            </span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "baseline", gap: isMobile ? 12 : 18 }}>
          <span
            style={{
              flexShrink: 0,
              fontSize: isMobile ? 14 : 22,
              fontWeight: 800,
              color: accent.dark,
              fontFamily: BODY_FONT,
            }}
          >
            포장
          </span>
          <span style={{ fontSize: isMobile ? 15 : 26, color: SUB, lineHeight: 1.6, fontFamily: BODY_FONT }}>
            완충재로 흔들림 없이 담아, 신선한 상태 그대로 보내드려요.
          </span>
        </div>
      </div>
    </div>
  )
}

function DeliveryBlock({ isMobile, trust }: { isMobile: boolean; trust?: TrustInfo }) {
  // 허위광고 방지: "당일 발송" 확정 약속은 셀러가 sameDayHarvest를 체크한 경우에만 노출.
  const sameDay = !!trust?.sameDayHarvest
  return (
    <div
      style={{
        padding: isMobile ? "44px 24px" : "96px 44px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.deliveryTitle} isMobile={isMobile} />
      {/* v2.4: 초록 배경·주황 원형 이모지 삭제 → 얇은 라인 카드 */}
      <div
        style={{
          padding: isMobile ? "24px 24px" : "40px 44px",
          background: "#FFFFFF",
          borderRadius: 6,
          border: `1px solid ${LINE}`,
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 16 : 27,
            color: INK,
            lineHeight: 1.85,
            margin: 0,
            fontFamily: BODY_FONT,
          }}
        >
          {t.detail.result.deliveryBody}
          {sameDay && ` ${t.detail.result.deliverySameDayNote}`}
        </p>
      </div>
    </div>
  )
}

function TrustBadgesRow({ trust, isMobile }: { trust: TrustInfo; isMobile: boolean }) {
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
        gap: isMobile ? 7 : 10,
        padding: isMobile ? "16px 24px 24px" : "20px 40px 32px",
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
            padding: isMobile ? "6px 12px" : "9px 18px",
            background: "#FFFFFF",
            border: `1px solid ${LINE}`,
            color: SUB,
            borderRadius: 999,
            fontSize: isMobile ? 13 : 21,
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
  const accent = useAccent()
  return (
    <div
      style={{
        padding: isMobile ? "48px 24px" : "104px 44px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.recommendForTitle} isMobile={isMobile} />
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 14,
          border: `1px solid ${LINE}`,
          padding: isMobile ? "24px 26px" : "40px 44px",
          display: "flex",
          flexDirection: "column",
          gap: isMobile ? 16 : 22,
        }}
      >
        {items.slice(0, 6).map((it, i) => (
          <div
            key={`r-${i}`}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: isMobile ? 12 : 18,
              fontSize: isMobile ? 17 : 28,
              color: INK,
              lineHeight: 1.55,
              fontFamily: BODY_FONT,
              paddingBottom: i < Math.min(items.length, 6) - 1 ? (isMobile ? 16 : 22) : 0,
              borderBottom:
                i < Math.min(items.length, 6) - 1
                  ? `1px solid ${LINE}`
                  : "none",
            }}
          >
            {/* v2.3: 색점 삭제 → 체크 아이콘 하나만 (v2.8 축색) */}
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                marginTop: isMobile ? 2 : 4,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: isMobile ? 24 : 34,
                height: isMobile ? 24 : 34,
                borderRadius: "50%",
                background: accent.accent,
                color: "#FFFFFF",
                fontSize: isMobile ? 14 : 20,
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
        padding: isMobile ? "48px 24px" : "104px 44px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.farmStoryTitle} isMobile={isMobile} />

      {/* v1.8: trust에 농부 정보 있으면 ProducerCard로 노출 */}
      {hasProducer && (
        <div style={{ marginBottom: isMobile ? 20 : 28 }}>
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
          padding: isMobile ? "32px 26px" : "56px 60px",
          background: BG_SOFT,
          borderRadius: 14,
          border: `1px solid ${LINE}`,
          position: "relative",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: isMobile ? 14 : 20,
          }}
        >
            {/* v2.5: 판매문구 느낌 — Pretendard 700 + 굵기 대비 (세리프 X) */}
            <p
              style={{
                fontSize: isMobile ? 19 : 32,
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
                fontSize: isMobile ? 14 : 22,
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
        padding: isMobile ? "44px 24px" : "96px 44px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.returnsTitle} isMobile={isMobile} />
      {/* v2.4: 원형 이모지·BG_SOFT 배경 삭제 → 얇은 라인 카드 */}
      <div
        style={{
          padding: isMobile ? "24px 24px" : "40px 44px",
          background: "#FFFFFF",
          borderRadius: 6,
          border: `1px solid ${LINE}`,
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 16 : 27,
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
        padding: isMobile ? "44px 24px 52px" : "96px 44px 120px",
        background: "#FFFFFF",
      }}
    >
      {/* v2.4: 빨강·노랑 경고 박스 삭제 → 얇은 회색 라인 카드 하나로 통합 */}
      <div
        style={{
          padding: isMobile ? "24px 24px" : "40px 44px",
          background: "#FFFFFF",
          borderRadius: 6,
          border: `1px solid ${LINE}`,
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 15 : 25,
            color: SUB,
            lineHeight: 1.75,
            margin: 0,
            marginBottom: cautions.length > 0 ? (isMobile ? 20 : 28) : 0,
            fontFamily: BODY_FONT,
          }}
        >
          {t.detail.result.cautionsAutoNotice}
        </p>
        {cautions.length > 0 && (
          <>
            <h3
              style={{
                fontSize: isMobile ? 17 : 28,
                fontWeight: 700,
                color: INK,
                margin: 0,
                marginBottom: isMobile ? 12 : 16,
                fontFamily: BODY_FONT,
              }}
            >
              {t.detail.result.cautionsTitle}
            </h3>
            <ul
              style={{
                margin: 0,
                paddingLeft: isMobile ? 20 : 26,
                display: "flex",
                flexDirection: "column",
                gap: isMobile ? 8 : 12,
              }}
            >
              {cautions.map((c, i) => (
                <li
                  key={`c-${i}`}
                  style={{
                    fontSize: isMobile ? 15 : 25,
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
  isMobile,
}: {
  title: string
  regen?: React.ReactNode
  /** 폰 미리보기(≤414)면 축소 스케일. 미지정 시 데스크톱(이미지 매체) 크기. */
  isMobile?: boolean
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: isMobile ? 24 : 36,
      }}
    >
      {/* 임무D: 섹션 h2 — 이미지 매체 표준으로 대형화 (모바일 30 / 데스크톱 52) */}
      <h2
        style={{
          fontSize: isMobile ? 30 : 52,
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
