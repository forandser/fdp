/**
 * 과일 사진 특화 클라이언트 자동 보정 파이프라인 v2 (외부 API·라이브러리 비종속).
 *
 * 원본 Blob → 캔버스 픽셀 연산 → JPEG Blob.
 * 실패 시(디코드 불가·캔버스 컨텍스트 없음·toBlob null 등) 원본 blob 을 그대로 반환한다.
 * 절대 throw 로 업로드를 막지 않는다 — 보정은 "있으면 좋은" 부가 기능이기 때문.
 *
 * ── v2 개편 배경 (2026-07-07 실사용 피드백: 상주 곶감 페이지) ──
 * v1은 두 지점에서 "단색 지배 + 어두운 배경" 상품 사진을 망가뜨렸다:
 *  (a) 그레이월드 WB — 화면 평균=회색 가정이라, 주황(곶감)이 화면을 채우면
 *      과일색을 조명 색편향으로 오인해 반대색으로 밀어 워시아웃.
 *  (b) 채널별 퍼센타일 스트레치 — R/G/B 를 독립으로 늘려 색상 자체가 틀어지고,
 *      어두운 배경 사진에서 검정이 들떠 뿌옇게 됨.
 *
 * v2 원칙: **색상 보존 우선. 확신 없으면 건드리지 않는다.**
 *  1) 다운스케일 (장변 MAX_LONG_EDGE 초과 시)
 *  2) 루마(밝기) 단일 히스토그램 스트레치 — 세 채널 동일 게인 → 색상 불변.
 *     검정 비중이 큰(의도된 어두운 배경) 사진은 강도를 절반으로.
 *  3) 중립 픽셀 기반 WB — 채도 낮은 픽셀만으로 조명을 추정하고,
 *     중립 픽셀이 1.5% 미만이면(단색 지배 사진) WB 를 통째로 스킵.
 *  4) 픽셀별 소프트 니 채도 — 이미 진한 픽셀은 보호(클리핑 방지).
 *  5) 완만한 S커브 (끝점 보존)
 *  6) 언샤프 마스크 (separable box blur)
 */

// ─── 파라미터 상수 (각 값의 근거를 한 줄씩) ───────────────────────────────

/** 장변 상한(px). 아트보드 668px·export pixelRatio 2 기준 1336px면 충분 → 2200이면 여유 + 연산량 절감. */
const MAX_LONG_EDGE = 2200

/** 루마 스트레치 하단 클립(0.3%) — 극단 노이즈만 검정 기준점으로. */
const LEVELS_LOW_PCT = 0.003
/** 루마 스트레치 상단 클립(99.7%) — 하이라이트 반사만 흰 기준점으로. */
const LEVELS_HIGH_PCT = 0.997
/** 스트레치 적용 강도(0.55) — 원본 45% 유지, 과보정 방지 (v1 0.7 → 완화). */
const LEVELS_BLEND = 0.55
/** 어두운 배경 감지: 루마 20 미만 픽셀 비중이 이 값을 넘으면 의도된 어두운 배경으로 본다. */
const DARK_BG_SHARE = 0.25
/** 어두운 배경 사진의 스트레치 감쇠 계수 — 검정 들뜸(뿌연 안개) 방지. */
const DARK_BG_ATTEN = 0.5

/** WB 중립 픽셀 판정: 채도(max-min)/max 가 이 값 미만이면 중립(회색 계열). */
const WB_NEUTRAL_SAT = 0.14
/** WB 중립 픽셀 루마 범위 — 너무 어둡거나 탄 픽셀은 조명 추정에서 제외. */
const WB_NEUTRAL_LUMA_MIN = 30
const WB_NEUTRAL_LUMA_MAX = 240
/** 중립 픽셀 비중이 이 값 미만이면(단색 지배 사진) WB 스킵 — 곶감/딸기 클로즈업 보호. */
const WB_MIN_NEUTRAL_SHARE = 0.015
/** WB 보정 강도(0.35) — 중립 픽셀 기반이라 v1(0.4)보다 신뢰 높지만 여전히 보수적으로. */
const WB_STRENGTH = 0.35
/** WB 채널 게인 하한/상한 — 색틀어짐 방지 (v1 0.85~1.18 → 0.92~1.10 더 보수적). */
const WB_GAIN_MIN = 0.92
const WB_GAIN_MAX = 1.1

