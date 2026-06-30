/**
 * 식약처 광고 금지 표현 필터.
 *
 * 출처: 식품 등의 표시·광고에 관한 법률 §8, 친환경농어업법, 원산지표시법.
 * Tier 1 — 의약품/질병 직결 (형사처벌 위험)
 * Tier 2 — 일반식품 금지 (건기식 오인)
 * Tier 3 — 인증 미보유 시 금지 (유기농/친환경/무농약 등)
 *
 * 본 모듈은 AI가 추천한 소구점, 또는 셀러 자유 입력에 한해 1차 차단용.
 * 100% 완벽한 필터는 불가능 — 셀러에게 검수 책임은 그대로 남는다는 디스클레임 필요.
 */

/** 즉시 차단 (의약품/질병/거짓 단정) */
const TIER1: RegExp[] = [
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
  /질병\s*예방/,
  /의사\s*추천/,
  /박사\s*추천/,
  /임상\s*입증/,
]

/** 일반식품 금지 (건기식 기능성 표현) */
const TIER2: RegExp[] = [
  /면역력\s*(강화|증진|향상)/,
  /항산화\s*(효과|작용)/,
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
  /숙취\s*해소/,
]

/** 절대표현·과장 (근거 없을 때) */
const TIER3: RegExp[] = [
  /최고\s*품질/,
  /세계\s*최초/,
  /국내\s*1위/,
  /업계\s*1위/,
  /유일한/,
  /기적의/,
  /완벽한/,
  /만병통치/,
  /100\s*%\s*(국산|자연|효과)/,
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

const ALL_RULES: { tier: 1 | 2 | 3 | 4; patterns: RegExp[] }[] = [
  { tier: 1, patterns: TIER1 },
  { tier: 2, patterns: TIER2 },
  { tier: 3, patterns: TIER3 },
  { tier: 4, patterns: RESTRICTED_CERT },
]

export interface ForbiddenHit {
  tier: 1 | 2 | 3 | 4
  pattern: string
  matched: string
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
 * Tier 1·2·3은 무조건 제거. Tier 4는 보유 인증과 매칭될 때만 허용.
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
