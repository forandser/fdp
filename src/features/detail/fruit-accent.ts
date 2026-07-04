/**
 * 과일별 축색(accent) 시스템 — v2.8.
 *
 * 상세페이지의 포인트 컬러를 과일의 잘 익은 색에 맞춰 자동 전환.
 * 수플린 아보카도 레퍼런스처럼 "과일 색과 페이지 톤이 자연스럽게 맞물리는" 효과.
 *
 * 색은 도메인(hallucination 방지 fact 사전)이 아닌 프레젠테이션 관심사라
 * fruit-facts.ts와 분리. productName → detectFruitFactKey → 팔레트 매핑.
 *
 * 각 팔레트 3색:
 * - accent: 메인 포인트 (헤드 강조, POINT 뱃지, CTA)
 * - dark:   진한 변형 (텍스트 대비, 그림자)
 * - soft:   옅은 배경 틴트 (블록 배경 변주)
 */

import { detectFruitFactKey } from "@/domain/fruit-facts"

export interface AccentPalette {
  accent: string
  dark: string
  soft: string
}

const RED: AccentPalette = { accent: "#E03131", dark: "#C92A2A", soft: "#FFF5F5" }
const ORANGE: AccentPalette = { accent: "#E8590C", dark: "#D9480F", soft: "#FFF4E6" }
const GOLD: AccentPalette = { accent: "#F08C00", dark: "#E67700", soft: "#FFF9DB" }
const PURPLE: AccentPalette = { accent: "#7048E8", dark: "#5F3DC4", soft: "#F3F0FF" }
const GREEN: AccentPalette = { accent: "#2F9E44", dark: "#2B8A3E", soft: "#EBFBEE" }
const PEACH: AccentPalette = { accent: "#F06595", dark: "#E64980", soft: "#FFF0F6" }

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
