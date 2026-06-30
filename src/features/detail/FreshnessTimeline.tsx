"use client"

/**
 * 신선도 타임라인 — 수확일·오늘·권장섭취일 3점 가로 타임라인 (v1.8).
 *
 * Whole Foods 패턴: 빨강 미사용 (녹/노랑/오렌지만).
 * 식약처 텍스트 효능 표현을 우회하면서 신선도를 시각화.
 */

interface FreshnessTimelineProps {
  /** 수확일 (YYYY-MM-DD 또는 ISO). */
  harvestDate: string
  /** 권장 섭취 일수 (수확 후 며칠). */
  daysGood: number
}

export function FreshnessTimeline({ harvestDate, daysGood }: FreshnessTimelineProps) {
  const harvest = new Date(harvestDate)
  if (Number.isNaN(harvest.getTime())) return null

  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000
  const elapsed = Math.max(0, Math.floor((now.getTime() - harvest.getTime()) / dayMs))
  const remain = Math.max(0, daysGood - elapsed)
  const progress = Math.min(1, elapsed / daysGood)

  // 색상 단계 (빨강 미사용)
  let color = "#52C41A" // green
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
        padding: "16px 16px",
        background: "#FFFFFF",
        border: "1px solid #E9ECEF",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: color,
          }}
        />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#212529" }}>
          신선도 — {label}
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#868E96" }}>
          {elapsed}일 경과 / 권장 {daysGood}일
        </span>
      </div>
      <div
        style={{
          position: "relative",
          height: 6,
          background: "#F1F3F5",
          borderRadius: 3,
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
          marginTop: 8,
          fontSize: 11,
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
            margin: "10px 0 0",
            fontSize: 12,
            color: "#495057",
            lineHeight: 1.4,
          }}
        >
          ✓ 신선하게 드실 수 있는 기간이 약 <strong>{remain}일</strong> 남았어요.
        </p>
      )}
    </div>
  )
}
