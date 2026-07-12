"use client"

/**
 * 공식 인증 캡션 — GAP/유기/무농약 인증번호 + 생산자 + 산지 (v1.8).
 *
 * GAP 표시법 5요소 의무: 산지·품목·중량·생산연도·생산자.
 * Hero 직후 above-fold 위치에 노출 권장.
 */

// v6.1(작업E1): 인증 라벨(고정 상수 문구)도 인라인 편집 가능하게 OverrideText 재사용.
// ResultView 아트보드(EditContext.Provider) 안에서만 렌더되므로 컨텍스트가 항상 존재한다.
// OverrideText는 함수 선언(호이스팅)이라 ResultView↔CertCaption 순환 import에도 안전.
import { OverrideText } from "./ResultView"

interface CertCaptionProps {
  certType: "gap" | "organic" | "pesticide-free"
  certNumber: string
  producerName?: string
  producerRegion?: string
}

const CERT_META: Record<
  CertCaptionProps["certType"],
  { label: string; icon: string; color: string }
> = {
  "gap": {
    label: "농산물 우수관리(GAP) 인증",
    icon: "🌿",
    color: "#52C41A",
  },
  "organic": {
    label: "친환경·유기농 인증",
    icon: "🌱",
    color: "#1C7ED6",
  },
  "pesticide-free": {
    label: "무농약 인증",
    icon: "🍃",
    color: "#37B24D",
  },
}

export function CertCaption({
  certType,
  certNumber,
  producerName,
  producerRegion,
}: CertCaptionProps) {
  if (!certNumber.trim()) return null
  const meta = CERT_META[certType]
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 20px",
        background: "#FFFFFF",
        border: `3px solid ${meta.color}`,
        borderRadius: 10,
        fontSize: 24,
        fontWeight: 600,
        color: "#212529",
      }}
    >
      <span aria-hidden style={{ fontSize: 26 }}>
        {meta.icon}
      </span>
      <span style={{ color: meta.color, fontWeight: 800 }}>
        <OverrideText id={`cert.label.${certType}`} fallback={meta.label} maxLength={30} />
      </span>
      <span style={{ color: "#495057" }}>제{certNumber.trim()}호</span>
      {(producerName || producerRegion) && (
        <>
          <span style={{ color: "#ADB5BD" }}>·</span>
          <span style={{ color: "#495057" }}>
            {producerName && <>{producerName}</>}
            {producerName && producerRegion && " "}
            {producerRegion && <>({producerRegion})</>}
          </span>
        </>
      )}
    </div>
  )
}
