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

/** 브랜드 기본값 (미매칭 과일). 기존 빨강 유지. */
export const DEFAULT_ACCENT = RED

/** fruit-facts 키 → 팔레트. 잘 익은 대표 색 기준. */
const ACCENT_BY_FRUIT: Record<string, AccentPalette> = {
  // 빨강 — 붉은 과육/껍질
  "사과": RED,
  "딸기": RED,
  "수박": RED,
  "체리": RED,
  "토마토": RED,
  // 주황 — 감귤·만감류·감
  "감귤": ORANGE,
  "한라봉": ORANGE,
  "천혜향": ORANGE,
  "레드향": ORANGE,
  "황금향": ORANGE,
  "카라향": ORANGE,
  "단감": ORANGE,
  "곶감": ORANGE,
  // 골드 — 노란 과육/껍질
  "배": GOLD,
  "참외": GOLD,
  "바나나": GOLD,
  "망고": GOLD,
  "파인애플": GOLD,
  // 보라 — 포도·자두·베리
  "포도": PURPLE,
  "자두": PURPLE,
  "블루베리": PURPLE,
  // 초록 — 청포도·멜론·키위·매실
  "샤인머스캣": GREEN,
  "멜론": GREEN,
  "키위": GREEN,
  "매실": GREEN,
  // 복숭아 — 코랄 핑크
  "복숭아": PEACH,
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
