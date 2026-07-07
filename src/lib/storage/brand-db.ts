/**
 * v5.0-A: 브랜드 프로필 영구 저장소.
 *
 * - works-db 와 동일한 idb-keyval 스토어 패턴. 단일 키(STORAGE_KEYS.BRANDS_DB) 아래에
 *   { [brandId]: BrandProfile } 형태의 맵을 저장한다. 기본 브랜드 id 는 별도 키
 *   (STORAGE_KEYS.BRAND_DEFAULT)에 문자열로 보관.
 * - 로고 원본은 Blob 으로 보관(직렬화 가능). 아트보드/스냅샷에는 다운스케일 dataURL 로만 나간다.
 * - 컴포넌트/SDK 가 idb-keyval 을 직접 만지지 않도록 이 모듈로만 접근.
 *
 * BrandSnapshot 은 works-db(Work.brandSnapshot)·ResultView(props)로 흘러가는 "박제" 형태다.
 * Work 저장 시점의 브랜드 상태를 고정해, 이후 브랜드 편집/삭제와 무관하게 그 작업물은
 * 만들 때 본 로고·색·서명으로 재현된다. 로고는 dataURL(외부 URL 금지, canvas 오염 방지).
 */

import { get, set, del } from "idb-keyval"
import { STORAGE_KEYS } from "./keys"

/** 저장되는 브랜드 프로필(로고는 원본 Blob 보관). */
export interface BrandProfile {
  id: string
  name: string
  /** 로고 원본 Blob. 없으면 null/undefined(하위호환). */
  logoBlob?: Blob | null
  /** 브랜드 색(#hex — #RGB/#RRGGBB). 검증 통과분만 저장. */
  color?: string
  /** 서명/한 줄 소개(≤80자). */
  signature?: string
  /** 연락처/채널(≤60자). */
  contact?: string
  createdAt: number
  updatedAt: number
}

/**
 * Work·ResultView 로 넘어가는 박제 스냅샷. 로고는 다운스케일 dataURL(≤256px, JPEG)로,
 * 외부 URL 없이 아트보드 캡처(html-to-image)가 그대로 그릴 수 있는 형태.
 */
export interface BrandSnapshot {
  name: string
  logoDataUrl?: string
  color?: string
  signature?: string
  contact?: string
}

// 문자열 필드 상한(스냅샷·아트보드 오버플로우 방지). import/save 공통.
const NAME_MAX = 30
const SIGNATURE_MAX = 80
const CONTACT_MAX = 60

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * 프로토타입 오염 가드 — ai/validate.ts(FORBIDDEN_KEYS)와 동일 목록. import 경계에서 신뢰 없는
 * rec.id 를 브랜드 맵 키로 대입하기 전에 차단한다. 정상 export 는 newBrandId("b_...")만 쓰므로
 * 수기 편집/손상된 백업 대비. (map["__proto__"]=obj 는 own 키가 되지 못하고 writeMap 의 structured
 * clone 에서 소실돼, 실제 저장 없이 imported 만 증가하는 과대 보고를 유발한다.)
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
])

/** 문자열 필드 정규화 — 비문자열/공백뿐이면 undefined, 그 외 trim 후 max 절삭. */
function clampStr(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (t.length === 0) return undefined
  return t.length > max ? t.slice(0, max) : t
}

/** #hex 색 검증 — 통과하면 그대로, 아니면 undefined(드롭). */
function normalizeColor(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim()
  return HEX_COLOR_RE.test(t) ? t : undefined
}

type BrandsMap = Record<string, BrandProfile>

async function readMap(): Promise<BrandsMap> {
  const raw = await get<BrandsMap>(STORAGE_KEYS.BRANDS_DB)
  return raw ?? {}
}

async function writeMap(map: BrandsMap): Promise<void> {
  await set(STORAGE_KEYS.BRANDS_DB, map)
}

/** 신규 brand id — works-db.newWorkId 패턴(시간 기반 + 랜덤 접미사), 접두사만 b_. */
export function newBrandId(): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `b_${t}_${r}`
}

/** 목록 — 전체 프로필(로고 Blob 포함), 최근 수정순. */
export async function listBrands(): Promise<BrandProfile[]> {
  const map = await readMap()
  const items = Object.values(map)
  items.sort((a, b) => b.updatedAt - a.updatedAt)
  return items
}

