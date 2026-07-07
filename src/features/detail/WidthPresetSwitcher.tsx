"use client"

/**
 * 통합 폭 툴바 (v5.7 / UI감사 B1·B4).
 *
 * 예전에는 미리보기 폭(사이드바 고급설정 속 버튼 그리드)과 내보내기 폭(ExportPanel select)이
 * 서로 독립이라 "860으로 편집하고 780으로 내보내면 줄바꿈이 달라지는" WYSIWYG 단절이 있었다.
 * 이제 폭 상태는 ResultView 한 곳이 주인이고, 이 툴바는 그 상태를 조작하는 단일 컨트롤이다.
 *
 * - 플랫폼 세그먼트(쿠팡780/11번가831/스토어860/자사몰1000): 누르면 미리보기와 내보내기 폭이 동시에 바뀐다.
 * - "모바일로 확인"(360/414): 저장 폭은 바꾸지 않는 보조 미리보기 토글(미리보기 전용).
 *   이 상태에선 공유 아트보드가 모바일 스타일로 렌더되므로 JPG 저장은 막힌다(ResultView가 blockedReason 처리).
 * - 편집 힌트·축소 안내를 여기 상주시킨다(B4의 절반).
 *
 * 아트보드/JPG 결과물과 무관 — captureRef 바깥의 형제이고 fdp-no-print 이므로 캡처에 절대 안 찍힌다.
 */

import { SHELL_COLOR, RADIUS } from "./shell-theme"

/** 내보내기(=미리보기 기본) 폭 프리셋 — 플랫폼 매체 폭. 이 값이 그대로 JPG 저장 폭이 된다. */
export type ExportWidth = 780 | 831 | 860 | 1000
/** 모바일 확인 전용 폭 — 내보내기와 무관한 보조 미리보기. */
export type MobileWidth = 360 | 414

/** v5.4 fdp:export-presets 복원 시 허용값 화이트리스트 — 저장본 오염 방어(ResultView·ExportPanel 공용). */
export const VALID_EXPORT_WIDTHS = new Set<ExportWidth>([780, 831, 860, 1000])

/** 플랫폼별 표기 폭 라벨은 감사 B1이 정한 폭 그대로. label 안에 숫자 포함(검증하네스가 텍스트로 버튼을 찾음). */
export const PLATFORM_PRESETS: { value: ExportWidth; label: string; sub: string }[] = [
  { value: 780, label: "쿠팡 780", sub: "쿠팡 모바일" },
  { value: 831, label: "11번가 831", sub: "11번가 모바일" },
  { value: 860, label: "스토어 860", sub: "스마트스토어" },
  { value: 1000, label: "자사몰 1000", sub: "자유 폭" },
]

export const MOBILE_PRESETS: { value: MobileWidth; label: string; sub: string }[] = [
  { value: 360, label: "📱 360", sub: "갤럭시 S 표준" },
  { value: 414, label: "📱 414", sub: "아이폰 표준" },
]

interface WidthToolbarProps {
  /** 플랫폼 폭(=내보내기 폭). 미리보기 기본 폭이기도 하다. */
  exportWidth: ExportWidth
  onChangeExportWidth: (w: ExportWidth) => void
  /** 활성 모바일 보조 미리보기 폭. null이면 플랫폼 폭으로 미리보기. */
  mobilePreview: MobileWidth | null
  onToggleMobilePreview: (w: MobileWidth) => void
  /** 현재 실제 미리보기 폭(mobilePreview ?? exportWidth) · 축소 안내용. */
  previewWidth: number
  /** scale-to-fit 배율(1이면 원본 크기). 축소 중일 때만 안내 노출. */
  previewScale: number
}

/**
 * 아트보드 위 얇은 스티키 툴바. 스크롤로 아트보드가 길게 흘러도 폭 컨트롤·힌트가 늘 보인다.
 */
