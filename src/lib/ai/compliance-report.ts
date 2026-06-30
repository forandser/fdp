/**
 * 카피 식약처 §8 위반 자동 검수 리포트 (v1.8).
 *
 * 5차 리서치 결과(Tier1~5 + TIER_TO_CLAUSE 매핑) 활용.
 * ResultView/DisclosureBlock가 호출.
 */

import { checkForbiddenAll, TIER_TO_CLAUSE } from "./forbidden-words"
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

export interface ComplianceReport {
  violations: ComplianceViolation[]
  tier1Count: number
  tier2Count: number
  tier3Count: number
  tier4Count: number
  tier5Count: number
  /** 인증 텍스트가 인증번호 없이 등장한 케이스 별도 추적. */
  certViolations: { cert: string; reason: string }[]
}

/** CopyOutput 안의 각 텍스트 필드를 (field-name, text) pair로 평탄화. */
function flattenCopy(output: CopyOutput): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = []
  if (output.headline) out.push({ field: "headline", text: output.headline })
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
  return out
}

/** 카피 위반 자동 리포트. */
export function checkComplianceReport(
  output: CopyOutput,
  trust?: TrustInfo,
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
  }
}

/** 검수 결과 사용자 친화 한 줄 요약. */
export function summarizeReport(report: ComplianceReport): string {
  const n = report.violations.length
  if (n === 0) return "자동 검수 통과 — 식약처 위반 의심 표현 없음."
  return `식약처 위반 의심 ${n}건 — Tier1 ${report.tier1Count} / Tier2 ${report.tier2Count} / Tier3 ${report.tier3Count} / Tier5 ${report.tier5Count}.`
}
