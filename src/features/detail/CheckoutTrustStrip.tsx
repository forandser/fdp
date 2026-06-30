"use client"

/**
 * 결제 인접 신뢰 줄 — 콜드체인/봉인/환불 조건 (v1.8).
 *
 * 헤드의 신뢰 칩과 중복이지만, 결제(JPG 다운로드) 인접 위치에 재노출.
 * Trustisto 가이드: 결제 인접 보안 배지 +5~15% 전환.
 */

interface CheckoutTrustStripProps {
  coldChain?: boolean
  sealed?: boolean
  refundCondition?: string
  sameDayShipping?: boolean
}

export function CheckoutTrustStrip({
  coldChain,
  sealed,
  refundCondition,
  sameDayShipping,
}: CheckoutTrustStripProps) {
  const items: { icon: string; label: string }[] = []
  if (coldChain) items.push({ icon: "❄️", label: "저온 봉인 배송" })
  if (sealed) items.push({ icon: "🔒", label: "봉인 포장" })
  if (sameDayShipping) items.push({ icon: "🚚", label: "당일 발송" })
  items.push({
    icon: "🛡️",
    label: refundCondition?.trim()
      ? refundCondition.trim()
      : "조건부 교환·환불",
  })

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        padding: "10px 14px",
        background: "#FFF8E7",
        border: "1px dashed #E03131",
        borderRadius: 10,
        margin: "16px 0",
      }}
    >
      {items.map((it, i) => (
        <span
          key={`cts-${i}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "5px 10px",
            background: "#FFFFFF",
            border: "1px solid #E9ECEF",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 600,
            color: "#212529",
          }}
        >
          <span aria-hidden>{it.icon}</span>
          {it.label}
        </span>
      ))}
    </div>
  )
}
