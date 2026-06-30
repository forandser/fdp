/**
 * OpenAI gpt-image-1 어댑터.
 *
 * - 모델 ID: gpt-image-1
 * - 비용: 약 $0.08/장 (quality=medium 기준 추정) → ₩110 환산
 * - API: https://api.openai.com/v1/images/generations
 * - 한글 텍스트 합성 품질이 현재 BYOK 모델 중 가장 우수.
 *
 * BYOK 모델 — 사용자가 OpenAI Platform에서 발급한 키를 입력.
 * referenceImage가 들어와도 본 어댑터는 generations만 호출 (prompt만 사용).
 * edits 멀티파트 호출은 후속 버전에서 추가 예정.
 */

import type {
  DiagnosticResult,
  ImageGenInput,
  ImageGenResult,
  ImageProvider,
  ImageProviderId,
} from "../types"

const MODEL_ID: ImageProviderId = "gpt-image-1"
const API_BASE = "https://api.openai.com/v1"

type OpenAISize = "1024x1024" | "1024x1536" | "1536x1024"

function ratioToSize(ratio: ImageGenInput["ratio"]): OpenAISize {
  switch (ratio) {
    case "4:5":
      return "1024x1536"
    case "16:9":
      return "1536x1024"
    case "1:1":
    default:
      return "1024x1024"
  }
}

export class GptImage1Provider implements ImageProvider {
  readonly id = MODEL_ID
  readonly displayName = "OpenAI gpt-image-1 (한글 텍스트 강함)"

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("OpenAI API key is required")
  }

  async diagnose(): Promise<DiagnosticResult> {
    try {
      const res = await fetch(`${API_BASE}/models/${MODEL_ID}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      if (res.status === 200) {
        return {
          status: "ok",
          reachable: true,
          modelAvailable: true,
          message: "OpenAI 키 검증 성공",
        }
      }
      if (res.status === 401) {
        return {
          status: "invalid_key",
          reachable: true,
          modelAvailable: false,
          message: "OpenAI 키가 유효하지 않아요.",
        }
      }
      if (res.status === 403) {
        return {
          status: "geo_blocked",
          reachable: true,
          modelAvailable: false,
          message: "지역 또는 권한 제한으로 모델을 사용할 수 없어요.",
        }
      }
      return {
        status: "unknown_error",
        reachable: true,
        modelAvailable: false,
        message: `OpenAI 응답 코드 ${res.status}`,
      }
    } catch (e) {
      return {
        status: "network_error",
        reachable: false,
        modelAvailable: false,
        message: e instanceof Error ? e.message : "네트워크 오류",
      }
    }
  }

  async generate(input: ImageGenInput): Promise<ImageGenResult> {
    const size = ratioToSize(input.ratio)
    const body = {
      model: MODEL_ID,
      prompt: input.prompt,
      size,
      quality: "medium",
    }

    const res = await fetch(`${API_BASE}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`OpenAI ${res.status}: ${text.slice(0, 200)}`)
    }
    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string }>
    }
    const b64 = json.data?.[0]?.b64_json
    if (!b64) throw new Error("OpenAI: no image returned")
    const dataUrl = `data:image/png;base64,${b64}`

    return {
      dataUrl,
      modelId: MODEL_ID,
      costKRW: 110,
    }
  }
}
