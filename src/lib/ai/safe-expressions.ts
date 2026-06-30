/**
 * 식약처 규제를 통과하면서 매력적인 카피 표현 풀 (v1.8).
 *
 * 식품등의 표시·광고에 관한 법률 §8 위반 가능성이 낮으면서
 * 실제 한국 산지직송 셀러가 자주 쓰는 표현만 큐레이션.
 *
 * 사용:
 * - fruit-copy.ts system 프롬프트에 "권장 표현 풀"로 인입
 * - SellingPointsSuggester / KeywordPicker baseline 후보로
 * - validate.ts에서 "안전한 대안 제시"용
 */

export const SAFE_EXPRESSIONS = {
  /** 신선도 — 시간/유통 단계 강조. */
  freshness: [
    "당일 수확",
    "당일 발송",
    "산지 직송",
    "주문 확인 후 수확",
    "새벽에 거둔",
    "한 알 한 알 골라",
    "햇~",
    "수확 12시간 안에 출고",
    "콜드체인 봉인 배송",
    "수확 다음 날 도착",
    "갓 따 보내드려요",
  ],
  /** 맛 — 단정 표현 없이 감각 자극. */
  taste: [
    "입맛을 깨우는",
    "새콤달콤한",
    "진한 향",
    "한 입 가득",
    "과즙이 터지는",
    "단맛 위주",
    "은은한 향",
    "농축된 단맛",
    "한 알의 단맛",
    "꿀이 차오른 (Brix 수치 병기 시)",
  ],
  /** 식감 — 과일별로 정확히 매칭. */
  texture: [
    "아삭한",
    "사각 소리가 나는",
    "폭신한",
    "탱글한",
    "녹는 듯한",
    "쫀쫀한",
    "촉촉한",
    "씹는 맛",
    "톡 터지는",
    "단단한",
  ],
  /** 농가/생산자 — 1인칭 + 구체. */
  farmer: [
    "3대째 같은 밭에서",
    "20년차 김 농부",
    "손으로 한 알씩 골라",
    "새벽 5시에 따요",
    "저희 가족이 직접",
    "오늘 아침에도 밭에 다녀왔어요",
    "농부지인",
    "산지에서 직접 보내드려요",
  ],
  /** 가격 정당화 — 비싸도 / 싸도 이유. */
  priceJustification: [
    "손이 많이 들어요",
    "박스 한 칸당 30분 걸려요",
    "콜드체인 차량 비용이 박스당 1,800원 들어요",
    "농약 대신 손으로 잡아서 키웠어요",
    "한 알 평균 g 무게로 비교하면",
    "송이 500g 이상만 골라요",
    "올해 7월 우박 맞아 겉에 작은 흠집이 있어요",
    "시즌 마감이라 가격을 30% 내렸어요",
    "모양만 다르고 맛은 같아요",
  ],
  /** 솔직한 결점 자백 — 신뢰 차별점. */
  honestFlaws: [
    "모양은 들쑥날쑥, 맛은 그대로",
    "겉에 작은 흠집이 있어요",
    "크기가 균일하지 않아요",
    "노지 특성상 색깔이 조금씩 달라요",
    "표면의 분(가루)은 자연 발생이에요",
    "신고는 11.4 Brix라 아주 단 카피는 못 쓰지만 아삭함이 차별점이에요",
  ],
  /** 페어링/먹는 장면 — 사용 시나리오. */
  pairing: [
    "아침 식탁에 한 알",
    "도시락에 한 송이",
    "토스트 위에 올리면",
    "요거트와 한 스푼",
    "샐러드 토핑",
    "선물 박스를 여는 순간",
    "주말 가족 모임에",
    "아이 간식·이유식 보조",
  ],
  /** 시즌 한정 — 희소성 유도 (사실 기반). */
  scarcity: [
    "이번 주 한정 출하",
    "올해 첫 ~",
    "여름 한정 햇과일",
    "시즌 마감 임박",
    "올해 마지막 출하분",
    "농가 보유 한정 수량",
  ],
  /** 신뢰 인용 — 농가 누적/사회적 증거. */
  trust: [
    "올해 산지 직배송 1,200건",
    "3대째 같은 밭에서 30년째",
    "주문 확인 후 새벽에 따서",
    "GAP 인증 (인증번호 있을 때만)",
    "지리적 표시 등록 산지",
    "직접 측정한 농가 Brix 기록",
    "단골 농가 지정 출하",
  ],
} as const

export type SafeExpressionCategory = keyof typeof SAFE_EXPRESSIONS

/** 카테고리별 표현 N개 무작위 추출 (실제 호출 시점에 product context 따라 다르게 사용). */
export function pickSafeExpression(category: SafeExpressionCategory, n: number = 3): string[] {
  const pool = [...SAFE_EXPRESSIONS[category]]
  // 결정론적 셔플 — 시드는 카테고리 이름 기반 (런타임마다 안정)
  const seed = category.split("").reduce((s, c) => s + c.charCodeAt(0), 0)
  let rngState = seed
  const rng = () => {
    rngState = (rngState * 9301 + 49297) % 233280
    return rngState / 233280
  }
  const out: string[] = []
  while (out.length < n && pool.length > 0) {
    const idx = Math.floor(rng() * pool.length)
    out.push(pool.splice(idx, 1)[0])
  }
  return out
}

/** 카피 프롬프트에 인입할 텍스트 블록 — 권장 표현 풀. */
export function safeExpressionsForPrompt(): string {
  const lines: string[] = ["권장 표현 풀 (이 풀의 어휘를 우선 활용; 그 외 표현 가능하나 식약처 가이드 위배 X 확인 필수):"]
  for (const cat of Object.keys(SAFE_EXPRESSIONS) as SafeExpressionCategory[]) {
    const label = labelOf(cat)
    lines.push(`- ${label}: ${SAFE_EXPRESSIONS[cat].slice(0, 6).join(", ")}`)
  }
  return lines.join("\n")
}

function labelOf(cat: SafeExpressionCategory): string {
  switch (cat) {
    case "freshness":
      return "신선도"
    case "taste":
      return "맛"
    case "texture":
      return "식감"
    case "farmer":
      return "농가"
    case "priceJustification":
      return "가격 정당화"
    case "honestFlaws":
      return "솔직한 결점 자백"
    case "pairing":
      return "페어링·먹는 장면"
    case "scarcity":
      return "시즌·희소성"
    case "trust":
      return "신뢰 인용"
  }
}
