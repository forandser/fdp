"use client"

/**
 * AI 추천 소구점 패널.
 *
 * 사용자가 입력한 기본 정보(상품명/카테고리/품종/산지/중량/당도/가격)를
 * AI 어댑터에 보내 한국 농산물 상세페이지용 소구점 후보를 받아 카드로 보여준다.
 * 카드를 누르면 customKeywords(KeywordPicker가 관리)에 추가/제거되는 토글.
 *
 * 식약처 가이드 위반 표현은 프롬프트 단에서 1차 차단하지만,
 * 클라이언트에서도 차단 단어 정규식 가드로 한 번 더 거른다.
 */

import { useMemo, useState } from "react"
import { getAIProvider } from "@/lib/ai/provider"
import type {
  SuggestPointsInput,
  ProductCategory,
  CopyTone,
  TrustInfo,
} from "@/lib/ai/types"
import { filterForbiddenPoints, type CertHeld } from "@/lib/ai/forbidden-words"
import { detectFruitFactKey, FRUIT_FACTS } from "@/domain/fruit-facts"
import { t } from "@/lib/i18n"

interface Props {
  category: ProductCategory
  productName: string
  variety?: string
  origin?: string
  weight?: string
  brix?: number
  price?: number
  tone?: CopyTone
  trust?: TrustInfo
  /** 현재 선택된 customKeywords (외부 상태) */
  customKeywords: string[]
  /** 카드 클릭 시 토글 — 부모가 customKeywords 갱신 */
  onToggle: (point: string) => void
}

export function SellingPointsSuggester({
  category,
  productName,
  variety,
  origin,
  weight,
  brix,
  price,
  tone,
  trust,
  customKeywords,
  onToggle,
}: Props) {
  const [points, setPoints] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSuggest = !!productName.trim()

  /** fruit-facts 기반 즉시 추천 (AI 호출 X) — v1.9. */
  const baselineSuggestions = useMemo<string[]>(() => {
    const key = detectFruitFactKey(productName)
    if (!key) return []
    const fact = FRUIT_FACTS[key]
    if (!fact) return []
    return fact.hookHeadlines.slice(0, 6)
  }, [productName])

  const runSuggest = async () => {
    if (!canSuggest) {
      setError(t.detail.suggest.needBasics)
      return
    }
    setError(null)
    setLoading(true)
    try {
      const input: SuggestPointsInput = {
        category,
        productType: productName.trim(),
        variety: variety?.trim() || undefined,
        origin: origin?.trim() || undefined,
        weight: weight?.trim() || undefined,
        brix,
        price,
        tone,
      }
      const res = await getAIProvider().suggestSellingPoints(input)
      const certs: CertHeld = {
        gap: !!trust?.gapNumber?.trim(),
        organic: !!trust?.organicNumber?.trim(),
        pesticideFree: !!trust?.pesticideFreeNumber?.trim(),
      }
      const cleaned = filterForbiddenPoints(res.points, { certs })
      setPoints(cleaned)
      if (cleaned.length === 0) {
        setError(t.detail.suggest.empty)
      }
    } catch (e) {
      console.error("[suggestSellingPoints]", e)
      setError(t.detail.suggest.error)
    } finally {
      setLoading(false)
    }
  }

  const selectedSet = new Set(customKeywords)

  return (
    <div
      style={{
        marginBottom: 14,
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
            {t.detail.suggest.title}
          </p>
          <p
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-neutral-500)",
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {t.detail.suggest.hint}
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
            background: loading ? "var(--color-neutral-100)" : "var(--color-primary-600)",
            color: loading ? "var(--color-neutral-700)" : "var(--color-text-on-primary)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            cursor: loading || !canSuggest ? "not-allowed" : "pointer",
            opacity: !canSuggest ? 0.5 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {loading
            ? t.detail.suggest.loading
            : points
              ? t.detail.suggest.reroll
              : t.detail.suggest.button}
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

      {/* v1.9: fruit-facts 즉시 추천 (AI 호출 X — 무료) */}
      {baselineSuggestions.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--color-neutral-700)",
              margin: "0 0 4px",
              letterSpacing: 0.3,
            }}
          >
            ⚡ 즉시 추천 (사전 기반 · API 호출 없음)
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {baselineSuggestions.map((p) => {
              const on = selectedSet.has(p)
              return (
                <button
                  key={`base-${p}`}
                  type="button"
                  onClick={() => onToggle(p)}
                  aria-pressed={on}
                  aria-label={`${p} ${on ? t.detail.suggest.added : t.detail.suggest.addLabel}`}
                  style={{
                    padding: "5px 11px",
                    borderRadius: 999,
                    border: on
                      ? "1px solid var(--color-primary-600)"
                      : "1px solid #FFB186",
                    background: on
                      ? "var(--color-primary-600)"
                      : "#FFF8F1",
                    color: on
                      ? "var(--color-text-on-primary)"
                      : "#7A2E12",
                    fontSize: 12.5,
                    cursor: "pointer",
                    transition: "all 0.1s",
                    textAlign: "left",
                  }}
                >
                  {on ? "✓ " : "+ "}
                  {p}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {points && points.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--color-neutral-700)",
              margin: "0 0 4px",
              letterSpacing: 0.3,
            }}
          >
            ✨ AI 추천 (이번 입력 맞춤)
          </p>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {points.map((p) => {
              const on = selectedSet.has(p)
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => onToggle(p)}
                  aria-pressed={on}
                  aria-label={`${p} ${on ? t.detail.suggest.added : t.detail.suggest.addLabel}`}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: on
                      ? "1px solid var(--color-primary-600)"
                      : "1px solid var(--color-neutral-300)",
                    background: on ? "var(--color-primary-600)" : "var(--color-bg-surface)",
                    color: on
                      ? "var(--color-text-on-primary)"
                      : "var(--color-neutral-900)",
                    fontSize: "var(--font-size-sm)",
                    cursor: "pointer",
                    transition: "all 0.1s",
                    textAlign: "left",
                  }}
                >
                  {on ? "✓ " : "+ "}
                  {p}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
