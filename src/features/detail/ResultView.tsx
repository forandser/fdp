"use client"

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react"
import { t } from "@/lib/i18n"
import type { CopyOutput, CopyKeyPoint, TrustInfo, SellerReview, ProductCategory, PhotoAnalysisItem } from "@/lib/ai/types"
import type { SectionId } from "@/lib/ai/section-regenerate"
// v5.0-C: 브랜드 스냅샷 타입. brand-db 는 타 에이전트가 작성 중 —
// 미존재 시 본인 tsc 에서 "Cannot find module" 로 잡히면 노트만(교차 계약).
import type { BrandSnapshot } from "@/lib/storage/brand-db"
import type { UploadedImage } from "./ImageUploader"
import { ExportPanel } from "./ExportPanel"
import { EditableResultText } from "./EditableResultText"
import { InlineEdit } from "./InlineEdit"
import { RegenButton } from "./RegenButton"
import { CertCaption } from "./CertCaption"
import { FreshnessTimeline } from "./FreshnessTimeline"
import { ProducerCard } from "./ProducerCard"
import { DisclosureBlock } from "./DisclosureBlock"
// v2.7: StickyMobileCta 삭제 (중앙 하단 복사/다운로드 버튼 제거 지시)
import { QualityScoreCard } from "./QualityScoreCard"
import { ResearchSummaryPanel } from "./ResearchSummaryPanel"
import {
  WidthToolbar,
  VALID_EXPORT_WIDTHS,
  type ExportWidth,
  type MobileWidth,
} from "./WidthPresetSwitcher"
import { RADIUS } from "./shell-theme"
import { STORAGE_KEYS } from "@/lib/storage/keys"
// v2.6: WorkJsonExporter 삭제 (사이드바 3개 액션 제거 지시)
import { checkComplianceReport } from "@/lib/ai/compliance-report"
import { scoreCopyQuality } from "@/lib/ai/copy-quality-score"
import {
  MAX_HEADLINE_CANDIDATES,
  normalizeHeadlineCandidate,
  isCaptionSafeNote,
} from "@/lib/ai/validate"
import {
  detectFruitFactKey,
  FRUIT_FACTS,
  isHookHeadlineCompatible,
  isHeadlineOriginCompatible,
  getAvgWeightG,
  estimateCountLabel,
  getHarvestMonths,
  getBrixRange,
  getStorageInfo,
  isRawEdible,
  // v5.3(작업6): 붙박이 배송 문구를 과일 보관 성격으로 결정적 변주하기 위한 페르소나.
  getDeliveryPersona,
  // v4.9-A: 비주얼 DNA(팔리는 비주얼 각도 + 모티프 키). 타 에이전트가 fruit-facts.ts 에
  // 정의 중 — import 해서 소비만. 심볼 미존재 시 tsc 에서 잡히면 노트만(교차 계약).
  getVisualDNA,
  type VisualDNA,
} from "@/domain/fruit-facts"
import { resolveAccent, DEFAULT_ACCENT, mixHex, type AccentPalette } from "./fruit-accent"
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
// v5.2-A: MotifDecor(장식 데코 — sparkle/arrow/petal/circle)는 타 에이전트가 FruitMotifs.tsx 에
// 구현 중. 계약 shape 로 import 소비 — 미존재 시 본인 tsc 에서 잡히면 노트만(교차 계약).
import { FruitMotif, MotifDecor } from "./FruitMotifs"

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
 * v4.0 전체 텍스트 인라인 편집 Context.
 *
 * 아트보드의 모든 고정 문구(섹션 제목·오버라인·아이콘 트리오·4단계 스텝·배송/교환/주의
 * 보일러플레이트·사진 캡션·CTA·클로징 등)를 편집하려면 copy(textOverrides 저장소)와
 * onCopyChange가 필요한데, 이 문구들을 렌더하는 하위 블록 대부분은 copy/onCopyChange를
 * prop으로 받지 않는다. AccentContext와 동일하게 ResultView가 한 번 Provider로 내려주고,
 * 각 블록이 OverrideText(고정 문구)·EditableResultText(실제 카피 필드)로 소비한다.
 */
interface EditCtx {
  copy: CopyOutput
  onCopyChange: (next: CopyOutput) => void
}
const EditContext = createContext<EditCtx | null>(null)
function useEdit(): EditCtx {
  const ctx = useContext(EditContext)
  if (!ctx) {
    // Provider 없이 렌더될 일은 없지만(항상 아트보드 루트에서 감싼다) 타입 안전용 폴백.
    throw new Error("EditContext missing — ResultView 아트보드 밖에서 편집 컴포넌트를 렌더했습니다.")
  }
  return ctx
}

/**
 * 고정 문구 한 개의 오버라이드를 immutable 하게 기록/삭제한다.
 * - 빈 값이거나 기본 문구(fallback)와 같으면 키를 삭제해 기본 문구로 복귀(오버라이드 제거).
 * - 남은 오버라이드가 하나도 없으면 textOverrides 자체를 undefined 로 정리(하위호환 저장본과 동일 형태).
 */
function writeTextOverride(
  copy: CopyOutput,
  id: string,
  next: string,
  fallback: string,
): CopyOutput {
  const map: Record<string, string> = { ...(copy.textOverrides ?? {}) }
  if (next.trim().length === 0 || next === fallback) {
    delete map[id]
  } else {
    map[id] = next
  }
  const hasAny = Object.keys(map).length > 0
  return { ...copy, textOverrides: hasAny ? map : undefined }
}

/** 고정 문구 오버라이드의 현재 표시값 — 오버라이드가 있으면 그 값, 없으면 기본 문구. */
function resolveOverride(
  copy: CopyOutput,
  id: string,
  fallback: string,
): string {
  const v = copy.textOverrides?.[id]
  return v != null && v.length > 0 ? v : fallback
}

/**
 * ot() — 고정 문구 인라인 편집 렌더 헬퍼 (기획 설계 2).
 *
 * 오버라이드가 있으면 그 값, 없으면 fallback(기본 문구)을 InlineEdit(기존 패턴)로 감싼다.
 * 클릭 편집 → onCopyChange({...copy, textOverrides:{...}}) 전파. 빈 값이면 오버라이드 삭제.
 * 편집 UI(연필·hover·placeholder)와 JPG 위생(data-inline-edit)은 InlineEdit이 그대로 담당한다.
 *
 * renderDisplay: 기본 문구가 액센트 색 span·물결 밑줄 강조 등 리치 렌더일 때 사용.
 * 값이 fallback 그대로면 리치 렌더를, 셀러가 고치면 평문을 보여주는 식으로 색/강조를 보존한다.
 */
function OverrideText({
  id,
  fallback,
  multiline,
  maxLength,
  placeholder,
  style,
  ariaLabel,
  preserveWhitespace,
  renderDisplay,
}: {
  id: string
  fallback: string
  multiline?: boolean
  maxLength?: number
  placeholder?: string
  style?: React.CSSProperties
  ariaLabel?: string
  preserveWhitespace?: boolean
  renderDisplay?: (value: string) => React.ReactNode
}) {
  const { copy, onCopyChange } = useEdit()
  const value = resolveOverride(copy, id, fallback)
  return (
    <InlineEdit
      value={value}
      onChange={(next) => onCopyChange(writeTextOverride(copy, id, next, fallback))}
      multiline={multiline}
      maxLength={maxLength}
      placeholder={placeholder ?? fallback}
      style={style}
      ariaLabel={ariaLabel}
      preserveWhitespace={preserveWhitespace}
      renderDisplay={renderDisplay}
    />
  )
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
  /**
   * v4.4: 사진 인텔리전스 결과(선택). images 각 장의 역할·대표컷 점수·품질 플래그.
   * imageId 는 UploadedImage.id 와 매칭된다. planImages 배치·갤러리 캡션 폴백에 쓰인다.
   * 없거나(null/undefined) 빈 배열이면 배치는 기존(v3.8)과 100% 동일하게 동작한다.
   * 하위호환: 구버전 저장본/미분석 시 미전달 — 안전.
   */
  photoAnalysis?: PhotoAnalysisItem[] | null
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
  /**
   * v4.6: 레이아웃 무드 변주(디자인 토큰만 다름 — 섹션 순서·게이팅·카피 불변).
   * 미지정(구버전 저장본/미전달)이면 "standard" — 기존 렌더와 픽셀 동일(하위호환).
   */
  layoutVariant?: LayoutVariant
  /**
   * v5.0-C: 브랜드 스냅샷(스토어명·로고 dataURL·대표색·서명·문의). 타 에이전트가 전달.
   * 없으면(null/undefined) 브랜드 상단 라벨·클로징 브랜드 블록 모두 미노출 —
   * 기존 렌더와 100% 동일(게이팅 불변식). 로고는 dataURL img 로만 렌더(JPG 위생 안전).
   */
  brandSnapshot?: BrandSnapshot | null
}

const RED = "#E03131" // 사이드바 편집 컨트롤용 브랜드 색 (내보내는 페이지엔 accent 사용)

/** B2(v5.7): 사이드바 구역 컨테이너/라벨 공통 스타일(검수 결과·화면 설정 3구역 재편). */
const SIDEBAR_REGION_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
}
const SIDEBAR_REGION_LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: 0.4,
  color: "var(--color-neutral-500)",
}
const INK = "#212529"
const SUB = "#495057"
const MUTE = "#6E7480"
const BG_SOFT = "#F8F9FA"
const LINE = "#E9ECEF"
const PLACEHOLDER = "#ADB5BD"

/**
 * v5.0 폰트 계층 — 실사용자(과일 셀러) 피드백 반영. 기존 무료 검은고딕(단일 400 굵기,
 * 응축형)이 대형 사이즈에서 뭉개져 "깨진" 인상을 줘서 전면 퇴출하고,
 * 이미 임베드된 Pretendard Black(900)로 통일한다(상위 커머스 페이지의 실제 관행).
 *
 * ⚠️ DISPLAY_FONT를 쓰는 곳은 반드시 fontWeight 900을 명시할 것.
 *    (직전 검은고딕은 weight 400 자체가 검은 굵기였으나, Pretendard는 400이면
 *     Regular로 떨어져 헤딩이 완전히 망가진다.)
 *
 * DISPLAY (Hero 초대형, highlightBox 슬로건, POINT 넘버, 섹션 타이틀)
 *   = Pretendard 900 — 굵고 또렷한 검은고딕 대체
 * BODY (본문·스토리·설명·라벨·뱃지)
 *   = Pretendard 500/700/800
 */
const DISPLAY_FONT = '"Pretendard", "NotoSansKR", sans-serif'
const BODY_FONT = '"Pretendard", "NotoSansKR", sans-serif'

/**
 * v4.6 editorial 헤딩 폰트 — @font-face로 이미 등록된 GowunBatang(부드러운 명조).
 * 등록된 굵기는 700(Bold) 하나뿐이므로 editorial 토큰의 headingWeight도 700을 쓴다.
 * (Pretendard 900 자리를 700 명조로 바꿔 "매거진" 톤을 낸다. toCanvas 호환 — 로컬 임베드 폰트.)
 */
const EDITORIAL_HEADING_FONT = '"GowunBatang", "Pretendard", serif'

/* ============================================================ */
/* v4.6 레이아웃 무드 변주 3종 — 디자인 토큰만 다르다.            */
/* ------------------------------------------------------------ */
/* 섹션 순서·게이팅·카피는 전 변주 불변. 아래 토큰을 컨텍스트로   */
/* 내려(useAccent 패턴과 동일) 히어로·섹션 배경·카드·헤딩 등      */
/* 주요 스타일 사이트에서만 소비한다.                            */
/*                                                              */
/* ★ 불변식: variant === "standard" 는 기존 렌더와 픽셀 동일.    */
/*   → standard 토큰 기본값이 현행 리터럴(DISPLAY_FONT/900/22/  */
/*     "#FFFFFF"/accent.soft/center/×1)과 정확히 일치한다.       */
/*   토큰 값은 전부 구체 값(hex/px/함수 반환 hex) — CSS 변수 없음.*/
/* ============================================================ */
export type LayoutVariant = "standard" | "soft" | "editorial"

interface LayoutTokens {
  variant: LayoutVariant
  /** 헤딩 폰트 패밀리 — standard/soft: Pretendard(DISPLAY), editorial: GowunBatang. */
  headingFontFamily: string
  /** 헤딩 굵기 — standard/soft: 900, editorial: 700(GowunBatang은 700만 등록). */
  headingWeight: number
  /** 큰 라운드 카드 반경(px) — standard/editorial: 22, soft: 28. 배지·필(999)은 미적용. */
  cardRadius: number
  /** 세로 여백 배율 — editorial: 1.15, 그 외 1(정수 padding에만 곱해 반올림 → ×1은 항등). */
  spacingScale: number
  /** 히어로 텍스트 정렬 — editorial: left(텍스트 블록만), 그 외 center. */
  heroAlign: "center" | "left"
  /** editorial 얇은 상단 구분선(섹션 배경 교차 대신) 노출 여부. */
  showRule: boolean
  /** 히어로 배경(accent 파생) — soft는 한 단계 진하게, 그 외 accent.soft. */
  heroBg: (a: AccentPalette) => string
  /** soft 교차 배경(accent 파생) — 일부 흰 섹션을 옅은 틴트로. standard/editorial은 흰색(항등). */
  altSectionBg: (a: AccentPalette) => string
  /** editorial 구분선 색(accent 파생). */
  ruleColor: (a: AccentPalette) => string
}

const LAYOUT_TOKENS: Record<LayoutVariant, LayoutTokens> = {
  // 기존 렌더와 픽셀 동일해야 하는 기준선(불변식).
  standard: {
    variant: "standard",
    headingFontFamily: DISPLAY_FONT,
    headingWeight: 900,
    cardRadius: 22,
    spacingScale: 1,
    heroAlign: "center",
    showRule: false,
    heroBg: (a) => a.soft,
    altSectionBg: () => "#FFFFFF",
    ruleColor: (a) => a.soft,
  },
  // 소프트 — 둥글고 포근한 톤: 카드 라운드 확대, 히어로 배경 심화, 교차 틴트 리듬.
  soft: {
    variant: "soft",
    headingFontFamily: DISPLAY_FONT,
    headingWeight: 900,
    cardRadius: 28,
    spacingScale: 1,
    heroAlign: "center",
    showRule: false,
    heroBg: (a) => mixHex(a.soft, a.accent, 0.12),
    altSectionBg: (a) => veilTint(a.soft),
    ruleColor: (a) => a.soft,
  },
  // 매거진 — 명조 헤딩, 넓은 여백, 히어로 좌정렬, 교차 배경 대신 얇은 구분선.
  editorial: {
    variant: "editorial",
    headingFontFamily: EDITORIAL_HEADING_FONT,
    headingWeight: 700,
    cardRadius: 22,
    spacingScale: 1.15,
    heroAlign: "left",
    showRule: true,
    heroBg: (a) => a.soft,
    altSectionBg: () => "#FFFFFF",
    ruleColor: (a) => a.accent,
  },
}

/* ============================================================ */
/* v5.3 세로 간격 2단 토큰 — 길이 단축 주력(제1원칙: 길이 예산).    */
/* ------------------------------------------------------------ */
/* 기존엔 대부분 섹션이 균일 대형 세로 패딩(80~112px)이라 챕터   */
/* 내부·경계 구분 없이 페이지가 무한정 늘어났다. 이를 2단으로:    */
/*  - band: 챕터 경계(새 주제 시작) — 시원한 여백                */
/*  - flow: 챕터 내부(직전 블록과 한 묶음) — 촘촘한 여백          */
/* 값은 세로 패딩 px(가로는 각 블록 기존값 유지). 어떤 블록도     */
/* 기존 대비 순증하지 않고 대부분 축소된다.                       */
/* ============================================================ */
const SECTION_Y = {
  band: { m: 44, d: 72 },
  flow: { m: 30, d: 48 },
} as const
/** 섹션 세로 패딩 값(px) — tier·매체별. 가로 패딩은 호출부에서 기존값 그대로 조합한다. */
function padY(tier: "band" | "flow", isMobile: boolean): number {
  const v = SECTION_Y[tier]
  return isMobile ? v.m : v.d
}

/**
 * v4.6 레이아웃 토큰 Context — AccentContext와 동일 패턴.
 * ResultView가 layoutVariant prop에서 토큰을 골라 Provider로 내리고,
 * 각 블록이 useLayout()으로 소비한다. Provider 밖 렌더 폴백은 standard(불변식).
 */
const LayoutContext = createContext<LayoutTokens>(LAYOUT_TOKENS.standard)
function useLayout(): LayoutTokens {
  return useContext(LayoutContext)
}

/**
 * v4.9-A 과일 모티프 컨텍스트 — AccentContext/LayoutContext 와 동일 패턴.
 * ResultView 가 getVisualDNA(factKey).motif(품종 매칭 시) 를 골라 Provider 로 내리고,
 * 각 지점(히어로 킥커·POINT/STORY 라벨·클로징 서명·soft 히어로 흩뿌림)이 useMotifKind()
 * 로 소비한다. 값이 null 이면(품종 미매칭 = getVisualDNA null) 전 지점 모티프 미노출(게이팅).
 * Provider 밖 렌더 폴백도 null(안전).
 */
const MotifContext = createContext<string | null>(null)
function useMotifKind(): string | null {
  return useContext(MotifContext)
}

/* ============================================================ */
/* v5.1-A2 스마트 크롭 — subjectBox 기반 CSS 크롭 (클로즈업 리듬)   */
/* ------------------------------------------------------------ */
/* 래퍼(overflow hidden + 슬롯 비율) 안에서 img 를 계산된 scale·  */
/* offset(% 위치·크기)로 배치해 주체를 중앙에 클로즈업한다.        */
/* html-to-image 안전: overflow+absolute position 만 사용(기존    */
/* 코드에도 있는 패턴). CSS filter/변수/외부URL/transform-scale    */
/* 없음. 줌 상한 CROP_MAX_ZOOM(2.2)로 과확대 화질 저하 방지.       */
/*                                                              */
/* ★ 불변식: subjectBox 가 없거나(=분석 없음/주체 불확실) 계산     */
/*   불가면 소비 측이 기존 objectFit cover 로 폴백 → 기존 렌더 동일. */
/* ============================================================ */

/** 주체 위치 박스 — 사진 내 좌상단 기준 0~1 정규화 (교차 계약). */
export interface SubjectBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 교차 계약: subjectBox 는 타 에이전트가 PhotoAnalysisItem(lib/ai/types.ts)에 추가 중인
 * 옵셔널 필드다. 아직 타입에 없을 수 있어(작업 타이밍), 런타임 필드를 계약 shape 그대로
 * 옵셔널 접근한다 — 있으면 소비, 없으면 undefined. 이렇게 하면 본인 파일은 지금도 tsc 0에러이고,
 * 타 에이전트가 동일 shape 로 필드를 추가해도 충돌 없이 그대로 바인딩된다.
 */
type WithSubjectBox = { subjectBox?: SubjectBox }

/**
 * PhotoAnalysisItem 에서 subjectBox 를 안전하게 읽어 정규화한다.
 * - 값이 없거나 숫자가 아니면 undefined(손상/구버전 저장본 방어 → cover 폴백).
 * - w/h 하한 0.02(과확대 방어)·상한 1 클램프, x/y 는 박스가 프레임을 벗어나지 않게 클램프.
 */
function readSubjectBox(item: PhotoAnalysisItem | undefined): SubjectBox | undefined {
  const raw = (item as (PhotoAnalysisItem & WithSubjectBox) | undefined)?.subjectBox
  if (!raw) return undefined
  const { x, y, w, h } = raw
  if (![x, y, w, h].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return undefined
  }
  const cw = Math.min(1, Math.max(0.02, w))
  const ch = Math.min(1, Math.max(0.02, h))
  const cx = Math.min(Math.max(x, 0), 1 - cw)
  const cy = Math.min(Math.max(y, 0), 1 - ch)
  return { x: cx, y: cy, w: cw, h: ch }
}

/** 줌 상한 — cover 대비 최대 2.2배(과확대 화질 저하 방지). */
const CROP_MAX_ZOOM = 2.2
/** 주체가 프레임에서 차지할 목표 비율(0.8 = 80%, 나머지는 여백). */
const CROP_FILL = 0.8

/**
 * subjectBox 를 slotRatio(=슬롯 W/H) 프레임 안에 주체 중심 클로즈업으로 배치하는 값 계산.
 * 반환: img 에 적용할 % 값(래퍼 대비). null 이면 계산 불가 → 호출부가 cover 폴백.
 *
 * 원리: 이미지에서 주체 중심을 담는 slotRatio 비율의 "크롭 창"(cw×ch, px)을 정하고,
 *   그 창이 래퍼를 꽉 채우도록 img 를 확대·이동한다. 크롭 창은 cover 기준창(cw0)보다
 *   작을수록 확대(줌). 확대는 CROP_MAX_ZOOM 까지만. 크롭 창은 항상 이미지 안에 있어
 *   래퍼가 빈틈 없이 덮인다(레터박스 없음). 모두 비율 계산이라 실제 px 와 무관하게 동작.
 */
function computeCropPlacement(
  image: UploadedImage,
  box: SubjectBox,
  slotRatio: number,
): { widthPct: number; leftPct: number; topPct: number } | null {
  const W = image.width
  const H = image.height
  if (!(W > 0) || !(H > 0) || !(slotRatio > 0)) return null // 손상 저장본 방어
  const sw = box.w * W
  const sh = box.h * H
  const scx = (box.x + box.w / 2) * W
  const scy = (box.y + box.h / 2) * H
  // cover 기준 크롭창(줌 1) — slotRatio 비율의 최대 사각형이 이미지 안에 들어간 크기.
  const P = W / H
  let cw0: number
  if (P >= slotRatio) cw0 = H * slotRatio
  else cw0 = W // P < slotRatio → 폭이 제한, cw0 = W (ch0 = W/slotRatio ≤ H)
  // 주체를 CROP_FILL 만큼 담는 데 필요한 크롭 폭(가로·세로 제약 중 큰 쪽).
  const cwNeed = Math.max(sw / CROP_FILL, (sh / CROP_FILL) * slotRatio)
  const cwMin = cw0 / CROP_MAX_ZOOM // 줌 상한 = 최소 크롭창
  const cw = Math.min(cw0, Math.max(cwMin, cwNeed))
  const ch = cw / slotRatio
  // 주체 중심에 크롭창을 두되 이미지 밖으로 나가지 않게 클램프(빈틈 방지).
  const cropX = Math.min(Math.max(scx - cw / 2, 0), W - cw)
  const cropY = Math.min(Math.max(scy - ch / 2, 0), H - ch)
  return {
    widthPct: (W / cw) * 100,
    leftPct: -(cropX / cw) * 100,
    topPct: -(cropY / ch) * 100,
  }
}

