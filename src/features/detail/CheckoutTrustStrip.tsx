"use client"

import type { ComponentType } from "react"
import {
  ColdIcon,
  SealIcon,
  DeliverIcon,
  ShieldIcon,
  type LineIconProps,
} from "./LineIcons"

/**
 * 결제 인접 신뢰 줄 — 콜드체인/봉인/환불 조건 (v1.8).
 *
 * 헤드의 신뢰 칩과 중복이지만, 결제(JPG 다운로드) 인접 위치에 재노출.
 * Trustisto 가이드: 결제 인접 보안 배지 +5~15% 전환.
 *
 * v3.2: 이모지(❄️🔒🚚🛡️)를 과일색 라인 SVG 아이콘으로 교체.
 * 이모지는 플랫폼별 렌더가 제각각이고 html-to-image 캡처에서 톤이 튀어
 * (컬러 이모지 vs 미니멀 라인 톤) DeliveryFlow·Packaging과 아이콘 언어를 통일.
 * accentColor는 ResultView가 과일 축색을 내려준다.
 */

interface CheckoutTrustStripProps {
  coldChain?: boolean
  sealed?: boolean
  refundCondition?: string
  sameDayShipping?: boolean
  /** 과일 축색 stroke 색. 미지정 시 브랜드 빨강. */
  accentColor?: string
}

export function CheckoutTrustStrip({
  coldChain,
  sealed,
  refundCondition,
  sameDayShipping,
  accentColor = "#E03131",
}: CheckoutTrustStripProps) {
  const items: { Icon: ComponentType<LineIconProps>; label: string }[] = []
  if (coldChain) items.push({ Icon: ColdIcon, label: "저온 봉인 배송" })
  if (sealed) items.push({ Icon: SealIcon, label: "봉인 포장" })
  if (sameDayShipping) items.push({ Icon: DeliverIcon, label: "당일 발송" })
  items.push({
    Icon: ShieldIcon,
    label: refundCondition?.trim()
      ? refundCondition.trim()
      : "조건부 교환·환불",
  })

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        gap: 12,
        padding: "18px 22px",
        // v3.0.1: 노랑 배경+빨강 dashed는 경고문처럼 읽혀 미니멀 톤과 충돌 → 중립 카드로
        background: "#F8F9FA",
        border: "1px solid #E9ECEF",
        borderRadius: 12,
        margin: "24px 0",
      }}
    >
      {items.map((it, i) => {
        const { Icon } = it
        return (
          <span
            key={`cts-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              padding: "9px 18px",
              background: "#FFFFFF",
              border: "1px solid #E9ECEF",
              borderRadius: 999,
              fontSize: 24,
              fontWeight: 600,
              color: "#212529",
            }}
          >
            <Icon color={accentColor} size={26} />
            {it.label}
          </span>
        )
      })}
    </div>
  )
}
