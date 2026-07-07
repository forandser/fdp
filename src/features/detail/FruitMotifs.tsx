"use client"

/* ============================================================ */
/* v4.9-A 미니 과일 모티프 SVG 라이브러리 (인라인 SVG)            */
/*                                                              */
/* 사용자 요청: "사과 이모지, 참외 이모지 이런 걸 활용하는       */
/* 경우도 있잖아" → 아트보드(JPG)엔 이모지 금지라, 코드로 그린   */
/* 손그림 라인 SVG 모티프로 구현한다.                            */
/*                                                              */
/* - LineIcons.tsx 의 검증된 패턴을 그대로 답습:                */
/*   viewBox 0 0 24 24, stroke=color, 둥근 캡/조인, 단색.        */
/*   strokeWidth 는 아이콘(2.5)보다 살짝 얇은 2.2 — 초소형 장식  */
/*   모티프라 라인이 뭉치지 않게.                                */
/* - 순수 인라인 SVG + hex/rgba(=color prop) 만 사용 →          */
/*   html-to-image(toCanvas) 캡처와 100% 호환(JPG에 그대로 찍힘). */
/*   CSS filter/이모지/CSS 변수/외부 URL 없음.                   */
/* - size prop 으로 스케일, opacity prop 으로 은은한 배경 흩뿌림  */
/*   (soft 레이아웃 히어로) 지원.                                */
/*                                                              */
/* [교차 계약] fruit-facts.ts 의 getVisualDNA().motif 값이       */
/* 이 파일의 kind 키(apple/pear/…)와 매칭된다. kind 미지원 시    */
/* null 을 반환해 항상 안전(게이팅 실패해도 빈 렌더).            */
/* ============================================================ */

export interface FruitMotifProps {
  /** 모티프 키 — getVisualDNA().motif 값. 미지원 키면 null 반환(안전). */
  kind: string
  /** 렌더 픽셀 크기(정사각). */
  size: number
  /** stroke 색 — 보통 accent.accent. export 시 구체 hex/rgba 로 인라인. */
  color: string
  /** 은은한 배경 흩뿌림용 투명도(0~1). 미지정 시 1(불투명). */
  opacity?: number
}

/** 지원하는 모티프 키 목록 (getVisualDNA().motif 가 이 중 하나를 반환). */
export const FRUIT_MOTIF_KINDS = [
  "apple",
  "pear",
  "peach",
  "strawberry",
  "chamoe",
  "watermelon",
  "citrus",
  "grape",
  "persimmon",
  "blueberry",
  "plum",
  "kiwi",
  "tomato",
  "fruit",
  "veggie",
] as const

export type FruitMotifKind = (typeof FRUIT_MOTIF_KINDS)[number]

/**
 * kind 별 SVG 내부 요소(모두 viewBox 0 0 24 24 기준).
 * stroke 는 프레임에서 상속(color) — 여기선 좌표만 정의한다.
 * 각 실루엣이 초소형에서도 즉시 구분되도록 특징을 한두 개씩 박아 둔다.
 */