/**
 * v5.1-A2 크롭 소비 컨텍스트 — AccentContext 패턴과 동일.
 * ResultView 가 photoAnalysis 로부터 계산한 소비 헬퍼를 Provider 로 내리고,
 * POINT·감각·갤러리 블록이 useCrop() 으로 소비한다.
 * ★ 불변식: 분석이 없으면 boxOf 가 항상 undefined → 전 블록이 cover 폴백(기존 렌더 100% 동일).
 */
interface CropCtx {
  /** 크롭 후보 박스 — subjectBox 유효 & 비흐림일 때만. 아니면 undefined(cover 폴백). */
  boxOf: (img: UploadedImage | undefined) => SubjectBox | undefined
  /** 사진 역할(분석 있을 때) — POINT 컷 우선 판정용. */
  roleOf: (img: UploadedImage | undefined) => PhotoAnalysisItem["role"] | undefined
  /** DNA 과즙·단면 가중치 — POINT 크롭 게이트(cut 아닌 사진도 클로즈업 허용). */
  dnaFavorsCut: boolean
}
const CropContext = createContext<CropCtx>({
  boxOf: () => undefined,
  roleOf: () => undefined,
  dnaFavorsCut: false,
})
function useCrop(): CropCtx {
  return useContext(CropContext)
}

/**
 * subjectBox 기반 CSS 크롭 이미지 — 래퍼(비율 고정 + overflow hidden) 안에서
 * img 를 계산된 %로 확대·이동해 주체를 중앙 클로즈업한다.
 * 계산 불가(손상 저장본 등)면 기존 cover 렌더로 폴백(불변식).
 * maxWidth:"none" — Tailwind preflight 의 img{max-width:100%} 를 무력화(줌 시 폭>100%).
 */
