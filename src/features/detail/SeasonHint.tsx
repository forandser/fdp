"use client"

import { useMemo } from "react"
import { t } from "@/lib/i18n"
import {
  formatMonthRanges,
  getCurrentMonth,
  getCurrentSeasonFruits,
  getCurrentSeasonVeggies,
  getInSeasonMonths,
  isInSeason,
} from "@/domain/season"

interface SeasonHintProps {
  productName: string
  /** "fruit" | "veggie" | "other". 기본은 둘 다 표시. */
  category?: "fruit" | "veggie" | "other"
}

/**
 * 현재 월의 제철 목록을 한 줄로 표시하고,
 * productName이 있으면 제철 여부 안내를 보여준다.
 *
 * DetailMaker Step 2(기본 정보) 상단에 끼워 넣는 용도.
 */
export function SeasonHint({ productName, category }: SeasonHintProps) {
  const month = getCurrentMonth()

  const seasonList = useMemo(() => {
    if (category === "fruit") return getCurrentSeasonFruits()
    if (category === "veggie") return getCurrentSeasonVeggies()
    return [...getCurrentSeasonFruits(), ...getCurrentSeasonVeggies()]
  }, [category])

  const trimmed = productName.trim()
  const status = useMemo(() => {
    if (!trimmed) return null
    if (isInSeason(trimmed)) {
      return { kind: "in" as const }
    }
    const months = getInSeasonMonths(trimmed)
    if (months.length === 0) {
      return { kind: "unknown" as const }
    }
    return { kind: "off" as const, range: formatMonthRanges(months) }
  }, [trimmed])

  return (
    <div
      style={{
        background: "var(--color-primary-50)",
        border: "1px solid var(--color-primary-100)",
        borderRadius: "var(--radius-xs)",
        padding: "12px 14px",
        marginBottom: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--color-neutral-900)",
        }}
      >
        {t.season.title.replace("{month}", String(month))}
      </div>
      <div
        style={{
          fontSize: "var(--font-size-sm)",
          color: "var(--color-neutral-700)",
          lineHeight: 1.5,
          wordBreak: "keep-all",
        }}
      >
        {seasonList.join(" · ")}
      </div>

      {status?.kind === "in" && (
        <div
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-primary-600)",
            fontWeight: 700,
            marginTop: 4,
          }}
        >
          ✅ {t.season.inSeason}
        </div>
      )}
      {status?.kind === "off" && (
        <div
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-neutral-700)",
            fontWeight: 600,
            marginTop: 4,
          }}
        >
          ⚠️ {t.season.offSeason.replace("{range}", status.range)}
        </div>
      )}
      {status?.kind === "unknown" && (
        <div
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-neutral-500)",
            marginTop: 4,
          }}
        >
          {t.season.unknown}
        </div>
      )}
    </div>
  )
}
