/**
 * Anthropic Claude API 어댑터.
 *
 * 컴포넌트는 lib/ai/provider.ts를 통해서만 사용. 이 파일을 직접 import 금지.
 * 미래 BFF/다른 프로바이더 전환 시 이 파일만 교체.
 *
 * 브라우저 직접 호출 — dangerouslyAllowBrowser: true 필수.
 * BYOK 케이스에 대해 Anthropic이 공식 지원하는 모드.
 */

import Anthropic from "@anthropic-ai/sdk"
import {
  DEFAULT_MODEL,
  type AIProvider,
  type CopyInput,
  type CopyResult,
  type DiagnosticResult,
  type DiagnosticStatus,
  type ModelId,
  type SuggestPointsInput,
  type SuggestPointsResult,
  type SuggestKeywordsResult,
} from "./types"
import { getKeySource } from "./key-source"
import { buildFruitCopyMessages, FRUIT_COPY_SYSTEM_PROMPT } from "./prompts/fruit-copy"
import {
  buildSuggestPointsMessages,
  SUGGEST_POINTS_SYSTEM_PROMPT,
} from "./prompts/suggest-points"
import {
  buildSuggestKeywordsMessages,
  SUGGEST_KEYWORDS_SYSTEM_PROMPT,
} from "./prompts/suggest-keywords"
import { estimateInputCostKRW, estimateOutputCostKRW } from "./pricing"
import { extractJson, validateCopyOutput } from "./validate"
import { t } from "@/lib/i18n"

const DIAGNOSTIC_MAX_TOKENS = 8
const COPY_BASE_MAX_TOKENS = 2000
const COPY_MAX_TOKENS_CAP = 4000
const SUGGEST_MAX_TOKENS = 800
const SUGGEST_KEYWORDS_MAX_TOKENS = 400

interface AnthropicErrorShape {
  status?: number
  message?: string
  error?: { type?: string; message?: string }
}

function classifyError(err: unknown): DiagnosticStatus {
  const e = err as AnthropicErrorShape
  const status = e?.status
  const errType = (e?.error?.type ?? "").toLowerCase()
  const errMsg = (e?.error?.message ?? "").toLowerCase()
  const topMsg = (e?.message ?? "").toLowerCase()
  const combined = `${errType} ${errMsg} ${topMsg}`

  if (status === 401) return "invalid_key"
  if (
    status === 403 ||
    combined.includes("unsupported_country_region_territory") ||
    combined.includes("country") ||
    combined.includes("region")
  ) {
    return "geo_blocked"
  }
  if (status === 429 || status === 529) return "rate_limited"
  if (
    combined.includes("network") ||
    combined.includes("fetch") ||
    combined.includes("connection") ||
    combined.includes("aborted")
  ) {
    return "network_error"
  }
  return "unknown_error"
}

function statusMessageKo(status: DiagnosticStatus): string {
  switch (status) {
    case "ok":
      return t.diagnostic.success
    case "invalid_key":
      return t.diagnostic.fail.invalid_key
    case "geo_blocked":
      return t.diagnostic.fail.geo_blocked
    case "rate_limited":
      return t.diagnostic.fail.rate_limited
    case "network_error":
      return t.diagnostic.fail.network_error
    case "unknown_error":
      return t.diagnostic.fail.unknown_error
  }
}

export class AnthropicAdapter implements AIProvider {
  private readonly modelId: ModelId = DEFAULT_MODEL

  private async createClient(): Promise<Anthropic> {
    const key = await getKeySource().getKey()
    if (!key) {
      throw new Error("API 키가 입력되지 않았습니다.")
    }
    return new Anthropic({
      apiKey: key,
      dangerouslyAllowBrowser: true,
    })
  }

  async diagnose(): Promise<DiagnosticResult> {
    try {
      const client = await this.createClient()
      const res = await client.messages.create({
        model: this.modelId,
        max_tokens: DIAGNOSTIC_MAX_TOKENS,
        messages: [{ role: "user", content: "ok" }],
      })
      const ok = Array.isArray(res.content) && res.content.length > 0
      return {
        status: "ok",
        reachable: true,
        modelAvailable: ok,
        message: statusMessageKo("ok"),
      }
    } catch (err) {
      const status = classifyError(err)
      return {
        status,
        reachable: status !== "network_error",
        modelAvailable: false,
        message: statusMessageKo(status),
      }
    }
  }