function CroppedImage({
  image,
  box,
  slotRatio,
  radius = 0,
  alt = "",
}: {
  image: UploadedImage
  box: SubjectBox
  slotRatio: number
  radius?: number
  alt?: string
}) {
  const accent = useAccent()
  const place = computeCropPlacement(image, box, slotRatio)
  const wrap: React.CSSProperties = {
    position: "relative",
    width: "100%",
    aspectRatio: String(slotRatio),
    overflow: "hidden",
    borderRadius: radius,
    background: accent.soft, // 로드 전/계산 틈 방어
  }
  if (!place) {
    return (
      <div style={wrap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image.url}
          alt={alt}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </div>
    )
  }
  return (
    <div style={wrap}>
      {/* height:auto — 확정 폭(width%)에서 원본 비율로 높이가 유도되어(래퍼 높이 확정성에
          의존하지 않음) foreignObject 래스터화에서도 크기가 안전. 위치(top/left%)만 래퍼 기준. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt={alt}
        style={{
          position: "absolute",
          top: `${place.topPct}%`,
          left: `${place.leftPct}%`,
          width: `${place.widthPct}%`,
          height: "auto",
          maxWidth: "none",
          display: "block",
        }}
      />
    </div>
  )
}

/**
 * textWrap(balance/pretty)은 Edge/Chrome이 지원하지만 React CSSProperties 타입에는
 * 아직 없어 얇게 확장한다. html-to-image는 같은 엔진으로 렌더하므로 JPG에도 동일 적용된다.
 */
type CSSPropertiesExt = React.CSSProperties & {
  textWrap?: "wrap" | "nowrap" | "balance" | "pretty" | "stable"
}
/** 헤딩류 — 마지막 줄 외톨이 단어 방지(줄 길이 균형). */
const WRAP_BALANCE: CSSPropertiesExt = { textWrap: "balance" }
/** 본문 p — 마지막 줄 한 단어만 남는 들쭉날쭉 방지. */
const WRAP_PRETTY: CSSPropertiesExt = { textWrap: "pretty" }

/**
 * 괄호 구간 줄바꿈 금지 렌더 헬퍼 (스펙 값·라벨, 크기/포장 카드 등 짧은 값용).
 * "(여름 햇과일)" 같은 괄호 그룹이 괄호 안에서 줄이 갈리지 않도록 nowrap span으로 감싼다.
 * 긴 괄호(내용 8자 이상)는 폰트를 살짝 줄여(0.88em) 한 줄 유지 확률을 높인다.
 * 괄호 밖 텍스트는 그대로 두어 정상적으로 줄바꿈된다. 인라인 span만 반환(JPG 위생 안전).
 */
function renderNoBreakParens(text: string): React.ReactNode {
  if (!text || text.indexOf("(") < 0) return text
  const parts: React.ReactNode[] = []
  const re = /\(([^()]*)\)/g
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const long = m[1].length >= 8
    parts.push(
      <span
        key={`np${k++}`}
        style={{ whiteSpace: "nowrap", fontSize: long ? "0.88em" : undefined }}
      >
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
    if (re.lastIndex === m.index) re.lastIndex++ // 빈 괄호 무한루프 방지
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

/**
 * 헤드라인 안의 "숫자+단위" 사실 토큰만 accent 색으로 하이라이트한다 (Hero h1 표시 전용).
 * 예: "13Brix", "13 브릭스", "2kg", "당도 13" → 그 부분만 accent.
 * 지어내는 것 없음 — 이미 입력에 있는 문자열의 색만 바꾼다. 편집 UX는 InlineEdit이 유지
 * (renderDisplay는 표시 모드에서만 호출). 토큰이 없으면 원문(단색)을 그대로 돌려준다 —
 * 상품명 등을 억지로 강조하지 않는다.
 */
const HEADLINE_TOKEN_RE =
  /당도\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s?(?:brix|Brix|BRIX|브릭스|kg|Kg|KG|g|통|구|알|과|송이|미|호|개(?!월)|팩|박스|입)/g
function renderHeadlineAccent(value: string, accentColor: string): React.ReactNode {
  HEADLINE_TOKEN_RE.lastIndex = 0
  const parts: React.ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null
  while ((m = HEADLINE_TOKEN_RE.exec(value)) !== null) {
    if (m.index > last) parts.push(value.slice(last, m.index))
    parts.push(
      <span key={`ht${k++}`} style={{ color: accentColor }}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
    if (HEADLINE_TOKEN_RE.lastIndex === m.index) HEADLINE_TOKEN_RE.lastIndex++
  }
  if (k === 0) return value // 토큰 없음 → 단색 유지
  if (last < value.length) parts.push(value.slice(last))
  return <>{parts}</>
}

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
  /**
   * v4.8-c: 포토 브레이크(텍스트 몰빵 구간을 끊는 풀블리드 사진)용 1~2장.
   * 총 사진 ≤ 3장이면 여유가 없어 빈 배열(브레이크 섹션이 조용히 사라짐). 4~5장 → 1장, 6장↑ → 2장.
   * 히어로 제외·재사용 상한 2회·POINT 카드 인접 회피를 지켜 남는(또는 2회차 재활용) 사진을 고른다.
   */
  breaks: UploadedImage[]
  /**
   * v5.2-A: 문제카드(ProblemArcBlock) 좌측 사진 슬롯(키위 레퍼런스). 길이 = 문제 카드 수.
   * 게이팅: analysis 있고 "모든" 카드를 채울 수 있을 때만 사진 배정(하나라도 부족하면 전부
   * undefined → 블록이 기존 텍스트 카드로 폴백, 혼재 금지). analysis 없으면 전부 undefined
   * (기존 렌더 100% 동일, 불변식). 기존 슬롯 배정 결과는 읽기만 — 재사용 상한 2회·인접 중복·
   * 히어로 제외·blurry/dark 제외 준수(cut/whole/farm 역할 우선).
   */
  problemArc: (UploadedImage | undefined)[]
}

const GALLERY_MAX = 8

/**
 * v4.4 갤러리 재배열(analysis 있을 때만 호출) — 집합·장수를 바꾸지 않고 순서만 바꾼다.
 *  1. blurry/dark(저품질) 사진을 뒤로 민다 → slice(0,MAX) 시 우선 탈락하고, 앞쪽 좋은
 *     사진이 캡션 달린 풀폭 자리에 온다.
 *  2. 깨끗한 사진은 역할별로 묶어 라운드로빈으로 뽑아 인접 사진의 역할이 다양해지게 한다
 *     (whole/cut/farm 등이 번갈아). 역할 순서는 첫 등장 순서 → 결정적.
 * 사진 중복을 만들지 않으므로(순열) 인접 중복 금지·재사용 상한 불변식과 무관하게 안전.
 */
function diversifyGallery(
  pool: UploadedImage[],
  roleOf: (img: UploadedImage) => PhotoAnalysisItem["role"] | undefined,
  isLowQ: (img: UploadedImage) => boolean,
): UploadedImage[] {
  const clean = pool.filter((img) => !isLowQ(img))
  const lowq = pool.filter((img) => isLowQ(img))
  const groups = new Map<string, UploadedImage[]>()
  for (const img of clean) {
    const key = roleOf(img) ?? "_"
    const g = groups.get(key)
    if (g) g.push(img)
    else groups.set(key, [img])
  }
  const order = [...groups.keys()] // 첫 등장 순서 → 결정적
  const interleaved: UploadedImage[] = []
  let added = true
  while (added) {
    added = false
    for (const k of order) {
      const g = groups.get(k)
      if (g && g.length > 0) {
        interleaved.push(g.shift() as UploadedImage)
        added = true
      }
    }
  }
  return [...interleaved, ...lowq]
}

export function planImages(
  images: UploadedImage[],
  opts: {
    keyPointCount: number
    recipeCount: number
    /**
     * v5.2-A: 문제카드(ProblemArcBlock) 수 — 좌측 사진 슬롯 개수. 없거나 0이면 problemArc = [].
     * analysis 없으면(byId undefined) 개수와 무관하게 전부 undefined(불변식).
     */
    problemArcCount?: number
    /**
     * v4.4 사진 인텔리전스(선택). 각 사진의 역할·대표컷 점수·품질 플래그.
     * 불변식: 없거나 빈 배열이면 아래 로직은 기존(v3.8)과 100% 동일하게 동작한다 —
     * 모든 분기가 byId(비어있지 않은 analysis 로만 생성) 존재 여부로 게이팅된다.
     */
    analysis?: PhotoAnalysisItem[]
    /**
     * v4.9-A DNA 가중치(선택). getVisualDNA(factKey).points 에 "과즙"·"단면" 계열
     * 포인트가 있을 때 true — cut 역할(클로즈업/컷) 사진을 POINT·punch 슬롯에서 한 단계
     * 더 우선한다(감각 강조).
     * ★ 불변식: 이 플래그는 byId(analysis 존재) 와 AND 로만 작동한다. analysis 없으면(byId
     *   undefined) 아래 boostCut 이 항상 false → 기존(v4.4) 슬롯 배정과 100% 동일. DNA 없이도
     *   (플래그 미전달·false) 동일. 켜질 때만 cut 우선순위를 useCount 위로 끌어올린다.
     */
    dnaFavorsCut?: boolean
  },
): ImagePlan {
  const keyPointCount = Math.max(0, opts.keyPointCount)
  const recipeCount = Math.max(0, opts.recipeCount)

  // analysis 가 없거나 빈 배열이면 byId = undefined → 이하 모든 신규 분기가 꺼진다(불변식).
  const analysis =
    opts.analysis && opts.analysis.length > 0 ? opts.analysis : undefined
  const byId = analysis
    ? new Map(analysis.map((a) => [a.imageId, a] as const))
    : undefined
  const itemOf = (img: UploadedImage): PhotoAnalysisItem | undefined =>
    byId?.get(img.id)
  const roleOf = (img: UploadedImage): PhotoAnalysisItem["role"] | undefined =>
    itemOf(img)?.role
  // 품질 저하(흐림/어두움) — analysis 없으면 항상 false(기존과 동일).
  const isLowQ = (img: UploadedImage): boolean => {
    const it = itemOf(img)
    return !!it && (!!it.blurry || !!it.dark)
  }
  // v4.9-A: DNA 가중치 — cut 우선순위 강화. analysis(byId) 있을 때만 켜진다(불변식).
  const boostCut = !!byId && !!opts.dnaFavorsCut
  // 고정 길이 우선순위 키의 사전식 비교(작을수록 우선).
  const lexLess = (a: number[], b: number[]): boolean => {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i]
    }
    return false
  }

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
      breaks: [],
      problemArc: Array<UploadedImage | undefined>(Math.max(0, opts.problemArcCount ?? 0)).fill(
        undefined,
      ),
    }
  }

  // 대표컷(hero) — analysis 있으면 blurry/dark 아닌 사진 중 heroScore 최고(동점 시 원래
  // 순서 앞). 전부 blurry/dark 이거나 analysis 미커버면 기존 로직(images[0]) 그대로.
  let hero = images[0]
  if (byId) {
    let best: UploadedImage | undefined
    let bestScore = -Infinity
    for (const img of images) {
      const it = byId.get(img.id)
      if (!it || it.blurry || it.dark) continue
      // 엄격한 > 로 동점 시 먼저 만난(원래 순서 앞) 사진을 유지.
      if (it.heroScore > bestScore) {
        bestScore = it.heroScore
        best = img
      }
    }
    if (best) hero = best
  }
  // hero를 뺀 전체 후보 풀. analysis 없으면 images.slice(1)과 동일(hero===images[0]).
  const restAll = byId ? images.filter((img) => img.id !== hero.id) : images.slice(1)

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
  const pickFeature = (
    preferRole?: PhotoAnalysisItem["role"],
    /**
     * v4.9-A: DNA cut 가중치 켤 때만 true(POINT 슬롯). 역할 일치를 사용횟수보다 앞세워
     * cut 사진을 "한 단계 더" 우선한다. false(기본)면 키 순서가 기존과 완전 동일(불변식).
     */
    boostRole?: boolean,
  ): UploadedImage | undefined => {
    if (rest.length === 0) return undefined
    let best: UploadedImage | undefined
    let bestKey: number[] | undefined
    let bestSameAsPrev: UploadedImage | undefined
    let bestSameKey: number[] | undefined
    rest.forEach((img, idx) => {
      const c = useCount.get(img.id) ?? 0
      if (c >= MAX_REUSE) return // 규칙 ②: 2회 초과 사용 금지
      // 우선순위 키(작을수록 우선): 기본 [사용횟수, 역할 불일치, 품질저하, 원본 순서].
      // analysis 없으면 역할·품질 항이 모두 0 → 키가 [c,0,0,idx]가 되어
      // "사용횟수 최소 → 동점 시 원본 앞" 기존 동작과 완전히 동일하다(불변식).
      const roleMiss = byId && preferRole ? (roleOf(img) === preferRole ? 0 : 1) : 0
      const lowq = byId && isLowQ(img) ? 1 : 0
      // v4.9-A: boostRole 이면 역할 일치를 사용횟수 앞으로 — cut 사진을 한 단계 더 우선.
      //   (boostRole 은 boostCut && preferRole 일 때만 true. 그 외엔 기존 키 그대로.)
      const key = boostRole ? [roleMiss, c, lowq, idx] : [c, roleMiss, lowq, idx]
      if (img.id === prevId) {
        // 규칙 ③: 직전과 같은 사진은 마지막 후보로만.
        if (!bestSameKey || lexLess(key, bestSameKey)) {
          bestSameKey = key
          bestSameAsPrev = img
        }
        return
      }
      if (!bestKey || lexLess(key, bestKey)) {
        bestKey = key
        best = img
      }
    })
    const chosen = best ?? bestSameAsPrev
    if (chosen) {
      useCount.set(chosen.id, (useCount.get(chosen.id) ?? 0) + 1)
      prevId = chosen.id
    }
    return chosen
  }

  // whyBrand — Hero 직후. hero 사진 금지. rest 없으면 undefined(텍스트 카드).
  // v4.4: analysis 있으면 farm 역할 사진을 우선 배정(없으면 preferRole undefined = 기존).
  const whyBrand = pickFeature(byId ? "farm" : undefined)

  // 고순위 슬롯(POINT 카드) — rest가 부족하면 undefined 그대로 두어 이미지 없이 렌더(규칙 ④).
  // 단, rest가 아예 0장(사진 1장뿐)일 때만 hero 폴백 허용(규칙 ⑤: 히어로+1곳).
  const onlyHero = rest.length === 0
  // v4.4: POINT 카드는 cut 역할(클로즈업/컷) 사진을 우선 배정.
  // v4.9-A: DNA 가 "과즙·단면"을 강조하면(boostCut) cut 역할을 사용횟수보다 앞세워 더 우선.
  const keyPoints: (UploadedImage | undefined)[] = []
  for (let i = 0; i < keyPointCount; i++) {
    const img = pickFeature(byId ? "cut" : undefined, boostCut)
    keyPoints.push(img ?? (onlyHero && i === 0 ? hero : undefined))
  }

  // v4.4: 레시피/즐기는 법 슬롯은 table 역할(상차림) 사진 우선.
  const recipe: (UploadedImage | undefined)[] = []
  for (let i = 0; i < recipeCount; i++) {
    const img = pickFeature(byId ? "table" : undefined)
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
  // v4.4: analysis 있으면 분위기 컷에 어울리는 cut 역할·비저품질 사진을 우선.
  // v4.9-A: punch 는 이미 unused 풀에서 cut 역할을 최우선(find 첫 순위)으로 집으므로
  //   DNA cut 가중치가 별도 코드 없이 이미 반영된다. boostCut 은 useCount 타이브레이크가
  //   cut 를 밀어낼 수 있는 POINT 슬롯(위)에서만 순위를 끌어올리면 충분하다(punch 무변경 = 안전).
  let punch: UploadedImage | undefined
  let leftover: UploadedImage[]
  if (byId && unused.length > 0) {
    punch =
      unused.find((img) => roleOf(img) === "cut" && !isLowQ(img)) ??
      unused.find((img) => !isLowQ(img)) ??
      unused[0]
    leftover = unused.filter((img) => img.id !== punch!.id)
  } else {
    // 불변식: analysis 없으면 기존과 동일(잉여 첫 장을 punch, 나머지가 leftover).
    punch = unused.length > 0 ? unused[0] : undefined
    leftover = punch ? unused.slice(1) : unused
  }

  // v3.1-b: sizeRef 예약 삭제 — 크기와 무관한 사진(비닐하우스 등)에 "실제 크기 참고"
  // 캡션이 붙는 사고가 나서, 남는 사진은 전부 갤러리가 흡수한다.
  // v3.8 fix: 갤러리 = 특징 슬롯이 안 쓴 잉여(leftover) + 갤러리 전용 예약분(reserved).
  //           원본 업로드 순서를 유지하도록 leftover 뒤에 reserved 를 붙인다(결정적).
  // v4.4: analysis 있으면 (a) blurry/dark 를 뒤로 밀고 (b) 역할을 라운드로빈으로 섞어
  //       인접 사진의 역할이 다양해지게 재배열한다(집합·장수는 그대로 → 모자이크 최소
  //       장수·재사용 상한·인접 중복 불변식 유지). analysis 없으면 기존 순서 그대로.
  const galleryPool = [...leftover, ...reserved]
  const gallery = (byId ? diversifyGallery(galleryPool, roleOf, isLowQ) : galleryPool).slice(
    0,
    GALLERY_MAX,
  )

  /**
   * v4.8-c 포토 브레이크 사진 배정 — 텍스트 몰빵 구간(스펙~보관~FAQ)에 끼울 풀블리드 1~2장.
   *
   * 게이팅: 총 사진 ≤ 3장이면 여유가 없어 0장(브레이크 섹션이 조용히 사라짐). 4~5장 → 1장,
   *   6장↑ → 2장(사진이 많을수록 브레이크를 하나 더 허용).
   * 후보 우선순위 키(작을수록 우선):
   *   [전체 사용횟수, POINT 카드 중복, 역할 불일치, 품질저하, 원본 순서].
   *   - 히어로 제외(규칙 ①). 이미 2회 쓴 사진은 후보에서 제외 → 절대 3회째 재사용 금지(규칙 ②·엣지 #6).
   *   - 삽입 위치가 POINT 카드와 위·아래로 근접하므로, POINT가 쓴 사진은 뒤로 밀어 인접 중복 회피.
   *   - analysis 있으면 whole/farm/table 역할·비저품질을 우선(b). 없으면 역할·품질 항이 0 →
   *     "사용횟수 최소 → POINT 비중복 → 원본 순서" 순의 결정적 선택(불변식: 기존 슬롯 배정과 무관).
   *   - 갤러리·특징 슬롯이 이미 흡수한 사진을 2회차로 재활용하는 게 일반적(사진이 딱 맞을 때)이라
   *     useCount 최소 우선으로 재사용을 골고루 분산한다. Math.random 없음 — 결정적.
   * 두 브레이크는 서로 다른 사진(중복 금지). 후보가 소진되면 남은 브레이크는 생략(게이팅).
   */
  const PHOTOBREAK_MAX = 2
  const breaks: UploadedImage[] = []
  if (images.length >= 4) {
    const wantBreaks = Math.min(PHOTOBREAK_MAX, images.length >= 6 ? 2 : 1)
    // 전 슬롯 사용횟수 집계(재사용 상한·분산 판정). 히어로 포함.
    const globalUse = new Map<string, number>()
    const bump = (img: UploadedImage | undefined) => {
      if (img) globalUse.set(img.id, (globalUse.get(img.id) ?? 0) + 1)
    }
    bump(hero)
    bump(whyBrand)
    for (const kp of keyPoints) bump(kp)
    for (const rc of recipe) bump(rc)
    bump(punch)
    for (const g of gallery) bump(g)
    // POINT 카드가 쓴 사진 집합 — 인접 중복 회피용.
    const kpIds = new Set<string>()
    for (const kp of keyPoints) if (kp) kpIds.add(kp.id)
    // 브레이크에 어울리는 역할(whole/farm/table)이면 0, 아니면 1. analysis 없으면 항상 0(불변식).
    const breakRoleMiss = (img: UploadedImage): number => {
      if (!byId) return 0
      const r = roleOf(img)
      return r === "whole" || r === "farm" || r === "table" ? 0 : 1
    }
    for (let b = 0; b < wantBreaks; b++) {
      let best: UploadedImage | undefined
      let bestKey: number[] | undefined
      images.forEach((img, idx) => {
        if (img.id === hero.id) return // 히어로 제외(규칙 ①)
        if (breaks.some((x) => x.id === img.id)) return // 브레이크끼리 중복 금지
        const used = globalUse.get(img.id) ?? 0
        if (used >= MAX_REUSE) return // 규칙 ②·엣지 #6: 3회째 재사용 금지
        const kpMiss = kpIds.has(img.id) ? 1 : 0
        const lowq = byId && isLowQ(img) ? 1 : 0
        const key = [used, kpMiss, breakRoleMiss(img), lowq, idx]
        if (!bestKey || lexLess(key, bestKey)) {
          bestKey = key
          best = img
        }
      })
      if (!best) break // 후보 소진 → 남은 브레이크 생략(게이팅)
      breaks.push(best)
      globalUse.set(best.id, (globalUse.get(best.id) ?? 0) + 1) // 다음 브레이크의 3회째 금지 반영
    }
  }

  /**
   * v5.2-A 문제카드(ProblemArc) 좌측 사진 배정 — 문제 카드에 사진을 붙인다(키위 레퍼런스).
   *
   * 게이팅: analysis(byId) 있을 때만. problemArcCount 개 카드를 "전부" 채울 수 있을 때만 사진을
   *   준다. 한 장이라도 못 채우면 전부 undefined 로 두어 블록이 기존 텍스트 카드로 폴백(혼재 금지).
   *   analysis 없으면(byId undefined) 항상 전부 undefined → 기존 렌더 100% 동일(불변식).
   * 규율(기존 슬롯 배정 결과는 읽기만, 불변):
   *   - 히어로 제외(규칙 ①). blurry/dark 하드 제외. 재사용 상한 MAX_REUSE(2). problemArc 내 중복 금지.
   *   - 역할 cut/whole/farm 우선(soft). 직전(WHY 카드)·직전 카드 사진과 인접 중복 회피.
   *   - 전 슬롯(hero~breaks) 사용횟수를 집계해 useCount 최소 우선으로 재사용을 골고루 분산. 결정적.
   */
  const problemArc: (UploadedImage | undefined)[] = Array<UploadedImage | undefined>(
    Math.max(0, opts.problemArcCount ?? 0),
  ).fill(undefined)
  if (byId && problemArc.length > 0) {
    // 전 슬롯 사용횟수 집계(재사용 상한·분산 판정). 히어로 포함.
    const paUse = new Map<string, number>()
    const bumpPa = (img: UploadedImage | undefined) => {
      if (img) paUse.set(img.id, (paUse.get(img.id) ?? 0) + 1)
    }
    bumpPa(hero)
    bumpPa(whyBrand)
    for (const kp of keyPoints) bumpPa(kp)
    for (const rc of recipe) bumpPa(rc)
    bumpPa(punch)
    for (const g of gallery) bumpPa(g)
    for (const bk of breaks) bumpPa(bk)
    // 문제카드에 어울리는 역할(cut/whole/farm)이면 0, 아니면 1(soft 우선).
    const PA_ROLES = new Set<PhotoAnalysisItem["role"]>(["cut", "whole", "farm"])
    const paRoleMiss = (img: UploadedImage): number => {
      const r = roleOf(img)
      return r && PA_ROLES.has(r) ? 0 : 1
    }
    const chosen: UploadedImage[] = []
    let paPrev: string | undefined = whyBrand?.id // 직전 페이지 사진(WHY 카드) — 첫 카드가 회피
    for (let c = 0; c < problemArc.length; c++) {
      let best: UploadedImage | undefined
      let bestKey: number[] | undefined
      images.forEach((img, idx) => {
        if (img.id === hero.id) return // 히어로 제외(규칙 ①)
        if (isLowQ(img)) return // blurry/dark 하드 제외
        if (chosen.some((x) => x.id === img.id)) return // problemArc 내 중복 금지
        const used = paUse.get(img.id) ?? 0
        if (used >= MAX_REUSE) return // 재사용 상한(2)
        const isPrev = img.id === paPrev ? 1 : 0 // 인접(직전 카드·WHY) 회피
        const key = [used, isPrev, paRoleMiss(img), idx]
        if (!bestKey || lexLess(key, bestKey)) {
          bestKey = key
          best = img
        }
      })
      if (!best) break // 한 장이라도 못 채우면 중단 → 전부 텍스트 폴백(혼재 금지)
      chosen.push(best)
      paUse.set(best.id, (paUse.get(best.id) ?? 0) + 1)
      paPrev = best.id
    }
    // 전 카드가 채워졌을 때만 사진 구성(부분 채움 금지 — 혼재 방지).
    if (chosen.length === problemArc.length) {
      for (let i = 0; i < chosen.length; i++) problemArc[i] = chosen[i]
    }
  }

  return {
    hero,
    whyBrand,
    keyPoints,
    recipe,
    packaging,
    sizeRef: undefined,
    punch,
    gallery,
    breaks,
    problemArc,
  }
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
  // v3.4 fix(이슈1): 'WHY'(구 검은고딕 36px)가 88px 원을 좌우로 뚫고 링과 겹쳤다.
  // 대문자 실폭이 원 안지름을 넘겼던 문제라, 라벨 길이에 맞춰 폰트를 계산해 좌우
  // 여백(안지름의 ~78%)을 확보한다. (v5.0 Pretendard 900은 라틴 대문자 폭이 더 좁아
  // 아래 0.75em 가정보다 실제로 더 작게 들어가므로 넘침 여유가 오히려 커졌다.)
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
          fontWeight: 900,
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
          <OverrideText id="dome.label" fallback={label} maxLength={12} />
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
  editId,
}: {
  text: string
  accent: AccentPalette
  isMobile: boolean
  /** v4.0: 리본 라벨 인라인 편집 키(있으면 OverrideText로 감싼다). */
  editId?: string
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
        {editId ? <OverrideText id={editId} fallback={text} maxLength={24} /> : text}
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
        fontWeight: 900,
        fontFamily: DISPLAY_FONT,
        letterSpacing: -1,
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

/** 부정어 사전 — 강조 박스에 넣으면 안 되는 불만/우려 표현. */
const NEGATIVE_WORDS = [
  "밍밍", "속상", "왜", "걱정", "실망", "별로", "아쉽", "후회", "질리", "물러",
  "무르", "맛없", "싱거", "떫", "상한", "썩", "불안", "짜증", "화나", "불만", "그저 그",
]

/**
 * "불만형" 문장 판별 — 물음표로 끝나며(또는 포함) 부정어를 담은 문장.
 * 예: "왜 이렇게 밍밍하죠?" → 강조 박스로 렌더하면 안 됨.
 */
function isComplaintSentence(s: string): boolean {
  const text = (s ?? "").trim()
  if (!text) return false
  if (!/[?？]/.test(text)) return false
  return NEGATIVE_WORDS.some((w) => text.includes(w))
}

/**
 * "긍정·감각" 문장 판별 — 느낌표 또는 감각어를 포함하고 의문문이 아닌 문장.
 * 불만형 카피를 대체할 발췌 후보 판별에 사용.
 */
function isPositiveSensory(s: string): boolean {
  const text = (s ?? "").trim()
  if (!text) return false
  if (/[?？]/.test(text)) return false
  return /!/.test(text) || SENSORY_WORDS.some((w) => text.includes(w))
}

/**
 * story에서 긍정·감각 문장(느낌표/감각어, 비의문문)을 하나 발췌한다. 없으면 null.
 * 강조 박스가 불만형 카피로 채워지지 않게 하는 대체 소스(불변: 원문 그대로, 지어내지 않음).
 * exclude: 이미 다른 장치(스토리 풀쿼트)가 쓴 문장 — 같은 문장 2회 노출 방지용으로 건너뛴다.
 */
export function extractPositiveSentence(story: string, exclude?: string | null): string | null {
  const text = story ?? ""
  if (!text.trim()) return null
  const parts = text.match(/[^.!?\n]*(?:[.!?]+|\n+|$)/g) ?? []
  const sentences = parts.map((p) => p.trim()).filter((p) => p.length > 0)
  const skip = exclude?.trim()
  for (const s of sentences) {
    if (skip && s === skip) continue
    if (isComplaintSentence(s)) continue
    if (isPositiveSensory(s)) return s
  }
  return null
}

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

  // 강조 박스 부정문 안전장치 — 불만형(물음표+부정어) 문장은 강조 대상에서 제외한다.
  // (예: "왜 이렇게 밍밍하죠?"가 풀쿼트 박스로 승격되던 문제 차단.)
  const eligible = sentences.filter((s) => !isComplaintSentence(s))
  if (eligible.length === 0) return null // 불만형뿐이면 강조 박스 생략(본문만 렌더)

  let targetTrimmed: string | null = null
  const firstSensory = eligible.find(isSensory)
  if (firstSensory) {
    targetTrimmed = firstSensory
  } else {
    // 감지 애매 → 불만형 아닌 문장 중 두 번째 기본 강조(결정적 폴백).
    targetTrimmed = eligible[1] ?? eligible[0] ?? null
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
  const layout = useLayout()
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
          borderRadius: layout.cardRadius,
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
              <OverrideText id={`trio.${i}`} fallback={label} maxLength={20} />
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
function CtaPill({ text, isMobile, editId }: { text: string; isMobile: boolean; editId?: string }) {
  const accent = useAccent()
  // 물결 밑줄 강조 렌더 — 편집(OverrideText)·비편집 공용. 셀러가 고친 문구에도 동일 적용.
  const renderEmphasis = (value: string): React.ReactNode => {
    const { lead, mark, tail } = splitPhraseEmphasis(value)
    if (!mark) return value
    return (
      <>
        {lead}
        <span
          style={{
            color: accent.dark,
            textDecoration: "underline wavy",
            // v5.3 듀오톤: 물결 밑줄만 보조 그린(잎 톤)으로 — 소면적 장식 한정.
            textDecorationColor: accent.secondary,
            textDecorationThickness: isMobile ? 2 : 3,
            textUnderlineOffset: isMobile ? 5 : 8,
          }}
        >
          {mark}
        </span>
        {tail}
      </>
    )
  }
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isMobile ? 8 : 12,
        fontSize: isMobile ? 22 : 40,
        fontWeight: 900,
        fontFamily: DISPLAY_FONT,
        letterSpacing: -1,
        color: INK,
        lineHeight: 1.25,
        wordBreak: "keep-all",
        textAlign: "center",
      }}
    >
      {/* 좌측 잎사귀형 점 — 버튼이 아니라 캡션임을 시각적으로 알린다.
          v5.3 듀오톤: 잎사귀 은유에 맞춰 보조 그린으로(소면적 장식). */}
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: isMobile ? 10 : 16,
          height: isMobile ? 10 : 16,
          borderRadius: "50%",
          background: accent.secondary,
        }}
      />
      <span>
        {editId ? (
          <OverrideText id={editId} fallback={text} maxLength={40} renderDisplay={renderEmphasis} />
        ) : (
          renderEmphasis(text)
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
        {/* 부분 밑줄 형광펜 — 배송 약속 문장 앞 핵심 구를 accent 물결 밑줄로 강조.
            v4.0: OverrideText로 인라인 편집 가능(강조는 편집된 문구에도 동일 적용). */}
        <OverrideText
          id="deliveryPromise.text"
          fallback={text}
          maxLength={80}
          renderDisplay={(value) => {
            const { lead, mark, tail } = splitPhraseEmphasis(value)
            if (!mark) return value
            return (
              <>
                {lead}
                <span
                  style={{
                    fontWeight: 900,
                    color: accent.dark,
                    textDecoration: "underline wavy",
                    // v5.3 듀오톤: 물결 밑줄만 보조 그린(잎 톤).
                    textDecorationColor: accent.secondary,
                    textDecorationThickness: 2,
                    textUnderlineOffset: isMobile ? 4 : 6,
                  }}
                >
                  {mark}
                </span>
                {tail}
              </>
            )
          }}
        />
      </span>
    </div>
  )
}

/**
 * v5.4(작업6): 결과 화면 외곽 2열([아트보드|340px])을 세로 스택으로 접는 폭 임계값.
 * DetailMaker.SPLIT_BREAKPOINT(1280)와 별개 — 이건 결과 화면 자체 컨테이너 폭 기준.
 * 340px 패널 + 최소한의 아트보드 폭 확보가 안 되는 좁은 뷰에서 패널을 아래로 내린다.
 * (아트보드 내부 렌더는 불변 — previewScale이 축소만 담당.)
 */
const RESULT_STACK_BREAKPOINT = 720

export function ResultView({
  copy,
  images,
  packagingImage,
  sizeImage,
  photoAnalysis,
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
  layoutVariant,
  brandSnapshot,
}: ResultViewProps) {
  const [enhance, setEnhance] = useState(true)
  /** v4.6: 레이아웃 토큰 — undefined면 standard(불변식). Provider로 각 블록에 주입. */
  const layout = useMemo(
    () => LAYOUT_TOKENS[layoutVariant ?? "standard"] ?? LAYOUT_TOKENS.standard,
    [layoutVariant],
  )
  const captureRef = useRef<HTMLDivElement>(null)
  /**
   * B1(v5.7): 폭 상태 단일화 — 이 컴포넌트가 "폭 상태의 주인"이다.
   * - exportWidth = 플랫폼 폭(=JPG 저장 폭 = 미리보기 기본 폭). 툴바·ExportPanel이 공유하는 단일 소스.
   *   v5.4의 fdp:export-presets(localStorage)로 기억·복원한다.
   * - mobilePreview = 보조 미리보기(360/414). exportWidth(=저장 폭)는 절대 바꾸지 않는다.
   *   다만 이 상태에선 공유 captureRef가 모바일 스타일(isMobile)로 렌더되므로, 그대로 캡처하면
   *   플랫폼 폭 캔버스에 모바일 글자·여백이 찍힌다 → 이 동안 JPG 저장은 막는다(ExportPanel blockedReason).
   * previewWidth = mobilePreview ?? exportWidth (모바일 확인 중이면 그 폭, 아니면 플랫폼 폭).
   */
  const [exportWidth, setExportWidth] = useState<ExportWidth>(860)
  const [mobilePreview, setMobilePreview] = useState<MobileWidth | null>(null)
  const previewWidth = mobilePreview ?? exportWidth

  // v5.4 하이드레이션 안전: 서버 기본값(860)으로 프리렌더와 일치시키고 마운트 후 복원.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.EXPORT_PRESETS)
      if (raw) {
        const parsed = JSON.parse(raw) as { width?: number }
        if (VALID_EXPORT_WIDTHS.has(parsed.width as ExportWidth)) {
          setExportWidth(parsed.width as ExportWidth)
        }
      }
    } catch {
      // 프라이빗 모드·오염 JSON 등 복원 실패는 무시하고 기본값 사용
    }
  }, [])

  /** 플랫폼 폭 변경 → 미리보기·내보내기 동시 반영 + localStorage 기억(모바일 보조는 해제). */
  const handleChangeExportWidth = (w: ExportWidth) => {
    setExportWidth(w)
    setMobilePreview(null) // 플랫폼을 고르면 그 폭을 바로 보여준다(WYSIWYG)
    try {
      // targetSliceHeight(ExportPanel 소유)를 보존하도록 병합 저장.
      const raw = localStorage.getItem(STORAGE_KEYS.EXPORT_PRESETS)
      const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      localStorage.setItem(STORAGE_KEYS.EXPORT_PRESETS, JSON.stringify({ ...parsed, width: w }))
    } catch {
      // 저장 실패(프라이빗 모드 등)는 무시 — 이번 세션 동작엔 영향 없음
    }
  }

  /** 모바일 보조 미리보기 토글(같은 값 다시 누르면 해제). 내보내기 폭은 건드리지 않는다. */
  const handleToggleMobilePreview = (w: MobileWidth) => {
    setMobilePreview((prev) => (prev === w ? null : w))
  }

  /**
   * B3(v5.7): 검수 위반 클릭 → 본문의 해당 필드로 점프 + 1.5초 배경 플래시.
   * data-field(=compliance field 경로: "story"·"keyPoints[0].body" 등)로 표시 요소를 찾는다.
   * 플래시는 background-color 인라인만 건드린다 — 대상은 data-inline-edit 표시 span 이라
   * 캡처 클론 정리(배경 중화)가 그대로 지워 JPG 위생을 해치지 않는다
   * (html-to-jpg·artboard-segments 두 내보내기 경로 공통). 대상이 없으면(예: heroKicker·고정문구) 무동작.
   */
  const handleJumpToField = (field: string) => {
    if (typeof document === "undefined") return
    const el = document.querySelector<HTMLElement>(`[data-field="${field}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "center" })
    el.style.transition = "background-color 0s"
    el.style.backgroundColor = "#FFE08A" // 웜 하이라이트(코랄 셸과 조화)
    requestAnimationFrame(() => {
      el.style.transition = "background-color 1.4s ease"
      el.style.backgroundColor = "transparent"
    })
    window.setTimeout(() => {
      el.style.transition = ""
      el.style.backgroundColor = ""
    }, 1600)
  }

  /** B2(v5.7): 카피 전체 다시 생성 — 편집 손실 위험이 커 1회 확인 후 실행(오클릭 방지). */
  const handleFullRegen = () => {
    if (typeof window !== "undefined" && !window.confirm(t.detail.result.retryFullConfirm)) return
    onRetry()
  }

  // 폰 미리보기(360/414)만 모바일 레이아웃(패딩·폰트 축소).
  // 쿠팡 780·11번가 831·스토어 860·자사몰 1000은 전부 이미지 매체 = 데스크톱 취급.
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

  /**
   * v5.4(작업6): 결과 화면 외곽 2열/세로 스택 전환. 뷰포트 폭 기준(DetailMaker와 동일 패턴).
   * 좁으면(<720) 아트보드 위·패널 아래로 스택 → 폰에서 미리보기 극축소 방지.
   */
  // v5.4 하이드레이션 수정: 초기값에서 innerWidth를 읽으면 프리렌더 HTML(서버 false)과
  // 좁은 클라이언트 첫 렌더가 어긋난다(React #418). 서버 기본값으로 시작하고
  // 아래 effect의 onResize()가 마운트 직후 실제 폭으로 동기화한다.
  const [isNarrowLayout, setIsNarrowLayout] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const onResize = () => setIsNarrowLayout(window.innerWidth < RESULT_STACK_BREAKPOINT)
    onResize()
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const keyPoints: CopyKeyPoint[] = useMemo(() => {
    if (copy.keyPoints && copy.keyPoints.length >= 1) return copy.keyPoints.slice(0, 3)
    return []
  }, [copy.keyPoints])

  /**
   * v5.2-A: 문제카드 수(좌측 사진 슬롯 개수). ProblemArcBlock 과 동일 규칙(최대 3, 문제 있을 때만).
   * planImages 에 넘겨 problemArc 사진 슬롯을 그만큼 확보한다(analysis 있을 때만 실제 배정).
   */
  const problemArcCount = useMemo(
    () =>
      copy.problemArc && copy.problemArc.problems.length > 0
        ? Math.min(3, copy.problemArc.problems.length)
        : 0,
    [copy.problemArc],
  )

  /**
   * v4.9-A 비주얼 DNA — 품종 매칭(detectFruitFactKey) → getVisualDNA. 기존 detectFruitFactKey
   * 사용 지점과 동일한 factKey 를 재사용한다. 매칭 실패(null)면 visualDNA 도 null →
   * 모티프 전 지점 미노출(게이팅)·이미지 가중치 불변(불변식).
   */
  const visualDNA = useMemo<VisualDNA | null>(() => {
    const key = detectFruitFactKey(productName)
    return key ? getVisualDNA(key) : null
  }, [productName])
  /** 모티프 키 — Provider 로 각 지점에 주입. DNA 없으면 null(전 지점 미노출). */
  const motifKind = visualDNA?.motif ?? null
  /**
   * DNA points 에 "과즙"·"단면" 계열이 있으면 planImages 에서 cut 사진을 한 단계 더 우선.
   * DNA 없으면 false → 이미지 배정 기존과 100% 동일(불변식).
   */
  const dnaFavorsCut = useMemo(() => {
    const pts = visualDNA?.points
    if (!pts || pts.length === 0) return false
    const CUT_TOKENS = ["과즙", "즙", "단면", "과육", "속살", "컷"]
    return pts.some((p) => CUT_TOKENS.some((tk) => p.includes(tk)))
  }, [visualDNA])

  /**
   * v3.0 중앙 이미지 배정 — 모든 블록이 여기서 나온 imagePlan을 소비한다.
   * v3.1-b: RecipeBlock이 사진을 안 쓰게 되어 recipe 슬롯은 항상 0 —
   * 그만큼의 사진이 갤러리로 흘러간다.
   */
  const imagePlan = useMemo(
    () =>
      planImages(images, {
        keyPointCount: keyPoints.length,
        recipeCount: 0,
        problemArcCount,
        analysis: photoAnalysis ?? undefined,
        dnaFavorsCut,
      }),
    [images, keyPoints.length, problemArcCount, photoAnalysis, dnaFavorsCut],
  )
  const heroImage = imagePlan.hero
  const galleryImages = imagePlan.gallery

  /**
   * v4.4 사진 캡션 폴백 — imageId → visibleNote(관찰 메모). 갤러리 캡션 슬롯의
   * 기본 문구(fallback)로 끼워 넣는다(슬롯 id 불변). 캡션 알약 크기에 맞게 24자로 클램프.
   * 없으면 빈 Map → GalleryBlock 은 기존 중립 안전 문구로 폴백(하위호환).
   *
   * 안전 게이팅(규칙3 허위광고 방지): visibleNote 는 아트보드(JPG)에 직접 렌더되므로
   * 산지·품종·당도·맛·신선도·수확·인증 같은 "사진만으로 알 수 없는 사실 주장"이 섞이면
   * (모델이 프롬프트 규칙 위반 시) 승격하지 않고 중립 안전 문구로 폴백한다.
   * 또한 손상/조작 저장본에서 visibleNote 가 문자열이 아닐 수 있어 typeof 로 방어한다
   * (isCaptionSafeNote 가 문자열이 아니면 false 반환 — 크래시 방지).
   */
  const photoNoteById = useMemo(() => {
    const m = new Map<string, string>()
    if (!photoAnalysis) return m
    for (const it of photoAnalysis) {
      if (!it || typeof it.imageId !== "string") continue
      if (!isCaptionSafeNote(it.visibleNote)) continue
      m.set(it.imageId, clampCaptionNote(it.visibleNote.trim()))
    }
    return m
  }, [photoAnalysis])

  /**
   * v5.1-A2 사진 분석 인덱스 — imageId → 항목. 스마트 크롭(subjectBox·role·blurry) 소비용.
   * 없으면 빈 Map → boxOf 항상 undefined → 크롭·오버레이 전부 미작동(분석 없는 경로 불변식).
   */
  const analysisById = useMemo(() => {
    const m = new Map<string, PhotoAnalysisItem>()
    if (photoAnalysis) {
      for (const it of photoAnalysis) {
        if (it && typeof it.imageId === "string") m.set(it.imageId, it)
      }
    }
    return m
  }, [photoAnalysis])

  /**
   * v5.1-A2 크롭 컨텍스트 값 — 각 블록(POINT·감각·갤러리)에 Provider 로 주입.
   * boxOf: subjectBox 유효 & 비흐림일 때만 박스 반환(흐린 사진 크롭 금지 — 더 흐려 보임).
   * 분석 없으면 boxOf 가 항상 undefined → 전 블록 cover 폴백(기존 렌더 100% 동일).
   */
  const cropCtxValue = useMemo<CropCtx>(
    () => ({
      boxOf: (img) => {
        if (!img) return undefined
        const it = analysisById.get(img.id)
        if (!it || it.blurry) return undefined
        return readSubjectBox(it)
      },
      roleOf: (img) => (img ? analysisById.get(img.id)?.role : undefined),
      dnaFavorsCut,
    }),
    [analysisById, dnaFavorsCut],
  )

  /**
   * 노출할 고객 후기 — 본문이 있는 것만(최대 3개). 0건이면 ReviewsBlock 미노출.
   * 셀러 직접 입력이라 AI가 만들지 않는다. highlight는 text에 실제로 포함될 때만 강조.
   */
  const validReviews = useMemo<SellerReview[]>(() => {
    if (!reviews || reviews.length === 0) return []
    return reviews
      .filter((r) => r && r.text.trim().length > 0)
      .slice(0, 3)
      .map((r) => ({
        text: r.text.trim(),
        highlight: r.highlight?.trim() || undefined,
        // v5.3(작업3): 신뢰 메타 3종을 렌더까지 통과. 무효 별점(범위 밖·비정수)은 드롭 —
        // 표기 자체를 생략해 지어내기·구버전 회귀를 막는다.
        rating:
          Number.isInteger(r.rating) && (r.rating as number) >= 1 && (r.rating as number) <= 5
            ? (r.rating as number)
            : undefined,
        author: r.author?.trim() || undefined,
        optionLabel: r.optionLabel?.trim() || undefined,
      }))
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

  /**
   * 강조 박스(SensoryPunch) 부정문 안전장치 — highlightBox가 불만형(물음표+부정어)이면
   * 그대로 강조 박스로 띄우지 않고 story에서 긍정·감각 문장을 대신 발췌한다.
   * 발췌할 문장이 없으면 null → 박스 자체를 생략. 비어 있으면 기존대로 미노출.
   *  - editable: highlightBox 원문 그대로 → 인라인 편집 유지.
   *  - !editable: story에서 파생한 대체 문구 → 표시 전용(편집은 story 쪽).
   */
  const punchDisplay = useMemo<{ text: string; editable: boolean } | null>(() => {
    const hb = copy.highlightBox?.trim() ?? ""
    if (!hb) return null
    if (!isComplaintSentence(hb)) return { text: hb, editable: true }
    // 스토리 풀쿼트가 쓰는 문장은 제외 — 폴백끼리 같은 문장 2회 노출 방지.
    const quoted = splitStoryHighlight(copy.story)?.highlight ?? null
    const alt = extractPositiveSentence(copy.story, quoted)
    return alt ? { text: alt, editable: false } : null
  }, [copy.highlightBox, copy.story])

  /**
   * v5.1-A2 오버레이 발췌문 — 스토리 발췌(splitStoryHighlight 재사용) 흰 글씨 오버레이용.
   * 스토리 콜아웃(StoryBlock 형광펜 강조 = hi)이 이미 노출하는 문장은 제외하고, 겹치지 않는
   * 다른 긍정·감각 문장만 채택한다. 콜아웃(hi)으로 폴백하지 않는다 — 오버레이는 StoryBlock
   * "직후"라 같은 문장을 흰 글씨로 재노출하면 형광펜 문장과 back-to-back 중복이 도드라진다
   * (punch 다크밴드는 위치가 분리돼 폴백 허용, 오버레이는 인접해 폴백 없이 생략이 안전).
   * 지어내지 않음 — 스토리 원문 문장 그대로. 콜아웃과 다른 문장이 없으면 null → 오버레이 미노출.
   */
  const overlayQuote = useMemo<string | null>(() => {
    const hi = splitStoryHighlight(copy.story)?.highlight?.trim() ?? null
    // 콜아웃(hi)과 겹치지 않는 문장만 — 폴백으로 hi 를 재사용하지 않는다(인접 중복 방지).
    const distinct = extractPositiveSentence(copy.story, hi)?.trim() ?? null
    return distinct && distinct.length > 0 ? distinct : null
  }, [copy.story])

  /**
   * v5.1-A2 오버레이 와이드 사진 — whole/farm/table 역할·비저품질(blurry/dark 제외)·히어로 제외.
   * 재사용 규칙 준수: 특징 슬롯(whyBrand·POINT)이 이미 쓴 사진은 뒤로, 미사용(주로 갤러리행)
   * 사진을 우선해 과도한 재사용을 피한다. 결정적(원본 순서). 후보 없으면 undefined.
   * ★ 불변식(구버전 저장본 보존): 크롭 3슬롯과 동일하게 subjectBox 유효 사진만 후보로 삼는다.
   *   photoAnalysis 는 v4.4부터 Work 에 저장·복원되지만 subjectBox 는 v5.1 신규 필드라
   *   v4.4~v5.0 저장본엔 없다 → 그 저장본은 eligible 이 비어 undefined → 오버레이 미노출(기존
   *   렌더 100% 동일). 오버레이는 subjectBox 신호가 있는 신규 분석에서만 뜬다.
   */
  const overlayImage = useMemo<UploadedImage | undefined>(() => {
    if (!photoAnalysis || photoAnalysis.length === 0) return undefined
    const WIDE_ROLES = new Set<PhotoAnalysisItem["role"]>(["whole", "farm", "table"])
    const usedIds = new Set<string>()
    if (imagePlan.whyBrand) usedIds.add(imagePlan.whyBrand.id)
    for (const kp of imagePlan.keyPoints) if (kp) usedIds.add(kp.id)
    const eligible = images.filter((img) => {
      if (heroImage && img.id === heroImage.id) return false // 히어로 에코 금지(규칙 ①)
      const it = analysisById.get(img.id)
      if (!it || it.blurry || it.dark) return false // 비저품질 제외
      if (!readSubjectBox(it)) return false // 크롭과 동일 규율 — subjectBox 없는 구버전 저장본 보존
      return WIDE_ROLES.has(it.role)
    })
    return eligible.find((img) => !usedIds.has(img.id)) ?? eligible[0]
  }, [photoAnalysis, images, heroImage, imagePlan, analysisById])

  return (
    <AccentContext.Provider value={accent}>
    <LayoutContext.Provider value={layout}>
    <MotifContext.Provider value={motifKind}>
    <EditContext.Provider value={{ copy, onCopyChange }}>
    <CropContext.Provider value={cropCtxValue}>
    <div
      style={{
        display: "grid",
        // v5.4(작업6): 좁으면 세로 스택(아트보드 위·패널 아래), 넓으면 기존 2열.
        gridTemplateColumns: isNarrowLayout
          ? "minmax(0, 1fr)"
          : "minmax(0, 1fr) minmax(0, 340px)",
        gap: 24,
        alignItems: "start",
      }}
    >
      <div>
        {/* B1: 아트보드 위 스티키 통합 폭 툴바 — 미리보기·내보내기 폭 단일 컨트롤 + 편집 힌트/축소 안내.
            captureRef 바깥 형제 + fdp-no-print → JPG 캡처에 안 찍힌다. */}
        <WidthToolbar
          exportWidth={exportWidth}
          onChangeExportWidth={handleChangeExportWidth}
          mobilePreview={mobilePreview}
          onToggleMobilePreview={handleToggleMobilePreview}
          previewWidth={previewWidth}
          previewScale={previewScale}
        />

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

            {/* v5.0-C: 상단 브랜드 라벨 — From 배지 위, 흰 바탕 얇은 서명(로고+스토어명).
                brandSnapshot 없으면 렌더 안 됨(게이팅 불변식 — 기존 렌더와 100% 동일). */}
            {brandSnapshot && <BrandTopLabel brand={brandSnapshot} isMobile={isMobile} />}

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
                <ProblemArcBlock arc={copy.problemArc} photos={imagePlan.problemArc} isMobile={isMobile} />
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

            {/* 3a-2 / 3b. 임팩트 블록 — 페이지당 하나 (v5.1.1 우선순위: 오버레이 > 다크밴드).
                오버레이(와이드 사진 위 카피)가 가능하면 다크밴드 슬로건(highlightBox)을 사진 위로
                승격해 렌더한다 — 벤치마크상 더 디자이너다운 구도이고 내용 손실도 없다(편집 유지).
                슬로건이 없으면(punchDisplay null) 스토리 발췌(overlayQuote)로 폴백.
                오버레이 불가(적합 사진 없음)면 기존 다크밴드(SensoryPunch) 그대로.
                ★ overlayImage 는 subjectBox(v5.1 신규 분석 신호) 유효 사진만 선정 →
                  구버전 저장본·분석 없는 경로엔 오버레이가 절대 안 뜨고 다크밴드가 기존과 동일(회귀 0). */}
            {overlayImage && (punchDisplay || overlayQuote) ? (
              <OverlayQuoteBlock
                image={overlayImage}
                isMobile={isMobile}
                quote={
                  punchDisplay ? (
                    punchDisplay.editable ? (
                      <EditableResultText
                        copy={copy}
                        onChange={onCopyChange}
                        path={["highlightBox"]}
                        maxLength={30}
                      />
                    ) : (
                      punchDisplay.text
                    )
                  ) : (
                    overlayQuote
                  )
                }
              />
            ) : (
              punchDisplay && (
                <SensoryPunchBlock
                  copy={copy}
                  onCopyChange={onCopyChange}
                  image={imagePlan.punch}
                  isMobile={isMobile}
                  tinted={false}
                  overrideText={punchDisplay.editable ? undefined : punchDisplay.text}
                />
              )
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
                <GalleryBlock
                  images={galleryImages}
                  productName={productName}
                  isMobile={isMobile}
                  noteFor={(id) => photoNoteById.get(id)}
                />
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

            {/* v4.5: 5-1. 제철 캘린더 — 스펙 부근. fruit-facts 품종 매칭 실패/연중 수확이면 미노출. */}
            <SeasonCalendarBlock productName={productName} isMobile={isMobile} />

            {/* v4.8-c: 포토 브레이크 ① — 스펙·제철 캘린더(데이터 표) 클러스터 직후, 텍스트 연속
                구간의 첫 숨통. 사진 여유 없으면(breaks[0] 없음) 조용히 미노출(게이팅). */}
            {imagePlan.breaks[0] && (
              <>
                <DotDivider />
                <PhotoBreakBlock
                  image={imagePlan.breaks[0]}
                  isMobile={isMobile}
                  slot={0}
                  captionFallback={
                    photoNoteById.get(imagePlan.breaks[0].id) ?? PHOTOBREAK_SAFE_CAPTIONS[0]
                  }
                />
              </>
            )}

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
                  isMobile={isMobile}
                  trust={trust}
                />
              </>
            )}

            {/* v4.8-c: 포토 브레이크 ② — 페이지에서 가장 긴 텍스트 연속(수령 타임라인→보관→
                레시피→FAQ→배송·교환환불) 진입 직전. 사진 여유 없으면(breaks[1] 없음) 미노출(게이팅). */}
            {imagePlan.breaks[1] && (
              <>
                <DotDivider />
                <PhotoBreakBlock
                  image={imagePlan.breaks[1]}
                  isMobile={isMobile}
                  slot={1}
                  captionFallback={
                    photoNoteById.get(imagePlan.breaks[1].id) ?? PHOTOBREAK_SAFE_CAPTIONS[1]
                  }
                />
              </>
            )}

            {/* v4.5: 6-1. 수령 후 타임라인 — 보관 섹션 위. fruit-facts storage 없으면 미노출.
                copy.storage(셀러 원문) 유무와 무관하게 fruit-facts storage 매칭 시 노출한다. */}
            <ReceiveTimelineBlock productName={productName} isMobile={isMobile} />

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
            <DeliveryFlowBlock trust={trust} isMobile={isMobile} productName={productName} />

            <DotDivider />

            {/* 9. DELIVERY (정형 텍스트 상세) — 당일 발송 문구는 trust 체크 시에만 */}
            <DeliveryBlock isMobile={isMobile} trust={trust} productName={productName} />

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
              <CtaPill text={ctaTextBottom} isMobile={isMobile} editId="cta.bottom" />
            </div>

            {/* 10. CAUTIONS — 신선식품 면책 박스 자동 표시 (cautions 비어 있어도 노출).
                D17: faq 답변·storage와 정확 일치하는 cautions 항목은 렌더 생략. */}
            <DotDivider />
            <CautionsBlock cautions={copy.cautions ?? []} copy={copy} isMobile={isMobile} />

            {/* v3.8(지시6): 클로징 브랜드 서명 — 잎 라인 아이콘 + 한 줄 + 가는 구분선.
                v5.0-C: brandSnapshot 있으면 로고·스토어명·서명·문의 브랜드 블록 확장. */}
            <ClosingSignature
              productName={productName}
              trust={trust}
              isMobile={isMobile}
              brand={brandSnapshot}
            />
          </div>
            </div>
          </div>
        </div>
      </div>

      {/* Side panel — v2.6: 스크롤 추가 (뷰포트 초과 시 내부 스크롤) */}
      <aside
        className="fdp-no-print"
        style={{
          // v5.4(작업6): 스택 모드에선 아트보드 아래로 자연스럽게 흐르도록 sticky 해제
          // (좁은 화면에서 sticky+내부 스크롤은 다운로드 CTA 접근을 오히려 방해).
          position: isNarrowLayout ? "static" : "sticky",
          top: 20,
          maxHeight: isNarrowLayout ? undefined : "calc(100vh - 40px)",
          overflowY: isNarrowLayout ? "visible" : "auto",
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

        {/* B2(v5.7): 사이드바 3구역 재편 — 검수 결과 / 화면 설정 / JPG로 내보내기.
            다운로드는 내보내기 구역의 sticky 푸터로 항상 노출(사이드바가 자체 스크롤 컨테이너). */}

        {/* ── 구역 1: 검수 결과 (품질·검수·리서치·필수표기) ── */}
        <section style={SIDEBAR_REGION_STYLE}>
          <div style={SIDEBAR_REGION_LABEL_STYLE}>{t.detail.result.sidebar.reviewLabel}</div>

          {/* QualityScoreCard — 카피 종합 점수 + 개선 1순위 1줄(B3) */}
          <QualityScoreCard score={qualityScore} />

          {/* DisclosureBlock — 식약처 자동 검수(위반 있으면 자동 강조). 위반 클릭 → 본문 점프(B3). */}
          <DisclosureBlock report={complianceReport} onJumpToField={handleJumpToField} />

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
        </section>

        {/* ── 구역 2: 화면 설정 (보정 토글 + 전체 재생성) ── */}
        <section
          style={{
            ...SIDEBAR_REGION_STYLE,
            padding: 12,
            background: "var(--color-bg-subtle)",
            borderRadius: RADIUS.card,
          }}
        >
          <div style={SIDEBAR_REGION_LABEL_STYLE}>{t.detail.result.sidebar.screenLabel}</div>

          {/* 사진 자동 보정 */}
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px",
              background: "var(--color-bg-surface)",
              borderRadius: RADIUS.control,
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

          {/* B2: 전체 재생성은 텍스트 버튼으로 강등 + 1회 확인(오클릭·편집손실 방지). */}
          <button
            type="button"
            onClick={handleFullRegen}
            title={t.detail.result.retryFullConfirm}
            style={{
              alignSelf: "flex-start",
              padding: "6px 4px",
              background: "transparent",
              border: "none",
              color: "var(--color-neutral-600)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            ↺ {t.detail.result.retryFull}
          </button>
        </section>

        {/* ── 구역 3: JPG로 내보내기 (옵션 카드 + 다운로드 sticky 푸터) ──
            ExportPanel이 프래그먼트로 [옵션 카드]+[sticky 다운로드]를 형제로 뱉으므로,
            사이드바의 마지막 자식이 되어 다운로드가 스크롤과 무관하게 항상 보인다.
            좁은 스택 레이아웃(isNarrowLayout)에선 sticky 해제 — 페이지 스크롤을 방해하지 않게. */}
        <ExportPanel
          targetRef={captureRef}
          baseName={sanitizedName}
          width={exportWidth}
          stickyDownload={!isNarrowLayout}
          blockedReason={
            copy.headline.trim().length === 0
              ? "카피가 아직 비어 있어요. 3단계에서 카피를 생성(또는 직접 입력)한 뒤 저장해 주세요."
              : mobilePreview != null
                ? "모바일로 확인 중이에요. 저장하려면 위 툴바에서 플랫폼 폭(쿠팡·스토어 등)으로 돌아가 주세요. 지금 저장하면 모바일 글자·여백이 그대로 찍혀요."
                : undefined
          }
        />
      </aside>

      {/* v2.7: StickyMobileCta 삭제 (사이드바에 이미 있으므로 중복 제거) */}
    </div>
    </CropContext.Provider>
    </EditContext.Provider>
    </MotifContext.Provider>
    </LayoutContext.Provider>
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
  const layout = useLayout()
  const name = productName.trim()
  return (
    // 상단 여백 확대: 돔 정점 원(overhang)이 이 섹션 위로 걸치므로 그만큼 비워둔다.
    <div style={{ padding: isMobile ? "52px 24px 48px" : "76px 44px", background: "#FFFFFF" }}>
      <div
        style={{
          background: accent.soft,
          borderRadius: layout.cardRadius,
          border: `1px solid ${accent.soft}`,
          padding: isMobile ? "40px 26px" : "72px 56px",
          textAlign: "center",
        }}
      >
        <h2
          style={{
            fontSize: isMobile ? 30 : 52,
            fontWeight: layout.headingWeight,
            margin: 0,
            marginBottom: isMobile ? 28 : 40,
            lineHeight: 1.2,
            color: INK,
            fontFamily: layout.headingFontFamily,
            letterSpacing: -1.2,
          }}
        >
          <OverrideText
            id="why.title"
            fallback={`WHY ${name || "이 상품"}일까요?`}
            maxLength={40}
            renderDisplay={(v) =>
              v === `WHY ${name || "이 상품"}일까요?` ? (
                <>
                  WHY <span style={{ color: accent.accent }}>{name || "이 상품"}</span>일까요?
                </>
              ) : (
                v
              )
            }
          />
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
  const layout = useLayout()
  const key = detectFruitFactKey(productName)
  const pairings = key ? FRUIT_FACTS[key]?.pairings ?? [] : []
  const items = pairings.slice(0, 3)
  // F(minor): 칩 2개 미만이면 섹션 미노출 (한 칩짜리 빈약한 섹션 방지).
  if (items.length < 2) return null

  const name = productName.trim() || "이 상품"
  return (
    <div style={{ padding: `${padY("flow", isMobile)}px ${isMobile ? 24 : 44}px`, background: "#FFFFFF" }}>
      <div style={{ textAlign: "center", marginBottom: isMobile ? 24 : 40 }}>
        <h2
          style={{
            fontSize: isMobile ? 30 : 50,
            fontWeight: layout.headingWeight,
            margin: 0,
            color: INK,
            fontFamily: layout.headingFontFamily,
            letterSpacing: -1.2,
            lineHeight: 1.15,
          }}
        >
          <OverrideText
            id="recipe.title"
            fallback={`${name} 이렇게 즐겨보세요`}
            maxLength={40}
            renderDisplay={(v) =>
              v === `${name} 이렇게 즐겨보세요` ? (
                <>
                  {name} <span style={{ color: accent.accent }}>이렇게 즐겨보세요</span>
                </>
              ) : (
                v
              )
            }
          />
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

/**
 * v4.9-A soft 히어로 배경 모티프 흩뿌림 — soft 변주에서만, 품종 매칭(kind) 있을 때만.
 * 옅은(opacity 0.08~0.12) 미니 모티프 3개를 "모서리에만" 결정적으로 배치한다.
 *  - Math.random 없음: 위치·회전·크기 전부 고정값(같은 입력 → 같은 결과).
 *  - 음수 오프셋 + 부모 overflow:hidden 으로 모서리 밖은 잘려 코너 워터마크로만 보인다.
 *  - 부모 isolation:isolate 격리 컨텍스트에서 zIndex:-1 → heroBg 위, 텍스트 아래(겹침 회피).
 *  - pointerEvents:none — 편집 클릭 방해 없음.
 */
function HeroMotifScatter({
  kind,
  accent,
  isMobile,
}: {
  kind: string
  accent: AccentPalette
  isMobile: boolean
}) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: -1,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {/* 좌상단 코너 */}
      <div style={{ position: "absolute", top: isMobile ? -14 : -18, left: isMobile ? -12 : -10, transform: "rotate(-14deg)" }}>
        <FruitMotif kind={kind} size={isMobile ? 52 : 82} color={accent.accent} opacity={0.1} />
      </div>
      {/* 우상단 코너(더 작게) */}
      <div style={{ position: "absolute", top: isMobile ? -10 : -14, right: isMobile ? -14 : -14, transform: "rotate(12deg)" }}>
        <FruitMotif kind={kind} size={isMobile ? 36 : 56} color={accent.accent} opacity={0.09} />
      </div>
      {/* 우하단 코너 */}
      <div style={{ position: "absolute", bottom: isMobile ? -16 : -20, right: isMobile ? -8 : -6, transform: "rotate(8deg)" }}>
        <FruitMotif kind={kind} size={isMobile ? 60 : 96} color={accent.accent} opacity={0.11} />
      </div>
    </div>
  )
}

/**
 * v5.0-C 상단 브랜드 라벨 — 아트보드 최상단(히어로 From 배지 위)의 얇은 스토어 서명.
 * 흰 바탕에 중앙 정렬로 소형 로고(원형 클립) + 스토어명(MUTE 톤)만 조용히 얹는다.
 * From 배지(틴트 히어로 안)와는 흰 여백으로 분리돼 시각 충돌이 없다.
 *
 * 게이팅: 로고·스토어명 둘 다 비면 null(아무것도 렌더 안 함). 호출부도 brandSnapshot
 * 존재를 먼저 확인하므로, brandSnapshot 없으면 이 라벨은 DOM 에 아예 나타나지 않는다.
 * 로고는 dataURL img 로만 렌더 — CSS filter/외부 URL 없이 toCanvas 캡처 안전.
 */
function BrandTopLabel({ brand, isMobile }: { brand: BrandSnapshot; isMobile: boolean }) {
  const name = brand.name?.trim()
  const logo = brand.logoDataUrl
  if (!name && !logo) return null
  const dim = isMobile ? 22 : 28
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isMobile ? 8 : 11,
        padding: isMobile ? "16px 24px 6px" : "24px 44px 8px",
        background: "#FFFFFF",
      }}
    >
      {logo && (
        <span
          aria-hidden
          style={{
            width: dim,
            height: dim,
            borderRadius: "50%",
            overflow: "hidden",
            flexShrink: 0,
            display: "inline-flex",
            background: "#FFFFFF",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logo}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        </span>
      )}
      {name && (
        <span
          style={{
            fontFamily: BODY_FONT,
            fontWeight: 700,
            fontSize: isMobile ? 14 : 20,
            color: MUTE,
            letterSpacing: 0.2,
            lineHeight: 1.2,
            wordBreak: "keep-all",
          }}
        >
          {name}
        </span>
      )}
    </div>
  )
}

/**
 * v5.3 히어로 훅 승격용 상품명 정규화 — 공백·기호·구두점을 제거하고 소문자화해
 * "헤드라인이 사실상 상품명인가"를 관대하게 비교한다(예: "달콤 사과!" ≈ "달콤사과").
 * 조사까지 벗기면 오히려 진짜 훅을 상품명으로 오판할 수 있어 여기선 하지 않는다(엄격 비교).
 * 결정적(순수 함수, 랜덤/시간 없음).
 */
function normalizeNameForCompare(s: string): string {
  return s.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase()
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
  const layout = useLayout()
  const motifKind = useMotifKind() // v4.9-A: 품종 매칭 시 모티프 키(없으면 null → 미노출).
  const name = productName.trim()
  const originText = origin?.trim()
  // v4.6: editorial 은 히어로 텍스트 블록만 좌정렬(킥커·배지 정렬도 함께). 그 외 중앙.
  const heroJustify = layout.heroAlign === "left" ? "flex-start" : "center"
  // C12: origin이 "국내산/수입산/해외산"류(특정 지역 아님)면 "From. {origin}" 배지 숨김.
  const showOriginBadge = !!originText && !isGenericOrigin(originText)
  // v5.3 킥커(후킹 캡션): heroKicker(B 에이전트 생성) 우선. 없으면 상품명 없는 완곡 기본 문구로
  // — 첫 화면 상품명 3회 반복(From 배지·캡션·헤드라인) 중 캡션발 중복을 제거한다. 상품명이
  // 없어도(빈 입력) 항상 노출 가능. 편집 슬롯 id는 "hero.caption" 그대로(기존 오버라이드 유지).
  const kickerText = (copy.heroKicker?.trim() || "오늘도 신선하게").trim()
  const showKicker = kickerText.length > 0
  // v5.3 히어로 훅 승격 판정 — 헤드라인이 상품명과 "사실상 동일"(공백·기호 제거 정규화 비교)이고
  // 승격할 훅(subheadline)이 있으면, 훅을 메인 타이포로 올리고 상품명은 From 배지와 묶은 보조
  // 라인으로 강등한다. 헤드라인이 이미 훅 문장이면(정규화 불일치) promoteHook=false → 현행 유지.
  const headlineNorm = normalizeNameForCompare(copy.headline ?? "")
  const nameNorm = normalizeNameForCompare(name)
  const hookText = copy.subheadline?.trim() ?? ""
  const promoteHook = nameNorm.length > 0 && headlineNorm === nameNorm && hookText.length > 0
  return (
    <div style={{ background: "#FFFFFF" }}>
      {/* v2.9: 상단 캡션 + 대형 헤드 (수플린 레퍼런스 — 헤드가 이미지 위) */}
      {/* v4.9-A: position/overflow/isolation 은 soft 흩뿌림(zIndex:-1) 격리용 — 시각적으로
          무해(정적 콘텐츠만 있어 standard 는 픽셀 동일). 흩뿌림은 soft + 모티프 있을 때만. */}
      <div
        style={{
          padding: isMobile ? "44px 24px 30px" : "72px 44px 40px",
          textAlign: layout.heroAlign,
          background: layout.heroBg(accent),
          position: "relative",
          overflow: "hidden",
          isolation: "isolate",
        }}
      >
        {layout.variant === "soft" && motifKind && (
          <HeroMotifScatter kind={motifKind} accent={accent} isMobile={isMobile} />
        )}
        {/* v5.0 위계: From 배지(상단) → 넉넉한 여백 → 킥커(rule 선 동반) → 좁은 간격 → 헤드라인.
            "킥커 위 여백 > 킥커–헤드라인 간격"으로 킥커+헤드라인을 한 쌍으로 묶는다.
            v5.3: 훅 승격 모드에선 From 배지를 상단에 단독으로 두지 않고, 강등된 상품명과
            한 보조 라인으로 묶어 헤드라인(=훅) 아래에 배치한다(중복 정리). */}
        {showOriginBadge && !promoteHook && (
          <div
            style={{
              display: "flex",
              justifyContent: heroJustify,
              marginBottom: showKicker ? (isMobile ? 22 : 34) : isMobile ? 18 : 24,
            }}
          >
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
          </div>
        )}
        {showKicker && (
          <div
            style={{
              display: "flex",
              justifyContent: heroJustify,
              marginBottom: isMobile ? 12 : 18,
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: isMobile ? 10 : 14 }}>
              {/* v4.9-A: 킥커 왼쪽 rule 앞 작은 모티프(킥커 폰트 크기 정도, accent 색).
                  품종 매칭(motifKind) 있을 때만. FruitMotif 는 미지원 kind 면 null(안전). */}
              {motifKind && (
                <FruitMotif kind={motifKind} size={isMobile ? 16 : 24} color={accent.accent} />
              )}
              {/* 좌측 짧은 rule — 디자이너 킥커 디테일 */}
              <span
                aria-hidden
                style={{
                  width: isMobile ? 18 : 30,
                  height: 2,
                  borderRadius: 1,
                  background: accent.accent,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: isMobile ? 14 : 22,
                  color: accent.accent,
                  fontWeight: 800,
                  letterSpacing: isMobile ? 1.5 : 2.5,
                  fontFamily: BODY_FONT,
                  lineHeight: 1.3,
                  wordBreak: "keep-all",
                }}
              >
                <OverrideText id="hero.caption" fallback={kickerText} maxLength={40} />
              </span>
              {/* 우측 짧은 rule */}
              <span
                aria-hidden
                style={{
                  width: isMobile ? 18 : 30,
                  height: 2,
                  borderRadius: 1,
                  background: accent.accent,
                  flexShrink: 0,
                }}
              />
            </span>
          </div>
        )}
        {/* 메인 타이포 — 비승격: 헤드라인(path=["headline"]). 승격: 훅(path=["subheadline"])을
            메인 자리로 올린다. 어느 쪽이든 인라인 편집이 "실제로 올라온 필드"를 고쳐야 한다. */}
        <h1
          style={{
            // v5.3: 훅 승격 시 훅(문장형, maxLength 60)을 상품명 헤드라인 크기(80/48)로 올리면
            // 한 줄을 넘는 훅에서 히어로 높이가 순증한다(제1원칙 위반). 승격 훅은 베이스라인
            // 서브카피와 같은 크기(36/20)·같은 본문 폰트로 렌더해 줄 수를 동일하게 묶고 행간만
            // 촘촘하게(1.35<1.6) 한다 → 상품명 h1(80/48) 제거분에서 강등 상품명 라인(28/17)을
            // 빼도 남는 여유로, 어떤 입력에서도 히어로 높이가 순증하지 않는다. 비승격은 종전 그대로.
            fontSize: promoteHook ? (isMobile ? 20 : 36) : isMobile ? 48 : 80,
            fontWeight: layout.headingWeight,
            margin: 0,
            color: INK,
            lineHeight: promoteHook ? 1.35 : 1.14,
            letterSpacing: promoteHook ? (isMobile ? -0.2 : -0.5) : isMobile ? -1.2 : -2,
            fontFamily: promoteHook ? BODY_FONT : layout.headingFontFamily,
            ...WRAP_BALANCE,
          }}
        >
          <EditableResultText
            copy={copy}
            onChange={onCopyChange}
            path={promoteHook ? ["subheadline"] : ["headline"]}
            maxLength={promoteHook ? 60 : 40}
            placeholder={
              promoteHook
                ? factPlaceholder?.sub ?? "여기에 서브 카피를 적어보세요"
                : factPlaceholder?.headline ?? "여기에 상품 헤드라인을 적어보세요"
            }
            renderDisplay={(v) => renderHeadlineAccent(v, accent.accent)}
          />
        </h1>

        {/* v5.3 승격 모드: 상품명(=headline 필드)을 From 배지와 묶은 보조 라인으로 강등.
            상품명 인라인 편집·후보 칩이 계속 headline 필드를 편집하도록 path=["headline"] 유지. */}
        {promoteHook && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: isMobile ? 8 : 12,
              justifyContent: heroJustify,
              marginTop: isMobile ? 14 : 20,
            }}
          >
            {showOriginBadge && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: isMobile ? "4px 12px" : "6px 16px",
                  borderRadius: 999,
                  background: accent.accent,
                  color: "#FFFFFF",
                  fontSize: isMobile ? 13 : 20,
                  fontWeight: 800,
                  letterSpacing: 0.5,
                  fontFamily: BODY_FONT,
                }}
              >
                From. {originText}
              </span>
            )}
            <span
              style={{
                fontSize: isMobile ? 17 : 28,
                color: SUB,
                fontWeight: 700,
                letterSpacing: -0.3,
                fontFamily: BODY_FONT,
                wordBreak: "keep-all",
              }}
            >
              <EditableResultText
                copy={copy}
                onChange={onCopyChange}
                path={["headline"]}
                maxLength={40}
                placeholder={factPlaceholder?.headline ?? "상품명"}
              />
            </span>
          </div>
        )}

        {/* 헤드라인 후보 칩 — 편집 전용(data-edit-chrome → JPG 캡처 제외). 승격 여부와 무관하게
            항상 headline 필드를 교체한다(승격 시 강등된 상품명 라인을 바꾼다). */}
        <HeadlineCandidateChips
          candidates={headlineCandidates}
          currentHeadline={copy.headline}
          onPick={(next) => onCopyChange({ ...copy, headline: next })}
          onRegenCandidates={onRegenCandidates}
        />
      </div>

      {/* 대표 이미지 — v5.3 네거티브 오버랩: 사진을 타이틀 밴드 하단 여백 위로 살짝 끌어올려
          (marginTop 음수 + zIndex) 타이틀 블록↔사진 사이 밴드 분절감을 없앤다. 겹침이라 총높이는
          오히려 줄어든다(길이 예산). 사진 상단 라운드로 "밴드 위로 솟은 사진 어깨" 연출. 스티커·
          반짝(absolute)은 컨테이너에 overflow 를 걸지 않고 img 자체 라운드로 클립해 잘리지 않게 한다. */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          marginTop: isMobile ? -20 : -28,
          background: layout.heroBg(accent),
        }}
      >
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
        {/* v5.2-A ①: Brix 스티커 주변 반짝(sparkle) — 스티커 아래쪽 결정적 좌표(스티커·텍스트
            비겹침). 품종 매칭(motifKind)일 때만. MotifDecor 미지원 kind면 null(안전). */}
        {brix != null && motifKind && (
          <>
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: isMobile ? 66 : 104,
                right: isMobile ? 16 : 30,
                zIndex: 2,
                display: "inline-flex",
              }}
            >
              {/* v5.3 듀오톤: 히어로 반짝 데코는 보조 그린(잎 톤) — 소면적 장식. */}
              <MotifDecor kind="sparkle" size={isMobile ? 16 : 22} color={accent.secondary} opacity={0.95} />
            </span>
            <span
              aria-hidden
              style={{
                position: "absolute",
                top: isMobile ? 92 : 148,
                right: isMobile ? 56 : 92,
                zIndex: 2,
                display: "inline-flex",
              }}
            >
              <MotifDecor kind="sparkle" size={isMobile ? 15 : 16} color={accent.secondary} opacity={0.8} rotate={16} />
            </span>
          </>
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
              // v5.3 오버랩 연출: 사진 상단 라운드(어깨) — img 자체 클립이라 스티커는 안 잘린다.
              borderTopLeftRadius: isMobile ? 22 : 32,
              borderTopRightRadius: isMobile ? 22 : 32,
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
              borderTopLeftRadius: isMobile ? 22 : 32,
              borderTopRightRadius: isMobile ? 22 : 32,
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
          textAlign: layout.heroAlign,
        }}
      >
        {/* v2.9: 서브카피 — 대문자 액센트 → 설명형 회색 (수플린 톤). 리서치 본문 34px+.
            v5.3: 훅 승격 모드에선 훅이 이미 메인 헤드라인으로 올라가 있어 여기 중복 표기를 생략. */}
        {!promoteHook && (
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
        )}

        {/* CTA pill (수플린 "○○를 선택하세요!" 레퍼런스) — 하단에서 재사용 */}
        <CtaPill text={ctaText} isMobile={isMobile} editId="cta.top" />

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
          // 원본 인덱스를 보존해 편집 경로(highlightBadges[origIdx])가 정확히 꽂히게 한다
          // (origin 중복 제거로 걸러진 뒤 필터 인덱스로 편집하면 엉뚱한 배지를 고치게 됨).
          const heroBadges = copy.highlightBadges
            .map((b, origIdx) => ({ b, origIdx }))
            .filter(({ b }) => !oNorm || b.trim() !== oNorm)
          if (heroBadges.length === 0) return null
          return (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: isMobile ? 8 : 12,
              justifyContent: heroJustify,
              marginTop: isMobile ? 24 : 32,
            }}
          >
            {heroBadges.slice(0, 4).map(({ origIdx }) => (
              <span
                key={`b-${origIdx}`}
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
                <EditableResultText
                  copy={copy}
                  onChange={onCopyChange}
                  path={["highlightBadges", origIdx]}
                  maxLength={20}
                />
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
 *  - 공감 질문 (Pretendard 900, 46~54px 중앙)
 *  - "{n}가지 이유" pill 배지 (accent)
 *  - 문제 카드 세로 스택 — 번호 01/02/03 + 문제 한 줄 (34px).
 *    v5.2-A: photos 로 모든 카드를 채울 수 있으면 좌측 사진(카드 좌측 1/3, 높이 채움 cover)을
 *    붙인 [사진 | 번호+텍스트] 가로 구성으로 렌더한다(키위 레퍼런스). 한 장이라도 없으면 전부
 *    기존 텍스트 카드(혼재 금지). photos 자체가 없으면(분석 없음) 기존과 100% 동일.
 *
 * problemArc가 없으면(구버전 카피) 호출부에서 렌더하지 않는다(게이팅).
 * 지어내는 것 없이 copy.problemArc 원문 그대로 — 스타일만.
 */
function ProblemArcBlock({
  arc,
  photos,
  isMobile,
}: {
  arc: NonNullable<CopyOutput["problemArc"]>
  /** v5.2-A: 문제 카드별 좌측 사진 슬롯(planImages.problemArc). 전 카드 채워질 때만 사진 구성. */
  photos?: (UploadedImage | undefined)[]
  isMobile: boolean
}) {
  const accent = useAccent()
  const layout = useLayout()
  const crop = useCrop() // v5.2-A: 문제 카드 사진 주체 클로즈업(subjectBox 있을 때만).
  const { copy, onCopyChange } = useEdit()
  const problems = arc.problems.slice(0, 3)
  if (problems.length === 0) return null

  // v5.2-A: 사진 구성 게이트 — 렌더되는 모든 카드가 사진을 가질 때만(혼재 금지).
  // v5.3: 사진 슬롯은 더 이상 고정 비율(4/5)로 카드 높이를 정하지 않는다 — 카드 높이는 텍스트가
  // 정하고 사진이 cover 로 채운다(아래 슬롯 참고). 그래서 CARD_PHOTO_RATIO 상수는 제거했다.
  const photoMode = !!photos && problems.every((_, i) => photos[i] != null)

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
        // v5.3 간격 리듬: 챕터 경계(band) 토큰으로 — 기존 112px 균일 대형 패딩을 축소.
        padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 56}px`,
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
            fontWeight: layout.headingWeight,
            margin: 0,
            color: accent.dark,
            lineHeight: 1.24,
            letterSpacing: -1.4,
            fontFamily: layout.headingFontFamily,
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
          <OverrideText
            id="problemArc.reasonsLabel"
            fallback={`${problems.length}가지 이유`}
            maxLength={20}
          />
        </span>
      </div>

      {/* 질문 편집 — 편집 전용(JPG 제외). 위 qLead/qMain 2줄 위계는 이 원문에서 파생된다.
          (StoryBlock·StorageBlock과 동일: 파생 표시 + 원문 편집 진입 분리.) */}
      <div
        data-edit-chrome
        style={{
          maxWidth: 720,
          margin: isMobile ? "16px auto 0" : "24px auto 0",
          padding: isMobile ? "16px 18px" : "22px 28px",
          background: "#FFFFFF",
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
          공감 질문 편집
        </p>
        <p
          style={{
            fontSize: isMobile ? 16 : 22,
            color: INK,
            lineHeight: 1.5,
            margin: 0,
            fontFamily: BODY_FONT,
          }}
        >
          <EditableResultText
            copy={copy}
            onChange={onCopyChange}
            path={["problemArc", "question"]}
            maxLength={80}
          />
        </p>
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
        {problems.map((_p, i) => {
          // v5.2-A: 사진 구성일 때만 좌측 사진. subjectBox 있으면 크롭, 없으면 cover.
          const photo = photoMode ? photos![i] : undefined
          const box = photo ? crop.boxOf(photo) : undefined
          return (
            <div
              key={`pa-${i}`}
              style={{
                display: "flex",
                // 사진 카드: 좌측 사진이 카드 높이를 채우도록 stretch. 텍스트 카드: 기존 center.
                alignItems: photo ? "stretch" : "center",
                gap: photo ? 0 : isMobile ? 16 : 26,
                background: "#FFFFFF",
                border: `1px solid ${LINE}`,
                borderRadius: 14,
                overflow: "hidden", // 사진 모서리를 카드 라운드에 맞춰 클립
                padding: photo ? 0 : isMobile ? "20px 22px" : "32px 40px",
              }}
            >
              {/* 좌측 사진 슬롯 — 카드 좌측 1/3. v5.3: 사진이 고정 비율(4/5)로 카드 높이를 끌던
                  문제(2줄 텍스트가 500px급 사진 높이에 딸려 늘어남)를 없앤다. 이제 카드 높이는
                  우측 텍스트 분량이 정하고, 사진은 그 높이를 cover 로 채운다(alignSelf stretch +
                  height:100%). subjectBox 가 있으면 objectPosition 으로 주체를 프레임 중심에 둔다
                  (없으면 center — 분석 없는 저장본은 안전 폴백). aspectRatio 를 없앴으므로 데드스페이스 0. */}
              {photo && (
                <div
                  style={{
                    flexShrink: 0,
                    width: isMobile ? "34%" : "32%",
                    alignSelf: "stretch",
                    overflow: "hidden",
                    background: accent.soft, // 로드 전/틈 방어
                    lineHeight: 0,
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.url}
                    alt=""
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      objectPosition: box
                        ? `${Math.round((box.x + box.w / 2) * 100)}% ${Math.round((box.y + box.h / 2) * 100)}%`
                        : "center",
                      display: "block",
                    }}
                  />
                </div>
              )}
              {/* 번호 + 문제 텍스트 — 사진 있으면 우측 컬럼(세로 중앙), 없으면 기존 가로 구성. */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: isMobile ? 16 : 26,
                  flex: photo ? 1 : undefined,
                  minWidth: 0,
                  padding: photo ? (isMobile ? "20px 22px" : "28px 34px") : 0,
                }}
              >
                {/* 번호 01/02/03 — accent, Pretendard 900 */}
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    fontSize: isMobile ? 32 : 54,
                    fontWeight: 900,
                    color: accent.accent,
                    fontFamily: DISPLAY_FONT,
                    lineHeight: 1,
                    letterSpacing: -1.5,
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
                  <EditableResultText
                    copy={copy}
                    onChange={onCopyChange}
                    path={["problemArc", "problems", i]}
                    maxLength={40}
                  />
                </span>
              </div>
            </div>
          )
        })}
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
  const motifKind = useMotifKind() // v4.9-A: 대표 섹션(스토리) 리본 옆 모티프(품종 매칭 시만).
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
        // v5.3 간격 리듬: 챕터 경계(band) — 기존 104px 축소.
        padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 56}px`,
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
          {/* v4.9-A: 대표 섹션(스토리) 라벨 옆 초소형 모티프 — 품종 매칭 시만. inline-flex 로
              리본과 한 줄 중앙 정렬(리본 자체 좌우 tail 여백이 간격 역할). */}
          <span style={{ display: "inline-flex", alignItems: "center", verticalAlign: "middle" }}>
            {motifKind && (
              <FruitMotif kind={motifKind} size={isMobile ? 18 : 28} color={accent.accent} />
            )}
            <RibbonLabel text="STORY" accent={accent} isMobile={isMobile} editId="story.ribbon" />
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
              ...WRAP_PRETTY,
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
 * 검정(#1A1A1A) 풀블리드 배경 + 대형 임팩트 카피(Pretendard 900) + 바로 아래 실사진 1장 밀착.
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
  overrideText,
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
  /**
   * v4.x 부정문 안전장치 — highlightBox가 불만형이라 story에서 대체 발췌한 문구.
   * 지정되면 highlightBox(편집 가능) 대신 이 문구를 표시 전용으로 렌더한다(편집은 story 쪽).
   */
  overrideText?: string
}) {
  const accent = useAccent()
  const layout = useLayout()
  const motifKind = useMotifKind() // v5.2-A ③: 임팩트 카피 모서리 반짝(품종 매칭 시만).
  const crop = useCrop() // v5.1-A2: 감각 사진 주체 클로즈업(분석 있을 때만).
  // 틴트 버전: 밝은 배경(veilTint) + INK 헤드 + accent 하이라이트. 검정 버전: 검정 배경 + 밝은 카피.
  const bg = tinted ? veilTint(accent.soft) : PUNCH_BG
  // v5.1-A2: subjectBox 가 있고 비흐림이면 주체 클로즈업, 아니면 기존 cover(불변식).
  const punchBox = crop.boxOf(image)
  const punchRatio = isMobile ? 4 / 3 : 16 / 9
  const copyColor = tinted ? accent.dark : accent.soft
  return (
    <div style={{ background: bg, position: "relative" }}>
      {/* v5.2-A ③: 임팩트 카피 상단 모서리 반짝 1개 — 카피 색(copyColor)으로 배경 대비 확보.
          중앙 카피 위쪽 코너라 텍스트와 비겹침. 품종 매칭 시만. MotifDecor 미지원 kind면 null. */}
      {motifKind && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: isMobile ? 20 : 40,
            right: isMobile ? 20 : 44,
            zIndex: 2,
            display: "inline-flex",
          }}
        >
          <MotifDecor kind="sparkle" size={isMobile ? 18 : 26} color={copyColor} opacity={0.9} />
        </span>
      )}
      {/* 임팩트 카피 — 다크(검정 위 밝은 카피) 또는 틴트(밝은 배경 위 accent.dark). 편집 가능(highlightBox 경로). */}
      <div
        style={{
          // v5.3 간격 리듬: 챕터 경계(band) — 기존 104px 축소.
          padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 56}px`,
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: isMobile ? 40 : 70,
            fontWeight: layout.headingWeight,
            color: tinted ? INK : "#FFFFFF",
            margin: 0,
            lineHeight: 1.18,
            fontFamily: layout.headingFontFamily,
            letterSpacing: -2,
            wordBreak: "keep-all",
            ...WRAP_BALANCE,
          }}
        >
          {overrideText != null ? (
            // 부정문 안전장치로 story에서 발췌한 대체 문구 — 표시 전용(편집은 story 쪽).
            <span style={{ color: copyColor }}>{overrideText}</span>
          ) : (
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
          )}
        </p>
      </div>

      {/* 바로 아래 실사진 1장 — 카피와 한 몸으로 밀착(꽉 찬 폭). 분위기 컷이라 중복 허용.
          v5.1-A2: 주체 박스가 있으면 클로즈업(감각 강조), 없으면 기존 cover. */}
      {image &&
        (punchBox ? (
          <CroppedImage image={image} box={punchBox} slotRatio={punchRatio} />
        ) : (
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
        ))}
    </div>
  )
}

