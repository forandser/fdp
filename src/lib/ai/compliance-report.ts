/**
 * 카피 식약처 §8 위반 자동 검수 리포트 (v1.8).
 *
 * 5차 리서치 결과(Tier1~5 + TIER_TO_CLAUSE 매핑) 활용.
 * ResultView/DisclosureBlock가 호출.
 */

import { checkForbiddenAll, TIER_TO_CLAUSE } from "./forbidden-words"
import { detectFruitFactKey, FRUIT_FACTS } from "@/domain/fruit-facts"
import type { CopyOutput, TrustInfo } from "./types"

export interface ComplianceViolation {
  tier: 1 | 2 | 3 | 4 | 5
  clause: string
  matched: string
  /** 어느 카피 필드에서 발견됐는지 (headline / story / keyPoints[0].body 등). */
  field: string
  /** 셀러를 위한 제안 (있으면). */
  suggestion?: string
}

/**
 * 산지 불일치 위반 — 허위 표시(원산지표시법) 위험, 최고 심각도.
 * fruit-facts 참고 지역명이 카피에 등장하는데 입력 산지에는 없을 때 검출.
 */
export interface OriginMismatch {
  /** 카피에 잘못 등장한 참고 지역명 (예: "담양"). */
  region: string
  /** 어느 필드에서 발견됐는지. */
  field: string
  /** 입력된 산지 문자열 (비었으면 "미입력"). */
  origin: string
}

export interface ComplianceReport {
  violations: ComplianceViolation[]
  tier1Count: number
  tier2Count: number
  tier3Count: number
  tier4Count: number
  tier5Count: number
  /** 인증 텍스트가 인증번호 없이 등장한 케이스 별도 추적. */
  certViolations: { cert: string; reason: string }[]
  /**
   * 산지 불일치(허위 표시 위험) — 최고 심각도. fruit-facts.regions 지역명이
   * 카피에 등장하는데 입력 산지에 포함되지 않은 경우. 자동 치환하지 않고
   * 검출·경고만 한다(셀러가 직접 판단). 없으면 빈 배열.
   */
  originMismatches: OriginMismatch[]
}

/**
 * 지역명이 아닌 일반어 토큰 — 오탐 방지 제외 목록.
 * fruit-facts regions에 "수입 (칠레)", "북미 (수입)" 같은 항목이 있어 core 토큰이
 * "수입"이 되는데, "수입"은 카피 본문("수입 절차" 등)에 흔히 나오는 일반어라 제외한다.
 */
const NON_PLACE_REGION_TOKENS = new Set(["수입"])

/**
 * 참고 지역명이 입력 산지에 "포함"되는지 판정.
 * "제주"는 "제주 서귀포"처럼 복합 지역명일 수 있어 공백/괄호 앞 토큰(핵심 시·군)만 본다.
 * 예: fact region "제주 서귀포" → core "제주". origin "제주산"에 "제주"가 있으면 정합.
 * "수입" 같은 비지역 일반어는 빈 문자열로 반환해 검사에서 제외.
 */
function regionCoreToken(region: string): string {
  // 괄호 주석 제거 후 첫 공백 앞 토큰 = 대표 시·군명.
  const noParen = region.replace(/\s*\(.*?\)\s*/g, " ").trim()
  const first = (noParen.split(/\s+/)[0] ?? "").trim()
  return NON_PLACE_REGION_TOKENS.has(first) ? "" : first
}

/**
 * 산지 불일치 검출 — fruit-facts 참고 지역명이 카피에 실제 산지처럼 등장하는데
 * 입력 산지(origin)에 그 지역명이 포함되지 않으면 위반으로 본다.
 *
 * 배경: 셀러가 origin을 "국내산"으로 입력했는데 AI가 딸기 regions의 "담양"을
 * 승격시켜 "새벽 5시에 딴 담양 설향" 같은 카피를 만든 허위 표시 사고.
 *
 * 규칙:
 *  - 매칭된 과일의 regions 각 지역명의 핵심 토큰(예: "제주 서귀포"→"제주")을
 *    카피 전 필드에서 찾는다.
 *  - 그 토큰이 입력 origin 문자열에 들어 있으면 정합(셀러가 실제로 그 산지를 입력).
 *  - origin에 없는데 카피에 등장하면 → 허위 표시 위험으로 검출.
 *  - origin이 비어 있으면(미입력) 어떤 지역명 등장도 위반.
 */
