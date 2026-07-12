/**
 * 과일별 축색(accent) 시스템 — v2.8.
 *
 * 상세페이지의 포인트 컬러를 과일의 잘 익은 색에 맞춰 자동 전환.
 * 수플린 아보카도 레퍼런스처럼 "과일 색과 페이지 톤이 자연스럽게 맞물리는" 효과.
 *
 * 색은 도메인(hallucination 방지 fact 사전)이 아닌 프레젠테이션 관심사라
 * fruit-facts.ts와 분리. productName → detectFruitFactKey → 팔레트 매핑.
 *
 * 각 팔레트 4색:
 * - accent:    메인 포인트 (헤드 강조, POINT 뱃지, CTA)
 * - dark:      진한 변형 (텍스트 대비, 그림자)
 * - soft:      옅은 배경 틴트 (블록 배경 변주)
 * - secondary: v5.3 듀오톤 보조색 — 과일의 잎·꼭지·줄기에서 온 뮤트 그린.
 *   소면적 장식(체크·물결 밑줄·타임라인 점·데코)에서만 accent 대신 쓴다.
 *   대면적 배경·본문 타이포에는 절대 쓰지 않는다(듀오톤 위생).
 */

import { detectFruitFactKey } from "@/domain/fruit-facts"

export interface AccentPalette {
  accent: string
  dark: string
  soft: string
  /** v5.3 듀오톤 보조색(잎·줄기 그린 계열, 뮤트). 소면적 장식 전용. */
  secondary: string
  /**
   * v6.5 히어로 배경 수직 그라데이션(위→아래) [top, bottom]. soft 파생의 아주 옅은 명도차.
   * 레이아웃·높이 무관 — 색만. 테마 과일에만 존재(미매칭=undefined → 단색 폴백 불변).
   */
  heroGrad?: [string, string]
  /**
   * v6.5 다크 펀치 밴드·클로징용 과일 딥 톤(자두=와인, 복숭아=로즈 브라운, 감귤=선셋 등).
   * 흰 글씨 대비 4.5:1 이상(어두운 톤이라 자연 충족 — 수치 검증 완료). 테마 과일에만.
   */
  punchDeep?: string
  /**
   * v6.5 체크칩·페어링 칩·stat 셀 배경 틴트(soft보다 반 단계 진한 파생 = mixHex(soft, accent, 0.13)).
   * 테마 과일에만 존재(미매칭=undefined → 기존 soft/흰색 폴백 불변).
   */
  chipTint?: string
}

// v2.9 디자이너 뮤트 톤 — 형광기 제거(채도 ↓ + 웜 시프트). 실물 레퍼런스(peach-s02)의
// 더스티 로즈 블러시처럼 "사람 디자이너가 고른" 차분한 톤. accent엔 흰 글씨 배지가 올라가
// 므로 흰색 대비를 이전 버전 이상으로 유지(RED/PURPLE ≥ 4.5:1). 웜 계열(주황/골드/복숭아)은
// 색상 자체가 밝아 흰색 4.5:1이 물리적으로 불가 → 이전 버전과 동등 이상 대비로 맞춤(회귀 없음).
// v5.3 secondary(듀오톤 보조색): 각 과일의 잎·꼭지·줄기 그린을 뮤트 톤으로 큐레이션.
// accent 계열과 색상이 겹치지 않게(특히 GREEN 계열은 accent 그린과 명도·색상으로 구분),
// 흰 바탕 소면적 장식에서 또렷이 보이는 중명도 그린으로 맞췄다(형광기 없음).
const RED: AccentPalette = { accent: "#D13F37", dark: "#B93A34", soft: "#FBF1EE", secondary: "#6E9459" }
const ORANGE: AccentPalette = { accent: "#DB6129", dark: "#C55524", soft: "#FCF3EA", secondary: "#4F7E58" }
const GOLD: AccentPalette = { accent: "#D59527", dark: "#C08420", soft: "#FBF6E8", secondary: "#7C8A46" }
const PURPLE: AccentPalette = { accent: "#7A5FBF", dark: "#64489F", soft: "#F5F2FB", secondary: "#6B8E4E" }
const GREEN: AccentPalette = { accent: "#3F9155", dark: "#337946", soft: "#EFF7F0", secondary: "#5B7A3C" }
const PEACH: AccentPalette = { accent: "#DF7484", dark: "#C75F6E", soft: "#FBF0EE", secondary: "#6C9557" }