/**
 * v5.1-A2 OverlayQuoteBlock — 와이드 사진 위 스토리 발췌 오버레이 (사진 위 카피 구도).
 *
 * 와이드 사진(whole/farm/table 역할·비저품질·재사용 규칙 준수) 위에 하단 linear-gradient
 * 스크림(rgba 검정 0→0.55)을 깔고, 스토리 발췌(splitStoryHighlight 재사용)를 흰 글씨
 * (Pretendard 800, WRAP_BALANCE)로 얹는다. 사진은 와이드 구도라 크롭하지 않는다(cover).
 *
 * 게이팅(호출부, v5.1.1): 임팩트 블록은 페이지당 하나 — 오버레이가 가능하면(적합 와이드 사진)
 *   다크밴드 슬로건(highlightBox)을 이 블록의 quote 로 승격해 렌더하고 다크밴드는 생략.
 *   슬로건이 없으면 스토리 발췌 폴백. 적합 사진이 없으면 기존 다크밴드 그대로.
 * ★ 불변식: overlayImage 는 subjectBox(신규 분석) 유효 사진만 선정되므로, 분석 없는 경로·
 *   구버전 저장본엔 이 블록이 전혀 나타나지 않는다(기존 렌더 100% 동일).
 *
 * JPG: 최상위 원자 블록 1개(PhotoBreak 와 동일) — 슬라이서가 내부를 자르지 않음. 스크림은
 *   rgba·linear-gradient 만, 카피는 흰 hex — CSS filter/변수/외부URL 없이 toCanvas 안전.
 * quote 는 ReactNode — 슬로건 승격 시 EditableResultText(highlightBox 인라인 편집)가 그대로 들어온다.
 */
