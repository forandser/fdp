/**
 * v5.1: AI 자가 검수 리포트 패널.
 *
 * 결과 화면(아트보드/captureRef 밖)에만 렌더 — fdp-no-print 로 JPG/아트보드에 절대 포함 금지.
 * 검수 결과(result)가 있을 때만 부모가 렌더한다. 세션 상태로만 존재하며 Work 에 저장하지 않는다
 * (카피를 조치하면 낡는 정보). 닫기(onClose) 가능.
 *
 * 표시: 심각도 뱃지(높음/중간/낮음) + 구간(area) + 지적(message) + 제안(suggestion),
 *       상단에 전반 총평 한 줄(overall). ResearchSummaryPanel 의 톤·색을 답습한다.
 */

"use client"

import type { SelfReviewIssue, SelfReviewResult } from "@/lib/ai/types"

const INK = "#212529"
const SUB = "#495057"
const MUTE = "#868E96"
const LINE = "#E9ECEF"

type SeverityStyle = { label: string; fg: string; bg: string }

const SEVERITY: Record<SelfReviewIssue["severity"], SeverityStyle> = {
  high: { label: "높음", fg: "#E03131", bg: "#FFF0F0" },
  medium: { label: "중간", fg: "#E8890C", bg: "#FFF7E6" },
  low: { label: "낮음", fg: "#868E96", bg: "#F1F3F5" },
}

/** 심각도 정렬 우선순위(높음 먼저). */
const SEVERITY_ORDER: Record<SelfReviewIssue["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

function SeverityBadge({ severity }: { severity: SelfReviewIssue["severity"] }) {
  const s = SEVERITY[severity] ?? SEVERITY.low
  return (
    <span
      style={{
        flexShrink: 0,
        display: "inline-block",
        fontSize: 11,
        fontWeight: 700,
        color: s.fg,
        background: s.bg,
        borderRadius: 999,
        padding: "2px 9px",
        lineHeight: 1.5,
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  )
}

export function SelfReviewPanel({
  result,
  onClose,
}: {
  result: SelfReviewResult
  onClose: () => void
}) {
  const issues = Array.isArray(result.issues) ? result.issues : []
  const sorted = [...issues].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  )

  return (
    <div
      className="fdp-no-print"
      style={{
        border: `1px solid ${LINE}`,
        borderRadius: 10,
        padding: "12px 14px",
        background: "#fff",
        marginBottom: 12,
      }}
    >
      {/* 헤더: 제목 + 지적 개수 + 닫기 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: INK }}>
          🔍 AI 검수 리포트{issues.length > 0 ? ` · 지적 ${issues.length}` : ""}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="검수 리포트 닫기"
          style={{
            flexShrink: 0,
            background: "none",
            border: "none",
            color: MUTE,
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            padding: "2px 4px",
          }}
        >
          닫기 ✕
        </button>
      </div>

      {/* 전반 총평 */}
      {result.overall?.trim() && (
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            color: SUB,
            lineHeight: 1.6,
            padding: "8px 10px",
            background: "#F8F9FA",
            borderRadius: 6,
          }}
        >
          {result.overall.trim()}
        </div>
      )}

      {/* 지적 목록 (심각도순) */}
      {sorted.length > 0 ? (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
          {sorted.map((issue, i) => (
            <li
              key={i}
              style={{
                padding: "10px 0",
                borderTop: i === 0 ? "none" : `1px solid ${LINE}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <SeverityBadge severity={issue.severity} />
                {issue.area?.trim() && (
                  <span style={{ fontSize: 12, fontWeight: 700, color: INK }}>
                    {issue.area.trim()}
                  </span>
                )}
              </div>
              <div style={{ marginTop: 4, fontSize: 12.5, color: INK, lineHeight: 1.6 }}>
                {issue.message}
              </div>
              {issue.suggestion?.trim() && (
                <div style={{ marginTop: 3, fontSize: 12, color: SUB, lineHeight: 1.6 }}>
                  <span style={{ color: MUTE }}>제안 · </span>
                  {issue.suggestion.trim()}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div style={{ marginTop: 10, fontSize: 12, color: MUTE, lineHeight: 1.6 }}>
          특별히 지적할 점은 없었어요.
        </div>
      )}
    </div>
  )
}
