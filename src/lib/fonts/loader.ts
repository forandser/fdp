/**
 * 폰트 동적 로더 + 캔버스용 FontFace 등록.
 *
 * next/font의 해시 폰트명 문제를 피하기 위해 직접 FontFace API 사용.
 * 캔버스 렌더 직전에 ensureLoaded() 호출 → 미로드 시 export 차단.
 */

import { findFont } from "./registry"
import { assetUrl } from "./asset-base"

const loadedFamilies = new Set<string>()
const loadingPromises = new Map<string, Promise<void>>()

export async function loadFont(family: string): Promise<void> {
  if (loadedFamilies.has(family)) return
  const existing = loadingPromises.get(family)
  if (existing) {
    await existing
    return
  }
  const meta = findFont(family)
  if (!meta) {
    throw new Error(`Unknown font: ${family}`)
  }

  const loadPromise = (async () => {
    for (const w of meta.weights) {
      const face = new FontFace(meta.family, `url(${assetUrl(w.url)}) format("woff2")`, {
        weight: String(w.weight),
        style: "normal",
        display: "swap",
      })
      const loadedFace = await face.load()
      document.fonts.add(loadedFace)
    }
    await document.fonts.ready
  })()

  loadingPromises.set(family, loadPromise)
  try {
    await loadPromise
    loadedFamilies.add(family)
  } finally {
    loadingPromises.delete(family)
  }
}

export async function ensureLoaded(families: string[]): Promise<void> {
  await Promise.all(families.map((f) => loadFont(f)))
}

export function isLoaded(family: string): boolean {
  return loadedFamilies.has(family)
}