function OverlayQuoteBlock({
  image,
  quote,
  isMobile,
}: {
  image: UploadedImage
  quote: React.ReactNode
  isMobile: boolean
}) {
  const layout = useLayout()
  const motifKind = useMotifKind() // v5.2-A ③: 오버레이 임팩트 카피 모서리 반짝(품종 매칭 시만).
  // soft 변주만 살짝 둥근 모서리(PhotoBreak 와 동일 톤), standard/editorial 은 각진 풀블리드.
  const radius = layout.variant === "soft" ? layout.cardRadius : 0
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: isMobile ? "4/3" : "16/9",
        overflow: "hidden",
        background: PUNCH_BG, // 로드 전/틈 방어
        borderRadius: radius,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image.url}
        alt=""
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
      {/* 하단 스크림 — 위 투명 → 아래 rgba 검정 0.55 (JPG 위생: rgba·gradient 안전). */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to bottom, rgba(0,0,0,0) 42%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      {/* 스토리 발췌 — 하단, 흰 글씨 Pretendard 800. 표시 전용(편집은 스토리 편집에서). */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          padding: isMobile ? "0 24px 26px" : "0 56px 48px",
        }}
      >
        {/* v5.2-A ③: 카피 우상단 모서리 반짝 1개(흰색 — 스크림/사진 위 대비). 텍스트 위쪽이라 비겹침. */}
        {motifKind && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: isMobile ? -8 : -14,
              right: isMobile ? 24 : 56,
              display: "inline-flex",
            }}
          >
            <MotifDecor kind="sparkle" size={isMobile ? 18 : 24} color="#FFFFFF" opacity={0.9} />
          </span>
        )}
        <p
          style={{
            margin: 0,
            color: "#FFFFFF",
            fontFamily: BODY_FONT,
            fontWeight: 800,
            fontSize: isMobile ? 26 : 46,
            lineHeight: 1.28,
            letterSpacing: -1,
            wordBreak: "keep-all",
            ...WRAP_BALANCE,
          }}
        >
          {quote}
        </p>
      </div>
    </div>
  )
}

