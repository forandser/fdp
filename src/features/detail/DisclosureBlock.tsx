"use client"

/**
 * 식약처 디스클레이머 + 자동 검수 결과 (v1.8).
 *
 * 게시 책임은 셀러에게. 본 사이트는 자동 생성만 제공.
 * 식약처 §8 위반 가능성을 Tier별로 안내.
 */

import type { ComplianceReport } from "@/lib/ai/compliance-report"

interface DisclosureBlockProps {
  report?: ComplianceReport | null
  /** 검수 상세 페널 토글 — 모바일에서 details/summary로 접기 */
  defaultOpen?: boolean
}

export function DisclosureBlock({ report, defaultOpen }: DisclosureBlockProps) {
  const hasViolations = report && report.violations.length > 0

  // v2.6: 위반 없으면 아무 것도 안 그림 (안내 문구 삭제 지시)
  if (!hasViolations) return null

  return (
    <div
      className="fdp-no-print"
      style={{
        padding: "12px 14px",
        background: "#FFF5F5",
        border: "1px solid #E03131",
        borderRadius: 8,
        marginBottom: 16,
        fontSize: 13,
        lineHeight: 1.6,
        color: "#495057",
      }}
    >
      {hasViolations && report && (
        <details open={defaultOpen} style={{ marginTop: 10 }}>
          <summary
            style={{
              cursor: "pointer",
              color: "#C92A2A",
              fontWeight: 700,
              padding: "4px 0",
            }}
          >
            ⚠️ 자동 검수에서 식약처 위반 의심 표현 {report.violations.length}건 발견
          </summary>
          <div
            style={{
              marginTop: 8,
              padding: "8px 10px",
              background: "#FFFFFF",
              borderRadius: 6,
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 12,
                fontSize: 12,
                color: "#495057",
                marginBottom: 6,
              }}
            >
              <span>Tier1: <strong>{report.tier1Count}</strong></span>
              <span>Tier2: <strong>{report.tier2Count}</strong></span>
              <span>Tier3: <strong>{report.tier3Count}</strong></span>
              <span>Tier5: <strong>{report.tier5Count}</strong></span>
            </div>
            <ul
              style={{
                margin: 0,
                paddingLeft: 18,
                fontSize: 12,
              }}
            >
              {report.violations.slice(0, 8).map((v, i) => (
                <li key={`v-${i}`} style={{ marginBottom: 4 }}>
                  <strong>[Tier{v.tier}]</strong> {v.matched} ({v.field})
                  <br />
                  <span style={{ color: "#868E96", fontSize: 11 }}>
                    {v.clause}
                  </span>
                </li>
              ))}
            </ul>
            {report.violations.length > 8 && (
              <p style={{ margin: "6px 0 0", fontSize: 11, color: "#868E96" }}>
                ... 외 {report.violations.length - 8}건
              </p>
            )}
          </div>
        </details>
      )}
    </div>
  )
}
