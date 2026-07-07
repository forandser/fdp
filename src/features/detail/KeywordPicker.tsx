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
import { SHELL_COLOR, RADIUS } from "./shell-theme"

/** A5: 선택된 칩(프리셋·AI 추천 공통) — 코랄 틴트 채움 + 체크. */
const selectedChipStyle: React.CSSProperties = {
  border: `1px solid ${SHELL_COLOR.tintBorder}`,
  background: SHELL_COLOR.tint,
  color: SHELL_COLOR.tintText,
  fontWeight: 700,
}
/** A5: 미선택 칩 — 흰 배경 아웃라인. */
const outlineChipStyle: React.CSSProperties = {
  border: "1px solid var(--color-neutral-300)",
  background: "var(--color-bg-surface)",
  color: "var(--color-neutral-900)",
  fontWeight: 400,
}

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
  /**
   * v5.4(작업1): AI 호출 전 키 보장. 키 없으면 부모가 등록 모달을 띄우고,
   * 성공 시 true(→그대로 추천 실행)/취소 시 false. 없으면 게이트 없이 진행(하위호환).
   */
  onRequireKey?: () => Promise<boolean>
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
  onRequireKey,
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
    // v5.4(작업1): 키 없으면 등록 모달 → 성공 시 이어서 추천. 취소면 조용히 중단.
    if (onRequireKey && !(await onRequireKey())) return
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
      {/* A5: "n/6 선택" 카운터를 미니 필로 승격 — 한도 도달 시 코랄 틴트로 채워 강조. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            flexShrink: 0,
            padding: "3px 10px",
            borderRadius: RADIUS.chip,
            fontSize: "var(--font-size-xs)",
            fontWeight: 700,
            border: isFull
              ? `1px solid ${SHELL_COLOR.tintBorder}`
              : "1px solid var(--color-neutral-300)",
            background: isFull ? SHELL_COLOR.tint : "var(--color-bg-surface)",
            color: isFull ? SHELL_COLOR.tintText : "var(--color-neutral-700)",
          }}
        >
          {totalCount}/{max} 선택
        </span>
        <span style={{ fontSize: "var(--font-size-sm)", color: "var(--color-neutral-500)" }}>
          {t.detail.step3Hint}
        </span>
      </div>

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
          // A5: 한도 도달 + 미선택 칩은 감쇠 + 클릭 무시(togglePreset 도 이미 가드).
          const dimmed = isFull && !on
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => togglePreset(k.label)}
              disabled={dimmed}
              style={{
                padding: "6px 12px",
                borderRadius: RADIUS.chip,
                fontSize: "var(--font-size-sm)",
                cursor: dimmed ? "not-allowed" : "pointer",
                opacity: dimmed ? 0.45 : 1,
                transition: "all 0.1s",
                ...(on ? selectedChipStyle : outlineChipStyle),
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
                borderRadius: RADIUS.chip,
                border: `1px solid ${SHELL_COLOR.tintBorder}`,
                background: SHELL_COLOR.tint,
                color: SHELL_COLOR.tintText,
                fontWeight: 700,
                fontSize: "var(--font-size-sm)",
              }}
            >
              ✓ {k}
              <button
                type="button"
                onClick={() => removeCustom(k)}
                aria-label={`${k} 삭제`}
                style={{
                  border: "none",
                  background: "transparent",
                  color: SHELL_COLOR.tintText,
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
            border: "1px solid var(--color-neutral-300)",
            borderRadius: RADIUS.control,
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
            borderRadius: RADIUS.control,
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
              // A5/A1: 보조 액션 — 흰 배경 + 코랄 보더 아웃라인(남색 채움 제거).
              border: `1px solid ${loading ? "var(--color-neutral-300)" : SHELL_COLOR.primary}`,
              borderRadius: RADIUS.control,
              background: "var(--color-bg-surface)",
              color: loading ? "var(--color-neutral-500)" : SHELL_COLOR.primary,
              fontSize: "var(--font-size-sm)",
              fontWeight: 700,
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
                    borderRadius: RADIUS.chip,
                    fontSize: "var(--font-size-sm)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.45 : 1,
                    transition: "all 0.1s",
                    textAlign: "left",
                    ...(on ? selectedChipStyle : outlineChipStyle),
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
