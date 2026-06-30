/**
 * AI Provider — 공개 API.
 *
 * 모든 컴포넌트는 여기에서 가져온다. anthropic-adapter 직접 import 금지.
 */

import type { AIProvider } from "./types"
import { AnthropicAdapter } from "./anthropic-adapter"

let provider: AIProvider | null = null

export function getAIProvider(): AIProvider {
  if (!provider) {
    provider = new AnthropicAdapter()
  }
  return provider
}

export type { AIProvider, CopyInput, CopyOutput, CopyResult, DiagnosticResult, DiagnosticStatus, UsageInfo } from "./types"
