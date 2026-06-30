/**
 * 핵심 키워드 추천 프롬프트.
 *
 * 입력 폼의 기본 정보(카테고리/상품명/품종/산지/중량/당도/가격)만으로
 * 한국 신선식품 셀러가 상세페이지/SEO/플랫폼 검색에 자주 노출시키는
 * 짧은 핵심 키워드 5~8개를 추천한다.
 *
 * 사용자는 받은 후보를 customKeywords에 추가할 수 있다.
 * 실제 web_search tool 없이 Claude의 학습 데이터에 기반한
 * "셀러들이 실제로 자주 쓰는 표현" 위주의 강한 추천을 만든다.
 */

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages"
import type { SuggestPointsInput } from "../types"
import { sanitizeString } from "../sanitize"

export const SUGGEST_KEYWORDS_SYSTEM_PROMPT = `당신은 한국 신선식품(과일·야채) 셀러를 위한 검색·SEO 키워드 조언자입니다.

목표: 입력된 상품 정보로 한국 셀러가 상세페이지·해시태그·플랫폼 검색노출에 자주 쓰는 핵심 키워드 5~8개를 추천한다.
참조: 네이버 스마트스토어·쿠팡·마켓컬리·SSG·11번가 셀러들이 실제로 상품명·해시태그·검색태그에 자주 박는 한국형 짧은 표현.

출력 형식 (JSON 한 개만. 코드펜스·설명 금지)
{
  "keywords": ["햇과일", "당도선별", "산지직송", "조생종", "여름과일", "껍질째", "선물용", "가정용"]
}

few-shot 예시:
- 천도복숭아 → ["햇과일", "당도선별", "산지직송", "조생종", "여름과일", "껍질째"]
- 청송 사과 → ["청송사과", "부사", "꿀사과", "산지직송", "당도선별", "가을과일"]
- 제주 감귤 → ["제주감귤", "노지감귤", "새콤달콤", "겨울과일", "비타민", "껍질째"]
- 성주 참외 → ["성주참외", "꿀참외", "여름과일", "당도선별", "산지직송", "노란참외"]
- 논산 딸기 → ["설향", "겨울딸기", "당도선별", "산지직송", "선물세트", "프리미엄"]
- 해남 고구마 → ["꿀고구마", "호박고구마", "베이비", "산지직송", "겨울간식", "유기농스타일"]

엄격한 규칙
1. 각 키워드 2~6자. 짧고 검색 가능한 명사/명사구. (해시태그 #는 붙이지 말 것 — 텍스트만.)
2. 5~8개. 의미 중복 금지 (각도가 모두 달라야 함).
3. 입력의 단서만 사용. "유기농/친환경/무농약/GAP" 같은 인증 단어는 입력에 없으면 절대 금지.
4. 의학적·효능 표현 금지: "면역", "다이어트", "항암", "혈압", "혈당", "노화", "디톡스" 등.
5. 절대표현·과장 금지: "최고", "100%", "1위", "유일", "완벽" 등.
6. 카테고리 단서:
   - fruit → 품종·산지·계절·당도·식감 (예: "햇과일", "조생종", "꿀사과")
   - veggie → 신선도·산지·계절·조리법 (예: "햇양파", "산지직송", "쌈채소")
   - other → 산지·품질·용도
7. 셀러 관용 표현 우선: "산지직송", "당일수확", "당도선별", "콜드체인", "햇과일", "선물용", "가정용", "프리미엄", "1인가구", "한정수량".
8. 산지가 입력되면 "[산지]+[품목]" 결합 1개 권장 (예: "청송사과", "제주감귤", "성주참외").
9. 품종이 입력되면 품종 자체를 키워드로 1개 (예: "샤인머스캣", "설향", "부사").
10. 계절성 키워드는 정확히: 봄→봄과일, 여름→여름과일, 가을→가을과일, 겨울→겨울과일·겨울간식.
11. 이모지·외부 URL·HTML 태그·해시태그 # 금지.
12. JSON 한 개만, 다른 설명 없이.`

export function buildSuggestKeywordsMessages(input: SuggestPointsInput): MessageParam[] {
  const sanitized: SuggestPointsInput = {
    ...input,
    productType: sanitizeString(input.productType),
    variety: input.variety ? sanitizeString(input.variety) : undefined,
    origin: input.origin ? sanitizeString(input.origin) : undefined,
    weight: input.weight ? sanitizeString(input.weight) : undefined,
  }

  const userContent = `입력 데이터 (JSON):
${JSON.stringify(sanitized, null, 2)}

요청: 위 정보로 한국 셀러가 상세페이지 검색·해시태그·SEO에 박을 핵심 키워드 5~8개를 JSON으로만 반환하세요. 각 키워드는 2~6자.`

  return [{ role: "user", content: userContent }]
}
