"use client"

/**
 * 식약처 디스클레이머 + 자동 검수 결과 (v1.8).
 *
 * 게시 책임은 셀러에게. 본 사이트는 자동 생성만 제공.
 * 식약처 §8 위반 가능성을 Tier별로 안내.
 */

import type { ReactNode } from "react"
import type { ComplianceReport } from "@/lib/ai/compliance-report"

interface DisclosureBlockProps {
  report?: ComplianceReport | null
  /** 검수 상세 페널 토글 — 모바일에서 details/summary로 접기 */
  defaultOpen?: boolean
  /**
   * B3(v5.7): 위반/불일치 항목 클릭 → 본문의 해당 필드로 점프(scrollIntoView + 플래시).
   * ResultView가 field(예: "story", "keyPoints[0].body")를 받아 data-field 요소를 찾는다.
   * 미지정 시 항목은 클릭 불가(정적 텍스트) 그대로.
   */
  onJumpToField?: (field: string) => void
}

export function DisclosureBlock({ report, defaultOpen, onJumpToField }: DisclosureBlockProps) {
  const hasViolations = report && report.violations.length > 0
  const originMismatches = report?.originMismatches ?? []
  const hasOriginMismatch = originMismatches.length > 0

  // v2.6: 위반 없으면 아무 것도 안 그림 (안내 문구 삭제 지시)
  if (!hasViolations && !hasOriginMismatch) return null

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
      {/* 산지 불일치(허위 표시 위험) — 최고 심각도. 접지 않고 항상 펼쳐 강조. */}
      {hasOriginMismatch && (
        <div
          style={{
            marginBottom: hasViolations ? 12 : 0,
            padding: "10px 12px",
            background: "#FFE3E3",
            border: "1px solid #C92A2A",
            borderRadius: 6,
          }}
        >
          <div
            style={{
              color: "#C92A2A",
              fontWeight: 800,
              marginBottom: 6,
            }}
          >
            🚨 산지 불일치 (허위 표시 위험) {originMismatches.length}건
          </div>
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#495057" }}>
            입력하신 산지에 없는 지역명이 카피에 들어갔어요. 원산지를 잘못 표기하면
            법적 위험이 있어요. 실제 산지가 맞는지 확인하고, 아니면 지워주세요.
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
            {originMismatches.slice(0, 8).map((m, i) => (
              <li key={`om-${i}`} style={{ marginBottom: 4 }}>
                <JumpRow field={m.field} onJump={onJumpToField}>
                  <strong style={{ color: "#C92A2A" }}>&ldquo;{m.region}&rdquo;</strong>
                  <span style={{ color: "#868E96" }}> ({m.field})</span>
                  <br />
                  <span style={{ color: "#868E96", fontSize: 11 }}>
                    입력 산지: {m.origin}
                  </span>
                </JumpRow>
              </li>
            ))}
          </ul>
          {originMismatches.length > 8 && (
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "#868E96" }}>
              ... 외 {originMismatches.length - 8}건
            </p>
          )}
        </div>
      )}
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
                  <JumpRow field={v.field} onJump={onJumpToField}>
                    <strong>[Tier{v.tier}]</strong> {v.matched} ({v.field})
                    <br />
                    <span style={{ color: "#868E96", fontSize: 11 }}>
                      {v.clause}
                    </span>
                  </JumpRow>
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

/**
 * B3(v5.7): 위반 항목 클릭 → 본문 점프 트리거.
 * onJump 없으면 정적 텍스트 그대로(감싸기만), 있으면 좌측정렬 텍스트 버튼으로 승격.
 * 이 컴포넌트는 사이드바(캡처 밖)에만 렌더되므로 JPG 위생과 무관하다.
 */
function JumpRow({
  field,
  onJump,
  children,
}: {
  field: string
  onJump?: (field: string) => void
  children: ReactNode
}) {
  if (!onJump) return <>{children}</>
  return (
    <button
      type="button"
      onClick={() => onJump(field)}
      title="클릭하면 본문에서 이 위치로 이동해요"
      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        padding: 0,
        margin: 0,
        border: "none",
        background: "transparent",
        font: "inherit",
        color: "inherit",
        lineHeight: "inherit",
        cursor: "pointer",
      }}
    >
      {children}
      <span aria-hidden style={{ marginLeft: 4, opacity: 0.55, fontSize: 11 }}>
        ↷ 이동
      </span>
    </button>
  )
}
