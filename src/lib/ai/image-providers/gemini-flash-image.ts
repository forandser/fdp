/**
 * Gemini Flash Image (별명 "나노바나나") 어댑터.
 *
 * v6.4 업그레이드 (2026-07-13): 호출 모델을 Gemini 3.1 Flash Image("Nano Banana 2",
 * 모델 ID `gemini-3.1-flash-image`, 2026-05-28 GA)로 교체. 프리뷰 ID(`-preview`)는
 * 2026-06-25 은퇴 — GA ID만 사용.
 *
 * ⚠️ 스토리지 키 불가침: 저장 providerId 문자열 `"gemini-2.5-flash-image"`는 절대 바꾸지 않는다.
 *   사용자가 이미 입력한 BYOK 키가 이 ID 아래 IndexedDB에 저장돼 있고, 과거 "업데이트마다 키가
 *   사라진다"가 최대 불만이었다. 그래서 provider.id / 레지스트리 switch / 설정 게이트 검사 문자열은
 *   전부 2.5 그대로 두고, "호출하는 모델 ID만" 3.1로 바꾼다.
 *
 *  - REST 경로: v1beta/models/{model}:generateContent (generationConfig.responseModalities:["IMAGE"])
 *  - 3.1 신기능: generationConfig.imageConfig { aspectRatio, imageSize("512px"|"1K"|"2K"|"4K") }.
 *    와이드 배너 레터링용으로 지원 비율 중 3:1에 가장 근접한 21:9 사용. 구형(2.5) 경로가
 *    imageConfig를 거부(400)하면 imageConfig 없이 같은 모델로 1회 재시도해 보존한다.
 *  - 폴백 체인: 3.1 → 2.5 (404/모델없음 계열 오류 시 1회). 성공 모델은 모듈 레벨에 기억.
 *  - 사진 불가침: referenceImage 전달 경로는 타입 호환용으로만 남기고 호출부에서 미사용 유지.
 *
 * BYOK 모델 — 사용자가 Google AI Studio에서 발급한 키를 입력.
 * 키는 IndexedDB에 별도 저장 (Anthropic 키와 분리).
 */

import type {
  DiagnosticResult,
  ImageGenInput,
  ImageGenResult,
  ImageProvider,
  ImageProviderId,
} from "../types"

/**
 * 저장 providerId(스토리지 키) — 절대 변경 금지. provider.id 로만 쓴다.
 * 실제 호출 모델과 분리된 "키 보관용 식별자"다.
 */
const STORAGE_PROVIDER_ID: ImageProviderId = "gemini-2.5-flash-image"
const API_BASE = "https://generativelanguage.googleapis.com/v1beta"

/**
 * 호출 모델 폴백 체인 — 3.1(신형) 우선, 실패 시 2.5(구형)로 1회 폴백.
 * 이 값들은 "호출 대상 모델 ID"이지 저장 providerId 가 아니다(STORAGE_PROVIDER_ID 참고).
 */
const CALL_MODEL_CHAIN: readonly ImageProviderId[] = [
  "gemini-3.1-flash-image",
  "gemini-2.5-flash-image",
]

/**
 * 마지막으로 성공한 호출 모델 — 다음 호출은 이 모델부터 시도해 반복 폴백(헛비용)을 막는다.
 * 모듈 레벨(세션 캐시). 결정성 규칙 저촉 없음(난수·시간 미사용).
 */
let preferredModel: ImageProviderId | null = null

/** 404 또는 "모델 미존재" 계열 응답 텍스트 판별 — 이 경우에만 다음 모델로 폴백한다. */
function isModelMissing(status: number, text: string): boolean {
  return status === 404 || /NOT_FOUND|not found|does not exist/i.test(text)
}