/** 기본 채도 부스트(0.1=10%) — v1 13%보다 완화. */
const SAT_BOOST_BASE = 0.1
/** 소프트 니 시작점: 픽셀 채도가 이 값부터 부스트가 줄기 시작. */
const SAT_KNEE_START = 0.5
/** 소프트 니 종료점: 픽셀 채도가 이 값 이상이면 부스트 0 (진한 색 보호·클리핑 방지). */
const SAT_KNEE_END = 0.9

/** S커브 강도(0.12) — 미드톤 대비만 살짝. 끝점(0·255)은 보존 (v1 0.15 → 완화). */
const SCURVE_STRENGTH = 0.12

/** 언샤프 강도(0.3) — 폰 사진 JPEG 압축 아티팩트 증폭 완화 (v1 0.35 → 완화). */
const UNSHARP_AMOUNT = 0.3
/** 언샤프 블러 반경(px) — 작게 잡아 저해상도 사진에서 링잉 억제. */
const UNSHARP_RADIUS = 2

/** 출력 JPEG 품질(0.92) — 캡처 품질과 파일크기 균형. */
const OUTPUT_QUALITY = 0.92

// ─── 공개 API ─────────────────────────────────────────────────────────────

/**
 * 이미지 Blob 을 자동 보정해 JPEG Blob 으로 반환.
 * 어떤 이유로든 실패하면 입력 blob 을 그대로 반환한다(업로드를 막지 않는다).
 */
export async function enhanceImageBlob(blob: Blob): Promise<Blob> {
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    return blob
  }
  try {
    const out = await runPipeline(blob)
    return out ?? blob
  } catch {
    return blob
  }
}

// ─── 파이프라인 ─────────────────────────────────────────────────────────────

async function runPipeline(blob: Blob): Promise<Blob | null> {
  const bitmap = await createImageBitmap(blob)
  try {
    const { width, height } = fitDimensions(bitmap.width, bitmap.height)
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, width, height)

    const imageData = ctx.getImageData(0, 0, width, height)
    const data = imageData.data // RGBA Uint8ClampedArray

    const stats = gatherStats(data)
    applyPointwise(data, stats)
    applyUnsharpMask(data, width, height)

    ctx.putImageData(imageData, 0, 0)
    return await canvasToBlob(canvas)
  } finally {
    bitmap.close()
  }
}

/** 장변이 상한을 넘으면 비율 유지 축소, 아니면 원본 크기. */
function fitDimensions(w: number, h: number): { width: number; height: number } {
  const long = Math.max(w, h)
  if (long <= MAX_LONG_EDGE) return { width: w, height: h }
  const scale = MAX_LONG_EDGE / long
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  }
}

// ─── 1패스: 통계 수집 (루마 히스토그램·중립 픽셀 조명 추정·검정 비중) ────────

interface ImageStats {
  /** 루마(Rec.709) 히스토그램 — 색상 보존형 스트레치의 기준. */
  histLuma: Uint32Array
  /** 루마 20 미만 픽셀 비중 (의도된 어두운 배경 감지). */
  darkShare: number
  /** 중립(저채도) 픽셀의 채널 평균 — WB 조명 추정. 비중 부족 시 null. */
  neutralMeans: { r: number; g: number; b: number } | null
  count: number
}

