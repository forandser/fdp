/**
 * HTML 노드 → JPG 변환 + 분할 다운로드.
 *
 * 룰북 함의: 이건 1차 임시 출력기. 향후 react-konva 캔버스 에디터로 교체 시
 * 이 파일은 폐기되고 lib/exporters/coupang.ts로 대체된다.
 * 단, ExportOptions 인터페이스(types.ts)는 유지.
 *
 * 두 가지 모드:
 *  - sliceHeight === null → 전체 한 장
 *  - "sections"           → captureRef 직속 자식(섹션 블록) 하나씩 캡처
 */

import { toCanvas } from "html-to-image"

export type SliceMode = "single" | "sections"

export interface ExportSliceOptions {
  /** 출력 가로 폭 (px) */
  width: number
  /** "single" = 한 장, "sections" = 자연 경계에서 자름 (targetSliceHeight 근처) */
  mode: SliceMode
  /**
   * "sections" 모드 목표 슬라이스 세로 픽셀. 실제 슬라이스는 이 값을 넘지 않으면서
   * 가장 많은 섹션을 묶어 자른다 (섹션 중간 절단 방지).
   * 미지정 시 3000px.
   */
  targetSliceHeight?: number
  /** JPG 품질 0~1 */
  quality?: number
  /** 픽셀 비율 (1 또는 2). 메모리 부족 위험 있을 때 1 */
  pixelRatio?: number
  /** 다운로드 파일명 접두사 */
  baseName?: string
  /**
   * v2.7: 저장 폴더 핸들 (File System Access API).
   * 지정 시 브라우저 다운로드 대신 이 폴더에 직접 파일 쓰기.
   * Chrome/Edge만 지원. 미지원 브라우저는 undefined로 넘기면 자동 fallback.
   */
  directoryHandle?: FileSystemDirectoryHandle
}

export interface ExportSliceResult {
  fileCount: number
  totalBytes: number
}

/**
 * source(=captureRef div)를 가로 width로 강제 렌더한 클론을 hidden div에 그린 뒤
 * mode에 따라 전체/섹션 단위로 캡처해 각각 JPG 다운로드.
 */
