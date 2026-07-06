/**
 * 과일 사진 특화 클라이언트 자동 보정 파이프라인 (외부 API·라이브러리 비종속).
 *
 * 원본 Blob → 캔버스 픽셀 연산 6단계 → JPEG Blob.
 * 실패 시(디코드 불가·캔버스 컨텍스트 없음·toBlob null 등) 원본 blob 을 그대로 반환한다.
 * 절대 throw 로 업로드를 막지 않는다 — 보정은 "있으면 좋은" 부가 기능이기 때문.
 *
 * 파이프라인:
 *   1) 다운스케일 (장변 MAX_LONG_EDGE 초과 시) — 처리속도·메모리 확보.
 *   2) 퍼센타일 오토 레벨 — 채널별 클립 스트레치 후 원본과 블렌드(과보정 방지).
 *   3) 그레이월드 화이트밸런스 — 형광등/그늘 색편향 완화, 과일 고유색 보존.
 *   4) 채도 부스트 — luma 기준 mix, 이미 고채도면 자동 감쇠.
 *   5) 완만한 S커브 — 미드톤 대비 강화(끝점 보존).
 *   6) 언샤프 마스크 — separable box blur 기반, 저해상도 과샤픈 방지.
 *
 * 2)~5) 는 픽셀 단위 pointwise 연산이라 채널 LUT 로 접어 단일 루프로 처리한다.
 */

// ─── 파라미터 상수 (각 값의 근거를 한 줄씩) ───────────────────────────────

/** 장변 상한(px). 아트보드 668px·export pixelRatio 2 기준 1336px면 충분 → 2200이면 여유 + 연산량 절감. */
const MAX_LONG_EDGE = 2200

/** 오토 레벨 하단 클립 비율(0.4%) — 극단 노이즈 화소를 검정 기준점으로. */
const LEVELS_LOW_PCT = 0.004
/** 오토 레벨 상단 클립 비율(99.6%) — 하이라이트 반사를 흰 기준점으로. */
const LEVELS_HIGH_PCT = 0.996
/** 스트레치 적용 강도(0.7) — 원본 30% 남겨 클리핑·색끊김 등 과보정 방지. */
const LEVELS_BLEND = 0.7

/** 그레이월드 보정 강도(0.4=40%) — 색편향은 줄이되 과일 고유색(빨강·주황)은 살린다. */
const WB_STRENGTH = 0.4
/** WB 채널 게인 하한 — 한 채널만 과도하게 눌리는 색틀어짐 방지. */
const WB_GAIN_MIN = 0.85
/** WB 채널 게인 상한 — 특정 채널 과증폭(형광 색번짐) 방지. */
const WB_GAIN_MAX = 1.18

/** 기본 채도 부스트(0.13=13%) — 신선식품 발색을 살짝만 올린다. */
const SAT_BOOST_BASE = 0.13
/** 감쇠 시작 평균채도 — 이 이하는 부스트 100% 적용. */
const SAT_LOW = 0.12
/** 감쇠 종료 평균채도 — 이 이상이면 부스트를 바닥값까지 줄인다(원색 사진 과채도 방지). */
const SAT_HIGH = 0.32
/** 감쇠 바닥 계수 — 고채도 사진도 최소한의 부스트는 유지. */
const SAT_ATTEN_FLOOR = 0.35

/** S커브 강도(0.15) — 미드톤 대비만 살짝. 끝점(0·255)은 보존해 하이라이트/그림자 안전. */
const SCURVE_STRENGTH = 0.15

/** 언샤프 강도(0.35) — 과샤픈(노이즈·후광) 없이 윤곽만 또렷. */
const UNSHARP_AMOUNT = 0.35
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

// ─── 1패스: 통계 수집 (히스토그램·채널 평균·평균 채도) ──────────────────────

interface ImageStats {
  histR: Uint32Array
  histG: Uint32Array
  histB: Uint32Array
  meanR: number
  meanG: number
  meanB: number
  /** 평균 채도 0..1 (채널 max-min 평균). */
  avgSat: number
  count: number
}