function gatherStats(data: Uint8ClampedArray): ImageStats {
  const histLuma = new Uint32Array(256)
  let darkCount = 0
  let nR = 0
  let nG = 0
  let nB = 0
  let nCount = 0
  const n = data.length
  const count = n >> 2
  for (let i = 0; i < n; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) | 0
    histLuma[luma]++
    if (luma < 20) darkCount++
    // 중립 픽셀 판정: 채도 낮고(회색 계열) 루마가 유효 범위
    const max = r > g ? (r > b ? r : b) : g > b ? g : b
    const min = r < g ? (r < b ? r : b) : g < b ? g : b
    if (
      max > 0 &&
      (max - min) / max < WB_NEUTRAL_SAT &&
      luma >= WB_NEUTRAL_LUMA_MIN &&
      luma <= WB_NEUTRAL_LUMA_MAX
    ) {
      nR += r
      nG += g
      nB += b
      nCount++
    }
  }
  const safe = count > 0 ? count : 1
  const neutralMeans =
    nCount / safe >= WB_MIN_NEUTRAL_SHARE && nCount > 0
      ? { r: nR / nCount, g: nG / nCount, b: nB / nCount }
      : null // 단색 지배 사진 → WB 스킵 (곶감 사고 재발 방지)
  return { histLuma, darkShare: darkCount / safe, neutralMeans, count }
}

/** 히스토그램에서 하단/상단 퍼센타일 경계값(0..255). */
function percentileBounds(hist: Uint32Array, count: number): { low: number; high: number } {
  const lowTarget = count * LEVELS_LOW_PCT
  const highTarget = count * LEVELS_HIGH_PCT
  let cum = 0
  let low = 0
  for (let v = 0; v < 256; v++) {
    cum += hist[v]
    if (cum >= lowTarget) {
      low = v
      break
    }
  }
  cum = 0
  let high = 255
  for (let v = 0; v < 256; v++) {
    cum += hist[v]
    if (cum >= highTarget) {
      high = v
      break
    }
  }
  return { low, high }
}

/** 중립 픽셀 평균 기반 WB 게인 — 강도·범위 제한. */
function wbGain(gray: number, mean: number): number {
  if (mean <= 0.0001) return 1
  const g = 1 + WB_STRENGTH * (gray / mean - 1)
  return g < WB_GAIN_MIN ? WB_GAIN_MIN : g > WB_GAIN_MAX ? WB_GAIN_MAX : g
}

/** S커브 LUT(0..255 → 0..255) — 끝점 보존형 큐빅. */
function buildSCurveLUT(): Float32Array {
  const lut = new Float32Array(256)
  for (let v = 0; v < 256; v++) {
    const x = v / 255
    const t = x - 0.5
    // y = 0.5 + t + S*(t - 4t^3): t=±0.5(끝점)에서 보정 0, 미드톤에서 최대.
    const y = 0.5 + t + SCURVE_STRENGTH * (t - 4 * t * t * t)
    const yc = y < 0 ? 0 : y > 1 ? 1 : y
    lut[v] = yc * 255
  }
  return lut
}