export function WidthToolbar({
  exportWidth,
  onChangeExportWidth,
  mobilePreview,
  onToggleMobilePreview,
  previewWidth,
  previewScale,
}: WidthToolbarProps) {
  const scaled = previewScale < 0.999
  return (
    <div
      className="fdp-no-print"
      data-edit-chrome
      style={{
        position: "sticky",
        top: 8,
        zIndex: 5,
        marginBottom: 14,
        padding: "10px 12px",
        background: "var(--color-bg-surface)",
        border: "1px solid var(--color-neutral-100)",
        borderRadius: RADIUS.card,
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* 1행: 폭 컨트롤 — 플랫폼 세그먼트 + 모바일 보조 토글 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <span style={labelStyle}>📐 폭</span>
        {/* 플랫폼 세그먼트: 누르면 미리보기·내보내기 폭이 동시에 바뀐다 */}
        <div style={{ display: "flex", gap: 4 }}>
          {PLATFORM_PRESETS.map((p) => {
            const on = p.value === exportWidth
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => onChangeExportWidth(p.value)}
                title={`${p.sub} · 내보내기 ${p.value}px`}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = on ? SHELL_COLOR.primaryHover : SHELL_COLOR.tint
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = on ? SHELL_COLOR.primary : "var(--color-bg-surface)"
                }}
                style={segButtonStyle(on)}
              >
                {p.label}
              </button>
            )
          })}
        </div>

        <span aria-hidden style={dividerStyle} />

        {/* 모바일 보조 토글 — 내보내기 폭과 무관(캡션 명시). 다시 누르면 해제. */}
        <span style={{ ...labelStyle, color: "var(--color-neutral-600)" }}>모바일로 확인</span>
        <div style={{ display: "flex", gap: 4 }}>
          {MOBILE_PRESETS.map((m) => {
            const on = m.value === mobilePreview
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => onToggleMobilePreview(m.value)}
                aria-pressed={on}
                title={`${m.sub} · 미리보기 ${m.value}px (내보내기 폭과 무관)`}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = on ? SHELL_COLOR.primaryHover : SHELL_COLOR.tint
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = on ? SHELL_COLOR.primary : "var(--color-bg-surface)"
                }}
                style={segButtonStyle(on)}
              >
                {m.label}
              </button>
            )
          })}
        </div>
        <span style={{ fontSize: 11, color: "var(--color-neutral-500)" }}>미리보기 전용 · 저장은 플랫폼 폭에서</span>
      </div>

      {/* 2행: 편집 힌트 상시화(B4) + 축소 안내(툴바로 이동) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          fontSize: 12,
          color: "var(--color-neutral-600)",
        }}
      >
        <span>✏️ 텍스트를 클릭하면 바로 수정</span>
        {scaled && (
          <span style={{ color: "var(--color-neutral-500)" }}>
            · 실제 {previewWidth}px를 {Math.round(previewScale * 100)}%로 축소해 보는 중 (저장은 원본 크기)
          </span>
        )}
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--color-neutral-700)",
  letterSpacing: 0.2,
}

const dividerStyle: React.CSSProperties = {
  width: 1,
  alignSelf: "stretch",
  minHeight: 18,
  background: "var(--color-neutral-100)",
}

/** 세그먼트 버튼 1개 스타일. on=선택됨(코랄 채움) / off=아웃라인. */
function segButtonStyle(on: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    border: on ? `1px solid ${SHELL_COLOR.primary}` : "1px solid var(--color-neutral-300)",
    borderRadius: RADIUS.control,
    background: on ? SHELL_COLOR.primary : "var(--color-bg-surface)",
    color: on ? SHELL_COLOR.onPrimary : "var(--color-neutral-900)",
    fontSize: 12,
    fontWeight: on ? 700 : 600,
    cursor: "pointer",
    whiteSpace: "nowrap",
    lineHeight: 1.2,
    transition: "background 0.12s, border-color 0.12s",
  }
}
