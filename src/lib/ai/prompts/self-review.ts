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

/* ============================================================================
 * v5.8(작업④C): 카피 사실·표현 자가검수 (COPY self-review)
 *
 * ⚠️ 위 SELF_REVIEW_*는 "완성 아트보드 JPG 시각 위생" 전용(오타·문구·사실 판단 금지).
 *    아래는 그와 별개의 "카피 내용" 자가검수 3건 — 생성된 카피 텍스트/입력을 코드로
 *    결정적 검사(AI 불필요)한다. 시각 프롬프트/출력 스키마(validateSelfReview)는 건드리지 않는다.
 *
 * 규칙 3건(기획 ④):
 *  1) 고당도/당도선별/특대과/대과 등 등급 형용사가 있는데 대응 당도(Brix)/중량 입력이 없으면 경고.
 *  2) 후기가 전량 5.0 만점이면 4점대 솔직 후기 1개 추가 권장 경고.
 *  3) 질병명 + 효능 표현 감지 시 리젝 수준 경고 + 섭취상황 치환 제시(치환 사전은 아래 상수).
 *
 * 소비처(다른 에이전트가 배선): refine-copy.ts 심사 / validate.ts / 생성 폼 경고 배너.
 * 이 파일은 순수 검사 함수·상수만 제공하고 어디에도 자동 배선하지 않는다(파일 소유권 경계).
 * ==========================================================================*/

export type CopyReviewSeverity = "warn" | "reject"

export interface CopyReviewFinding {
  /** 규칙 식별자. */
  code: "grade-without-metric" | "all-five-star" | "medical-efficacy"
  severity: CopyReviewSeverity
  /** 셀러 눈높이 한국어 경고 한 줄. */
  message: string
  /** 앱에서 바로 할 수 있는 조치/치환 제안(선택). */
  suggestion?: string
}

/**
 * 규칙 3: 질병·효능 표현 → 섭취상황 치환 사전(코드 상수).
 * key(효능·건강 개념) 감지 시 value(섭취상황 표현)로 바꾸도록 제안한다.
 * value는 효능 주장이 아닌 "언제 먹으면 좋은지" 상황 문구만 담는다(식약처 §8 안전).
 */
export const EFFICACY_SUBSTITUTIONS: Record<string, string> = {
  면역력: "환절기에 챙겨 먹기 좋은",
  감기: "쌀쌀할 때 곁에 두고 먹기 좋은",
  항산화: "매일 한 알씩 챙기기 좋은",
  다이어트: "가볍게 즐기는 간식으로",
  변비: "아침 식탁에 곁들이기 좋은",
  디톡스: "물 대신 산뜻하게 즐기는",
  해독: "물 대신 챙겨 마시기 좋은",
  혈압: "식탁에 자주 올리기 좋은",
  혈당: "간식 대신 부담 없이 먹기 좋은",
  피부: "매일 챙겨 먹기 좋은",
  갱년기: "부모님 챙겨 드리기 좋은",
  눈: "책상 위에 두고 먹기 좋은",
}

/** 규칙 1: 당도(Brix) 근거가 필요한 단맛 등급 형용사. */
const SWEETNESS_GRADE_TERMS = ["고당도", "당도선별", "당도 선별", "당도보장", "꿀맛", "특상품"]
/** 규칙 1: 중량(g) 근거가 필요한 크기 등급 형용사. */
const SIZE_GRADE_TERMS = ["특대과", "특대", "대과", "왕과", "특대형"]

/** 규칙 3: 질병·증상명(식약처 §8 1·2호 위험). forbidden-words Tier1과 정합. */
const DISEASE_TERMS = [
  "감기", "변비", "혈압", "고혈압", "혈당", "당뇨", "암", "아토피", "비염",
  "콜레스테롤", "갱년기", "불면", "두통", "관절", "염증", "지방간", "고지혈",
]
/** 규칙 3: 효능·기능성 표현(질병명과 결합 시 리젝). */
const EFFICACY_TERMS = [
  "예방", "치료", "치유", "개선", "완화", "면역력", "항산화", "디톡스",
  "해독", "다이어트", "억제", "감소", "강화", "증진",
]

/**
 * 규칙 1: 등급 형용사 ↔ 수치 입력 정합 검사.
 * "고당도/당도선별" 등이 있는데 brix 미입력 → 경고. "특대과/대과" 등이 있는데 중량 미입력 → 경고.
 * 실제 측정값 입력을 유도(소비자원 조사 인용)한다.
 */
