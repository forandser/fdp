/**
 * v6.3(작업1): AI 타이포 히어로 — 헤드라인을 "한글 레터링 아트 이미지"로 승격.
 *
 * 이 모듈은 **순수(pure)** 하다: 네트워크·프로바이더 싱글턴을 부르지 않고,
 * 프롬프트 문자열과 결정적 매핑·비교 유틸만 제공한다(순환 의존 회피).
 * 실제 호출/재시도 오케스트레이션은 DetailMaker(작업4)가 담당한다.
 *
 * ⚠️ 사진 불가침(사용자 원칙): 여기서 만드는 프롬프트는 **텍스트·스타일 지시만** 담는다.
 *    셀러 사진(참조 이미지)은 절대 이미지 생성에 넣지 않는다 — 호출부(Gemini generate)에
 *    referenceImage 를 전달하지 않음으로써 코드 수준으로 보장한다.
 *
 * 파이프라인:
 *  1) buildFruitMoodHints(productName, accentHex) → 과일 무드(결정적, 랜덤 금지)
 *  2) buildTypoPrompt(headline, hints, attempt)   → Gemini(나노바나나) 이미지 프롬프트
 *  3) (Gemini 생성) → dataUrl
 *  4) buildTypoVerifyMessages + typoTextMatches   → 오탈자 게이트(Claude vision)
 */

import type {
  ContentBlockParam,
  MessageParam,
} from "@anthropic-ai/sdk/resources/messages"
import {
  detectFruitFactKey,
  FRUIT_FACTS,
  getVisualDNA,
} from "@/domain/fruit-facts"

/* ───────────────── 스타일 프리셋 ───────────────── */

/** 레터링 스타일 프리셋 키 — 과일 무드로 "결정적" 선택(랜덤 금지). */
export type TypoStyleKey = "juicy" | "brush" | "poster"

interface TypoStylePreset {
  /** 프롬프트에 넣을 스타일 설명(영문 — 이미지 모델 지시 안정성). */
  promptFragment: string
  /** 질감/획 힌트 한 줄. */
  texture: string
}

export const TYPO_STYLE_PRESETS: Record<TypoStyleKey, TypoStylePreset> = {
  // 과즙감·물러운 과일 — 부드러운 곡선 + 과즙 그라데이션(복숭아 예시).
  juicy: {
    promptFragment:
      "soft, rounded hand-lettering with a juicy, glossy feel; gentle curves; subtle glossy gradient in the accent color as if ripe fruit juice; friendly and appetizing",
    texture: "부드러운 곡선 · 과즙 광택 그라데이션",
  },
  // 전통·프리미엄·저장성 과일 — 붓글씨/캘리그라피.
  brush: {
    promptFragment:
      "elegant Korean calligraphy / brush-stroke lettering (붓글씨); confident tapered brush strokes with natural ink texture; premium, hand-crafted, artisanal mood",
    texture: "붓글씨 획 · 자연스러운 먹 번짐",
  },
  // 감귤·만감류·감·팝 컬러 — 굵고 선명한 포스터 타이포.
  poster: {
    promptFragment:
      "bold, punchy poster typography; thick condensed Korean letterforms; high-contrast, cheerful and vivid pop-color mood; clean modern display lettering",
    texture: "굵은 포스터 획 · 선명한 팝 컬러",
  },
}

/**
 * 과일 fact 키 → 스타일 프리셋(결정적). 미매칭이면 juicy.
 * 근거: 무른 과육/과즙 = juicy, 감귤·감·팝 = poster, 전통·프리미엄·저장 = brush.
 */
const STYLE_BY_FRUIT: Record<string, TypoStyleKey> = {
  // juicy — 과즙·물러운 과일
  복숭아: "juicy",
  딸기: "juicy",
  수박: "juicy",
  자두: "juicy",
  포도: "juicy",
  샤인머스캣: "juicy",
  체리: "juicy",
  블루베리: "juicy",
  망고: "juicy",
  멜론: "juicy",
  토마토: "juicy",
  // poster — 감귤·만감류·감·노란 팝
  감귤: "poster",
  한라봉: "poster",
  천혜향: "poster",
  레드향: "poster",
  황금향: "poster",
  카라향: "poster",
  단감: "poster",
  곶감: "poster",
  참외: "poster",
  바나나: "poster",
  파인애플: "poster",
  // brush — 전통·프리미엄·저장 과일
  사과: "brush",
  배: "brush",
  키위: "brush",
  매실: "brush",
}