/**
 * v4.4 사진 캡션(visibleNote) 알약 클램프 — 최대 24자(캡션 슬롯 편집 상한과 일치).
 * 24자 초과면 마지막 공백에서 끊어 단어를 자르지 않게 하고, 적당한 공백이 없으면 그대로 절단.
 * 관찰 메모(≤60자)를 알약 캡션에 넣어도 overflow:hidden 에 잘리지 않도록 표시용으로만 축약.
 */
function clampCaptionNote(note: string, max = 24): string {
  const t = note.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const sp = cut.lastIndexOf(" ")
  // 공백이 너무 앞이면(절반 미만) 그냥 max 에서 절단.
  return (sp >= Math.floor(max / 2) ? cut.slice(0, sp) : cut).trim()
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
  noteFor,
}: {
  images: UploadedImage[]
  productName: string
  isMobile: boolean
  /**
   * v4.4: imageId → 캡션 폴백(visibleNote, 이미 24자 클램프됨). 있으면 그 사진의 캡션
   * 기본 문구로 쓰고, 없으면 기존 중립 안전 문구로 폴백. 슬롯 id 는 바뀌지 않는다.
   */
  noteFor?: (id: string) => string | undefined
}) {
  // v3.8(지시1): 풀폭↔2그리드 모자이크. buildGalleryRows가 배치·캡션 배정을 결정.
  const rows = useMemo(() => buildGalleryRows(images), [images])
  // v5.1-A2: 2그리드 셀은 주체 크롭(클로즈업), 풀폭 행은 와이드(크롭 없음) → 거리감 교차 리듬.
  const crop = useCrop()

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
                    // v4.x: 캡션 알약 크기 상향("너무 작아" 실물 피드백). 폰트·패딩 비례 확대.
                    padding: isMobile ? "9px 20px" : "12px 26px",
                    fontSize: isMobile ? 16 : 26,
                    fontWeight: 700,
                    fontFamily: BODY_FONT,
                    letterSpacing: -0.3,
                    borderRadius: 999,
                    wordBreak: "keep-all",
                  }}
                >
                  <OverrideText
                    id={`gallery.caption.${row.captionIdx}`}
                    // v4.4: 이 사진의 visibleNote(관찰 메모)가 있으면 기본 캡션으로 사용,
                    // 없으면 기존 중립 안전 문구. 슬롯 id 는 그대로 — 하위호환/편집 유지.
                    fallback={noteFor?.(row.img.id) ?? caption}
                    maxLength={24}
                  />
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
              // v5.1-A2: 2그리드 셀은 주체 크롭. subjectBox 없거나 흐리면 기존 1:1 cover(불변식).
              const box = crop.boxOf(img)
              return (
                <div
                  key={img.id}
                  style={{
                    background: "#FFFFFF",
                    borderRadius: 6,
                    overflow: "hidden",
                  }}
                >
                  {box ? (
                    <CroppedImage image={img} box={box} slotRatio={1} alt={`${productName} ${altSeq}`} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
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
                  )}
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
 * v4.8-c 포토 브레이크 캡션용 중립 안전 문구 — GALLERY_SAFE_CAPTIONS와 같은 성격(사실 주장
 * 금지: 산지·당도·수확·신선도·인증 없음). 갤러리 캡션(idx 0·1)과 겹치지 않게 별도 문구를 쓴다.
 * 슬롯별 기본값이며, 사진의 visibleNote(관찰 메모, 이미 안전 필터·클램프됨)가 있으면 그쪽이 우선.
 */
const PHOTOBREAK_SAFE_CAPTIONS = ["보기 좋게 준비했어요", "정성을 담아 보내드려요"]

/**
 * v4.8-c 포토 브레이크 — 텍스트가 길게 이어지는 중후반 구간을 끊어 주는 풀블리드 사진 1장.
 *
 * 목적(실사용자 피드백): 스펙·제철 캘린더·타임라인·보관·FAQ가 텍스트로 연속되던 구간에 사진을
 * 적재적소에 끼워 "몰빵" 인상을 완화한다. 사진 여유가 없으면 planImages가 breaks를 안 주므로
 * 호출부에서 섹션 자체가 렌더되지 않는다(게이팅).
 *
 * 레이아웃:
 *  - 가로 100% 풀블리드. 높이는 사진 원본 비율을 따르되 아트보드 폭 × 0.75(세로/가로 0.75 = 4:3)를
 *    상한, 폭 × 0.5(2:1)를 하한으로 클램프한다. 상·하한 밖 사진은 objectFit cover로 크롭(레터박스 없음).
 *    손상 저장본(width/height ≤ 0) 방어: 상한 비율(4:3)로 폴백.
 *  - 좌하단 반투명 잉크 알약 캡션(갤러리 풀폭 캡션 스타일 재사용, rgba·hex만 → JPG 위생 안전).
 *  - v4.6 토큰 소비: soft 변주만 살짝 둥근 모서리(포근한 톤), standard/editorial은 각진 풀블리드.
 *    배경은 accent.soft(이미지 로드 전/틈 방어) — 전 변주에서 자연스럽게 착지.
 *
 * JPG 분할: 최상위 원자 블록 1개(갤러리 풀폭 행과 동일) — 슬라이서가 내부를 자르지 않으므로
 *   data-slice-glue 불필요(html-to-jpg.ts E20 컨벤션). 상한(폭×0.75)이 목표 슬라이스(3000px)보다
 *   훨씬 작아 경계 반토막 위험 없음.
 */
function PhotoBreakBlock({
  image,
  isMobile,
  slot,
  captionFallback,
}: {
  image: UploadedImage
  isMobile: boolean
  /** 캡션 편집 슬롯 번호 — id는 photobreak.caption.{slot}. 페이지 등장 순서와 일치(위=0, 아래=1). */
  slot: 0 | 1
  captionFallback: string
}) {
  const accent = useAccent()
  const layout = useLayout()
  // 원본 비율(세로/가로). 손상 저장본(0·음수) 방어 → 상한 0.75.
  const ratioHW =
    image.width > 0 && image.height > 0 ? image.height / image.width : 0.75
  // 상한 0.75(4:3)·하한 0.5(2:1)로 클램프 → 이 밖의 사진은 cover 크롭.
  const boxRatioHW = Math.min(0.75, Math.max(0.5, ratioHW))
  const radius = layout.variant === "soft" ? layout.cardRadius : 0
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: 1 / boxRatioHW, // W/H
        overflow: "hidden",
        background: accent.soft,
        borderRadius: radius,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
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
      {/* 좌하단 반투명 알약 캡션 — 갤러리 풀폭 캡션과 동일 스타일. */}
      <div
        style={{
          position: "absolute",
          left: 16,
          bottom: 16,
          background: "rgba(33,37,41,0.62)",
          color: "#FFFFFF",
          padding: isMobile ? "9px 20px" : "12px 26px",
          fontSize: isMobile ? 16 : 26,
          fontWeight: 700,
          fontFamily: BODY_FONT,
          letterSpacing: -0.3,
          borderRadius: 999,
          wordBreak: "keep-all",
        }}
      >
        <OverrideText
          id={`photobreak.caption.${slot}`}
          fallback={captionFallback}
          maxLength={24}
        />
      </div>
    </div>
  )
}

/**
 * v4.5 당도 범위 비교 바 — 기존 BrixScaleBar를 품종 일반 범위 비교로 확장·통합.
 *
 * 품종 일반 brixMin~brixMax(getBrixRange, 출하 기준)를 accent.soft 밴드로 깔고, 그 위에
 * "이 상품" 입력 brix 마커 + "일반적인 맛 기준(참고)" goodBrix 눈금을 얹는다.
 * - 입력 brix 없으면(brix=null) 마커 없이 범위 밴드만.
 * - 품종 범위 없으면(getBrixRange=null) 블록 미노출.
 * brixScale 캡션 문구·OverrideText 슬롯(brix.goodLabel/brix.caption)·"우리 {brix}" 문구를
 * 그대로 유지해 하위호환(구버전 저장본의 오버라이드가 계속 적용). "비파괴 측정" 등 근거 없는
 * 문구는 넣지 않는다. 품종 일반 데이터라 캡션에 개체차 안내 유지.
 */
