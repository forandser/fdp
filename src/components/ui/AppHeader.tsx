"use client"

import Link from "next/link"
import { t } from "@/lib/i18n"

export function AppHeader({
  keyMask,
  onClearKey,
  showBack,
}: {
  keyMask: string | null
  onClearKey: () => void | Promise<void>
  showBack?: boolean
}) {
  return (
    <header
      className="flex items-center justify-between px-6 py-3"
      style={{
        background: "var(--color-bg-surface)",
        borderBottom: "1px solid var(--color-neutral-100)",
      }}
    >
      <div className="flex items-center gap-3">
        {showBack && (
          <Link
            href="/"
            style={{
              padding: "6px 12px",
              borderRadius: "var(--radius-xs)",
              border: "1px solid var(--color-neutral-300)",
              color: "var(--color-neutral-700)",
              fontSize: "var(--font-size-sm)",
              textDecoration: "none",
            }}
          >
            ← {t.menu.back}
          </Link>
        )}
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            textDecoration: "none",
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: "linear-gradient(135deg, #E03131 0%, #FF6B6B 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#FFFFFF",
              fontWeight: 800,
              fontSize: 20,
              boxShadow: "0 2px 8px rgba(224, 49, 49, 0.25)",
            }}
            aria-hidden
          >
            🍑
          </div>
          <h1
            style={{
              fontSize: 17,
              fontWeight: 800,
              color: "var(--color-neutral-900)",
              letterSpacing: -0.3,
            }}
          >
            {t.app.name}
          </h1>
        </Link>
      </div>
      <div className="flex items-center gap-3">
        {keyMask && (
          <span
            title="이 브라우저에 암호화 저장됨. 다시 방문해도 유지됩니다."
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 999,
              background: "var(--color-success-tint, #ECFDF5)",
              border: "1px solid var(--color-success, #10B981)",
              color: "var(--color-success-dark, #047857)",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              letterSpacing: 0.1,
            }}
          >
            <span aria-hidden>🔐</span>
            <span>{keyMask}</span>
          </span>
        )}
        {/* v5.4(작업1): 키가 없을 땐(둘러보기) 삭제 버튼을 숨긴다 — 지울 게 없다. */}
        {keyMask && (
          <button
            type="button"
            onClick={() => void onClearKey()}
            style={{
              padding: "6px 14px",
              borderRadius: "var(--radius-xs)",
              border: "1px solid var(--color-neutral-400)",
              background: "var(--color-bg-surface)",
              color: "var(--color-neutral-900)",
              fontSize: "var(--font-size-sm)",
              cursor: "pointer",
            }}
          >
            {t.apiKey.clear}
          </button>
        )}
      </div>
    </header>
  )
}
