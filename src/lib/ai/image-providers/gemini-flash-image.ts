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
 *  - v6.4(작업2): 3.1 공식 이미지 생성은 신형 Interactions API(POST v1beta/interactions).
 *    시도 체인(경로+모델): interactions+3.1 → generateContent+3.1 → generateContent+2.5(레거시).
 *    각 단계 실패(4xx/404/CORS/TypeError 네트워크/파싱) → 다음 단계. 401/403·AbortError 는 즉시 중단.
 *  - generateContent 경로: generationConfig.imageConfig { aspectRatio:"21:9", imageSize:"1K" }.
 *    imageConfig 를 거부(400)하면 같은 모델을 imageConfig 없이 1회 재시도해 보존한다.
 *  - 성공한 "경로+모델"은 모듈 레벨(preferredRoute)에 기억 — 다음 호출은 그 경로부터 시도.
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
 * v6.4(작업2): 3.1 품질 경로 — 신형 Interactions API 우선.
 * 시도 체인(경로+모델):
 *   (1) interactions      + gemini-3.1-flash-image  ← 공식 3.1 이미지 생성 경로(21:9 지원)
 *   (2) generateContent   + gemini-3.1-flash-image  ← 3.1 구경로(문서상 불확실 — 있으면 사용)
 *   (3) generateContent   + gemini-2.5-flash-image  ← 레거시(문서상 여전히 지원)
 * 이 값들은 "호출 대상 경로+모델"이지 저장 providerId 가 아니다(STORAGE_PROVIDER_ID 참고).
 */
interface CallRoute {
  path: "interactions" | "generateContent"
  model: ImageProviderId
}
const ROUTE_CHAIN: readonly CallRoute[] = [
  { path: "interactions", model: "gemini-3.1-flash-image" },
  { path: "generateContent", model: "gemini-3.1-flash-image" },
  { path: "generateContent", model: "gemini-2.5-flash-image" },
]

/**
 * 마지막으로 성공한 경로+모델 — 다음 호출은 이 경로부터 시도해 반복 폴백(헛비용)을 막는다.
 * 모듈 레벨(세션 캐시). 결정성 규칙 저촉 없음(난수·시간 미사용).
 */
let preferredRoute: CallRoute | null = null

function sameRoute(a: CallRoute, b: CallRoute): boolean {
  return a.path === b.path && a.model === b.model
}

/** 성공 경로 우선 정렬 — 나머지는 원래 체인 순서 유지. */
function orderedRoutes(): CallRoute[] {
  if (!preferredRoute) return [...ROUTE_CHAIN]
  const pref = preferredRoute
  return [pref, ...ROUTE_CHAIN.filter((r) => !sameRoute(r, pref))]
}

/**
 * 체인 전체를 중단시키는 치명 오류: 401/403(키 무효). 폴백으로 가리지 않는다(키 문제 표면화).
 * AbortError 는 fetch 가 던지는 DOMException(name==="AbortError")로 별도 판별한다.
 */
class GeminiAuthError extends Error {}

/** 치명 오류(=폴백 금지, 즉시 throw) 여부 — 키 무효(401/403) 또는 취소(AbortError). */
function isFatalError(e: unknown): boolean {
  if (e instanceof GeminiAuthError) return true
  return (e as { name?: unknown } | null)?.name === "AbortError"
}

/**
 * interactions 응답에서 base64 이미지 페이로드를 방어적으로 추출한다.
 * output_image 가 문자열(base64/dataURL)·{ data }·중첩 배열 등 어떤 형태든 훑어 최초의
 * base64/dataURL 문자열을 찾는다. 못 찾으면 null(→ 호출부가 다음 경로로 폴백, throw 아님).
 */
const INTERACTIONS_IMAGE_KEYS: ReadonlySet<string> = new Set([
  "output_image",
  "b64_json",
  "imageBytes",
  "bytesBase64Encoded",
  "base64",
  "data",
  "image",
])

