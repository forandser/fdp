/**
 * Claude 응답 검증.
 *
 * 응답이 JSON 형식이라도 필드 누락/타입 어긋남으로 후속 컴포넌트가 폭주할 수 있음.
 * 화이트리스트 키만 복사 (prototype pollution 방어 포함).
 */

import type {
  CopyOutput,
  CopySpec,
  CopyFAQ,
  CopyKeyPoint,
  CopyProblemArc,
  ResearchResult,
  ResearchSource,
} from "./types"

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

/** 글자 수 상한 (v5: 코드에서도 강제 자르기). */
const LIMITS = {
  headline: 16,
  subheadline: 32,
  keyPointTitle: 18,
  keyPointBody: 120,
  highlightBox: 30,
  problemArcQuestion: 44,
  problemArcProblem: 28,
  // v4.3: 히어로 후킹 캡션 — 목표 12~24자이나 관대하게 40자까지 허용(초과분만 절삭).
  heroKicker: 40,
} as const

/** problemArc.problems 최대 개수 (keyPoints 3개와 1:1 호응 — 2~3개). */
const MAX_PROBLEM_ARC_PROBLEMS = 3

/** 헤드라인 후보 최대 개수 (AI 5개 + fruit-facts 무료 합류분 여유 = 8). */
export const MAX_HEADLINE_CANDIDATES = 8

/** 헤드라인 후보 중복 판정용 정규화 — 공백/문장부호 제거 후 소문자화. */
export function normalizeHeadlineCandidate(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[.,!?·…"'()[\]{}]/g, "")
}

/**
 * 헤드라인 후보 배열 검증 — 문자열만, headline 상한으로 자르고,
 * 정규화 기준 중복 제거, 최대 MAX_HEADLINE_CANDIDATES개.
 * 결과가 비면 undefined 반환(옵셔널 필드 — 칩 영역 자체를 숨기게).
 */
export function pickHeadlineCandidates(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of v) {
    if (typeof item !== "string") continue
    const trimmed = trimTo(item.trim(), LIMITS.headline)
    if (!trimmed) continue
    const norm = normalizeHeadlineCandidate(trimmed)
    if (!norm || seen.has(norm)) continue
    seen.add(norm)
    out.push(trimmed)
    if (out.length >= MAX_HEADLINE_CANDIDATES) break
  }
  return out.length > 0 ? out : undefined
}

/** 진부어 목록 (v8: 60종+ — AI 티 완전 제거). */
const CLICHES = [
  "정성껏", "특별한", "다양한", "완벽한", "풍부한", "신선한", "최고의", "최상의", "엄선한", "프리미엄급",
  "남다른", "최고급의", "특별히", "각별한", "독특한", "매력적인", "환상적인", "최적의", "이상적인", "탁월한",
  "독보적인", "압도적인", "그야말로", "정말로", "진정한", "참된", "본연의", "본질적인", "특화된", "전문화된",
  "최상품", "프리미엄", "감성적인", "아름다운", "고급스러운", "우아한", "세련된", "고품질의", "프리미엄한", "고급의",
  "감미로운", "달콤한 향기가 가득", "입안 가득", "온 가족이", "남녀노소", "온정성을", "정성을 다해", "한가득", "가득 담은", "넘치는",
  // v8 추가 — AI 번역투/유행어
  "강력 추천", "강추", "대박", "꿀템", "결론적으로", "시사하는 바", "다음과 같습니다",
] as const

/** AI 번역투 패턴 (v8). */
const AI_TRANSLATION_PATTERNS: RegExp[] = [
  /~?을\s*위한/,
  /~?을\s*제공합니다/,
  /~?에\s*있어서/,
  /~?을\s*통해/,
  /결론적으로/,
  /시사하는\s*바/,
  /다음과\s*같습니다/,
  /첫째[^.]*둘째[^.]*셋째/,
]

/** SEO 어뷰징 단어 — 상품명에 박으면 노출 페널티 (네이버 가이드). */
const SEO_ABUSE_WORDS = [
  "무료배송",
  "할인",
  "특가",
  "신선하고",
  "맛있는",
  "꿀템",
  "강추",
]

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

/** AI 번역투 등장 횟수. */
export function countAiTranslationStyle(text: string): number {
  if (!text) return 0
  let count = 0
  for (const re of AI_TRANSLATION_PATTERNS) {
    const re2 = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")
    let m: RegExpExecArray | null
    while ((m = re2.exec(text)) !== null) {
      count++
      if (m.index === re2.lastIndex) re2.lastIndex++
    }
  }
  return count
}

