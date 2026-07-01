"use client"

/**
 * 카피 품질 점수 카드 (v2.1 — 심플 모드).
 *
 * 첫 화면: 총점 + 등급 큰 배지 + 개선 제안 최상위 1개.
 * "상세 보기" details 안에 8 차원 게이지 + 개선 제안 3개 전체.
 */

import type { CopyQualityResult } from "@/lib/ai/copy-quality-score"

interface QualityScoreCardProps {
  score: CopyQualityResult
}

const GRADE_COLOR: Record<CopyQualityResult["grade"], { bg: string; fg: string; label: string }> = {
  A: { bg: "#52C41A", fg: "#FFFFFF", label: "훌륭해요" },
  B: { bg: "#1C7ED6", fg: "#FFFFFF", label: "괜찮아요" },
  C: { bg: "#FAAD14", fg: "#FFFFFF", label: "고쳐볼까요" },
  D: { bg: "#E03131", fg: "#FFFFFF", label: "더 잘 만들 수 있어요" },
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
      {/* 심플 헤더 — 총점 + 등급 큰 배지 + 텍스트 라벨 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: gradeColor.bg,
            color: gradeColor.fg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            boxShadow: `0 3px 10px ${gradeColor.bg}55`,
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 26, fontWeight: 900, lineHeight: 1 }}>{score.grade}</span>
          <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.9 }}>등급</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--color-neutral-500)",
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            카피 품질
          </div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: "var(--color-neutral-900)",
              lineHeight: 1.15,
            }}
          >
            {score.total}
            <span style={{ fontSize: 12, color: "var(--color-neutral-500)", fontWeight: 600 }}>
              {" "}
              / 100
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              color: gradeColor.bg,
              fontWeight: 700,
              marginTop: 2,
            }}
          >
            {gradeColor.label}
          </div>
        </div>
      </div>

      {/* 최상위 개선 제안 1개 — 항상 노출 */}
      {score.topImprovements[0] && score.total < 90 && (
        <p
          style={{
            margin: "10px 0 0",
            padding: "8px 10px",
            background: "var(--color-bg-subtle)",
            borderRadius: 6,
            fontSize: 11.5,
            color: "var(--color-neutral-700)",
            lineHeight: 1.5,
          }}
        >
          🛠 <strong>가장 개선하면 좋은 부분:</strong>
          <br />
          {score.topImprovements[0]}
        </p>
      )}

      {/* 상세 8 차원 — details로 접힘 */}
      <details style={{ marginTop: 10 }}>
        <summary
          style={{
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--color-neutral-700)",
            userSelect: "none",
          }}
        >
          🔍 차원별 점수 8개 보기
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
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
          {score.topImprovements.length > 1 && (
            <ul
              style={{
                margin: "8px 0 0",
                paddingLeft: 18,
                fontSize: 11,
                color: "var(--color-neutral-500)",
                lineHeight: 1.5,
              }}
            >
              {score.topImprovements.slice(1).map((s, i) => (
                <li key={`imp-${i}`} style={{ marginBottom: 3 }}>
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  )
}
