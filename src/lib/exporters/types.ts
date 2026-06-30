/**
 * 출력(내보내기) 어댑터 인터페이스.
 *
 * 셀러가 UI에서 선택한 옵션을 받아 JPG 한 장 또는 여러 장 생성.
 * 미래 출력 플랫폼(스마트스토어/자사몰) 추가 시 PlatformPreset에 한 줄 추가.
 */

export type ExportFormat = "single" | "auto-slice" | "manual-slice"
export type ExportMedia = "image" | "video"

export type PlatformId =
  | "coupang"
  | "smartstore"
  | "kurly"
  | "auction"
  | "self-shop"
  | "custom"

export interface PlatformPreset {
  id: PlatformId
  displayName: string
  recommendedWidth: number
  recommendedSliceHeight: number
  maxFileSizeMB: number
  notes: string
}

export const PLATFORM_PRESETS: Record<PlatformId, PlatformPreset> = {
  coupang: {
    id: "coupang",
    displayName: "쿠팡",
    recommendedWidth: 860,
    recommendedSliceHeight: 3000,
    maxFileSizeMB: 5,
    notes: "이미지 기반 상세페이지. HTML 제약. 권장 폭 860, 장당 ≤5MB.",
  },
  smartstore: {
    id: "smartstore",
    displayName: "스마트스토어",
    recommendedWidth: 740,
    recommendedSliceHeight: 3000,
    maxFileSizeMB: 5,
    notes: "권장 폭 740. HTML 일부 허용. 모바일 비중 높음.",
  },
  kurly: {
    id: "kurly",
    displayName: "마켓컬리",
    recommendedWidth: 1200,
    recommendedSliceHeight: 4000,
    maxFileSizeMB: 8,
    notes: "권장 폭 1200. 신선식품 특화 — 신뢰 요소 강조.",
  },
  auction: {
    id: "auction",
    displayName: "옥션/G마켓",
    recommendedWidth: 860,
    recommendedSliceHeight: 3000,
    maxFileSizeMB: 5,
    notes: "권장 폭 860.",
  },
  "self-shop": {
    id: "self-shop",
    displayName: "자사몰 / 카페24",
    recommendedWidth: 1000,
    recommendedSliceHeight: 5000,
    maxFileSizeMB: 10,
    notes: "HTML/CSS 자유도 높음.",
  },
  custom: {
    id: "custom",
    displayName: "자유",
    recommendedWidth: 860,
    recommendedSliceHeight: 3000,
    maxFileSizeMB: 5,
    notes: "셀러가 직접 입력.",
  },
}

export interface ExportOptions {
  /** 플랫폼 (없으면 custom) — 검수 반영: 확장 차원 3 (플랫폼) */
  platform?: PlatformId
  format: ExportFormat
  media?: ExportMedia
  /** 가로 폭 (px) */
  width: number
  /** 세로 분할 단위 (auto-slice 모드, px) */
  sliceHeight?: number
  /** 수동 분할 지점들 (manual-slice 모드, 누적 px) */
  manualBreaks?: number[]
  /** JPG 품질 0~1 */
  quality: number
  /** 픽셀 비율 (Retina) */
  pixelRatio: number
}

export interface ThumbnailOptions {
  /** 1:1 정사각 */
  square?: { size: number }
  /** 4:5 세로 */
  portrait?: { width: number; height: number }
  /** 자유 비율 */
  custom?: { width: number; height: number }
}

export interface ExportTarget {
  /** 파일명 접두사 (확장자/번호 제외) */
  baseName: string
  /** 저장 폴더 (선택, 없으면 다운로드 폴더) */
  directoryHandle?: FileSystemDirectoryHandle
}

export interface ExportedFile {
  fileName: string
  blob: Blob
  width: number
  height: number
}

export interface ExportResult {
  files: ExportedFile[]
  totalBytes: number
  warnings: string[]
}

export interface SceneSource {
  /** 캔버스 또는 react-konva Stage에서 픽셀 픽업 */
  toCanvas(opts: { width: number; pixelRatio: number }): Promise<HTMLCanvasElement>
}

export interface Exporter {
  exportDetail(
    scene: SceneSource,
    options: ExportOptions,
    target: ExportTarget,
  ): Promise<ExportResult>

  exportThumbnails(
    scene: SceneSource,
    options: ThumbnailOptions,
    target: ExportTarget,
  ): Promise<ExportResult>
}

/** iOS Safari 캔버스 면적 한계 = 16,777,216 픽셀. */
export const IOS_CANVAS_AREA_LIMIT = 16_777_216

/** 한 슬라이스가 iOS 한계 안에 있는지 검사. */
export function checkIosCanvasLimit(
  width: number,
  height: number,
  pixelRatio: number,
): { ok: boolean; actualArea: number; limit: number } {
  const actualArea = width * pixelRatio * (height * pixelRatio)
  return {
    ok: actualArea <= IOS_CANVAS_AREA_LIMIT,
    actualArea,
    limit: IOS_CANVAS_AREA_LIMIT,
  }
}

/** 플랫폼 ID로 ExportOptions 디폴트값 생성. */
export function defaultOptionsFor(platform: PlatformId): ExportOptions {
  const p = PLATFORM_PRESETS[platform]
  return {
    platform: p.id,
    format: "auto-slice",
    media: "image",
    width: p.recommendedWidth,
    sliceHeight: p.recommendedSliceHeight,
    quality: 0.92,
    pixelRatio: 2,
  }
}
