/**
 * v5.9(작업L): 결정적 카피 린터 — AI 호출 0회, 순수 문자열 검사.
 *
 * 배경(리서치_프롬프트디자인 백로그 A ★10 + 리서치_경쟁AI 이식 1·2순위):
 *   프롬프트 자기점검 문장은 4회 시도·실패했다(규칙 51/55/58/64). 이미 금지된
 *   어미(~랍니다)·창작 수치(냉장 5도·냉동 6개월)가 그대로 최종 출력됐기 때문.
 *   강제력 있는 "코드 게이트"만이 해법 — 그 게이트가 이 모듈이다.
 *
 * 검사 5종(+ 휴면 자기검증 흡수):
 *   ① 창작 수치 — 카피 전 필드의 숫자+단위 토큰을 허용집합(셀러 입력값·fruit-facts
 *      수치·입력 산술 파생·보상 시간창 상수·무해 서수)과 대조, 밖이면 위반.
 *   ② 금지 어미·미완결 구 — /랍니다|잖아요/, 느낌표 4회 초과, 동일 어미 3연속(validate
 *      hasMonotonousSentenceEnding 재사용), 짧은 필드의 조사·연결어미 종결.
 *   ③ AI 상투구·번역투 — im-not-ai 카탈로그 이식(심각도 S1/S2/S3).
 *   ④ 같은 단어 4회 초과 반복.
 *   ⑤ 필드별 글자수 하드 예산(미리캔버스 기법 — 스키마 제한의 코드 강제).
 *   + v5.8 휴면 runCopySelfReview(의학효능·등급어·만점후기)를 여기로 흡수·배선.
 *     → 의학효능/등급어/만점후기 사전은 self-review.ts가 단일 소유(중복 관리 제거),
 *       이 모듈은 그 결정적 검사기를 호출만 한다.
 *
 * 반환: 위반 배열(필드 경로·심각도·사유·해당 문구). 소비처(DetailMaker)가 생성 직후
 *   실행해 기존 검수 표시 흐름에 경고로 노출한다. 허위 금지·셀러 입력 추가 금지 준수:
 *   허용집합은 오직 기존 입력·fact에서만 파생한다(새 입력 필드 없음).
 *
 * 주의: validate.ts의 countCliches/countAiTranslationStyle은 "점수용"(copy-quality-score)
 *   소비자를 위한 카운터로 남는다. 이 모듈의 AI_TELL은 "게이트용" 필드 단위 탐지로 역할이
 *   다르며, 겹치지 않는 im-not-ai 패턴(여운 상투구·되어진·가지고 있다 등)을 추가한다.
 */

import type { CopyOutput, CopyInput } from "./types"
import {
  FRUIT_FACTS,
  detectFruitFactKey,
  parseWeightToGrams,
  getAvgWeightG,
} from "@/domain/fruit-facts"
import { hasMonotonousSentenceEnding } from "./validate"
import {
  detectMedicalEfficacy,
  detectGradeWithoutMetric,
  detectAllFiveStar,
  type CopyReviewFinding,
} from "./prompts/self-review"

export type CopyLintSeverity = "warn" | "reject"

export type CopyLintCode =
  | "fabricated-number"
  | "forbidden-ending"
  | "excess-exclaim"
  | "monotonous-ending"
  | "incomplete-phrase"
  | "ai-cliche"
  | "word-repeat"
  | "over-budget"
  | "medical-efficacy"
  | "grade-without-metric"
  | "all-five-star"

/** 카피 린터 위반 1건. */
export interface CopyLintFinding {
  /** 필드 경로 — 예: "storage", "keyPoints[0].body", "problemArc.problems[1]", "전체". */
  field: string
  code: CopyLintCode
  severity: CopyLintSeverity
  /** 셀러 눈높이 한국어 사유 한 줄. */
  reason: string
  /** 문제가 된 실제 문구·토큰. */
  snippet: string
}

/* ───────────────── 필드 수집 ───────────────── */

interface FieldText {
  field: string
  text: string
  /** 짧은 배너/라벨 필드(미완결 구·글자수 예산 대상). */
  short: boolean
}

