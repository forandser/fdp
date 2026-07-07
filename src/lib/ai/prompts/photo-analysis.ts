/**
 * v4.4: 업로드 사진 분석(vision) 프롬프트.
 *
 * 생성 시 업로드된 사진들(512px 다운스케일 JPEG dataURL)을 Claude vision 1콜로
 * 훑어 사진별 역할·품질·"보이는 것" 메모를 만든다.
 * 목적: 히어로 선정 · 섹션 매칭 · 갤러리 순서 · 사실 기반 캡션의 재료.
 *
 * 철칙(허위광고 방지): visibleNote 는 "사진에 실제로 보이는 것"만. 품종·산지·당도·
 * 수확일·맛·신선도 등 사진만으로 알 수 없는 것은 절대 추정하지 않는다. 이 메모는
 * 관찰일 뿐, 카피의 사실값(산지·당도 등)으로 승격되지 않는다.
 *
 * 출력: PhotoAnalysisResult JSON({ items: [...] }). 검증은 validate.ts 의
 * validatePhotoAnalysis 가 담당(role 화이트리스트·heroScore 클램프·note 절삭·
 * 미지 imageId 드롭).
 */

import type {
  ContentBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages"
import { sanitizeString } from "../sanitize"

/** 사진 분석 응답 max_tokens (사진 수 × 짧은 JSON 항목 — 여유 있게 1,500). */
export const PHOTO_ANALYSIS_MAX_TOKENS = 1500

export const PHOTO_ANALYSIS_SYSTEM_PROMPT = `당신은 한국 신선식품(과일·야채) 상세페이지 제작을 돕는 사진 분석가입니다.
업로드된 사진들을 보고, 각 사진의 "역할·품질·실제로 보이는 것"을 판정합니다.
그 결과는 이후 대표컷 선정·섹션 배치·갤러리 순서·사진 캡션의 재료로 쓰입니다.

역할(role) 분류 — 아래 7가지 중 정확히 하나만 고르세요:
- hero  : 대표컷 후보. 원물이 화면을 꽉 채우고 초점이 선명하며 밝은, 페이지 최상단에 쓸 만한 사진.
- cut   : 자른 단면·과육 클로즈업(속살, 잘린 모습, 씨·과즙이 보이는 컷).
- whole : 원물 통째. 자르지 않은 전체 모습(한 알 또는 여러 알).
- box   : 포장·박스·구성. 배송 박스·선물 포장·담긴 구성이 주인공인 사진.
- size  : 크기 비교. 손·동전·자·계란 등과 함께 크기를 가늠하게 한 사진.
- farm  : 농장·밭·나무·수확 현장. 재배 환경(사람이 포함돼도 됨).
- table : 상차림·연출. 그릇·식탁·디저트·요리 등 스타일링된 연출 컷.
(고민되면 "그 사진에서 가장 크게 보이는 주제"를 기준으로 고르세요. 예: 과육 단면이 크게 보이면 cut, 통과일이면 whole.)

heroScore(0~10) — 대표컷 적합도. 다음 4가지를 종합한 정수:
- 선명도: 초점이 또렷한가(흔들림·뭉개짐 없음).
- 구도: 원물이 중심에 오고 여백·배경이 정돈됐는가.
- 원물 중심: 과일/채소 자체가 주인공인가(포장·배경·소품에 묻히지 않음).
- 밝기: 노출이 적정한가(너무 어둡거나 날아가지 않음).
선명·정돈·원물중심·적정밝기가 모두 좋으면 8~10, 하나라도 크게 아쉬우면 낮춥니다.

blurry / dark 판정(각 true/false):
- blurry: 초점이 안 맞거나 흔들려 원물 형태가 뭉개진 경우 true.
- dark  : 전반적으로 어둡거나 노출이 부족해 색·질감이 잘 안 보이는 경우 true.

visibleNote — "사진에 실제로 보이는 것"만 한 줄(60자 이내):
- 색·개수·배경·잘림 여부·포장 형태·구도 등 눈에 보이는 관찰만 적습니다.
- 예: "붉은 복숭아 여러 알이 나무 상자에 담김", "반으로 자른 단면, 노란 과육과 씨".
- 절대 금지(사진만으로 알 수 없는 추정): 품종명·산지·당도(Brix)·수확일·맛("달다"·"아삭")·
  신선도 단정·인증 여부. 보이지 않는 것은 쓰지 않습니다. 이 메모는 관찰일 뿐 사실값이 아닙니다.

subjectBox(선택) — 과일/상품 주체가 사진 안에서 차지하는 사각형 위치:
- 좌상단을 원점으로 한 0~1 정규화 값 { "x", "y", "w", "h" } 로 보고합니다.
  (x=왼쪽 끝에서의 가로 위치, y=위쪽 끝에서의 세로 위치, w=가로 너비, h=세로 높이. 모두 0~1.)
- 예: 사진 왼쪽 위 1/4 영역에 과일이 모여 있으면 { "x": 0.05, "y": 0.08, "w": 0.45, "h": 0.5 }.
- 이후 대표컷을 상품 중심으로 크롭·확대하는 데 쓰입니다. 눈에 보이는 주체의 위치만, 추정 금지.
- 생략해야 하는 경우(이럴 땐 subjectBox 키 자체를 넣지 마세요):
  · 주체(과일/상품)가 프레임 대부분(가로·세로 각각 대략 85% 이상)을 채워 크롭할 여지가 없을 때.
  · 주체가 여기저기 흩어져 하나의 사각형으로 감싸기 어렵거나 위치가 불확실할 때.
  · 사람 얼굴·손·글자(문구·라벨)가 주인공인 사진일 때.

철칙:
- 주어진 imageId 만 그대로 사용하세요. 없는 사진을 지어내지 말고, 각 사진마다 항목 1개씩만 만드세요.
- 확신이 없어도 7개 역할 중 가장 가까운 것을 고르세요(역할을 비우지 마세요).
- 이모지·마크다운·설명 문장 없이 JSON 하나만 출력하세요.

출력 형식(JSON 한 개만. 코드펜스·설명·인사 금지. subjectBox 는 확실할 때만, 아니면 그 키 생략):
{
  "items": [
    { "imageId": "주어진값", "role": "hero", "heroScore": 8, "blurry": false, "dark": false, "visibleNote": "사진에 보이는 것 한 줄", "subjectBox": { "x": 0.12, "y": 0.1, "w": 0.7, "h": 0.72 } },
    { "imageId": "주어진값2", "role": "whole", "heroScore": 6, "blurry": false, "dark": false, "visibleNote": "사진에 보이는 것 한 줄" }
  ]
}`

/** 카테고리 코드 → 한국어 라벨(프롬프트 문맥용). 미지 값은 그대로 노출. */
const CATEGORY_LABEL: Record<string, string> = {
  fruit: "과일",
  veggie: "채소",
  other: "기타",
}

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
 * 계약상 사진은 JPEG 다운스케일이므로 대개 image/jpeg. 다른 허용 타입이 오면 존중하고,
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
 * 사진 분석용 user 메시지 빌드.
 * 각 사진 바로 앞에 [사진 N] imageId 텍스트를 두어 모델이 imageId↔사진을 매핑하게 한다.
 * dataURL 파싱 실패 사진은 조용히 스킵(나머지만 분석 — 빈응답이면 어댑터가 null 반환).
 */
export function buildPhotoAnalysisMessages(
  photos: { id: string; dataUrl: string }[],
  context: { productType: string; category: string },
): MessageParam[] {
  const productType = sanitizeString(context.productType) || "(미입력)"
  const categoryLabel = CATEGORY_LABEL[context.category] ?? context.category

  const imageBlocks: ContentBlockParam[] = []
  const sentIds: string[] = []
  for (let i = 0; i < photos.length; i++) {
    const p = photos[i]
    const parsed = parseImageDataUrl(p.dataUrl)
    if (!parsed) continue
    sentIds.push(p.id)
    imageBlocks.push({ type: "text", text: `[사진 ${sentIds.length}] imageId: "${p.id}"` })
    imageBlocks.push({
      type: "image",
      source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
    })
  }

  const header: ContentBlockParam = {
    type: "text",
    text: `상품 종류: ${productType} (${categoryLabel})
아래 ${sentIds.length}장의 사진을 분석하세요. 각 사진 바로 앞의 [사진 N] 줄에 그 사진의 imageId 가 적혀 있습니다.
imageId 는 그 값을 그대로 사용하고, 없는 사진을 지어내지 마세요.`,
  }

  const footer: ContentBlockParam = {
    type: "text",
    text: `위 ${sentIds.length}장 각각에 대해 role / heroScore(0~10) / blurry / dark / visibleNote 를 판정하고,
과일/상품 주체 위치가 뚜렷하면 subjectBox(0~1 정규화)도 덧붙여,
시스템 프롬프트의 JSON 스키마({ "items": [...] }) 하나로만 응답하세요.
visibleNote 는 사진에 실제로 보이는 것만(품종·산지·당도·맛 추정 금지, 60자 이내). imageId 는 위 값 그대로.
subjectBox 는 확실할 때만(주체가 프레임 대부분이거나 불확실하거나 사람·글자 위주면 생략).`,
  }

  return [{ role: "user", content: [header, ...imageBlocks, footer] }]
}
