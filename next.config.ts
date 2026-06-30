import type { NextConfig } from "next"

/**
 * 정적 export 모드 — Cloudflare Pages 배포 전제.
 * 보안 헤더는 next.config의 headers()가 export 모드에서 동작 안 함 →
 * Cloudflare Pages 표준 `public/_headers` 파일로 정의됨.
 */
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: false,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
