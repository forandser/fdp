/**
 * 한국 신선식품 셀러가 자주 강조하는 핵심 키워드.
 *
 * 셀러가 선택한 키워드는 Claude 프롬프트에 의무 반영(룰북 6.4, project_features_v1).
 * 자유 추가도 가능.
 */

export interface PresetKeyword {
  id: string
  label: string
}

export const PRESET_KEYWORDS: PresetKeyword[] = [
  { id: "high-brix", label: "당도선별" },
  { id: "direct-from-farm", label: "산지직송" },
  { id: "eco-friendly", label: "친환경" },
  { id: "pesticide-free", label: "무농약" },
  { id: "self-grown", label: "직접재배" },
  { id: "fresh-harvest", label: "햇과일" },
  { id: "premium", label: "프리미엄" },
  { id: "limited", label: "한정수량" },
  { id: "gift-pack", label: "선물용" },
  { id: "morning-pick", label: "아침수확" },
]