/**
 * 브랜드 기본값 (미매칭 과일·야채). 기존 빨강 유지 — **테마 필드 없음(bare)**.
 * ★ 폴백 불변식: DEFAULT_ACCENT 는 RED(bare) 를 가리키므로 heroGrad/punchDeep/chipTint 가
 *   전부 undefined 다. ResultView 의 테마 소비는 전부 "필드 존재 시에만" 분기하므로,
 *   미매칭 품목은 v6.4 렌더와 픽셀 100% 동일하다. (테마는 아래 *_T / 대표 팔레트에만 얹는다.)
 */
export const DEFAULT_ACCENT = RED

/* ============================================================ */
/* v6.5 과일별 테마 — 군(群) 기본 테마 + 대표 12종 개별 튜닝.     */
/* ------------------------------------------------------------ */
/* 원리: 위 6개 군 팔레트(RED…PEACH)는 bare 로 남겨 DEFAULT_ACCENT */
/* 폴백을 오염시키지 않는다. 아래에서 각 군에 테마 필드를 얹은     */
/* *_T 팔레트를 만들고, 대표 과일은 punchDeep(과일다움의 핵심      */
/* 표면 — 다크 밴드·클로징 딥 톤)만 실물 기준으로 개별 튜닝한다.    */
/*                                                              */
/* - heroGrad: soft 파생 아주 옅은 명도차(위 near-white → 아래 soft).*/
/* - punchDeep: 흰 글씨 대비 4.5:1 이상(전부 계산 검증 — 최소 8:1+).*/
/* - chipTint: mixHex(soft, accent, 0.13) — soft보다 반 단계 진함.  */
/* 전부 구체 hex(내보내기 toCanvas 안전 — CSS 변수·oklch 없음).    */
/* ============================================================ */

/** 군 기본 테마를 bare 팔레트에 얹는다(대표 과일은 이 위에 punchDeep만 덮어씀). */
function themed(
  base: AccentPalette,
  heroGrad: [string, string],
  punchDeep: string,
): AccentPalette {
  return { ...base, heroGrad, punchDeep, chipTint: mixHex(base.soft, base.accent, 0.13) }
}

// 군 기본 테마 팔레트(대표 미지정 과일이 소속 군에서 파생받는 값).
const RED_T = themed(RED, ["#FEF8F6", "#FBF1EE"], "#4B1C22") // 딥 베리
const ORANGE_T = themed(ORANGE, ["#FEF9F3", "#FCF3EA"], "#5A2C10") // 딥 선셋 브라운
const GOLD_T = themed(GOLD, ["#FEFBF2", "#FBF6E8"], "#573C10") // 딥 골드 브라운
const PURPLE_T = themed(PURPLE, ["#FBF9FE", "#F5F2FB"], "#371F3B") // 딥 와인
const GREEN_T = themed(GREEN, ["#F8FCF8", "#EFF7F0"], "#1B3E2A") // 딥 포레스트
const PEACH_T = themed(PEACH, ["#FEF8F6", "#FBF0EE"], "#5A2731") // 딥 로즈 브라운