/** 카피의 모든 텍스트 필드를 (경로, 텍스트) 쌍으로 평탄화한다. */
function collectFields(copy: CopyOutput): FieldText[] {
  const out: FieldText[] = []
  const push = (field: string, text: string | undefined, short = false) => {
    const t = (text ?? "").trim()
    if (t) out.push({ field, text: t, short })
  }
  push("headline", copy.headline, true)
  push("heroKicker", copy.heroKicker, true)
  push("subheadline", copy.subheadline, true)
  push("story", copy.story)
  push("storage", copy.storage)
  push("highlightBox", copy.highlightBox, true)
  push("farmStory", copy.farmStory)
  copy.keyPoints?.forEach((k, i) => {
    push(`keyPoints[${i}].title`, k.title, true)
    push(`keyPoints[${i}].body`, k.body)
  })
  copy.faq?.forEach((f, i) => {
    push(`faq[${i}].q`, f.q)
    push(`faq[${i}].a`, f.a)
  })
  copy.spec?.forEach((s, i) => push(`spec[${i}].value`, s.value))
  copy.highlightBadges?.forEach((b, i) => push(`highlightBadges[${i}]`, b, true))
  copy.cautions?.forEach((c, i) => push(`cautions[${i}]`, c))
  copy.recommendFor?.forEach((r, i) => push(`recommendFor[${i}]`, r, true))
  copy.headlineCandidates?.forEach((h, i) => push(`headlineCandidates[${i}]`, h, true))
  if (copy.problemArc) {
    push("problemArc.question", copy.problemArc.question, true)
    copy.problemArc.problems.forEach((p, i) =>
      push(`problemArc.problems[${i}]`, p, true),
    )
  }
  return out
}

/* ───────────────── ① 창작 수치 ───────────────── */

interface AllowedNumbers {
  nums: Set<number>
  /** 셀러 자유 입력 원문(소문자) — 그대로 옮겨 쓴 수치는 통과시키는 안전망. */
  rawText: string
}

/**
 * 허용 수치 집합 구성 — 오직 기존 입력·fruit-facts·산술 파생에서만(셀러 입력 추가 없음).
 */