const MOTIF_SHAPES: Record<FruitMotifKind, React.ReactNode> = {
  // 사과 — 두 로브가 위에서 오목하게 만나는 실루엣 + 꼭지 + 잎.
  apple: (
    <>
      <path d="M12 8 C10.5 6.6 7.6 6.6 6.1 8.8 C4.4 11.3 5.1 15.4 7.5 18.3 C9 20 10.8 20.2 12 19.4 C13.2 20.2 15 20 16.5 18.3 C18.9 15.4 19.6 11.3 17.9 8.8 C16.4 6.6 13.5 6.6 12 8 Z" />
      <path d="M12 8 L12 4.6" />
      <path d="M12 5.6 C13.5 3.7 15.9 3.7 16.7 5 C15.4 6.7 13.2 6.9 12 5.6 Z" />
    </>
  ),
  // 배 — 좁은 어깨에서 둥근 아래로 벌어지는 서양배 실루엣 + 잎.
  pear: (
    <>
      <path d="M12 4.6 C11.2 6.1 11.8 7.6 11 8.8 C9.6 10.7 8 12.4 8 15.2 C8 18.6 9.8 20.5 12 20.5 C14.2 20.5 16 18.6 16 15.2 C16 12.4 14.4 10.7 13 8.8 C12.2 7.6 12.8 6.1 12 4.6 Z" />
      <path d="M12 6.4 C13.4 5 15.5 5.2 16.1 6.3 C14.9 7.5 12.9 7.5 12 6.4 Z" />
    </>
  ),
  // 복숭아 — 둥근 몸통 + 가운데 세로 골 + 한쪽 잎.
  peach: (
    <>
      <path d="M12 7.6 C8.5 7.6 6 10.4 6 14 C6 17.7 8.7 20.5 12 20.5 C15.3 20.5 18 17.7 18 14 C18 10.4 15.5 7.6 12 7.6 Z" />
      <path d="M12 8.3 C10.7 12 10.7 16.4 12 20" />
      <path d="M12 8 C13.4 5.7 15.9 5.5 16.9 6.7 C15.7 8.8 13.2 9 12 8 Z" />
    </>
  ),
  // 딸기 — 위 넓고 아래 뾰족 + 톱니 왕관(꼭지) + 씨 점 3개.
  strawberry: (
    <>
      <path d="M12 20.6 C8.5 18 6.4 14 6.4 11.4 C9 9.9 15 9.9 17.6 11.4 C17.6 14 15.5 18 12 20.6 Z" />
      <path d="M7 11 L9 7.6 L11 10 L12 6.9 L13 10 L15 7.6 L17 11" />
      <path d="M10 13.3 L10.2 13.7" />
      <path d="M13.5 13.6 L13.7 14" />
      <path d="M11.7 16 L11.9 16.4" />
    </>
  ),
  // 참외 — 세로로 길쭉한 타원 + 세로 골 3줄(참외 특징).
  chamoe: (
    <>
      <path d="M12 4.5 C8.4 4.5 6.3 8.4 6.3 12.5 C6.3 16.6 8.4 20 12 20 C15.6 20 17.7 16.6 17.7 12.5 C17.7 8.4 15.6 4.5 12 4.5 Z" />
      <path d="M9.2 5.6 C8.3 10 8.3 15 9.2 18.9" />
      <path d="M12 4.6 L12 19.9" />
      <path d="M14.8 5.6 C15.7 10 15.7 15 14.8 18.9" />
    </>
  ),
  // 수박 — 아래로 뾰족한 삼각 슬라이스 + 껍질 라인 + 씨 점.
  watermelon: (
    <>
      <path d="M4.6 7.6 C9 10 15 10 19.4 7.6 L12 21 Z" />
      <path d="M6.7 8.7 C9.5 10.3 14.5 10.3 17.3 8.7" />
      <path d="M10.6 12 L10.8 12.5" />
      <path d="M13 13.3 L13.2 13.8" />
      <path d="M11.4 15.6 L11.6 16.1" />
    </>
  ),
  // 감귤류 — 둥근 몸통 + 잎 + 속 조각 라인 3줄(방사형).
  citrus: (
    <>
      <path d="M12 6.3 C7.7 6.3 5 9.6 5 13.5 C5 17.4 8 20 12 20 C16 20 19 17.4 19 13.5 C19 9.6 16.3 6.3 12 6.3 Z" />
      <path d="M12 6.5 C13.6 4.7 16 4.9 16.8 6.1 C15.4 7.9 13 7.9 12 6.5 Z" />
      <path d="M12 13.5 L12 7.2" />
      <path d="M12 13.5 L16.2 9.6" />
      <path d="M12 13.5 L7.8 9.6" />
    </>
  ),
  // 포도 — 역삼각 송이(알 6개) + 꼭지 + 잎.
  grape: (
    <>
      <path d="M12 9.2 L12 6.6" />
      <path d="M12 6.9 C13.6 5.1 16 5.3 16.8 6.5 C15.4 8.3 13 8.3 12 6.9 Z" />
      <circle cx="8.6" cy="11.4" r="2" />
      <circle cx="12" cy="11.4" r="2" />
      <circle cx="15.4" cy="11.4" r="2" />
      <circle cx="10.3" cy="14.8" r="2" />
      <circle cx="13.7" cy="14.8" r="2" />
      <circle cx="12" cy="18.1" r="2" />
    </>
  ),
  // 감·곶감 — 납작한 몸통 + 4갈래 꼭지 + 세로 주름(곶감 힌트).
  persimmon: (
    <>
      <path d="M6 13.5 C6 10 8.7 8.5 12 8.5 C15.3 8.5 18 10 18 13.5 C18 17 15.3 19 12 19 C8.7 19 6 17 6 13.5 Z" />
      <path d="M12 8.5 L9.2 5.9" />
      <path d="M12 8.5 L14.8 5.9" />
      <path d="M12 8.5 L8.1 8.1" />
      <path d="M12 8.5 L15.9 8.1" />
      <path d="M12 6.2 L12 4.2" />
      <path d="M9.7 11.2 C9.2 14 9.4 16.4 10.1 18.2" />
      <path d="M14.3 11.2 C14.8 14 14.6 16.4 13.9 18.2" />
    </>
  ),
  // 블루베리 — 둥근 알 + 위쪽 5갈래 별 왕관(칼릭스).
  blueberry: (
    <>
      <circle cx="12" cy="13" r="6.5" />
      <path d="M12 9.2 L12 6.6" />
      <path d="M12 9.2 L14.3 7.8" />
      <path d="M12 9.2 L9.7 7.8" />
      <path d="M12 9.2 L13.6 11" />
      <path d="M12 9.2 L10.4 11" />
    </>
  ),
  // 자두 — 갸름한 타원 + 한쪽으로 치우친 세로 골 + 짧은 꼭지(잎 없음, 복숭아와 구분).
  plum: (
    <>
      <path d="M12 6.5 C8.6 6.5 6.5 9.6 6.5 13.3 C6.5 17 8.9 20 12 20 C15.1 20 17.5 17 17.5 13.3 C17.5 9.6 15.4 6.5 12 6.5 Z" />
      <path d="M11 6.8 C9.5 12 9.7 16 11.2 19.6" />
      <path d="M12.6 6.5 L13.2 4.3" />
    </>
  ),
  // 키위 — 단면(중심 점 + 씨앗 링). 과육 이중 원.
  kiwi: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1.3" />
      <path d="M12 5.4 L12 6.4" />
      <path d="M16.7 7.3 L16 8" />
      <path d="M18.6 12 L17.6 12" />
      <path d="M16.7 16.7 L16 16" />
      <path d="M12 18.6 L12 17.6" />
      <path d="M7.3 16.7 L8 16" />
      <path d="M5.4 12 L6.4 12" />
      <path d="M7.3 7.3 L8 8" />
    </>
  ),
  // 토마토 — 둥근 몸통(살짝 아래) + 5갈래 꼭지잎(감과 구분: 5갈래·둥근 몸통).
  tomato: (
    <>
      <circle cx="12" cy="14" r="7" />
      <path d="M12 7.8 L12 4.4" />
      <path d="M12 8 L8.6 6" />
      <path d="M12 8 L15.4 6" />
      <path d="M12 8 L9 9.5" />
      <path d="M12 8 L15 9.5" />
    </>
  ),
  // 제네릭 과일 — 무난한 둥근 과일 + 꼭지 + 잎.
  fruit: (
    <>
      <circle cx="12" cy="13.6" r="7" />
      <path d="M12 6.6 L13 4.1" />
      <path d="M13 4.5 C14.6 3.1 17 3.5 17.6 4.7 C16 6.2 13.8 5.9 13 4.5 Z" />
    </>
  ),
  // 제네릭 야채 — 떡잎 새싹(잎 2장 + 줄기).
  veggie: (
    <>
      <path d="M12 20.5 L12 11.5" />
      <path d="M12 13.5 C8.5 13.2 6.3 10.5 6 7.2 C9.6 7.4 12 9.8 12 13.5 Z" />
      <path d="M12 11.8 C15.5 11.5 17.7 8.8 18 5.5 C14.4 5.7 12 8.1 12 11.8 Z" />
    </>
  ),
}

