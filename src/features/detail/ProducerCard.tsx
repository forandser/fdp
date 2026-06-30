"use client"

/**
 * 농부 카드 — 사진 + 이름 + 산지 + 연차 (v1.8).
 *
 * 신뢰 시각화의 핵심. farmStory 블록 안에 1~3장 그리드로 노출 권장.
 * 사진 없으면 디폴트 농부 SVG로 대체.
 */

interface ProducerCardProps {
  name: string
  region: string
  years: number
  photoUrl?: string
  /** 한 줄 소개 (선택). */
  oneLine?: string
}

export function ProducerCard({ name, region, years, photoUrl, oneLine }: ProducerCardProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "16px 14px",
        background: "#FFFFFF",
        border: "1px solid #E9ECEF",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 64,
          height: 64,
          borderRadius: "50%",
          overflow: "hidden",
          border: "3px solid #FFFFFF",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          background: "linear-gradient(135deg, #FFF8E7 0%, #E8F5E9 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photoUrl}
            alt={`${name} 사진`}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <DefaultFarmerSvg />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            color: "#212529",
            lineHeight: 1.3,
            marginBottom: 2,
          }}
        >
          {name} 농가
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#495057",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>{region}</span>
          <span style={{ color: "#ADB5BD" }}>·</span>
          <span style={{ color: "#E03131", fontWeight: 700 }}>{years}년차</span>
        </div>
        {oneLine && (
          <p
            style={{
              marginTop: 8,
              fontSize: 13,
              color: "#495057",
              lineHeight: 1.5,
              margin: "8px 0 0",
            }}
          >
            “{oneLine}”
          </p>
        )}
      </div>
    </div>
  )
}

function DefaultFarmerSvg() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
        fill="#52C41A"
      />
    </svg>
  )
}