/** smoothstep(0..1) — 소프트 니 채도 롤오프용. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

function clampIndex(v: number): number {
  const c = v < 0 ? 0 : v > 255 ? 255 : v
  return c | 0
}

// ─── 2패스: pointwise (루마 스트레치 → WB → 소프트 니 채도 → S커브) ─────────

function applyPointwise(data: Uint8ClampedArray, stats: ImageStats): void {
  // 1) 루마 단일 스트레치 계수 — 세 채널에 동일 적용(색상 불변).
  const { low, high } = percentileBounds(stats.histLuma, stats.count)
  const span = high - low
  // 어두운 배경(검정 비중 큼) 사진은 스트레치를 절반으로 — 검정 들뜸 방지.
  const blend =
    stats.darkShare >= DARK_BG_SHARE ? LEVELS_BLEND * DARK_BG_ATTEN : LEVELS_BLEND
  // v' = v*(1-blend) + stretch(v)*blend = v * [1 - blend + blend*255/span] - blend*255*low/span
  // (span<=0 이면 평탄 이미지 — 스트레치 생략)
  const gain = span > 0 ? 1 - blend + (blend * 255) / span : 1
  const offset = span > 0 ? (-blend * 255 * low) / span : 0

  // 2) WB 게인 — 중립 픽셀 기반. 추정 불가(단색 지배)면 1.0 고정.
  let wbR = 1
  let wbG = 1
  let wbB = 1
  if (stats.neutralMeans) {
    const { r, g, b } = stats.neutralMeans
    const gray = (r + g + b) / 3
    wbR = wbGain(gray, r)
    wbG = wbGain(gray, g)
    wbB = wbGain(gray, b)
  }

  const scurve = buildSCurveLUT()
  const n = data.length
  for (let i = 0; i < n; i += 4) {
    // 1) 루마 스트레치 (동일 게인 → 색상 보존) + 2) WB
    let r = (data[i] * gain + offset) * wbR
    let g = (data[i + 1] * gain + offset) * wbG
    let b = (data[i + 2] * gain + offset) * wbB
    // 3) 소프트 니 채도 — 픽셀 채도에 따라 부스트를 줄인다(진한 색 보호).
    const max = r > g ? (r > b ? r : b) : g > b ? g : b
    const min = r < g ? (r < b ? r : b) : g < b ? g : b
    const sat = max > 1 ? (max - min) / max : 0
    const boost = SAT_BOOST_BASE * (1 - smoothstep(SAT_KNEE_START, SAT_KNEE_END, sat))
    const satFactor = 1 + boost
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    r = luma + satFactor * (r - luma)
    g = luma + satFactor * (g - luma)
    b = luma + satFactor * (b - luma)
    // 4) S커브 (LUT 인덱스는 0..255 클램프)
    data[i] = scurve[clampIndex(r)]
    data[i + 1] = scurve[clampIndex(g)]
    data[i + 2] = scurve[clampIndex(b)]
    // 알파(i+3)는 손대지 않는다.
  }
}

// ─── 3패스: 언샤프 마스크 (separable box blur) ──────────────────────────────

function applyUnsharpMask(data: Uint8ClampedArray, width: number, height: number): void {
  const n = width * height
  if (n === 0) return
  const tmp = new Float32Array(n * 3) // 수평 블러 결과 (RGB packed)
  const blur = new Float32Array(n * 3) // 수평→수직 블러 결과
  boxBlurH(data, tmp, width, height, UNSHARP_RADIUS)
  boxBlurV(tmp, blur, width, height, UNSHARP_RADIUS)
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const b3 = p * 3
    // out = v + amount * (v - blur): 원본에서 저주파(블러)를 빼 윤곽 성분만 가산.
    data[i] = data[i] + UNSHARP_AMOUNT * (data[i] - blur[b3])
    data[i + 1] = data[i + 1] + UNSHARP_AMOUNT * (data[i + 1] - blur[b3 + 1])
    data[i + 2] = data[i + 2] + UNSHARP_AMOUNT * (data[i + 2] - blur[b3 + 2])
  }
}

/** 경계 복제 좌표 클램프. */
function clampCoord(v: number, size: number): number {
  return v < 0 ? 0 : v >= size ? size - 1 : v
}

/** 수평 박스 블러 (running-sum, O(n) — 반경 무관). src=RGBA, dst=RGB packed. */
function boxBlurH(
  src: Uint8ClampedArray,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  const win = radius * 2 + 1
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        sum += src[(row + clampCoord(k, width)) * 4 + c]
      }
      for (let x = 0; x < width; x++) {
        dst[(row + x) * 3 + c] = sum / win
        const outX = clampCoord(x - radius, width)
        const inX = clampCoord(x + radius + 1, width)
        sum += src[(row + inX) * 4 + c] - src[(row + outX) * 4 + c]
      }
    }
  }
}

/** 수직 박스 블러 (running-sum). src=RGB packed, dst=RGB packed. */
function boxBlurV(
  src: Float32Array,
  dst: Float32Array,
  width: number,
  height: number,
  radius: number,
): void {
  const win = radius * 2 + 1
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0
      for (let k = -radius; k <= radius; k++) {
        sum += src[(clampCoord(k, height) * width + x) * 3 + c]
      }
      for (let y = 0; y < height; y++) {
        dst[(y * width + x) * 3 + c] = sum / win
        const outY = clampCoord(y - radius, height)
        const inY = clampCoord(y + radius + 1, height)
        sum += src[(inY * width + x) * 3 + c] - src[(outY * width + x) * 3 + c]
      }
    }
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", OUTPUT_QUALITY)
  })
}
