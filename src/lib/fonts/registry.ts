/**
 * 폰트 라이브러리 메타데이터.
 *
 * 상업적 무료 한/영 폰트. 셀러가 텍스트별로 선택.
 * 로딩: 메인은 Pretendard + Noto Sans KR 미리 로드, 나머지는 lazy FontFace.
 *
 * 검수 반영(2026-06-30): Toss Face 제거 (컬러 이모지 폰트 → 캔버스 메모리 폭발 + 이모지 금지 모순).
 * 빈 슬롯 1개 남음 — 추후 일반 본문/제목 폰트 1개 추가 예정.
 *
 * 라이선스: 각 폰트별 LICENSE 파일을 public/fonts/licenses/에 동봉.
 */

export type FontCategory = "body" | "heading" | "handwritten" | "display"

export interface FontWeightFile {
  weight: number
  url: string
}

export interface FontMeta {
  family: string
  displayName: string
  category: FontCategory
  license: string
  licenseFile: string
  preload: boolean
  weights: FontWeightFile[]
  description: string
}

export const FONTS: FontMeta[] = [
  {
    family: "Pretendard",
    displayName: "Pretendard (기본)",
    category: "body",
    license: "SIL OFL 1.1",
    licenseFile: "/fonts/licenses/Pretendard-OFL.txt",
    preload: true,
    weights: [
      { weight: 400, url: "/fonts/Pretendard-Regular.woff2" },
      { weight: 600, url: "/fonts/Pretendard-SemiBold.woff2" },
      { weight: 700, url: "/fonts/Pretendard-Bold.woff2" },
    ],
    description: "깔끔하고 모던한 본문 기본 폰트",
  },
  {
    family: "Noto Sans KR",
    displayName: "노토 산스 KR",
    category: "body",
    license: "SIL OFL 1.1",
    licenseFile: "/fonts/licenses/NotoSansKR-OFL.txt",
    preload: true,
    weights: [
      { weight: 400, url: "/fonts/NotoSansKR-Regular.woff2" },
      { weight: 700, url: "/fonts/NotoSansKR-Bold.woff2" },
    ],
    description: "안정적이고 표준적인 본문 대안",
  },
  {
    family: "Source Han Serif KR",
    displayName: "본명조",
    category: "heading",
    license: "SIL OFL 1.1",
    licenseFile: "/fonts/licenses/SourceHanSerif-OFL.txt",
    preload: false,
    weights: [
      { weight: 400, url: "/fonts/SourceHanSerifKR-Regular.woff2" },
      { weight: 700, url: "/fonts/SourceHanSerifKR-Bold.woff2" },
    ],
    description: "클래식한 분위기의 정중한 제목용",
  },
  {
    family: "Nanum Pen Script",
    displayName: "나눔손글씨 펜",
    category: "handwritten",
    license: "OFL",
    licenseFile: "/fonts/licenses/NanumPenScript-OFL.txt",
    preload: false,
    weights: [{ weight: 400, url: "/fonts/NanumPenScript-Regular.woff2" }],
    description: "감성·아날로그 손글씨 느낌",
  },
  {
    family: "BM Hanna Pro",
    displayName: "우아한형제들 한나",
    category: "display",
    license: "자유 사용 (배민)",
    licenseFile: "/fonts/licenses/BMHanna-LICENSE.txt",
    preload: false,
    weights: [{ weight: 400, url: "/fonts/BMHannaPro.woff2" }],
    description: "강한 임팩트의 헤드라인",
  },
  {
    family: "Cafe24 Danjunghae",
    displayName: "카페24 단정하게",
    category: "heading",
    license: "자유 사용 (카페24)",
    licenseFile: "/fonts/licenses/Cafe24-LICENSE.txt",
    preload: false,
    weights: [{ weight: 400, url: "/fonts/Cafe24Danjunghae.woff2" }],
    description: "정돈되고 차분한 제목용",
  },
  {
    family: "Yanolja Yache",
    displayName: "야놀자 야체",
    category: "display",
    license: "자유 사용 (야놀자)",
    licenseFile: "/fonts/licenses/Yanolja-LICENSE.txt",
    preload: false,
    weights: [{ weight: 400, url: "/fonts/YanoljaYache.woff2" }],
    description: "활기·캠페인용 강조",
  },
]

export function findFont(family: string): FontMeta | undefined {
  return FONTS.find((f) => f.family === family)
}

export function listFontsByCategory(category: FontCategory): FontMeta[] {
  return FONTS.filter((f) => f.category === category)
}
