"use client"

/**
 * InlineEdit — 클릭하면 textarea/input으로 전환되는 인라인 편집 컴포넌트.
 *
 * UX 원칙 (비개발자 셀러 대상):
 * - hover 시 옅은 배경 + ✏️ 아이콘으로 "여기 누르면 고칠 수 있어요" 힌트
 * - 클릭 즉시 편집 진입, blur 시 자동 저장
 * - 키보드: Enter 저장(single), Ctrl/Cmd+Enter 저장(multiline), Escape 취소
 *
 * 룰북:
 * - 'use client', TS strict, any 금지
 * - 색상은 CSS 변수(디자인 토큰)만 사용
 * - 한글 라벨은 i18n 키(t.detail.result.inlineEdit)에서
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react"
import { t } from "@/lib/i18n"

export interface InlineEditProps {
  /** 현재 값 (controlled) */
  value: string
  /** blur/Enter 등으로 확정될 때 호출 */
  onChange: (next: string) => void
  /** true면 textarea, false면 input. 기본 false. */
  multiline?: boolean
  /** 최대 글자수 (선택) */
  maxLength?: number
  /** 비어있을 때 회색 안내 문구. 미지정 시 t.detail.result.inlineEdit.placeholder */
  placeholder?: string
  /**
   * 표시용 텍스트의 inline 스타일.
   * 부모(h1/p/td 등)가 이미 스타일을 지정한 경우 비워둬도 됨.
   */
  style?: CSSProperties
  /** 편집 비활성화 (예: 읽기 전용 미리보기) */
  disabled?: boolean
  /** 접근성 라벨 (편집 textarea의 aria-label) */
  ariaLabel?: string
  /** 표시 시 줄바꿈 유지 여부. multiline=true면 자동으로 pre-line. */
  preserveWhitespace?: boolean
}

export function InlineEdit({
  value,
  onChange,
  multiline = false,
  maxLength,
  placeholder,
  style,
  disabled,
  ariaLabel,
  preserveWhitespace,
}: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [hovering, setHovering] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)

  // 부모가 value를 바꾸면(예: 재생성) 편집 중이 아닐 때 동기화
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  // 편집 진입 시 포커스 + 텍스트 끝으로 캐럿 이동 + textarea 자동 높이
  useLayoutEffect(() => {
    if (!editing) return
    const el = inputRef.current
    if (!el) return
    el.focus()
    const len = el.value.length
    try {
      el.setSelectionRange(len, len)
    } catch {
      // input type 따라 setSelectionRange 미지원 가능 — 무시
    }
    if (multiline && el instanceof HTMLTextAreaElement) {
      el.style.height = "auto"
      el.style.height = el.scrollHeight + "px"
    }
  }, [editing, multiline])

  const commit = useCallback(
    (next: string) => {
      const trimmed = maxLength != null ? next.slice(0, maxLength) : next
      if (trimmed !== value) onChange(trimmed)
      setEditing(false)
    },
    [maxLength, onChange, value],
  )

  const cancel = useCallback(() => {
    setDraft(value)
    setEditing(false)
  }, [value])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault()
        cancel()
        return
      }
      if (e.key === "Enter") {
        if (multiline) {
          // multiline: Ctrl/Cmd + Enter 만 저장. 일반 Enter는 줄바꿈.
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault()
            commit(draft)
          }
        } else {
          // single line: Enter 저장
          e.preventDefault()
          commit(draft)
        }
      }
    },
    [cancel, commit, draft, multiline],
  )

  // ────────────────────────────────────────────────
  // 표시 모드
  // ────────────────────────────────────────────────
  if (!editing) {
    const isEmpty = value.trim().length === 0
    const displayValue = isEmpty ? (placeholder ?? t.detail.result.inlineEdit.placeholder) : value

    const baseStyle: CSSProperties = {
      cursor: disabled ? "default" : "text",
      borderRadius: 4,
      padding: "2px 4px",
      margin: "-2px -4px",
      transition: "background 0.15s",
      background: hovering && !disabled ? "var(--color-primary-100)" : "transparent",
      outline: "none",
      position: "relative",
      color: isEmpty ? "var(--color-neutral-500)" : undefined,
      whiteSpace: multiline || preserveWhitespace ? "pre-line" : undefined,
      // 부모 inline 스타일은 그대로 받는다 (font/color 등은 상속)
      ...style,
    }

    return (
      <span
        role={disabled ? undefined : "button"}
        tabIndex={disabled ? -1 : 0}
        // 캡처 클론에서 hover 하이라이트 배경을 지우기 위한 마커 (html-to-jpg가 사용)
        data-inline-edit=""
        // 빈 값 placeholder는 편집 안내일 뿐 콘텐츠가 아니므로 JPG 캡처에서 제거
        {...(isEmpty ? { "data-edit-chrome": "" } : {})}
        aria-label={ariaLabel ?? t.detail.result.inlineEdit.editLabel}
        onClick={() => !disabled && setEditing(true)}
        onKeyDown={(e) => {
          if (disabled) return
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            setEditing(true)
          }
        }}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={baseStyle}
      >
        {displayValue}
        {hovering && !disabled && (
          <span
            aria-hidden="true"
            data-edit-chrome=""
            style={{
              marginLeft: 6,
              fontSize: "0.85em",
              opacity: 0.7,
              userSelect: "none",
            }}
          >
            ✏️
          </span>
        )}
      </span>
    )
  }

  // ────────────────────────────────────────────────
  // 편집 모드
  // ────────────────────────────────────────────────
  const inputBaseStyle: CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid var(--color-primary-600)",
    borderRadius: 4,
    padding: "4px 6px",
    margin: "-5px -7px",
    outline: "none",
    background: "var(--color-bg-surface)",
    // 부모 폰트/컬러 상속
    font: "inherit",
    color: "inherit",
    lineHeight: "inherit",
    textAlign: "inherit",
    resize: multiline ? "vertical" : "none",
    ...style,
  }

  if (multiline) {
    return (
      <textarea
        ref={(el) => {
          inputRef.current = el
        }}
        value={draft}
        onChange={(e) => {
          const v = maxLength != null ? e.target.value.slice(0, maxLength) : e.target.value
          setDraft(v)
          // 자동 높이
          e.currentTarget.style.height = "auto"
          e.currentTarget.style.height = e.currentTarget.scrollHeight + "px"
        }}
        onBlur={() => commit(draft)}
        onKeyDown={handleKeyDown}
        maxLength={maxLength}
        placeholder={placeholder ?? t.detail.result.inlineEdit.placeholder}
        aria-label={ariaLabel ?? t.detail.result.inlineEdit.editLabel}
        style={inputBaseStyle}
        rows={Math.max(2, Math.min(10, draft.split("\n").length))}
      />
    )
  }

  return (
    <input
      ref={(el) => {
        inputRef.current = el
      }}
      type="text"
      value={draft}
      onChange={(e) => {
        const v = maxLength != null ? e.target.value.slice(0, maxLength) : e.target.value
        setDraft(v)
      }}
      onBlur={() => commit(draft)}
      onKeyDown={handleKeyDown}
      maxLength={maxLength}
      placeholder={placeholder ?? t.detail.result.inlineEdit.placeholder}
      aria-label={ariaLabel ?? t.detail.result.inlineEdit.editLabel}
      style={inputBaseStyle}
    />
  )
}