export function detectOriginMismatches(
  output: CopyOutput,
  productName: string,
  origin?: string,
): OriginMismatch[] {
  const key = detectFruitFactKey(productName)
  if (!key) return []
  const fact = FRUIT_FACTS[key]
  if (!fact || fact.regions.length === 0) return []

  const originText = (origin ?? "").trim()
  const originLower = originText.toLowerCase()

  // 검사할 참고 지역명(핵심 토큰). 2자 미만은 오탐 위험이라 제외.
  const regionTokens = fact.regions
    .map(regionCoreToken)
    .filter((r) => r.length >= 2)

  // origin에 이미 포함된 토큰은 정합 — 검사 대상에서 제외.
  const suspectTokens = regionTokens.filter(
    (tok) => !originLower.includes(tok.toLowerCase()),
  )
  if (suspectTokens.length === 0) return []

  const out: OriginMismatch[] = []
  const seen = new Set<string>()
  for (const { field, text } of flattenCopy(output)) {
    for (const tok of suspectTokens) {
      if (!text.includes(tok)) continue
      const dedupeKey = `${field}::${tok}`
      if (seen.has(dedupeKey)) continue
      seen.add(dedupeKey)
      out.push({ region: tok, field, origin: originText || "미입력" })
    }
  }
  return out
}

/** CopyOutput 안의 각 텍스트 필드를 (field-name, text) pair로 평탄화. */
function flattenCopy(output: CopyOutput): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = []
  if (output.headline) out.push({ field: "headline", text: output.headline })
  // v4.3: 히어로 후킹 캡션도 허위표현·산지 불일치 스캔 대상(식약처 게이팅).
  if (output.heroKicker) out.push({ field: "heroKicker", text: output.heroKicker })
  if (output.subheadline) out.push({ field: "subheadline", text: output.subheadline })
  if (output.story) out.push({ field: "story", text: output.story })
  if (output.storage) out.push({ field: "storage", text: output.storage })
  if (output.highlightBox) out.push({ field: "highlightBox", text: output.highlightBox })
  if (output.farmStory) out.push({ field: "farmStory", text: output.farmStory })
  output.highlightBadges.forEach((b, i) =>
    out.push({ field: `highlightBadges[${i}]`, text: b }),
  )
  output.keyPoints.forEach((kp, i) => {
    if (kp.title) out.push({ field: `keyPoints[${i}].title`, text: kp.title })
    if (kp.body) out.push({ field: `keyPoints[${i}].body`, text: kp.body })
  })
  output.spec.forEach((s, i) => {
    if (s.value) out.push({ field: `spec[${i}].value`, text: s.value })
  })
  output.faq.forEach((f, i) => {
    if (f.q) out.push({ field: `faq[${i}].q`, text: f.q })
    if (f.a) out.push({ field: `faq[${i}].a`, text: f.a })
  })
  output.cautions.forEach((c, i) =>
    out.push({ field: `cautions[${i}]`, text: c }),
  )
  output.recommendFor.forEach((r, i) =>
    out.push({ field: `recommendFor[${i}]`, text: r }),
  )
  // v4.0: 고정 문구 인라인 편집 오버라이드 값도 검수 대상에 합류 —
  // 셀러가 섹션 제목·배송 안내 등 고정 문구를 과장 광고(식약처 금지어)나
  // 산지 불일치 지역명으로 바꾸는 경우를 감지한다.
  if (output.textOverrides) {
    for (const [key, value] of Object.entries(output.textOverrides)) {
      if (value && value.trim()) {
        out.push({ field: `textOverrides.${key}`, text: value })
      }
    }
  }
  return out
}

