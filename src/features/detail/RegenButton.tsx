"use client"

/**
 * 섹션 옆에 떠 있는 작은 "다시 만들기" 버튼.
 *
 * UX 규칙:
 * - 평소엔 흐릿 / 호버 시 또렷 (부모가 hover 상태를 넘겨주거나, group-hover 패턴)
 * - 재생성 중엔 스피너 + 비활성화 (중복 클릭 차단)
 * - 비개발자 사용자: 아이콘 + 짧은 라벨, i18n 키 사용
 */

import { useState } from "react"
import { t } from "@/lib/i18n"
import type { SectionId } from "@/lib/ai/section-regenerate"

interface RegenButtonProps {
  sectionId: SectionId
  onRegenerate: (sectionId: SectionId) => Promise<void> | void
  /** 부모가 외부에서 강제로 진행 상태를 줄 수 있게 (다른 섹션 재생성 중 잠금 등). */
  disabled?: boolean
  /** 부모가 호버 그룹을 만들 때 항상 보이게 강제하고 싶으면 true. */
  alwaysVisible?: boolean
  /** 절대 위치 띄움용 — 부모가 position: relative 컨테이너를 만든 경우. */
  floating?: boolean
  /** 라벨 오버라이드 (기본: "🔄 다시"). 예: 헤드라인 후보 재생성 = "후보 새로 받기". */
  label?: string
  /** 진행 중 라벨 오버라이드 (기본: "다시 만드는 중..."). */
  busyLabel?: string
}

export function RegenButton({
  sectionId,
  onRegenerate,
  disabled,
  alwaysVisible,
  floating,
}: RegenButtonProps) {
  const [busy, setBusy] = useState(false)
  const [hover, setHover] = useState(false)

  const isDisabled = busy || disabled === true

  const handleClick = async (): Promise<void> => {
    if (isDisabled) return
    setBusy(true)
    try {
      await onRegenerate(sectionId)
    } finally {
      setBusy(false)
    }
  }

  // 가시성: busy거나 alwaysVisible이면 항상 표시, 그 외엔 hover 시에만.
  const visible = busy || alwaysVisible === true || hover

  const positionStyle: React.CSSProperties = floating === true
    ? { position: "absolute", top: 0, right: 0 }
    : { position: "relative" }

  return (
    <button
      type="button"
      data-edit-chrome
      onClick={handleClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      disabled={isDisabled}
      aria-label={busy ? t.detail.sectionRegen.regenerating : t.detail.sectionRegen.button}
      title={busy ? t.detail.sectionRegen.regenerating : t.detail.sectionRegen.tooltip}
      style={{
        ...positionStyle,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "4px 10px",
        fontSize: "var(--font-size-xs)",
        fontWeight: 600,
        color: busy
          ? "var(--color-neutral-500)"
          : "var(--color-primary-700)",
        background: busy
          ? "var(--color-neutral-100)"
          : "var(--color-primary-100)",
        border: "1px solid var(--color-primary-200, var(--color-neutral-300))",
        borderRadius: 999,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.15s ease, background 0.15s ease",
        pointerEvents: visible ? "auto" : "none",
        whiteSpace: "nowrap",
        lineHeight: 1.2,
      }}
    >
      {busy ? (
        <>
          <Spinner />
          <span>{t.detail.sectionRegen.regenerating}</span>
        </>
      ) : (
        <span>{t.detail.sectionRegen.button}</span>
      )}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 10,
        height: 10,
        border: "2px solid var(--color-neutral-300)",
        borderTopColor: "var(--color-primary-600)",
        borderRadius: "50%",
        display: "inline-block",
        animation: "regen-spin 0.7s linear infinite",
      }}
    >
      <style>{`@keyframes regen-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  )
}

/**
 * 섹션 컨테이너 wrapper — 호버 시 RegenButton이 보이는 group 효과.
 * 부모가 직접 만들어도 되지만, 공통 패턴을 한 번 노출한다.
 */
export function RegenHoverGroup({
  children,
  button,
}: {
  children: React.ReactNode
  button: React.ReactNode
}) {
  const [hover, setHover] = useState(false)
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ position: "relative" }}
    >
      <div
        data-edit-chrome
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          zIndex: 1,
          opacity: hover ? 1 : 0,
          transition: "opacity 0.15s ease",
          pointerEvents: hover ? "auto" : "none",
        }}
      >
        {button}
      </div>
      {children}
    </div>
  )
}
