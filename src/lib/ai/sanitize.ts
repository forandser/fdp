/**
 * 셀러 입력 sanitize — 프롬프트 인젝션 1차 방어선.
 *
 * 100% 완벽은 불가능하지만 흔한 인젝션 패턴 차단으로 표면을 줄인다.
 * Claude 응답 후 추가 화이트리스트 검증으로 2차 방어.
 */

const INJECTION_PATTERNS = [
  /\bignore\s+(all\s+)?(previous|prior|above)\b/i,
  /\bdisregard\s+(all\s+)?(previous|prior|above)\b/i,
  /\b(system|assistant)\s*:/i,
  /<\|im_(start|end)\|>/i,
  /<\|endoftext\|>/i,
  /\[INST\]/i,
  /<<SYS>>/i,
]

const URL_PATTERN = /https?:\/\/[^\s)]+/gi
const HTML_TAG_PATTERN = /<\/?[a-z][^>]*>/gi

/**
 * 단일 문자열에서 인젝션 시도 흔적 제거.
 * - 알려진 인젝션 토큰 제거
 * - URL 제거 (외부 URL이 카피에 박히는 사고 방지)
 * - HTML 태그 제거 (XSS 방어 보조)
 */
export function sanitizeString(input: string): string {
  let s = String(input)
  for (const pat of INJECTION_PATTERNS) {
    s = s.replace(pat, "")
  }
  s = s.replace(URL_PATTERN, "")
  s = s.replace(HTML_TAG_PATTERN, "")
  return s.trim()
}

export function sanitizeStringArray(arr: string[]): string[] {
  return arr.map(sanitizeString).filter((s) => s.length > 0)
}
