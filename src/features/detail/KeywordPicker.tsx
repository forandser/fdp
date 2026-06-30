"use client"

import { useState } from "react"
import { PRESET_KEYWORDS } from "@/domain/keywords"
import { t } from "@/lib/i18n"

interface KeywordPickerProps {
  selected: string[]
  onChange: (selected: string[]) => void
  customKeywords: string[]
  onCustomChange: (custom: string[]) => void
  max?: number
}

export function KeywordPicker({
  selected,
  onChange,
  customKeywords,
  onCustomChange,
  max = 6,
}: KeywordPickerProps) {
  const [draft, setDraft] = useState("")

  const isPresetSelected = (label: string) => selected.includes(label)

  const togglePreset = (label: string) => {
    if (isPresetSelected(label)) {
      onChange(selected.filter((k) => k !== label))
    } else if (selected.length + customKeywords.length < max) {
      onChange([...selected, label])
    }
  }

  const addCustom = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    if (customKeywords.includes(trimmed)) return
    if (selected.length + customKeywords.length >= max) return
    onCustomChange([...customKeywords, trimmed])
    setDraft("")
  }

  const removeCustom = (label: string) => {
    onCustomChange(customKeywords.filter((k) => k !== label))
  }

  const totalCount = selected.length + customKeywords.length

  return (
    <div>
      <p
        style={{
          fontSize: "var(--font-size-sm)",
          color: "var(--color-neutral-500)",
          marginBottom: 10,
        }}
      >
        {t.detail.step3Hint} · {totalCount}/{max}
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 14,
        }}
      >
        {PRESET_KEYWORDS.map((k) => {
          const on = isPresetSelected(k.label)
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => togglePreset(k.label)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: on
                  ? "1px solid var(--color-primary-600)"
                  : "1px solid var(--color-neutral-300)",
                background: on ? "var(--color-primary-600)" : "var(--color-bg-surface)",
                color: on ? "var(--color-text-on-primary)" : "var(--color-neutral-900)",
                fontSize: "var(--font-size-sm)",
                cursor: "pointer",
                transition: "all 0.1s",
              }}
            >
              {on ? "✓ " : ""}
              {k.label}
            </button>
          )
        })}
      </div>

      {customKeywords.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginBottom: 14,
          }}
        >
          {customKeywords.map((k) => (
            <span
              key={k}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "6px 12px",
                borderRadius: 999,
                background: "var(--color-primary-100)",
                color: "var(--color-primary-700)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              {k}
              <button
                type="button"
                onClick={() => removeCustom(k)}
                aria-label={`${k} 삭제`}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--color-primary-700)",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              addCustom()
            }
          }}
          placeholder={t.detail.customKeywordPh}
          disabled={totalCount >= max}
          style={{
            flex: 1,
            padding: "8px 12px",
            border: "1px solid var(--color-neutral-100)",
            borderRadius: "var(--radius-xs)",
            fontSize: "var(--font-size-sm)",
            background: "var(--color-bg-surface)",
            color: "var(--color-neutral-900)",
          }}
        />
        <button
          type="button"
          onClick={addCustom}
          disabled={!draft.trim() || totalCount >= max}
          style={{
            padding: "8px 14px",
            border: "1px solid var(--color-neutral-300)",
            borderRadius: "var(--radius-xs)",
            background: "var(--color-bg-surface)",
            color: "var(--color-neutral-900)",
            fontSize: "var(--font-size-sm)",
            cursor: draft.trim() && totalCount < max ? "pointer" : "not-allowed",
          }}
        >
          {t.detail.addCustomKeyword}
        </button>
      </div>
    </div>
  )
}