function buildAllowedNumbers(input: CopyInput): AllowedNumbers {
  const nums = new Set<number>()
  const add = (n: unknown) => {
    const v = typeof n === "number" ? n : Number(n)
    if (Number.isFinite(v)) nums.add(v)
  }

  // 무해 서수·스텝 번호(01~04 STEP, 1~3위 등) + 보상 시간창 상수(규칙 47/49/60 — 12h/24h)
  // + 규칙 70 per-100g 고정 기준량 100(가격 환산 "100g당 약 ○○원"의 분모 — 12·24와 동일한 무해 상수).
  for (const n of [1, 2, 3, 4, 12, 24, 100]) nums.add(n)

  add(input.brix)
  add(input.avgWeightG)
  add(input.price)

  // 중량 문자열: raw 숫자 + kg/g 환산.
  const grams = input.weight ? parseWeightToGrams(input.weight) : null
  if (grams != null) {
    add(grams)
    add(grams / 1000)
  }
  if (input.weight) {
    for (const m of input.weight.matchAll(/\d+(?:\.\d+)?/g)) add(m[0])
  }

  // 개수 파생(중량 ÷ 품종 평균 g) — buildPriceHint의 "추정 N과"와 정합(가격 무관).
  const avg = getAvgWeightG(input.productType)
  if (grams != null && grams > 0 && avg != null && avg > 0) {
    const pieces = grams / avg
    if (pieces >= 1) add(Math.round(pieces))
  }

  // 가격 환산 파생(buildPriceHint 로직 복제 — 100g당/개당 반올림 값).
  if (input.price > 0 && grams != null && grams > 0) {
    add(Math.round((input.price / grams) * 100))
    if (avg != null && avg > 0) {
      const pieces = grams / avg
      if (pieces >= 1) add(Math.round(input.price / pieces))
    }
  }

  // trust 수치.
  const trust = input.trust
  if (trust) {
    add(trust.farmerYears)
    const rg = trust.refundGuarantee
    if (rg && typeof rg === "object") add(rg.windowHours)
  }

  // reviewStats 집계 수치.
  if (input.reviewStats) {
    add(input.reviewStats.totalCount)
    add(input.reviewStats.fiveStarPct)
  }

  // fruit-facts 수치(매칭 시) — goodBrix·brixCeiling·보관 온도/기간·품종 범위.
  const key = detectFruitFactKey(input.productType)
  const fact = key ? FRUIT_FACTS[key] : undefined
  if (fact) {
    add(fact.goodBrix)
    add(fact.brixCeiling)
    if (fact.storage.tempC != null) add(fact.storage.tempC)
    if (fact.storage.days != null) add(fact.storage.days)
    for (const v of fact.varieties) {
      add(v.brixMin)
      add(v.brixMax)
      add(v.avgWeightG)
    }
  }

  // 날짜 숫자(수확일·측정일 등) — "7월 8일 수확" 같은 표기 허용.
  for (const d of [input.harvestDate, input.brixMeasuredOn, trust?.harvestDateLabel]) {
    if (d) for (const m of d.matchAll(/\d+/g)) add(m[0])
  }

  // 셀러 자유 입력 원문 — 그대로 옮긴 수치는 통과.
  const rawText = [
    input.origin,
    input.weight,
    input.variety,
    input.sizeGrade,
    input.storageHint,
    input.farmIntro,
    trust?.producerRegion,
    trust?.producerName,
    input.reviewStats?.repurchase,
    ...(input.highlightKeywords ?? []),
    ...(input.recommendFor ?? []),
    ...(input.reviews?.map((r) => `${r.text} ${r.optionLabel ?? ""} ${r.highlight ?? ""}`) ??
      []),
  ]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ")
    .toLowerCase()

  return { nums, rawText }
}

/**
 * 숫자+단위 토큰. 단위는 창작 위험이 높은 것(온도·기간·Brix·중량·금액·비율·개수).
 * "℃/도"(온도), "개월/주/일/년"(기간), "시간"(시각창)이 핵심 표적.
 */
const NUM_UNIT_RE =
  /(\d+(?:[.,]\d+)?)\s*(brix|kg|g|원|℃|도씨|도|시간|개월|주일|주|일|년|%|퍼센트|과|박스|송이|개입|개)/gi

function checkFabricatedNumbers(
  fields: FieldText[],
  allowed: AllowedNumbers,
): CopyLintFinding[] {
  const out: CopyLintFinding[] = []
  for (const f of fields) {
    for (const m of f.text.matchAll(NUM_UNIT_RE)) {
      const raw = m[1]
      const unit = m[2].toLowerCase()
      const n = Number(raw.replace(/,/g, ""))
      if (!Number.isFinite(n)) continue
      if (allowed.nums.has(n)) continue
      // 셀러 원문 안전망: "숫자+단위" 또는 숫자만 원문에 있으면 통과.
      const joined = (raw + unit).replace(/\s/g, "").toLowerCase()
      if (allowed.rawText.includes(joined)) continue
      if (allowed.rawText.includes(raw.replace(/,/g, "").toLowerCase())) continue
      out.push({
        field: f.field,
        code: "fabricated-number",
        severity: "warn",
        reason: `입력·fact에 없는 수치 "${m[0].trim()}" — 창작 가능성(허위광고 위험). 측정값만 표기하거나 빼세요.`,
        snippet: m[0].trim(),
      })
    }
  }
  return out
}

/* ───────────────── ② 금지 어미·느낌표·미완결 구 ───────────────── */

/**
 * 금지 어미(규칙 49): 보고형 "~랍니다"(신호랍니다·제철이랍니다)와 "~잖아요".
 * "자랍니다/바랍니다/모자랍니다"(자라다·바라다 동사) 오탐 방지로 앞 음절 제외.
 * "~답니다"는 규칙 59가 허용하므로 대상 아님.
 */