function findBase64Payload(v: unknown, depth: number): string | null {
  if (v == null || depth > 6) return null
  if (typeof v === "string") {
    const s = v.trim()
    if (s.startsWith("data:image/")) return s
    // 순수 base64 로 보이면 채택. 오탐 방지: 실제 이미지 페이로드는 항상 수 KB 이상이므로
    // 최소 1024자 — 서명·토큰류 짧은 base64 문자열을 이미지로 오채택하지 않는다.
    if (s.length >= 1024 && /^[A-Za-z0-9+/=\s]+$/.test(s)) return s
    return null
  }
  if (Array.isArray(v)) {
    for (const item of v) {
      const found = findBase64Payload(item, depth + 1)
      if (found) return found
    }
    return null
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>
    // 이미지 관련 키 우선 탐색 후, 나머지 값도 방어적으로 훑는다(형태 불명 대비).
    for (const k of INTERACTIONS_IMAGE_KEYS) {
      if (k in obj) {
        const found = findBase64Payload(obj[k], depth + 1)
        if (found) return found
      }
    }
    for (const [k, val] of Object.entries(obj)) {
      if (INTERACTIONS_IMAGE_KEYS.has(k)) continue
      const found = findBase64Payload(val, depth + 1)
      if (found) return found
    }
  }
  return null
}

