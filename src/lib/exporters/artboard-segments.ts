/**
 * v5.1: 아트보드(.fdp-print 루트) 저해상 세그먼트 캡처 — AI 자가 검수 입력용.
 *
 * 완성 아트보드를 세로로 3~5등분해 폭 512px 저해상 JPEG dataURL 배열로 만든다.
 * getAIProvider().reviewArtboard(segments, ...) 의 입력으로만 쓰이고, 아트보드/JPG
 * 결과물에는 절대 섞이지 않는다(순수 읽기·오프스크린 캡처).
 *
 * html-to-jpg.ts 의 클론·edit-chrome 제거·오프스크린 마운트·폰트/이미지 대기 패턴을
 * 그대로 답습한다. 다만 그 파일의 export(exportNodeAsSlicedJpg)는 파일 다운로드 전용이라
 * dataURL 반환에 재사용할 수 없어, 위생 규칙(clone 훼손 없음)만 새 파일에 최소 복제한다.
 * html-to-jpg.ts 자체는 수정하지 않는다.
 *
 * 어떤 실패든(노드 없음·폭 0·캔버스 실패·예외) 빈 배열을 반환한다 — 검수 흐름은
 * 절대 막지 않고 호출부가 "검수 실패"로 폴백한다.
 */

import { toCanvas } from "html-to-image"

export interface ArtboardSegment {
  /** AI에 보내는 구간 라벨 (예: "구간 1/4") */
  label: string
  /** 저해상 JPEG dataURL (data:image/jpeg;base64,...) */
  dataUrl: string
}

/** 세그먼트 목표 폭(px) — 저해상 검수용. */
const DEFAULT_WIDTH = 512
/** 세그먼트 개수 하한/상한 (3~5). */
const MIN_SEGMENTS = 3
const MAX_SEGMENTS = 5
/** 세그먼트 개수 산정용 목표 세로(자연 px) — 총 높이를 이 값으로 나눠 3~5로 클램프. */
const TARGET_BAND_NATURAL_PX = 1400
/** JPEG 품질(저해상 — 토큰 절약). */
const DEFAULT_QUALITY = 0.72

/**
 * 아트보드 루트(source)를 세로 세그먼트 dataURL 배열로 캡처.
 * @param source `.fdp-print` 루트 엘리먼트(캡처 대상).
 * @param opts.width       출력 세그먼트 목표 폭(px, 저해상 다운스케일). 기본 512.
 * @param opts.quality     JPEG 품질(0~1). 기본 0.72.
 * @param opts.layoutWidth 클론을 렌더할 레이아웃 폭(px). 다운로드 프리셋(ExportPanel)과
 *   맞추면 검수가 보는 리플로우가 실제 결과물과 일치. 미지정 시 source.offsetWidth 폴백.
 */
export async function captureArtboardSegments(
  source: HTMLElement,
  opts?: { width?: number; quality?: number; layoutWidth?: number },
): Promise<ArtboardSegment[]> {
  if (typeof window === "undefined") return []

  const targetWidth = opts?.width ?? DEFAULT_WIDTH
  const quality = opts?.quality ?? DEFAULT_QUALITY

  // 레이아웃 폭 — layoutWidth 를 주면 다운로드(ExportPanel)와 동일 절대 폭으로 리플로우를
  // 맞춰 검수-결과물 일치도를 높인다. 미지정 시 화면상 .fdp-print 자연 폭으로 폴백(구 동작).
  // 화면 축소는 조상 transform 이라 offsetWidth 는 영향받지 않는다.
  const naturalW =
    opts?.layoutWidth && opts.layoutWidth > 0
      ? Math.round(opts.layoutWidth)
      : source.offsetWidth || Math.round(source.getBoundingClientRect().width)
  if (!naturalW || naturalW <= 0) return []

  // 1) 위생 클론: 편집 전용 UI 제거 + 인라인 편집 hover 배경 중화(내보내기와 동일 규칙).
  const clone = source.cloneNode(true) as HTMLElement
  clone.querySelectorAll("[data-edit-chrome]").forEach((el) => el.remove())
  // v6.4(FIX-3): .fdp-no-print 의 display:none 은 @media print 에만 있어 html-to-image 화면 캡처엔
  // 그대로 찍힌다(신선도 위젯 new Date() 비결정 오염 포함). 편집 크롬과 동일하게 클론에서 제거.
  clone.querySelectorAll(".fdp-no-print").forEach((el) => el.remove())
  clone.querySelectorAll<HTMLElement>("[data-inline-edit]").forEach((el) => {
    el.style.background = "transparent"
  })

  const wrapper = document.createElement("div")
  wrapper.style.position = "fixed"
  wrapper.style.top = "0"
  wrapper.style.left = "0"
  wrapper.style.transform = "translateX(-200vw)"
  wrapper.style.width = `${naturalW}px`
  wrapper.style.background = "#ffffff"
  wrapper.style.pointerEvents = "none"
  clone.style.width = `${naturalW}px`
  clone.style.maxWidth = "none"
  clone.style.boxShadow = "none"
  clone.style.borderRadius = "0"
  wrapper.appendChild(clone)
  document.body.appendChild(wrapper)

  try {
    // 폰트/이미지 로드 대기 + 레이아웃 안정화 (빈 박스 캡처 방지).
    if (document.fonts?.ready) {
      await document.fonts.ready
    }
    await waitForImages(clone)
    await new Promise((r) => requestAnimationFrame(() => r(null)))

    // 자연 폭을 targetWidth 로 다운스케일하는 픽셀비 — 결과 캔버스 폭 ≈ targetWidth.
    const pixelRatio = targetWidth / naturalW
    const full = await toCanvas(clone, {
      pixelRatio,
      backgroundColor: "#ffffff",
      cacheBust: false,
    })

    const totalH = full.height
    if (totalH <= 0 || full.width <= 0) return []

    // 3~5 세그먼트 결정 — 자연 높이 기준으로 산정 후 클램프.
    const naturalH = totalH / (pixelRatio || 1)
    const rawCount = Math.round(naturalH / TARGET_BAND_NATURAL_PX)
    const count = Math.max(MIN_SEGMENTS, Math.min(MAX_SEGMENTS, rawCount || MIN_SEGMENTS))

    const bandH = Math.ceil(totalH / count)
    const segments: ArtboardSegment[] = []
    for (let i = 0; i < count; i++) {
      const y = i * bandH
      const h = Math.min(bandH, totalH - y)
      if (h <= 0) break
      const band = document.createElement("canvas")
      band.width = full.width
      band.height = h
      const ctx = band.getContext("2d")
      if (!ctx) continue
      ctx.drawImage(full, 0, y, full.width, h, 0, 0, full.width, h)
      const dataUrl = band.toDataURL("image/jpeg", quality)
      if (dataUrl && dataUrl.startsWith("data:")) {
        segments.push({ label: `구간 ${i + 1}/${count}`, dataUrl })
      }
    }
    return segments
  } catch (err) {
    console.warn("[captureArtboardSegments] failed, returning empty:", err)
    return []
  } finally {
    if (wrapper.parentNode) {
      document.body.removeChild(wrapper)
    }
  }
}

/** clone 내부 img 디코딩 대기 (한글 웹폰트/이미지 지연 시 빈 캡처 방지). */
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