const FORBIDDEN_ENDING_RES: { re: RegExp; label: string }[] = [
  { re: /(?<![자바])랍니다/, label: "~랍니다 (AI 티 나는 보고형 어미)" },
  { re: /잖아요/, label: "~잖아요 (구어 단정형)" },
]

function checkForbiddenEndings(fields: FieldText[]): CopyLintFinding[] {
  const out: CopyLintFinding[] = []
  for (const f of fields) {
    for (const { re, label } of FORBIDDEN_ENDING_RES) {
      if (re.test(f.text)) {
        out.push({
          field: f.field,
          code: "forbidden-ending",
          severity: "warn",
          reason: `금지 어미 ${label}. 다른 종결로 바꾸세요.`,
          snippet: f.text.slice(0, 40),
        })
      }
    }
  }
  return out
}

/** 느낌표 페이지 전체 4회 이내(규칙 49) — 초과 시 1건 보고. */
function checkExclaim(fields: FieldText[]): CopyLintFinding[] {
  let count = 0
  for (const f of fields) count += (f.text.match(/[!！]/g) ?? []).length
  if (count <= 4) return []
  return [
    {
      field: "전체",
      code: "excess-exclaim",
      severity: "warn",
      reason: `느낌표가 ${count}회 — 페이지 전체 4회 이내 권장(규칙 49). 신뢰 섹션은 0회.`,
      snippet: `느낌표 ${count}회`,
    },
  ]
}

/** 동일 어미 3연속 검사(story·farmStory) — validate.hasMonotonousSentenceEnding 재사용. */
function checkMonotonous(copy: CopyOutput): CopyLintFinding[] {
  const out: CopyLintFinding[] = []
  const targets: { field: string; text: string }[] = [
    { field: "story", text: copy.story ?? "" },
    { field: "farmStory", text: copy.farmStory ?? "" },
  ]
  for (const t of targets) {
    if (hasMonotonousSentenceEnding(t.text)) {
      out.push({
        field: t.field,
        code: "monotonous-ending",
        severity: "warn",
        reason: "같은 문장 어미가 3연속 — 어미를 섞어 리듬을 살리세요(규칙 31).",
        snippet: t.text.slice(0, 40),
      })
    }
  }
  return out
}

/**
 * 미완결 구(규칙 58): 짧은 필드가 조사·연결어미로 끝나는 경우.
 * 명사가 흔히 끝나는 단음절 조사(가/과/도/의…)는 오탐이 심해 제외하고,
 * 명사 종결과 충돌하지 않는 2음절+ 연결형만 표적으로 삼는다(고정밀 우선).
 * 예: recommendFor "여름 간식으로", "나눠 먹기 좋은".
 */
const INCOMPLETE_SUFFIX_RE =
  /(좋은|좋게|괜찮은|으로|는데|면서|이며|하고|되고|라서|려고|위한|통한|드는)$/

function checkIncomplete(fields: FieldText[]): CopyLintFinding[] {
  const out: CopyLintFinding[] = []
  for (const f of fields) {
    if (!f.short) continue
    // 끝의 문장부호·공백 정리 후 판정.
    const s = f.text.replace(/[.\s!?~·]+$/, "")
    if (INCOMPLETE_SUFFIX_RE.test(s)) {
      out.push({
        field: f.field,
        code: "incomplete-phrase",
        severity: "warn",
        reason: "조사·연결어미로 끝나는 미완결 구 — 완결 명사구/문장으로 마무리하세요(규칙 58).",
        snippet: s.slice(-24),
      })
    }
  }
  return out
}

/* ───────────────── ③ AI 상투구·번역투 (im-not-ai 이식) ───────────────── */

/**
 * 한국어 AI 문체 카탈로그(im-not-ai 이식). 심각도 S1(1회도 불허)/S2/S3.
 * validate.ts의 번역투 세트와 겹치지 않는 패턴 위주 — 여운 상투구(few-shot 오염원),
 * 이중 피동, 관용 상투구.
 */