/** base64/dataURL 문자열 → dataURL(mime 추출, 없으면 image/png 기본). 페이로드 없으면 null. */
function toImageDataUrl(payload: string | null): string | null {
  if (!payload) return null
  const s = payload.trim()
  const m = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(s)
  if (m) {
    const mime = (m[1] ?? "").trim() || "image/png"
    const data = (m[2] ?? "").trim()
    return data ? `data:${mime};base64,${data}` : null
  }
  return `data:image/png;base64,${s}`
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
    // interactions(3.1) 가용 여부는 메타 엔드포인트로 확인하기 어렵다 — 모델 메타로 키·모델을
    // 검증하되, 실제 생성은 3.1(interactions) → 3.1(generateContent) → 2.5 로 자동 폴백함을 안내한다.
    try {
      // 3.1 우선 조회.
      const primary = await this.fetchModelMeta("gemini-3.1-flash-image")
      if (primary.status === 200) {
        return {
          status: "ok",
          reachable: true,
          modelAvailable: true,
          message:
            "Gemini 3.1 Flash Image(나노바나나 2) 사용 가능 · 키 검증 성공 (생성 시 3.1 → 2.5 자동 폴백)",
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
        // 3.1 메타 미확인 → 2.5 폴백 확인.
        const legacy = await this.fetchModelMeta("gemini-2.5-flash-image")
        if (legacy.status === 200) {
          return {
            status: "ok",
            reachable: true,
            modelAvailable: true,
            message:
              "Gemini 3.1 메타 미확인 — 생성 시 3.1 우선 시도 후 2.5 Flash Image로 자동 폴백해요. 키 검증 성공",
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
    //   generateContent 경로용 parts 만 구성하고, interactions 경로는 텍스트 프롬프트만 보낸다.
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

    // 성공 기억 경로부터 시도(반복 폴백 방지) → 나머지 체인.
    let lastErr: unknown = null
    for (const route of orderedRoutes()) {
      // 사진이 포함된 요청(referenceImage)은 interactions 경로를 건너뛴다 — 이 경로는 텍스트만
      // 보내므로 "사진 없는 재창작"이 되어 실제 사진을 모델 상상으로 대체해 버린다(사진 불가침
      // 위반). 사진 포함 요청은 사진을 실어 보내는 검증된 generateContent 경로로만 처리한다.
      if (route.path === "interactions" && input.referenceImage) continue
      try {
        const result =
          route.path === "interactions"
            ? await this.callInteractions(route.model, input.prompt, input.signal)
            : await this.callGenerateContent(route.model, parts, input.signal)
        preferredRoute = route // 다음 호출은 이 경로부터.
        return result
      } catch (e) {
        // 401/403·AbortError 는 폴백으로 가리지 않고 즉시 중단(키·취소 문제 표면화).
        if (isFatalError(e)) throw e
        lastErr = e // 4xx/404/CORS/TypeError/파싱 실패 → 다음 경로로.
      }
    }

    throw new Error(
      `Gemini: 사용 가능한 이미지 경로가 없어요.${
        lastErr instanceof Error ? ` (${lastErr.message.slice(0, 180)})` : ""
      }`,
    )
  }

  /**
   * (경로 1) 신형 Interactions API — POST v1beta/interactions. 21:9 · 1K PNG 요청.
   * 성공 시 output_image(어떤 형태든)에서 base64 를 방어적으로 추출한다.
   * 401/403 → GeminiAuthError(체인 중단). 그 외 4xx/5xx·페이로드 없음 → throw(다음 경로로 폴백).
   * 인증: 기존과 동일하게 ?key= 쿼리 파라미터(BYOK 브라우저 직접 호출). signal 을 fetch 에 전달.
   */
  private async callInteractions(
    model: ImageProviderId,
    prompt: string,
    signal: AbortSignal | undefined,
  ): Promise<ImageGenResult> {
    const res = await fetch(
      `${API_BASE}/interactions?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: [{ type: "text", text: prompt }],
          response_format: {
            type: "image",
            mime_type: "image/png",
            aspect_ratio: "21:9",
            image_size: "1K",
          },
        }),
        signal,
      },
    )
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      if (res.status === 401 || res.status === 403) {
        throw new GeminiAuthError(`Gemini ${res.status}: ${text.slice(0, 200)}`)
      }
      throw new Error(`interactions ${model} ${res.status}: ${text.slice(0, 160)}`)
    }
    const json = (await res.json()) as unknown
    const dataUrl = toImageDataUrl(findBase64Payload(json, 0))
    if (!dataUrl) throw new Error(`interactions ${model}: no image payload`)
    return {
      dataUrl,
      modelId: model, // 실제 호출 성공한 모델 ID.
      costKRW: 53, // 약 $0.039 × 1400원 환산(정확 단가 미확인 — 기존 추정 유지).
    }
  }

  /**
   * (경로 2·3) generateContent — 기존 imageConfig(21:9·1K)·400 재시도 로직 유지.
   * imageConfig 를 포함해 보낸 요청이 400 이면 같은 모델을 imageConfig 없이 1회 재시도(구형 경로 보존).
   * 401/403 → GeminiAuthError(체인 중단). 그 외 4xx/404/5xx·이미지 없음 → throw(다음 경로로 폴백).
   */
  private async callGenerateContent(
    model: ImageProviderId,
    parts: Array<Record<string, unknown>>,
    signal: AbortSignal | undefined,
  ): Promise<ImageGenResult> {
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
          signal,
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
        const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)
        const inline = part?.inlineData
        if (!inline?.data) throw new Error(`generateContent ${model}: no image returned`)
        const dataUrl = `data:${inline.mimeType ?? "image/png"};base64,${inline.data}`
        return {
          dataUrl,
          modelId: model, // 실제 호출 성공한 모델 ID.
          costKRW: 53, // 약 $0.039 × 1400원 환산(정확 단가 미확인 — 기존 추정 유지).
        }
      }

      const text = await res.text().catch(() => "")

      // v6.4(FIX-6): imageConfig를 포함해 보낸 요청이 400이면(오류 문구 무관) 같은 모델을
      // imageConfig 없이 1회 재시도(구형 경로 보존). 재시도(=includeImageConfig false)도 400이면
      // 이 분기를 지나 아래 throw 로 떨어진다(→ 다음 경로 폴백).
      if (includeImageConfig && res.status === 400) {
        continue
      }
      // 키 무효(401/403)는 폴백으로 가리지 않고 즉시 중단.
      if (res.status === 401 || res.status === 403) {
        throw new GeminiAuthError(`Gemini ${res.status}: ${text.slice(0, 200)}`)
      }
      // 404/그 외 4xx/5xx → 폴백 대상(다음 경로).
      throw new Error(`generateContent ${model} ${res.status}: ${text.slice(0, 160)}`)
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