// 대표 과일 12종 — punchDeep 개별 튜닝(잘 익은 실물 딥 톤). heroGrad·chipTint 는 군 기본 승계.
const APPLE: AccentPalette = { ...RED_T, punchDeep: "#481F1B" } // 사과 딥 애플레드
const STRAWBERRY: AccentPalette = { ...RED_T, punchDeep: "#4E1A26" } // 딸기 딥 베리
const WATERMELON: AccentPalette = { ...RED_T, punchDeep: "#4C1D26" } // 수박 딥 워터멜론
const CITRUS: AccentPalette = { ...ORANGE_T, punchDeep: "#5C2D12" } // 감귤 딥 선셋
const HALLABONG: AccentPalette = { ...ORANGE_T, punchDeep: "#58290E" } // 한라봉 딥 선셋
const CHAMOE: AccentPalette = { ...GOLD_T, punchDeep: "#5D3D0F" } // 참외 딥 골드
const PEAR: AccentPalette = { ...GOLD_T, punchDeep: "#55400F" } // 배 딥 골드
const PLUM: AccentPalette = { ...PURPLE_T, punchDeep: "#3D1F33" } // 자두 딥 와인
const GRAPE: AccentPalette = { ...PURPLE_T, punchDeep: "#331F3E" } // 포도 딥 와인
const SHINE: AccentPalette = { ...GREEN_T, punchDeep: "#1B3F27" } // 샤인머스캣 딥 포레스트
const MELON: AccentPalette = { ...GREEN_T, punchDeep: "#1C3F30" } // 멜론 딥 포레스트
const PEACH_FRUIT: AccentPalette = PEACH_T // 복숭아 딥 로즈 브라운(군=단일 과일)

/** fruit-facts 키 → 팔레트. 잘 익은 대표 색 기준. 테마 필드는 위 *_T/대표 팔레트에만. */
const ACCENT_BY_FRUIT: Record<string, AccentPalette> = {
  // 빨강 — 붉은 과육/껍질
  "사과": APPLE,
  "딸기": STRAWBERRY,
  "수박": WATERMELON,
  "체리": RED_T,
  "토마토": RED_T,
  // 주황 — 감귤·만감류·감
  "감귤": CITRUS,
  "한라봉": HALLABONG,
  "천혜향": ORANGE_T,
  "레드향": ORANGE_T,
  "황금향": ORANGE_T,
  "카라향": ORANGE_T,
  "단감": ORANGE_T,
  "곶감": ORANGE_T,
  // 골드 — 노란 과육/껍질
  "배": PEAR,
  "참외": CHAMOE,
  "바나나": GOLD_T,
  "망고": GOLD_T,
  "파인애플": GOLD_T,
  // 보라 — 포도·자두·베리
  "포도": GRAPE,
  "자두": PLUM,
  "블루베리": PURPLE_T,
  // 초록 — 청포도·멜론·키위·매실
  "샤인머스캣": SHINE,
  "멜론": MELON,
  "키위": GREEN_T,
  "매실": GREEN_T,
  // 복숭아 — 코랄 핑크
  "복숭아": PEACH_FRUIT,
}

/**
 * 상품명에서 과일을 감지해 축색 팔레트 반환.
 * 미감지 시 브랜드 기본 빨강.
 */
export function resolveAccent(productName: string): AccentPalette {
  const key = detectFruitFactKey(productName)
  if (key && ACCENT_BY_FRUIT[key]) return ACCENT_BY_FRUIT[key]
  return DEFAULT_ACCENT
}

/**
 * 두 hex(#RRGGBB)를 ratio(0~1)로 선형 혼합해 새 구체 hex를 만든다.
 * ratio=0 이면 hexA, 1 이면 hexB. 잘못된 형식이면 hexA 그대로.
 * v4.6 레이아웃 변주(soft)에서 히어로 배경을 accent.soft → accent 쪽으로 "한 단계 진하게"
 * 만드는 데 쓴다. 결과가 구체 hex라 export(toCanvas) 시 CSS 변수 문제 없음.
 */
export function mixHex(hexA: string, hexB: string, ratio: number): string {
  const a = hexA.replace("#", "")
  const b = hexB.replace("#", "")
  if (a.length !== 6 || b.length !== 6) return hexA
  const r = Math.max(0, Math.min(1, ratio))
  const ch = (i: number) => {
    const ca = parseInt(a.slice(i, i + 2), 16)
    const cb = parseInt(b.slice(i, i + 2), 16)
    if (!Number.isFinite(ca) || !Number.isFinite(cb)) return "00"
    const m = Math.round(ca * (1 - r) + cb * r)
    return m.toString(16).padStart(2, "0")
  }
  return `#${ch(0)}${ch(2)}${ch(4)}`
}