/** 무드 힌트 — buildTypoPrompt 에 넘길 재료(결정적). */
export interface FruitMoodHints {
  /** 강조색 hex(#RRGGBB) — 히어로 accent 와 정합(호출부가 resolveAccent 로 산출). */
  accentHex: string
  /** 결정적으로 선택된 스타일 프리셋. */
  style: TypoStyleKey
  /** 무드 단어(감각어·의성어·비주얼 포인트에서 채집 — 사실값 아님, 톤 지시용). */
  moodWords: string[]
}

/** hex 형식 방어 — 아니면 브랜드 기본 코랄로 폴백. */
function safeHex(hex: string): string {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex) ? hex : "#D13F37"
}

/**
 * 과일 무드 힌트를 결정적으로 산출한다(Math.random/Date 금지).
 * moodWords 는 도메인 사전(감각어·의성어·VisualDNA 포인트)에서만 채집 — 새 사실을 창작하지 않는다.
 */
export function buildFruitMoodHints(
  productName: string,
  accentHex: string,
): FruitMoodHints {
  const key = detectFruitFactKey(productName)
  const style: TypoStyleKey = (key && STYLE_BY_FRUIT[key]) || "juicy"
  const words: string[] = []
  const seen = new Set<string>()
  const push = (w?: string | null) => {
    const s = (w ?? "").trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      words.push(s)
    }
  }
  if (key) {
    const fact = FRUIT_FACTS[key]
    if (fact) {
      push(fact.onomatopoeia)
      for (const s of fact.sensoryWords ?? []) push(s)
    }
    const dna = getVisualDNA(key)
    for (const p of dna?.points ?? []) push(p)
  }
  return {
    accentHex: safeHex(accentHex),
    style,
    // 무드 지시는 4개면 충분(프롬프트 과부하 방지).
    moodWords: words.slice(0, 4),
  }
}

/* ───────────────── 생성 프롬프트 ───────────────── */

/**
 * Gemini(나노바나나) 이미지 프롬프트 빌드.
 * - 투명 배경 한글 레터링, 가로형 배너(약 3:1), 과일 무드/accent 연동.
 * - "글자 외 요소(과일 그림·배경 사진) 금지" + "정확한 문자열" 명시(오탈자 방어의 1차선).
 * - attempt>0(재시도): 철자 정확도 경고를 강화한다.
 * - ⚠️ 셀러 사진을 넣지 않는다(텍스트·스타일 지시만) — 호출부가 referenceImage 미전달.
 */
export function buildTypoPrompt(
  headlineText: string,
  hints: FruitMoodHints,
  attempt = 0,
): string {
  const text = (headlineText ?? "").trim()
  const preset = TYPO_STYLE_PRESETS[hints.style] ?? TYPO_STYLE_PRESETS.juicy
  const mood =
    hints.moodWords.length > 0
      ? `Mood keywords (for tone only, do NOT render these words): ${hints.moodWords.join(", ")}.`
      : ""
  const retryGuard =
    attempt > 0
      ? `\nThis is retry #${attempt}. The previous image had a spelling error. Render EVERY Korean syllable block exactly and completely — do not drop, merge, add, or alter any character.`
      : ""

  return [
    "Create a horizontal banner of KOREAN typographic lettering art (한글 레터링/캘리그라피).",
    `Aspect ratio about 3:1 (wide banner). Transparent (alpha) background — no background fill, no scene, no photo.`,
    `Style: ${preset.promptFragment}.`,
    `Use ${hints.accentHex} as the dominant lettering color (tasteful tonal variation of it is fine).`,
    mood,
    "STRICT RULES:",
    "- Render ONLY the exact text below as lettering. Nothing else.",
    "- NO fruit illustrations, NO drawings, NO photographs, NO background scenery, NO decorative icons, NO watermark, NO signature, NO extra words or letters.",
    "- Do NOT translate or romanize. Keep the Korean characters exactly as given.",
    "- The characters must be perfectly legible and spelled EXACTLY as written, including every space and particle (조사).",
    "- Render ONLY the text on the line below. Do NOT draw any surrounding brackets, quotation marks, corner brackets (「」), or other boundary/frame marks — they are not part of the text.",
    retryGuard,
    "",
    "TEXT TO RENDER (exactly, character for character — the text is the single line below):",
    text,
  ]
    .filter(Boolean)
    .join("\n")
}

