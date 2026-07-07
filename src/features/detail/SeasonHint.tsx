"use client"

import { useMemo } from "react"
import { t } from "@/lib/i18n"
import { SHELL_COLOR, RADIUS } from "./shell-theme"
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

  // A2: 상태 색 점(dot) 1패턴 — 성공(제철)=그린 / 경고(비제철)=앰버 / 정보(모름)=뉴트럴.
  //     원시 이모지(✅⚠️💡)는 쓰지 않는다(문자열 이모지와 이중 렌더되던 버그 제거).
  const statusView =
    status?.kind === "in"
      ? { dot: SHELL_COLOR.success, text: t.season.inSeason, strong: true }
      : status?.kind === "off"
        ? {
            dot: SHELL_COLOR.warn,
            text: t.season.offSeason.replace("{range}", status.range),
            strong: false,
          }
        : status?.kind === "unknown"
          ? { dot: SHELL_COLOR.neutral, text: t.season.unknown, strong: false }
          : null

  // A2: 제철 힌트는 큰 카드 → 섹션 상단 한 줄 칩으로 축소.
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "7px 12px",
        marginBottom: 12,
        background: "var(--color-bg-subtle)",
        borderRadius: RADIUS.chip,
        border: "1px solid var(--color-neutral-200)",
        fontSize: "var(--font-size-sm)",
        lineHeight: 1.5,
      }}
    >
      {statusView ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: statusView.dot,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontWeight: statusView.strong ? 700 : 600,
              color: "var(--color-neutral-900)",
              wordBreak: "keep-all",
            }}
          >
            {statusView.text}
          </span>
        </span>
      ) : (
        <span style={{ fontWeight: 600, color: "var(--color-neutral-900)" }}>
          {t.season.title.replace("{month}", String(month))}
        </span>
      )}
      <span style={{ color: "var(--color-neutral-300)" }}>·</span>
      <span style={{ color: "var(--color-neutral-600)", wordBreak: "keep-all", minWidth: 0 }}>
        {/* 상태 칩이 앞에 오면 월 표기가 빠지므로 여기서 한 번 덧붙인다(중복 방지). */}
        {statusView ? `${t.season.title.replace("{month}", String(month))} ` : ""}
        {seasonList.join(" · ")}
      </span>
    </div>
  )
}
