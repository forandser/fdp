/**
 * 이미지 프로바이더 레지스트리.
 *
 * 사용자가 BYOK로 등록한 키를 받아 인스턴스를 만들어 돌려준다.
 * Anthropic 키와 별개로 보관 (별도 storage 키).
 */

import { get, set, del } from "idb-keyval"
import { GeminiFlashImageProvider } from "./gemini-flash-image"
import { GptImage1Provider } from "./gpt-image-1"
import { PhotoroomProvider } from "./photoroom"
import type { ImageProvider, ImageProviderId } from "../types"

const STORAGE_KEY = "fdp.image-provider.v1"

interface SavedImageProviderConfig {
  providerId: ImageProviderId
  apiKey: string
}

export async function getSavedImageProviderConfig(): Promise<SavedImageProviderConfig | null> {
  const raw = await get<SavedImageProviderConfig>(STORAGE_KEY)
  return raw ?? null
}

export async function saveImageProviderConfig(
  cfg: SavedImageProviderConfig,
): Promise<void> {
  await set(STORAGE_KEY, cfg)
}

export async function clearImageProviderConfig(): Promise<void> {
  await del(STORAGE_KEY)
}

export async function getImageProvider(): Promise<ImageProvider | null> {
  const cfg = await getSavedImageProviderConfig()
  if (!cfg || !cfg.apiKey) return null
  switch (cfg.providerId) {
    case "gemini-2.5-flash-image":
      return new GeminiFlashImageProvider(cfg.apiKey)
    case "gpt-image-1":
      return new GptImage1Provider(cfg.apiKey)
    case "photoroom":
      return new PhotoroomProvider(cfg.apiKey)
    default:
      return null
  }
}

export const IMAGE_PROVIDER_OPTIONS: Array<{
  id: ImageProviderId
  label: string
  description: string
  consoleUrl: string
}> = [
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash Image (나노바나나)",
    description: "Google AI Studio · $0.039/장. 사진 합성·배경 교체에 강함.",
    consoleUrl: "https://aistudio.google.com/app/apikey",
  },
  {
    id: "gpt-image-1",
    label: "OpenAI gpt-image-1 (한글 텍스트 강함)",
    description: "OpenAI · $0.08~/장. 한글 텍스트 합성 1위.",
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "photoroom",
    label: "Photoroom (배경 제거)",
    description: "Photoroom · $0.02/장. 흰배경 누끼 자동.",
    consoleUrl: "https://www.photoroom.com/api/dashboard",
  },
]
