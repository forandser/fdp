/**
 * 카피 품질 자동 점수화 (v1.9).
 *
 * 5차 리서치 8각도 결과 + v1.8 검증 모듈을 종합해 카피 품질을 0~100 점수로 평가.
 * 셀러가 결과 카피의 "잘 만들어졌나"를 한눈에 확인.
 *
 * AI 호출 0회 — 순수 계산만.
 *
 * 차원 8개 (각 가중치):
 *  1. Hook(15)   — headline이 시간단축/기능강화/변화 3유형 중 하나인가
 *  2. Number(15) — keyPoints body에 숫자(Brix·일·g·% 등)가 충분한가
 *  3. Sensory(12) — 감각어가 fruit-facts 그 과일 풀에 매칭되는가
 *  4. Trust(13)   — 농가/인증/누적 표현이 있는가
 *  5. Natural(15) — AI 번역투·진부어·어미 3연속 반복 없는가
 *  6. Safety(15)  — 식약처 §8 위반(Tier1·2·5) 없는가
 *  7. SEO(8)      — 상품명 49자/어뷰징 단어 OK
 *  8. Engage(7)   — 의문/감탄 등장 + 친근체 어미 다양
 *
 * 합 100점. 90~100 A / 75~89 B / 60~74 C / 0~59 D.
 */

import type { CopyOutput } from "./types"
import {
  countCliches,
  countAiTranslationStyle,
  hasMonotonousSentenceEnding,
  hasInquiryOrExclaim,
  validateProductNameSeo,
  detectHookType,
} from "./validate"
import { checkComplianceReport } from "./compliance-report"
import { getSensoryWords } from "@/domain/fruit-facts"
import type { TrustInfo } from "./types"

export interface DimensionScore {
  key: string
  label: string
  earned: number
  max: number
  hint: string
}

export interface CopyQualityResult {
  total: number
  grade: "A" | "B" | "C" | "D"
  dimensions: DimensionScore[]
  /** 우선 개선 사항 (낮은 점수 차원 3개). */
  topImprovements: string[]
}

/** 카피 전체 텍스트를 평탄화 (한 덩어리로 평가용). */
function allText(copy: CopyOutput): string {
  return [
    copy.headline,
    copy.subheadline,
    copy.story,
    copy.highlightBox,
    copy.farmStory,
    ...copy.keyPoints.flatMap((p) => [p.title, p.body]),
    ...copy.faq.flatMap((f) => [f.q, f.a]),
    copy.storage,
    ...copy.cautions,
    ...copy.recommendFor,
  ]
    .filter(Boolean)
    .join(" ")
}

function scoreHook(copy: CopyOutput): DimensionScore {
  const max = 15
  const t = detectHookType(copy.headline)
  let earned = 0
  let hint = ""
  if (t === "time") {
    earned = 15
    hint = "시간단축형 헤드라인 — 강함"
  } else if (t === "feature") {
    earned = 15
    hint = "기능강화형(수치) 헤드라인 — 강함"
  } else if (t === "transform") {
    earned = 15
    hint = "변화·감각형 헤드라인 — 강함"
  } else {
    earned = 5
    hint = "헤드라인이 3유형(시간/기능/변화) 중 어디에도 속하지 않음 — 후킹 약함"
  }
  // headline + subheadline 80자 초과 페널티
  const heroLen = (copy.headline?.length ?? 0) + (copy.subheadline?.length ?? 0)
  if (heroLen > 80) {
    earned = Math.max(0, earned - 4)
    hint += " · Hero 80자 초과 페널티"
  }
  return { key: "hook", label: "후킹(Hook)", earned, max, hint }
}

function scoreNumber(copy: CopyOutput): DimensionScore {
  const max = 15
  // keyPoints body 안 숫자 등장
  const counts = copy.keyPoints.map((p) => (p.body.match(/\d+/g) || []).length)
  const withNumber = counts.filter((c) => c >= 1).length
  // story·spec에도 숫자가 있는가
  const storyHasNumber = /\d/.test(copy.story)
  const specCount = copy.spec.length
  const earned = Math.min(
    max,
    withNumber * 4 + (storyHasNumber ? 2 : 0) + Math.min(3, specCount),
  )
  const hint =
    withNumber === copy.keyPoints.length && storyHasNumber
      ? "수치 충분 — keyPoints 전체에 숫자, story도 OK"
      : `keyPoints 중 ${withNumber}/${copy.keyPoints.length}개만 숫자 포함. Brix·일·g 등 수치 추가 권장`
  return { key: "number", label: "수치(Quantification)", earned, max, hint }
}

function scoreSensory(copy: CopyOutput, fruit: string): DimensionScore {
  const max = 12
  const text = allText(copy)
  const pool = getSensoryWords(fruit)
  if (pool.length === 0) {
    // 사전에 없는 과일이면 일반 감각어 매칭으로 후한 점수
    const generalSensory = /(아삭|폭신|탱글|톡|향|새콤|달큰|촉촉|쫀쫀|시원|꿀|진한)/g
    const hits = (text.match(generalSensory) || []).length
    const earned = Math.min(max, hits * 2 + 2)
    return {
      key: "sensory",
      label: "감각(Sensory)",
      earned,
      max,
      hint: hits > 0 ? `일반 감각어 ${hits}회 등장` : "감각어 부족",
    }
  }
  // fact 사전 감각어와 매칭
  let hits = 0
  for (const w of pool) {
    if (text.includes(w)) hits++
  }
  const earned = Math.min(max, hits * 4 + 2)
  const hint =
    hits >= 2
      ? `이 과일에 맞는 감각어(${pool.slice(0, 3).join(",")} 등) ${hits}종 등장`
      : `이 과일 감각어(${pool.slice(0, 3).join(",")})가 1종 이하. 추가 권장`
  return { key: "sensory", label: "감각(Sensory)", earned, max, hint }
}