export async function exportNodeAsSlicedJpg(
  source: HTMLElement,
  opts: ExportSliceOptions,
): Promise<ExportSliceResult> {
  const pixelRatio = opts.pixelRatio ?? 2
  const quality = opts.quality ?? 0.92
  const baseName = (opts.baseName ?? "detail").normalize("NFC")

  // 1) 가로 폭을 width로 고정한 클론을 화면 밖에 마운트.
  //    z-index:-1 은 일부 환경에서 toCanvas가 빈 캔버스를 만드는 원인이 되어 제거.
  //    top:-99999px 대신 화면 우측 밖에 두어 폰트/이미지 로드는 정상 진행되게 함.
  const clone = source.cloneNode(true) as HTMLElement
  const wrapper = document.createElement("div")
  wrapper.style.position = "fixed"
  wrapper.style.top = "0"
  wrapper.style.left = "0"
  wrapper.style.transform = "translateX(-200vw)"
  wrapper.style.width = `${opts.width}px`
  wrapper.style.padding = "0"
  wrapper.style.margin = "0"
  wrapper.style.background = "#ffffff"
  wrapper.style.pointerEvents = "none"
  clone.style.width = "100%"
  clone.style.maxWidth = "100%"
  clone.style.boxShadow = "none"
  clone.style.borderRadius = "0"
  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)

  try {
    // 폰트 로드 대기 (한글 웹폰트가 늦으면 캡처가 빈 박스로 나옴)
    if (document.fonts?.ready) {
      await document.fonts.ready
    }
    // 이미지 로드 대기 (clone 내부의 img들이 디코딩될 때까지)
    await waitForImages(clone)
    // 레이아웃 안정화
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    let totalBytes = 0
    let fileCount = 0

    if (opts.mode === "single") {
      const canvas = await toCanvas(clone, {
        pixelRatio,
        backgroundColor: "#ffffff",
        cacheBust: false,
      })
      const blob = await canvasToJpegBlob(canvas, quality)
      await saveBlob(`${baseName}.jpg`, blob, opts.directoryHandle)
      return { fileCount: 1, totalBytes: blob.size }
    }

    // "sections" 모드: clone 직속 자식들을 targetSliceHeight(기본 3000px) 근처에서
    // 자연 경계(섹션 사이)로 묶어 캡처. 콘텐츠 중간 절단 방지.
    const target = opts.targetSliceHeight ?? 3000
    const children = Array.from(
      clone.querySelectorAll<HTMLElement>(":scope > *"),
    ).filter((el) => {
      const rect = el.getBoundingClientRect()
      return rect.height > 0 && rect.width > 0
    })

    if (children.length === 0) {
      // fallback: 섹션을 못 찾으면 한 장으로
      const canvas = await toCanvas(clone, {
        pixelRatio,
        backgroundColor: "#ffffff",
        cacheBust: false,
      })
      const blob = await canvasToJpegBlob(canvas, quality)
      await saveBlob(`${baseName}.jpg`, blob, opts.directoryHandle)
      return { fileCount: 1, totalBytes: blob.size }
    }

    // 그리디 그룹화: 각 그룹의 누적 높이가 target을 넘지 않도록 섹션을 묶음.
    // 한 섹션이 target보다 크면 단독 그룹으로 처리 (자연 경계 유지).
    const groups: HTMLElement[][] = []
    let curr: HTMLElement[] = []
    let currH = 0
    for (const el of children) {
      const h = el.getBoundingClientRect().height
      if (curr.length > 0 && currH + h > target) {
        groups.push(curr)
        curr = []
        currH = 0
      }
      curr.push(el)
      currH += h
    }
    if (curr.length > 0) groups.push(curr)

    const pad = groups.length >= 100 ? 3 : 2

    // 각 그룹을 임시 wrapper에 담아 캡처 (원본 clone 훼손 없음)
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]

      const groupWrapper = document.createElement("div")
      groupWrapper.style.width = "100%"
      groupWrapper.style.background = "#ffffff"
      groupWrapper.style.display = "block"

      // 그룹 요소들을 임시 wrapper로 이동 (다시 원위치)
      const originalParents: { el: HTMLElement; nextSibling: Node | null }[] = []
      for (const el of group) {
        originalParents.push({ el, nextSibling: el.nextSibling })
        groupWrapper.appendChild(el)
      }
      clone.appendChild(groupWrapper)

      try {
        // 폰트/이미지 재로드 대기 (안전용)
        await new Promise((r) => requestAnimationFrame(() => r(null)))

        const canvas = await toCanvas(groupWrapper, {
          pixelRatio,
          backgroundColor: "#ffffff",
          cacheBust: false,
        })
        const blob = await canvasToJpegBlob(canvas, quality)
        const num = String(i + 1).padStart(pad, "0")
        await saveBlob(`${baseName}_${num}.jpg`, blob, opts.directoryHandle)
        totalBytes += blob.size
        fileCount += 1
      } finally {
        // 원래 위치로 복원
        clone.removeChild(groupWrapper)
        for (const { el, nextSibling } of originalParents) {
          if (nextSibling) clone.insertBefore(el, nextSibling)
          else clone.appendChild(el)
        }
      }

      if (i < groups.length - 1) {
        await new Promise((r) => setTimeout(r, 250))
      }
    }

    return { fileCount, totalBytes }
  } finally {
    if (wrapper.parentNode) {
      document.body.removeChild(wrapper)
    }
  }
}

function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"))
  if (imgs.length === 0) return Promise.resolve()
  return Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        img.addEventListener("load", () => resolve(), { once: true })
        img.addEventListener("error", () => resolve(), { once: true })
      })
    }),
  ).then(() => undefined)
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
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * v2.7: 저장 폴더 핸들이 있으면 그 폴더에 직접 파일 쓰기, 없으면 다운로드 폴더로.
 * File System Access API 실패(권한 취소·핸들 만료) 시 자동 다운로드 폴더 fallback.
 */
async function saveBlob(
  fileName: string,
  blob: Blob,
  dirHandle?: FileSystemDirectoryHandle,
): Promise<void> {
  if (dirHandle) {
    try {
      const fileHandle = await dirHandle.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (err) {
      console.warn("[saveBlob] directory write failed, fallback to download:", err)
    }
  }
  downloadBlob(fileName, blob)
}
