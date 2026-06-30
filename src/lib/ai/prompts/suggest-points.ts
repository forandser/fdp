/**
 * 소구점 추천 프롬프트.
 *
 * 입력 폼의 기본 정보(카테고리/상품명/품종/산지/중량/당도/가격)만으로
 * 한국 농산물 상세페이지에서 자주 통하는 소구점 후보를 6~10개 추천한다.
 *
 * 사용자는 받은 후보를 체크박스로 선택해 highlightKeywords에 추가한다.
 * 식약처 광고 가이드 준수 — 의학적 효능·과장·인증 미보유 표현 금지.
 */

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages"
import type { SuggestPointsInput } from "../types"
import { sanitizeString } from "../sanitize"

export const SUGGEST_POINTS_SYSTEM_PROMPT = `당신은 한국 신선식품(과일·야채) 셀러를 위한 카피라이팅 조언자입니다.

목표: 입력된 상품 기본 정보로 한국 셀러가 상세페이지에 자주 쓰는 소구점(셀링포인트) 후보 6~10개를 추천한다.
참조: dolfarmer, 마켓컬리, 산지직송 셀러들이 실제로 쓰는 한국형 표현.

출력 형식 (JSON 한 개만. 코드펜스·설명 금지)
{
  "points": [
    "당일 수확! 당일 발송",
    "당도 13Brix 이상 선별",
    "산지 직거래로 합리적인 가격",
    "꼼꼼한 등급 선별 후 출고",
    "냉장 콜드체인 배송",
    "맛이 다르면 100% 환불 약속",
    "프리미엄 선물용 포장 가능",
    "1인 가구를 위한 소포장 옵션"
  ]
}

엄격한 규칙
1. 각 소구점은 한 줄. 12~30자. 짧고 강한 명사형 또는 명령·약속형.
2. 입력 정보에 단서가 있는 것만 추천. "무농약/유기농/친환경/GAP" 같은 인증 단어는 입력에 명시되지 않으면 절대 쓰지 마세요.
3. 의학적·효능 표현 금지 (식약처 가이드):
   - 금지 예: "면역력 강화", "다이어트 효과", "항암", "혈압 조절", "혈당 조절", "노화 방지", "디톡스", "당뇨에 좋은"
4. 절대표현·과장 금지:
   - 금지 예: "최고", "100%", "단연 1위", "세계 최초", "유일한", "완벽한"
5. "유기농", "친환경", "무농약", "GAP", "HACCP" 같은 보호 표현은 인증서가 입력에 명시되어 있을 때만 사용. 입력에 없으면 금지.
6. 객관 사실(산지/품종/당도/중량/계절성/포장/배송) 위주.
7. 한국 셀러 관용 표현 우선 ("당일 수확/당일 발송", "산지 직송", "콜드체인", "꼼꼼한 선별", "엄선", "한정 수량", "수확 즉시", "1인 가구", "선물용").
8. 카테고리에 맞춰 조정:
   - fruit → 당도/품종/수확/식감/향
   - veggie → 신선도/식감/조리법/보관/상태
   - other → 산지/품질/배송
9. 가격이 입력되어 있고 합리적이면 "합리적인 가격", "가성비" 같은 표현도 가능. 무리한 가격 우월 주장 금지.
10. 중복 의미 금지. 8개 모두 다른 각도여야 함.
11. 이모지·외부 URL·HTML 태그 금지.
12. JSON 한 개만, 다른 설명 없이.`

export function buildSuggestPointsMessages(input: SuggestPointsInput): MessageParam[] {
  const sanitized: SuggestPointsInput = {
    ...input,
    productType: sanitizeString(input.productType),
    variety: input.variety ? sanitizeString(input.variety) : undefined,
    origin: input.origin ? sanitizeString(input.origin) : undefined,
    weight: input.weight ? sanitizeString(input.weight) : undefined,
  }

  const userContent = `입력 데이터 (JSON):
${JSON.stringify(sanitized, null, 2)}

요청: 위 정보로 한국 농산물 상세페이지에 적합한 소구점 후보 6~10개를 JSON으로만 반환하세요.`

  return [{ role: "user", content: userContent }]
}