/**
 * 단일 브랜드 저장(upsert). 문자열 필드는 저장 경계에서 정규화(길이 절삭·색 검증)해
 * 아트보드로 500자 이름 같은 게 흘러가지 못하게 방어한다. 같은 id 재저장 시 createdAt 보존.
 */
export async function saveBrand(p: BrandProfile): Promise<void> {
  const map = await readMap()
  const prevCreatedAt = map[p.id]?.createdAt
  const now = Date.now()
  map[p.id] = {
    id: p.id,
    name: clampStr(p.name, NAME_MAX) ?? "",
    logoBlob: p.logoBlob ?? null,
    color: normalizeColor(p.color),
    signature: clampStr(p.signature, SIGNATURE_MAX),
    contact: clampStr(p.contact, CONTACT_MAX),
    createdAt: prevCreatedAt ?? (p.createdAt > 0 ? p.createdAt : now),
    updatedAt: p.updatedAt > 0 ? p.updatedAt : now,
  }
  await writeMap(map)
}

/** 단건 삭제. 삭제 대상이 기본 브랜드였으면 기본값도 함께 해제. */
export async function deleteBrand(id: string): Promise<void> {
  const map = await readMap()
  if (!(id in map)) return
  delete map[id]
  await writeMap(map)
  const def = await get<string>(STORAGE_KEYS.BRAND_DEFAULT)
  if (def === id) await del(STORAGE_KEYS.BRAND_DEFAULT)
}

/**
 * 기본 브랜드 id 조회. 저장된 id 가 실재하지 않는 브랜드를 가리키면(삭제 후 잔재 등)
 * null 을 돌려준다(방어적 존재성 검증).
 */
export async function getDefaultBrandId(): Promise<string | null> {
  const raw = await get<string>(STORAGE_KEYS.BRAND_DEFAULT)
  if (typeof raw !== "string" || raw.length === 0) return null
  const map = await readMap()
  return map[raw] ? raw : null
}

/** 기본 브랜드 id 설정. null 이면 해제. */
export async function setDefaultBrandId(id: string | null): Promise<void> {
  if (id === null) {
    await del(STORAGE_KEYS.BRAND_DEFAULT)
    return
  }
  await set(STORAGE_KEYS.BRAND_DEFAULT, id)
}

/**
 * 로고 Blob → 장변 256px dataURL(JPEG 0.85). works-db.makeThumbDataUrl 패턴.
 * JPEG 는 알파를 못 담으므로 투명 로고(PNG)가 검게 나오지 않도록 흰 배경을 먼저 깐다.
 * SSR/실패/래스터화 불가(SVG 등) 시 null(스냅샷에서 로고 생략).
 */
async function makeLogoDataUrl(blob: Blob, maxSize = 256): Promise<string | null> {
  if (typeof window === "undefined") return null
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) {
      bitmap.close()
      return null
    }
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return canvas.toDataURL("image/jpeg", 0.85)
  } catch {
    return null
  }
}

/**
 * 프로필 → 박제 스냅샷. 로고 Blob 은 ≤256px dataURL 로 다운스케일(없거나 실패 시 생략).
 * 문자열 필드는 스냅샷 생성 시점에도 정규화(저장본이 구버전/미정규화여도 안전).
 */
export async function toSnapshot(p: BrandProfile): Promise<BrandSnapshot> {
  const snap: BrandSnapshot = { name: clampStr(p.name, NAME_MAX) ?? "" }
  const color = normalizeColor(p.color)
  if (color) snap.color = color
  const signature = clampStr(p.signature, SIGNATURE_MAX)
  if (signature) snap.signature = signature
  const contact = clampStr(p.contact, CONTACT_MAX)
  if (contact) snap.contact = contact
  if (p.logoBlob) {
    const dataUrl = await makeLogoDataUrl(p.logoBlob)
    if (dataUrl) snap.logoDataUrl = dataUrl
  }
  return snap
}

// ── 백업(JSON) ─────────────────────────────────────────────────────────────
// works-db 의 WorkBackup 패턴을 답습: format 문자열 + version. 로고는 base64 dataURL 로 실어
// 파일 하나로 브라우저 간 이동 가능.

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") {
      reject(new Error("FileReader unavailable"))
      return
    }
    const r = new FileReader()
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "")
    r.onerror = () => reject(r.error ?? new Error("read failed"))
    r.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return await res.blob()
}

export interface BrandBackupItem {
  id: string
  name: string
  /** 로고 base64(dataURL). 없으면 생략/null. */
  logoBase64?: string | null
  color?: string
  signature?: string
  contact?: string
  createdAt: number
  updatedAt: number
}

