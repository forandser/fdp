/**
 * Claude 응답 검증.
 *
 * 응답이 JSON 형식이라도 필드 누락/타입 어긋남으로 후속 컴포넌트가 폭주할 수 있음.
 * 화이트리스트 키만 복사 (prototype pollution 방어 포함).
 */

import type {
  CompositionHints,
  CopyOutput,
  CopySpec,
  CopyFAQ,
  CopyKeyPoint,
  CopyProblemArc,
  PhotoAnalysisItem,
  ResearchResult,
  ResearchSource,
  SelfReviewIssue,
  SelfReviewResult,
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

/**
 * 문자열 길이를 상한으로 자른다. 한글/영문 모두 1자 단위.
 * v4.8: 하드컷이 단어 중간을 싹둑 잘라 "3kg 선" 같은 쓰다 만 꼬리를 만들던
 * 실사용 버그 — 상한 초과 시 마지막 공백/구두점 경계까지 되돌려 자연스럽게 끝낸다.
 * 경계가 너무 앞(상한의 60% 미만)이면 정보 손실이 커서 하드컷을 유지한다.
 */
function trimTo(s: string, max: number): string {
  if (!s) return s
  if (s.length <= max) return s
  const hard = s.slice(0, max)
  let cut = -1
  for (let i = hard.length - 1; i >= 0; i--) {
    const ch = hard[i]
    if (ch === " " || ch === "," || ch === "·" || ch === "." || ch === "!" || ch === "?") {
      cut = i
      break
    }
  }
  const out = cut >= Math.floor(max * 0.6) ? hard.slice(0, cut) : hard
  // 꼬리에 남은 쉼표·가운뎃점·공백 찌꺼기 정리
  return out.replace(/[,·.\s]+$/, "")
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

/** v6.0(작업C): 동적 구성 힌트 상한·화이트리스트. */
const COMPOSITION_LIMITS = {
  sellingAngle: 60,
  heroImageId: 120,
  heroReason: 80,
  emphasisItems: 4,
  emphasisItemLen: 24,
  /** calloutTargetIndex 상한(POINT 최대 3개지만 여유롭게 — 실제 범위는 ResultView가 재검증). */
  maxCalloutIndex: 9,
} as const

/** photobreakStyle 화이트리스트 — 이 외의 값은 드롭(현행 auto와 동일 = 억제 없음). */
const PHOTOBREAK_STYLES = new Set(["collage", "cutseq", "fullbleed", "auto"])

/**
 * v6.0(작업C): 동적 구성 힌트 검증 — 값 화이트리스트·범위 검증(허위·범위 밖 차단).
 * - 각 필드는 형태/범위가 맞을 때만 채택, 아니면 그 필드만 드롭(부분 채택).
 * - heroImageId 실재성(images 대조)은 이 시점에 images가 없어 확인 불가 → 문자열만 통과시키고,
 *   실재하지 않는 id면 ResultView 소비 지점이 현행 폴백(검증 책임 분산 — 결정적·회귀 0).
 * - calloutTargetIndex 는 0~maxCalloutIndex 정수만, 실제 POINT 범위는 ResultView가 재검증.
 * - 유효 필드가 하나도 없으면 undefined 반환 → 키 생략(구버전 저장본과 동일 형태 = 회귀 0).
 */
export function pickCompositionHints(v: unknown): CompositionHints | undefined {
  if (!isObject(v)) return undefined
  if (Object.keys(v).some((k) => FORBIDDEN_KEYS.has(k))) return undefined

  const out: CompositionHints = {}

  const sellingAngle = trimTo(safeString(v.sellingAngle), COMPOSITION_LIMITS.sellingAngle)
  if (sellingAngle) out.sellingAngle = sellingAngle

  const heroImageId = safeString(v.heroImageId).slice(0, COMPOSITION_LIMITS.heroImageId)
  if (heroImageId) out.heroImageId = heroImageId

  const heroReason = trimTo(safeString(v.heroReason), COMPOSITION_LIMITS.heroReason)
  if (heroReason) out.heroReason = heroReason

  // 정수·범위 검증 — 비수치/음수/범위 밖이면 드롭(현행 자동 선택으로 폴백).
  const rawIdx = typeof v.calloutTargetIndex === "number" ? v.calloutTargetIndex : Number(v.calloutTargetIndex)
  if (
    Number.isInteger(rawIdx) &&
    rawIdx >= 0 &&
    rawIdx <= COMPOSITION_LIMITS.maxCalloutIndex
  ) {
    out.calloutTargetIndex = rawIdx
  }

  const style = safeString(v.photobreakStyle).toLowerCase()
  // "auto"는 억제 없음(현행)과 동일하므로 저장은 하되 소비 측에서 무시됨.
  if (PHOTOBREAK_STYLES.has(style)) {
    out.photobreakStyle = style as CompositionHints["photobreakStyle"]
  }

  const emphasisOrder = pickResearchList(
    v.emphasisOrder,
    COMPOSITION_LIMITS.emphasisItems,
    COMPOSITION_LIMITS.emphasisItemLen,
  )
  if (emphasisOrder.length > 0) out.emphasisOrder = emphasisOrder

  return Object.keys(out).length > 0 ? out : undefined
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
  // v6.0(작업R①): 확실도 게이트 — certain/tentative 각 5개, 각 80자.
  certaintyItems: 5,
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
 * v6.0(작업R①): 확실도 게이트 파서. certain/tentative 두 배열만 통과.
 * 둘 다 비면 undefined 반환 → 게이트 미적용(현행 동작 = 회귀 0).
 */
function pickCertainty(v: unknown): { certain: string[]; tentative: string[] } | undefined {
  if (!isObject(v)) return undefined
  const certain = pickResearchList(v.certain, RESEARCH_LIMITS.certaintyItems)
  const tentative = pickResearchList(v.tentative, RESEARCH_LIMITS.certaintyItems)
  if (certain.length === 0 && tentative.length === 0) return undefined
  return { certain, tentative }
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
  // v6.0(작업R①): 확실도 게이트 — 비면 키 생략(하위호환).
  const certainty = pickCertainty(raw.certainty)

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
    ...(certainty ? { certainty } : {}),
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

/* ───────────────── v4.4: 사진 분석 검증 ───────────────── */

/** 사진 역할 화이트리스트 — 이 외의 role 은 드롭(신뢰 불가 분류). */
const PHOTO_ROLES = ["hero", "cut", "whole", "box", "size", "farm", "table"] as const
const PHOTO_ROLE_SET: ReadonlySet<string> = new Set(PHOTO_ROLES)

/** visibleNote 글자 상한(≤60자). */
const PHOTO_VISIBLE_NOTE_MAX = 60

/** subjectBox 최소 변 길이 — 가로/세로 어느 한쪽이라도 이 값 이하면 크롭 의미가 없어 드롭. */
const PHOTO_SUBJECT_BOX_MIN = 0.05

/** heroScore 를 0~10 정수로 클램프. 숫자가 아니면 0. */
function clampHeroScore(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(10, Math.round(n)))
}

/** 값을 0~1 로 클램프. 숫자(또는 숫자 문자열)가 아니거나 비유한이면 null. */
function clamp01(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, n))
}

/**
 * v5.1: subjectBox(과일/상품 주체 바운딩 박스) 검증 — 좌상단 기준 0~1 정규화.
 * - x/y/w/h 가 모두 숫자여야 하고 각각 0~1 로 클램프. 하나라도 비수치/비유한이면 드롭.
 * - 박스가 프레임을 넘치면(x+w>1, y+h>1) 남은 공간으로 w/h 를 좁힌다(좌상단 고정).
 * - 좁힌 뒤 가로 또는 세로 변이 PHOTO_SUBJECT_BOX_MIN(0.05) 이하로 너무 작으면(크롭
 *   의미 없음/비정상) 필드를 드롭(undefined) → 소비 측이 원본 그대로 폴백.
 */
function pickSubjectBox(
  v: unknown,
): { x: number; y: number; w: number; h: number } | undefined {
  if (!isObject(v)) return undefined
  if (Object.keys(v).some((k) => FORBIDDEN_KEYS.has(k))) return undefined
  const x = clamp01(v.x)
  const y = clamp01(v.y)
  const w0 = clamp01(v.w)
  const h0 = clamp01(v.h)
  if (x === null || y === null || w0 === null || h0 === null) return undefined
  // 프레임을 벗어나면 남은 공간으로 축소(좌상단 고정).
  const w = Math.min(w0, 1 - x)
  const h = Math.min(h0, 1 - y)
  if (w <= PHOTO_SUBJECT_BOX_MIN || h <= PHOTO_SUBJECT_BOX_MIN) return undefined
  return { x, y, w, h }
}

/**
 * v4.4: 사진 분석 결과 화이트리스트 검증.
 * - raw 는 { items: [...] } 또는 배열 자체 모두 허용.
 * - role 은 화이트리스트 밖이면 항목 드롭.
 * - heroScore 는 0~10 정수 클램프.
 * - visibleNote 는 60자 절삭.
 * - imageId 가 knownIds 에 없으면 드롭(모델 환각 방지). 중복 imageId 는 첫 항목만.
 * - blurry/dark 는 boolean 일 때만 반영(true/false 모두 보존).
 * - subjectBox 는 pickSubjectBox 로 0~1 클램프·최소변 검증, 유효할 때만 반영(아니면 필드 생략).
 * 유효 항목이 0개면 null 반환(소비 측이 폴백).
 */
export function validatePhotoAnalysis(
  raw: unknown,
  knownIds: string[],
): PhotoAnalysisItem[] | null {
  const idSet = new Set(knownIds)
  let arr: unknown
  if (Array.isArray(raw)) {
    arr = raw
  } else if (isObject(raw)) {
    if (Object.keys(raw).some((k) => FORBIDDEN_KEYS.has(k))) return null
    arr = raw.items
  } else {
    return null
  }
  if (!Array.isArray(arr)) return null

  const out: PhotoAnalysisItem[] = []
  const seen = new Set<string>()
  for (const item of arr) {
    if (!isObject(item)) continue
    if (Object.keys(item).some((k) => FORBIDDEN_KEYS.has(k))) continue

    const imageId = safeString(item.imageId)
    if (!imageId || !idSet.has(imageId) || seen.has(imageId)) continue

    const role = safeString(item.role)
    if (!PHOTO_ROLE_SET.has(role)) continue

    const result: PhotoAnalysisItem = {
      imageId,
      role: role as PhotoAnalysisItem["role"],
      heroScore: clampHeroScore(item.heroScore),
      visibleNote: trimTo(safeString(item.visibleNote), PHOTO_VISIBLE_NOTE_MAX),
    }
    if (typeof item.blurry === "boolean") result.blurry = item.blurry
    if (typeof item.dark === "boolean") result.dark = item.dark
    const subjectBox = pickSubjectBox(item.subjectBox)
    if (subjectBox) result.subjectBox = subjectBox

    seen.add(imageId)
    out.push(result)
  }

  return out.length > 0 ? out : null
}

/**
 * v4.4: visibleNote(사진 관찰 메모)를 판매 이미지(아트보드/JPG) 갤러리 캡션으로 승격해도
 * 안전한지 판정한다(규칙3 허위광고 방지).
 *
 * visibleNote 는 "사진에 실제로 보이는 것"만 담아야 하지만, 검증은 형태만 보장할 뿐
 * 내용을 강제하지 못한다. 모델이 프롬프트 규칙을 어기고 산지·품종·당도·맛·신선도·수확·
 * 인증 같은 "사진만으로 알 수 없는 사실 주장"을 넣으면 그대로 JPG 캡션에 노출될 수 있고,
 * 이 캡션은 textOverrides/CopyOutput 이 아니라 compliance 스캔도 우회한다.
 *
 * 따라서 이 토큰들이 한 개라도 섞이면 false → 소비 측(ResultView)이 승격을 포기하고
 * 기존 중립 안전 문구로 폴백한다. 오탐(순수 관찰이 걸러지는 경우)은 무해하다(중립 캡션이 될 뿐).
 * 순수 관찰(색·개수·배경·잘림 여부·과육·포장 형태·구도 등)만 통과한다.
 */
const UNSAFE_CAPTION_CLAIM =
  /(유기|친환경|무농약|저농약|오가닉|organic|gap|우수농산물|인증|원산지|국내산|수입산|산지직송|직송|산지|품종|당도|brix|고당도|달콤|달달|단맛|꿀맛|새콤|상큼|아삭|시원|과즙|풍미|신선|싱싱|싱그|생생|햇|수확|당일|새벽|제철|숙성|명품)/i

export function isCaptionSafeNote(note: unknown): boolean {
  const s = typeof note === "string" ? note.trim() : ""
  if (!s) return false
  if (UNSAFE_CAPTION_CLAIM.test(s)) return false
  // 산지 지역명(청송·제주 등)도 사실 주장 — 승격 금지.
  if (REGION_PATTERNS.test(s)) return false
  return true
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

/* ───────────────── v5.1: 자가 검수 검증 ───────────────── */

/** severity 화이트리스트 — 이 외의 값은 항목 드롭(신뢰 불가). */
const SELF_REVIEW_SEVERITIES = ["high", "medium", "low"] as const
const SELF_REVIEW_SEVERITY_SET: ReadonlySet<string> = new Set(SELF_REVIEW_SEVERITIES)

/** 자가 검수 필드 길이/개수 상한 (v5.1: 코드에서도 강제 절삭). */
const SELF_REVIEW_LIMITS = {
  area: 40,
  message: 120,
  suggestion: 80,
  overall: 120,
  maxIssues: 6,
} as const

/**
 * v5.1: 자가 검수 결과 화이트리스트 검증.
 * - raw 는 { overall, issues: [...] } 형태만 허용(배열 아님).
 * - severity 는 화이트리스트(high/medium/low) 밖이면 항목 드롭.
 * - area 40자 / message 120자 / suggestion 80자 절삭(경계 되돌림 포함).
 * - message 가 비면 항목 드롭(핵심 필드). area 는 비어도 통과(빈 문자열 허용).
 * - suggestion 은 비면 키 생략(옵셔널 — 소비 측이 조치 버튼 미노출).
 * - 유효 지적 최대 6건.
 * - 반환 규칙(v5.1.1): null=검수 실패(형식 위반)와 issues:[]=AI가 '지적 없음'을 명시한
 *   정상 응답(깨끗함)을 구분해 돌려준다 — 후자를 실패로 오표시하지 않기 위함.
 *   · raw.issues 가 배열이 아니면(누락·형 오류) 형식 위반 → null.
 *   · raw.issues 가 빈 배열([]) → issues:[] 성공(소비 측이 '특별히 지적할 점 없음' 렌더).
 *   · raw.issues 에 항목이 있었으나 전부 형식 위반으로 드롭 → 신뢰 불가 → null.
 */
export function validateSelfReview(raw: unknown): SelfReviewResult | null {
  if (!isObject(raw)) return null
  if (Object.keys(raw).some((k) => FORBIDDEN_KEYS.has(k))) return null

  // issues 필드가 배열이 아니면(누락·형 오류) 응답 형식 위반 — null(실패)로 폴백.
  if (!Array.isArray(raw.issues)) return null
  const rawIssues = raw.issues

  const issues: SelfReviewIssue[] = []
  for (const item of rawIssues) {
    if (issues.length >= SELF_REVIEW_LIMITS.maxIssues) break
    if (!isObject(item)) continue
    if (Object.keys(item).some((k) => FORBIDDEN_KEYS.has(k))) continue

    const severity = safeString(item.severity).toLowerCase()
    if (!SELF_REVIEW_SEVERITY_SET.has(severity)) continue

    const message = trimTo(safeString(item.message), SELF_REVIEW_LIMITS.message)
    if (!message) continue

    const issue: SelfReviewIssue = {
      severity: severity as SelfReviewIssue["severity"],
      area: trimTo(safeString(item.area), SELF_REVIEW_LIMITS.area),
      message,
    }
    const suggestion = trimTo(safeString(item.suggestion), SELF_REVIEW_LIMITS.suggestion)
    if (suggestion) issue.suggestion = suggestion

    issues.push(issue)
  }

  // 지적을 냈는데 전부 형식 위반으로 드롭됐다면 신뢰 불가 응답 — null(실패)로 폴백.
  if (issues.length === 0 && rawIssues.length > 0) return null

  // 여기 도달 시 issues 가 0건일 수 있다: rawIssues 가 빈 배열([]) = AI가 '지적 없음'을
  // 명시한 정상 응답. null(실패)과 구분해 빈 결과를 반환한다(소비 측이 '깨끗함' 렌더).
  return {
    issues,
    overall: trimTo(safeString(raw.overall), SELF_REVIEW_LIMITS.overall),
  }
}

/** 화이트리스트 검증 + 기본값 채움. */
export function validateCopyOutput(raw: unknown): CopyOutput {
  if (!isObject(raw)) throw new Error("RESPONSE_NOT_OBJECT")

  const headlineCandidates = pickHeadlineCandidates(raw.headlineCandidates)
  const problemArc = pickProblemArc(raw.problemArc)
  // v6.0(작업C): 동적 구성 힌트 — 비면 키 생략(구버전 저장본과 동일 형태 = 회귀 0).
  const compositionHints = pickCompositionHints(raw.compositionHints)
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
    // 옵셔널 — 구성 힌트 없으면(구버전/근거 없음) 키 생략 → 렌더 현행 폴백(회귀 0).
    ...(compositionHints ? { compositionHints } : {}),
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