export class GeminiFlashImageProvider implements ImageProvider {
  // ⚠️ 스토리지 키 — 절대 변경 금지(사용자 저장 키 보존).
  readonly id = STORAGE_PROVIDER_ID
  readonly displayName = "나노바나나 2 (Gemini 3.1 Flash Image)"

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("Gemini API key is required")
  }

  private async fetchModelMeta(model: ImageProviderId): Promise<Response> {
    return fetch(
      `${API_BASE}/models/${model}?key=${encodeURIComponent(this.apiKey)}`,
    )
  }

  async diagnose(): Promise<DiagnosticResult> {
    try {
      // 3.1 우선 조회.
      const primary = await this.fetchModelMeta("gemini-3.1-flash-image")
      if (primary.status === 200) {
        preferredModel = "gemini-3.1-flash-image"
        return {
          status: "ok",
          reachable: true,
          modelAvailable: true,
          message: "Gemini 3.1 Flash Image(나노바나나 2) 사용 가능 · 키 검증 성공",
        }
      }
      if (primary.status === 401 || primary.status === 403) {
        return {
          status: "invalid_key",
          reachable: true,
          modelAvailable: false,
          message: "키가 유효하지 않거나 권한이 없어요.",
        }
      }
      if (primary.status === 404) {
        // 3.1 미가용 → 2.5 폴백 확인.
        const legacy = await this.fetchModelMeta("gemini-2.5-flash-image")
        if (legacy.status === 200) {
          preferredModel = "gemini-2.5-flash-image"
          return {
            status: "ok",
            reachable: true,
            modelAvailable: true,
            message:
              "Gemini 3.1 미가용 — 2.5 Flash Image로 자동 폴백해 사용해요. 키 검증 성공",
          }
        }
        if (legacy.status === 401 || legacy.status === 403) {
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
          message: `Gemini 3.1·2.5 모두 확인 실패 (2.5 응답 ${legacy.status})`,
        }
      }
      return {
        status: "unknown_error",
        reachable: true,
        modelAvailable: false,
        message: `Gemini 응답 코드 ${primary.status}`,
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
    // 사진 불가침: referenceImage 는 타입 호환용으로만 남긴다(호출부 미전달 유지).
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

    // 성공 기억 모델부터 시도(반복 폴백 방지) → 나머지 체인.
    const models: ImageProviderId[] = preferredModel
      ? [
          preferredModel,
          ...CALL_MODEL_CHAIN.filter((m) => m !== preferredModel),
        ]
      : [...CALL_MODEL_CHAIN]

    let lastMissing = ""

    for (const model of models) {
      // 첫 시도: imageConfig 포함(21:9 · 1K). 400(imageConfig 거부)이면 없이 1회 재시도.
      for (let includeImageConfig = true; ; includeImageConfig = false) {
        const generationConfig: Record<string, unknown> = {
          responseModalities: ["IMAGE"],
        }
        if (includeImageConfig) {
          generationConfig.imageConfig = { aspectRatio: "21:9", imageSize: "1K" }
        }
        const body = { contents: [{ role: "user", parts }], generationConfig }

        const res = await fetch(
          `${API_BASE}/models/${model}:generateContent?key=${encodeURIComponent(
            this.apiKey,
          )}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            // v6.3: 호출부 타임아웃/취소 신호 — 초과 시 진행 중 요청을 실제로 끊는다.
            signal: input.signal,
          },
        )

        if (res.ok) {
          const json = (await res.json()) as {
            candidates?: Array<{
              content?: {
                parts?: Array<{
                  inlineData?: { mimeType?: string; data?: string }
                }>
              }
            }>
          }
          const part = json.candidates?.[0]?.content?.parts?.find(
            (p) => p.inlineData,
          )
          const inline = part?.inlineData
          if (!inline?.data) throw new Error("Gemini: no image returned")
          const dataUrl = `data:${inline.mimeType ?? "image/png"};base64,${inline.data}`
          preferredModel = model // 다음 호출은 이 모델부터.
          return {
            dataUrl,
            modelId: model, // 실제 호출 성공한 모델 ID.
            costKRW: 53, // 약 $0.039 × 1400원 환산(정확 단가 미확인 — 기존 추정 유지).
          }
        }

        const text = await res.text().catch(() => "")

        // v6.4(FIX-6): imageConfig를 포함해 보낸 요청이 400이면(오류 문구 무관) 같은 모델을
        // imageConfig 없이 1회 재시도(구형 경로 보존). 실제 API 400 문구가 정규식과 달라도 재시도가
        // 확실히 걸리게 문구 의존을 제거한다. 재시도(=includeImageConfig false)도 400이면 이 분기를
        // 지나 아래 throw 로 떨어진다. 401/403/429/AbortError는 400이 아니거나 fetch 거부라 즉시 throw.
        if (includeImageConfig && res.status === 400) {
          continue
        }
        // 모델 미존재(404/NOT_FOUND) → 다음 모델로 폴백.
        if (isModelMissing(res.status, text)) {
          lastMissing = `${model} ${res.status}: ${text.slice(0, 160)}`
          break
        }
        // 폴백 불가 오류(401/403/429/기타)는 가리지 않고 그대로 throw.
        throw new Error(`Gemini ${res.status}: ${text.slice(0, 200)}`)
      }
    }

    throw new Error(
      `Gemini: 사용 가능한 이미지 모델이 없어요.${lastMissing ? ` (${lastMissing})` : ""}`,
    )
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
