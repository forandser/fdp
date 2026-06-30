/**
 * Photoroom 배경 제거 어댑터.
 *
 * - 모델 ID: photoroom
 * - 비용: 약 $0.02/장 → ₩28 환산
 * - API: https://sdk.photoroom.com/v1/segment
 * - 생성(generate)은 지원하지 않음 — removeBackground 전용.
 *
 * BYOK 모델 — 사용자가 Photoroom Dashboard에서 발급한 키를 입력.
 */

import type {
  DiagnosticResult,
  ImageGenInput,
  ImageGenResult,
  ImageProvider,
  ImageProviderId,
} from "../types"

const MODEL_ID: ImageProviderId = "photoroom"
const API_URL = "https://sdk.photoroom.com/v1/segment"

export class PhotoroomProvider implements ImageProvider {
  readonly id = MODEL_ID
  readonly displayName = "Photoroom (배경 제거)"

  constructor(private readonly apiKey: string) {
    if (!apiKey) throw new Error("Photoroom API key is required")
  }

  async diagnose(): Promise<DiagnosticResult> {
    // Photoroom은 가벼운 GET 검증 엔드포인트가 마땅치 않아 키 형식만 점검.
    // 실제 호출 시 401이 떨어지면 사용 시점에 사용자에게 안내.
    const key = this.apiKey.trim()
    if (key.length < 20) {
      return {
        status: "invalid_key",
        reachable: false,
        modelAvailable: false,
        message: "Photoroom 키 형식이 올바르지 않아요.",
      }
    }
    return {
      status: "ok",
      reachable: true,
      modelAvailable: true,
      message: "키 형식 확인 완료. 실제 호출 시 401이면 키를 다시 확인해주세요.",
    }
  }

  async generate(_input: ImageGenInput): Promise<ImageGenResult> {
    void _input
    throw new Error("Photoroom는 generate 미지원 (removeBackground만 지원)")
  }

  async removeBackground(image: Blob): Promise<ImageGenResult> {
    const form = new FormData()
    form.append("image_file", image)

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "x-api-key": this.apiKey },
      body: form,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Photoroom ${res.status}: ${text.slice(0, 200)}`)
    }
    const blob = await res.blob()
    const base64 = await blobToBase64(blob)
    const dataUrl = `data:image/png;base64,${base64}`

    return {
      dataUrl,
      modelId: MODEL_ID,
      costKRW: 28,
    }
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader === "undefined") {
    // Node/SSR 안전 경로 — 실제로는 BYOK 클라이언트에서만 호출됨.
    const buf = await blob.arrayBuffer()
    let binary = ""
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return typeof btoa !== "undefined" ? btoa(binary) : ""
  }
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const result = typeof r.result === "string" ? r.result : ""
      const idx = result.indexOf("base64,")
      resolve(idx >= 0 ? result.slice(idx + 7) : "")
    }
    r.onerror = () => reject(r.error ?? new Error("read failed"))
    r.readAsDataURL(blob)
  })
}
