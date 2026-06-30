"use client"

/**
 * 카피 품질 점수 카드 (v1.9).
 *
 * 사이드 패널에서 0~100점 + 8 차원 게이지로 시각화.
 * topImprovements 3개를 개선 제안으로 노출.
 */

import type { CopyQualityResult } from "@/lib/ai/copy-quality-score"

interface QualityScoreCardProps {
  score: CopyQualityResult
}

const GRADE_COLOR: Record<CopyQualityResult["grade"], { bg: string; fg: string }> = {
  A: { bg: "#52C41A", fg: "#FFFFFF" },
  B: { bg: "#1C7ED6", fg: "#FFFFFF" },
  C: { bg: "#FAAD14", fg: "#FFFFFF" },
  D: { bg: "#E03131", fg: "#FFFFFF" },
}

export function QualityScoreCard({ score }: QualityScoreCardProps) {
  const gradeColor = GRADE_COLOR[score.grade]
  return (
    <div
      className="fdp-no-print"
      style={{
        padding: 14,
        background: "var(--color-bg-surface)",
        border: "1px solid var(--color-neutral-100)",
        borderRadius: 10,
      }}
    >
      {/* 헤더 — 총점 + 등급 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--color-neutral-500)",
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            카피 품질 점수
          </div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 900,
              color: "var(--color-neutral-900)",
              lineHeight: 1.1,
              marginTop: 2,
            }}
          >
            {score.total}
            <span style={{ fontSize: 13, color: "var(--color-neutral-500)" }}> / 100</span>
          </div>
        </div>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: "50%",
            background: gradeColor.bg,
            color: gradeColor.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 900,
            boxShadow: `0 2px 8px ${gradeColor.bg}55`,
          }}
        >
          {score.grade}
        </div>
      </div>

      {/* 8 차원 게이지 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {score.dimensions.map((d) => {
          const pct = (d.earned / d.max) * 100
          const color =
            pct >= 85 ? "#52C41A" : pct >= 60 ? "#FAAD14" : "#E03131"
          return (
            <div key={d.key} title={d.hint}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: "var(--color-neutral-700)",
                  marginBottom: 2,
                }}
              >
                <span>{d.label}</span>
                <span style={{ color, fontWeight: 700 }}>
                  {d.earned}/{d.max}
                </span>
              </div>
              <div
                style={{
                  height: 5,
                  background: "var(--color-bg-subtle)",
                  borderRadius: 3,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: color,
                    transition: "width 0.3s",
                  }}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* 개선 제안 */}
      {score.topImprovements.length > 0 && score.total < 95 && (
        <details style={{ marginTop: 12 }}>
          <summary
            style={{
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 700,
              color: "var(--color-neutral-900)",
            }}
          >
            🛠 개선 제안 {score.topImprovements.length}건
          </summary>
          <ul
            style={{
              margin: "8px 0 0",
              paddingLeft: 18,
              fontSize: 11.5,
              color: "var(--color-neutral-700)",
              lineHeight: 1.5,
            }}
          >
            {score.topImprovements.map((s, i) => (
              <li key={`im-${i}`} style={{ marginBottom: 4 }}>
                {s}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
