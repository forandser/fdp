/**
 * 한국 월별 제철 과일/야채 데이터.
 *
 * 출처: 농촌진흥청·aT 식품유통종합정보·산지 직거래 사이트 통상 정보.
 * 같은 품목이 여러 달에 걸쳐 등장할 수 있음(예: 사과는 9~12월이 절정, 1~3월은 저장).
 * 신선식품 특성상 지역·품종에 따라 ±1개월 편차가 있으므로 "대표 제철" 기준.
 */

export type MonthNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12

export interface MonthSeason {
  fruits: string[]
  veggies: string[]
}

export const SEASON_BY_MONTH: Record<MonthNumber, MonthSeason> = {
  1: {
    fruits: ["딸기", "한라봉", "감귤", "천혜향", "레드향", "황금향", "사과", "배"],
    veggies: ["시금치", "브로콜리", "무", "배추", "우엉", "연근", "대파"],
  },
  2: {
    fruits: ["딸기", "한라봉", "천혜향", "레드향", "감귤"],
    veggies: ["냉이", "달래", "시금치", "봄동", "브로콜리", "미나리"],
  },
  3: {
    fruits: ["딸기", "한라봉", "천혜향", "레드향", "카라향", "키위"],
    veggies: ["냉이", "달래", "쑥", "봄동", "미나리", "두릅", "취나물"],
  },
  4: {
    fruits: ["딸기", "한라봉", "레드향", "카라향", "하우스참외", "키위", "금귤"],
    veggies: ["두릅", "취나물", "미나리", "양배추", "마늘쫑", "죽순", "아스파라거스"],
  },
  5: {
    fruits: ["참외", "체리", "매실", "앵두", "보리수", "카라향"],
    veggies: ["마늘쫑", "양파", "양배추", "오이", "상추", "열무", "머위"],
  },
  6: {
    fruits: ["참외", "매실", "수박", "자두", "체리", "앵두", "복분자", "카라향"],
    veggies: ["감자", "양파", "마늘", "오이", "애호박", "상추", "가지"],
  },
  7: {
    fruits: ["복숭아", "자두", "수박", "참외", "포도", "블루베리", "멜론"],
    veggies: ["감자", "옥수수", "오이", "애호박", "가지", "고추", "토마토"],
  },
  8: {
    fruits: ["복숭아", "포도", "자두", "수박", "무화과", "블루베리", "멜론", "사과(아오리)"],
    veggies: ["옥수수", "가지", "고추", "토마토", "애호박", "오이", "부추"],
  },
  9: {
    fruits: ["포도", "샤인머스캣", "배", "사과(홍로)", "무화과", "대추", "석류"],
    veggies: ["토란", "고구마", "호박", "고추", "버섯", "가지", "부추"],
  },
  10: {
    fruits: ["사과(홍로/시나노)", "배", "감", "대추", "석류", "유자", "모과", "샤인머스캣"],
    veggies: ["고구마", "무", "배추", "호박", "버섯", "토란", "연근"],
  },
  11: {
    fruits: ["사과(부사)", "배", "감", "단감", "유자", "모과", "키위", "감귤", "황금향"],
    veggies: ["배추", "무", "고구마", "우엉", "연근", "브로콜리", "대파"],
  },
  12: {
    fruits: ["감귤", "한라봉", "황금향", "레드향", "사과(부사)", "배", "단감", "유자", "딸기"],
    veggies: ["배추", "무", "시금치", "우엉", "연근", "브로콜리", "대파"],
  },
}

/**
 * 현재 월(1~12)을 반환.
 */
export function getCurrentMonth(): MonthNumber {
  return (new Date().getMonth() + 1) as MonthNumber
}

/**
 * 현재 월 기준 제철 과일 목록.
 */
export function getCurrentSeasonFruits(): string[] {
  return SEASON_BY_MONTH[getCurrentMonth()].fruits
}

/**
 * 현재 월 기준 제철 야채 목록.
 */
export function getCurrentSeasonVeggies(): string[] {
  return SEASON_BY_MONTH[getCurrentMonth()].veggies
}

/**
 * 현재 월 기준 제철 과일+야채를 합쳐 반환.
 */
export function getCurrentSeasonAll(): string[] {
  const s = SEASON_BY_MONTH[getCurrentMonth()]
  return [...s.fruits, ...s.veggies]
}

/**
 * 입력 상품명이 "현재 월의 제철 목록"에 포함되는지.
 * 부분일치/대소문자 무시. 빈 문자열은 false.
 */
export function isInSeason(productName: string): boolean {
  const name = productName.trim()
  if (!name) return false
  const list = getCurrentSeasonAll()
  return list.some((item) => itemMatches(item, name))
}

/**
 * 입력 상품명이 "제철"이 되는 월들(1~12)을 반환.
 * 빈 배열이면 표에 기재된 제철 없음(=시즌 데이터 불명).
 */
export function getInSeasonMonths(productName: string): MonthNumber[] {
  const name = productName.trim()
  if (!name) return []
  const months: MonthNumber[] = []
  for (let m = 1; m <= 12; m++) {
    const mm = m as MonthNumber
    const list = [...SEASON_BY_MONTH[mm].fruits, ...SEASON_BY_MONTH[mm].veggies]
    if (list.some((item) => itemMatches(item, name))) {
      months.push(mm)
    }
  }
  return months
}

/**
 * 연속된 월 배열을 "6~8월" 같은 문자열로 변환.
 * 비연속이면 "1~3, 11~12월" 처럼.
 */
export function formatMonthRanges(months: MonthNumber[]): string {
  if (months.length === 0) return ""
  const sorted = [...months].sort((a, b) => a - b)
  const ranges: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    if (cur === prev + 1) {
      prev = cur
      continue
    }
    ranges.push(start === prev ? `${start}` : `${start}~${prev}`)
    start = cur
    prev = cur
  }
  ranges.push(start === prev ? `${start}` : `${start}~${prev}`)
  return `${ranges.join(", ")}월`
}

/**
 * "사과(부사)", "사과(홍로/시나노)" 같은 표기를 다룬다.
 * 입력이 "사과"여도 "사과(부사)" 항목과 매칭되도록.
 */
function itemMatches(item: string, query: string): boolean {
  const stripParen = (s: string) =>
    s
      .replace(/\([^)]*\)/g, "")
      .replace(/\s+/g, "")
      .toLowerCase()
  const a = stripParen(item)
  const b = stripParen(query)
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}
