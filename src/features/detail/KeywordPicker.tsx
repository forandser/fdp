"use client"

import { useState } from "react"
import { PRESET_KEYWORDS } from "@/domain/keywords"
import { getAIProvider } from "@/lib/ai/provider"
import type {
  CopyTone,
  ProductCategory,
  SuggestPointsInput,
} from "@/lib/ai/types"
import { t } from "@/lib/i18n"

interface KeywordPickerProps {
  selected: string[]
  onChange: (selected: string[]) => void
  customKeywords: string[]
  onCustomChange: (custom: string[]) => void
  max?: number
  /** AI 키워드 추천을 위한 컨텍스트 (모두 선택). 없으면 추천 버튼 자체는 보이되 비활성. */
  category?: ProductCategory
  productName?: string
  variety?: string
  origin?: string
  weight?: string
  brix?: number
  price?: number
  tone?: CopyTone
}

export function KeywordPicker({
  selected,
  onChange,
  customKeywords,
  onCustomChange,
  max = 6,
  category,
  productName,
  variety,
  origin,
  weight,
  brix,
  price,
  tone,
}: KeywordPickerProps) {
  const [draft, setDraft] = useState("")
  const [aiKeywords, setAiKeywords] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
  const isFull = totalCount >= max

  const canSuggest = !!(productName && productName.trim())

  const runSuggest = async () => {
    if (!canSuggest) {
      setError(t.detail.keywordSuggest.needBasics)
      return
    }
    setError(null)
    setLoading(true)
    try {
      const input: SuggestPointsInput = {
        category: category ?? "fruit",
        productType: productName!.trim(),
        variety: variety?.trim() || undefined,
        origin: origin?.trim() || undefined,
        weight: weight?.trim() || undefined,
        brix,
        price,
        tone,
      }
      const res = await getAIProvider().suggestKeywords(input)
      // 이미 선택된 것은 제외하지 않고, 카드에서 ✓로 표시
      setAiKeywords(res.keywords)
      if (res.keywords.length === 0) {
        setError(t.detail.keywordSuggest.empty)
      }
    } catch (e) {
      console.error("[suggestKeywords]", e)
      setError(t.detail.keywordSuggest.error)
    } finally {
      setLoading(false)
    }
  }

  const customSet = new Set(customKeywords)
  const presetSet = new Set(selected)

  const toggleAiKeyword = (kw: string) => {
    if (customSet.has(kw)) {
      onCustomChange(customKeywords.filter((k) => k !== kw))
      return
    }
    if (presetSet.has(kw)) {
      // 이미 프리셋으로 선택된 경우 토글 없음 (안내)
      return
    }
    if (isFull) {
      setError(t.detail.keywordSuggest.max)
      return
    }
    setError(null)
    onCustomChange([...customKeywords, kw])
  }

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

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
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
          disabled={isFull}
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
          disabled={!draft.trim() || isFull}
          style={{
            padding: "8px 14px",
            border: "1px solid var(--color-neutral-300)",
            borderRadius: "var(--radius-xs)",
            background: "var(--color-bg-surface)",
            color: "var(--color-neutral-900)",
            fontSize: "var(--font-size-sm)",
            cursor: draft.trim() && !isFull ? "pointer" : "not-allowed",
          }}
        >
          {t.detail.addCustomKeyword}
        </button>
      </div>

      {/* AI 키워드 추천 패널 */}
      <div
        style={{
          padding: 14,
          background: "var(--color-bg-subtle)",
          borderRadius: "var(--radius-xs)",
          border: "1px dashed var(--color-neutral-300)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
            gap: 8,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p
              style={{
                fontSize: "var(--font-size-sm)",
                fontWeight: 700,
                color: "var(--color-neutral-900)",
                margin: 0,
                marginBottom: 2,
              }}
            >
              {t.detail.keywordSuggest.title}
            </p>
            <p
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-neutral-500)",
                margin: 0,
                lineHeight: 1.4,
              }}
            >
              {t.detail.keywordSuggest.hint}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void runSuggest()}
            disabled={loading || !canSuggest}
            style={{
              flexShrink: 0,
              padding: "8px 14px",
              border: "1px solid var(--color-primary-600)",
              borderRadius: "var(--radius-xs)",
              background: loading
                ? "var(--color-neutral-100)"
                : "var(--color-primary-600)",
              color: loading
                ? "var(--color-neutral-700)"
                : "var(--color-text-on-primary)",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              cursor: loading || !canSuggest ? "not-allowed" : "pointer",
              opacity: !canSuggest ? 0.5 : 1,
              whiteSpace: "nowrap",
            }}
          >
            {loading
              ? t.detail.keywordSuggest.loading
              : aiKeywords
                ? t.detail.keywordSuggest.reroll
                : t.detail.keywordSuggest.button}
          </button>
        </div>

        {error && (
          <p
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-danger)",
              margin: 0,
              marginTop: 6,
            }}
          >
            {error}
          </p>
        )}

        {aiKeywords && aiKeywords.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginTop: 10,
            }}
          >
            {aiKeywords.map((kw) => {
              const on = customSet.has(kw) || presetSet.has(kw)
              const disabled = isFull && !on
              return (
                <button
                  key={kw}
                  type="button"
                  onClick={() => toggleAiKeyword(kw)}
                  disabled={disabled}
                  aria-pressed={on}
                  aria-label={`${kw} ${on ? t.detail.keywordSuggest.added : t.detail.keywordSuggest.addLabel}`}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: on
                      ? "1px solid var(--color-primary-600)"
                      : "1px solid var(--color-neutral-300)",
                    background: on
                      ? "var(--color-primary-600)"
                      : "var(--color-bg-surface)",
                    color: on
                      ? "var(--color-text-on-primary)"
                      : "var(--color-neutral-900)",
                    fontSize: "var(--font-size-sm)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.5 : 1,
                    transition: "all 0.1s",
                    textAlign: "left",
                  }}
                >
                  {on ? "✓ " : "+ "}
                  {kw}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