function scoreTrust(copy: CopyOutput, trust?: TrustInfo): DimensionScore {
  const max = 13
  const text = allText(copy)
  let earned = 0
  const reasons: string[] = []
  // 농부·연차·산지 단서
  if (/(농부|농가|\d+년차|\d+대째)/.test(text)) {
    earned += 4
    reasons.push("농가 화자 OK")
  }
  // 인증/공식 표시
  if (trust?.gapNumber?.trim() || trust?.organicNumber?.trim() || trust?.pesticideFreeNumber?.trim()) {
    earned += 4
    reasons.push("공식 인증 표기")
  }
  // 누적 임팩트
  if (/(\d+,?\d+\s*(건|박스|개)|누적|올해|이번 주)/.test(text)) {
    earned += 3
    reasons.push("누적 임팩트 숫자")
  }
  // 솔직 결점 / 가격 정당화
  if (/(흠집|들쑥날쑥|모양|손으로 한 알|손이 많이|박스 한 칸당)/.test(text)) {
    earned += 2
    reasons.push("솔직 결점 또는 가격 정당화")
  }
  earned = Math.min(max, earned)
  const hint = reasons.length > 0 ? reasons.join(" · ") : "신뢰 표현 약함 — 농부 정보·인증·누적 숫자 권장"
  return { key: "trust", label: "신뢰(Trust)", earned, max, hint }
}

function scoreNatural(copy: CopyOutput): DimensionScore {
  const max = 15
  const text = allText(copy)
  const cliches = countCliches(text)
  const translation = countAiTranslationStyle(text)
  const monotonous = hasMonotonousSentenceEnding(text)
  let earned = max
  let issues: string[] = []
  if (cliches > 1) {
    earned -= Math.min(6, cliches * 2)
    issues.push(`진부어 ${cliches}회`)
  }
  if (translation > 0) {
    earned -= Math.min(5, translation * 3)
    issues.push(`AI 번역투 ${translation}회`)
  }
  if (monotonous) {
    earned -= 4
    issues.push("같은 어미 3연속")
  }
  earned = Math.max(0, earned)
  const hint = issues.length === 0 ? "AI 티 거의 없음 — 자연스러움" : issues.join(" · ")
  return { key: "natural", label: "자연스러움(Naturalness)", earned, max, hint }
}

function scoreSafety(copy: CopyOutput, trust?: TrustInfo): DimensionScore {
  const max = 15
  const report = checkComplianceReport(copy, trust)
  let earned = max
  // 심각도별 차감
  earned -= report.tier1Count * 8
  earned -= report.tier2Count * 5
  earned -= report.tier5Count * 6
  earned -= report.tier3Count * 3
  earned -= report.tier4Count * 4
  earned = Math.max(0, earned)
  const hint =
    report.violations.length === 0
      ? "식약처 자동 검수 — 위반 없음"
      : `Tier1 ${report.tier1Count} / Tier2 ${report.tier2Count} / Tier3 ${report.tier3Count} / Tier5 ${report.tier5Count}`
  return { key: "safety", label: "안전(Safety)", earned, max, hint }
}

function scoreSeo(copy: CopyOutput, productName: string): DimensionScore {
  const max = 8
  const seo = validateProductNameSeo(productName || copy.headline)
  let earned = max
  const issues = seo.warnings.map((w) => w.detail)
  earned -= seo.warnings.length * 2
  earned = Math.max(0, earned)
  const hint = issues.length === 0 ? "상품명 SEO 통과" : issues.join(" · ")
  return { key: "seo", label: "SEO", earned, max, hint }
}

function scoreEngage(copy: CopyOutput): DimensionScore {
  const max = 7
  const text = allText(copy)
  let earned = 0
  // 의문/감탄 1회 이상
  if (hasInquiryOrExclaim(text)) earned += 3
  // 친근체 어미
  const friendly = /(요\b|네요|답니다|예요|이에요|잖아요|지요)/g
  const friendlyHits = (text.match(friendly) || []).length
  if (friendlyHits >= 3) earned += 4
  else if (friendlyHits >= 1) earned += 2
  const hint =
    earned >= 6
      ? "친근체 어미 + 의문/감탄 등장 — 사람 톤"
      : earned >= 3
        ? "친근체 어미는 있지만 의문/감탄 부족"
        : "친근체 어미·의문/감탄 모두 부족 — 따뜻한 톤 권장"
  return { key: "engage", label: "친근체(Engage)", earned, max, hint }
}

export function scoreCopyQuality(args: {
  copy: CopyOutput
  productName: string
  trust?: TrustInfo
}): CopyQualityResult {
  const dimensions: DimensionScore[] = [
    scoreHook(args.copy),
    scoreNumber(args.copy),
    scoreSensory(args.copy, args.productName),
    scoreTrust(args.copy, args.trust),
    scoreNatural(args.copy),
    scoreSafety(args.copy, args.trust),
    scoreSeo(args.copy, args.productName),
    scoreEngage(args.copy),
  ]
  const total = dimensions.reduce((s, d) => s + d.earned, 0)
  const grade: CopyQualityResult["grade"] =
    total >= 90 ? "A" : total >= 75 ? "B" : total >= 60 ? "C" : "D"

  const topImprovements = [...dimensions]
    .sort((a, b) => a.earned / a.max - b.earned / b.max)
    .slice(0, 3)
    .map((d) => `${d.label}: ${d.hint}`)

  return { total, grade, dimensions, topImprovements }
}
