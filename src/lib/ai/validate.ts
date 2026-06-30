/**
 * Claude 응답 검증.
 *
 * 응답이 JSON 형식이라도 필드 누락/타입 어긋남으로 후속 컴포넌트가 폭주할 수 있음.
 * 화이트리스트 키만 복사 (prototype pollution 방어 포함).
 */

import type { CopyOutput, CopySpec, CopyFAQ, CopyKeyPoint } from "./types"

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

/** 글자 수 상한 (v5: 코드에서도 강제 자르기). */
const LIMITS = {
  headline: 16,
  subheadline: 32,
  keyPointTitle: 18,
  keyPointBody: 120,
  highlightBox: 30,
} as const

/** 진부어 목록 (v6: 50종 — AI 티 완전 제거). */
const CLICHES = [
  "정성껏", "특별한", "다양한", "완벽한", "풍부한", "신선한", "최고의", "최상의", "엄선한", "프리미엄급",
  "남다른", "최고급의", "특별히", "각별한", "독특한", "매력적인", "환상적인", "최적의", "이상적인", "탁월한",
  "독보적인", "압도적인", "그야말로", "정말로", "진정한", "참된", "본연의", "본질적인", "특화된", "전문화된",
  "최상품", "프리미엄", "감성적인", "아름다운", "고급스러운", "우아한", "세련된", "고품질의", "프리미엄한", "고급의",
  "감미로운", "달콤한 향기가 가득", "입안 가득", "온 가족이", "남녀노소", "온정성을", "정성을 다해", "한가득", "가득 담은", "넘치는",
] as const

/** 문자열 길이를 상한으로 자른다. 한글/영문 모두 1자 단위. */
function trimTo(s: string, max: number): string {
  if (!s) return s
  return s.length > max ? s.slice(0, max) : s
}

/** 카피 텍스트(어떤 필드든)에서 진부어 등장 총 횟수. */
export function countCliches(text: string): number {
  if (!text) return 0
  let count = 0
  for (const word of CLICHES) {
    let from = 0
    while (true) {
      const idx = text.indexOf(word, from)
      if (idx === -1) break
      count++
      from = idx + word.length
    }
  }
  return count
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function safeString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback
}

function safeStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((s): s is string => typeof s === "string").map((s) => s.trim()).filter(Boolean)
}

function pickSpec(v: unknown): CopySpec[] {
  if (!Array.isArray(v)) return []
  const out: CopySpec[] = []
  for (const item of v) {
    if (!isObject(item)) continue
    if (Object.keys(item).some((k) => FORBIDDEN_KEYS.has(k))) continue
    const label = safeString(item.label)
    const value = safeString(item.value)
    if (label && value) out.push({ label, value })
  }
  return out
}

function pickKeyPoints(v: unknown): CopyKeyPoint[] {
  if (!Array.isArray(v)) return []
  const out: CopyKeyPoint[] = []
  for (let i = 0; i < v.length && out.length < 3; i++) {
    const item = v[i]
    if (!isObject(item)) continue
    if (Object.keys(item).some((k) => FORBIDDEN_KEYS.has(k))) continue
    const title = safeString(item.title)
    const body = safeString(item.body)
    if (!title) continue
    const num = safeString(item.num) || String(out.length + 1).padStart(2, "0")
    out.push({
      num,
      title: trimTo(title, LIMITS.keyPointTitle),
      body: trimTo(body, LIMITS.keyPointBody),
    })
  }
  return out
}

function pickFAQ(v: unknown): CopyFAQ[] {
  if (!Array.isArray(v)) return []
  const out: CopyFAQ[] = []
  for (const item of v) {
    if (!isObject(item)) continue
    if (Object.keys(item).some((k) => FORBIDDEN_KEYS.has(k))) continue
    const q = safeString(item.q)
    const a = safeString(item.a)
    if (q && a) out.push({ q, a })
  }
  return out
}

/** 응답 텍스트에서 코드펜스 제거 후 JSON 파싱 시도. */
export function extractJson(text: string): unknown {
  if (!text) throw new Error("EMPTY_RESPONSE")
  let cleaned = text.trim()
  // ```json ... ``` 제거
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "")
  try {
    return JSON.parse(cleaned)
  } catch {
    throw new Error("INVALID_JSON")
  }
}

/** 화이트리스트 검증 + 기본값 채움. */
export function validateCopyOutput(raw: unknown): CopyOutput {
  if (!isObject(raw)) throw new Error("RESPONSE_NOT_OBJECT")

  return {
    headline: trimTo(safeString(raw.headline), LIMITS.headline),
    subheadline: trimTo(safeString(raw.subheadline), LIMITS.subheadline),
    story: safeString(raw.story),
    spec: pickSpec(raw.spec),
    storage: safeString(raw.storage),
    faq: pickFAQ(raw.faq),
    highlightBadges: safeStringArray(raw.highlightBadges),
    keyPoints: pickKeyPoints(raw.keyPoints),
    highlightBox: trimTo(safeString(raw.highlightBox), LIMITS.highlightBox),
    cautions: safeStringArray(raw.cautions).slice(0, 4),
    recommendFor: safeStringArray(raw.recommendFor).slice(0, 6),
    farmStory: safeString(raw.farmStory),
  }
}