/** 카피 위반 자동 리포트.
 *
 * @param output     검사할 카피
 * @param trust      셀러 인증/신뢰 정보 (인증 표현 정당화 판정)
 * @param productName fruit-facts 매칭용 상품명 (산지 불일치 검출). 하위호환 옵셔널.
 * @param origin     입력 산지 문자열 (산지 불일치 판정 기준). 하위호환 옵셔널.
 */
export function checkComplianceReport(
  output: CopyOutput,
  trust?: TrustInfo,
  productName?: string,
  origin?: string,
): ComplianceReport {
  const violations: ComplianceViolation[] = []
  const fields = flattenCopy(output)

  for (const { field, text } of fields) {
    const hits = checkForbiddenAll(text)
    for (const hit of hits) {
      // Tier 4 (인증 표시)는 인증번호 보유 시 통과
      if (hit.tier === 4) {
        const hasCert =
          (/유기|친환경|오가닉|ORGANIC/i.test(hit.matched) && trust?.organicNumber?.trim()) ||
          (/GAP/i.test(hit.matched) && trust?.gapNumber?.trim()) ||
          (/무농약/.test(hit.matched) && trust?.pesticideFreeNumber?.trim())
        if (hasCert) continue
      }
      violations.push({
        tier: hit.tier,
        clause: TIER_TO_CLAUSE[hit.tier],
        matched: hit.matched,
        field,
      })
    }
  }

  // 산지 불일치(허위 표시 위험) — 참고 지역명이 입력 산지와 다르게 카피에 등장.
  // 기존 검수 심각도 체계 최고 등급(Tier1)으로 violations에 합류해 검수 UI에 뜨게 한다.
  // 자동 치환은 하지 않음 — 검출·경고가 목적(셀러가 직접 판단).
  const originMismatches =
    productName != null
      ? detectOriginMismatches(output, productName, origin)
      : []
  for (const mm of originMismatches) {
    violations.push({
      tier: 1,
      clause: "원산지표시법 (허위 표시 위험 — 참고 지역명을 실제 산지로 표기)",
      matched: mm.region,
      field: mm.field,
      suggestion: `입력 산지("${mm.origin}")에 없는 지역명이에요. 실제 산지가 맞는지 확인하고, 아니면 "${mm.region}"을 지워주세요.`,
    })
  }

  // 카운트 집계
  const tier1Count = violations.filter((v) => v.tier === 1).length
  const tier2Count = violations.filter((v) => v.tier === 2).length
  const tier3Count = violations.filter((v) => v.tier === 3).length
  const tier4Count = violations.filter((v) => v.tier === 4).length
  const tier5Count = violations.filter((v) => v.tier === 5).length

  // 인증 별도 추적
  const certViolations: { cert: string; reason: string }[] = []
  if (!trust?.gapNumber?.trim()) {
    const gapHit = violations.find((v) => /GAP/i.test(v.matched))
    if (gapHit)
      certViolations.push({ cert: "GAP", reason: "GAP 인증번호 미입력 상태에서 'GAP' 표현 사용" })
  }
  if (!trust?.organicNumber?.trim()) {
    const orgHit = violations.find((v) =>
      /(유기농|친환경|오가닉|ORGANIC)/i.test(v.matched),
    )
    if (orgHit)
      certViolations.push({
        cert: "유기/친환경",
        reason: "유기·친환경 인증번호 미입력 상태에서 해당 표현 사용",
      })
  }

  return {
    violations,
    tier1Count,
    tier2Count,
    tier3Count,
    tier4Count,
    tier5Count,
    certViolations,
    originMismatches,
  }
}

/** 검수 결과 사용자 친화 한 줄 요약. */
export function summarizeReport(report: ComplianceReport): string {
  const n = report.violations.length
  if (n === 0) return "자동 검수 통과 — 식약처 위반 의심 표현 없음."
  return `식약처 위반 의심 ${n}건 — Tier1 ${report.tier1Count} / Tier2 ${report.tier2Count} / Tier3 ${report.tier3Count} / Tier5 ${report.tier5Count}.`
}