function gatherStats(data: Uint8ClampedArray): ImageStats {
  const histR = new Uint32Array(256)
  const histG = new Uint32Array(256)
  const histB = new Uint32Array(256)
  let sumR = 0
  let sumG = 0
  let sumB = 0
  let satSum = 0
  const n = data.length
  const count = n >> 2
  for (let i = 0; i < n; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    histR[r]++
    histG[g]++
    histB[b]++
    sumR += r
    sumG += g
    sumB += b
    const max = r > g ? (r > b ? r : b) : g > b ? g : b
    const min = r < g ? (r < b ? r : b) : g < b ? g : b
    satSum += max - min
  }
  const safe = count > 0 ? count : 1
  return {
    histR,
    histG,
    histB,
    meanR: sumR / safe,
    meanG: sumG / safe,
    meanB: sumB / safe,
    avgSat: satSum / (safe * 255),
    count,
  }
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

/** 그레이월드 채널 게인 — gray 목표 대비 채널 평균으로 산출 후 강도·범위 제한. */
function wbGain(gray: number, mean: number): number {
  if (mean <= 0.0001) return 1
  const g = 1 + WB_STRENGTH * (gray / mean - 1)
  return g < WB_GAIN_MIN ? WB_GAIN_MIN : g > WB_GAIN_MAX ? WB_GAIN_MAX : g
}

/**
 * 채널 LUT(입력 0..255 → 출력 float): 오토 레벨(블렌드) + 화이트밸런스 게인을 접어 둔다.
 * 채도·S커브는 채널 간 결합이라 여기서 접지 않고 pointwise 루프에서 처리.
 */
function buildChannelLUT(
  hist: Uint32Array,
  count: number,
  mean: number,
  gray: number,
): Float32Array {
  const { low, high } = percentileBounds(hist, count)
  const span = high - low
  const gain = wbGain(gray, mean)
  const lut = new Float32Array(256)
  for (let v = 0; v < 256; v++) {
    let stretched: number
    if (span > 0) {
      const s = ((v - low) / span) * 255
      stretched = s < 0 ? 0 : s > 255 ? 255 : s
    } else {
      stretched = v // 평탄 채널은 스트레치 생략(0으로 나눔 방지).
    }
    const leveled = v * (1 - LEVELS_BLEND) + stretched * LEVELS_BLEND
    lut[v] = leveled * gain
  }
  return lut
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

/** 평균 채도가 높을수록 부스트 감쇠. */
function computeSatFactor(avgSat: number): number {
  let atten = (SAT_HIGH - avgSat) / (SAT_HIGH - SAT_LOW)
  if (atten > 1) atten = 1
  if (atten < SAT_ATTEN_FLOOR) atten = SAT_ATTEN_FLOOR
  return 1 + SAT_BOOST_BASE * atten
}

function clampIndex(v: number): number {
  const c = v < 0 ? 0 : v > 255 ? 255 : v
  return c | 0
}

// ─── 2패스: pointwise (레벨+WB LUT → 채도 → S커브) ──────────────────────────

function applyPointwise(data: Uint8ClampedArray, stats: ImageStats): void {
  const gray = (stats.meanR + stats.meanG + stats.meanB) / 3
  const lutR = buildChannelLUT(stats.histR, stats.count, stats.meanR, gray)
  const lutG = buildChannelLUT(stats.histG, stats.count, stats.meanG, gray)
  const lutB = buildChannelLUT(stats.histB, stats.count, stats.meanB, gray)
  const scurve = buildSCurveLUT()
  const satFactor = computeSatFactor(stats.avgSat)
  const n = data.length
  for (let i = 0; i < n; i += 4) {
    // 1) 레벨 + 화이트밸런스 (채널 LUT)
    let r = lutR[data[i]]
    let g = lutG[data[i + 1]]
    let b = lutB[data[i + 2]]
    // 2) 채도 — luma 기준 mix (Rec.709)
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    r = luma + satFactor * (r - luma)
    g = luma + satFactor * (g - luma)
    b = luma + satFactor * (b - luma)
    // 3) S커브 (LUT 인덱스는 0..255 클램프)
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
