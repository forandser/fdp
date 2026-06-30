"use client"

/**
 * 결과 미리보기 폭 프리셋 토글 (v1.9).
 *
 * 쿠팡 780 / 스마트스토어 860 / 11번가 831 / 자사몰 1000 / 모바일 414 / 모바일 360.
 * 셀러가 선택한 폭으로 미리보기 + PNG 캡처 → 그대로 자기 플랫폼에 업로드.
 */

export type WidthPresetKey =
  | "mobile-360"
  | "mobile-414"
  | "coupang-780"
  | "11st-831"
  | "smartstore-860"
  | "self-1000"

export const WIDTH_PRESETS: { key: WidthPresetKey; label: string; width: number; sub: string }[] = [
  { key: "mobile-360", label: "📱 360", width: 360, sub: "갤럭시 S 표준" },
  { key: "mobile-414", label: "📱 414", width: 414, sub: "아이폰 표준" },
  { key: "coupang-780", label: "쿠팡 780", width: 780, sub: "쿠팡 모바일" },
  { key: "11st-831", label: "11번가 831", width: 831, sub: "11번가 모바일" },
  { key: "smartstore-860", label: "스토어 860", width: 860, sub: "스마트스토어" },
  { key: "self-1000", label: "자사몰 1000", width: 1000, sub: "자유 폭" },
]

interface WidthPresetSwitcherProps {
  value: WidthPresetKey
  onChange: (key: WidthPresetKey) => void
}

export function WidthPresetSwitcher({ value, onChange }: WidthPresetSwitcherProps) {
  return (
    <div
      className="fdp-no-print"
      style={{
        padding: 12,
        background: "var(--color-bg-subtle)",
        borderRadius: 8,
        border: "1px solid var(--color-neutral-100)",
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: "var(--color-neutral-700)",
          margin: "0 0 8px",
          letterSpacing: 0.3,
          textTransform: "uppercase",
        }}
      >
        📐 미리보기 폭
      </p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 5,
        }}
      >
        {WIDTH_PRESETS.map((p) => {
          const on = p.key === value
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.key)}
              title={`${p.sub} (${p.width}px)`}
              style={{
                padding: "7px 6px",
                border: on
                  ? "2px solid var(--color-primary-600)"
                  : "1px solid var(--color-neutral-300)",
                borderRadius: 6,
                background: on
                  ? "var(--color-primary-50)"
                  : "var(--color-bg-surface)",
                color: on
                  ? "var(--color-primary-600)"
                  : "var(--color-neutral-900)",
                fontSize: 11,
                fontWeight: on ? 700 : 600,
                cursor: "pointer",
                textAlign: "center",
                transition: "all 0.15s",
                minHeight: 38,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1.2,
              }}
            >
              <span>{p.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
