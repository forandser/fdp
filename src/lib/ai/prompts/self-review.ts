/**
 * v5.1: 완성 아트보드 자가 검수(vision) 프롬프트.
 *
 * 결과 화면에서 완성된 상세페이지(아트보드)를 여러 세그먼트 JPG(dataURL)로 캡처해
 * Claude vision 1콜로 훑고, 셀러 눈높이의 "시각 위생" 지적 2~6건 + 잘한 점 한 줄을 만든다.
 *
 * 관점 5개(오직 눈에 보이는 것만):
 *  1) 여백·정렬 어색       — 요소 간 여백이 들쭉날쭉하거나 정렬이 안 맞아 보이는 곳.
 *  2) 사진 품질·배치       — 어둡거나 흐린 사진이 눈에 띄는 자리(특히 상단)에 있는지, 배치가 어색한지.
 *  3) 텍스트 겹침·잘림     — 글자가 겹치거나 잘리거나 프레임 밖으로 넘치는 곳(오타·맞춤법 판단 금지).
 *  4) 색 부조화            — 배경·글자·강조색이 안 어울리거나 대비가 약해 잘 안 읽히는 곳.
 *  5) 섹션 리듬·반복감     — 비슷한 무드/레이아웃이 계속 반복돼 지루하거나 흐름이 단조로운지.
 *
 * 철칙: 시각만 평가. 오타·문구 내용·사실 여부·가격 적정성·식약처 위반은 판단하지 않는다
 * (그 검수는 compliance-report 담당). 지적은 셀러가 앱에서 바로 실행할 조치 위주로.
 *
 * 출력: SelfReviewResult JSON({ overall, issues: [...] }). 검증은 validate.ts 의
 * validateSelfReview 가 담당(severity 화이트리스트·길이 절삭·최대 6건·비면 null).
 */

import type {
  ContentBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages"
import { sanitizeString } from "../sanitize"

/** 자가 검수 응답 max_tokens (짧은 지적 2~6건 + overall — 여유 있게 1,200). */
export const SELF_REVIEW_MAX_TOKENS = 1200

export const SELF_REVIEW_SYSTEM_PROMPT = `당신은 한국 신선식품(과일·야채) 상세페이지의 "시각 완성도"를 봐주는 검수자입니다.
완성된 상세페이지를 위에서 아래로 이어 캡처한 이미지 조각(구간)들을 받아,
셀러가 눈으로 바로 알아챌 만한 시각적 아쉬움만 짚어 줍니다.

오직 아래 5가지 관점으로 "눈에 보이는 것"만 판단하세요:
1. 여백·정렬: 요소 사이 여백이 들쭉날쭉하거나, 줄·칸 정렬이 안 맞아 어색해 보이는 곳.
2. 사진 품질·배치: 어둡거나 흐릿(초점 안 맞음)한 사진이 눈에 띄는 자리(특히 맨 위 대표 이미지)에 있는지, 사진 배치·순서가 어색한지.
3. 텍스트 겹침·잘림: 글자가 서로 겹치거나, 잘리거나, 프레임 밖으로 넘쳐 읽기 힘든 곳.
4. 색 부조화: 배경·글자·강조색이 서로 안 어울리거나, 대비가 약해 글자가 잘 안 보이는 곳.
5. 섹션 리듬·반복감: 비슷한 무드·색·레이아웃이 계속 반복돼 지루하거나, 위아래 흐름이 단조로운지.

절대 하지 말 것(이건 다른 곳에서 검수합니다 — 당신은 손대지 마세요):
- 오타·맞춤법·띄어쓰기 지적 금지.
- 문구 내용이 사실인지, 산지·당도·품종·인증이 맞는지 판단 금지.
- 가격이 비싼지 싼지, 표현이 과장인지 판단 금지.
- 즉, "읽어서 아는 문제"가 아니라 "보여서 아는 문제"만.

지적 작성 규칙:
- 가장 눈에 띄는 것부터 2~6건. 사소한 트집은 넣지 말고, 진짜 아쉬운 것만.
- severity(심각도): "high"(상품이 안 팔릴 만큼 눈에 거슬림), "medium"(고치면 확 나아짐), "low"(가벼운 아쉬움) 중 하나.
- area(구간): 셀러가 어디인지 바로 알 수 있게 (예: "맨 위 대표 이미지", "포인트 03 카드", "하단 배송 안내", "농가 소개 부분"). 구간마다 [구간 N] 라벨이 함께 제공되면 그 표현을 활용하세요.
- message: 개발 용어 없이, 셀러가 바로 이해할 한국어 한 줄 (예: "대표 사진이 어두워서 상품 색이 잘 안 보여요").
- suggestion(선택): 앱에서 바로 할 수 있는 조치 위주로 짧게. 좋은 예: "사진 순서 변경", "무드 변주 전환", "해당 사진 교체", "문구 축약", "더 밝은 사진으로 교체". CSS·코드·색상코드 같은 개발 지시는 쓰지 마세요.
- overall: 잘된 점을 짚는 칭찬 한 줄 (예: "전체적으로 깔끔하고 상품이 잘 보입니다").

출력 형식(JSON 한 개만. 코드펜스·이모지·마크다운·인사·설명 문장 금지):
{
  "overall": "잘된 점 한 줄",
  "issues": [
    { "severity": "high", "area": "맨 위 대표 이미지", "message": "대표 사진이 어두워서 상품 색이 잘 안 보여요", "suggestion": "더 밝은 사진으로 교체" },
    { "severity": "medium", "area": "포인트 03 카드", "message": "글자가 사진 위에 겹쳐서 읽기 어려워요", "suggestion": "문구 축약" },
    { "severity": "low", "area": "중간 구성 안내", "message": "위아래 색 느낌이 비슷해서 조금 단조로워 보여요", "suggestion": "무드 변주 전환" }
  ]
}`

/** 허용 이미지 media_type(SDK Base64ImageSource 와 일치). */
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp"
const ALLOWED_MEDIA_TYPES: ReadonlySet<string> = new Set<ImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])

