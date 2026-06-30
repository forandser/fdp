"use client"

/**
 * 공식 인증 캡션 — GAP/유기/무농약 인증번호 + 생산자 + 산지 (v1.8).
 *
 * GAP 표시법 5요소 의무: 산지·품목·중량·생산연도·생산자.
 * Hero 직후 above-fold 위치에 노출 권장.
 */

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
        gap: 8,
        padding: "8px 14px",
        background: "#FFFFFF",
        border: `2px solid ${meta.color}`,
        borderRadius: 8,
        fontSize: 12,
        fontWeight: 600,
        color: "#212529",
      }}
    >
      <span aria-hidden style={{ fontSize: 16 }}>
        {meta.icon}
      </span>
      <span style={{ color: meta.color, fontWeight: 800 }}>{meta.label}</span>
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
