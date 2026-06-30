/**
 * 식약처 광고 금지 표현 필터 (v1.8).
 *
 * 출처: 식품 등의 표시·광고에 관한 법률 §8, 친환경농어업법, 원산지표시법.
 * 2025-12-04 시행 식약처 고시 제2025-79호 (의약품 명칭 금지) 반영.
 * 2025-01-01 숙취해소 표시·광고 강화 (인체적용시험 + 자율심의) 반영.
 *
 * Tier 1 — 의약품/질병 직결 (형사처벌 위험, §8 1·2호)
 * Tier 2 — 일반식품 금지 (건기식 오인, §8 4호)
 * Tier 3 — 절대표현·과장 (근거 없을 때, §8 4·7호)
 * Tier 4 — 인증 미보유 시 금지 (유기농/친환경/무농약 등)
 * Tier 5 — 체험담 기만 (소비자 오인, §8 5호) ★ v1.8 신설
 *
 * 본 모듈은 AI가 추천한 소구점, 또는 셀러 자유 입력에 한해 1차 차단용.
 * 100% 완벽한 필터는 불가능 — 셀러에게 검수 책임은 그대로 남는다는 디스클레임 필요.
 */

/** 즉시 차단 (의약품/질병/거짓 단정, §8 1·2호) */
const TIER1: RegExp[] = [
  // 질병 치료/예방
  /치료/,
  /치유/,
  /완치/,
  /특효/,
  /명약/,
  /항암/,
  /당뇨/,
  /고혈압/,
  /혈압\s*조절/,
  /혈당\s*조절/,
  /콜레스테롤\s*(감소|개선|조절)/,
  /동맥경화/,
  /성인병/,
  /아토피/,
  /탈모/,
  /발모/,
  /불면증/,
  /비염/,
  /갱년기\s*개선/,
  /디톡스/,
  /해독\s*작용/,
  /처방/,
  /복용/,
  /한약/,
  /약효/,
  /암\s*예방/,
  /감기\s*예방/,
  /감기\s*개선/,
  /질병\s*예방/,
  /의사\s*추천/,
  /박사\s*추천/,
  /임상\s*입증/,
  /변비\s*(개선|해소)/,
  /비염\s*완화/,
  /관절통\s*완화/,
  /두통\s*완화/,
  /염증\s*완화/,
  /지방간/,
  /고지혈증/,
  /수명\s*연장/,
  /치료에\s*효과/,
  /예방\s*효과/,
  /효능\s*인증/,
  // 2025-12-04 식약처 고시 제2025-79호 — 의약품 명칭 금지
  /위고비/,
  /오젬픽/,
  /삭센다/,
  /식욕\s*억제(제)?/,
  /먹는\s*(위고비|약|영양제|한약|다이어트\s*약)/,
  /다이어트\s*보조제/,
  /비만\s*치료/,
  /처방전\s*없이/,
  // 2025-01-01 숙취해소 표시·광고 강화 (자율심의 필수)
  /숙취\s*해소/,
  /해장(에\s*좋)?/,
]

/** 일반식품 금지 (건기식 기능성 표현, §8 4호) */
const TIER2: RegExp[] = [
  /면역력\s*(강화|증진|향상|증강)/,
  /항산화\s*(효과|작용|가득)/,
  /혈행\s*개선/,
  /체지방\s*감소/,
  /다이어트\s*(효과|에\s*좋)/,
  /노화\s*방지/,
  /안티에이징/,
  /피부\s*(미용|재생|미백)/,
  /콜라겐\s*합성/,
  /기억력\s*개선/,
  /두뇌\s*활성/,
  /장\s*건강/,
  /관절\s*건강/,
  /시력\s*개선/,
  // 영양 성분 풍부 표현은 식약처 영양 강조 표현 기준 충족 시에만 허용
  /비타민\s*[ABCDEK]?\s*풍부/,
  /폴리페놀\s*풍부/,
  /안토시아닌\s*가득/,
  /라이코펜\s*풍부/,
  /칼슘\s*풍부/,
  /항산화\s*가득/,
]

/** 절대표현·과장 (근거 없을 때, §8 4·7호) */
const TIER3: RegExp[] = [
  /최고\s*품질/,
  /최고급/,
  /역대\s*최고/,
  /세계\s*최초/,
  /국내\s*1위/,
  /국내\s*최대/,
  /업계\s*1위/,
  /업계\s*최저/,
  /고객만족도\s*1위/,
  /판매량\s*1위/,
  /단연\s*1위/,
  /유일한/,
  /단\s*하나뿐/,
  /기적의/,
  /완벽한/,
  /만병통치/,
  /100\s*%\s*(국산|자연|효과)/,
  /무공해/,
  /저공해/,
  /청정/,
]

