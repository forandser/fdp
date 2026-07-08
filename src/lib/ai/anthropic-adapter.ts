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
  type PhotoAnalysisItem,
  type PhotoAnalysisResult,
  type ResearchResult,
  type SelfReviewResult,
  type SuggestPointsInput,
  type SuggestPointsResult,
  type SuggestKeywordsResult,
} from "./types"
import { getKeySource } from "./key-source"
import { buildFruitCopyMessages, FRUIT_COPY_SYSTEM_PROMPT } from "./prompts/fruit-copy"
import {
  buildResearchMessages,
  researchSearchBudget,
  RESEARCH_SYSTEM_PROMPT,
  RESEARCH_MAX_TOKENS,
} from "./prompts/research"
import {
  buildRefineCopyMessages,
  REFINE_COPY_SYSTEM_PROMPT,
} from "./prompts/refine-copy"
import {
  buildSuggestPointsMessages,
  SUGGEST_POINTS_SYSTEM_PROMPT,
} from "./prompts/suggest-points"
import {
  buildSuggestKeywordsMessages,
  SUGGEST_KEYWORDS_SYSTEM_PROMPT,
} from "./prompts/suggest-keywords"
import {
  buildPhotoAnalysisMessages,
  PHOTO_ANALYSIS_SYSTEM_PROMPT,
  PHOTO_ANALYSIS_MAX_TOKENS,
} from "./prompts/photo-analysis"
import {
  buildSelfReviewMessages,
  SELF_REVIEW_SYSTEM_PROMPT,
  SELF_REVIEW_MAX_TOKENS,
} from "./prompts/self-review"
import {
  estimateInputCostKRW,
  estimateOutputCostKRW,
  estimateWebSearchCostKRW,
} from "./pricing"
import {
  extractJson,
  validateCopyOutput,
  validatePhotoAnalysis,
  validateResearchResult,
  validateSelfReview,
} from "./validate"
// v6.0(작업Q): 품질 보장 루프 — draft를 결정적 린터로 검사해 위반을 refine에 되먹인다.
// AI 호출 0회(비용 불변). refine 콜에 위반 목록을 합류시켜 자동 수정을 유도한다.
import { lintCopyOutput, type CopyLintFinding } from "./copy-lint"
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

/**
 * v5.4(작업3): API 에러를 원인 코드로 분류. 진단(diagnose)뿐 아니라 생성·재생성 실패
 * 경로에서도 원인별 한국어 안내를 띄우려고 export 한다. 순수 함수(어댑터 상태 무관).
 * 컴포넌트는 provider.ts를 통해서만 가져온다(어댑터 직접 import 금지 규칙 유지).
 */
