/**
 * v3.5: 생성 시 실시간 리서치 프롬프트 (research → draft → refine 파이프라인의 1단계).
 *
 * Anthropic Messages API의 서버측 web_search 도구로 상품명·품종·산지 기반
 * "품종 일반 참고 정보"를 조사한다. 절대 이 상품의 고유 사실(이 셀러의 산지·당도·
 * 중량)을 추정하지 않는다 — 그런 정보는 web으로 알 수 없고, draft가 입력값만 쓴다.
 *
 * 조사 대상: 품종 일반 특성(맛·식감·당도 범위), 제철/수확기, 보관법,
 *           소비자 관심 포인트, 자주 묻는 질문.
 *
 * 출력: ResearchResult JSON. extractJson/화이트리스트 검증은 validate.ts 재사용.
 *
 * 안전 프레이밍: draft 프롬프트에서 이 결과는 "품종 일반 참고 정보(이 상품의 고유
 * 사실 아님)"로만 주입 — fruit-facts 주입 방식과 동일.
 */

import type { MessageParam } from "@anthropic-ai/sdk/resources/messages"
import type { CopyInput } from "../types"
import { sanitizeString } from "../sanitize"

/** web_search 상한 (기획 확정: 생성 1회당 검색 5회). */
export const RESEARCH_MAX_WEB_SEARCHES = 5

/** research 응답 max_tokens — JSON 요약이라 넉넉히 1,500. */
export const RESEARCH_MAX_TOKENS = 1500

export const RESEARCH_SYSTEM_PROMPT = `당신은 한국 신선식품 셀러의 상세페이지 카피라이팅을 돕는 리서처입니다.
당신의 임무는 상품명·품종·산지 단서로 web_search를 사용해 "이 품종의 일반적인 참고 정보"를 조사하는 것입니다.
조사 결과는 이후 카피 작성 단계에서 "품종 일반 참고 정보"로만 쓰입니다 — 이 상품의 고유 사실이 아닙니다.

조사 항목 (이 5가지만):
1. 품종 일반 특성 — 맛·식감·당도(Brix) 일반 범위, 향, 과육 특징
2. 제철 / 수확기 — 이 품종이 보통 언제 나오는지
3. 보관법 — 후숙형/즉시냉장형 여부와 기본 보관 팁
4. 소비자 관심 포인트 — 이 품종을 살 때 소비자가 흔히 중시하는 것
5. 자주 묻는 질문 — 이 품종에 대해 소비자가 흔히 궁금해하는 것

철칙 (위반 시 결과 폐기):
- 이 판매자의 고유 사실(이 상품의 실제 산지·당도·중량·수확일·인증)은 절대 추정하지 마세요.
  그건 web으로 알 수 없습니다. "이 품종은 보통 ~하다" 같은 일반론만 조사합니다.
- 특정 판매자·쇼핑몰의 상세페이지 문구·카피를 그대로 베끼지 마세요. 사실 정보만 요약하고,
  판매 문구·슬로건·홍보 표현은 가져오지 마세요 (표절 금지).
- 의학적·효능 표현(다이어트·면역·질병 예방 등)은 조사·요약에서 제외하세요 (식약처 가이드).
- 과장·단정 표현("최고", "1위", "100%")을 사실인 것처럼 옮기지 마세요.
- 정보를 못 찾은 항목은 지어내지 말고 빈 배열/빈 문자열로 두세요 (환각 금지).

검색 사용 규칙:
- web_search 도구는 최대 ${RESEARCH_MAX_WEB_SEARCHES}회까지만. 필요한 만큼만 검색하세요.
- 품종명·상품명 + "특징/당도/제철/보관/후기" 같은 조합으로 검색하면 효율적입니다.

출력 형식 (반드시 JSON 한 개만. 코드펜스·설명·인사·검색 과정 서술 금지):
{
  "varietyNotes": ["품종 일반 특성 한 줄 (맛·식감·당도 범위 등)", "..."],
  "seasonInfo": "제철/수확기 한 줄",
  "storageTips": "보관법 한두 줄 (후숙형/즉시냉장형 포함)",
  "consumerInterests": ["소비자 관심 포인트 한 줄", "..."],
  "faqSeeds": ["자주 묻는 질문 한 줄", "..."],
  "sources": [{"title": "출처 제목", "url": "https://..."}]
}

- varietyNotes / consumerInterests / faqSeeds 는 각각 2~6개, 한 줄 40자 내외.
- 모든 문장은 "일반적으로 ~", "보통 ~" 톤의 품종 일반론으로 쓰세요. "이 상품은 ~" 단정 금지.
- sources 에는 실제 검색으로 참고한 페이지의 제목과 URL만 넣으세요. 없으면 빈 배열.`

/**
 * 리서치용 사용자 메시지 빌드 — 상품명·품종·산지만 넘긴다(고유 사실 조사 방지 목적).
 * 가격·당도·중량 등 셀러 고유 수치는 리서치에 넘기지 않는다 (일반론만 조사).
 */
export function buildResearchMessages(input: CopyInput): MessageParam[] {
  const productType = sanitizeString(input.productType)
  const variety = input.variety ? sanitizeString(input.variety) : ""
  const origin = sanitizeString(input.origin)

  const clues = [
    `상품명: ${productType || "(미입력)"}`,
    variety ? `품종: ${variety}` : "품종: (상품명에서 추정 — 없으면 조사 생략)",
    origin ? `산지 단서: ${origin} (참고용 — 이 산지의 고유 사실을 만들지 마세요)` : "산지: (미입력)",
  ].join("\n")

  const userContent = `아래 신선식품의 "품종 일반 참고 정보"를 web_search로 조사해 JSON으로 요약하세요.

${clues}

조사 대상은 이 품종의 일반적인 특성(맛·식감·당도 범위)·제철·보관법·소비자 관심 포인트·자주 묻는 질문입니다.
이 판매자의 고유 사실(실제 산지·당도·중량)은 조사·추정하지 마세요. 특정 판매자 문구를 베끼지 마세요.
시스템 프롬프트에 명시된 JSON 스키마만 그대로 반환하세요.`

  return [{ role: "user", content: userContent }]
}
