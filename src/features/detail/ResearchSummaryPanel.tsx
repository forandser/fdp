/**
 * v3.5: AI 리서치 요약 패널 (접이식).
 *
 * 결과 화면 사이드바(아트보드/captureRef 밖)에만 렌더 — JPG/아트보드에 절대 포함 금지.
 * 리서치 미사용/실패 시(research == null) 아무것도 렌더하지 않는다.
 *
 * 표시 내용: 품종 일반 특성·제철·보관법·소비자 관심 포인트·FAQ 씨앗 + 출처 링크.
 * 이 정보는 "품종 일반 참고 정보"이지 이 상품의 고유 사실이 아님을 한 줄로 명시한다.
 */

"use client"

import type { ResearchResult } from "@/lib/ai/types"

const INK = "#212529"
const SUB = "#495057"
const MUTE = "#868E96"
const LINE = "#E9ECEF"

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginBottom: 4 }}>
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, color: INK, fontSize: 12, lineHeight: 1.6 }}>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  )
}

function Line({ title, text }: { title: string; text: string }) {
  if (!text.trim()) return null
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ color: INK, fontSize: 12, lineHeight: 1.6 }}>{text}</div>
    </div>
  )
}

export function ResearchSummaryPanel({ research }: { research?: ResearchResult }) {
  if (!research) return null

  const {
    varietyNotes,
    seasonInfo,
    storageTips,
    consumerInterests,
    faqSeeds,
    sources,
  } = research

  return (
    <details
      className="fdp-no-print"
      style={{
        border: `1px solid ${LINE}`,
        borderRadius: 10,
        padding: "10px 12px",
        background: "#fff",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 700,
          color: INK,
          userSelect: "none",
          listStyle: "none",
        }}
      >
        🔍 AI 리서치 요약 {sources.length > 0 ? `· 출처 ${sources.length}` : ""}
      </summary>

      <div style={{ marginTop: 8 }}>
        <div
          style={{
            fontSize: 11,
            color: MUTE,
            lineHeight: 1.5,
            padding: "6px 8px",
            background: "#F8F9FA",
            borderRadius: 6,
          }}
        >
          품종 일반 참고 정보예요 — 이 상품의 고유 사실(산지·당도·중량)이 아닙니다.
          카피의 산지·수치는 입력하신 값만 사용했어요.
        </div>

        <Section title="품종 일반 특성" items={varietyNotes} />
        <Line title="제철·수확기" text={seasonInfo} />
        <Line title="보관법" text={storageTips} />
        <Section title="소비자 관심 포인트" items={consumerInterests} />
        <Section title="자주 묻는 질문" items={faqSeeds} />

        {sources.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: SUB, marginBottom: 4 }}>
              출처
            </div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, lineHeight: 1.7 }}>
              {sources.map((s, i) => (
                <li key={i}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#1971C2", wordBreak: "break-all" }}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}