function BrixRangeBlock({
  productName,
  brix,
  goodBrix,
  isMobile,
}: {
  productName: string
  /** 입력에서 추출한 당도(사실 데이터). 없으면 null → 범위 밴드만. */
  brix: number | null
  goodBrix: number
  isMobile: boolean
}) {
  const accent = useAccent()
  const motifKind = useMotifKind() // v5.2-A ②: "우리 N" 마커 지시 화살표(품종 매칭 시만).
  const bs = t.detail.result.brixScale
  const range = getBrixRange(productName)
  if (!range) return null // 품종 범위 없으면 미노출

  // 도메인 — 밴드(min~max)·goodBrix·입력 brix를 모두 담고 양끝에 약간 여유(1).
  const lo = Math.max(0, Math.min(range.min, goodBrix, brix ?? Infinity) - 1)
  const hi = Math.max(range.max, goodBrix, brix ?? -Infinity) + 1
  const span = hi - lo
  const pct = (v: number) => (span > 0 ? Math.min(100, Math.max(0, ((v - lo) / span) * 100)) : 0)

  const minPct = pct(range.min)
  const maxPct = pct(range.max)
  const goodPct = pct(goodBrix)
  const brixPct = brix != null ? pct(brix) : null

  return (
    <div style={{ marginTop: isMobile ? 16 : 22 }}>
      {/* "우리 {brix}" 마커 라벨 — 입력 brix 있을 때만 */}
      <div style={{ position: "relative", height: isMobile ? 28 : 40, marginBottom: isMobile ? 6 : 8 }}>
        {brixPct != null && (
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
        )}
        {/* v5.2-A ②: "우리 N" 마커를 가리키는 손그림 곡선 화살표(accent). 품종 매칭 시만.
            라벨 우측(마커가 우측 끝이면 좌측)에 배치해 텍스트와 비겹침. MotifDecor 미지원 kind면 null. */}
        {brixPct != null && motifKind && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              left: `${brixPct}%`,
              top: -2,
              // "우리 N" 라벨(중앙정렬)을 좌/우로 비켜 배치 — 텍스트와 비겹침.
              transform: `translateX(${brixPct <= 78 ? (isMobile ? 28 : 48) : -(isMobile ? 52 : 76)}px)`,
              display: "inline-flex",
            }}
          >
            {/* arrow 기본 조준각 ≈46°(우하단). 회전 후 조준=46+rotate.
                우측 배치(≤78)→좌향 필요: 135→181°(서). 좌측 배치(>78)→우향 필요: -45→1°(동). */}
            <MotifDecor
              kind="arrow"
              size={isMobile ? 22 : 28}
              color={accent.accent}
              opacity={0.95}
              rotate={brixPct <= 78 ? 135 : -45}
            />
          </span>
        )}
      </div>

      {/* v5.2-A 작업2: 당도 구간 라벨 3단 — 맛 기준선(goodPct)·품종 최대(maxPct)를 경계로
          보통/높음/매우 높음. 옅은 경계 눈금과 함께. 경계가 정상 순서일 때만(창작 수치 없음).
          각 라벨은 구간 폭이 충분할 때만 노출(좁으면 생략) — 결정적. */}
      {goodPct < maxPct && (
        <div style={{ position: "relative", height: isMobile ? 16 : 22, marginBottom: isMobile ? 4 : 6 }}>
          {/* 경계 눈금(옅은) — goodPct·maxPct */}
          <span
            aria-hidden
            style={{ position: "absolute", left: `${goodPct}%`, top: 0, bottom: 0, width: 1, background: LINE }}
          />
          <span
            aria-hidden
            style={{ position: "absolute", left: `${maxPct}%`, top: 0, bottom: 0, width: 1, background: LINE }}
          />
          {goodPct >= 10 && (
            <span
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                fontSize: isMobile ? 10 : 16,
                fontWeight: 700,
                color: MUTE,
                fontFamily: BODY_FONT,
                letterSpacing: -0.2,
                whiteSpace: "nowrap",
              }}
            >
              {bs.zones.normal}
            </span>
          )}
          {maxPct - goodPct >= 14 && (
            <span
              style={{
                position: "absolute",
                left: `${(goodPct + maxPct) / 2}%`,
                transform: "translateX(-50%)",
                top: 0,
                fontSize: isMobile ? 10 : 16,
                fontWeight: 800,
                color: accent.dark,
                fontFamily: BODY_FONT,
                letterSpacing: -0.2,
                whiteSpace: "nowrap",
              }}
            >
              {bs.zones.high}
            </span>
          )}
          {100 - maxPct >= 10 && (
            <span
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                fontSize: isMobile ? 10 : 16,
                fontWeight: 800,
                color: accent.accent,
                fontFamily: BODY_FONT,
                letterSpacing: -0.2,
                whiteSpace: "nowrap",
              }}
            >
              {bs.zones.veryHigh}
            </span>
          )}
        </div>
      )}

      {/* 트랙 */}
      <div
        style={{
          position: "relative",
          height: isMobile ? 10 : 14,
          background: "#E9ECEF",
          borderRadius: 999,
        }}
      >
        {/* 품종 일반 범위(min~max) 밴드 */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: `${minPct}%`,
            width: `${Math.max(0, maxPct - minPct)}%`,
            top: 0,
            bottom: 0,
            background: accent.soft,
            borderRadius: 999,
          }}
        />
        {/* goodBrix 참고 눈금 */}
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
        {/* 이 상품 brix 마커 (accent 원) — 입력 brix 있을 때만 */}
        {brixPct != null && (
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
        )}
      </div>

      {/* 밴드 양끝 숫자 (품종 범위 min~max) */}
      <div style={{ position: "relative", height: isMobile ? 20 : 28, marginTop: isMobile ? 6 : 8 }}>
        <span
          style={{
            position: "absolute",
            left: `${minPct}%`,
            transform: "translateX(-50%)",
            fontSize: isMobile ? 12 : 20,
            fontWeight: 800,
            color: accent.dark,
            fontFamily: BODY_FONT,
          }}
        >
          {range.min}
        </span>
        <span
          style={{
            position: "absolute",
            left: `${maxPct}%`,
            transform: "translateX(-50%)",
            fontSize: isMobile ? 12 : 20,
            fontWeight: 800,
            color: accent.dark,
            fontFamily: BODY_FONT,
          }}
        >
          {range.max}
        </span>
      </div>

      {/* 범례 — 품종 일반 범위 밴드 + goodBrix 참고 눈금(brix.goodLabel 슬롯 유지) */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: isMobile ? "6px 16px" : "8px 28px",
          marginTop: isMobile ? 6 : 10,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: isMobile ? 5 : 8,
            fontSize: isMobile ? 11 : 18,
            color: SUB,
            fontWeight: 600,
            fontFamily: BODY_FONT,
          }}
        >
          <span
            aria-hidden
            style={{
              width: isMobile ? 16 : 24,
              height: isMobile ? 10 : 14,
              borderRadius: 4,
              background: accent.soft,
              flexShrink: 0,
            }}
          />
          {bs.varietyRange}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: isMobile ? 5 : 8,
            fontSize: isMobile ? 11 : 18,
            color: SUB,
            fontWeight: 600,
            fontFamily: BODY_FONT,
          }}
        >
          <span
            aria-hidden
            style={{
              width: isMobile ? 3 : 4,
              height: isMobile ? 14 : 20,
              borderRadius: 2,
              background: MUTE,
              flexShrink: 0,
            }}
          />
          <span>
            <OverrideText id="brix.goodLabel" fallback={bs.good} maxLength={30} /> {goodBrix}
          </span>
        </span>
      </div>

      {/* 하단 캡션 — 품종 일반 정보 참고, 개체차 있음(brix.caption 슬롯 유지). */}
      <div
        style={{
          marginTop: isMobile ? 6 : 10,
          fontSize: isMobile ? 8 : 12,
          color: MUTE,
          fontFamily: BODY_FONT,
          lineHeight: 1.4,
        }}
      >
        <OverrideText id="brix.caption" fallback={bs.caption} maxLength={60} />
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
          <span>
            <EditableResultText
              copy={copy}
              onChange={onCopyChange}
              path={["spec", i, "label"]}
              maxLength={30}
              renderDisplay={renderNoBreakParens}
            />
          </span>
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
                  <span style={{ fontSize: isMobile ? 60 : 100, fontWeight: 900, letterSpacing: -3 }}>
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
                  <BrixRangeBlock
                    productName={productName}
                    brix={brixValue}
                    goodBrix={brixFact.goodBrix}
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
                  renderDisplay={renderNoBreakParens}
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
        padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 44}px`,
        background: veilTint(accent.soft),
      }}
    >
      <SectionTitle title={t.detail.result.spec} regen={onRegen} isMobile={isMobile} editId="sect.spec.title" overline="SPEC" editOverlineId="sect.spec.overline" />

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

/**
 * v4.5 제철 캘린더 — fruit-facts 품종 harvestMonths 기반 12개월 가로 바.
 *
 * 수확월을 accent로 채우고, 절대 정보인 계절 라벨(1~12월)만 표기한다(현재 달과 무관 →
 * Date 의존 없음 = 결정적, JPG 안전). 전부 인라인 div — 외부 이미지·CSS filter 없음.
 * 게이팅: getHarvestMonths 가 빈 배열(품종 매칭 실패)이거나 12개월 전부(연중 수확 = 제철
 * 대비 없음)면 미노출. 품종 일반 데이터라 "품종 기준" 각주 필수. 스펙 부근 배치.
 */
function SeasonCalendarBlock({
  productName,
  isMobile,
}: {
  productName: string
  isMobile: boolean
}) {
  const accent = useAccent()
  const layout = useLayout()
  const sc = t.detail.result.seasonCalendar
  const months = useMemo(() => getHarvestMonths(productName), [productName])
  // 수확월이 하나도 없거나(매칭 실패) 12개월 전부면(연중, 제철 대비 없음) 미노출.
  if (months.length === 0 || months.length >= 12) return null
  const harvestSet = new Set(months)

  return (
    <>
      <DotDivider />
      <div style={{ padding: `${padY("flow", isMobile)}px ${isMobile ? 24 : 44}px`, background: "#FFFFFF" }}>
        <SectionTitle title={sc.title} isMobile={isMobile} editId="sect.season.title" overline="SEASON" editOverlineId="sect.season.overline" />
        <div
          style={{
            border: `1px solid ${accent.soft}`,
            borderRadius: layout.cardRadius,
            padding: isMobile ? "24px 16px" : "44px 40px",
            background: "#FFFFFF",
          }}
        >
          {/* 12개월 가로 바 — 각 셀은 수확월이면 accent 채움 */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: isMobile ? 3 : 6 }}>
            {Array.from({ length: 12 }, (_, i) => {
              const month = i + 1
              const on = harvestSet.has(month)
              return (
                <div
                  key={`season-${month}`}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: isMobile ? 6 : 10,
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      height: isMobile ? 36 : 60,
                      borderRadius: isMobile ? 6 : 10,
                      background: on ? accent.accent : "#EEF1F4",
                    }}
                  />
                  <span
                    style={{
                      fontSize: isMobile ? 9 : 17,
                      fontWeight: on ? 900 : 600,
                      color: on ? accent.dark : MUTE,
                      fontFamily: on ? DISPLAY_FONT : BODY_FONT,
                      lineHeight: 1,
                      whiteSpace: "nowrap",
                      letterSpacing: -0.5,
                    }}
                  >
                    {month}월
                  </span>
                </div>
              )
            })}
          </div>
          {/* 범례 */}
          <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 10, marginTop: isMobile ? 16 : 24 }}>
            <span
              aria-hidden
              style={{
                width: isMobile ? 14 : 20,
                height: isMobile ? 14 : 20,
                borderRadius: 5,
                background: accent.accent,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: isMobile ? 12 : 20, fontWeight: 800, color: INK, fontFamily: BODY_FONT }}>
              <OverrideText id="season.harvestLabel" fallback={sc.harvestLabel} maxLength={20} />
            </span>
          </div>
          {/* 각주 — 품종 기준 필수 (구어체) */}
          <p
            style={{
              margin: isMobile ? "10px 0 0" : "14px 0 0",
              fontSize: isMobile ? 11 : 15,
              color: MUTE,
              lineHeight: 1.5,
              fontFamily: BODY_FONT,
            }}
          >
            <OverrideText id="season.footnote" fallback={sc.footnote} maxLength={60} />
          </p>
        </div>
      </div>
    </>
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
  const layout = useLayout()
  const motifKind = useMotifKind() // v4.9-A: 대표 섹션 오버라인 모티프(품종 매칭 시만).
  const crop = useCrop() // v5.1-A2: POINT 컷 사진 주체 클로즈업(분석 있을 때만).
  return (
    <div style={{ background: "#FFFFFF" }}>
      <div
        style={{
          // v5.3 간격 리듬: 챕터 경계(band) 상단 + 압축된 하단(다음 POINT 카드와 한 묶음).
          padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 44}px ${isMobile ? 24 : 40}px`,
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
            <OverrideText id="keypoints.bridge" fallback="그래서 이렇게 준비했어요" maxLength={30} />
          </p>
        )}
        {/* v3.8 fix(진단 #2): 대제목 영문 오버라인 라벨 — WHY(원형 엠블럼)·REVIEW(SectionTitle
            overline)와 톤을 맞춰 POINT 를 얹는다. 위 한글 문구는 problemArc 서사 브리지라
            별개(오버라인이 아니었음). SectionTitle hero overline 과 동일 스타일(작은 accent,
            자간 2)을 인라인으로 재현 — 이 섹션은 SectionTitle 를 안 쓰므로 직접 렌더. */}
        {/* v4.9-A: 대표 섹션(keyPoints 헤드) 오버라인 옆 초소형 모티프 — 품종 매칭 시만. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 6 : 9,
            justifyContent: "center", // 헤더가 textAlign:center → 오버라인 행도 중앙 유지.
            fontSize: isMobile ? 13 : 22,
            color: accent.accent,
            fontWeight: 800,
            letterSpacing: 2,
            marginBottom: isMobile ? 8 : 12,
            fontFamily: BODY_FONT,
          }}
        >
          {motifKind && (
            <FruitMotif kind={motifKind} size={isMobile ? 15 : 22} color={accent.accent} />
          )}
          <OverrideText id="keypoints.overline" fallback="POINT" maxLength={24} />
        </div>
        {/* 임무D: 섹션 헤드 — 히어로급 임팩트 (모바일 42 / 데스크톱 76) */}
        <h2
          style={{
            fontSize: isMobile ? 40 : 72,
            fontWeight: layout.headingWeight,
            margin: 0,
            color: INK,
            lineHeight: 1.12,
            fontFamily: layout.headingFontFamily,
            letterSpacing: -2,
            ...WRAP_BALANCE,
          }}
        >
          <OverrideText
            id="sect.keypoints.title"
            fallback={t.detail.result.keyPointsSectionTitle
              .replace("{noun}", noun)
              .replace("{josa}", subjectJosa(noun))}
            maxLength={40}
          />
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
                fontSize: isMobile ? 32 : 54,
                fontWeight: layout.headingWeight,
                margin: 0,
                marginBottom: isMobile ? 22 : 28,
                color: INK,
                lineHeight: 1.2,
                fontFamily: layout.headingFontFamily,
                letterSpacing: -1.5,
                position: "relative",
                zIndex: 1,
                ...WRAP_BALANCE,
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
                ...WRAP_PRETTY,
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
        // v5.1-A2: cut 역할이거나 dnaFavorsCut 이고 주체 박스가 있으면(비흐림) 주체 클로즈업.
        //   아니면 기존 objectFit cover(불변식). 슬롯 비율은 지그재그 4:5 / 스택 1:1 유지.
        const kpBox = crop.boxOf(img)
        const kpWantCrop =
          !!kpBox && (crop.roleOf(img) === "cut" || crop.dnaFavorsCut)
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
              {kpWantCrop && kpBox ? (
                <CroppedImage image={img} box={kpBox} slotRatio={zigzag ? 4 / 5 : 1} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
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
              )}
            </div>
          </div>
        ) : null

        return (
          <div
            key={`kp-big-${i}`}
            style={{
              position: "relative",
              // v5.3 간격 리듬: POINT 카드 과대 세로 패딩(88/104) 압축 — 카드당 ~70px 절감.
              padding: isMobile ? "36px 24px 40px" : "56px 56px 64px",
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
  const layout = useLayout()
  // v3.4(지시7): storage 원문을 STEP 01/02/03 세로 타임라인으로 재구성.
  // 편집은 아래 EditableResultText(편집 전용 chrome)에서 그대로 하고,
  // JPG에는 원문에서 파생한 STEP 타임라인 카드만 찍힌다 (StoryBlock과 동일한 방식).
  const steps = useMemo(() => splitStorageSteps(copy.storage), [copy.storage])

  return (
    <div
      style={{
        padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 44}px`,
        background: "#FFFFFF",
      }}
    >
      <SectionTitle title={t.detail.result.storage} regen={onRegen} isMobile={isMobile} editId="sect.storage.title" overline="GUIDE" editOverlineId="sect.storage.overline" />

      {steps.length > 0 && (
        <div
          style={{
            border: `1px solid ${accent.soft}`,
            borderRadius: layout.cardRadius,
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
                      fontWeight: 900,
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
                      // v5.3 듀오톤: 보관 타임라인 점은 보조 그린 링(줄기 톤) — 소면적 장식.
                      border: `${isMobile ? 3 : 4}px solid ${accent.secondary}`,
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

/**
 * v4.5 수령 후 타임라인 — fruit-facts storage(mode/days/tempC) 기반 가로 3~4스텝.
 *
 * D+0 수령 → (모드별) 보관 방법 → 권장 소비 시점을 가로 타임라인으로 보여준다.
 * 전부 인라인 div/SVG(LineIcons) — 외부 이미지·CSS filter 없음. 뮤트 accent + Pretendard 900.
 * 게이팅: getStorageInfo 가 null(품종 매칭 실패)이면 미노출. 보관 섹션(StorageBlock) 위 배치.
 * 사실성: 문구는 mode/days/tempC(검증된 fruit-facts)에서만 파생 — 없는 수치는 넣지 않는다.
 *  - fridge: days=냉장 보관 기간 → "약 {days}일 안에". room: days 의미가 mode마다 달라 주입 안 함.
 *  - ripen-then-fridge: days=실온 후숙 기간 → "실온에 {days}일쯤". 품종·환경 편차 각주 필수.
 */
function ReceiveTimelineBlock({
  productName,
  isMobile,
}: {
  productName: string
  isMobile: boolean
}) {
  const accent = useAccent()
  const layout = useLayout()
  const rt = t.detail.result.receiveTimeline
  const storage = getStorageInfo(productName)
  if (!storage) return null

  const days = storage.days && storage.days > 0 ? storage.days : null
  const temp = storage.tempC != null ? storage.tempC : null

  type TLStep = {
    label: string
    desc: string
    Icon: (p: LineIconProps) => React.JSX.Element
    badge?: string
  }

  const receive: TLStep = { label: rt.receiveLabel, desc: rt.receiveDesc, Icon: DeliverIcon, badge: "D+0" }
  let steps: TLStep[]
  if (storage.mode === "ripen-then-fridge") {
    // 받으면 → 실온 후숙(days) → 냉장 보관 → 완숙 후 소비.
    steps = [
      receive,
      {
        label: rt.ripenLabel,
        desc: days ? rt.ripenDesc.replace("{days}", `${days}`) : rt.ripenNoDaysDesc,
        Icon: HarvestIcon,
      },
      { label: rt.thenFridgeLabel, desc: rt.thenFridgeDesc, Icon: ColdIcon },
      { label: rt.enjoyRipeLabel, desc: rt.enjoyRipeDesc, Icon: BrixIcon },
    ]
  } else if (storage.mode === "room") {
    // 받으면 → 실온 보관 → 신선할 때 소비/가공. (room 모드 days 의미가 균일화·가공 등이라 미주입)
    // 생식 부적합(가공 전용, 예: 매실)이면 "드세요"(생식 권유) 대신 가공 안내로 게이트.
    // fruit-facts.rawEdible === false 를 단일 진실원으로 삼아 cautions '생식 X'와 정합.
    const lastStep: TLStep = isRawEdible(productName)
      ? { label: rt.enjoySoonLabel, desc: rt.enjoySoonDesc, Icon: BrixIcon }
      : { label: rt.useSoonLabel, desc: rt.useSoonDesc, Icon: LeafIcon }
    steps = [
      receive,
      { label: rt.roomLabel, desc: rt.roomDesc, Icon: PackIcon },
      lastStep,
    ]
  } else {
    // fridge: 받으면 → 바로 냉장(tempC) → 약 days일 안에.
    steps = [
      receive,
      {
        label: rt.fridgeLabel,
        desc: temp != null ? rt.fridgeTempDesc.replace("{temp}", `${temp}`) : rt.fridgeDesc,
        Icon: ColdIcon,
      },
      {
        label: rt.enjoyLabel,
        desc: days ? rt.enjoyDaysDesc.replace("{days}", `${days}`) : rt.enjoyNoDaysDesc,
        Icon: BrixIcon,
      },
    ]
  }

  const n = steps.length
  const circle = isMobile ? 44 : 68
  const lineH = isMobile ? 2 : 3
  const badgeRowH = isMobile ? 16 : 24

  return (
    <>
      <DotDivider />
      <div style={{ padding: `${padY("flow", isMobile)}px ${isMobile ? 24 : 44}px`, background: veilTint(accent.soft) }}>
        <SectionTitle title={rt.title} isMobile={isMobile} editId="sect.receive.title" overline="TIMELINE" editOverlineId="sect.receive.overline" />
        <div
          style={{
            background: "#FFFFFF",
            border: `1px solid ${accent.soft}`,
            borderRadius: layout.cardRadius,
            padding: isMobile ? "28px 14px" : "52px 40px",
          }}
        >
          <div style={{ position: "relative" }}>
            {/* 노드 뒤 연결선 — 첫/마지막 원 중심 사이(열 등폭이라 좌우 반칸 inset). 흰 원이 가려 사이만 보인다. */}
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: `${50 / n}%`,
                right: `${50 / n}%`,
                top: circle / 2 - lineH / 2,
                height: lineH,
                background: accent.soft,
              }}
            />
            <div style={{ display: "flex" }}>
              {steps.map((st, i) => {
                const Icon = st.Icon
                return (
                  <div
                    key={`rt-${i}`}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      minWidth: 0,
                    }}
                  >
                    {/* 노드 원 (흰 배경 + accent 링) */}
                    <div
                      style={{
                        width: circle,
                        height: circle,
                        borderRadius: "50%",
                        background: "#FFFFFF",
                        // v5.3 듀오톤: 수령 타임라인 노드 링도 보조 그린(줄기 톤)으로 통일.
                        border: `${isMobile ? 2 : 3}px solid ${accent.secondary}`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        position: "relative",
                        zIndex: 1,
                        flexShrink: 0,
                      }}
                    >
                      <Icon color={accent.accent} size={isMobile ? 22 : 34} />
                    </div>
                    {/* 배지 슬롯 — 고정 높이로 노드별 라벨 수평 정렬 유지(D+0은 수령 노드만). */}
                    <div
                      style={{
                        height: badgeRowH,
                        marginTop: isMobile ? 6 : 10,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {st.badge && (
                        <span
                          style={{
                            fontSize: isMobile ? 11 : 18,
                            fontWeight: 900,
                            color: accent.accent,
                            fontFamily: DISPLAY_FONT,
                            letterSpacing: -0.5,
                            lineHeight: 1,
                          }}
                        >
                          {st.badge}
                        </span>
                      )}
                    </div>
                    {/* 라벨 */}
                    <span
                      style={{
                        fontSize: isMobile ? 13 : 22,
                        fontWeight: 900,
                        color: accent.dark,
                        fontFamily: DISPLAY_FONT,
                        letterSpacing: -0.5,
                        lineHeight: 1.2,
                        textAlign: "center",
                        wordBreak: "keep-all",
                      }}
                    >
                      {st.label}
                    </span>
                    {/* 설명 */}
                    <span
                      style={{
                        marginTop: isMobile ? 4 : 8,
                        fontSize: isMobile ? 11 : 18,
                        fontWeight: 500,
                        color: SUB,
                        fontFamily: BODY_FONT,
                        lineHeight: 1.4,
                        textAlign: "center",
                        wordBreak: "keep-all",
                        padding: isMobile ? "0 2px" : "0 6px",
                      }}
                    >
                      {st.desc}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
          {/* 각주 — 품종·보관 환경 편차 (구어체) */}
          <p
            style={{
              margin: isMobile ? "20px 0 0" : "32px 0 0",
              fontSize: isMobile ? 11 : 15,
              color: MUTE,
              lineHeight: 1.5,
              fontFamily: BODY_FONT,
            }}
          >
            <OverrideText id="receive.footnote" fallback={rt.footnote} maxLength={60} />
          </p>
        </div>
      </div>
    </>
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
  const accent = useAccent()
  const layout = useLayout()
  return (
    <div
      style={{
        padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 44}px`,
        background: layout.altSectionBg(accent),
      }}
    >
      <SectionTitle title={t.detail.result.faq} regen={onRegen} isMobile={isMobile} editId="sect.faq.title" overline="FAQ" editOverlineId="sect.faq.overline" />
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
  const layout = useLayout()
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
      <div style={{ padding: `${padY("flow", isMobile)}px ${isMobile ? 24 : 44}px`, background: "#FFFFFF" }}>
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
              fontWeight: layout.headingWeight,
              margin: 0,
              color: INK,
              fontFamily: layout.headingFontFamily,
              letterSpacing: -1.2,
              lineHeight: 1.1,
            }}
          >
            <OverrideText
              id="size.title"
              fallback={`${name} 크기가 궁금해요`}
              maxLength={40}
              renderDisplay={(v) =>
                v === `${name} 크기가 궁금해요` ? (
                  <>
                    {name} 크기가 <span style={{ color: accent.accent }}>궁금해요</span>
                  </>
                ) : (
                  v
                )
              }
            />
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
                <OverrideText id="size.weightLabel" fallback="중량" maxLength={16} /> · {renderNoBreakParens(weight.trim())}
              </div>
            )}
            {perPieceLabel && (
              <div style={{ fontSize: isMobile ? 18 : 30, color: SUB, fontFamily: BODY_FONT, fontWeight: 600 }}>
                {renderNoBreakParens(perPieceLabel)}
              </div>
            )}
            {boxCountLabel && (
              <div style={{ fontSize: isMobile ? 18 : 32, color: accent.dark, fontFamily: BODY_FONT, fontWeight: 800 }}>
                {renderNoBreakParens(boxCountLabel)}
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
            <strong style={{ color: INK }}>
              <OverrideText id="size.confirmLabel" fallback="꼭 확인해 주세요" maxLength={24} />
            </strong>
            <br />
            <OverrideText
              id="size.deviation"
              fallback={
                boxCountLabel
                  ? sr.deviation.replace("{noun}", noun)
                  : sr.deviationSize.replace("{noun}", noun)
              }
              multiline
              maxLength={200}
            />
          </div>
        )}
      </div>
    </>
  )
}

/**
 * v5.3(작업6): 붙박이 배송 문구를 과일 보관 성격(getDeliveryPersona)으로 결정적 변주.
 *
 * 반환값은 OverrideText의 fallback으로만 쓰인다 — 슬롯 id는 그대로라 셀러가 이미 덮어쓴
 * 저장본은 오버라이드가 계속 이긴다. 사전에 없는(판별 불가) 품목은 default 분기로 현행
 * 기본 문구를 그대로 반환해 구버전 저장본 회귀 0. 사실(산지·당도·수확일) 창작 없이 표현만 다르다.
 */
function deliveryCopyVariant(productName: string): {
  flowStep4Desc: string
  bodyFallback: string
} {
  switch (getDeliveryPersona(productName)) {
    case "ripen":
      // 후숙형(복숭아·자두·멜론·키위 등) — 단단하게 도착하는 성격.
      return {
        flowStep4Desc: "단단한 상태 그대로 완충 포장해 문 앞까지",
        bodyFallback:
          "주문 확인 후 단단한 상태로 정성껏 준비해, 영업일 기준 빠르게 발송해 드려요.\n\n완충 포장으로 문 앞까지 안전하게 도착하며, 도서·산간 지역은 1~2일 정도 더 걸릴 수 있어요.",
      }
    case "chill":
      // 즉시냉장형(딸기·사과·포도·감귤 등) — 받는 즉시 냉장 권장 성격.
      return {
        flowStep4Desc: "신선함 지켜 냉장하기 좋게 문 앞까지",
        bodyFallback:
          "주문 확인 후 가장 신선한 상태로 준비해, 영업일 기준 빠르게 발송해 드려요.\n\n받으신 뒤 바로 냉장 보관하시면 신선함이 오래가요. 도서·산간 지역은 1~2일 정도 더 걸릴 수 있어요.",
      }
    case "room":
      // 실온형(매실 등) — 실온에서도 견디는 성격.
      return {
        flowStep4Desc: "실온에서도 튼튼하게 완충 포장해 문 앞까지",
        bodyFallback:
          "주문 확인 후 정성껏 준비해, 영업일 기준 빠르게 발송해 드려요.\n\n완충 포장으로 문 앞까지 도착하며, 도서·산간 지역은 1~2일 정도 더 걸릴 수 있어요.",
      }
    default:
      // 판별 불가(fruit-facts 미등록) — 현행 기본 문구 그대로(회귀 0).
      return {
        flowStep4Desc: "완충 포장으로 신선하게 문 앞까지",
        bodyFallback: t.detail.result.deliveryBody,
      }
  }
}

/**
 * v2.8 신선함을 잇는 4단계 (수플린 FARM→AIR→COLD→HOME 레퍼런스).
 * 국내 산지직송에 맞게 각색: 수확 → 손 선별·포장 → 출고 → 문 앞 도착.
 *
 * v2.8-b: "당일 수확 / 당일 포장 / 콜드체인" 은 셀러가 trust에서 실제 체크한 경우에만 강한 문구로.
 * 미체크 시 일반화 문구 — 다른 신뢰 요소(TrustBadgesRow 등)와 동일한 게이팅 원칙 준수 (허위광고 방지).
 * v5.3(작업6): 4단계 마지막 스텝 문구를 과일 보관 성격으로 변주(productName 필요).
 */
