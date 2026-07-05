"use client"

/* ============================================================ */
/* 과일색 라인 일러스트 아이콘 (인라인 SVG)                       */
/*                                                              */
/* 이모지(❄️🔒🚚) 대신 손그림 느낌의 얇은 라인 SVG로 직접 그린다. */
/* - stroke = accent(과일 축색), strokeWidth 2.5, 둥근 캡/조인    */
/* - 순수 인라인 SVG라 html-to-image(toCanvas) 캡처와 100% 호환   */
/*   (외부 이미지·폰트 아이콘 없음 → JPG에 그대로 찍힌다).        */
/* - 24x24 viewBox, size prop으로 스케일. color prop을 직접 stroke */
/*   에 넣어 export(toCanvas) 시 구체 hex로 인라인 — CSS 변수 없음. */
/*                                                              */
/* ResultView·CheckoutTrustStrip 등 여러 블록이 공유하므로        */
/* 순환 import를 피하려 별도 모듈로 분리(신규 파일 1개).          */
/* ============================================================ */

export interface LineIconProps {
  /** stroke 색 — 보통 accent.accent. */
  color: string
  /** 렌더 픽셀 크기(정사각). 기본 24. */
  size?: number
}

/** 공통 SVG 래퍼 — viewBox·stroke 스타일 통일(손그림 라인). */
function IconFrame({ color, size = 24, children }: LineIconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

/** 수확 — 과일 상자(위가 열린 바구니 + 과일 2알). */
export function HarvestIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      {/* 바구니 몸통 (사다리꼴) */}
      <path d="M4.5 11.5 L6 20 h12 l1.5 -8.5" />
      {/* 바구니 테두리 */}
      <path d="M3 11.5 h18" />
      {/* 과일 두 알 (바구니 위로 봉긋) */}
      <path d="M9 11.5 a2.6 2.6 0 0 1 5.2 0" />
      <path d="M13 11.5 a2.2 2.2 0 0 1 4.4 0" />
      {/* 잎사귀 */}
      <path d="M11.6 6.4 q1.8 -2.2 3.4 -0.6" />
    </IconFrame>
  )
}

/** 선별 — 돋보기 + 안쪽 과일 한 알(꼼꼼히 고르는 느낌). */
export function SortIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      {/* 돋보기 렌즈 */}
      <circle cx="10.5" cy="10.5" r="6.5" />
      {/* 손잡이 */}
      <path d="M15.5 15.5 L21 21" />
      {/* 렌즈 안 과일 한 알 + 꼭지 */}
      <path d="M8 11 a2.4 2.4 0 0 0 4.8 0 a2.4 2.4 0 0 0 -4.8 0" />
      <path d="M10.4 8.6 q0.4 -1 1.3 -0.7" />
    </IconFrame>
  )
}

/** 포장 — 상자 + 체크(안전하게 담아 봉인). */
export function PackIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      {/* 박스 외곽 */}
      <path d="M4 8 L12 4 L20 8 L20 17 L12 21 L4 17 Z" />
      {/* 뚜껑 접힘선 */}
      <path d="M4 8 L12 12 L20 8" />
      <path d="M12 12 L12 21" />
      {/* 체크 마크 (박스 윗면) */}
      <path d="M9 8 L11 9.4 L15 6.3" />
    </IconFrame>
  )
}

/** 배송 — 트럭(캡 + 짐칸 + 바퀴 2개). */
export function DeliverIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      {/* 짐칸 */}
      <path d="M2 7 h10 v8 h-10 Z" />
      {/* 운전실 */}
      <path d="M12 10 h4 l3 3 v2 h-7 Z" />
      {/* 바퀴 */}
      <circle cx="7" cy="17.5" r="1.8" />
      <circle cx="16" cy="17.5" r="1.8" />
      {/* 아랫변 (바퀴 사이) */}
      <path d="M8.8 17.5 h5.4 M2 15 h1.4 M18.2 17.5 H19" />
    </IconFrame>
  )
}

/** 저온 배송 — 눈송이(CheckoutTrustStrip ❄️ 대체). */
export function ColdIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3 V21 M4.2 7.5 L19.8 16.5 M19.8 7.5 L4.2 16.5" />
      {/* 가지 팁 */}
      <path d="M12 3 l-2 2 M12 3 l2 2 M12 21 l-2 -2 M12 21 l2 -2" />
      <path d="M4.2 7.5 l0.4 2.7 M4.2 7.5 l2.7 -0.3 M19.8 16.5 l-0.4 -2.7 M19.8 16.5 l-2.7 0.3" />
    </IconFrame>
  )
}

/** 봉인 — 자물쇠(CheckoutTrustStrip 🔒 대체). */
export function SealIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M6 10.5 h12 v9 h-12 Z" />
      <path d="M8.5 10.5 V7.5 a3.5 3.5 0 0 1 7 0 V10.5" />
      <path d="M12 14 v2.5" />
    </IconFrame>
  )
}

/** 보증 — 방패+체크(CheckoutTrustStrip 🛡️ 대체). */
export function ShieldIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 3 L19 6 V11 c0 4.5 -3 7.5 -7 9.5 c-4 -2 -7 -5 -7 -9.5 V6 Z" />
      <path d="M8.8 11.5 L11 13.6 L15.4 8.8" />
    </IconFrame>
  )
}

/** 당도(Brix) — 물방울(과즙 한 방울). */
export function BrixIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      {/* 물방울 외곽 (위 뾰족, 아래 둥근) */}
      <path d="M12 3.5 C12 3.5 5.5 11 5.5 15 a6.5 6.5 0 0 0 13 0 C18.5 11 12 3.5 12 3.5 Z" />
      {/* 안쪽 하이라이트 (반짝임) */}
      <path d="M9.5 15.5 a2.5 2.5 0 0 0 2 2.3" />
    </IconFrame>
  )
}

/** 산지 — 지도 핀(원산지 위치). */
export function MapPinIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      {/* 핀 외곽 (물방울형 + 아래 꼭지) */}
      <path d="M12 21 C12 21 5 14.5 5 9.5 a7 7 0 0 1 14 0 C19 14.5 12 21 12 21 Z" />
      {/* 핀 중앙 원 */}
      <circle cx="12" cy="9.5" r="2.4" />
    </IconFrame>
  )
}

/** 중량 — 양팔 저울(무게 표기). */
export function ScaleIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      {/* 기둥 + 팔 */}
      <path d="M12 4 V19 M5 7 H19 M12 5.4 a1.1 1.1 0 1 0 0 2.2 a1.1 1.1 0 0 0 0 -2.2" />
      {/* 받침대 */}
      <path d="M8.5 19 H15.5" />
      {/* 왼쪽 접시 (줄 + 그릇) */}
      <path d="M5 7 L2.8 12 h4.4 Z" />
      {/* 오른쪽 접시 */}
      <path d="M19 7 L16.8 12 h4.4 Z" />
    </IconFrame>
  )
}

/** 품종 — 잎사귀(품종/신선). */
export function LeafIcon(props: LineIconProps) {
  return (
    <IconFrame {...props}>
      {/* 잎 외곽 */}
      <path d="M5 19 C5 11 11 5 19 5 C19 13 13 19 5 19 Z" />
      {/* 잎맥 */}
      <path d="M5 19 C9 15 13 11 17 7" />
    </IconFrame>
  )
}

/**
 * DeliveryFlow 4단계 스텝 아이콘 매핑 (순서 고정).
 * 0 수확 · 1 선별/포장 · 2 출고 · 3 도착.
 */
export const FLOW_STEP_ICONS = [HarvestIcon, SortIcon, PackIcon, DeliverIcon] as const