export interface BrandBackup {
  format: "fdp-brands"
  version: 1
  exportedAt: number
  brands: BrandBackupItem[]
  /** 내보낼 당시 기본 브랜드 id(복원 시 비파괴적으로만 반영). */
  defaultId?: string | null
}

/** 모든 브랜드를 JSON 으로 직렬화(로고 base64 포함). 반환은 그대로 파일로 저장 가능. */
export async function exportBrandsToJson(): Promise<BrandBackup> {
  const map = await readMap()
  const items: BrandBackupItem[] = []
  for (const b of Object.values(map)) {
    let logoBase64: string | null = null
    if (b.logoBlob) {
      try {
        logoBase64 = await blobToDataUrl(b.logoBlob)
      } catch {
        logoBase64 = null
      }
    }
    items.push({
      id: b.id,
      name: b.name,
      logoBase64,
      color: b.color,
      signature: b.signature,
      contact: b.contact,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    })
  }
  const defaultId = await getDefaultBrandId()
  return {
    format: "fdp-brands",
    version: 1,
    exportedAt: Date.now(),
    brands: items,
    defaultId,
  }
}

/**
 * 백업 JSON 을 병합 복원(비파괴 — 기존 브랜드 유지, 같은 id 는 갱신).
 * - 신뢰 없는 외부 입력: 항목마다 name(필수, ≤30자) 검증, 색은 #hex 만, signature/contact 는
 *   문자열만 절삭. 로고는 data: URL 인 base64 만 통과(외부 URL 차단). 형태 불량 항목은 skip.
 * - id 가 없으면 새로 발급(수기 편집 JSON 대비). 정상 백업은 id 를 실어 재-import 가 멱등.
 * - defaultId 는 현재 기본이 미설정이고 그 id 가 방금 병합된 경우에만 설정(비파괴).
 */
export async function importBrandsJson(
  raw: unknown,
): Promise<{ imported: number; skipped: number }> {
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as { format?: unknown }).format !== "fdp-brands"
  ) {
    throw new Error("INVALID_BRANDS_BACKUP")
  }
  const brandsRaw = (raw as { brands?: unknown }).brands
  if (!Array.isArray(brandsRaw)) throw new Error("INVALID_BRANDS")
  const map = await readMap()
  let imported = 0
  let skipped = 0
  for (const entry of brandsRaw as unknown[]) {
    if (!entry || typeof entry !== "object") {
      skipped++
      continue
    }
    const rec = entry as Record<string, unknown>
    const name = clampStr(rec.name, NAME_MAX)
    if (!name) {
      skipped++
      continue
    }
    const id =
      typeof rec.id === "string" && rec.id.length > 0 ? rec.id : newBrandId()
    // 프로토타입 오염 가드 — 신뢰 없는 id 를 맵 키로 대입하기 전 차단(validate.ts 와 동일 목록).
    if (FORBIDDEN_KEYS.has(id)) {
      skipped++
      continue
    }
    try {
      let logoBlob: Blob | null = null
      if (
        typeof rec.logoBase64 === "string" &&
        rec.logoBase64.startsWith("data:")
      ) {
        logoBlob = await dataUrlToBlob(rec.logoBase64)
      }
      map[id] = {
        id,
        name,
        logoBlob,
        color: normalizeColor(rec.color),
        signature: clampStr(rec.signature, SIGNATURE_MAX),
        contact: clampStr(rec.contact, CONTACT_MAX),
        createdAt: typeof rec.createdAt === "number" ? rec.createdAt : Date.now(),
        updatedAt: typeof rec.updatedAt === "number" ? rec.updatedAt : Date.now(),
      }
      imported++
    } catch {
      skipped++
    }
  }
  await writeMap(map)
  const defRaw = (raw as { defaultId?: unknown }).defaultId
  // FORBIDDEN_KEYS.has 가드 — "__proto__" 등은 map[defRaw] 가 상속 accessor 로 truthy 라
  // 존재하지도 않는 브랜드를 기본값으로 박제할 수 있어 명시적으로 배제.
  if (typeof defRaw === "string" && !FORBIDDEN_KEYS.has(defRaw) && map[defRaw]) {
    const cur = await getDefaultBrandId()
    if (!cur) await setDefaultBrandId(defRaw)
  }
  return { imported, skipped }
}
