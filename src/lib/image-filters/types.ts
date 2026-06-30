/**
 * 이미지 보정 어댑터 인터페이스.
 *
 * v1: AI 자동 보정 (클라이언트 알고리즘) — applyAutoEnhance
 * v1 추가 Should: Claude vision 정밀 보정 — analyzeAndEnhance (별도 모듈)
 *
 * 호출부는 라이브러리 비종속. 내부 구현이 Konva 필터든 WebGL이든 Worker든 무관.
 */

export type EnhanceStrength = "weak" | "medium" | "strong"

export interface AutoEnhanceOptions {
  strength?: EnhanceStrength
  /** 보정 단계별 on/off (디버그용 또는 고급 셀러용) */
  enableWhiteBalance?: boolean
  enableContrast?: boolean
  enableSaturation?: boolean
  enableSharpness?: boolean
}

export interface ImageSource {
  width: number
  height: number
  toCanvas(): HTMLCanvasElement
}

/**
 * AI 자동 보정 결과.
 * - blob: 보정된 JPG/PNG blob
 * - canvas: 보정된 캔버스 (에디터 미리보기용)
 */
export interface EnhanceResult {
  canvas: HTMLCanvasElement
  blob: Blob
}

export interface ImageEnhancer {
  applyAutoEnhance(
    source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
    options?: AutoEnhanceOptions,
  ): Promise<EnhanceResult>
}
