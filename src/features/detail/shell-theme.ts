/**
 * 앱 셸(폼·배너·버튼·칩) 전용 포인트 컬러·라운드 토큰 1벌. (UI감사 묶음 A / A1·A3)
 *
 * 아트보드/JPG 결과물 트리와 무관 — "도구 셸"의 시각 언어만 정의한다.
 * 기존 var(--color-*) 관례는 그대로 두고, 아트보드 팔레트에 없던 과일 코랄 포인트만
 * 여기 상수로 모아 폼/키워드/소구점/제철 컴포넌트에서 함께 재사용한다.
 *
 * 주의: primary 색을 바꾸면 globals.css 의 `.fdp-form ...:focus` 링 색(#F0654A)도
 * 함께 맞춰야 한다(인라인 스타일은 CSS :focus 를 못 걸어 한 곳에서 hex 를 미러링한다).
 */
export const SHELL_COLOR = {
  /** 주 액션 채움(생성·예시 채우기) — 아트보드 웜 팔레트에 맞춘 과일 코랄. */
  primary: "#F0654A",
  primaryHover: "#DA5138",
  onPrimary: "#FFFFFF",
  /** 선택 상태·선택 칩 채움용 연한 코랄 틴트(연한 배경톤). */
  tint: "#FDEEE9",
  tintBorder: "#F4B4A3",
  tintText: "#B23A22",
  /** 도움말/헬퍼 카드용 웜 앰버 틴트 — 경고(빨강)와 구분되는 부드러운 톤. */
  helperBg: "#FFF6EC",
  /** 상태 점(dot)/미니 필 — 성공 그린 / 경고 앰버 / 정보 뉴트럴. */
  success: "#01CF79",
  warn: "#F59F00",
  neutral: "#B5B7C0",
} as const

/** 라운드 3단 — 칩(999) / 컨트롤(8) / 카드(12). (A3) */
export const RADIUS = { chip: 999, control: 8, card: 12 } as const