  async generateCopy(input: CopyInput): Promise<CopyResult> {
    const client = await this.createClient()
    const messages = buildFruitCopyMessages(input)

    // 입력 크기 기반 max_tokens 동적 결정 (잘림 방지 + 비용 가드)
    const inputCharCount = JSON.stringify(input).length
    const dynamicMaxTokens = Math.min(
      COPY_MAX_TOKENS_CAP,
      Math.max(COPY_BASE_MAX_TOKENS, Math.ceil(inputCharCount * 4)),
    )

    const res = await client.messages.create({
      model: this.modelId,
      system: FRUIT_COPY_SYSTEM_PROMPT,
      max_tokens: dynamicMaxTokens,
      messages,
    })

    const textBlock = res.content.find((c) => c.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("EMPTY_RESPONSE")
    }

    const parsed = extractJson(textBlock.text)
    const output = validateCopyOutput(parsed)

    const inputTokens = res.usage?.input_tokens ?? 0
    const outputTokens = res.usage?.output_tokens ?? 0
    const truncated = res.stop_reason === "max_tokens"
    const estimatedCostKRW =
      estimateInputCostKRW(this.modelId, inputTokens) +
      estimateOutputCostKRW(this.modelId, outputTokens)

    return {
      output,
      usage: {
        inputTokens,
        outputTokens,
        estimatedCostKRW: Number.isFinite(estimatedCostKRW) ? estimatedCostKRW : 0,
        truncated,
      },
      modelId: this.modelId,
    }
  }

  async suggestSellingPoints(
    input: SuggestPointsInput,
  ): Promise<SuggestPointsResult> {
    const client = await this.createClient()
    const messages = buildSuggestPointsMessages(input)

    const res = await client.messages.create({
      model: this.modelId,
      system: SUGGEST_POINTS_SYSTEM_PROMPT,
      max_tokens: SUGGEST_MAX_TOKENS,
      messages,
    })

    const textBlock = res.content.find((c) => c.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("EMPTY_RESPONSE")
    }
    const parsed = extractJson(textBlock.text) as unknown
    const points: string[] = []
    if (parsed && typeof parsed === "object" && "points" in parsed) {
      const raw = (parsed as { points: unknown }).points
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === "string") {
            const trimmed = item.trim()
            if (trimmed && !points.includes(trimmed)) {
              points.push(trimmed)
            }
          }
          if (points.length >= 10) break
        }
      }
    }

    const inputTokens = res.usage?.input_tokens ?? 0
    const outputTokens = res.usage?.output_tokens ?? 0
    const estimatedCostKRW =
      estimateInputCostKRW(this.modelId, inputTokens) +
      estimateOutputCostKRW(this.modelId, outputTokens)

    return {
      points,
      inputTokens,
      outputTokens,
      estimatedCostKRW: Number.isFinite(estimatedCostKRW) ? estimatedCostKRW : 0,
    }
  }

  async suggestKeywords(
    input: SuggestPointsInput,
  ): Promise<SuggestKeywordsResult> {
    const client = await this.createClient()
    const messages = buildSuggestKeywordsMessages(input)

    const res = await client.messages.create({
      model: this.modelId,
      system: SUGGEST_KEYWORDS_SYSTEM_PROMPT,
      max_tokens: SUGGEST_KEYWORDS_MAX_TOKENS,
      messages,
    })

    const textBlock = res.content.find((c) => c.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("EMPTY_RESPONSE")
    }
    const parsed = extractJson(textBlock.text) as unknown
    const keywords: string[] = []
    if (parsed && typeof parsed === "object" && "keywords" in parsed) {
      const raw = (parsed as { keywords: unknown }).keywords
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (typeof item === "string") {
            // # 해시태그 prefix 제거 + 공백 정리
            const trimmed = item.trim().replace(/^#+/, "").trim()
            // 2~10자 (한글/영문 모두 허용) + 중복 제거
            if (
              trimmed &&
              trimmed.length >= 2 &&
              trimmed.length <= 10 &&
              !keywords.includes(trimmed)
            ) {
              keywords.push(trimmed)
            }
          }
          if (keywords.length >= 8) break
        }
      }
    }

    const inputTokens = res.usage?.input_tokens ?? 0
    const outputTokens = res.usage?.output_tokens ?? 0
    const estimatedCostKRW =
      estimateInputCostKRW(this.modelId, inputTokens) +
      estimateOutputCostKRW(this.modelId, outputTokens)

    return {
      keywords,
      inputTokens,
      outputTokens,
      estimatedCostKRW: Number.isFinite(estimatedCostKRW) ? estimatedCostKRW : 0,
    }
  }
}
