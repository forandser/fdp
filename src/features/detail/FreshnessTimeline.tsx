"use client"

/**
 * 신선도 타임라인 — 수확일·오늘·권장섭취일 3점 가로 타임라인 (v1.8).
 *
 * v5.9(작업D①): "신선" 상태색을 하드코딩 초록(#52C41A)에서 페이지 코랄 accent 로 단일화.
 * 페이지 전체가 코랄 시스템인데 이 위젯만 초록 점·막대여서 색 토큰 이탈이었음(아트디렉터 지적).
 * 경과·주의 단계의 앰버/오렌지는 "노화 경고"라는 의미색이라 그대로 둔다(초록 이탈만 제거).
 * 초록과일(샤인머스캣 등) 팔레트는 accent 자체가 녹색이라 자연스럽게 정당한 초록으로 렌더됨.
 */

interface FreshnessTimelineProps {
  /** 수확일 (YYYY-MM-DD 또는 ISO). */
  harvestDate: string
  /** 권장 섭취 일수 (수확 후 며칠). */
  daysGood: number
  /** v5.9(작업D①): "신선" 상태 점·진행바 색 = 페이지 accent 코랄(호출부에서 주입). */
  accentColor: string
}

export function FreshnessTimeline({ harvestDate, daysGood, accentColor }: FreshnessTimelineProps) {
  const harvest = new Date(harvestDate)
  if (Number.isNaN(harvest.getTime())) return null

  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000
  const elapsed = Math.max(0, Math.floor((now.getTime() - harvest.getTime()) / dayMs))
  const remain = Math.max(0, daysGood - elapsed)
  const progress = Math.min(1, elapsed / daysGood)

  // 색상 단계 — v5.9(작업D①): "신선"=코랄 accent, 노화 단계만 앰버/오렌지 경고색.
  let color = accentColor
  let label = "신선"
  if (elapsed > daysGood) {
    color = "#FA8C16"
    label = "권장 섭취 기한 경과"
  } else if (progress > 0.66) {
    color = "#FAAD14"
    label = "신선도 주의"
  } else if (progress > 0.33) {
    color = "#FAAD14"
    label = "신선"
  }

  const fmt = (d: Date) =>
    `${d.getMonth() + 1}월 ${d.getDate()}일`
  const dueDate = new Date(harvest.getTime() + daysGood * dayMs)

  return (
    <div
      style={{
        padding: "26px 26px",
        background: "#FFFFFF",
        border: "1px solid #E9ECEF",
        borderRadius: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 18,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: color,
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 24, fontWeight: 700, color: "#212529" }}>
          신선도 — {label}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 24, color: "#868E96" }}>
          {elapsed}일 경과 / 권장 {daysGood}일
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 10,
          background: "#F1F3F5",
          borderRadius: 5,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min(100, progress * 100)}%`,
            background: color,
            transition: "width 0.4s",
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 14,
          fontSize: 24,
          color: "#868E96",
        }}
      >
        <span>수확 {fmt(harvest)}</span>
        <span>오늘 {fmt(now)}</span>
        <span>권장 ~{fmt(dueDate)}</span>
      </div>
      {remain > 0 && (
        <p
          style={{
            margin: "16px 0 0",
            fontSize: 26,
            color: "#495057",
            lineHeight: 1.5,
          }}
        >
          ✓ 신선하게 드실 수 있는 기간이 약 <strong>{remain}일</strong> 남았어요.
        </p>
      )}
    </div>
  )
}