/**
 * dataURL → { mediaType, base64data }. data URL 이 아니거나 페이로드가 비면 null(스킵).
 * 아트보드 세그먼트는 JPG 캡처이므로 대개 image/jpeg. 다른 허용 타입이 오면 존중하고,
 * 미지 타입은 image/jpeg 로 폴백한다.
 */
function parseImageDataUrl(
  dataUrl: string,
): { mediaType: ImageMediaType; data: string } | null {
  if (typeof dataUrl !== "string") return null
  const m = /^data:([^;,]*)?(?:;[^,]*)?,(.*)$/s.exec(dataUrl.trim())
  if (!m) return null
  const data = (m[2] ?? "").trim()
  if (!data) return null
  const declared = (m[1] ?? "").trim()
  const mediaType: ImageMediaType = ALLOWED_MEDIA_TYPES.has(declared)
    ? (declared as ImageMediaType)
    : "image/jpeg"
  return { mediaType, data }
}

/**
 * 자가 검수용 user 메시지 빌드.
 * 각 세그먼트 이미지 바로 앞에 [구간 N] label 텍스트를 두어 모델이 구간↔이미지를 매핑하게 한다.
 * dataURL 파싱 실패 세그먼트는 조용히 스킵(나머지만 검수 — 전부 실패해 이미지 0장이면
 * 어댑터/검증 단계에서 null 로 떨어진다).
 */
export function buildSelfReviewMessages(
  segments: { label: string; dataUrl: string }[],
  context: { productType: string },
): MessageParam[] {
  const productType = sanitizeString(context.productType) || "(미입력)"

  const imageBlocks: ContentBlockParam[] = []
  let sentCount = 0
  for (const seg of segments) {
    const parsed = parseImageDataUrl(seg.dataUrl)
    if (!parsed) continue
    sentCount++
    const label = sanitizeString(seg.label) || `구간 ${sentCount}`
    imageBlocks.push({ type: "text", text: `[구간 ${sentCount}] ${label}` })
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
    })
  }

  const header: ContentBlockParam = {
    type: "text",
    text: `상품 종류: ${productType}
아래는 완성된 상세페이지를 위에서 아래로 이어 캡처한 이미지 조각(구간) ${sentCount}개입니다.
각 이미지 바로 앞의 [구간 N] 줄에 그 구간이 어디인지 라벨이 적혀 있습니다. area 를 쓸 때 참고하세요.`,
  }

  const footer: ContentBlockParam = {
    type: "text",
    text: `위 ${sentCount}개 구간을 한 페이지로 보고, 5가지 관점(여백·정렬 / 사진 품질·배치 / 텍스트 겹침·잘림 / 색 부조화 / 섹션 리듬·반복감)으로만 시각적 아쉬움을 2~6건 짚으세요.
오타·문구 내용·사실 여부·가격은 절대 판단하지 말고, 눈에 보이는 완성도만.
시스템 프롬프트의 JSON 스키마({ "overall": ..., "issues": [...] }) 하나로만 응답하세요.`,
  }

  return [{ role: "user", content: [header, ...imageBlocks, footer] }]
}