/** 체험담 기만 (소비자 오인, §8 5호) — 2025-05 단속에서 23건 적발. */
const TIER5: RegExp[] = [
  /먹고\s*\d+\s*(kg|키로|킬로)\s*(빠|뺐|줄)/,
  /먹고\s*키가\s*컸/,
  /먹고\s*\S+이\s*(좋아|나았|개선)/,
  /(직접|실제로)\s*먹어보(니|고)\s*효과/,
  /후기.*효과/,
  /환자.*먹고/,
  /병원에서.*추천/,
]

/** 인증 없으면 사용 금지 (Tier 4) */
const RESTRICTED_CERT: RegExp[] = [
  /유기농/,
  /유기재배/,
  /오가닉/,
  /\bORGANIC\b/i,
  /친환경/,
  /무농약/,
  /무항생제/,
  /GAP\s*인증/,
  /HACCP/,
  /지리적\s*표시/,
]

const ALL_RULES: { tier: 1 | 2 | 3 | 4 | 5; patterns: RegExp[] }[] = [
  { tier: 1, patterns: TIER1 },
  { tier: 2, patterns: TIER2 },
  { tier: 3, patterns: TIER3 },
  { tier: 4, patterns: RESTRICTED_CERT },
  { tier: 5, patterns: TIER5 },
]

export interface ForbiddenHit {
  tier: 1 | 2 | 3 | 4 | 5
  pattern: string
  matched: string
}

/** Tier → 식약처 §8 조항 매핑 (compliance-report.ts에서 사용). */
export const TIER_TO_CLAUSE: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "§8 1·2호 (질병 치료·예방 / 의약품 오인)",
  2: "§8 4호 (건강기능식품 오인)",
  3: "§8 4·7호 (절대표현·과장)",
  4: "친환경농어업법·식품법 (인증 표시 위반)",
  5: "§8 5호 (체험담 기만)",
}

/** 단일 문자열을 검사해 금지 표현이 있으면 첫 매치를 반환. */
export function checkForbidden(text: string): ForbiddenHit | null {
  if (!text) return null
  for (const { tier, patterns } of ALL_RULES) {
    for (const re of patterns) {
      const m = text.match(re)
      if (m) return { tier, pattern: re.source, matched: m[0] }
    }
  }
  return null
}

/**
 * 인증번호별 허용 단어 매핑.
 *
 * "유기농/오가닉/친환경"은 GAP만으로는 허용 안 됨 (서로 다른 인증).
 * 인증별로 정확히 그 표현만 풀어준다.
 */
const CERT_ALLOW_MAP: Record<"gap" | "organic" | "pesticideFree", RegExp[]> = {
  gap: [/GAP\s*인증/, /GAP/],
  organic: [/유기농/, /유기재배/, /오가닉/, /\bORGANIC\b/i, /친환경/],
  pesticideFree: [/무농약/, /친환경/],
}

export interface CertHeld {
  gap?: boolean
  organic?: boolean
  pesticideFree?: boolean
}

/**
 * 셀러가 보유한 인증으로 허용되는 단어인지 확인.
 * @returns true면 통과 (인증으로 정당화됨)
 */
function isAllowedByCerts(matched: string, held: CertHeld): boolean {
  for (const [key, patterns] of Object.entries(CERT_ALLOW_MAP) as [
    keyof CertHeld,
    RegExp[],
  ][]) {
    if (!held[key]) continue
    for (const p of patterns) {
      if (p.test(matched)) return true
    }
  }
  return false
}

/**
 * 소구점 후보 배열을 필터링.
 * Tier 1·2·3·5는 무조건 제거. Tier 4는 보유 인증과 매칭될 때만 허용.
 * 결과는 중복 제거 + 60자 초과 제거 + 최대 10개.
 */
export function filterForbiddenPoints(
  points: string[],
  opts: { hasCert?: boolean; certs?: CertHeld } = {},
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const certs: CertHeld = opts.certs ?? {}
  const hasAnyCert =
    opts.hasCert ||
    !!(certs.gap || certs.organic || certs.pesticideFree)
  for (const raw of points) {
    if (typeof raw !== "string") continue
    const p = raw.trim()
    if (!p) continue
    if (p.length > 60) continue
    const hit = checkForbidden(p)
    if (hit) {
      if (hit.tier === 4 && hasAnyCert && isAllowedByCerts(hit.matched, certs)) {
        // 인증으로 정당화 — 통과
      } else {
        continue
      }
    }
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
    if (out.length >= 10) break
  }
  return out
}

/**
 * 문자열 안의 모든 금지 표현 위치 — compliance-report.ts 용.
 * 길이가 긴 텍스트에 대해 전체 매칭을 모음.
 */
export function checkForbiddenAll(text: string): ForbiddenHit[] {
  if (!text) return []
  const hits: ForbiddenHit[] = []
  for (const { tier, patterns } of ALL_RULES) {
    for (const re of patterns) {
      const re2 = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")
      let m: RegExpExecArray | null
      while ((m = re2.exec(text)) !== null) {
        hits.push({ tier, pattern: re.source, matched: m[0] })
        if (m.index === re2.lastIndex) re2.lastIndex++
      }
    }
  }
  return hits
}