function isSupportedKind(kind: string): kind is FruitMotifKind {
  return Object.prototype.hasOwnProperty.call(MOTIF_SHAPES, kind)
}

/**
 * 미니 과일 모티프 — kind 에 맞는 손그림 라인 SVG 1개.
 * kind 미지원이면 null 반환(안전) — 게이팅이 새어도 빈 렌더.
 */
export function FruitMotif({ kind, size, color, opacity }: FruitMotifProps): React.JSX.Element | null {
  if (!isSupportedKind(kind)) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block", flexShrink: 0, opacity: opacity ?? 1 }}
    >
      {MOTIF_SHAPES[kind]}
    </svg>
  )
}

/* ============================================================ */
/* v5.2-B 손그림 낙서 데코 SVG 세트 (인라인 SVG)                 */
/*                                                              */
/* [배경] 실물 디자이너 페이지는 사진·수치 주변에 손그림 낙서   */
/* (반짝·화살표·꽃잎·강조 동그라미)를 얹어 "사람 손맛"을 낸다.   */
/* FruitMotif 와 완전히 같은 가족: viewBox 0 0 24 24, 단색       */
/* stroke=color, 둥근 캡/조인, strokeWidth 2.2, fill 없음.       */
/* → html-to-image(toCanvas) 캡처 100% 호환(JPG 위생 준수):      */
/*   CSS filter/이모지/CSS 변수/외부 URL 없음, 좌표는 결정적.    */
/*                                                              */
/* FruitMotif 과 다른 점은 rotate prop 하나 — 낙서는 사진 옆에  */
/* 비스듬히 얹히는 게 자연스러워, SVG transform rotate(deg) 로   */
/* 중심(12 12) 기준 회전을 지원한다. (미지정=회전 없음.)         */
/* ============================================================ */