export function detectGradeWithoutMetric(
  text: string,
  opts: { hasBrix: boolean; hasWeight: boolean },
): CopyReviewFinding[] {
  if (!text) return []
  const out: CopyReviewFinding[] = []
  const sweet = SWEETNESS_GRADE_TERMS.find((t) => text.includes(t))
  if (sweet && !opts.hasBrix) {
    out.push({
      code: "grade-without-metric",
      severity: "warn",
      message: `'${sweet}' 표현이 있는데 당도(Brix) 입력이 없어요. 한국소비자원 조사에서 근거 없는 당도 표시는 소비자 불신·표시광고 위반 위험이 큽니다.`,
      suggestion: "실제 측정 당도(Brix)를 입력하거나 그 표현을 빼세요.",
    })
  }
  const size = SIZE_GRADE_TERMS.find((t) => text.includes(t))
  if (size && !opts.hasWeight) {
    out.push({
      code: "grade-without-metric",
      severity: "warn",
      message: `'${size}' 표현이 있는데 중량(g) 입력이 없어요. 크기 등급도 숫자 근거가 있어야 신뢰를 얻습니다.`,
      suggestion: "개당 평균 중량(g)이나 총 중량을 입력하거나 그 표현을 빼세요.",
    })
  }
  return out
}

/**
 * 규칙 2: 후기 별점이 전량 5.0 만점이면 4점대 후기 1개 추가 권장.
 * 입력된(정의된) 별점만 본다. 별점 2개 미만이면 판단 보류(빈 배열).
 */
export function detectAllFiveStar(
  ratings: ReadonlyArray<number | null | undefined>,
): CopyReviewFinding[] {
  const rated = ratings.filter(
    (r): r is number => typeof r === "number" && Number.isFinite(r),
  )
  if (rated.length < 2) return []
  if (!rated.every((r) => r === 5)) return []
  return [
    {
      code: "all-five-star",
      severity: "warn",
      message: "후기 별점이 전부 5.0 만점이에요. 만점 일색은 오히려 신뢰를 떨어뜨릴 수 있어요.",
      suggestion: "4점대 솔직 후기를 1개 정도 추가하는 걸 권장해요.",
    },
  ]
}

/**
 * 규칙 3: 질병명 + 효능 표현 동시 감지 시 리젝 수준 경고 + 섭취상황 치환 제시.
 * 치환 문구는 EFFICACY_SUBSTITUTIONS에서 매칭, 없으면 일반 섭취상황 문구로.
 */
export function detectMedicalEfficacy(text: string): CopyReviewFinding[] {
  if (!text) return []
  const disease = DISEASE_TERMS.find((d) => text.includes(d))
  const efficacy = EFFICACY_TERMS.find((e) => text.includes(e))
  // 질병명 없이 "면역력/항산화/디톡스/다이어트" 단독도 건기식 오인(§8 4호)이므로 리젝.
  const standaloneClaim = ["면역력", "항산화", "디톡스", "해독", "다이어트"].find((e) =>
    text.includes(e),
  )
  if (!(disease && efficacy) && !standaloneClaim) return []
  const hitKey = disease ?? standaloneClaim ?? efficacy ?? ""
  const substitution =
    Object.entries(EFFICACY_SUBSTITUTIONS).find(([k]) => text.includes(k))?.[1] ??
    "제철에 챙겨 먹기 좋은"
  const phrase = disease && efficacy ? `${disease}·${efficacy}` : standaloneClaim ?? hitKey
  return [
    {
      code: "medical-efficacy",
      severity: "reject",
      message: `'${phrase}' 같은 질병·효능 표현은 식약처 §8 위반이라 반드시 빼야 해요.`,
      suggestion: `대신 "${substitution}" 처럼 섭취상황으로 바꾸세요.`,
    },
  ]
}

/**
 * 규칙 1~3 통합 실행. 생성된 카피 전체 텍스트와 입력 신호를 받아 findings를 모은다.
 * @param copyText  카피 필드를 이어붙인 전체 텍스트(headline·story·keyPoints 등).
 * @param opts.hasBrix   당도(Brix) 입력 존재 여부.
 * @param opts.hasWeight 중량 입력 존재 여부.
 * @param opts.reviewRatings 셀러 입력 후기 별점 배열(미입력은 undefined).
 */
export function runCopySelfReview(
  copyText: string,
  opts: {
    hasBrix: boolean
    hasWeight: boolean
    reviewRatings?: ReadonlyArray<number | null | undefined>
  },
): CopyReviewFinding[] {
  return [
    ...detectMedicalEfficacy(copyText),
    ...detectGradeWithoutMetric(copyText, { hasBrix: opts.hasBrix, hasWeight: opts.hasWeight }),
    ...detectAllFiveStar(opts.reviewRatings ?? []),
  ]
}
