"use client"

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { t } from "@/lib/i18n"
import type { CopyOutput, CopyKeyPoint, TrustInfo, SellerReview, ProductCategory } from "@/lib/ai/types"
import type { SectionId } from "@/lib/ai/section-regenerate"
import type { UploadedImage } from "./ImageUploader"
import { ExportPanel } from "./ExportPanel"
import { EditableResultText } from "./EditableResultText"
import { RegenButton } from "./RegenButton"
import { CertCaption } from "./CertCaption"
import { FreshnessTimeline } from "./FreshnessTimeline"
import { ProducerCard } from "./ProducerCard"
import { DisclosureBlock } from "./DisclosureBlock"
// v2.7: StickyMobileCta 삭제 (중앙 하단 복사/다운로드 버튼 제거 지시)
import { QualityScoreCard } from "./QualityScoreCard"
import { ResearchSummaryPanel } from "./ResearchSummaryPanel"
import { WidthPresetSwitcher, WIDTH_PRESETS, type WidthPresetKey } from "./WidthPresetSwitcher"
// v2.6: WorkJsonExporter 삭제 (사이드바 3개 액션 제거 지시)
import { checkComplianceReport } from "@/lib/ai/compliance-report"
import { scoreCopyQuality } from "@/lib/ai/copy-quality-score"
import {
  MAX_HEADLINE_CANDIDATES,
  normalizeHeadlineCandidate,
} from "@/lib/ai/validate"
import {
  detectFruitFactKey,
  FRUIT_FACTS,
  isHookHeadlineCompatible,
  isHeadlineOriginCompatible,
  getAvgWeightG,
  estimateCountLabel,
} from "@/domain/fruit-facts"
import { resolveAccent, DEFAULT_ACCENT, type AccentPalette } from "./fruit-accent"
import {
  PackIcon,
  FLOW_STEP_ICONS,
  HarvestIcon,
  SortIcon,
  DeliverIcon,
  ColdIcon,
  SealIcon,
  ShieldIcon,
  BrixIcon,
  MapPinIcon,
  ScaleIcon,
  LeafIcon,
  type LineIconProps,
} from "./LineIcons"

/**
 * A3(카테고리 명사) — 고정 문구의 "과일" 자리를 카테고리에 맞춰 치환.
 * fruit→과일 / veggie→채소 / other→상품. {noun} 토큰 치환에도 쓴다.
 */
function categoryNoun(category?: ProductCategory): string {
  if (category === "veggie") return "채소"
  if (category === "other") return "상품"
  return "과일"
}

/** 주격 조사 이/가 — 마지막 글자 받침 유무로 선택 (과일→이, 채소→가). */
function subjectJosa(word: string): string {
  const code = word.charCodeAt(word.length - 1)
  if (code < 0xac00 || code > 0xd7a3) return "이(가)"
  return (code - 0xac00) % 28 === 0 ? "가" : "이"
}

/**
 * C12: 특정 지역이 아닌 일반 산지 표기("국내산/수입산/해외산"류) 판별.
 * 이런 값은 "From. {origin}" 배지로 띄우면 산지 신뢰 장치로 오독되므로 숨긴다.
 */
const GENERIC_ORIGINS = ["국내산", "수입산", "해외산", "국산", "원산지", "미상"]
function isGenericOrigin(origin: string): boolean {
  const o = origin.trim()
  return GENERIC_ORIGINS.some((g) => o === g)
}

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
  /**
   * v3.7: 포장 전용 슬롯 사진. 있으면 PackagingBlock("이렇게 배송되어요")에 그 사진 사용.
   * 없으면(null/undefined) PackagingBlock 섹션 자체 미노출 — 일반 풀 사진으로 대체하지 않는다.
   * 일반 풀(images)과 분리된 별도 입력이라 planImages 배정에 포함하지 않는다.
   */
  packagingImage?: UploadedImage | null
  /**
   * v3.7: 크기 비교 전용 슬롯 사진(손·동전·자와 함께). 있으면 크기 섹션에 사진 렌더.
   * 없으면 크기 섹션은 기존 동작(무게 데이터 있으면 카드만, 없으면 미노출).
   */
  sizeImage?: UploadedImage | null
  productName: string
  price: number
  origin?: string
  weight?: string
  /** 상품 카테고리 — 고정 문구의 명사 치환(과일/채소/상품)에 사용 (A3). */
  category?: ProductCategory
  trust?: TrustInfo
  /**
   * 고객 후기 — 셀러 직접 입력(AI 생성 아님). 0건이면 ReviewsBlock 미노출.
   * CopyOutput이 아니라 입력 흐름(CopyInput.reviews)에서 내려온다.
   */
  reviews?: SellerReview[]
  onRetry: () => void
  onCopyChange: (next: CopyOutput) => void
  onSectionRegenerate?: (sectionId: SectionId) => Promise<void>
  busySection?: SectionId | null
}

const RED = "#E03131" // 사이드바 편집 컨트롤용 브랜드 색 (내보내는 페이지엔 accent 사용)
const INK = "#212529"
const SUB = "#495057"
const MUTE = "#6E7480"
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
  /**
   * v3.7: PackagingBlock은 전용 슬롯(packagingImage prop)만 쓰도록 바뀌어 이 배정을
   * 더 이상 소비하지 않는다. 항상 undefined — 일반 풀 사진이 포장 섹션에 새어 들어가지
   * 않게 한다(무관 사진 배정 사고 방지). 필드는 타입 안정성을 위해 남겨 둔다.
   */
  packaging?: UploadedImage
  /** 크기 비교 블록용 — "실제 크기 참고" 사진 1장. 남는 사진이 없으면 undefined. */
  sizeRef?: UploadedImage
  /**
   * 임팩트 카피-사진 밀착 블록(SensoryPunch)용 분위기 컷 1장.
   * galleryPool(아직 안 쓴 사진) 우선, 없으면 hero 재사용 허용(분위기 컷이라 중복 OK).
   * 사진 자체가 0장이면 undefined.
   */
  punch?: UploadedImage
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
      sizeRef: undefined,
      punch: undefined,
      gallery: [],
    }
  }

  const hero = images[0]
  // hero를 뺀 전체 후보 풀.
  const restAll = images.slice(1)

  /**
   * v3.8 fix(진단 #1): 갤러리 모자이크가 아예 안 뜨던 사고 교정.
   * 예전엔 whyBrand + keyPoints(3) + punch 가 rest 사진을 전부 빨아들여(6장 시나리오에서
   * 5장 rest 를 whyBrand·POINT 3장·punch 로 소비) 갤러리가 0장이 되고, 그래서
   * buildGalleryRows 의 [풀폭↔2그리드] 리듬이 페이지에 단 한 번도 렌더되지 않았다.
   *
   * 교정: 사진이 넉넉하면(hero 제외 rest 가 GALLERY_RESERVE_THRESHOLD 이상) rest 의 뒤쪽
   * 일부를 "갤러리 전용"으로 떼어 특징 슬롯 후보에서 제외한다. 이렇게 떼어낸 사진은
   * 특징 블록에 절대 안 쓰이므로 블록 간 중복 0 원칙을 지키면서, 갤러리에 모자이크가
   * 성립할 최소 장수(풀폭1 + 2그리드 = 3장)를 확보한다.
   *
   * 특징 슬롯(whyBrand/keyPoints/punch)은 사진이 없어도 각각 텍스트/틴트로 우아하게
   * 렌더되므로(규칙 ③④ + SensoryPunchBlock 틴트 폴백) 슬롯 하나가 사진을 잃어도 회귀 아님.
   * 결정적: 항상 뒤쪽 N장을 고정 예약 — 같은 입력이면 같은 결과. Math.random 없음.
   *
   * 예약 장수 계산:
   *  - 모자이크(풀폭1 + 2그리드)가 성립하려면 갤러리에 최소 GALLERY_RESERVE_TARGET(3)장 필요.
   *  - 단, 특징 슬롯이 완전히 굶지 않도록 whyBrand + POINT 1장분(FEATURE_KEEP=2)은 rest 에 남긴다.
   *  - 그래서 예약 = min(목표 3, rest - 특징 최소 확보 2). rest 가 5장 이상일 때만 예약이 켜진다.
   *    (rest 5 → 예약 3, 특징 후보 2 남음 / rest 4 → 예약 2 / rest 3 이하 → 예약 0, 기존 동작.)
   */
  const GALLERY_RESERVE_TARGET = 3 // 모자이크 성립 최소 장수(풀폭1 + 2그리드)
  const FEATURE_KEEP = 2 // 특징 슬롯에 최소로 남겨 둘 rest 장수(whyBrand + POINT 1)
  const reserveCount = Math.max(
    0,
    Math.min(GALLERY_RESERVE_TARGET, restAll.length - FEATURE_KEEP),
  )
  // 예약분은 rest 의 뒤쪽에서 떼어 특징 슬롯 후보(rest)에서 제외한다.
  const reserved = reserveCount > 0 ? restAll.slice(restAll.length - reserveCount) : []
  const rest = reserveCount > 0 ? restAll.slice(0, restAll.length - reserveCount) : restAll

  // 사용 횟수 추적 — key는 image.id. rest에 있는 사진만 카운트한다.
  const useCount = new Map<string, number>()
  for (const img of rest) useCount.set(img.id, 0)

  let prevId: string | undefined = hero?.id // 직전 슬롯 = hero (whyBrand가 hero 사진 못 쓰게)

  // E19 규칙 ②: rest 사진 1장의 최대 사용 횟수(2회). 히어로는 재사용 풀에서 제외(규칙 ①).
  const MAX_REUSE = 2

  /**
   * 특징 슬롯 1칸 배정 (E19 강화):
   *  - rest 중 (사용 횟수 < MAX_REUSE) & (직전 슬롯과 다른) 사진을 사용 횟수 최소 우선으로 고른다.
   *  - 규칙 ③(인접 슬롯 동일 금지): 직전과 같은 사진은 다른 선택지가 전혀 없을 때만.
   *  - 규칙 ②(최대 2회): 이미 2회 쓴 사진은 아예 후보에서 제외 → 부족하면 undefined 반환
   *    (호출부가 히어로 폴백 대신 이미지 없이 렌더할지 결정 — 규칙 ④).
   *  - 동점 시 원본 순서 앞 사진 우선 → 결정적.
   */
  const pickFeature = (): UploadedImage | undefined => {
    if (rest.length === 0) return undefined
    let best: UploadedImage | undefined
    let bestCount = Infinity
    let bestSameAsPrev: UploadedImage | undefined
    let bestSameCount = Infinity
    for (const img of rest) {
      const c = useCount.get(img.id) ?? 0
      if (c >= MAX_REUSE) continue // 규칙 ②: 2회 초과 사용 금지
      if (img.id === prevId) {
        // 규칙 ③: 직전과 같은 사진은 마지막 후보로만.
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

  // 고순위 슬롯(POINT 카드) — rest가 부족하면 undefined 그대로 두어 이미지 없이 렌더(규칙 ④).
  // 단, rest가 아예 0장(사진 1장뿐)일 때만 hero 폴백 허용(규칙 ⑤: 히어로+1곳).
  const onlyHero = rest.length === 0
  const keyPoints: (UploadedImage | undefined)[] = []
  for (let i = 0; i < keyPointCount; i++) {
    const img = pickFeature()
    keyPoints.push(img ?? (onlyHero && i === 0 ? hero : undefined))
  }

  const recipe: (UploadedImage | undefined)[] = []
  for (let i = 0; i < recipeCount; i++) {
    const img = pickFeature()
    recipe.push(img)
  }

  // v3.7: packaging 슬롯 배정 제거 — PackagingBlock은 전용 슬롯(packagingImage prop)만
  // 사용한다. 예전엔 여기서 pickFeature()로 풀 사진 1장을 포장 섹션에 배정해 "이렇게
  // 배송되어요"에 포장과 무관한 사진이 붙는 사고가 났다. 이제 그 사진은 갤러리로 흘려보낸다.
  const packaging = undefined

  // 갤러리 — 특징 슬롯에서 "아직 한 번도 안 쓴" rest 사진 + 예약분(reserved)을 흡수한다.
  // (hero 및 특징 블록에 이미 노출된 사진은 넣지 않아 블록 간 중복 0.)
  const unused = rest.filter((img) => (useCount.get(img.id) ?? 0) === 0)

  // SensoryPunch용 분위기 컷(저순위 풀블리드) — 아직 안 쓴 사진이 있을 때만(규칙 ④).
  // 히어로 재사용 폴백 제거 — 사진이 부족하면 punch는 undefined(카피만, 틴트 배경).
  // v3.8 fix: 갤러리 예약분(reserved)에는 손대지 않는다 — punch 는 예약 안 된 잉여(unused)만 사용.
  //           그래야 갤러리가 모자이크 최소 장수를 온전히 확보한다(진단 #1).
  const punch = unused.length > 0 ? unused[0] : undefined
  const leftover = punch ? unused.slice(1) : unused

  // v3.1-b: sizeRef 예약 삭제 — 크기와 무관한 사진(비닐하우스 등)에 "실제 크기 참고"
  // 캡션이 붙는 사고가 나서, 남는 사진은 전부 갤러리가 흡수한다.
  // v3.8 fix: 갤러리 = 특징 슬롯이 안 쓴 잉여(leftover) + 갤러리 전용 예약분(reserved).
  //           원본 업로드 순서를 유지하도록 leftover 뒤에 reserved 를 붙인다(결정적).
  const gallery = [...leftover, ...reserved].slice(0, GALLERY_MAX)

  return { hero, whyBrand, keyPoints, recipe, packaging, sizeRef: undefined, punch, gallery }
}

/** fruit-facts에서 무료로 합류시킬 hookHeadlines 최대 개수 (기획 Should: 2~3개). */
const FREE_CANDIDATE_MAX = 3

/**
 * 화면에 노출할 헤드라인 후보 목록을 만든다.
 *  1. AI가 생성한 copy.headlineCandidates (있으면)
 *  2. 상품명이 fruit-facts에 매칭되면 그 hookHeadlines 2~3개를 API 비용 없이 합류
 * 정규화 기준 중복 제거 후 최대 MAX_HEADLINE_CANDIDATES(8)개.
 * 후보가 하나도 없으면 빈 배열 → 칩 영역 자체를 렌더하지 않는다(하위호환).
 *
 * 품종 인식 필터: fruit-facts 무료 후보(hookHeadlines)는 상품명과 사실 정합한
 * 것만 합류한다. 상품명 "부유단감"에 다른 품종("차랑")이나 그 품종 Brix(22)가
 * 든 후보가 노출되던 문제(사용자 분노 사례)를 isHookHeadlineCompatible로 차단.
 *
 * 산지 정합 필터: 후보에 이 과일 regions 지역명이 들어 있는데 입력 산지(origin)에
 * 없으면 제외한다. origin 미입력이면 지역명 포함 후보는 전부 제외. "국내산" 입력에
 * 참고 데이터 '담양'이 후보 칩으로 노출된 허위 표시 사고 재발 방지 — 무료 후보뿐
 * 아니라 AI 후보에도 적용(AI가 규칙 56을 어겨 지역명을 넣어도 칩 단계에서 차단).
 */
export function buildDisplayCandidates(
  copy: CopyOutput,
  productName: string,
  origin?: string,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const key = detectFruitFactKey(productName)
  const fact = key ? FRUIT_FACTS[key] : undefined
  const push = (raw: string) => {
    const s = raw.trim()
    if (!s) return
    const norm = normalizeHeadlineCandidate(s)
    if (!norm || seen.has(norm)) return
    seen.add(norm)
    if (out.length < MAX_HEADLINE_CANDIDATES) out.push(s)
  }

  // AI 후보 — 품종·수치는 프롬프트(규칙 55) 책임이므로 산지 정합만 추가로 차단.
  // (규칙 56 위반으로 지역명이 새어 나와도 칩 단계에서 걸러 허위 표시 방지.)
  for (const c of copy.headlineCandidates ?? []) {
    if (fact && !isHeadlineOriginCompatible(fact, c, origin)) continue
    push(c)
  }

  // 무료 후보 합류 — fruit-facts 매칭 시 hookHeadlines 중 사실 정합한 것만 추가
  // (품종·Brix·산지 전부 검사). 필터를 먼저 통과시킨 뒤 slice — 앞쪽 후보가
  // 걸러져도 FREE_CANDIDATE_MAX개를 채운다.
  if (fact) {
    const compatible = fact.hookHeadlines.filter((h) =>
      isHookHeadlineCompatible(fact, productName, h, origin),
    )
    for (const h of compatible.slice(0, FREE_CANDIDATE_MAX)) push(h)
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

/* ============================================================ */
/* v3.4 색 세계 · 곡선 전환 · 타이틀 장치 (실물 레퍼런스 기반)    */
/* ------------------------------------------------------------ */
/* 아래 소형 컴포넌트/헬퍼는 모두 인라인 SVG + hex 상수만 사용해  */
/* html-to-image(toCanvas) 캡처와 100% 호환된다.                  */
/* (backdrop-filter/filter/mask/position:fixed 없음)             */
/* ============================================================ */

/**
 * accent.soft보다 한 단계 더 옅은 "베일 틴트" — 흰 카드가 그 위에 떠 보이게.
 * soft는 #FFFxxx / #FxxFxx 계열(마지막 두 자리가 밝음)이라, 그 hex를 흰색과
 * 약 50% 섞은 아주 옅은 톤을 결정적으로 만든다. (레퍼런스: 복숭아 blush 바탕)
 * export 시엔 이 함수가 반환한 구체 hex가 인라인되므로 CSS 변수 문제 없음.
 */
function veilTint(soft: string): string {
  // #RRGGBB → 흰색(255)과 평균. soft가 이미 매우 밝아 결과도 매우 옅다.
  const hex = soft.replace("#", "")
  if (hex.length !== 6) return "#FFFFFF"
  const mix = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16)
    const m = Math.round((c + 255) / 2)
    return m.toString(16).padStart(2, "0")
  }
  return `#${mix(0)}${mix(2)}${mix(4)}`
}

/**
 * 곡선 섹션 전환 divider — 위 섹션(topColor) 바닥에서 아래 섹션(fillColor)이
 * 완만한 아치로 솟아오른다. 인라인 SVG path 하나(레퍼런스 지시 2).
 * height는 곡선 깊이. flip=true면 아래로 파인 곡선(돔 대신 골).
 */
function CurveDivider({
  topColor,
  fillColor,
  height = 64,
}: {
  topColor: string
  fillColor: string
  height?: number
}) {
  return (
    // E20: data-slice-glue — 곡선 전환은 항상 뒤 섹션으로 이어지는 리드인이라
    // 뒤 형제와 분리되면 잘린 곡선만 슬라이스 끝에 남는다. exporter가 다음 형제와 묶는다.
    <div aria-hidden data-slice-glue style={{ background: topColor, lineHeight: 0 }}>
      <svg
        width="100%"
        viewBox="0 0 860 80"
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height }}
      >
        {/* 아래 섹션 색이 완만한 아치로 위로 밀고 올라옴 */}
        <path d="M0,80 C215,8 645,8 860,80 L860,80 L0,80 Z" fill={fillColor} />
      </svg>
    </div>
  )
}