export function classifyError(err: unknown): DiagnosticStatus {
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

  /**
   * v3.5: research 단계 (선택). web_search 도구를 켠 Messages 호출로
   * "품종 일반 참고 정보"를 조사한다. 실패(에러/타임아웃/파싱실패)는 절대
   * 생성 전체를 죽이지 않는다 — null 반환 + console.warn, 호출부가 2-step으로 폴백.
   *
   * @returns 리서치 결과 + web_search 호출 횟수 + 토큰. 실패 시 null.
   */
  private async runResearch(
    client: Anthropic,
    input: CopyInput,
  ): Promise<{
    research: ResearchResult
    inputTokens: number
    outputTokens: number
    webSearchRequests: number
  } | null> {
    try {
      // v6.0(작업R③): 미등재·저입력이면 검색 상한을 7로 상향(그 외 5). 프롬프트 문구와 max_uses가 같은 값을 쓰도록 단일 산출.
      const budget = researchSearchBudget(input)
      const res = await client.messages.create({
        model: this.modelId,
        system: RESEARCH_SYSTEM_PROMPT,
        max_tokens: RESEARCH_MAX_TOKENS,
        messages: buildResearchMessages(input, budget),
        // 무료 운영 원칙: 새 서버/서비스 없이 Anthropic 서버측 web_search만 사용.
        tools: [
          {
            type: "web_search_20250305",
            name: "web_search",
            max_uses: budget,
          },
        ],
      })

      // web_search 응답은 여러 text 블록으로 쪼개질 수 있어 최종 text를 이어붙인다.
      const text = res.content
        .filter((c): c is Extract<typeof c, { type: "text" }> => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim()
      if (!text) {
        console.warn("[generateCopy] research step: empty text, falling back to 2-step")
        return null
      }

      const research = validateResearchResult(extractJson(text))
      if (!research) {
        console.warn("[generateCopy] research step: no usable content, falling back to 2-step")
        return null
      }

      return {
        research,
        inputTokens: res.usage?.input_tokens ?? 0,
        outputTokens: res.usage?.output_tokens ?? 0,
        webSearchRequests: res.usage?.server_tool_use?.web_search_requests ?? 0,
      }
    } catch (err) {
      // 리서치 실패는 절대 치명적이지 않다 — 조용히 2-step 폴백.
      console.warn("[generateCopy] research step failed, falling back to 2-step:", err)
      return null
    }
  }

  /**
   * v3.5: research → draft → refine 3-step 카피 생성 (리서치 실패 시 draft→refine 2-step).
   * Step 0 (research, 선택): web_search로 품종 일반 참고 정보 조사. input.researchEnabled가
   *   false가 아니면 수행. 실패 시 조용히 폴백.
   * Step 1 (draft): fruit-copy 프롬프트로 초안 카피 생성 (research 결과를 참고 블록으로 주입).
   * Step 2 (refine): draft를 스마트스토어 판매 관점 rubric 5개로 자체 심사 → 리라이트.
   *
   * refine이 실패하면 draft를 그대로 반환 (양보). 비용은 research+draft+refine 합산.
   *
   * v6.0(작업R⑤): photoAnalysisPromise(선택) — 호출부에서 사진 분석과 병렬로 시작한 Promise를
   *   넘기면, research(느린 단계) 이후 draft 직전에 await 해서 "사진에 보이는 것" 요약을 draft에
   *   주입한다. 병렬성은 유지(분석은 research와 동시에 진행). 미전달·null·실패 시 주입 없음(회귀 0).
   */
  async generateCopy(
    input: CopyInput,
    photoAnalysisPromise?: Promise<PhotoAnalysisResult | null>,
  ): Promise<CopyResult> {
    const client = await this.createClient()

    const inputCharCount = JSON.stringify(input).length
    const dynamicMaxTokens = Math.min(
      COPY_MAX_TOKENS_CAP,
      Math.max(COPY_BASE_MAX_TOKENS, Math.ceil(inputCharCount * 4)),
    )

    // Step 0: research (선택) — researchEnabled가 명시적 false가 아니면 기본 수행(기본 ON).
    let research: ResearchResult | undefined
    let researchInputTokens = 0
    let researchOutputTokens = 0
    let webSearchRequests = 0
    if (input.researchEnabled !== false) {
      const r = await this.runResearch(client, input)
      if (r) {
        research = r.research
        researchInputTokens = r.inputTokens
        researchOutputTokens = r.outputTokens
        webSearchRequests = r.webSearchRequests
      }
    }

    // v6.0(작업R⑤): 사진 분석 요약을 draft 직전에 수확(병렬로 진행된 Promise를 여기서 await).
    // research가 느린 단계라 대개 이 시점엔 분석이 이미 끝나 있어 추가 지연이 거의 없다.
    // 실패·null·빈 결과면 photoItems undefined → 주입 없음(회귀 0).
    let photoItems: PhotoAnalysisItem[] | undefined
    if (photoAnalysisPromise) {
      try {
        const analysis = await photoAnalysisPromise
        if (analysis && analysis.items.length > 0) photoItems = analysis.items
      } catch (err) {
        console.warn("[generateCopy] photo analysis await failed, skipping photo context:", err)
      }
    }

    // Step 1: draft 생성 (research 있으면 참고 블록, 사진 분석 있으면 관찰 요약 주입)
    const draftRes = await client.messages.create({
      model: this.modelId,
      system: FRUIT_COPY_SYSTEM_PROMPT,
      max_tokens: dynamicMaxTokens,
      messages: buildFruitCopyMessages(input, research, photoItems),
    })

    const draftBlock = draftRes.content.find((c) => c.type === "text")
    if (!draftBlock || draftBlock.type !== "text") {
      throw new Error("EMPTY_RESPONSE")
    }
    const draftOutput = validateCopyOutput(extractJson(draftBlock.text))

    const draftInputTokens = draftRes.usage?.input_tokens ?? 0
    const draftOutputTokens = draftRes.usage?.output_tokens ?? 0
    const draftTruncated = draftRes.stop_reason === "max_tokens"

    // Step 2: refine — draft가 잘림 없이 완성됐을 때만 시도
    let finalOutput = draftOutput
    let refineInputTokens = 0
    let refineOutputTokens = 0

    // v6.0(작업Q): draft를 결정적 린터로 검사(AI 호출 0회) → 위반이 있으면 refine에 되먹여
    // "이 필드의 이 위반을 고쳐라"를 명시 지시한다. 린터 예외는 삼켜 refine을 막지 않는다(회귀 0).
    let draftFindings: CopyLintFinding[] = []
    try {
      draftFindings = lintCopyOutput(draftOutput, input)
    } catch (lintErr) {
      console.warn("[generateCopy] draft lint failed, skipping lint feedback:", lintErr)
    }

    if (!draftTruncated) {
      try {
        const refineRes = await client.messages.create({
          model: this.modelId,
          system: REFINE_COPY_SYSTEM_PROMPT,
          max_tokens: dynamicMaxTokens,
          // 린터 위반 목록을 refine 콜에 합류 — 별도 AI 호출 없이(비용 불변) 자동 수정 유도.
          messages: buildRefineCopyMessages(input, draftOutput, draftFindings),
        })
        const refineBlock = refineRes.content.find((c) => c.type === "text")
        if (refineBlock && refineBlock.type === "text") {
          const refinedParsed = extractJson(refineBlock.text)
          const refined = validateCopyOutput(refinedParsed)
          // 헤드라인 후보 패스스루: refine이 headlineCandidates를 빠뜨려도
          // draft의 후보를 보존해 셀러의 선택지를 잃지 않는다.
          if (!refined.headlineCandidates?.length && draftOutput.headlineCandidates?.length) {
            refined.headlineCandidates = draftOutput.headlineCandidates
          }
          // v6.0(작업C): 구성 힌트 패스스루 — refine 프롬프트는 힌트를 모르므로 대개 드롭한다.
          // draft가 리서치·사진 근거로 낸 힌트를 보존해 생성 시점 변주(결정성)를 잃지 않는다.
          if (!refined.compositionHints && draftOutput.compositionHints) {
            refined.compositionHints = draftOutput.compositionHints
          }
          finalOutput = refined
          refineInputTokens = refineRes.usage?.input_tokens ?? 0
          refineOutputTokens = refineRes.usage?.output_tokens ?? 0
        }
      } catch (err) {
        // refine 실패는 치명적이지 않다 — draft로 fallback.
        console.warn("[generateCopy] refine step failed, using draft:", err)
      }
    }

    const totalInputTokens = researchInputTokens + draftInputTokens + refineInputTokens
    const totalOutputTokens = researchOutputTokens + draftOutputTokens + refineOutputTokens
    const estimatedCostKRW =
      estimateInputCostKRW(this.modelId, totalInputTokens) +
      estimateOutputCostKRW(this.modelId, totalOutputTokens) +
      estimateWebSearchCostKRW(webSearchRequests)

    // 리서치 요약을 output에 실어 결과 화면(아트보드 밖) 접이식 패널에 전달·저장.
    // 아트보드/JPG에는 절대 포함하지 않는다 (ResultView가 사이드바에만 렌더).
    const output = research ? { ...finalOutput, research } : finalOutput

    return {
      output,
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        estimatedCostKRW: Number.isFinite(estimatedCostKRW) ? estimatedCostKRW : 0,
        truncated: draftTruncated,
        webSearchRequests,
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

  /**
   * v4.4: 업로드 사진 vision 분석 (1콜) — 사진별 역할·품질·"보이는 것" 메모.
   * 히어로 선정·섹션 매칭·갤러리 순서·사실 기반 캡션의 재료로만 쓰인다.
   *
   * **어떤 실패든(빈 입력·API 에러·빈 응답·JSON 파싱 실패·검증 탈락) null 반환.**
   * 절대 throw 로 생성 흐름을 막지 않는다 — 사진 분석은 선택적 부가 신호일 뿐.
   */
  async analyzePhotos(
    photos: { id: string; dataUrl: string }[],
    context: { productType: string; category: string },
  ): Promise<PhotoAnalysisResult | null> {
    if (!Array.isArray(photos) || photos.length === 0) return null
    try {
      const client = await this.createClient()
      const res = await client.messages.create({
        model: this.modelId,
        system: PHOTO_ANALYSIS_SYSTEM_PROMPT,
        max_tokens: PHOTO_ANALYSIS_MAX_TOKENS,
        messages: buildPhotoAnalysisMessages(photos, context),
      })

      const textBlock = res.content.find((c) => c.type === "text")
      if (!textBlock || textBlock.type !== "text") return null

      const knownIds = photos.map((p) => p.id)
      const items = validatePhotoAnalysis(extractJson(textBlock.text), knownIds)
      if (!items) return null

      const inputTokens = res.usage?.input_tokens ?? 0
      const outputTokens = res.usage?.output_tokens ?? 0
      const estimatedCostKRW =
        estimateInputCostKRW(this.modelId, inputTokens) +
        estimateOutputCostKRW(this.modelId, outputTokens)

      return {
        items,
        usage: {
          inputTokens,
          outputTokens,
          estimatedCostKRW: Number.isFinite(estimatedCostKRW) ? estimatedCostKRW : 0,
          truncated: res.stop_reason === "max_tokens",
        },
      }
    } catch (err) {
      // 사진 분석 실패는 절대 치명적이지 않다 — 조용히 null 폴백.
      console.warn("[analyzePhotos] failed, returning null:", err)
      return null
    }
  }

  /**
   * v5.1: 완성 아트보드 세그먼트(JPG dataURL) vision 검수 (1콜) — 시각 위생 지적 2~6건 + 잘한 점.
   * 관점 5개(여백·정렬 / 사진 품질·배치 / 텍스트 겹침·잘림 / 색 부조화 / 섹션 리듬)로 시각만 평가.
   *
   * **어떤 실패든(빈 입력·이미지 0장·API 에러·빈 응답·JSON 파싱 실패·유효 지적 0개) null 반환.**
   * 절대 throw 로 흐름을 막지 않는다 — 자가 검수는 선택적 부가 신호일 뿐.
   */
  async reviewArtboard(
    segments: { label: string; dataUrl: string }[],
    context: { productType: string },
  ): Promise<SelfReviewResult | null> {
    if (!Array.isArray(segments) || segments.length === 0) return null
    // dataURL 이미지가 하나도 없으면 보낼 게 없다 — 조용히 null(무의미한 호출·환각 방지).
    const withImages = segments.filter(
      (s) => s && typeof s.dataUrl === "string" && s.dataUrl.startsWith("data:"),
    )
    if (withImages.length === 0) return null

    try {
      const client = await this.createClient()
      const res = await client.messages.create({
        model: this.modelId,
        system: SELF_REVIEW_SYSTEM_PROMPT,
        max_tokens: SELF_REVIEW_MAX_TOKENS,
        messages: buildSelfReviewMessages(withImages, context),
      })

      const textBlock = res.content.find((c) => c.type === "text")
      if (!textBlock || textBlock.type !== "text") return null

      const review = validateSelfReview(extractJson(textBlock.text))
      if (!review) return null

      const inputTokens = res.usage?.input_tokens ?? 0
      const outputTokens = res.usage?.output_tokens ?? 0
      const estimatedCostKRW =
        estimateInputCostKRW(this.modelId, inputTokens) +
        estimateOutputCostKRW(this.modelId, outputTokens)

      return {
        ...review,
        usage: {
          inputTokens,
          outputTokens,
          estimatedCostKRW: Number.isFinite(estimatedCostKRW) ? estimatedCostKRW : 0,
          truncated: res.stop_reason === "max_tokens",
        },
      }
    } catch (err) {
      // 자가 검수 실패는 절대 치명적이지 않다 — 조용히 null 폴백.
      console.warn("[reviewArtboard] failed, returning null:", err)
      return null
    }
  }
}
