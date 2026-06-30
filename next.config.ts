import type { NextConfig } from "next"

/**
 * 정적 export 모드 — Cloudflare Pages 또는 GitHub Pages 배포 전제.
 * GitHub Pages 하위 경로(`/fdp/`) 배포 시 NEXT_PUBLIC_BASE_PATH=/fdp 환경변수 설정.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ""

const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  trailingSlash: true,
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  images: {
    unoptimized: true,
  },
}

export default nextConfig