function DeliveryFlowBlock({
  trust,
  isMobile,
  productName,
}: {
  trust?: TrustInfo
  isMobile: boolean
  productName: string
}) {
  const accent = useAccent()
  const layout = useLayout()
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
    // v5.3(작업6): 마지막 스텝 desc를 과일 보관 성격으로 변주(default는 현행 문구 그대로).
    { title: "문 앞 도착", desc: deliveryCopyVariant(productName).flowStep4Desc },
  ]
  return (
    <div style={{ padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 44}px`, background: veilTint(accent.soft) }}>
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
          <OverrideText id="flow.overline" fallback="산지에서 문 앞까지" maxLength={24} />
        </div>
        <h2
          style={{
            fontSize: isMobile ? 34 : 60,
            fontWeight: layout.headingWeight,
            margin: 0,
            color: INK,
            fontFamily: layout.headingFontFamily,
            letterSpacing: -1.5,
            lineHeight: 1.1,
          }}
        >
          <OverrideText
            id="flow.title"
            fallback="신선함을 잇는 4단계"
            maxLength={30}
            renderDisplay={(v) =>
              v === "신선함을 잇는 4단계" ? (
                <>
                  신선함을 잇는 <span style={{ color: accent.accent }}>4단계</span>
                </>
              ) : (
                v
              )
            }
          />
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
                <OverrideText id={`flow.step${i + 1}.title`} fallback={step.title} maxLength={20} />
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
                <OverrideText id={`flow.step${i + 1}.desc`} fallback={step.desc} maxLength={40} />
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
  const layout = useLayout()
  return (
    <div style={{ padding: `${padY("flow", isMobile)}px ${isMobile ? 24 : 44}px`, background: "#FFFFFF" }}>
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
          <OverrideText id="package.overline" fallback="PACKAGE" maxLength={24} />
        </div>
        <h2
          style={{
            fontSize: isMobile ? 30 : 52,
            fontWeight: layout.headingWeight,
            margin: 0,
            color: INK,
            fontFamily: layout.headingFontFamily,
            letterSpacing: -1.5,
            lineHeight: 1.15,
          }}
        >
          <OverrideText
            id="package.title"
            fallback="배송 시 이렇게 구성돼요"
            maxLength={30}
            renderDisplay={(v) =>
              v === "배송 시 이렇게 구성돼요" ? (
                <>
                  배송 시 이렇게 <span style={{ color: accent.accent }}>구성돼요</span>
                </>
              ) : (
                v
              )
            }
          />
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
              <OverrideText id="package.weightLabel" fallback="중량" maxLength={16} />
            </span>
            <span style={{ fontSize: isMobile ? 18 : 30, fontWeight: 700, color: INK, fontFamily: BODY_FONT }}>
              {renderNoBreakParens(weight.trim())}
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
            <OverrideText id="package.packLabel" fallback="포장" maxLength={16} />
          </span>
          <span style={{ fontSize: isMobile ? 18 : 30, color: SUB, lineHeight: 1.6, fontFamily: BODY_FONT }}>
            <OverrideText
              id="package.packBody"
              fallback="완충재로 흔들림 없이 담아, 신선한 상태 그대로 보내드려요."
              multiline
              maxLength={120}
            />
          </span>
        </div>
      </div>
    </div>
  )
}

function DeliveryBlock({
  isMobile,
  trust,
  productName,
}: {
  isMobile: boolean
  trust?: TrustInfo
  productName: string
}) {
  // 허위광고 방지: "당일 발송" 확정 약속은 셀러가 sameDayHarvest를 체크한 경우에만 노출.
  const sameDay = !!trust?.sameDayHarvest
  // v5.3(작업6): 배송 안내 문단 fallback을 과일 보관 성격으로 변주(슬롯 id는 그대로).
  const deliveryBodyFallback = deliveryCopyVariant(productName).bodyFallback
  return (
    <div
      style={{
        // v3.8(지시4): 약관류 3연속(배송/교환환불/주의)은 상하 패딩을 48px로 묶어 클러스터링.
        padding: isMobile ? "32px 24px" : "48px 44px",
        background: "#FFFFFF",
      }}
    >
      {/* v3.8(지시3): 배송 안내는 약관류 — quiet 위계(작고 SUB 색). */}
      <SectionTitle title={t.detail.result.deliveryTitle} variant="quiet" isMobile={isMobile} editId="sect.delivery.title" overline="DELIVERY" editOverlineId="sect.delivery.overline" />
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
          <OverrideText
            id="delivery.body"
            fallback={deliveryBodyFallback}
            multiline
            preserveWhitespace
            maxLength={400}
          />
          {sameDay && (
            <>
              {" "}
              <OverrideText
                id="delivery.sameDayNote"
                fallback={t.detail.result.deliverySameDayNote}
                multiline
                maxLength={200}
              />
            </>
          )}
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
  const layout = useLayout()
  const { copy, onCopyChange } = useEdit()
  return (
    <div
      style={{
        padding: `${padY("flow", isMobile)}px ${isMobile ? 24 : 44}px`,
        background: layout.altSectionBg(accent),
      }}
    >
      <SectionTitle title={t.detail.result.recommendForTitle} isMobile={isMobile} editId="sect.recommend.title" overline="FOR YOU" editOverlineId="sect.recommend.overline" />
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
        {items.slice(0, 6).map((_it, i) => (
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
            <span style={{ fontWeight: 600 }}>
              <EditableResultText
                copy={copy}
                onChange={onCopyChange}
                path={["recommendFor", i]}
                maxLength={60}
              />
            </span>
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
 * 각 카드: (별점 있으면) 별 아이콘 + 후기 본문 + highlight가 본문에 포함되면
 * 그 부분만 accent 배경 형광펜으로 강조. highlight가 본문에 없으면 강조 없이 본문만.
 * v5.3(작업3): 별점/작성자/옵션은 셀러가 입력한 것만 표기 — 미입력 필드는 렌더 생략(지어내기 방지).
 */

/**
 * v5.3(작업3): 후기 별점 — 인라인 SVG 별(JPG 위생 준수). 채운 별 rating개 + 나머지 빈 별.
 * rating이 없으면 호출부에서 렌더하지 않는다(자동 채움·기본 별점 금지).
 */
function ReviewStars({ rating, size }: { rating: number; size: number }) {
  const full = Math.max(0, Math.min(5, Math.round(rating)))
  const STAR_PATH =
    "M10 1.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L10 14.77l-5.2 2.74.99-5.79L1.58 7.62l5.82-.85z"
  return (
    <div style={{ display: "flex", gap: 2 }} aria-label={`별점 ${full}점`}>
      {[0, 1, 2, 3, 4].map((idx) => (
        <svg key={idx} width={size} height={size} viewBox="0 0 20 20" aria-hidden>
          <path d={STAR_PATH} fill={idx < full ? "#FFB400" : "#E3E6EA"} />
        </svg>
      ))}
    </div>
  )
}

function ReviewsBlock({
  reviews,
  isMobile,
}: {
  reviews: SellerReview[]
  isMobile: boolean
}) {
  const accent = useAccent()
  // v3.8(지시4): 후기 진입은 전환점. v5.3: 과대 세로 패딩(100/80)을 챕터 경계(band) 상단 +
  // 압축 하단으로 줄인다(길이 예산). 후기는 여전히 별도 챕터감 유지.
  return (
    <div style={{ padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 44}px ${isMobile ? 40 : 56}px`, background: veilTint(accent.soft) }}>
      {/* v3.8(지시3): 후기는 전환점 — hero 위계 + REVIEW 오버라인. */}
      <SectionTitle title={t.detail.result.reviews.title} variant="hero" overline="REVIEW" isMobile={isMobile} editId="sect.reviews.title" editOverlineId="sect.reviews.overline" />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          // v5.3: 카드 간 간격 압축(발췌 콜아웃이 흐름 내 배치라 과대 간격 불필요).
          gap: isMobile ? 20 : 28,
        }}
      >
        {reviews.map((r, i) => {
          // A1(장치 단일화): 인라인 형광펜 제거 — 본문은 강조 없는 평문.
          // highlight가 본문에 실제 포함될 때만 발췌 콜아웃을 카드 "본문 흐름 내"
          // (하단, 살짝 회전)에 배치한다. absolute 겹침 폐기 — 본문을 절대 가리지 않는다.
          const hi = r.highlight?.trim()
          const showPull = !!hi && r.text.includes(hi)
          const tilt = i % 2 === 0 ? "rotate(-1.5deg)" : "rotate(1.5deg)"
          // v5.3(작업3): 작성자·옵션 메타 라인 — 입력된 것만 "김**님 · 3kg 구매" 형식으로.
          const metaParts: string[] = []
          if (r.author) metaParts.push(`${r.author}님`)
          if (r.optionLabel) metaParts.push(`${r.optionLabel} 구매`)
          const meta = metaParts.join(" · ")
          return (
            <div
              key={`review-${i}`}
              style={{
                background: "#FFFFFF",
                borderRadius: 16,
                border: `1px solid ${accent.soft}`,
                boxShadow: `0 4px 16px ${accent.accent}10`,
                // v5.3: 카드 내부 과대 패딩 압축(가독성 하한은 본문 폰트로 유지).
                padding: isMobile ? "22px 22px" : "32px 40px",
                display: "flex",
                flexDirection: "column",
                gap: isMobile ? 12 : 16,
              }}
            >
              {/* v5.3(작업3): 별점 — 셀러가 입력한 rating이 있을 때만(자동 채움 금지). */}
              {r.rating != null && (
                <ReviewStars rating={r.rating} size={isMobile ? 18 : 24} />
              )}
              {/* 후기 본문 — 강조 없는 평문(A1: 인라인 형광펜 제거). */}
              <p
                style={{
                  // v5.3(작업3): 본문 타이포 한 단계 압축(34→30/20→19) — 길이 단축 기여.
                  fontSize: isMobile ? 19 : 30,
                  color: INK,
                  // v5.3: 행간도 한 단계 압축(1.5→1.45) — 가독성 하한 유지.
                  lineHeight: 1.45,
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

              {/* v5.3(작업3): 작성자·옵션 메타 — 입력된 것만. 셋 다 없으면 이 라인 자체가 없다(회귀 0). */}
              {meta && (
                <div
                  style={{
                    fontSize: isMobile ? 14 : 22,
                    color: MUTE,
                    fontFamily: BODY_FONT,
                    fontWeight: 600,
                    letterSpacing: -0.2,
                    wordBreak: "keep-all",
                  }}
                >
                  {meta}
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
  isMobile,
  trust,
}: {
  isMobile: boolean
  trust?: TrustInfo
}) {
  const accent = useAccent()
  const layout = useLayout()
  const { copy, onCopyChange } = useEdit()
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
        padding: `${padY("band", isMobile)}px ${isMobile ? 24 : 44}px`,
        background: layout.altSectionBg(accent),
      }}
    >
      <SectionTitle title={t.detail.result.farmStoryTitle} isMobile={isMobile} editId="sect.farm.title" overline="FARM" editOverlineId="sect.farm.overline" />

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
              <EditableResultText
                copy={copy}
                onChange={onCopyChange}
                path={["farmStory"]}
                multiline
                maxLength={500}
                preserveWhitespace
                placeholder="농가 한 마디를 적어보세요"
              />
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
      <SectionTitle title={t.detail.result.returnsTitle} variant="quiet" isMobile={isMobile} editId="sect.returns.title" overline="POLICY" editOverlineId="sect.returns.overline" />
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
          <OverrideText
            id="returns.body"
            fallback={body}
            multiline
            preserveWhitespace
            maxLength={400}
          />
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
  const { onCopyChange } = useEdit()
  // D17: cautions 항목이 faq 답변(a) 또는 storage와 트림 기준 정확 일치하면 렌더 생략.
  const dupeSet = new Set<string>()
  if (copy.storage?.trim()) dupeSet.add(copy.storage.trim())
  for (const f of copy.faq ?? []) {
    if (f.a?.trim()) dupeSet.add(f.a.trim())
  }
  // 원본 인덱스 보존 — dedupe 필터 뒤 인덱스로 편집하면 엉뚱한 항목을 고치게 됨.
  const shownCautions = cautions
    .map((c, origIdx) => ({ c, origIdx }))
    .filter(({ c }) => c.trim() && !dupeSet.has(c.trim()))
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
          <OverrideText
            id="cautions.notice"
            fallback={t.detail.result.cautionsAutoNotice}
            multiline
            maxLength={200}
          />
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
              <OverrideText id="sect.cautions.title" fallback={t.detail.result.cautionsTitle} maxLength={40} />
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
              {shownCautions.map(({ origIdx }) => (
                <li
                  key={`c-${origIdx}`}
                  style={{
                    fontSize: isMobile ? 18 : 30,
                    color: SUB,
                    lineHeight: 1.7,
                    fontFamily: BODY_FONT,
                  }}
                >
                  <EditableResultText
                    copy={copy}
                    onChange={onCopyChange}
                    path={["cautions", origIdx]}
                    maxLength={100}
                  />
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
 *
 * v5.0-C: brand(BrandSnapshot) 가 있으면 기존 마무리 아래에 브랜드 푸터를 확장한다 —
 * 로고(dataURL img) · 스토어명(대표색 뱃지) · 서명 문구(사람 말투 그대로) · 문의 안내.
 * 대표색(brand.color)은 이 블록의 포인트 라인/스토어명 뱃지에만 쓰고 accent 팔레트는
 * 건드리지 않는다(기획 원칙). color 없거나 형식 부적합이면 accent 사용. brand 없으면
 * 아래 확장은 렌더되지 않아 기존 클로징과 100% 동일(게이팅 불변식).
 */
function ClosingSignature({
  productName,
  trust,
  isMobile,
  brand,
}: {
  productName: string
  trust?: TrustInfo
  isMobile: boolean
  brand?: BrandSnapshot | null
}) {
  const accent = useAccent()
  const motifKind = useMotifKind() // v4.9-A: 클로징 서명 옆 모티프(품종 매칭 시만).
  const producer = trust?.producerName?.trim()
  const name = productName.trim()
  // 서명 — 농가명 우선, 없으면 상품명, 둘 다 없으면 서명 줄 생략.
  const signature = producer ? `${producer} 농가 드림` : name ? `${name} 드림` : null
  // v5.0-C 브랜드 확장 값(전부 옵셔널). brand 없으면 아래 블록 자체가 안 그려진다.
  const brandName = brand?.name?.trim()
  const brandLogo = brand?.logoDataUrl
  const brandSig = brand?.signature?.trim()
  const brandContact = brand?.contact?.trim()
  // 대표색은 6자리 hex 일 때만 채택(알파 합성 안전) — 아니면 accent 로 폴백. 팔레트는 불변.
  const rawBrandColor = brand?.color?.trim()
  const brandColor =
    rawBrandColor && /^#[0-9a-fA-F]{6}$/.test(rawBrandColor) ? rawBrandColor : null
  const pointColor = brandColor ?? accent.accent
  const hasBrandBlock = !!(brandName || brandLogo || brandSig || brandContact)
  const brandLogoDim = isMobile ? 44 : 56
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
      {/* 잎 라인 아이콘 (+ v4.9-A 클로징 서명 옆 과일 모티프 — 품종 매칭 시만) */}
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: isMobile ? 10 : 16, marginBottom: isMobile ? 14 : 20 }}>
        {motifKind && (
          <FruitMotif kind={motifKind} size={isMobile ? 30 : 46} color={accent.accent} />
        )}
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
        <OverrideText
          id="closing.note"
          fallback="정성껏 골라 담았습니다. 맛있게 드세요."
          maxLength={60}
        />
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
      {/* v5.0-C 브랜드 푸터 확장 — brand 있을 때만. 대표색은 포인트 라인·스토어명 뱃지에만. */}
      {hasBrandBlock && (
        <div style={{ marginTop: isMobile ? 30 : 44 }}>
          {/* 포인트 라인 — 대표색(없으면 accent). 이 블록에서 대표색을 쓰는 유일한 라인. */}
          <div
            aria-hidden
            style={{
              width: isMobile ? 30 : 44,
              height: 2,
              background: pointColor,
              borderRadius: 2,
              margin: isMobile ? "0 auto 18px" : "0 auto 24px",
            }}
          />
          {brandLogo && (
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: isMobile ? 12 : 16,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: brandLogoDim,
                  height: brandLogoDim,
                  borderRadius: "50%",
                  overflow: "hidden",
                  display: "inline-flex",
                  flexShrink: 0,
                  background: "#FFFFFF",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={brandLogo}
                  alt=""
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
              </span>
            </div>
          )}
          {brandName && (
            <div style={{ display: "flex", justifyContent: "center" }}>
              {/* 스토어명 뱃지 — 대표색 옅은 틴트 배경(8% 알파) + 진한 잉크 글씨(대비 안전). */}
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: isMobile ? "6px 16px" : "9px 22px",
                  borderRadius: 999,
                  background: `${pointColor}14`,
                  color: accent.dark,
                  fontFamily: BODY_FONT,
                  fontWeight: 800,
                  fontSize: isMobile ? 16 : 24,
                  letterSpacing: 0.2,
                  lineHeight: 1.3,
                  wordBreak: "keep-all",
                }}
              >
                {brandName}
              </span>
            </div>
          )}
          {brandSig && (
            <p
              style={{
                fontSize: isMobile ? 15 : 22,
                color: SUB,
                fontWeight: 500,
                fontFamily: BODY_FONT,
                lineHeight: 1.6,
                margin: isMobile ? "12px 0 0" : "16px 0 0",
                letterSpacing: -0.2,
                wordBreak: "keep-all",
                ...WRAP_PRETTY,
              }}
            >
              {brandSig}
            </p>
          )}
          {brandContact && (
            <p
              style={{
                fontSize: isMobile ? 12 : 16,
                color: MUTE,
                fontWeight: 500,
                fontFamily: BODY_FONT,
                lineHeight: 1.5,
                margin: isMobile ? "10px 0 0" : "12px 0 0",
                wordBreak: "keep-all",
              }}
            >
              {brandContact}
            </p>
          )}
        </div>
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
  editId,
  editOverlineId,
}: {
  title: string
  regen?: React.ReactNode
  /** 폰 미리보기(≤414)면 축소 스케일. 미지정 시 데스크톱(이미지 매체) 크기. */
  isMobile?: boolean
  /** v3.8: 3단 위계 — hero(전환점)/main(콘텐츠)/quiet(약관류). 미지정 시 main. */
  variant?: SectionTitleVariant
  /** v3.8: hero 변주에서만 노출하는 오버라인 영문 라벨(예: REVIEW). */
  overline?: string
  /** v4.0: 섹션 제목 인라인 편집 키. 있으면 title을 OverrideText로 감싼다(고정 문구 편집). */
  editId?: string
  /** v4.0: 오버라인 라벨 인라인 편집 키. hero 변주에서 overline과 함께 있을 때만. */
  editOverlineId?: string
}) {
  const accent = useAccent()
  const layout = useLayout()
  // 크기·색 — 데스크톱 기준 hero 60 / main 46 / quiet 34. 모바일은 각 톤에 맞춰 축소.
  const fontSize =
    variant === "hero" ? (isMobile ? 34 : 60) : variant === "quiet" ? (isMobile ? 21 : 34) : (isMobile ? 27 : 46)
  const color = variant === "quiet" ? SUB : INK
  // v5.3: 오버라인 락업을 hero/main variant로 확장(STORY/POINT/REVIEW 톤을 상품정보·보관·
  // FAQ·추천 등 bare heading 섹션에도 적용). hero 는 기존 큰 오버라인(불변식: 회귀 0), main 은
  // 작은 락업 오버라인. quiet(약관류 — 배송·교환환불)는 "조용한 위계"가 의도라 accent 오버라인을
  // 얹지 않는다(리뷰 지적: 굵은 오버라인이 quiet 강등을 되살림). 미지정 호출은 기존 렌더와 동일.
  const showOverline = !!overline?.trim() && variant !== "quiet"
  const isHeroOverline = variant === "hero"
  const overlineFontSize = isHeroOverline ? (isMobile ? 13 : 22) : (isMobile ? 12 : 16)
  const overlineMb = isHeroOverline ? (isMobile ? 8 : 12) : (isMobile ? 4 : 7)
  // v4.6: editorial 은 여백 1.15배(정수라 ×1은 항등) + 제목 위 얇은 구분선(배경 교차 대신).
  // v5.3 높이 순증 금지: 비-hero 오버라인 추가분은 제목 하단 여백에서 흡수(순증 0에 근접).
  const overlineAbsorb = showOverline && !isHeroOverline ? (isMobile ? 16 : 26) : 0
  const marginBottom = Math.max(
    isMobile ? 12 : 16,
    Math.round((isMobile ? 24 : 36) * layout.spacingScale) - overlineAbsorb,
  )
  return (
    <>
      {layout.showRule && (
        <div
          aria-hidden
          style={{
            height: 2,
            background: layout.ruleColor(accent),
            borderRadius: 1,
            marginBottom: isMobile ? 16 : 24,
          }}
        />
      )}
    <div
      style={{
        display: "flex",
        alignItems: showOverline ? "flex-end" : "center",
        justifyContent: "space-between",
        marginBottom,
      }}
    >
      <div>
        {/* 오버라인 영문 라벨 — 대문자 락업(작은 accent, 넓은 자간). hero 는 큰 톤,
            그 외 bare heading 섹션은 작은 락업 톤(STORY/POINT/REVIEW와 시각 통일). */}
        {showOverline && (
          <div
            style={{
              fontSize: overlineFontSize,
              color: accent.accent,
              fontWeight: 800,
              letterSpacing: 2,
              marginBottom: overlineMb,
              fontFamily: BODY_FONT,
            }}
          >
            {editOverlineId ? (
              <OverrideText id={editOverlineId} fallback={overline!} maxLength={24} />
            ) : (
              overline
            )}
          </div>
        )}
        <h2
          style={{
            fontSize,
            fontWeight: layout.headingWeight,
            color,
            margin: 0,
            lineHeight: 1.08,
            fontFamily: layout.headingFontFamily,
            letterSpacing: -1,
            ...WRAP_BALANCE,
          }}
        >
          {editId ? <OverrideText id={editId} fallback={title} maxLength={40} /> : title}
        </h2>
      </div>
      {regen}
    </div>
    </>
  )
}
// B2(v5.7): ActionButton(전체폭 채움 버튼) 제거 — 사이드바 재편으로 "다시 만들기"가
// 텍스트 버튼(handleFullRegen)으로 강등되며 유일 사용처가 사라졌다.
