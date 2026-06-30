"use client"

/**
 * 모바일 하단 고정 CTA — v1.8.
 *
 * 한국 모바일 쇼핑몰 PDP 표준 (thumb zone + 44px 이상 + sticky bottom).
 * 스크롤 50% 이상 내려간 후에만 표시 (visible prop으로 제어).
 *
 * 우리 사이트의 "복사 / 다운로드"가 사실상 conversion event이므로
 * sticky 복사 CTA가 셀러 워크플로와 일치.
 */

import { useEffect, useState } from "react"

interface StickyMobileCtaProps {
  onCopy?: () => void
  onDownload?: () => void
  /** 외부에서 강제 표시. 미지정 시 자동 스크롤 감지. */
  forceVisible?: boolean
}

export function StickyMobileCta({ onCopy, onDownload, forceVisible }: StickyMobileCtaProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (forceVisible) {
      setVisible(true)
      return
    }
    if (typeof window === "undefined") return
    const onScroll = () => {
      const scrolled = window.scrollY
      const total =
        document.documentElement.scrollHeight - window.innerHeight
      const pct = total > 0 ? scrolled / total : 0
      setVisible(pct >= 0.3)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [forceVisible])

  if (!visible) return null

  return (
    <div
      className="fdp-no-print"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        padding: "12px 16px calc(env(safe-area-inset-bottom) + 12px)",
        background: "rgba(255, 255, 255, 0.96)",
        backdropFilter: "blur(8px)",
        borderTop: "1px solid #E9ECEF",
        display: "flex",
        gap: 8,
        maxWidth: 540,
        margin: "0 auto",
      }}
    >
      <button
        type="button"
        onClick={onCopy}
        style={{
          flex: 1,
          minHeight: 44,
          padding: "10px 12px",
          background: "#FFFFFF",
          color: "#E03131",
          border: "2px solid #E03131",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        📋 전체 카피 복사
      </button>
      <button
        type="button"
        onClick={onDownload}
        style={{
          flex: 1,
          minHeight: 44,
          padding: "10px 12px",
          background: "#E03131",
          color: "#FFFFFF",
          border: "2px solid #E03131",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(224, 49, 49, 0.3)",
        }}
      >
        📥 JPG 다운로드
      </button>
    </div>
  )
}