const AI_TELL: { re: RegExp; sev: "S1" | "S2" | "S3"; label: string }[] = [
  // 여운 상투구 — few-shot 예시1에서 복사돼 전 케이스로 전파된 표현(백로그 B).
  { re: /마지막\s*한\s*(알|입|조각|잎)까지/, sev: "S1", label: "여운 상투구('마지막 한 알까지 ~')" },
  { re: /한\s*번\s*(맛보|맡으|먹어보)면\s*못\s*잊/, sev: "S1", label: "여운 상투구('한번 ~하면 못 잊어요')" },
  { re: /잊을\s*수\s*없는/, sev: "S2", label: "여운 상투구('잊을 수 없는')" },
  { re: /입\s*안\s*가득/, sev: "S2", label: "상투구('입안 가득')" },
  // 번역투(im-not-ai A) — validate 세트에 없는 것.
  { re: /에\s*대해/, sev: "S2", label: "번역투('~에 대해')" },
  { re: /되어(진|집니다|졌)/, sev: "S1", label: "이중 피동('되어진')" },
  { re: /가지고\s*있(다|습니다|어요)/, sev: "S2", label: "번역투('가지고 있다')" },
  // AI 시그니처(im-not-ai C·D).
  { re: /결론적으로/, sev: "S1", label: "AI 상투구('결론적으로')" },
  { re: /시사하는\s*바/, sev: "S1", label: "AI 상투구('시사하는 바')" },
  { re: /첫째[\s\S]{0,40}둘째/, sev: "S2", label: "기계적 나열(첫째·둘째)" },
]

function checkAiTell(fields: FieldText[]): CopyLintFinding[] {
  const out: CopyLintFinding[] = []
  for (const f of fields) {
    for (const { re, sev, label } of AI_TELL) {
      const m = re.exec(f.text)
      if (m) {
        out.push({
          field: f.field,
          code: "ai-cliche",
          severity: "warn",
          reason: `[${sev}] ${label} — AI 티 나는 표현입니다. 구체 감각·사실로 바꾸세요.`,
          snippet: m[0].trim(),
        })
      }
    }
  }
  return out
}

/* ───────────────── ④ 같은 단어 4회 초과 반복 ───────────────── */

/** 반복 판정 제외 — 기능어·감탄 부사(내용어 아님). */
const REPEAT_STOPWORDS = new Set([
  "그리고", "하지만", "그래서", "그런데", "저희", "우리", "정말", "너무", "이렇게",
  "그냥", "매우", "아주", "가장", "모두", "많이", "조금", "함께", "바로", "다시",
  "있어요", "있습니다", "합니다", "해요", "드려요", "드립니다",
])

/**
 * 같은 단어가 4회 초과(5회+) 등장하면 보고. 상품명 토큰·기능어는 제외.
 * 형태소 분석 없이 정확 토큰 기준이라 과소탐지 쪽으로 보수적(오탐 최소화).
 */