/** 손그림 낙서 데코 종류 — 사진·수치 주변에 얹는 오버레이. */
export const MOTIF_DECOR_KINDS = ["sparkle", "arrow", "petal", "circle"] as const

export type MotifDecorKind = (typeof MOTIF_DECOR_KINDS)[number]

export interface MotifDecorProps {
  /** 데코 키 — 미지원 키면 null 반환(안전, FruitMotif 과 동일 정책). */
  kind: string
  /** 렌더 픽셀 크기(정사각). */
  size: number
  /** stroke 색 — export 시 구체 hex/rgba 로 인라인. */
  color: string
  /** 은은한 오버레이용 투명도(0~1). 미지정 시 1(불투명). */
  opacity?: number
  /** SVG transform rotate 각도(deg). 중심(12 12) 기준. 미지정 시 회전 없음. */
  rotate?: number
}

/**
 * kind 별 낙서 SVG 내부 요소(모두 viewBox 0 0 24 24 기준).
 * stroke 는 프레임에서 상속(color) — 여기선 좌표만 정의한다.
 */
const DECOR_SHAPES: Record<MotifDecorKind, React.ReactNode> = {
  // 반짝 — 오목한 변의 4각 별(큰) + 톡 튀는 작은 별 하나(트윙클).
  sparkle: (
    <>
      <path d="M12 3 Q12 12 21 12 Q12 12 12 21 Q12 12 3 12 Q12 12 12 3 Z" />
      <path d="M19.5 2.3 Q19.5 4.5 21.7 4.5 Q19.5 4.5 19.5 6.7 Q19.5 4.5 17.3 4.5 Q19.5 4.5 19.5 2.3 Z" />
    </>
  ),
  // 화살표 — 왼쪽에서 위로 솟았다 오른쪽 아래를 가리키는 곡선 샤프트 + 열린 촉.
  arrow: (
    <>
      <path d="M4.5 8 C8.5 4.5 14 4.8 18.5 9.5" />
      <path d="M14.2 8.25 L18.5 9.5 L17.4 5.15" />
    </>
  ),
  // 꽃잎/잎 — 대각선으로 흩날리는 잎 한 장(양쪽 활 + 가운데 잎맥).
  petal: (
    <>
      <path d="M7 18 C8 12 12 8 17 6 C15 11 11 15 7 18 Z" />
      <path d="M7 18 C10.5 13 13.5 9.5 17 6" />
    </>
  ),
  // 강조 동그라미 — 한 바퀴 돌고 시작점을 살짝 지나치는 열린(손그림) 원.
  circle: (
    <path d="M15 4.5 C20 5.5 21.5 11 20 15.5 C18.5 20 13 21.5 8 20 C3.5 18.5 2.5 12.5 4.5 8 C6.3 4 12 2.8 16.5 4.2" />
  ),
}

function isSupportedDecorKind(kind: string): kind is MotifDecorKind {
  return Object.prototype.hasOwnProperty.call(DECOR_SHAPES, kind)
}

/**
 * 손그림 낙서 데코 — kind 에 맞는 라인 SVG 1개(+회전).
 * kind 미지원이면 null 반환(안전) — 게이팅이 새어도 빈 렌더.
 */
export function MotifDecor({ kind, size, color, opacity, rotate }: MotifDecorProps): React.JSX.Element | null {
  if (!isSupportedDecorKind(kind)) return null
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ display: "block", flexShrink: 0, opacity: opacity ?? 1 }}
    >
      <g transform={rotate ? `rotate(${rotate} 12 12)` : undefined}>{DECOR_SHAPES[kind]}</g>
    </svg>
  )
}