/* ───────────────── 오탈자 게이트(vision) ───────────────── */

/** 오탈자 검수 응답 max_tokens (짧은 JSON 한 줄 — 여유 있게 300). */
export const TYPO_VERIFY_MAX_TOKENS = 300

export const TYPO_VERIFY_SYSTEM_PROMPT = `당신은 이미지 속 글자를 그대로 읽어 주는 OCR 검수자입니다.
주어진 이미지에는 한글 레터링(글씨 디자인)이 들어 있습니다.
이미지에 실제로 그려진 글자를 "보이는 그대로" 한 글자도 빼거나 더하지 말고 읽으세요.
- 장식·꾸밈 때문에 헷갈려도 실제로 그려진 글자만 읽습니다(추측·보정 금지).
- 맞춤법을 교정하지 마세요. 틀리게 그려졌으면 틀린 그대로 읽습니다.
- 글자 외 그림·아이콘·배경은 무시하고 글자만 옮깁니다.

출력 형식(JSON 한 개만. 코드펜스·설명·인사 금지):
{ "read": "이미지에서 읽은 글자 그대로" }`

/** 허용 이미지 media_type(SDK Base64ImageSource 와 일치). */
type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp"
const ALLOWED_MEDIA_TYPES: ReadonlySet<string> = new Set<ImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
])

/** dataURL → { mediaType, base64 }. data URL 이 아니거나 페이로드가 비면 null. */
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
    : "image/png"
  return { mediaType, data }
}

/**
 * 오탈자 검수용 vision 메시지 빌드. dataURL 파싱 실패 시 null(호출부가 검수 실패로 처리).
 */
export function buildTypoVerifyMessages(
  imageDataUrl: string,
): MessageParam[] | null {
  const parsed = parseImageDataUrl(imageDataUrl)
  if (!parsed) return null
  const content: ContentBlockParam[] = [
    {
      type: "text",
      text: "아래 이미지에 그려진 글자를 그대로 읽어 JSON({ \"read\": ... }) 하나로만 답하세요.",
    },
    {
      type: "image",
      source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
    },
  ]
  return [{ role: "user", content }]
}

/**
 * 이중 방어(작업2): 이미지 모델이 텍스트 경계로 그려 넣을 수 있는 괄호·따옴표류 구두점 + 개행만 제거.
 * 프롬프트에서 「」 래핑을 이미 걷어냈지만, 모델이 임의로 괄호·따옴표를 그려도 영구 불일치가 나지 않도록
 * 비교 단계에서도 톨러런스를 둔다.
 * ⚠️ 한글 자모·음절·조사·본문 문자는 절대 포함하지 않는다 — 오직 경계 구두점만(오탈자 검출력 유지).
 */
const TYPO_BOUNDARY_PUNCT =
  /[「」『』（）〈〉《》【】〔〕［］｛｝()\[\]{}"'“”‘’„‚«»`\n\r]/g

/**
 * 비교용 정규화 — NFC 통일 + 경계 구두점 제거 + 모든 공백 제거 + 소문자화.
 * 레터링 아트는 줄바꿈·자간·경계 괄호가 원문과 달라도 시각적으로 동등하므로 무시하되,
 * 한글 음절·조사 등 "보이는 문자"는 모두 정확히 일치해야 한다(오탈자 게이트의 핵심).
 */
export function normalizeForTypoCompare(s: string): string {
  return (s ?? "")
    .normalize("NFC")
    .replace(TYPO_BOUNDARY_PUNCT, "")
    .replace(/\s+/g, "")
    .toLowerCase()
}

/** 읽은 글자와 기대 헤드라인이 (공백 무시) 정확 일치하는가. */
export function typoTextMatches(readText: string, expected: string): boolean {
  const a = normalizeForTypoCompare(readText)
  const b = normalizeForTypoCompare(expected)
  return a.length > 0 && a === b
}