function checkWordRepeat(fields: FieldText[], input: CopyInput): CopyLintFinding[] {
  const excluded = new Set(REPEAT_STOPWORDS)
  for (const tok of `${input.productType} ${input.variety ?? ""} ${input.origin}`
    .toLowerCase()
    .split(/\s+/)) {
    if (tok.length >= 2) excluded.add(tok)
  }
  const counts = new Map<string, number>()
  const all = fields.map((f) => f.text).join(" ")
  for (const m of all.matchAll(/[가-힣]{2,}/g)) {
    const w = m[0]
    if (excluded.has(w)) continue
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  const out: CopyLintFinding[] = []
  const over = [...counts.entries()]
    .filter(([, c]) => c > 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
  for (const [w, c] of over) {
    out.push({
      field: "전체",
      code: "word-repeat",
      severity: "warn",
      reason: `"${w}" 가 ${c}회 반복 — 유의어로 분산하거나 줄이세요.`,
      snippet: w,
    })
  }
  return out
}

/* ───────────────── ⑤ 필드별 글자수 하드 예산 ───────────────── */

/**
 * 미리캔버스식 블록별 글자수 예산 — validate.ts LIMITS와 정합(스키마 제한의 코드 강제).
 * validateCopyOutput이 대부분 선절삭하지만, 절삭 없는 필드(badges)나 회귀를 잡는다.
 */
const FIELD_BUDGET: { re: RegExp; max: number; name: string }[] = [
  { re: /^headline$/, max: 16, name: "헤드라인" },
  { re: /^subheadline$/, max: 32, name: "서브헤드라인" },
  { re: /^heroKicker$/, max: 40, name: "히어로 캡션" },
  { re: /^highlightBox$/, max: 30, name: "강조 박스" },
  { re: /^keyPoints\[\d+\]\.title$/, max: 18, name: "포인트 제목" },
  { re: /^keyPoints\[\d+\]\.body$/, max: 120, name: "포인트 본문" },
  { re: /^problemArc\.question$/, max: 44, name: "공감 질문" },
  { re: /^problemArc\.problems\[\d+\]$/, max: 28, name: "문제 항목" },
  { re: /^highlightBadges\[\d+\]$/, max: 14, name: "강조 뱃지" },
  { re: /^headlineCandidates\[\d+\]$/, max: 16, name: "헤드라인 후보" },
]

function checkBudgets(fields: FieldText[]): CopyLintFinding[] {
  const out: CopyLintFinding[] = []
  for (const f of fields) {
    const b = FIELD_BUDGET.find((x) => x.re.test(f.field))
    if (b && f.text.length > b.max) {
      out.push({
        field: f.field,
        code: "over-budget",
        severity: "warn",
        reason: `${b.name}이 ${f.text.length}자 — ${b.max}자 예산 초과(레이아웃 넘침 위험).`,
        snippet: f.text.slice(0, b.max + 6),
      })
    }
  }
  return out
}

/* ───────────────── 휴면 runCopySelfReview 흡수 ───────────────── */

/** self-review.ts의 결정적 검사기 3종(의학효능·등급어·만점후기)을 배선·변환. */
function checkSelfReviewRules(copy: CopyOutput, input: CopyInput): CopyLintFinding[] {
  const copyText = collectFields(copy)
    .map((f) => f.text)
    .join("\n")
  const hasBrix = input.brix != null && Number.isFinite(input.brix)
  const hasWeight =
    (input.weight ? parseWeightToGrams(input.weight) != null : false) ||
    input.avgWeightG != null
  const ratings = (input.reviews ?? []).map((r) => r.rating)

  const reviewFindings: CopyReviewFinding[] = [
    ...detectMedicalEfficacy(copyText),
    ...detectGradeWithoutMetric(copyText, { hasBrix, hasWeight }),
    ...detectAllFiveStar(ratings),
  ]

  return reviewFindings.map((r) => ({
    field: "전체",
    code: r.code,
    severity: r.severity,
    reason: r.message,
    snippet: r.suggestion ?? "",
  }))
}

/* ───────────────── 공개 API ───────────────── */

/**
 * 결정적 카피 린터 — 생성된 카피와 셀러 입력을 받아 위반 배열을 돌려준다.
 * AI 호출 0회, 부작용 0. 셀러 입력을 추가로 요구하지 않는다(허용집합은 기존 입력에서만 파생).
 */
export function lintCopyOutput(copy: CopyOutput, input: CopyInput): CopyLintFinding[] {
  const fields = collectFields(copy)
  const allowed = buildAllowedNumbers(input)
  return [
    ...checkFabricatedNumbers(fields, allowed),
    ...checkForbiddenEndings(fields),
    ...checkExclaim(fields),
    ...checkMonotonous(copy),
    ...checkIncomplete(fields),
    ...checkAiTell(fields),
    ...checkWordRepeat(fields, input),
    ...checkBudgets(fields),
    ...checkSelfReviewRules(copy, input),
  ]
}

/** reject(반드시 수정) 위반이 하나라도 있으면 true — 소비 측 게이트용. */
export function hasRejectFinding(findings: CopyLintFinding[]): boolean {
  return findings.some((f) => f.severity === "reject")
}
