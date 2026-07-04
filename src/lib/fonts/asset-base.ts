/**
 * 정적 배포 basePath 보정.
 *
 * 이 앱은 GitHub Pages에서 /fdp 하위로 서빙되는데(next.config basePath),
 * CSS/FontFace의 "/fonts/..." 절대경로는 basePath를 무시하고 도메인 루트를
 * 가리켜 404가 난다 (v1.6~v3.0 내내 폰트가 로드되지 않던 원인).
 * public/ 자산을 코드에서 참조할 때는 반드시 이 헬퍼를 거친다.
 */
export const ASSET_BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

export function assetUrl(path: string): string {
  return `${ASSET_BASE}${path}`
}