/**
 * 흰 돔 곡선 전환 — 틴트 배경에서 흰 반원 돔이 솟아오르고, 그 정점에
 * accent 원(라벨/번호)이 얹힌다 (proj3 키위 레퍼런스, 지시 2 WHY 진입부).
 * label 문자열(짧게)을 돔 정점 원 안에 넣는다.
 */
function DomeTransition({
  tintColor,
  accent,
  label,
  isMobile,
}: {
  tintColor: string
  accent: AccentPalette
  label: string
  isMobile: boolean
}) {
  const circle = isMobile ? 56 : 88
  // v3.4 fix(이슈1): 'WHY'(BlackHanSans 36px)가 88px 원을 좌우로 뚫고 링과 겹쳤다.
  // BlackHanSans 대문자는 글자당 폭이 커(≈0.75em) 3글자 "WHY"의 실폭이 원 안지름을
  // 넘겼다. 라벨 길이에 맞춰 폰트를 계산해 좌우 여백(안지름의 ~78%)을 확보한다:
  //   fontSize ≈ (원 안지름 * 0.78) / (글자수 * 0.75).  원지름의 ~55%를 상한으로 둔다.
  const border = isMobile ? 3 : 4
  const inner = circle - border * 2
  const labelLen = Math.max(1, label.trim().length)
  const labelFont = Math.round(
    Math.min(circle * 0.55, (inner * 0.78) / (labelLen * 0.75)),
  )
  return (
    // E20: data-slice-glue — 이 돔은 뒤 섹션(WHY 카드)의 리드인이라 분할 경계가
    // 여기서 떨어지면 돔 원이 반토막 난다(05 증거). exporter가 다음 형제와 같은 그룹에 묶는다.
    <div aria-hidden data-slice-glue style={{ background: tintColor, position: "relative", lineHeight: 0 }}>
      <svg
        width="100%"
        viewBox="0 0 860 120"
        preserveAspectRatio="none"
        style={{ display: "block", width: "100%", height: isMobile ? 60 : 96 }}
      >
        {/* 흰 돔이 틴트 위로 봉긋 */}
        <path d="M0,120 C160,120 250,20 430,20 C610,20 700,120 860,120 Z" fill="#FFFFFF" />
      </svg>
      {/* 돔 정점의 accent 원 + 라벨 (텍스트라 aria 노출 유지 위해 별도 div) */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: isMobile ? -circle / 2 : -circle / 2,
          transform: "translateX(-50%)",
          width: circle,
          height: circle,
          borderRadius: "50%",
          background: accent.soft,
          border: `${border}px solid ${accent.accent}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          color: accent.dark,
          fontSize: labelFont,
          fontWeight: 400,
          fontFamily: DISPLAY_FONT,
          lineHeight: 1,
          letterSpacing: -1,
        }}
      >
        <span
          style={{
            maxWidth: "84%",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "clip",
          }}
        >
          {label}
        </span>
      </div>
    </div>
  )
}

/**
 * 리본 배너 — 다크 리본 + 좌우 접힌 꼬리 (지시 3, CSS 삼각형 꼬리로 구현).
 * 섹션 제목 위 라벨용. accent 색 리본.
 */
function RibbonLabel({
  text,
  accent,
  isMobile,
}: {
  text: string
  accent: AccentPalette
  isMobile: boolean
}) {
  const tail = isMobile ? 12 : 18
  const padY = isMobile ? 8 : 13
  const padX = isMobile ? 18 : 30
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        marginLeft: tail,
        marginRight: tail,
      }}
    >
      {/* 왼쪽 꼬리 (접힌 삼각형) */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: -tail,
          top: 0,
          bottom: 0,
          width: 0,
          height: 0,
          borderTop: `${(padY * 2 + (isMobile ? 20 : 34)) / 2}px solid ${accent.dark}`,
          borderBottom: `${(padY * 2 + (isMobile ? 20 : 34)) / 2}px solid ${accent.dark}`,
          borderLeft: `${tail}px solid transparent`,
        }}
      />
      {/* 오른쪽 꼬리 */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          right: -tail,
          top: 0,
          bottom: 0,
          width: 0,
          height: 0,
          borderTop: `${(padY * 2 + (isMobile ? 20 : 34)) / 2}px solid ${accent.dark}`,
          borderBottom: `${(padY * 2 + (isMobile ? 20 : 34)) / 2}px solid ${accent.dark}`,
          borderRight: `${tail}px solid transparent`,
        }}
      />
      {/* 본체 */}
      <span
        style={{
          position: "relative",
          display: "inline-block",
          background: accent.accent,
          color: "#FFFFFF",
          padding: `${padY}px ${padX}px`,
          fontSize: isMobile ? 15 : 26,
          fontWeight: 800,
          letterSpacing: 1.5,
          fontFamily: BODY_FONT,
          lineHeight: isMobile ? "20px" : "34px",
        }}
      >
        {text}
      </span>
    </span>
  )
}

/**
 * 기울어진 스티커 배지 — accent 배경 원형/알약을 -3deg 회전 (chamoe-03 · 지시 3).
 * 사실 데이터(brix 등)만 넣는다. 호출부가 검증한 문구만 전달.
 */
function TiltSticker({
  text,
  accent,
  isMobile,
}: {
  text: string
  accent: AccentPalette
  isMobile: boolean
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        transform: "rotate(-3deg)",
        background: accent.accent,
        color: "#FFFFFF",
        padding: isMobile ? "10px 22px" : "16px 36px",
        borderRadius: 12,
        fontSize: isMobile ? 22 : 40,
        fontWeight: 400,
        fontFamily: DISPLAY_FONT,
        letterSpacing: -0.5,
        lineHeight: 1.1,
        boxShadow: `0 4px 12px ${accent.accent}55`,
      }}
    >
      {text}
    </span>
  )
}

/**
 * copy.spec에서 당도(brix) 숫자를 안전하게 추출. 없으면 null.
 * 스티커 배지는 이 값이 있을 때만 노출 — 사실 데이터만.
 */
function extractBrix(copy: CopyOutput): number | null {
  for (const s of copy.spec) {
    if (/(당도|Brix|brix)/.test(s.label) && s.value) {
      const m = s.value.trim().match(/(\d+(?:\.\d+)?)/)
      if (m) {
        const n = Number(m[1])
        if (Number.isFinite(n) && n > 0) return n
      }
    }
  }
  return null
}

/**
 * 부분 밑줄 형광펜 — 콜아웃 문장 안에서 앞쪽 "핵심 구(2~3어절)"를 골라
 * accent 물결 밑줄 + 살짝 두꺼운 글씨로 강조한다.
 *
 * 규칙(원문 변경 금지, 결정적):
 *  1. 어절(공백) 단위로 자른다.
 *  2. 첫 감각어(SENSORY_WORDS)가 등장하는 어절을 찾는다.
 *     - 있으면 그 어절부터 최대 3어절을 강조 구간으로 잡는다.
 *     - 없으면 앞 2어절을 강조(안전한 결정적 폴백).
 *  3. 어절이 2개 미만이면 강조 없이 전체를 그냥 반환(과도 방지).
 *
 * 반환: { lead, mark, tail } — lead/tail 원문 그대로, mark가 밑줄 강조 구간.
 *        강조할 게 없으면 mark 빈 문자열.
 */
export function splitPhraseEmphasis(
  sentence: string,
): { lead: string; mark: string; tail: string } {
  const text = sentence ?? ""
  if (!text.trim()) return { lead: text, mark: "", tail: "" }

  // 공백(연속 포함)으로 어절 분리하되 구분자를 살려 원문 재조립이 가능하게.
  const tokens = text.match(/\S+|\s+/g) ?? [text]
  // 실제 단어(공백 아님)의 토큰 인덱스만 모은다.
  const wordIdx: number[] = []
  tokens.forEach((tk, i) => {
    if (tk.trim().length > 0) wordIdx.push(i)
  })
  if (wordIdx.length < 2) return { lead: text, mark: "", tail: "" }

  const isSensory = (s: string) => SENSORY_WORDS.some((w) => s.includes(w))

  // 감각어가 든 첫 단어의 "단어 순번"(0-based)을 찾는다.
  let startWord = 0
  const foundAt = wordIdx.findIndex((ti) => isSensory(tokens[ti]))
  if (foundAt >= 0) startWord = foundAt

  // 강조 어절 수: 감각어 시작이면 최대 3, 폴백(앞 2어절)이면 2.
  const spanWords = foundAt >= 0 ? 3 : 2
  const endWord = Math.min(wordIdx.length - 1, startWord + spanWords - 1)

  // 강조 구간의 토큰 범위 [markStartTok, markEndTok] (포함).
  const markStartTok = wordIdx[startWord]
  const markEndTok = wordIdx[endWord]

  const lead = tokens.slice(0, markStartTok).join("")
  const mark = tokens.slice(markStartTok, markEndTok + 1).join("")
  const tail = tokens.slice(markEndTok + 1).join("")
  if (!mark.trim()) return { lead: text, mark: "", tail: "" }
  return { lead, mark, tail }
}

/** 감각어 사전 — 형광펜 강조 문장 자동 감지용(맛·향·식감 표현). */
const SENSORY_WORDS = [
  "달", "달콤", "새콤", "꿀", "과즙", "즙", "아삭", "사각", "촉촉", "수분",
  "향", "진한", "부드럽", "쫄깃", "탱글", "시원", "상큼", "풍미", "팡팡", "가득",
  "입안", "한입", "베어", "베이", "터지", "녹", "고소",
]

/**
 * story 문단에서 형광펜으로 강조할 "핵심(감각) 문장"을 결정적으로 하나 고른다.
 *
 * 규칙(지어내지 않고 스타일만):
 *  1. 문장 단위(마침표·느낌표·물음표·줄바꿈)로 분할.
 *  2. 느낌표(!)가 있거나 감각어(SENSORY_WORDS)를 포함한 첫 문장을 강조.
 *  3. 그런 문장이 없으면 두 번째 문장을 기본 강조(안전한 결정적 폴백).
 *     문장이 1개뿐이면 강조하지 않는다(문단 전체를 칠하지 않기 위해).
 *
 * 반환: { before, highlight, after } — before/after는 강조 문장 앞뒤 원문 그대로.
 *        강조할 문장이 없으면 null(형광펜 없이 문단만 렌더).
 * 문단당 강조 1개.
 */
export function splitStoryHighlight(
  story: string,
): { before: string; highlight: string; after: string } | null {
  const text = story ?? ""
  if (!text.trim()) return null

  // 문장 끝 구분자(., !, ?, 줄바꿈)를 유지한 채 분할. 각 조각은 원문 그대로.
  const parts: string[] = []
  const re = /[^.!?\n]*(?:[.!?]+|\n+|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) break
    parts.push(m[0])
    if (re.lastIndex >= text.length) break
  }
  // 실제 내용이 있는 문장 인덱스만 후보로.
  const sentences = parts.filter((p) => p.trim().length > 0)
  if (sentences.length < 2) return null // 한 문장뿐이면 강조 안 함(과도 방지)

  const isSensory = (s: string) =>
    /!/.test(s) || SENSORY_WORDS.some((w) => s.includes(w))

  let targetTrimmed: string | null = null
  const firstSensory = sentences.find(isSensory)
  if (firstSensory) {
    targetTrimmed = firstSensory
  } else {
    // 감지 애매 → 두 번째 문장 기본 강조(결정적 폴백).
    targetTrimmed = sentences[1] ?? null
  }
  if (!targetTrimmed) return null

  // 원문에서 해당 문장의 위치를 찾아 before/highlight/after로 분리.
  // 앞뒤 공백은 highlight 밖(before/after)에 둔다 — 배경 박스가 공백까지 칠하지 않게.
  const idx = text.indexOf(targetTrimmed)
  if (idx < 0) return null
  const rawHighlight = targetTrimmed
  const leadWs = rawHighlight.length - rawHighlight.trimStart().length
  const trailWs = rawHighlight.length - rawHighlight.trimEnd().length
  const start = idx + leadWs
  const end = idx + rawHighlight.length - trailWs
  const before = text.slice(0, start)
  const highlight = text.slice(start, end)
  const after = text.slice(end)
  if (!highlight.trim()) return null
  return { before, highlight, after }
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

  // v3.4(지시4): 다크 밴드 → 연한 틴트 위 흰 라운드 카드 1장에 라인 아이콘 3개 +
  // 점선 세로 구분선(peach-s04). 각 항목에 의미가 맞는 LineIcon을 짝지어 브랜드감을 준다.
  // 강한 주장(체크된 것만) 우선 → 안전 문구로 3칸 채움(중복 없이). 카드는 항상 3칸.
  type VpItem = { label: string; Icon: (p: LineIconProps) => React.JSX.Element }
  const strong: VpItem[] = []
  if (trust?.sameDayHarvest) strong.push({ label: vp.sameDayHarvest, Icon: HarvestIcon })
  // C9: "산지 직송"은 directFromFarm 체크 시에만 (안전 필러에서 제거).
  if (trust?.directFromFarm) strong.push({ label: vp.directFromFarm, Icon: MapPinIcon })
  if (trust?.coldChain) strong.push({ label: vp.coldChain, Icon: ColdIcon })
  else if (trust?.sealedPackage) strong.push({ label: vp.sealed, Icon: SealIcon })
  // C10: refundGuarantee가 조건부(condition 존재)면 "100% 환불" → "조건부 교환·환불"로 다운그레이드.
  if (trust?.refundGuarantee) {
    const conditional =
      typeof trust.refundGuarantee === "object" && !!trust.refundGuarantee.condition?.trim()
    strong.push({ label: conditional ? vp.refundConditional : vp.refund, Icon: ShieldIcon })
  }

  // 검증 불필요한 안전 문구 (항상 참인 일반적 신선식품 표현).
  // C9: "산지 직송" 제외 — 꼼꼼 선별/신선 포장/정성 포장만.
  const safe: VpItem[] = [
    { label: vp.carefulSort, Icon: SortIcon },
    { label: vp.freshPack, Icon: PackIcon },
    { label: vp.carefulPack, Icon: SealIcon },
  ]

  const items: VpItem[] = []
  const seen = new Set<string>()
  for (const it of [...strong, ...safe]) {
    if (items.length >= 3) break
    if (seen.has(it.label)) continue
    seen.add(it.label)
    items.push(it)
  }

  const iconSize = isMobile ? 46 : 78

  return (
    <div
      style={{
        background: veilTint(accent.soft),
        padding: isMobile ? "36px 20px" : "72px 44px",
      }}
    >
      <div
        style={{
          background: "#FFFFFF",
          borderRadius: 22,
          border: `1px solid ${accent.soft}`,
          boxShadow: `0 6px 24px ${accent.accent}14`,
          padding: isMobile ? "28px 12px" : "52px 28px",
          display: "grid",
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map(({ label, Icon }, i) => (
          <div
            key={`vp-${i}`}
            style={{
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: isMobile ? 12 : 20,
              padding: isMobile ? "4px 8px" : "8px 18px",
              // 점선 세로 구분선(peach-s04) — 첫 칸 제외
              borderLeft: i > 0 ? `2px dotted ${accent.soft}` : "none",
            }}
          >
            <Icon color={accent.accent} size={iconSize} />
            <span
              style={{
                fontSize: isMobile ? 15 : 26,
                fontWeight: 800,
                fontFamily: BODY_FONT,
                letterSpacing: -0.2,
                color: INK,
                lineHeight: 1.35,
                wordBreak: "keep-all",
              }}
            >
              {label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * v3.4(지시8): 검은 알약 CTA 제거 — JPG인데 "클릭 버튼"으로 오해되던 다크 pill을
 * 버튼처럼 보이지 않는 캡션/리본 스타일로 교체. 채워진 알약·검정 배경 없이,
 * accent 물결 밑줄이 들어간 강조 문구로 시선만 모은다 (Hero·하단 공용 — 하단은 제목형 변주 문구).
 */
function CtaPill({ text, isMobile }: { text: string; isMobile: boolean }) {
  const accent = useAccent()
  const { lead, mark, tail } = splitPhraseEmphasis(text)
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isMobile ? 8 : 12,
        fontSize: isMobile ? 22 : 40,
        fontWeight: 400,
        fontFamily: DISPLAY_FONT,
        letterSpacing: -0.8,
        color: INK,
        lineHeight: 1.25,
        wordBreak: "keep-all",
        textAlign: "center",
      }}
    >
      {/* 좌측 잎사귀형 accent 점 — 버튼이 아니라 캡션임을 시각적으로 알린다 */}
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: isMobile ? 10 : 16,
          height: isMobile ? 10 : 16,
          borderRadius: "50%",
          background: accent.accent,
        }}
      />
      <span>
        {mark ? (
          <>
            {lead}
            <span
              style={{
                color: accent.dark,
                textDecoration: "underline wavy",
                textDecorationColor: accent.accent,
                textDecorationThickness: isMobile ? 2 : 3,
                textUnderlineOffset: isMobile ? 5 : 8,
              }}
            >
              {mark}
            </span>
            {tail}
          </>
        ) : (
          text
        )}
      </span>
    </div>
  )
}

/**
 * Hero 직후 배송 약속 밴드 (리서치: 배송 약속 1줄 상단 배치 +27.1%).
 * 허위광고 방지 — 강한 약속은 trust.sameDayHarvest 체크 시에만, 미체크 시 안전 문구.
 * 톤은 ValuePropStrip과 통일(검정 배경 + accent 체크).
 */
function DeliveryPromiseBand({ isMobile, trust }: { isMobile: boolean; trust?: TrustInfo }) {
  const accent = useAccent()
  const dp = t.detail.result.deliveryPromise
  const text = trust?.sameDayHarvest ? dp.strong : dp.safe
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isMobile ? 8 : 12,
        // v3.1-b: 검정 → accent.soft 밝은 톤. CTA(검정 pill)·ValuePropStrip(검정)과
        // 연달아 검은 덩어리 3개가 쌓여 무겁던 문제 완화 (설향 실측에서 확인).
        background: accent.soft,
        color: INK,
        padding: isMobile ? "16px 20px" : "26px 44px",
        textAlign: "center",
      }}
    >
      <span aria-hidden style={{ color: accent.accent, fontSize: isMobile ? 18 : 30, fontWeight: 900 }}>
        ✓
      </span>
      <span
        style={{
          fontSize: isMobile ? 18 : 32,
          fontWeight: 800,
          fontFamily: BODY_FONT,
          letterSpacing: -0.3,
          lineHeight: 1.4,
          wordBreak: "keep-all",
        }}
      >
        {/* 부분 밑줄 형광펜 — 배송 약속 문장 앞 핵심 구를 accent 물결 밑줄로 강조. */}
        {(() => {
          const { lead, mark, tail } = splitPhraseEmphasis(text)
          if (!mark) return text
          return (
            <>
              {lead}
              <span
                style={{
                  fontWeight: 900,
                  color: accent.dark,
                  textDecoration: "underline wavy",
                  textDecorationColor: accent.accent,
                  textDecorationThickness: 2,
                  textUnderlineOffset: isMobile ? 4 : 6,
                }}
              >
                {mark}
              </span>
              {tail}
            </>
          )
        })()}
      </span>
    </div>
  )
}

export function ResultView({
  copy,
  images,
  packagingImage,
  sizeImage,
  productName,
  price: _price,
  origin,
  weight,
  category,
  trust,
  reviews,
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

  /**
   * v3.0.1 scale-to-fit 미리보기 — 아트보드는 항상 실제 폭(previewWidth)으로
   * 렌더하고, 화면 컬럼이 좁으면 transform: scale로 축소해서 보여준다.
   * 예전에는 maxWidth:100%로 아트보드 자체가 512px 등으로 눌려 재배치되어
   * "미리보기와 JPG 결과물이 다르다"는 문제의 원인이었다 (하네스 실측으로 확인).
   * transform은 캡처 노드(captureRef)의 조상에만 걸리므로 JPG에는 영향 없음.
   */
  const previewOuterRef = useRef<HTMLDivElement>(null)
  const [previewScale, setPreviewScale] = useState(1)
  const [artboardHeight, setArtboardHeight] = useState(0)
  useEffect(() => {
    const outer = previewOuterRef.current
    const art = captureRef.current
    if (!outer || !art) return
    const update = () => {
      const w = outer.clientWidth
      setPreviewScale(w > 0 ? Math.min(1, w / previewWidth) : 1)
      setArtboardHeight(art.offsetHeight)
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(outer)
    ro.observe(art)
    return () => ro.disconnect()
  }, [previewWidth])

  const keyPoints: CopyKeyPoint[] = useMemo(() => {
    if (copy.keyPoints && copy.keyPoints.length >= 1) return copy.keyPoints.slice(0, 3)
    return []
  }, [copy.keyPoints])

  /**
   * v3.0 중앙 이미지 배정 — 모든 블록이 여기서 나온 imagePlan을 소비한다.
   * v3.1-b: RecipeBlock이 사진을 안 쓰게 되어 recipe 슬롯은 항상 0 —
   * 그만큼의 사진이 갤러리로 흘러간다.
   */
  const imagePlan = useMemo(
    () => planImages(images, { keyPointCount: keyPoints.length, recipeCount: 0 }),
    [images, keyPoints.length],
  )
  const heroImage = imagePlan.hero
  const galleryImages = imagePlan.gallery

  /**
   * 노출할 고객 후기 — 본문이 있는 것만(최대 3개). 0건이면 ReviewsBlock 미노출.
   * 셀러 직접 입력이라 AI가 만들지 않는다. highlight는 text에 실제로 포함될 때만 강조.
   */
  const validReviews = useMemo<SellerReview[]>(() => {
    if (!reviews || reviews.length === 0) return []
    return reviews
      .filter((r) => r && r.text.trim().length > 0)
      .slice(0, 3)
      .map((r) => ({ text: r.text.trim(), highlight: r.highlight?.trim() || undefined }))
  }, [reviews])

  const missing = useMemo(() => {
    const m: string[] = []
    if (!origin?.trim()) m.push(t.detail.result.missing.origin)
    if (!weight?.trim()) m.push(t.detail.result.missing.weight)
    return m
  }, [origin, weight])

  const sanitizedName =
    productName.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 60) || "detail"

  /** 식약처 자동 검수 — 결과 카피 기준으로 매번 계산. productName·origin으로 산지 불일치도 검출. */
  const complianceReport = useMemo(
    () => checkComplianceReport(copy, trust, productName, origin),
    [copy, trust, productName, origin],
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
    () => buildDisplayCandidates(copy, productName, origin),
    [copy, productName, origin],
  )

  /** v2.8: 과일별 축색 팔레트 — 상품명 기반 자동 전환. */
  const accent = useMemo(() => resolveAccent(productName), [productName])

  /** A3: 카테고리 명사(과일/채소/상품) — 고정 문구 치환용. */
  const noun = categoryNoun(category)

  /**
   * D17: 크기 편차 보일러플레이트 박스 중복 방어 — 입력 faq/cautions에 "크기"
   * 키워드 항목이 이미 있으면 SizeDiagramBlock의 편차 안내 박스를 생략한다.
   */
  const hasSizeMention = useMemo(() => {
    const inFaq = (copy.faq ?? []).some(
      (f) => f.q?.includes("크기") || f.a?.includes("크기"),
    )
    const inCautions = (copy.cautions ?? []).some((c) => c.includes("크기"))
    return inFaq || inCautions
  }, [copy.faq, copy.cautions])

  /** v2.9: 즐기는 법 블록 노출 여부 — 과일 매칭 + pairings 있을 때만. */
  const hasRecipe = useMemo(() => {
    const key = detectFruitFactKey(productName)
    return !!(key && FRUIT_FACTS[key]?.pairings?.length)
  }, [productName])

  /**
   * CTA 문구 — Hero와 하단 2회 노출(리서치: CTA 2회).
   * v3.4 fix(이슈4): 히어로 직후와 하단이 완전히 똑같은 "~를 만나보세요"로 2번 찍혀
   * 반복으로 읽히던 문제 — 하단은 같은 데이터(producer/name)를 쓰되 제목형 변주로 바꾼다.
   * 조사 변경 수준(만나보세요 → 소개합니다)만, 입력에 없는 사실은 지어내지 않는다.
   */
  const ctaText = useMemo(() => {
    const name = productName.trim()
    const producer = trust?.producerName?.trim()
    // D16: "신선한 X" 남발 방지 — 접두 "신선한" 제거. (농가 캡션은 히어로 1곳 허용 — D15.)
    return producer
      ? `${producer} 농가를 만나보세요`
      : `${name || "이 상품"}, 지금 담아보세요`
  }, [productName, trust?.producerName])
  // D15: 하단 CTA는 농가 문구를 쓰지 않는다(농가 장치는 히어로 캡션 + FarmStoryBlock 2곳만).
  // D16: "신선한 X" 남발 방지 — "{name}, 정직하게 준비했습니다".
  const ctaTextBottom = useMemo(() => {
    const name = productName.trim()
    return `${name || "이 상품"}, 정직하게 준비했습니다`
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
          {previewScale < 0.999 && (
            <span style={{ marginLeft: 8, color: MUTE }}>
              · 실제 {previewWidth}px를 {Math.round(previewScale * 100)}%로 축소해 보는 중 (저장은 원본 크기)
            </span>
          )}
        </p>

        {/* scale-to-fit: 아트보드는 실제 폭으로 렌더, 화면에는 축소 표시 (v3.0.1) */}
        <div ref={previewOuterRef} style={{ width: "100%" }}>
          <div
            style={{
              height: artboardHeight > 0 ? artboardHeight * previewScale : undefined,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                transform: `scale(${previewScale})`,
                transformOrigin: "top left",
                width: previewWidth,
              }}
            >
          <div
            ref={captureRef}
            className={`fdp-print ${enhance ? "fdp-photo-enhance" : ""}`}
            style={{
              width: previewWidth,
              background: "#FFFFFF",
              borderRadius: 12,
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              overflow: "hidden",
              color: INK,
              // B4: 한글 단어 중간 줄바꿈 전면 방지 — 아트보드 루트에 1회 적용(상속됨).
              // 히어로 H1·섹션 헤더·본문 전부 여기서 상속받는다. 개별 상충 지정 없음.
              wordBreak: "keep-all",
              overflowWrap: "break-word",
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
              onCopyChange={onCopyChange}
              onRegenHeadline={renderRegen("headline")}
              onRegenSub={renderRegen("subheadline")}
              isMobile={isMobile}
              factPlaceholder={factPlaceholder}
              headlineCandidates={headlineCandidates}
              onRegenCandidates={renderRegen("headlineCandidates")}
              ctaText={ctaText}
              brix={extractBrix(copy)}
            />

            {/* 배송 약속 밴드 — Hero CTA 직후 (리서치: 배송 약속 상단 +27.1%) */}
            <DeliveryPromiseBand isMobile={isMobile} trust={trust} />

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

            {/* v3.4(지시2): 흰 돔 곡선 전환 — 틴트에서 흰 돔이 솟고 정점에 WHY 원 */}
            <DomeTransition
              tintColor={veilTint(accent.soft)}
              accent={accent}
              label="WHY"
              isMobile={isMobile}
            />

            {/* v2.9: WHY 카드 (수플린 레퍼런스 — Hero 다음). 돔이 흰 배경으로 착지. */}
            <WhyBrandCard
              productName={productName}
              image={imagePlan.whyBrand}
              isMobile={isMobile}
            />

            {/* D14: WHY 하단 신뢰 pill 행(TrustBadgesRow) 삭제 — 신뢰 3종은 히어로
                highlightBadges + 아이콘 트리오(ValuePropStrip) 2곳으로만 노출. */}

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

            {/* 2b. PROBLEM ARC — 문제 제기→해결 서사 아크 (실물 키위 레퍼런스).
                   WHY 카드 다음, Story 앞. problemArc 없으면(구버전 카피) 미노출. */}
            {copy.problemArc && copy.problemArc.problems.length > 0 ? (
              <>
                {/* v3.4(지시2): 흰 → 틴트 곡선 전환 */}
                <CurveDivider topColor="#FFFFFF" fillColor={veilTint(accent.soft)} height={isMobile ? 44 : 64} />
                <ProblemArcBlock arc={copy.problemArc} isMobile={isMobile} />
                {/* 틴트 → 흰(STORY) 곡선 전환 (아래로 파인 곡선처럼 보이도록 색 반전) */}
                <CurveDivider topColor={veilTint(accent.soft)} fillColor="#FFFFFF" height={isMobile ? 44 : 64} />
              </>
            ) : (
              <DotDivider />
            )}

            {/* 3. STORY (형광펜 강조 — 첫 감각 문장 자동 강조) */}
            <StoryBlock
              copy={copy}
              onCopyChange={onCopyChange}
              onRegen={renderRegen("story")}
              isMobile={isMobile}
            />

            {/* 3b. SENSORY PUNCH — 검정 배경 임팩트 카피 + 바로 아래 실사진 밀착 (참외 레퍼런스).
                   highlightBox(기존 StoryBlock 슬로건)를 승격. 비어 있으면 미노출.
                   v3.8(지시5): 이 블록이 페이지 유일의 강조 다크 밴드 — 그 1회 허용분을 쓰므로
                   검정 유지(tinted=false). 앞으로 다른 다크 풀블리드가 추가되면 그쪽을 tinted로. */}
            {copy.highlightBox.trim() && (
              <SensoryPunchBlock
                copy={copy}
                onCopyChange={onCopyChange}
                image={imagePlan.punch}
                isMobile={isMobile}
                tinted={false}
              />
            )}

            {/* 3a. RECOMMEND FOR */}
            {copy.recommendFor && copy.recommendFor.length > 0 && (
              <>
                <DotDivider />
                <RecommendForBlock items={copy.recommendFor} isMobile={isMobile} />
              </>
            )}

            {/* 3c. REVIEWS — 셀러가 직접 입력한 고객 후기(AI 생성 아님). 0건이면 미노출. */}
            {validReviews.length > 0 && (
              <>
                <DotDivider />
                <ReviewsBlock reviews={validReviews} isMobile={isMobile} />
              </>
            )}

            {/* 4. GALLERY (2x2) */}
            {galleryImages.length > 0 && (
              <>
                <DotDivider />
                <GalleryBlock images={galleryImages} productName={productName} isMobile={isMobile} />
              </>
            )}

            <DotDivider />

            {/* 5. SPEC + PRICE */}
            <SpecBlock
              copy={copy}
              productName={productName}
              weight={weight}
              onCopyChange={onCopyChange}
              onRegen={renderRegen("spec")}
              isMobile={isMobile}
            />

            {/* 5a. 크기·중량 안내 — 크기 전용 슬롯 사진 또는 무게 데이터가 있을 때만.
                v3.7: sizeImage가 있으면 사진 + 무게카드, 없으면 기존 동작(무게 데이터만). */}
            <SizeDiagramBlock
              productName={productName}
              weight={weight}
              sizeImage={sizeImage}
              isMobile={isMobile}
              noun={noun}
              hasSizeMention={hasSizeMention}
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
                  noun={noun}
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
                <RecipeBlock productName={productName} isMobile={isMobile} />
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

            {/* v3.7: 8a. 배송 시 구성 — 포장 전용 슬롯 사진이 있을 때만 노출.
                포장 사진이 없으면 섹션 자체를 렌더하지 않는다(일반 풀 사진 대체 금지). */}
            {packagingImage && (
              <>
                <DotDivider />
                <PackagingBlock
                  image={packagingImage}
                  weight={weight}
                  isMobile={isMobile}
                />
              </>
            )}

            <DotDivider />

            {/* v2.8: 8b. 신선함을 잇는 4단계 (수플린 배송 흐름 레퍼런스) */}
            <DeliveryFlowBlock trust={trust} isMobile={isMobile} />

            <DotDivider />

            {/* 9. DELIVERY (정형 텍스트 상세) — 당일 발송 문구는 trust 체크 시에만 */}
            <DeliveryBlock isMobile={isMobile} trust={trust} />

            <DotDivider />

            {/* 9a. RETURNS (정형) — 환불 기한은 refundGuarantee 입력이 있으면 그 값(C11) */}
            <ReturnsBlock isMobile={isMobile} trust={trust} />

            {/* D14: 교환·환불 하단 신뢰 pill 행(CheckoutTrustStrip) 삭제 — 신뢰 3종 연타 방지.
                신뢰 요소는 히어로 highlightBadges + 아이콘 트리오(ValuePropStrip) 2곳으로만. */}

            {/* CTA 반복 — 교환·환불 안내 뒤, 주의 박스 앞 (리서치: CTA 2회 반복).
                하단은 히어로와 동일 데이터의 제목형 변주(이슈4) — 같은 문구 2회 반복 방지. */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: isMobile ? "36px 24px 8px" : "72px 44px 16px",
                background: "#FFFFFF",
              }}
            >
              <CtaPill text={ctaTextBottom} isMobile={isMobile} />
            </div>

            {/* 10. CAUTIONS — 신선식품 면책 박스 자동 표시 (cautions 비어 있어도 노출).
                D17: faq 답변·storage와 정확 일치하는 cautions 항목은 렌더 생략. */}
            <DotDivider />
            <CautionsBlock cautions={copy.cautions ?? []} copy={copy} isMobile={isMobile} />

            {/* v3.8(지시6): 클로징 브랜드 서명 — 잎 라인 아이콘 + 한 줄 + 가는 구분선. */}
            <ClosingSignature productName={productName} trust={trust} isMobile={isMobile} />
          </div>
            </div>
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

        {/* v3.5: AI 리서치 요약 (아트보드 밖 — JPG 미포함). 리서치 미사용/실패 시 미노출. */}
        <ResearchSummaryPanel research={copy.research} />

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
        <ExportPanel
          targetRef={captureRef}
          baseName={sanitizedName}
          blockedReason={
            copy.headline.trim().length === 0
              ? "카피가 아직 비어 있어요. 3단계에서 카피를 생성(또는 직접 입력)한 뒤 저장해 주세요."
              : undefined
          }
        />

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
    // 상단 여백 확대: 돔 정점 원(overhang)이 이 섹션 위로 걸치므로 그만큼 비워둔다.
    <div style={{ padding: isMobile ? "52px 24px 48px" : "76px 44px", background: "#FFFFFF" }}>
      <div
        style={{
          background: accent.soft,
          borderRadius: 22,
          border: `1px solid ${accent.soft}`,
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

        {/* D16: WHY 카드 고정 필러("한 번 드셔보면...") 삭제 — 05 프리미엄 톤과 충돌 + 범용 필러.
            WHY 헤딩만 남기고 지어낸 자신감 문구는 넣지 않는다. */}
      </div>
    </div>
  )
}

/**
 * v2.9 즐기는 법 (수플린 RECIPE 1/2/3 레퍼런스).
 * fruit-facts.pairings 기반 3개 페어링 카드 + 이미지 슬롯.
 * 과일 미매칭 or pairings 없으면 렌더 안 함 (환각 방지 — 없으면 안 만든다).
 */
/**
 * v3.1-b 재설계: 사진 카드 3개 → 사진 없는 콤팩트 칩 한 줄.
 * 전용 레시피 사진이 없는데 갤러리 사진을 돌려 붙이면 "AI가 만든 티"가 나서
 * (설향 딸기 사례 — 같은 무더기 사진 3장에 라벨만 교체) 사진을 완전히 뺐다.
 * 페어링은 재료·용도 단어라 텍스트 칩이 오히려 정직하고 깔끔하다.
 */
function RecipeBlock({
  productName,
  isMobile,
}: {
  productName: string
  isMobile: boolean
}) {
  const accent = useAccent()
  const key = detectFruitFactKey(productName)
  const pairings = key ? FRUIT_FACTS[key]?.pairings ?? [] : []
  const items = pairings.slice(0, 3)
  // F(minor): 칩 2개 미만이면 섹션 미노출 (한 칩짜리 빈약한 섹션 방지).
  if (items.length < 2) return null

  const name = productName.trim() || "이 상품"
  return (
    <div style={{ padding: isMobile ? "44px 24px" : "80px 44px", background: "#FFFFFF" }}>
      <div style={{ textAlign: "center", marginBottom: isMobile ? 24 : 40 }}>
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

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          flexWrap: "wrap",
          gap: isMobile ? 12 : 20,
        }}
      >
        {items.map((pairing, i) => (
          <span
            key={`recipe-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: isMobile ? 8 : 12,
              padding: isMobile ? "14px 22px" : "24px 40px",
              background: accent.soft,
              borderRadius: 999,
              fontSize: isMobile ? 18 : 32,
              fontWeight: 800,
              color: INK,
              fontFamily: BODY_FONT,
              letterSpacing: -0.3,
              whiteSpace: "nowrap",
            }}
          >
            <span aria-hidden style={{ color: accent.accent, fontWeight: 900 }}>✓</span>
            {pairing}
          </span>
        ))}
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
  onCopyChange,
  onRegenHeadline,
  onRegenSub,
  isMobile,
  factPlaceholder,
  headlineCandidates,
  onRegenCandidates,
  ctaText,
  brix,
}: {
  heroImage?: UploadedImage
  copy: CopyOutput
  productName: string
  origin?: string
  onCopyChange: (next: CopyOutput) => void
  onRegenHeadline: React.ReactNode
  onRegenSub: React.ReactNode
  isMobile: boolean
  factPlaceholder?: { headline: string; sub: string; highlightBox: string } | null
  /** AI + fruit-facts 무료 합류 후보(중복 제거·최대 8). 비면 칩 미표시. */
  headlineCandidates: string[]
  /** "후보 새로 받기" 재생성 노드 (data-edit-chrome — JPG 제외). */
  onRegenCandidates: React.ReactNode
  /** Hero·하단 공용 CTA 문구 (ResultView에서 계산해 내려줌). */
  ctaText: string
  /** 당도(brix) — 입력 스펙에서 추출. 있을 때만 기울어진 스티커 배지 노출(지시3, 사실 데이터). */
  brix: number | null
}) {
  const accent = useAccent()
  const name = productName.trim()
  const originText = origin?.trim()
  // C12: origin이 "국내산/수입산/해외산"류(특정 지역 아님)면 "From. {origin}" 배지 숨김.
  const showOriginBadge = !!originText && !isGenericOrigin(originText)
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
        {(name || showOriginBadge) && (
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
            {showOriginBadge && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: isMobile ? "5px 14px" : "8px 20px",
                  borderRadius: 999,
                  background: accent.accent,
                  color: "#FFFFFF",
                  fontSize: isMobile ? 14 : 24,
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
        {/* 기울어진 당도 스티커(지시3) — brix 입력이 있을 때만. 사실 데이터만. */}
        {brix != null && (
          <div
            style={{
              position: "absolute",
              top: isMobile ? 14 : 26,
              right: isMobile ? 14 : 26,
              zIndex: 2,
            }}
          >
            <TiltSticker text={`${brix} Brix`} accent={accent} isMobile={isMobile} />
          </div>
        )}
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
            // 사진 없음 안내는 편집 화면 전용 — JPG에 거대한 빈 사각형이 찍히지 않게 캡처 제외
            data-edit-chrome
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
        {/* v2.9: 서브카피 — 대문자 액센트 → 설명형 회색 (수플린 톤). 리서치 본문 34px+ */}
        <p
          style={{
            fontSize: isMobile ? 20 : 36,
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

        {/* CTA pill (수플린 "○○를 선택하세요!" 레퍼런스) — 하단에서 재사용 */}
        <CtaPill text={ctaText} isMobile={isMobile} />

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

        {(() => {
          // C12: origin과 동일 문자열인 highlightBadge 중복 제거
          // (히어로 첫 화면 "국내산" 3회 방지 — 캡션·From배지·이 배지 중복).
          const oNorm = originText?.trim()
          const heroBadges = copy.highlightBadges.filter((b) => !oNorm || b.trim() !== oNorm)
          if (heroBadges.length === 0) return null
          return (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: isMobile ? 8 : 12,
              justifyContent: "center",
              marginTop: isMobile ? 24 : 32,
            }}
          >
            {heroBadges.slice(0, 4).map((b, i) => (
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
                  fontSize: isMobile ? 14 : 24,
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
          )
        })()}
      </div>
    </div>
  )
}

/**
 * ProblemArcBlock — 문제 제기→해결 서사 아크 (실물 키위 상세페이지 레퍼런스).
 *
 * WHY 카드 다음, Story 앞에 배치. "왜 내가 고른 과일은 늘 맛이 아쉬울까?" 공감 질문으로
 * 서사 긴장을 만들고, 이어지는 keyPoints(POINT 카드)가 그 problems의 해결책이 되게 한다.
 *
 * 구성:
 *  - 공감 질문 (BlackHanSans 46~52px 중앙)
 *  - "{n}가지 이유" pill 배지 (accent)
 *  - 문제 카드 세로 스택 — 번호 01/02/03 + 문제 한 줄 (34px). 사진 슬롯 없음(텍스트 카드).
 *
 * problemArc가 없으면(구버전 카피) 호출부에서 렌더하지 않는다(게이팅).
 * 지어내는 것 없이 copy.problemArc 원문 그대로 — 스타일만.
 */
function ProblemArcBlock({
  arc,
  isMobile,
}: {
  arc: NonNullable<CopyOutput["problemArc"]>
  isMobile: boolean
}) {
  const accent = useAccent()
  const problems = arc.problems.slice(0, 3)
  if (problems.length === 0) return null

  // v3.4(지시3): Q&A 2줄 위계 (chamoe-03 "이게 참외야? 꿀이야? → 아니 꿀참외야!").
  // answer 필드가 없어 사실을 지어내지 않는다 — 원문 재배치만으로 위계를 만든다.
  //  (a) 물음표가 여럿이면 마지막 절만 큰 accent(= 핵심 질문), 앞 절들은 작은 잉크 리드.
  //  (b) v3.4 fix(이슈2): 물음표가 1개인 질문(대부분)도 리드/메인이 분리되게 —
  //      쉼표가 있으면 마지막 쉼표 뒤를, 없으면 어절 기준 뒷부분(≈절반, 최소 마지막
  //      어절)을 큰 accent 메인으로 올리고 앞부분을 작은 잉크 리드로 내린다.
  //      어절이 1개뿐이면 분리하지 않는다(전체를 메인으로).
  const q = arc.question.trim()
  const qParts = q.split(/(?<=\?)/).map((s) => s.trim()).filter(Boolean)
  let qLead = ""
  let qMain = q
  if (qParts.length >= 2) {
    qLead = qParts.slice(0, -1).join(" ")
    qMain = qParts[qParts.length - 1]
  } else {
    // 한 절짜리 질문 — 쉼표 우선, 없으면 어절 기준으로 앞(리드)/뒤(메인) 분리.
    const commaIdx = q.lastIndexOf(",")
    if (commaIdx > 0 && commaIdx < q.length - 1) {
      qLead = q.slice(0, commaIdx + 1).trim()
      qMain = q.slice(commaIdx + 1).trim()
    } else {
      const words = q.split(/\s+/).filter(Boolean)
      if (words.length >= 2) {
        // 뒷부분(핵심 구)을 메인으로 — 어절의 뒤 절반(올림), 최소 1어절.
        const mainCount = Math.max(1, Math.ceil(words.length / 2))
        const splitAt = words.length - mainCount
        qLead = words.slice(0, splitAt).join(" ")
        qMain = words.slice(splitAt).join(" ")
      }
    }
  }

  return (
    <div
      style={{
        padding: isMobile ? "56px 24px" : "112px 56px",
        background: veilTint(accent.soft),
      }}
    >
      {/* 공감 질문 — 2줄 위계: 작은 잉크 리드(질문) + 큰 accent 핵심(답/포인트) */}
      <div
        style={{
          textAlign: "center",
          maxWidth: 760,
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {qLead && (
          <p
            style={{
              margin: 0,
              marginBottom: isMobile ? 8 : 14,
              fontSize: isMobile ? 18 : 32,
              fontWeight: 800,
              color: INK,
              lineHeight: 1.35,
              fontFamily: BODY_FONT,
              letterSpacing: -0.3,
              wordBreak: "keep-all",
            }}
          >
            {qLead}
          </p>
        )}
        <h2
          style={{
            fontSize: isMobile ? 30 : 54,
            fontWeight: 400,
            margin: 0,
            color: accent.dark,
            lineHeight: 1.24,
            letterSpacing: -1,
            fontFamily: DISPLAY_FONT,
            wordBreak: "keep-all",
          }}
        >
          {qMain}
        </h2>
      </div>

      {/* "{n}가지 이유" pill 배지 (accent) */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          marginTop: isMobile ? 24 : 36,
          marginBottom: isMobile ? 28 : 44,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: isMobile ? "8px 20px" : "12px 30px",
            borderRadius: 999,
            background: accent.accent,
            color: "#FFFFFF",
            fontSize: isMobile ? 15 : 26,
            fontWeight: 800,
            letterSpacing: 0.5,
            fontFamily: BODY_FONT,
          }}
        >
          {problems.length}가지 이유
        </span>
      </div>

      {/* 문제 카드 세로 스택 — 번호 + 문제 한 줄. 사진 없음(텍스트 카드). */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: isMobile ? 14 : 20,
          maxWidth: 720,
          margin: "0 auto",
        }}
      >
        {problems.map((p, i) => (
          <div
            key={`pa-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: isMobile ? 16 : 26,
              background: "#FFFFFF",
              border: `1px solid ${LINE}`,
              borderRadius: 14,
              padding: isMobile ? "20px 22px" : "32px 40px",
            }}
          >
            {/* 번호 01/02/03 — accent, BlackHanSans */}
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                fontSize: isMobile ? 32 : 54,
                fontWeight: 400,
                color: accent.accent,
                fontFamily: DISPLAY_FONT,
                lineHeight: 1,
                letterSpacing: -1,
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            {/* 문제 한 줄 */}
            <span
              style={{
                fontSize: isMobile ? 20 : 34,
                fontWeight: 700,
                color: INK,
                lineHeight: 1.4,
                fontFamily: BODY_FONT,
                letterSpacing: -0.3,
                wordBreak: "keep-all",
              }}
            >
              {p}
            </span>
          </div>
        ))}
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
  const accent = useAccent()
  const hasStory = !!copy.story
  // 형광펜 강조: story에서 첫 감각 문장을 결정적으로 하나 뽑는다(문단당 1개).
  const storyHi = useMemo(() => splitStoryHighlight(copy.story), [copy.story])
  // D13(풀쿼트 발췌): 콜아웃에 인용된 문장은 본문에서 제거(발췌 개념)해 verbatim 반복을 없앤다.
  // splitStoryHighlight가 before+highlight+after로 원문을 정확 분할하므로,
  // 본문은 before+after만 렌더. 매칭 실패(storyHi === null)면 원문 그대로(카피 손실 금지).
  const displayStory = useMemo(() => {
    if (!storyHi) return copy.story
    return `${storyHi.before}${storyHi.after}`.replace(/\n{3,}/g, "\n\n").trim()
  }, [storyHi, copy.story])
  return (
    <div
      style={{
        padding: isMobile ? "52px 24px" : "104px 56px",
        background: "#FFFFFF",
        position: "relative",
      }}
    >
      {/* v3.4(지시3): STORY 검정 캡션 → accent 리본 배너(좌우 접힌 꼬리)로 교체 */}
      {hasStory && (
        <div
          style={{
            textAlign: "center",
            marginBottom: isMobile ? 30 : 40,
          }}
        >
          <RibbonLabel text="STORY" accent={accent} isMobile={isMobile} />
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
        {/* D13: JPG 본문 — 발췌 문장을 뺀 displayStory를 평문으로 렌더(편집은 아래 chrome).
            storyHi가 null(매칭 실패)이면 displayStory === copy.story 라 현행 유지. */}
        {displayStory.trim() && (
          <p
            style={{
              fontSize: isMobile ? 20 : 34,
              color: INK,
              lineHeight: 1.7,
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
            {displayStory}
          </p>
        )}

        {/*
          형광펜 강조 콜아웃 — story의 첫 감각 문장을 accent.soft 배경+진한 글씨로 다시 노출.
          긴 문단에서 "핵심 한 줄"을 훑어 읽게 하는 참외/수플린 레퍼런스 장치.
          지어내는 것 없이 셀러 원문 문장 그대로. 문장이 1개뿐이거나 감지 실패 시 미노출.
        */}
        {storyHi && (
          <div
            style={{
              marginTop: isMobile ? 24 : 34,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                display: "inline-block",
                background: accent.soft,
                color: accent.dark,
                padding: isMobile ? "10px 16px" : "16px 26px",
                borderRadius: 8,
                fontSize: isMobile ? 20 : 34,
                fontWeight: 800,
                lineHeight: 1.5,
                fontFamily: BODY_FONT,
                letterSpacing: -0.3,
                wordBreak: "keep-all",
                boxShadow: `inset 0 -0.5em 0 ${accent.soft}`,
              }}
            >
              {/*
                부분 밑줄 형광펜 — 콜아웃 문장 안에서 첫 감각어 포함 2~3어절만
                accent 물결 밑줄 + 더 두꺼운 글씨로 재강조. 원문(storyHi.highlight)은
                그대로 두고 스타일만. wordwrap을 깨지 않게 mark만 감싼다.
              */}
              {(() => {
                const { lead, mark, tail } = splitPhraseEmphasis(storyHi.highlight)
                if (!mark) return storyHi.highlight
                return (
                  <>
                    {lead}
                    <span
                      style={{
                        fontWeight: 900,
                        color: accent.accent,
                        textDecoration: "underline wavy",
                        textDecorationColor: accent.accent,
                        textDecorationThickness: 2,
                        textUnderlineOffset: isMobile ? 5 : 8,
                      }}
                    >
                      {mark}
                    </span>
                    {tail}
                  </>
                )
              })()}
            </span>
          </div>
        )}
      </div>

      {/* D13: 스토리 편집 진입 — 편집 전용(JPG 제외). 발췌 문장 포함 원문 전체를 편집.
          위 JPG 본문(displayStory)·콜아웃은 이 원문에서 파생된다(StorageBlock과 동일 방식). */}
      <div
        data-edit-chrome
        style={{
          marginTop: isMobile ? 16 : 24,
          maxWidth: 720,
          marginLeft: "auto",
          marginRight: "auto",
          padding: isMobile ? "20px 22px" : "28px 34px",
          background: BG_SOFT,
          borderRadius: 10,
          border: `1px dashed ${LINE}`,
        }}
      >
        <p
          style={{
            margin: "0 0 8px",
            fontSize: isMobile ? 12 : 14,
            color: MUTE,
            fontWeight: 700,
            fontFamily: BODY_FONT,
          }}
        >
          이야기 편집 (강조 문장은 위 발췌 박스로 노출돼요)
        </p>
        <p
          style={{
            fontSize: isMobile ? 16 : 22,
            color: INK,
            lineHeight: 1.6,
            whiteSpace: "pre-line",
            margin: 0,
            fontFamily: BODY_FONT,
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

      {onRegen && (
        <div data-edit-chrome style={{ display: "flex", justifyContent: "center", marginTop: 14 }}>
          {onRegen}
        </div>
      )}
    </div>
  )
}

/**
 * SensoryPunchBlock — 임팩트 카피-사진 밀착 블록 (참외 레퍼런스).
 *
 * 검정(#1A1A1A) 풀블리드 배경 + 대형 임팩트 카피(BlackHanSans) + 바로 아래 실사진 1장 밀착.
 * 카피 소스는 copy.highlightBox(기존 검정 슬로건) — StoryBlock에서 이 블록으로 승격.
 * highlightBox가 비어 있으면 호출부에서 렌더하지 않는다(게이팅).
 *
 * 카피는 accent 색을 입혀(검정 배경 위 대비) 시선 앵커로 만든다 — 지어내는 것 없이
 * highlightBox 원문 그대로, 스타일만. 편집 가능(highlightBox 경로).
 * 사진은 imagePlan.punch(분위기 컷, 중복 허용). 없으면 카피만 노출.
 */
const PUNCH_BG = "#1A1A1A"
function SensoryPunchBlock({
  copy,
  onCopyChange,
  image,
  isMobile,
  tinted = false,
}: {
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  image?: UploadedImage
  isMobile: boolean
  /**
   * v3.8(지시5) 다크 밴드 1회 제한 — true면 검정 풀블리드 대신 밝은 틴트 버전으로 렌더.
   * 한 페이지에 강조 다크 밴드는 1회만(희소해야 강함). 이 블록이 그 1회를 쓸 때는
   * tinted=false(검정 유지)로, 페이지에 이미 다른 다크 밴드가 있으면 tinted=true로 호출.
   */
  tinted?: boolean
}) {
  const accent = useAccent()
  // 틴트 버전: 밝은 배경(veilTint) + INK 헤드 + accent 하이라이트. 검정 버전: 검정 배경 + 밝은 카피.
  const bg = tinted ? veilTint(accent.soft) : PUNCH_BG
  const copyColor = tinted ? accent.dark : accent.soft
  return (
    <div style={{ background: bg }}>
      {/* 임팩트 카피 — 다크(검정 위 밝은 카피) 또는 틴트(밝은 배경 위 accent.dark). 편집 가능(highlightBox 경로). */}
      <div
        style={{
          padding: isMobile ? "56px 24px" : "104px 56px",
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 42 : 72,
            fontWeight: 400,
            color: tinted ? INK : "#FFFFFF",
            margin: 0,
            lineHeight: 1.18,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1.5,
            wordBreak: "keep-all",
          }}
        >
          <EditableResultText
            copy={copy}
            onChange={onCopyChange}
            path={["highlightBox"]}
            maxLength={60}
            placeholder="한 줄 임팩트 카피 (예: 수분 가득, 과즙 팡팡!)"
            // F(minor): 검정 밴드 위 빨강(저대비) → accent.soft(밝은 틴트)로 가독성 확보(01·04).
            // 틴트 버전에선 accent.dark로 대비 확보.
            style={{ color: copyColor }}
          />
        </p>
      </div>

      {/* 바로 아래 실사진 1장 — 카피와 한 몸으로 밀착(꽉 찬 폭). 분위기 컷이라 중복 허용. */}
      {image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image.url}
          alt=""
          style={{
            width: "100%",
            aspectRatio: isMobile ? "4/3" : "16/9",
            objectFit: "cover",
            display: "block",
          }}
        />
      )}
    </div>
  )
}

/**
 * v3.4(지시6) 갤러리 컬러 바 캡션용 중립 안전 문구 풀.
 * 사실 주장(당도·산지·수확일 등) 금지 — 사진 성격만 담담히 서술.
 * 사진마다 서로 다른 문구를 순서대로 배정해 반복을 피한다.
 */
const GALLERY_SAFE_CAPTIONS = [
  "산지에서 갓 담은 모습",
  "받아보시는 그대로",
  "정성껏 골라 담았어요",
  "식탁에 올리기 좋은 크기",
  "가까이서 본 결과 빛깔",
  "한 알 한 알 신경 썼어요",
  "포장 전 마지막 점검",
  "이렇게 보내드립니다",
]

/**
 * v3.8(지시1) 갤러리 모자이크 — 풀폭↔2그리드 리듬으로 "디자이너가 짠 배치"를 만든다.
 *
 * 배치 규칙(진단 #1·#2 해소):
 *  - 4장 이상: [풀폭 1] → [2그리드] → [풀폭 1] → [2그리드] … 패턴으로 소비.
 *    자투리 1장이 남으면 풀폭으로 마무리(반토막 그리드 방지).
 *  - 3장 이하: [풀폭 1] + [나머지 2그리드](2장이면 2열, 1장이면 그 자체가 풀폭).
 *  - 컬러 캡션 바는 풀폭 사진에만, 페이지 전체 최대 2개(진단 #2: 캡션은 포인트 1~2장만).
 *    그리드 사진은 캡션 없이 클린.
 *
 * JPG 분할 안전(불변): 각 행(풀폭 1장 또는 2그리드 한 쌍)이 flex column의 원자적 자식이라
 * 슬라이서가 행 내부를 자르지 않는다. 행 자체가 하나의 요소이므로 data-slice-glue 불필요.
 *
 * 판단 기준 준수: 2그리드 gap 12px, 각 사진 borderRadius 유지, 세로비 1:1 crop(objectFit cover).
 */
type GalleryRow =
  | { kind: "full"; img: UploadedImage; captionIdx: number | null }
  | { kind: "pair"; imgs: UploadedImage[] }

function buildGalleryRows(images: UploadedImage[]): GalleryRow[] {
  const rows: GalleryRow[] = []
  if (images.length === 0) return rows

  // 3장 이하: 풀폭 1 + 나머지(2그리드 또는 단독). 캡션은 풀폭에만(1개).
  if (images.length <= 3) {
    const [first, ...rest] = images
    rows.push({ kind: "full", img: first, captionIdx: 0 })
    if (rest.length === 1) {
      // 남은 1장도 풀폭으로(반폭 외톨이 방지). 캡션은 이미 1개 썼으니 두 번째는 캡션 유지(최대 2).
      rows.push({ kind: "full", img: rest[0], captionIdx: 1 })
    } else if (rest.length === 2) {
      rows.push({ kind: "pair", imgs: rest })
    }
    return rows
  }

  // 4장 이상: 풀폭 → 2그리드 → 풀폭 → 2그리드 … 캡션은 풀폭에만, 최대 2개.
  let i = 0
  let captionCount = 0
  while (i < images.length) {
    // 풀폭 1장
    const remaining = images.length - i
    if (remaining === 1) {
      // 마지막 1장 자투리 — 풀폭으로 마무리.
      const captionIdx = captionCount < 2 ? captionCount : null
      if (captionIdx != null) captionCount++
      rows.push({ kind: "full", img: images[i], captionIdx })
      i += 1
      break
    }
    const captionIdx = captionCount < 2 ? captionCount : null
    if (captionIdx != null) captionCount++
    rows.push({ kind: "full", img: images[i], captionIdx })
    i += 1
    // 2그리드 (남은 게 2장 이상일 때만 쌍으로; 정확히 1장 남으면 다음 루프에서 풀폭 마무리)
    if (images.length - i >= 2) {
      rows.push({ kind: "pair", imgs: [images[i], images[i + 1]] })
      i += 2
    }
  }
  return rows
}

function GalleryBlock({
  images,
  productName,
  isMobile,
}: {
  images: UploadedImage[]
  productName: string
  isMobile: boolean
}) {
  // v3.8(지시1): 풀폭↔2그리드 모자이크. buildGalleryRows가 배치·캡션 배정을 결정.
  const rows = useMemo(() => buildGalleryRows(images), [images])

  // 컬러 캡션 바 문구 — 풀폭 사진에만, captionIdx 순서대로 서로 다른 안전 문구.
  const captionFor = (idx: number) =>
    GALLERY_SAFE_CAPTIONS[idx % GALLERY_SAFE_CAPTIONS.length]

  let altSeq = 0
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
      {rows.map((row, ri) => {
        if (row.kind === "full") {
          altSeq++
          const caption = row.captionIdx != null ? captionFor(row.captionIdx) : null
          return (
            <div
              key={`gal-full-${ri}`}
              style={{
                position: "relative",
                background: "#FFFFFF",
                borderRadius: 8,
                overflow: "hidden",
                boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={row.img.url}
                alt={`${productName} ${altSeq}`}
                style={{
                  width: "100%",
                  aspectRatio: "4/3",
                  objectFit: "cover",
                  display: "block",
                }}
              />
              {/* v2.9(지시2): 풀폭 단색 캡션 바 → 사진 좌하단 오버레이 알약.
                  반투명 잉크 배경(rgba, html-to-image 호환) + 흰 글씨. filter류 없음. */}
              {caption && (
                <div
                  style={{
                    position: "absolute",
                    left: 16,
                    bottom: 16,
                    background: "rgba(33,37,41,0.62)",
                    color: "#FFFFFF",
                    padding: "8px 18px",
                    fontSize: isMobile ? 13 : 20,
                    fontWeight: 700,
                    fontFamily: BODY_FONT,
                    letterSpacing: -0.3,
                    borderRadius: 999,
                    wordBreak: "keep-all",
                  }}
                >
                  {caption}
                </div>
              )}
            </div>
          )
        }
        // 2그리드 — 각 사진 1:1 crop, borderRadius 유지, gap 12px. 캡션 없이 클린.
        return (
          <div
            key={`gal-pair-${ri}`}
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 12,
            }}
          >
            {row.imgs.map((img) => {
              altSeq++
              return (
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
                    alt={`${productName} ${altSeq}`}
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/**
 * 당도 기준선 바 (리서치: 당도 숫자는 기준선 맥락이 있어야 팔림).
 * fruit-facts 매칭 + 사용자 brix가 goodBrix 이상일 때만 렌더한다.
 * (brix < goodBrix면 불리한 시각화라 호출부에서 아예 렌더하지 않는다.)
 *
 * 눈금: goodBrix("맛있다 기준")·brixCeiling("품종 최대") 두 포인트 + 사용자 brix 위치에 accent 마커.
 * "비파괴 측정" 등 근거 없는 문구는 넣지 않는다.
 */
function BrixScaleBar({
  brix,
  goodBrix,
  brixCeiling,
  isMobile,
}: {
  brix: number
  goodBrix: number
  brixCeiling: number
  isMobile: boolean
}) {
  const accent = useAccent()
  const bs = t.detail.result.brixScale

  // 도메인 — goodBrix 아래로 약간 여유(2), 위로는 ceiling과 사용자 brix 중 큰 값.
  const lo = Math.max(0, goodBrix - 2)
  const hi = Math.max(brixCeiling, brix)
  const span = hi - lo
  const pct = (v: number) => (span > 0 ? Math.min(100, Math.max(0, ((v - lo) / span) * 100)) : 0)

  const goodPct = pct(goodBrix)
  const brixPct = pct(brix)

  return (
    <div style={{ marginTop: isMobile ? 16 : 22 }}>
      {/* 사용자 brix 마커 라벨 */}
      <div style={{ position: "relative", height: isMobile ? 28 : 40, marginBottom: isMobile ? 6 : 8 }}>
        <div
          style={{
            position: "absolute",
            left: `${brixPct}%`,
            transform: "translateX(-50%)",
            whiteSpace: "nowrap",
            fontSize: isMobile ? 15 : 26,
            fontWeight: 800,
            color: accent.accent,
            fontFamily: BODY_FONT,
          }}
        >
          {bs.ours.replace("{brix}", `${brix}`)}
        </div>
      </div>

      {/* 트랙 */}
      <div
        style={{
          position: "relative",
          height: isMobile ? 10 : 14,
          background: "#E9ECEF",
          borderRadius: 999,
        }}
      >
        {/* goodBrix~사용자 구간을 accent.soft로 채워 "기준 이상" 시각화 */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: `${goodPct}%`,
            width: `${Math.max(0, brixPct - goodPct)}%`,
            top: 0,
            bottom: 0,
            background: accent.soft,
            borderRadius: 999,
          }}
        />
        {/* goodBrix 눈금 */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: `${goodPct}%`,
            transform: "translateX(-50%)",
            top: isMobile ? -4 : -6,
            width: isMobile ? 3 : 4,
            height: isMobile ? 18 : 26,
            background: MUTE,
            borderRadius: 2,
          }}
        />
        {/* C8: "품종 최대" ceiling 눈금 삭제 — 검증 불가 단정. */}
        {/* 사용자 brix 마커 (accent 원) */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: `${brixPct}%`,
            transform: "translate(-50%, -50%)",
            top: "50%",
            width: isMobile ? 18 : 26,
            height: isMobile ? 18 : 26,
            borderRadius: "50%",
            background: accent.accent,
            border: "3px solid #FFFFFF",
            boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
          }}
        />
      </div>

      {/* 눈금 라벨 */}
      <div style={{ position: "relative", height: isMobile ? 34 : 44, marginTop: isMobile ? 8 : 10 }}>
        <div
          style={{
            position: "absolute",
            left: `${goodPct}%`,
            transform: "translateX(-50%)",
            textAlign: "center",
            whiteSpace: "nowrap",
            fontSize: isMobile ? 14 : 24,
            color: SUB,
            fontWeight: 600,
            fontFamily: BODY_FONT,
          }}
        >
          {bs.good}
          <br />
          {goodBrix}
        </div>
        {/* C8: "품종 최대" ceiling 라벨 삭제 — 검증 불가 단정. */}
      </div>

      {/* C8: 게이지 하단 캡션 — 품종 일반 정보 참고, 개체차 있음. */}
      <div
        style={{
          marginTop: isMobile ? 4 : 6,
          fontSize: isMobile ? 8 : 12,
          color: MUTE,
          fontFamily: BODY_FONT,
          lineHeight: 1.4,
        }}
      >
        {bs.caption}
      </div>
    </div>
  )
}

/**
 * v3.4(지시8): 스펙 라벨용 미니 라인 아이콘 — 라벨 키워드로 매핑, 미매칭은 PackIcon.
 * 기존 LineIcons(손그림 라인) 재사용 → 브랜드 톤 통일, toCanvas 호환.
 */
function specLabelIcon(label: string): (p: LineIconProps) => React.JSX.Element {
  // F(minor): 의미별 고유 아이콘 — 같은 아이콘이 한 페이지에서 두 의미로 쓰이지 않게
  // 당도=BrixIcon(물방울) / 산지=MapPinIcon(핀) / 중량=ScaleIcon(저울) / 품종=LeafIcon(잎)로 분리.
  if (/(당도|Brix|brix|맛|향|달)/.test(label)) return BrixIcon
  if (/(산지|원산지|재배|농장|생산)/.test(label)) return MapPinIcon
  if (/(보관|냉장|냉동|저온|콜드)/.test(label)) return ColdIcon
  if (/(중량|무게|크기|용량|수량|개수)/.test(label)) return ScaleIcon
  if (/(포장|배송|택배|발송)/.test(label)) return DeliverIcon
  if (/(품종|등급|규격|선별)/.test(label)) return LeafIcon
  return PackIcon
}

function SpecBlock({
  copy,
  productName,
  weight: _weight, // 개수 환산이 크기 블록으로 이관되어 미사용 (인터페이스는 유지)
  onCopyChange,
  onRegen,
  isMobile,
}: {
  copy: CopyOutput
  productName: string
  weight?: string
  onCopyChange: (next: CopyOutput) => void
  onRegen: React.ReactNode
  isMobile: boolean
}) {
  const accent = useAccent()
  const specCount = copy.spec.length

  // 당도 기준선 바 — fruit-facts 매칭 시에만 사용할 기준값.
  const brixFact = FRUIT_FACTS[detectFruitFactKey(productName) ?? ""]

  // (개수 환산은 크기 블록이 전담 — v3.1-b에서 스펙 쪽 중복 행 삭제)

  // v3.4 fix(이슈3): 당도 카드(대형 숫자 + Brix 기준선 바)는 세로로 훨씬 길어,
  // 같은 2열 행에 놓인 옆 카드(중량 등)에 ~400px 빈 공간을 만들었다.
  // → 기준선 바가 실제로 붙는 "키 큰 당도 카드"만 행에서 빼 풀폭으로 올리고,
  //   나머지 카드끼리 2열 그리드를 유지한다. (바가 안 붙는 평범한 당도 카드는 그대로 그리드에 남음)
  const isTallBrix = (s: CopyOutput["spec"][number]): boolean => {
    if (!/(당도|Brix|brix)/.test(s.label) || !s.value) return false
    const m = s.value.trim().match(/^(\d+(?:\.\d+)?)\s*([A-Za-z가-힣]+)?/)
    if (!m) return false
    const brixValue = Number(m[1])
    return !!brixFact && Number.isFinite(brixValue) && brixValue >= brixFact.goodBrix
  }
  // 풀폭으로 뺄 당도 카드 인덱스(첫 매칭 1개만) + 그리드에 남을 나머지.
  const featuredIdx = copy.spec.findIndex(isTallBrix)
  const gridSpecs = copy.spec
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => i !== featuredIdx)
  // 그리드 열 수 — 남은 카드가 1개면 1열, 아니면 2열.
  const columns = gridSpecs.length <= 1 ? "1fr" : "repeat(2, minmax(0, 1fr))"

  // 스펙 카드 1장 렌더 (풀폭·그리드 공용). i는 원본 copy.spec 인덱스(편집 경로용).
  // fullSpan: F(minor) 홀수 개 그리드의 마지막 카드를 2열 전체로 확장(외톨이 반폭 카드 방지).
  const renderCard = (s: CopyOutput["spec"][number], i: number, fullSpan?: boolean) => {
    const isSweetness = /(당도|Brix|brix)/.test(s.label)
    const sweetnessMatch = isSweetness && s.value
      ? s.value.trim().match(/^(\d+(?:\.\d+)?)\s*([A-Za-z가-힣]+)?/)
      : null
    return (
      <div
        key={`spec-${i}`}
        style={{
          gridColumn: fullSpan ? "1 / -1" : undefined,
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
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 7 : 10,
            fontSize: isMobile ? 15 : 24,
            color: SUB,
            fontWeight: 700,
            fontFamily: BODY_FONT,
            letterSpacing: 0.5,
          }}
        >
          {/* v3.4(지시8): 라벨 앞 미니 라인 아이콘 */}
          {(() => {
            const MiniIcon = specLabelIcon(s.label)
            return <MiniIcon color={accent.accent} size={isMobile ? 20 : 30} />
          })()}
          <span>{s.label}</span>
        </div>
        {isSweetness && sweetnessMatch ? (
          (() => {
            const brixValue = Number(sweetnessMatch[1])
            // 기준선 바는 fact 매칭 + brix가 "맛있다 기준" 이상일 때만 (불리한 시각화 방지).
            const showScale =
              !!brixFact &&
              Number.isFinite(brixValue) &&
              brixValue >= brixFact.goodBrix
            return (
              <>
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
                {showScale && brixFact && (
                  <BrixScaleBar
                    brix={brixValue}
                    goodBrix={brixFact.goodBrix}
                    brixCeiling={brixFact.brixCeiling}
                    isMobile={isMobile}
                  />
                )}
              </>
            )
          })()
        ) : (
          (() => {
            // B5: 공백 없는 12자+ 식별자(예: GAP-2026-0412)는 폰트 축소 + 한 줄 유지로 꺾임 방지.
            const longestToken = (s.value ?? "")
              .split(/\s+/)
              .reduce((max, tok) => Math.max(max, tok.length), 0)
            const isLongId = longestToken >= 12
            const baseSize = isMobile ? 22 : 40
            return (
              <div
                style={{
                  fontSize: isLongId ? (isMobile ? 15 : 26) : baseSize,
                  fontWeight: 800,
                  color: INK,
                  lineHeight: 1.35,
                  // 긴 식별자는 어떤 위치에서도 안 꺾이게(nowrap), 일반 값은 keep-all.
                  wordBreak: "keep-all",
                  whiteSpace: isLongId ? "nowrap" : undefined,
                  overflow: isLongId ? "hidden" : undefined,
                  textOverflow: isLongId ? "ellipsis" : undefined,
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
            )
          })()
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        padding: isMobile ? "44px 24px" : "76px 44px",
        background: veilTint(accent.soft),
      }}
    >
      <SectionTitle title={t.detail.result.spec} regen={onRegen} isMobile={isMobile} />

      {specCount > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 10 : 16 }}>
          {/* 키 큰 당도 카드(기준선 바 포함)는 풀폭 — 옆 카드 여백 덩어리 제거(이슈3). */}
          {featuredIdx >= 0 && renderCard(copy.spec[featuredIdx], featuredIdx)}
          {/* 나머지 스펙은 2열 그리드 유지 */}
          {gridSpecs.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: columns,
                gap: isMobile ? 10 : 16,
              }}
            >
              {/* v2.3: 이모지 아이콘 삭제, 카드 테두리 얇은 회색, 라벨/값 리듬 통일 */}
              {/* F(minor): 2열 그리드에서 홀수 개면 마지막 카드를 풀폭으로. */}
              {gridSpecs.map(({ s, i }, gi) =>
                renderCard(
                  s,
                  i,
                  gridSpecs.length > 1 &&
                    gridSpecs.length % 2 === 1 &&
                    gi === gridSpecs.length - 1,
                ),
              )}
            </div>
          )}
        </div>
      ) : (
        <div
          // 빈 스펙 안내는 편집 화면 전용 — JPG 캡처 제외
          data-edit-chrome
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

      {/* v3.1-b: 스펙 쪽 개수 환산 행 삭제 — 바로 아래 크기 블록(SizeDiagramBlock)이
          같은 환산을 카드로 보여줘 연속 중복이었다 (하네스 실측에서 발견). */}
    </div>
  )
}

function KeyPointsBig({
  points,
  copy,
  onCopyChange,
  pointImageFor,
  isMobile,
  noun,
}: {
  points: CopyKeyPoint[]
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
  pointImageFor: (idx: number) => UploadedImage | undefined
  isMobile: boolean
  /** A3: 카테고리 명사 — 섹션 제목의 {noun} 치환. */
  noun: string
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
        {/* problemArc가 있으면 문제→해결 연결 전환 캡션 (accent). 헤더 위에 얹어 서사 이음. */}
        {copy.problemArc && copy.problemArc.problems.length > 0 && (
          <p
            style={{
              margin: 0,
              marginBottom: isMobile ? 14 : 20,
              fontSize: isMobile ? 17 : 26,
              fontWeight: 800,
              color: accent.accent,
              letterSpacing: -0.3,
              fontFamily: BODY_FONT,
              lineHeight: 1.4,
              wordBreak: "keep-all",
            }}
          >
            그래서 이렇게 준비했어요
          </p>
        )}
        {/* v3.8 fix(진단 #2): 대제목 영문 오버라인 라벨 — WHY(원형 엠블럼)·REVIEW(SectionTitle
            overline)와 톤을 맞춰 POINT 를 얹는다. 위 한글 문구는 problemArc 서사 브리지라
            별개(오버라인이 아니었음). SectionTitle hero overline 과 동일 스타일(작은 accent,
            자간 2)을 인라인으로 재현 — 이 섹션은 SectionTitle 를 안 쓰므로 직접 렌더. */}
        <div
          style={{
            fontSize: isMobile ? 13 : 22,
            color: accent.accent,
            fontWeight: 800,
            letterSpacing: 2,
            marginBottom: isMobile ? 8 : 12,
            fontFamily: BODY_FONT,
          }}
        >
          POINT
        </div>
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
          {t.detail.result.keyPointsSectionTitle
            .replace("{noun}", noun)
            .replace("{josa}", subjectJosa(noun))}
        </h2>
      </div>

      {/* v2.6: POINT별 배경색 살짝 변주 (아보카도·수플린 페이지 톤 참조) */}
      {points.map((p, i) => {
        const img = pointImageFor(i)
        // v2.8: POINT 배경 변주 — 흰 / 옅은 회색 / 과일 축색 soft 틴트
        const bgTints = ["#FFFFFF", "#FAFBFC", accent.soft]
        const bg = bgTints[i % bgTints.length]

        // v3.8(지시2): 지그재그 — 데스크톱 & 사진 있을 때만 좌우 2열(6:4).
        //  홀수 POINT(01,03…)는 텍스트 좌·사진 우, 짝수(02…)는 반대. 세로 중앙 정렬.
        //  모바일 또는 사진 없음 → 세로 스택(현행 유지). 한 행 전체가 이 div 하나라
        //  JPG 슬라이서가 행 내부(사진+텍스트)를 쪼개지 않는다(불변: 통째 한 그룹).
        const zigzag = !isMobile && !!img
        const imageLeft = zigzag && i % 2 === 1 // 짝수 인덱스(POINT 02)면 사진을 왼쪽으로

        // 텍스트 열 — 배경 넘버·POINT 배지·제목·본문. 지그재그/스택 공용.
        const textCol = (
          <div style={{ position: "relative", minWidth: 0 }}>
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
                fontSize: isMobile ? 14 : 24,
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
                fontSize: isMobile ? 20 : 34,
                color: SUB,
                lineHeight: 1.7,
                margin: 0,
                // 지그재그에선 사진이 옆 열이라 본문 아래 여백 불필요.
                marginBottom: zigzag ? 0 : isMobile ? 32 : 44,
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
          </div>
        )

        // 이미지 열 — 지그재그면 4:5 세로비, 스택이면 기존 1:1 대형.
        const imageCol = img ? (
          <div
            style={{
              display: zigzag ? "block" : "flex",
              justifyContent: "center",
              marginTop: zigzag ? 0 : 20,
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt=""
                style={{
                  width: "100%",
                  // 지그재그: 세로비 4:5(레퍼런스), 스택: 1:1 대형(기존).
                  aspectRatio: zigzag ? "4/5" : "1",
                  objectFit: "cover",
                  display: "block",
                }}
              />
            </div>
          </div>
        ) : null

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
              {zigzag ? (
                // 데스크톱 지그재그 — 2열(6:4), 세로 중앙 정렬, 번갈아 좌우 배치.
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: imageLeft ? "4fr 6fr" : "6fr 4fr",
                    columnGap: 44,
                    alignItems: "center",
                  }}
                >
                  {imageLeft ? (
                    <>
                      {imageCol}
                      {textCol}
                    </>
                  ) : (
                    <>
                      {textCol}
                      {imageCol}
                    </>
                  )}
                </div>
              ) : (
                // 모바일 또는 사진 없음 — 세로 스택(현행).
                <>
                  {textCol}
                  {imageCol}
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * storage 원문을 STEP 타임라인용 단계 배열로 분해 (지시7, peach-s08).
 * 지어내지 않고 셀러 원문만 쓴다: 줄바꿈 우선, 없으면 문장부호로 분할.
 * 최대 3단계. 분할 결과가 1개뿐이면 단일 STEP으로 렌더(타임라인 점 1개).
 */
function splitStorageSteps(storage: string): string[] {
  const text = (storage ?? "").trim()
  if (!text) return []
  // 1) 줄바꿈 기준
  let parts = text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  // 2) 한 줄뿐이면 문장부호(.!?) 기준으로 재분할
  if (parts.length < 2) {
    parts = text
      .split(/(?<=[.!?。])\s+/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return parts.slice(0, 3)
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
  const accent = useAccent()
  // v3.4(지시7): storage 원문을 STEP 01/02/03 세로 타임라인으로 재구성.
  // 편집은 아래 EditableResultText(편집 전용 chrome)에서 그대로 하고,
  // JPG에는 원문에서 파생한 STEP 타임라인 카드만 찍힌다 (StoryBlock과 동일한 방식).
  const steps = useMemo(() => splitStorageSteps(copy.storage), [copy.storage])

  return (
    <div
      style={{
        padding: isMobile ? "44px 24px" : "76px 44px",
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.storage} regen={onRegen} isMobile={isMobile} />

      {steps.length > 0 && (
        <div
          style={{
            border: `1px solid ${accent.soft}`,
            borderRadius: 22,
            padding: isMobile ? "28px 22px" : "52px 48px",
            background: "#FFFFFF",
          }}
        >
          {steps.map((s, i) => {
            const last = i === steps.length - 1
            const dot = isMobile ? 20 : 30
            return (
              <div
                key={`storage-step-${i}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: `${isMobile ? 84 : 132}px 1fr`,
                  columnGap: isMobile ? 12 : 22,
                }}
              >
                {/* 왼쪽: STEP 라벨 + 점 + 세로 연결선 — 라벨·점·선을 열 중앙 정렬 */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    position: "relative",
                  }}
                >
                  <span
                    style={{
                      fontSize: isMobile ? 18 : 30,
                      fontWeight: 400,
                      color: accent.accent,
                      fontFamily: DISPLAY_FONT,
                      letterSpacing: -0.5,
                      lineHeight: 1,
                    }}
                  >
                    STEP {String(i + 1).padStart(2, "0")}
                  </span>
                  {/* 점 (아웃라인 원) */}
                  <span
                    aria-hidden
                    style={{
                      marginTop: isMobile ? 6 : 10,
                      width: dot,
                      height: dot,
                      borderRadius: "50%",
                      background: "#FFFFFF",
                      border: `${isMobile ? 3 : 4}px solid ${accent.accent}`,
                      flexShrink: 0,
                    }}
                  />
                  {/* 세로 연결선 (마지막 단계 제외) — 점과 같은 축(열 중앙) */}
                  {!last && (
                    <span
                      aria-hidden
                      style={{
                        position: "absolute",
                        left: "50%",
                        marginLeft: isMobile ? -1 : -1.5,
                        top: (isMobile ? 24 : 40) + dot,
                        bottom: 0,
                        width: isMobile ? 2 : 3,
                        background: accent.soft,
                      }}
                    />
                  )}
                </div>
                {/* 오른쪽: 단계 본문 */}
                <p
                  style={{
                    margin: 0,
                    paddingBottom: last ? 0 : isMobile ? 28 : 48,
                    fontSize: isMobile ? 18 : 32,
                    color: INK,
                    lineHeight: 1.6,
                    fontWeight: 500,
                    fontFamily: BODY_FONT,
                    letterSpacing: -0.3,
                    wordBreak: "keep-all",
                    whiteSpace: "pre-line",
                  }}
                >
                  {s}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {/* 편집 전용 — 실제 storage 텍스트 편집 진입(JPG 제외). steps는 여기 원문에서 파생. */}
      <div
        data-edit-chrome
        style={{
          marginTop: steps.length > 0 ? (isMobile ? 16 : 24) : 0,
          padding: isMobile ? "20px 22px" : "28px 34px",
          background: BG_SOFT,
          borderRadius: 10,
          border: `1px dashed ${LINE}`,
        }}
      >
        <p
          style={{
            margin: "0 0 8px",
            fontSize: isMobile ? 12 : 14,
            color: MUTE,
            fontWeight: 700,
            fontFamily: BODY_FONT,
          }}
        >
          보관법 편집 (줄바꿈으로 STEP 구분)
        </p>
        <p
          style={{
            fontSize: isMobile ? 16 : 22,
            color: INK,
            lineHeight: 1.6,
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
            placeholder="보관법을 알려주시면 셀러 신뢰가 올라가요 (줄바꿈으로 단계 구분)"
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
        padding: isMobile ? "44px 24px" : "76px 44px",
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
                fontSize: isMobile ? 19 : 34,
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
                fontSize: isMobile ? 18 : 32,
                color: SUB,
                lineHeight: 1.7,
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
 * 크기·중량 안내 — 사용자 지적("사진도 없는데 추상 원 3개가 무슨 소용") 반영 개편.
 *
 * 무게 데이터가 있을 때만 텍스트 카드(개당 평균 g + 박스 개수 환산 + 편차 안내)로
 * 렌더하고, 없으면 블록 자체를 렌더하지 않는다(null).
 *
 * v3.1-b: "남는 사진 자동 부착(sizeRef)" 삭제 — 설향 딸기 사례에서 비닐하우스
 * 사진에 "실제 크기 참고" 캡션이 붙어 오히려 자동 생성 티가 났다. 크기와 무관한
 * 사진일 확률이 높으므로 사진 슬롯은 셀러가 명시 지정할 수 있게 될 때까지 없앤다.
 *
 * "개당 평균 g"·"개수 환산"은 fruit-facts.avgWeightG가 있는 품종에서만 — 없으면 그 행 생략.
 * 렌더할 내용이 있을 때만 앞에 DotDivider를 함께 그린다(빈 블록 뒤 유령 구분선 방지).
 */
function SizeDiagramBlock({
  productName,
  weight,
  sizeImage,
  isMobile,
  noun,
  hasSizeMention,
}: {
  productName?: string
  weight?: string
  /** v3.7: 크기 비교 전용 슬롯 사진(손·동전·자와 함께). 있으면 무게카드 위에 렌더. */
  sizeImage?: UploadedImage | null
  isMobile: boolean
  /** A3: 카테고리 명사 — 편차 안내 문구의 {noun} 치환. */
  noun: string
  /** D17: 입력 faq/cautions에 "크기" 항목이 이미 있으면 편차 안내 박스 생략. */
  hasSizeMention?: boolean
}) {
  const accent = useAccent()
  const sr = t.detail.result.sizeRef
  const name = productName?.trim() || "이 상품"

  const avgWeightG = productName ? getAvgWeightG(productName) : null
  const perPieceLabel = avgWeightG != null ? sr.perPiece.replace("{g}", `${avgWeightG}`) : null
  const boxCount =
    weight?.trim() && avgWeightG != null ? estimateCountLabel(weight.trim(), avgWeightG) : null
  const boxCountLabel =
    boxCount && weight?.trim()
      ? sr.boxCount.replace("{weight}", weight.trim()).replace("{count}", boxCount)
      : null

  // v3.7: 크기 전용 사진이 있거나 무게 데이터가 있을 때만 렌더.
  // 둘 다 없으면 기존과 동일하게 섹션 자체를 렌더하지 않는다.
  const hasWeightInfo = !!weight?.trim() || perPieceLabel != null
  if (!hasWeightInfo && !sizeImage) return null

  return (
    <>
      <DotDivider />
      <div style={{ padding: isMobile ? "44px 24px" : "76px 44px", background: "#FFFFFF" }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, marginBottom: isMobile ? 24 : 36 }}>
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

        {/* v3.7: 크기 비교 전용 슬롯 사진 — 있을 때만. 손·동전·자와 함께 찍은 실사진.
            captureRef 내부라 인라인 style + hex 상수만 사용(필터/CSS 변수 없음). */}
        {sizeImage && (
          <div
            style={{
              borderRadius: 12,
              overflow: "hidden",
              marginBottom: isMobile ? 20 : 28,
              boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sizeImage.url}
              alt={`${name} 실제 크기 참고`}
              style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", display: "block" }}
            />
          </div>
        )}

        {/* 무게·개수 카드 — 개당 g / 박스 개수 환산 / 중량 (있는 행만) */}
        {(perPieceLabel || boxCountLabel || weight?.trim()) && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: isMobile ? 10 : 14,
              padding: isMobile ? "22px 24px" : "34px 40px",
              background: accent.soft,
              borderRadius: 12,
              marginBottom: isMobile ? 20 : 28,
            }}
          >
            {weight?.trim() && (
              <div
                style={{
                  fontSize: isMobile ? 18 : 30,
                  color: INK,
                  fontWeight: 800,
                  fontFamily: BODY_FONT,
                  letterSpacing: -0.3,
                }}
              >
                중량 · {weight.trim()}
              </div>
            )}
            {perPieceLabel && (
              <div style={{ fontSize: isMobile ? 18 : 30, color: SUB, fontFamily: BODY_FONT, fontWeight: 600 }}>
                {perPieceLabel}
              </div>
            )}
            {boxCountLabel && (
              <div style={{ fontSize: isMobile ? 18 : 32, color: accent.dark, fontFamily: BODY_FONT, fontWeight: 800 }}>
                {boxCountLabel}
              </div>
            )}
          </div>
        )}

        {/* 정직한 편차 안내 — 개수 환산이 있을 때만 그 편차를, 아니면 크기 편차 문구.
            D17: 입력 faq/cautions에 "크기" 항목이 이미 있으면 이 보일러플레이트 박스는 생략. */}
        {!hasSizeMention && (
          <div
            style={{
              padding: isMobile ? "18px 20px" : "26px 32px",
              background: BG_SOFT,
              border: `1px solid ${LINE}`,
              borderRadius: 12,
              fontSize: isMobile ? 18 : 30,
              color: SUB,
              lineHeight: 1.7,
              fontFamily: BODY_FONT,
            }}
          >
            <strong style={{ color: INK }}>꼭 확인해 주세요</strong>
            <br />
            {boxCountLabel
              ? sr.deviation.replace("{noun}", noun)
              : sr.deviationSize.replace("{noun}", noun)}
          </div>
        )}
      </div>
    </>
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
  // C9: "산지 수확"은 directFromFarm/sameDayHarvest 없으면 "수확 후 준비"로 (미검증 산지 단정 방지).
  const fromFarm = sameDay || !!trust?.directFromFarm
  const steps = [
    {
      title: fromFarm ? "산지 수확" : "수확 후 준비",
      desc: sameDay
        ? "아침 일찍 산지에서 그날 딴 것만"
        : fromFarm
          ? "산지에서 수확한 신선한 상품을"
          : "수확한 신선한 상품을",
    },
    {
      // F(minor): "손 선별·포장" → "손 선별"(다음 STEP '포장·출고'와 '포장' 중복 정리).
      title: "손 선별",
      desc: sameDay ? "상태 좋은 것만 하나씩 골라 당일 포장" : "상태 좋은 것만 하나씩 골라 포장",
    },
    {
      title: cold ? "콜드체인 출고" : "포장·출고",
      desc: cold ? "신선도를 지키는 냉장 상태로 출고" : "신선하게 포장해 바로 출고",
    },
    { title: "문 앞 도착", desc: "완충 포장으로 신선하게 문 앞까지" },
  ]
  return (
    <div style={{ padding: isMobile ? "52px 24px" : "80px 44px", background: veilTint(accent.soft) }}>
      <div style={{ textAlign: "center", marginBottom: isMobile ? 32 : 48 }}>
        <div
          style={{
            fontSize: isMobile ? 18 : 26,
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

      {/*
        가로 스텝 그래픽 — 아이콘 원 4개를 한 줄에 배치하고 원 사이를 accent
        연결선으로 잇는다. 좁은 폭(모바일)에서는 2x2 그리드로 접어 연결선을
        숨긴다(가로 2칸이라 선이 어색해짐). 원=상대 위치라 연결선은 원 뒤
        절대배치 레이어로 깔아 원 중심을 정확히 관통시킨다.
      */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr 1fr" : `repeat(${steps.length}, 1fr)`,
          gap: isMobile ? "28px 12px" : 0,
          position: "relative",
        }}
      >
        {/* 데스크톱 연결선 — 아이콘 원 중심(top = 원 반지름) 높이에 가로선 1줄.
            첫 원 중심 ~ 마지막 원 중심까지만 그어 양끝이 삐져나오지 않게. */}
        {!isMobile && (
          <div
            aria-hidden
            style={{
              position: "absolute",
              top: 44, // 원 지름 88의 절반
              left: `${100 / (steps.length * 2)}%`,
              right: `${100 / (steps.length * 2)}%`,
              height: 2,
              background: accent.accent,
              opacity: 0.35,
              zIndex: 0,
            }}
          />
        )}
        {steps.map((step, i) => {
          const Icon = FLOW_STEP_ICONS[i] ?? FLOW_STEP_ICONS[FLOW_STEP_ICONS.length - 1]
          const circle = isMobile ? 72 : 88
          return (
            <div
              key={step.title}
              style={{
                position: "relative",
                zIndex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                padding: isMobile ? "0 4px" : "0 10px",
              }}
            >
              {/* 아이콘 원 + 작은 번호 배지 */}
              <div style={{ position: "relative", marginBottom: isMobile ? 14 : 20 }}>
                <div
                  aria-hidden
                  style={{
                    width: circle,
                    height: circle,
                    borderRadius: "50%",
                    background: "#FFFFFF",
                    border: `2.5px solid ${accent.accent}`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.06)",
                  }}
                >
                  <Icon color={accent.accent} size={isMobile ? 36 : 46} />
                </div>
                {/* 작은 번호 — 원 좌상단에 겹쳐 붙는 accent 배지 */}
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: isMobile ? -6 : -8,
                    left: isMobile ? -6 : -8,
                    width: isMobile ? 24 : 30,
                    height: isMobile ? 24 : 30,
                    borderRadius: "50%",
                    background: accent.accent,
                    color: "#FFFFFF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: isMobile ? 14 : 18,
                    fontWeight: 800,
                    fontFamily: BODY_FONT,
                    lineHeight: 1,
                  }}
                >
                  {i + 1}
                </div>
              </div>
              <div
                style={{
                  fontSize: isMobile ? 19 : 28,
                  fontWeight: 800,
                  color: INK,
                  marginBottom: isMobile ? 5 : 9,
                  fontFamily: BODY_FONT,
                  letterSpacing: -0.3,
                  wordBreak: "keep-all",
                }}
              >
                {step.title}
              </div>
              <div
                style={{
                  fontSize: isMobile ? 15 : 24,
                  color: SUB,
                  lineHeight: 1.5,
                  fontFamily: BODY_FONT,
                  wordBreak: "keep-all",
                }}
              >
                {step.desc}
              </div>
            </div>
          )
        })}
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
    <div style={{ padding: isMobile ? "52px 24px" : "80px 44px", background: "#FFFFFF" }}>
      <div style={{ textAlign: "center", marginBottom: isMobile ? 32 : 48 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: isMobile ? 6 : 10,
            fontSize: isMobile ? 14 : 24,
            color: accent.accent,
            fontWeight: 800,
            letterSpacing: 2,
            marginBottom: isMobile ? 10 : 14,
            fontFamily: BODY_FONT,
          }}
        >
          <PackIcon color={accent.accent} size={isMobile ? 20 : 30} />
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
                fontSize: isMobile ? 15 : 24,
                fontWeight: 800,
                color: accent.dark,
                fontFamily: BODY_FONT,
              }}
            >
              중량
            </span>
            <span style={{ fontSize: isMobile ? 18 : 30, fontWeight: 700, color: INK, fontFamily: BODY_FONT }}>
              {weight.trim()}
            </span>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "baseline", gap: isMobile ? 12 : 18 }}>
          <span
            style={{
              flexShrink: 0,
              fontSize: isMobile ? 15 : 24,
              fontWeight: 800,
              color: accent.dark,
              fontFamily: BODY_FONT,
            }}
          >
            포장
          </span>
          <span style={{ fontSize: isMobile ? 18 : 30, color: SUB, lineHeight: 1.6, fontFamily: BODY_FONT }}>
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
        // v3.8(지시4): 약관류 3연속(배송/교환환불/주의)은 상하 패딩을 48px로 묶어 클러스터링.
        padding: isMobile ? "32px 24px" : "48px 44px",
        background: "#FFFFFF",
      }}
    >
      {/* v3.8(지시3): 배송 안내는 약관류 — quiet 위계(작고 SUB 색). */}
      <SectionTitle title={t.detail.result.deliveryTitle} variant="quiet" isMobile={isMobile} />
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
            fontSize: isMobile ? 18 : 32,
            color: INK,
            lineHeight: 1.7,
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
        padding: isMobile ? "48px 24px" : "80px 44px",
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
              fontSize: isMobile ? 19 : 30,
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

/**
 * ReviewsBlock — 고객 후기 (참외/수플린 레퍼런스: 별점 + 후기 문장 + 핵심 문장 형광펜).
 *
 * 셀러가 직접 입력한 후기만 노출한다(AI 생성 금지 — reviews는 CopyInput 입력 흐름).
 * 0건이면 호출부에서 렌더하지 않는다.
 *
 * 각 카드: 별 5개 아이콘 + 후기 본문(34px) + highlight가 본문에 포함되면
 * 그 부분만 accent 배경 형광펜으로 강조. highlight가 본문에 없으면 강조 없이 본문만.
 */
function ReviewsBlock({
  reviews,
  isMobile,
}: {
  reviews: SellerReview[]
  isMobile: boolean
}) {
  const accent = useAccent()
  // v3.8(지시4): 후기 진입은 대형 전환점 — 상단 100px 브레이크로 앞 클러스터와 분리.
  return (
    <div style={{ padding: isMobile ? "64px 24px 48px" : "100px 44px 80px", background: veilTint(accent.soft) }}>
      {/* v3.8(지시3): 후기는 전환점 — hero 위계 + REVIEW 오버라인. */}
      <SectionTitle title={t.detail.result.reviews.title} variant="hero" overline="REVIEW" isMobile={isMobile} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          // 발췌 박스가 카드 위로 걸치므로 카드 간 간격을 넉넉히.
          gap: isMobile ? 26 : 40,
        }}
      >
        {reviews.map((r, i) => {
          // A1(장치 단일화): 인라인 형광펜 제거 — 본문은 강조 없는 평문.
          // highlight가 본문에 실제 포함될 때만 발췌 콜아웃을 카드 "본문 흐름 내"
          // (하단, 살짝 회전)에 배치한다. absolute 겹침 폐기 — 본문을 절대 가리지 않는다.
          const hi = r.highlight?.trim()
          const showPull = !!hi && r.text.includes(hi)
          const tilt = i % 2 === 0 ? "rotate(-1.5deg)" : "rotate(1.5deg)"
          return (
            <div
              key={`review-${i}`}
              style={{
                background: "#FFFFFF",
                borderRadius: 16,
                border: `1px solid ${accent.soft}`,
                boxShadow: `0 4px 16px ${accent.accent}10`,
                padding: isMobile ? "24px 24px" : "40px 44px",
                display: "flex",
                flexDirection: "column",
                gap: isMobile ? 12 : 18,
              }}
            >
              {/* 별 5개 — D18: 셀러 입력에 별점 필드가 없어 자동 생성이므로 렌더 제거.
                  (셀러 입력 필드 생기면 부활) */}
              {/* 후기 본문 — 강조 없는 평문(A1: 인라인 형광펜 제거). */}
              <p
                style={{
                  fontSize: isMobile ? 20 : 34,
                  color: INK,
                  lineHeight: 1.6,
                  margin: 0,
                  fontFamily: BODY_FONT,
                  fontWeight: 500,
                  wordBreak: "keep-all",
                  whiteSpace: "pre-line",
                }}
              >
                {r.text}
              </p>

              {/* 발췌 콜아웃 — 본문 아래 흐름 내 배치, 살짝 회전 유지. 본문 안 가림(A1). */}
              {showPull && (
                <div
                  style={{
                    alignSelf: i % 2 === 0 ? "flex-start" : "flex-end",
                    transform: tilt,
                    maxWidth: "86%",
                    background: "#FFFFFF",
                    border: `2px solid ${accent.accent}`,
                    borderRadius: 10,
                    padding: isMobile ? "10px 16px" : "16px 26px",
                    boxShadow: `0 6px 18px ${accent.accent}22`,
                  }}
                >
                  <span
                    style={{
                      fontSize: isMobile ? 16 : 28,
                      fontWeight: 800,
                      color: accent.dark,
                      lineHeight: 1.35,
                      fontFamily: BODY_FONT,
                      letterSpacing: -0.3,
                      wordBreak: "keep-all",
                    }}
                  >
                    {hi}
                  </span>
                </div>
              )}
            </div>
          )
        })}
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
  const accent = useAccent()
  // trust에 농부 정보 있으면 ProducerCard + 서명, 없으면 서명 줄 자체를 생략.
  // 지어낸 지역·연차·이름을 기본값으로 넣는 것은 허위광고 — 절대 금지.
  const hasProducer = !!(trust?.producerName || trust?.producerRegion || trust?.farmerYears)
  const farmerMeta = hasProducer
    ? [
        trust!.farmerYears && trust!.farmerYears > 0 ? `${trust!.farmerYears}년차` : null,
        trust!.producerRegion || null,
        trust!.producerName ? `${trust!.producerName} 농가` : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null
  return (
    <div
      style={{
        padding: isMobile ? "48px 24px" : "80px 44px",
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
            accentColor={accent.accent}
            accentSoft={accent.soft}
          />
        </div>
      )}

      <div
        style={{
          padding: isMobile ? "28px 26px" : "44px 52px",
          background: accent.soft,
          borderRadius: 14,
          border: `1px solid ${accent.soft}`,
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
              {farmStory.replace(/\n{2,}/g, "\n").trim()}
            </p>
            {farmerMeta && (
              <p
                style={{
                  fontSize: isMobile ? 15 : 24,
                  color: SUB,
                  margin: 0,
                  fontFamily: BODY_FONT,
                  fontWeight: 600,
                  letterSpacing: 0.2,
                }}
              >
                — {farmerMeta}
              </p>
            )}
        </div>
      </div>
    </div>
  )
}

function ReturnsBlock({ isMobile, trust }: { isMobile: boolean; trust?: TrustInfo }) {
  // C11: 환불 신청 기한 — refundGuarantee.windowHours 입력이 있으면 그 값으로,
  // 없으면 "수령 당일". condition만 있고 windowHours가 없으면 기본 문구 유지(시간 값 없음).
  const rg = trust?.refundGuarantee
  const windowHours =
    typeof rg === "object" && rg.windowHours && rg.windowHours > 0 ? rg.windowHours : null
  const windowText = windowHours
    ? t.detail.result.returnsWindowHours.replace("{hours}", String(windowHours))
    : t.detail.result.returnsWindowDefault
  const body = t.detail.result.returnsBody.replace("{window}", windowText)
  return (
    <div
      style={{
        // v3.8(지시4): 약관류 클러스터 — 상하 패딩 48px로 압축.
        padding: isMobile ? "32px 24px" : "48px 44px",
        background: "#FFFFFF",
      }}
    >
      {/* v3.8(지시3): 교환·환불은 약관류 — quiet 위계. */}
      <SectionTitle title={t.detail.result.returnsTitle} variant="quiet" isMobile={isMobile} />
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
            fontSize: isMobile ? 18 : 32,
            color: INK,
            lineHeight: 1.7,
            margin: 0,
            fontFamily: BODY_FONT,
          }}
        >
          {body}
        </p>
      </div>
    </div>
  )
}

function CautionsBlock({
  cautions,
  copy,
  isMobile,
}: {
  cautions: string[]
  /** D17 dedupe용 — faq 답변·storage와 정확 일치 항목 제거. */
  copy: CopyOutput
  isMobile: boolean
}) {
  // D17: cautions 항목이 faq 답변(a) 또는 storage와 트림 기준 정확 일치하면 렌더 생략.
  const dupeSet = new Set<string>()
  if (copy.storage?.trim()) dupeSet.add(copy.storage.trim())
  for (const f of copy.faq ?? []) {
    if (f.a?.trim()) dupeSet.add(f.a.trim())
  }
  const shownCautions = cautions.filter((c) => c.trim() && !dupeSet.has(c.trim()))
  return (
    <div
      style={{
        // v3.8(지시4): 약관류 클러스터 마지막 — 상단 48px로 묶고, 페이지 말미 하단만 여유.
        padding: isMobile ? "32px 24px 40px" : "48px 44px 72px",
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
            fontSize: isMobile ? 18 : 32,
            color: SUB,
            lineHeight: 1.7,
            margin: 0,
            marginBottom: shownCautions.length > 0 ? (isMobile ? 20 : 28) : 0,
            fontFamily: BODY_FONT,
          }}
        >
          {t.detail.result.cautionsAutoNotice}
        </p>
        {shownCautions.length > 0 && (
          <>
            <h3
              style={{
                fontSize: isMobile ? 18 : 32,
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
              {shownCautions.map((c, i) => (
                <li
                  key={`c-${i}`}
                  style={{
                    fontSize: isMobile ? 18 : 30,
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

/**
 * v3.8(지시6) 클로징 브랜드 서명 — 페이지 맨 끝 마무리.
 * 가는 accent 구분선 → 잎 라인 아이콘 → 한 줄 마무리 문구 → 서명(농가명/상품명).
 * proj3 키위 레퍼런스의 "브랜드 서명" 톤: 조용하고 담백한 한 줄로 페이지를 닫는다.
 *
 * 지어내지 않는다 — 마무리 문구는 고정 감사 표현, 서명은 trust.producerName(있으면)
 * 또는 상품명으로만. producer가 없으면 "{상품명} 드림" 형태로 폴백.
 * captureRef 내부라 인라인 style + hex 상수 + 인라인 SVG(LeafIcon)만 사용 — filter/CSS 변수 없음.
 */
function ClosingSignature({
  productName,
  trust,
  isMobile,
}: {
  productName: string
  trust?: TrustInfo
  isMobile: boolean
}) {
  const accent = useAccent()
  const producer = trust?.producerName?.trim()
  const name = productName.trim()
  // 서명 — 농가명 우선, 없으면 상품명, 둘 다 없으면 서명 줄 생략.
  const signature = producer ? `${producer} 농가 드림` : name ? `${name} 드림` : null
  return (
    <div
      style={{
        padding: isMobile ? "8px 24px 52px" : "16px 44px 88px",
        background: "#FFFFFF",
        textAlign: "center",
      }}
    >
      {/* 가는 구분선 — 중앙 정렬, accent 옅은 톤 */}
      <div
        aria-hidden
        style={{
          width: isMobile ? 40 : 64,
          height: 2,
          background: accent.accent,
          borderRadius: 2,
          margin: isMobile ? "0 auto 22px" : "0 auto 32px",
        }}
      />
      {/* 잎 라인 아이콘 */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: isMobile ? 14 : 20 }}>
        <LeafIcon color={accent.accent} size={isMobile ? 34 : 52} />
      </div>
      {/* 한 줄 마무리 문구 — 고정 감사 표현(지어내지 않음). */}
      <p
        style={{
          fontSize: isMobile ? 18 : 30,
          color: SUB,
          fontWeight: 600,
          fontFamily: BODY_FONT,
          lineHeight: 1.5,
          margin: 0,
          letterSpacing: -0.3,
          wordBreak: "keep-all",
        }}
      >
        정성껏 골라 담았습니다. 맛있게 드세요.
      </p>
      {signature && (
        <p
          style={{
            fontSize: isMobile ? 15 : 24,
            color: accent.dark,
            fontWeight: 800,
            fontFamily: BODY_FONT,
            margin: isMobile ? "10px 0 0" : "14px 0 0",
            letterSpacing: 0.3,
            wordBreak: "keep-all",
          }}
        >
          {signature}
        </p>
      )}
    </div>
  )
}

/* ============================================================ */
/* Reusable bits                                                 */
/* ============================================================ */

/**
 * v3.8(지시3) 타이틀 3단 위계 시스템.
 *  - "hero": 전환점(WHY·특별한 이유·후기). 데스크톱 60px + 오버라인 영문 라벨 동반.
 *  - "main": 콘텐츠 섹션(상품정보·크기·보관·FAQ·추천). 데스크톱 46px (기존 톤 근처).
 *  - "quiet": 약관류(배송·교환환불·구매 전 확인). 데스크톱 34px, SUB 색으로 조용하게.
 *
 * 오버라인 영문 라벨(overline)은 hero에서만 노출 — DeliveryFlowBlock/PackagingBlock의
 * 기존 대문자 라벨 스타일(작은 accent, letterSpacing 2)을 재사용해 톤을 맞춘다.
 * 미지정(레거시 호출)은 "main"으로 동작해 회귀 없음.
 */
type SectionTitleVariant = "hero" | "main" | "quiet"
function SectionTitle({
  title,
  regen,
  isMobile,
  variant = "main",
  overline,
}: {
  title: string
  regen?: React.ReactNode
  /** 폰 미리보기(≤414)면 축소 스케일. 미지정 시 데스크톱(이미지 매체) 크기. */
  isMobile?: boolean
  /** v3.8: 3단 위계 — hero(전환점)/main(콘텐츠)/quiet(약관류). 미지정 시 main. */
  variant?: SectionTitleVariant
  /** v3.8: hero 변주에서만 노출하는 오버라인 영문 라벨(예: REVIEW). */
  overline?: string
}) {
  const accent = useAccent()
  // 크기·색 — 데스크톱 기준 hero 60 / main 46 / quiet 34. 모바일은 각 톤에 맞춰 축소.
  const fontSize =
    variant === "hero" ? (isMobile ? 34 : 60) : variant === "quiet" ? (isMobile ? 21 : 34) : (isMobile ? 27 : 46)
  const color = variant === "quiet" ? SUB : INK
  const showOverline = variant === "hero" && !!overline?.trim()
  return (
    <div
      style={{
        display: "flex",
        alignItems: showOverline ? "flex-end" : "center",
        justifyContent: "space-between",
        marginBottom: isMobile ? 24 : 36,
      }}
    >
      <div>
        {/* hero 전용 오버라인 영문 라벨 — 기존 대문자 라벨 톤(작은 accent, 넓은 자간) 재사용. */}
        {showOverline && (
          <div
            style={{
              fontSize: isMobile ? 13 : 22,
              color: accent.accent,
              fontWeight: 800,
              letterSpacing: 2,
              marginBottom: isMobile ? 8 : 12,
              fontFamily: BODY_FONT,
            }}
          >
            {overline}
          </div>
        )}
        <h2
          style={{
            fontSize,
            fontWeight: 400,
            color,
            margin: 0,
            lineHeight: 1.05,
            fontFamily: DISPLAY_FONT,
            letterSpacing: -1,
          }}
        >
          {title}
        </h2>
      </div>
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
