/**
 * Claude API 비용 추정.
 *
 * 모델별 가격표를 단일 위치에서 관리. 새 모델 추가 시 PRICING 표 한 줄.
 * 환율은 일단 1 USD = 1380 KRW 고정 (추후 외부 API 연동 또는 셀러가 설정).
 *
 * 참고 (2026년 기준):
 *  - Sonnet 4.6 : input $3 / output $15 per 1M tokens
 *  - Haiku 4.5  : input $0.8 / output $4 per 1M tokens (대략)
 *  - Opus 4.8   : input $15 / output $75 per 1M tokens (대략)
 */

import { MODEL_IDS, type ModelId } from "./types"

const USD_TO_KRW = 1380

interface ModelPricing {
  inputUsdPerMtok: number
  outputUsdPerMtok: number
}

export const PRICING: Record<ModelId, ModelPricing> = {
  [MODEL_IDS.SONNET]: { inputUsdPerMtok: 3, outputUsdPerMtok: 15 },
  [MODEL_IDS.HAIKU]: { inputUsdPerMtok: 0.8, outputUsdPerMtok: 4 },
  [MODEL_IDS.OPUS]: { inputUsdPerMtok: 15, outputUsdPerMtok: 75 },
}

export function estimateInputCostKRW(modelId: ModelId, tokens: number): number {
  const safeTokens = Math.max(0, Number.isFinite(tokens) ? tokens : 0)
  const price = PRICING[modelId]
  return (safeTokens / 1_000_000) * price.inputUsdPerMtok * USD_TO_KRW
}

export function estimateOutputCostKRW(modelId: ModelId, tokens: number): number {
  const safeTokens = Math.max(0, Number.isFinite(tokens) ? tokens : 0)
  const price = PRICING[modelId]
  return (safeTokens / 1_000_000) * price.outputUsdPerMtok * USD_TO_KRW
}

/**
 * 한국어 1자 ≈ 1.5 토큰 추정. 영어 1단어 ≈ 1.3 토큰.
 */
export function estimateTokensFromText(text: string): number {
  if (!text) return 0
  const koChars = (text.match(/[가-힣]/g) ?? []).length
  const enWords = text.replace(/[가-힣]/g, "").split(/\s+/).filter(Boolean).length
  return Math.ceil(koChars * 1.5 + enWords * 1.3)
}

export function formatKRW(amount: number): string {
  return `₩${Math.round(amount).toLocaleString("ko-KR")}`
}
