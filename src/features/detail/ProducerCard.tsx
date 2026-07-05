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
  /** F(minor): 과일 축색 — 아바타 배경·연차 강조에 사용. 미지정 시 중립 회색. */
  accentColor?: string
  /** accentColor의 아주 옅은 틴트 — 아바타 배경 그라디언트용. */
  accentSoft?: string
}

export function ProducerCard({
  name,
  region,
  years,
  photoUrl,
  oneLine,
  accentColor = "#495057",
  accentSoft = "#F1F3F5",
}: ProducerCardProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 24,
        padding: "26px 24px",
        background: "#FFFFFF",
        border: "1px solid #E9ECEF",
        borderRadius: 14,
      }}
    >
      <div
        style={{
          flexShrink: 0,
          width: 100,
          height: 100,
          borderRadius: "50%",
          overflow: "hidden",
          border: "4px solid #FFFFFF",
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          background: `linear-gradient(135deg, ${accentSoft} 0%, #FFFFFF 100%)`,
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
          <DefaultFarmerSvg color={accentColor} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 30,
            fontWeight: 800,
            color: "#212529",
            lineHeight: 1.3,
            marginBottom: 6,
          }}
        >
          {name} 농가
        </div>
        <div
          style={{
            fontSize: 24,
            color: "#495057",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          {region && <span>{region}</span>}
          {/* A2: 연차가 없거나 0이면 연차 표기 자체 생략 (0년차 렌더 방지). */}
          {region && years > 0 && <span style={{ color: "#ADB5BD" }}>·</span>}
          {years > 0 && (
            <span style={{ color: accentColor, fontWeight: 700 }}>{years}년차</span>
          )}
        </div>
        {oneLine && (
          <p
            style={{
              fontSize: 24,
              color: "#495057",
              lineHeight: 1.5,
              margin: "14px 0 0",
            }}
          >
            “{oneLine}”
          </p>
        )}
      </div>
    </div>
  )
}

function DefaultFarmerSvg({ color = "#52C41A" }: { color?: string }) {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
        fill={color}
      />
    </svg>
  )
}
