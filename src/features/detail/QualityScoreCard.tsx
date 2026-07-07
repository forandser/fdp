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

      {/* B3(v5.7): 최상위 개선 제안 1줄만 복원 — 전체 게이지(v2.6 삭제)는 되살리지 않는다.
          "무엇을 고치면 점수가 오르는지" 한 줄 힌트만 준다. */}
      {score.topImprovements.length > 0 && (
        <div
          style={{
            marginTop: 10,
            paddingTop: 10,
            borderTop: "1px solid var(--color-neutral-100)",
            fontSize: 12,
            color: "var(--color-neutral-600)",
            lineHeight: 1.5,
          }}
        >
          <span style={{ fontWeight: 700, color: "var(--color-neutral-700)" }}>
            개선 1순위 ·{" "}
          </span>
          {score.topImprovements[0]}
        </div>
      )}
    </div>
  )
}
