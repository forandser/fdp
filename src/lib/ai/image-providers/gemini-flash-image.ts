/**
 * Gemini 2.5 Flash Image (별명 "나노바나나") 어댑터.
 *
 * 리서치 결과 (2026-06-30):
 *  - 모델 ID: gemini-2.5-flash-image
 *  - 비용: 약 $0.039/장 (1290토큰 × $30/M)
 *  - API: Google AI Studio Generative Language REST API
 *  - 한글 텍스트 렌더링은 공식 보장 없음 — 텍스트 합성은 클라이언트 캔버스로 권장
 *
 * BYOK 모델 — 사용자가 Google AI Studio에서 발급한 키를 입력.
 * 키는 IndexedDB에 별도 저장 (Anthropic 키와 분리).
 *
 * NOTE: 본 어댑터는 v1.5 인터페이스. 실제 호출 코드는 v1.6에서 활성화.
 * 지금은 인터페이스/타입/UI 자리만 마련.
 */

import type {
  DiagnosticResult,
  ImageGenInput,
  ImageGenResult,
  ImageProvider,
  ImageProviderId,
} from "../types"

const MODEL_ID: ImageProviderId = "gemini-2.5-flash-image"
const API_BASE = "https://generativelanguage.googleapis.com/v1beta"

export class GeminiFlashImageProvider implements ImageProvider {
  readonly id = MODEL_ID
  readonly displayName = "Gemini 2.5 Flash Image (나노바나나)"

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("Gemini API key is required")
  }

  async diagnose(): Promise<DiagnosticResult> {
    try {
      const res = await fetch(
        `${API_BASE}/models/${MODEL_ID}?key=${encodeURIComponent(this.apiKey)}`,
      )
      if (res.status === 200) {
        return {
          status: "ok",
          reachable: true,
          modelAvailable: true,
          message: "Gemini 키 검증 성공",
        }
      }
      if (res.status === 401 || res.status === 403) {
        return {
          status: "invalid_key",
          reachable: true,
          modelAvailable: false,
          message: "키가 유효하지 않거나 권한이 없어요.",
        }
      }
      return {
        status: "unknown_error",
        reachable: true,
        modelAvailable: false,
        message: `Gemini 응답 코드 ${res.status}`,
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
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }]
    if (input.referenceImage) {
      const base64 = await blobToBase64(input.referenceImage)
      parts.push({
        inline_data: {
          mime_type: input.referenceImage.type || "image/jpeg",
          data: base64,
        },
      })
    }

    const body = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
      },
    }

    const res = await fetch(
      `${API_BASE}/models/${MODEL_ID}:generateContent?key=${encodeURIComponent(
        this.apiKey,
      )}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        // v6.3: 호출부 타임아웃/취소 신호 — 초과 시 진행 중 요청을 실제로 끊는다(typoBusy 고착 방지).
        signal: input.signal,
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`)
    }
    const json = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }>
        }
      }>
    }
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
    const inline = part?.inlineData
    if (!inline?.data) throw new Error("Gemini: no image returned")
    const dataUrl = `data:${inline.mimeType ?? "image/png"};base64,${inline.data}`

    return {
      dataUrl,
      modelId: MODEL_ID,
      costKRW: 53, // 약 $0.039 × 1400원 환산
    }
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader === "undefined") return ""
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const result = typeof r.result === "string" ? r.result : ""
      // "data:...;base64,XXXX" → XXXX
      const idx = result.indexOf("base64,")
      resolve(idx >= 0 ? result.slice(idx + 7) : "")
    }
    r.onerror = () => reject(r.error ?? new Error("read failed"))
    r.readAsDataURL(blob)
  })
}