/** 같은 술어 어미가 연속 3문장 이상 반복되는지 검출. */
export function hasMonotonousSentenceEnding(text: string): boolean {
  if (!text) return false
  // 문장을 마침표/물음표/느낌표로 분리
  const sentences = text
    .split(/[.!?。!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
  if (sentences.length < 3) return false
  // 마지막 어미(2~3글자) 추출
  const endings = sentences.map((s) => s.slice(-3))
  // 3연속 동일 어미 검사
  for (let i = 0; i <= endings.length - 3; i++) {
    if (endings[i] === endings[i + 1] && endings[i] === endings[i + 2]) {
      return true
    }
  }
  return false
}

/** 의문문 또는 감탄문이 최소 1회 등장하는지. */
export function hasInquiryOrExclaim(text: string): boolean {
  if (!text) return false
  return /[?!]/.test(text)
}

/** SEO 상품명 검증 (네이버쇼핑 가이드). */
export interface SeoCheckResult {
  ok: boolean
  length: number
  tokens: string[]
  warnings: { type: "tooLong" | "duplicateToken" | "abuseWord" | "tooFewKeywords"; detail: string }[]
}
export function validateProductNameSeo(name: string): SeoCheckResult {
  const trimmed = name.trim()
  const warnings: SeoCheckResult["warnings"] = []
  // 49자 초과 검사 (네이버쇼핑 50자 미만 권장)
  if (trimmed.length > 49) {
    warnings.push({ type: "tooLong", detail: `${trimmed.length}자 — 49자 이하 권장` })
  }
  // 어뷰징 단어 검사
  for (const w of SEO_ABUSE_WORDS) {
    if (trimmed.includes(w)) {
      warnings.push({ type: "abuseWord", detail: `"${w}"는 어뷰징 단어로 노출 페널티 가능` })
    }
  }
  // 토큰화 (공백 기준)
  const tokens = trimmed.split(/\s+/).filter(Boolean)
  if (tokens.length < 3) {
    warnings.push({ type: "tooFewKeywords", detail: "키워드 4~8개 권장 (산지·품종·중량 등)" })
  }
  // 중복 토큰 검사
  const seen = new Set<string>()
  for (const tok of tokens) {
    if (seen.has(tok)) {
      warnings.push({ type: "duplicateToken", detail: `"${tok}" 중복` })
      break
    }
    seen.add(tok)
  }
  return {
    ok: warnings.length === 0,
    length: trimmed.length,
    tokens,
    warnings,
  }
}

/** 후킹 헤드라인 유형 자동 식별.
 *  (A) 시간단축 / (B) 기능강화 / (C) 변화 / (D) 산지·품종 명사형 / null = 불명. */
export type HookType = "time" | "feature" | "transform" | "identity" | null

/** 산지 지역명 확장 리스트 (규칙 41-D). */
const REGION_PATTERNS =
  /(청송|영주|안동|경산|영천|성주|나주|천안|안성|평택|울산|김천|영동|상주|충주|담양|논산|진주|산청|보성|해남|제주|서귀포|남원|위미|표선|부여|고창|함평|함안|고령|칠곡|사천|경산|화성|강진|영암|영광|김해|음성|이천|원주|영천|무안|양양)/

export function detectHookType(headline: string): HookType {
  if (!headline) return null
  const h = headline.trim()
  // 시간 단축 — 시간 단위 + 숫자 / "수확/발송" 시간 관련
  if (/\d+\s*(시간|일|시|분)/.test(h) || /수확.*보냅|당일|새벽|즉시/.test(h)) return "time"
  // 기능 강화 — Brix·g·이상·선별·골라
  if (/(Brix|brix|당도|\d+\s*g)\s*(이상|선별|골)/.test(h) || /\d+\s*(이상|만)/.test(h)) return "feature"
  // 변화 — 동사형 + 감각
  if (/(터지|녹|아삭|향이|입안|톡|사각)/.test(h) || /(드세요|드시면)/.test(h)) return "transform"
  // 산지·품종 명사형 — 전통 산지직송 스타일 (규칙 41-D)
  if (REGION_PATTERNS.test(h)) return "identity"
  return null
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

/**
 * 문제 제기 서사 아크 검증 — 공감 질문 + 문제 2~3개.
 * question 또는 problems(1개 이상)가 없으면 undefined 반환(옵셔널 — 블록 미노출).
 * 각 필드 상한으로 자르고, problems는 빈 문자열 제거 후 최대 3개.
 */
export function pickProblemArc(v: unknown): CopyProblemArc | undefined {
  if (!isObject(v)) return undefined
  if (Object.keys(v).some((k) => FORBIDDEN_KEYS.has(k))) return undefined
  const question = trimTo(safeString(v.question), LIMITS.problemArcQuestion)
  const problems = safeStringArray(v.problems)
    .map((p) => trimTo(p, LIMITS.problemArcProblem))
    .filter(Boolean)
    .slice(0, MAX_PROBLEM_ARC_PROBLEMS)
  if (!question || problems.length === 0) return undefined
  return { question, problems }
}

/** v3.5: 리서치 결과 각 배열 항목 최대 개수 / 길이 상한. */
const RESEARCH_LIMITS = {
  listItems: 6,
  listItemLen: 80,
  seasonInfo: 120,
  storageTips: 200,
  sources: 8,
  sourceTitle: 120,
  sourceUrl: 300,
  // v4.2: 상품명 리서치 강화 필드 상한.
  sellingAngles: 5,
  commonComplaints: 4,
  namingNotes: 160,
  // v4.3: 시장 후킹 문구 — 개수 6개, 각 60자로 관대하게 절삭(하위호환).
  hookPhrases: 6,
  hookPhraseLen: 60,
} as const

/** 안전한 출처 URL만 통과 (http/https + 파싱 가능). 그 외(javascript: 등)는 버린다. */
function pickSafeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim().slice(0, RESEARCH_LIMITS.sourceUrl)
  if (!/^https?:\/\//i.test(s)) return null
  try {
    const u = new URL(s)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    return u.toString()
  } catch {
    return null
  }
}

function pickResearchSources(v: unknown): ResearchSource[] {
  if (!Array.isArray(v)) return []
  const out: ResearchSource[] = []
  const seen = new Set<string>()
  for (const item of v) {
    if (!isObject(item)) continue
    if (Object.keys(item).some((k) => FORBIDDEN_KEYS.has(k))) continue
    const url = pickSafeUrl(item.url)
    if (!url || seen.has(url)) continue
    const title = trimTo(safeString(item.title), RESEARCH_LIMITS.sourceTitle) || url
    seen.add(url)
    out.push({ title, url })
    if (out.length >= RESEARCH_LIMITS.sources) break
  }
  return out
}

function pickResearchList(
  v: unknown,
  max: number = RESEARCH_LIMITS.listItems,
  itemLen: number = RESEARCH_LIMITS.listItemLen,
): string[] {
  return safeStringArray(v)
    .map((s) => trimTo(s, itemLen))
    .filter(Boolean)
    .slice(0, max)
}

/**
 * v3.5: 리서치 결과 화이트리스트 검증.
 * 유의미한 내용(리스트 항목 또는 season/storage 문자열)이 하나도 없으면 null 반환
 * → 요약 패널 미노출 + draft 주입 생략(빈 리서치 블록 방지).
 */
export function validateResearchResult(raw: unknown): ResearchResult | null {
  if (!isObject(raw)) return null

  // v4.2: 상품명 리서치 강화 필드 — 개수 상한으로 자르고, 비면 키 자체를 생략(하위호환).
  const sellingAngles = pickResearchList(raw.sellingAngles, RESEARCH_LIMITS.sellingAngles)
  const commonComplaints = pickResearchList(raw.commonComplaints, RESEARCH_LIMITS.commonComplaints)
  const namingNotes = trimTo(safeString(raw.namingNotes), RESEARCH_LIMITS.namingNotes)
  // v4.3: 시장 후킹 문구 — 최대 6개, 각 60자로 관대하게 절삭. 비면 키 생략(하위호환).
  const hookPhrases = pickResearchList(
    raw.hookPhrases,
    RESEARCH_LIMITS.hookPhrases,
    RESEARCH_LIMITS.hookPhraseLen,
  )

  const result: ResearchResult = {
    varietyNotes: pickResearchList(raw.varietyNotes),
    seasonInfo: trimTo(safeString(raw.seasonInfo), RESEARCH_LIMITS.seasonInfo),
    storageTips: trimTo(safeString(raw.storageTips), RESEARCH_LIMITS.storageTips),
    consumerInterests: pickResearchList(raw.consumerInterests),
    faqSeeds: pickResearchList(raw.faqSeeds),
    // 옵셔널 — 빈 값이면 키를 넣지 않아 구버전 저장본과 동일 형태 유지.
    ...(sellingAngles.length > 0 ? { sellingAngles } : {}),
    ...(commonComplaints.length > 0 ? { commonComplaints } : {}),
    ...(namingNotes ? { namingNotes } : {}),
    ...(hookPhrases.length > 0 ? { hookPhrases } : {}),
    sources: pickResearchSources(raw.sources),
  }

  const hasContent =
    result.varietyNotes.length > 0 ||
    result.consumerInterests.length > 0 ||
    result.faqSeeds.length > 0 ||
    result.seasonInfo.length > 0 ||
    result.storageTips.length > 0 ||
    sellingAngles.length > 0 ||
    commonComplaints.length > 0 ||
    namingNotes.length > 0 ||
    hookPhrases.length > 0
  return hasContent ? result : null
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

  const headlineCandidates = pickHeadlineCandidates(raw.headlineCandidates)
  const problemArc = pickProblemArc(raw.problemArc)
  // v4.3: 히어로 후킹 캡션 — 40자로 관대하게 절삭. 비면 키 생략(구버전 저장본과 동일 형태,
  // A 렌더가 기본 캡션으로 폴백). 필드명 정확히 "heroKicker" — A 에이전트 소비 계약.
  const heroKicker = trimTo(safeString(raw.heroKicker), LIMITS.heroKicker)

  return {
    headline: trimTo(safeString(raw.headline), LIMITS.headline),
    // 옵셔널 — 후보 없으면 키 자체를 넣지 않아 하위호환 유지.
    ...(headlineCandidates ? { headlineCandidates } : {}),
    // 옵셔널 — 히어로 후킹 캡션 없으면(구버전/생성 실패) 키 생략.
    ...(heroKicker ? { heroKicker } : {}),
    // 옵셔널 — 서사 아크 없으면(구버전/생성 실패) 키 생략 → 블록 미노출.
    ...(problemArc ? { problemArc } : {}),
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
