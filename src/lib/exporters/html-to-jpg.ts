/**
 * HTML 노드 → JPG 변환 + 자동 분할 다운로드.
 *
 * 룰북 함의: 이건 1차 임시 출력기. 향후 react-konva 캔버스 에디터로 교체 시
 * 이 파일은 폐기되고 lib/exporters/coupang.ts로 대체된다.
 * 단, ExportOptions 인터페이스(types.ts)는 유지.
 */

import { toCanvas } from "html-to-image"

export interface ExportSliceOptions {
  /** 출력 가로 폭 (px) */
  width: number
  /** 세로 분할 단위 (px). 한 장으로 출력하려면 null */
  sliceHeight: number | null
  /** JPG 품질 0~1 */
  quality?: number
  /** 픽셀 비율 (1 또는 2) */
  pixelRatio?: number
  /** 다운로드 파일명 접두사 */
  baseName?: string
}

export interface ExportSliceResult {
  fileCount: number
  totalBytes: number
}

/**
 * 원본 노드를 가로 width로 강제 렌더한 캔버스를 만든 뒤
 * sliceHeight 단위로 잘라 각각 JPG 다운로드.
 */
export async function exportNodeAsSlicedJpg(
  source: HTMLElement,
  opts: ExportSliceOptions,
): Promise<ExportSliceResult> {
  const pixelRatio = opts.pixelRatio ?? 2
  const quality = opts.quality ?? 0.92
  const baseName = (opts.baseName ?? "detail").normalize("NFC")

  // 1) 가로 폭을 width로 고정한 클론을 hidden div에 그려 캡처
  const clone = source.cloneNode(true) as HTMLElement
  const wrapper = document.createElement("div")
  wrapper.style.position = "fixed"
  wrapper.style.top = "-99999px"
  wrapper.style.left = "0"
  wrapper.style.width = `${opts.width}px`
  wrapper.style.padding = "0"
  wrapper.style.margin = "0"
  wrapper.style.background = "#ffffff"
  wrapper.style.zIndex = "-1"
  clone.style.width = "100%"
  clone.style.maxWidth = "100%"
  clone.style.boxShadow = "none"
  clone.style.borderRadius = "0"
  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)

  try {
    // 폰트 로드 대기
    if (document.fonts?.ready) await document.fonts.ready

    const fullCanvas = await toCanvas(wrapper, {
      pixelRatio,
      backgroundColor: "#ffffff",
      cacheBust: true,
    })

    const fullWidth = fullCanvas.width
    const fullHeight = fullCanvas.height

    // 2) 분할 처리
    if (opts.sliceHeight == null) {
      const blob = await canvasToJpegBlob(fullCanvas, quality)
      downloadBlob(`${baseName}.jpg`, blob)
      return { fileCount: 1, totalBytes: blob.size }
    }

    const sliceCssHeight = opts.sliceHeight
    const sliceCanvasHeight = sliceCssHeight * pixelRatio
    const sliceCount = Math.max(1, Math.ceil(fullHeight / sliceCanvasHeight))

    let totalBytes = 0
    for (let i = 0; i < sliceCount; i++) {
      const yStart = i * sliceCanvasHeight
      const sliceH = Math.min(sliceCanvasHeight, fullHeight - yStart)
      if (sliceH <= 0) break

      const sliceCanvas = document.createElement("canvas")
      sliceCanvas.width = fullWidth
      sliceCanvas.height = sliceH
      const ctx = sliceCanvas.getContext("2d")
      if (!ctx) continue
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height)
      ctx.drawImage(fullCanvas, 0, yStart, fullWidth, sliceH, 0, 0, fullWidth, sliceH)

      const blob = await canvasToJpegBlob(sliceCanvas, quality)
      const num = String(i + 1).padStart(2, "0")
      downloadBlob(`${baseName}_${num}.jpg`, blob)
      totalBytes += blob.size

      // 다운로드 사이 약간의 텀 (브라우저가 모두 받게)
      if (i < sliceCount - 1) {
        await new Promise((r) => setTimeout(r, 250))
      }
    }
    return { fileCount: sliceCount, totalBytes }
  } finally {
    document.body.removeChild(wrapper)
  }
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error("toBlob returned null"))
      },
      "image/jpeg",
      quality,
    )
  })
}

function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
