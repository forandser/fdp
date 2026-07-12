/**
 * 작업물(상세페이지 입력 + 결과 카피 + 이미지) 영구 저장소.
 *
 * - idb-keyval 사용. 단일 키(STORAGE_KEYS.WORKS_DB) 아래에
 *   { [workId]: Work } 형태의 Map처럼 객체를 저장한다.
 * - 이미지 원본은 Blob 배열로 보관(직렬화 가능). 썸네일은 dataURL로 별도 보관해
 *   목록 화면에서 즉시 표시.
 * - SDK·컴포넌트가 직접 idb-keyval을 만지지 않도록 이 모듈로만 접근.
 */

import { get, set } from "idb-keyval"
import { STORAGE_KEYS } from "./keys"
import type { CopyInput, CopyOutput, PhotoAnalysisItem } from "@/lib/ai/types"
import { validatePhotoAnalysis } from "@/lib/ai/validate"
import type { BrandSnapshot } from "./brand-db"

export interface Work {
  id: string
  createdAt: number
  updatedAt: number
  productName: string
  /** 목록 그리드에서 보여줄 작은 썸네일(dataURL). 없으면 null. */
  thumbDataUrl: string | null
  input: CopyInput
  copy: CopyOutput | null
  /** 원본 이미지 Blob 배열(IndexedDB가 Blob 직렬화를 지원). */
  imageBlobs: Blob[]
  /**
   * v4.4: 업로드 이미지 id 목록(imageBlobs 와 같은 순서·길이). 복원 시 이 id 를 그대로
   * 되살려 photoAnalysis[].imageId 와 정합을 맞춘다 — 재분석 캐시(photoAnalysisMatchesImages)·
   * ResultView 배치(planImages)·갤러리 캡션이 재로딩 후에도 매칭되게 한다.
   * 구버전 저장본엔 없음(옵셔널) — undefined면 복원 시 새 id 를 부여하고 photoAnalysis 는
   * 순서 기반 폴백으로 동작(하위호환).
   */
  imageIds?: string[]
  /**
   * v3.7: 포장 전용 슬롯 사진(PackagingBlock "이렇게 배송되어요"). 일반 풀과 분리 저장.
   * 구버전 저장본엔 없음(옵셔널 — 하위호환). 없거나 null이면 포장 섹션 미노출.
   */
  packagingBlob?: Blob | null
  /**
   * v3.7: 크기 비교 전용 슬롯 사진(손·동전·자와 함께). 일반 풀과 분리 저장.
   * 구버전 저장본엔 없음(옵셔널 — 하위호환). 없거나 null이면 크기 섹션은 무게 데이터만.
   */
  sizeBlob?: Blob | null
  /**
   * 사진 자동 보정 토글 상태. 저장은 항상 원본 blob이므로 이 값은 "표시/내보내기 시 보정 적용 여부"만 뜻한다.
   * 구버전 저장본엔 없음(옵셔널) — undefined면 기본 ON(true)으로 복원(하위호환).
   */
  enhanceImages?: boolean
  /**
   * v4.4: 사진 분석 결과(역할·대표컷 점수·품질 플래그·"보이는 것" 메모). 생성 시 AI가 채운다.
   * 같은 사진으로 재생성할 때 재분석을 건너뛰는 캐시로도 쓰인다(imageId 집합 일치 시).
   * 구버전 저장본엔 없음(옵셔널) — undefined면 ResultView가 순서 기반 로직으로 폴백.
   */
  photoAnalysis?: PhotoAnalysisItem[]
  /**
   * v4.4: 사진 분석 토글 상태. 구버전 저장본엔 없음(옵셔널) — undefined면 기본 ON(true, 하위호환).
   */
  photoAnalysisEnabled?: boolean
  /**
   * v4.6: 레이아웃 무드 변주(디자인 토큰만 다름 — 섹션 순서·게이팅·카피 불변).
   * 구버전 저장본엔 없음(옵셔널) — undefined면 복원 시 "standard"로 폴백(기존 렌더와
   * 픽셀 동일, 하위호환). 저장/복원/백업 모두 이 값을 라운드트립한다.
   */
  layoutVariant?: "standard" | "soft" | "editorial"
  /**
   * v5.0: 이 작업물을 만들 때 적용한 브랜드의 박제 스냅샷(로고 dataURL·색·서명 등).
   * 브랜드 저장소(brand-db)의 프로필을 toSnapshot 으로 고정한 값 — 이후 브랜드가
   * 편집·삭제돼도 이 작업물은 만들 때 본 브랜딩으로 재현된다. ResultView 로 그대로 넘어간다.
   * 구버전 저장본엔 없음(옵셔널 — 하위호환). 없으면 브랜드 요소 미노출.
   */
  brandSnapshot?: BrandSnapshot
  /**
   * v6.1(작업E2): 셀러가 "숨기기"한 섹션의 안정 id 목록(예: "faq", "recommendFor").
   * 렌더 시 이 목록의 섹션을 트리에서 완전히 제거한다(JPG·총높이에서 소멸).
   * 카피가 아니라 "편집 상태"이므로 copy 와 분리해 Work 최상위에 둔다 —
   * 전체 재생성(copy 통째 교체)에도 살아남아 "재생성해도 숨김 유지"를 충족한다.
   * 구버전 저장본엔 없음(옵셔널 — 하위호환). 없거나 빈 배열이면 전 섹션 노출(기존 렌더와 동일).
   */
  hiddenSections?: string[]
  /**
   * v6.3(작업3): AI 타이포 히어로 — 확정 헤드라인을 Gemini(나노바나나)로 그린 한글 레터링
   * 이미지(블롭). 있으면 HeroBlock 이 기존 텍스트 헤드라인 자리에 이미지로 렌더한다(같은 슬롯).
   * 없거나 null 이면 현행 텍스트 헤드라인(회귀 0). imageBlobs 와 같은 Blob 영속 패턴.
   * 구버전 저장본엔 없음(옵셔널 — 하위호환). ⚠️ 셀러 사진이 아니라 "글씨만" 생성한 결과물.
   */
  typoHeadlineBlob?: Blob | null
}

export interface WorkSummary {
  id: string
  createdAt: number
  updatedAt: number
  productName: string
  thumbDataUrl: string | null
}

type WorksMap = Record<string, Work>

async function readMap(): Promise<WorksMap> {
  const raw = await get<WorksMap>(STORAGE_KEYS.WORKS_DB)
  return raw ?? {}
}

async function writeMap(map: WorksMap): Promise<void> {
  await set(STORAGE_KEYS.WORKS_DB, map)
}

/** 신규 work id 생성 — 시간 기반 + 랜덤 접미사. */
export function newWorkId(): string {
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 8)
  return `w_${t}_${r}`
}

/** 단일 work 저장(upsert). updatedAt은 호출자가 채우거나 여기서 자동 갱신. */
export async function saveWork(work: Work): Promise<void> {
  const map = await readMap()
  // 같은 id 재저장(인라인 편집·변주 변경 등) 시 원본 생성시각 보존 —
  // 호출부들이 createdAt: Date.now()로 Work를 재구성해도 목록 정렬이 안 흔들리게.
  const prevCreatedAt = map[work.id]?.createdAt
  map[work.id] = {
    ...work,
    createdAt: prevCreatedAt ?? work.createdAt,
    updatedAt: work.updatedAt > 0 ? work.updatedAt : Date.now(),
  }
  await writeMap(map)
}

/** 목록 — 무거운 imageBlobs/copy/input은 제외, 최신순 정렬. */
export async function listWorks(): Promise<WorkSummary[]> {
  const map = await readMap()
  const items: WorkSummary[] = Object.values(map).map((w) => ({
    id: w.id,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
    productName: w.productName,
    thumbDataUrl: w.thumbDataUrl,
  }))
  items.sort((a, b) => b.updatedAt - a.updatedAt)
  return items
}

/** 단건 조회 — 편집 화면 진입 시 호출. */
export async function getWork(id: string): Promise<Work | null> {
  const map = await readMap()
  return map[id] ?? null
}

/**
 * v5.4(작업5): 가장 최근(updatedAt 기준) 작업 전체를 반환 — "지난 설정 이어받기"의 원천.
 * 목록(listWorks)은 요약만 주므로, 가게 공통 필드(농부·산지·연차)를 읽으려면 전체가 필요하다.
 */
export async function getLatestWork(): Promise<Work | null> {
  const map = await readMap()
  let latest: Work | null = null
  for (const w of Object.values(map)) {
    if (!latest || w.updatedAt > latest.updatedAt) latest = w
  }
  return latest
}

/** 단건 삭제. */
export async function deleteWork(id: string): Promise<void> {
  const map = await readMap()
  if (!(id in map)) return
  delete map[id]
  await writeMap(map)
}

/**
 * 모든 작업물을 JSON으로 직렬화 (백업).
 * - imageBlobs는 base64 dataURL 배열로 인코딩 (JSON 안전).
 * - 파일이 매우 크면 결과 문자열도 크다 (수십 MB 가능). 사용자가 직접 저장 위치 선택.
 */
export interface WorkBackupItem {
  id: string
  createdAt: number
  updatedAt: number
  productName: string
  thumbDataUrl: string | null
  input: CopyInput
  copy: CopyOutput | null
  imagesBase64: string[]
  /**
   * v4.4: 업로드 이미지 id 목록(imagesBase64 와 같은 순서). 복원 시 photoAnalysis 와
   * 정합을 맞추기 위해 백업에도 함께 실어 라운드트립한다. 구버전 백업엔 없음(하위호환).
   */
  imageIds?: string[]
  /** v3.7: 포장 전용 슬롯 사진 base64(dataURL). 없으면 생략(하위호환). */
  packagingBase64?: string | null
  /** v3.7: 크기 비교 전용 슬롯 사진 base64(dataURL). 없으면 생략(하위호환). */
  sizeBase64?: string | null
  /** 사진 자동 보정 토글 상태. 없으면 기본 ON(하위호환). */
  enhanceImages?: boolean
  /** v4.4: 사진 분석 결과. 없으면 생략(하위호환). */
  photoAnalysis?: PhotoAnalysisItem[]
  /** v4.4: 사진 분석 토글 상태. 없으면 기본 ON(하위호환). */
  photoAnalysisEnabled?: boolean
  /** v4.6: 레이아웃 변주. 없으면 생략(하위호환 — 로드 시 standard). */
  layoutVariant?: "standard" | "soft" | "editorial"
  /** v5.0: 브랜드 박제 스냅샷. 없으면 생략(하위호환). */
  brandSnapshot?: BrandSnapshot
  /** v6.1(작업E2): 숨긴 섹션 id 목록. 없으면 생략(하위호환 — 로드 시 전 섹션 노출). */
  hiddenSections?: string[]
  /** v6.3(작업3): 타이포 헤드라인 이미지 base64(dataURL). 없으면 생략(하위호환). */
  typoHeadlineBase64?: string | null
}
export interface WorkBackup {
  format: "fdp-backup"
  version: 1
  exportedAt: number
  works: WorkBackupItem[]
}

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
  // 일부 환경의 fetch가 data URL을 지원 → 가장 간단
  const res = await fetch(dataUrl)
  return await res.blob()
}

/**
 * v5.0: 백업 복원 시 브랜드 스냅샷 형태 검증(신뢰 없는 외부 입력) — 비문자열 필드는 드롭.
 * - name 이 문자열이 아니거나 공백뿐이면 스냅샷 자체를 undefined(브랜드 미노출).
 * - logoDataUrl 은 data: URL 만 통과(외부 URL 차단 — 아트보드 canvas 오염/외부요청 방지).
 * - color 는 #hex 만, signature/contact 는 문자열만 각각 80/60자로 절삭.
 * 필드 상한은 brand-db 정규화와 동일하게 유지(30/80/60자).
 */
function sanitizeBrandSnapshot(v: unknown): BrandSnapshot | undefined {
  if (!v || typeof v !== "object") return undefined
  const r = v as Record<string, unknown>
  if (typeof r.name !== "string") return undefined
  const name = r.name.trim().slice(0, 30)
  if (name.length === 0) return undefined
  const snap: BrandSnapshot = { name }
  if (typeof r.logoDataUrl === "string" && r.logoDataUrl.startsWith("data:")) {
    snap.logoDataUrl = r.logoDataUrl
  }
  if (typeof r.color === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(r.color)) {
    snap.color = r.color
  }
  if (typeof r.signature === "string") snap.signature = r.signature.slice(0, 80)
  if (typeof r.contact === "string") snap.contact = r.contact.slice(0, 60)
  return snap
}

export async function exportAllWorksToJson(): Promise<WorkBackup> {
  const map = await readMap()
  const items: WorkBackupItem[] = []
  for (const w of Object.values(map)) {
    const imagesBase64: string[] = []
    for (const b of w.imageBlobs) {
      try {
        imagesBase64.push(await blobToDataUrl(b))
      } catch {
        // skip
      }
    }
    // v3.7: 전용 슬롯 사진도 base64로 백업(있을 때만).
    let packagingBase64: string | null = null
    if (w.packagingBlob) {
      try {
        packagingBase64 = await blobToDataUrl(w.packagingBlob)
      } catch {
        packagingBase64 = null
      }
    }
    let sizeBase64: string | null = null
    if (w.sizeBlob) {
      try {
        sizeBase64 = await blobToDataUrl(w.sizeBlob)
      } catch {
        sizeBase64 = null
      }
    }
    // v6.3(작업3): 타이포 헤드라인 이미지도 base64로 백업(있을 때만).
    let typoHeadlineBase64: string | null = null
    if (w.typoHeadlineBlob) {
      try {
        typoHeadlineBase64 = await blobToDataUrl(w.typoHeadlineBlob)
      } catch {
        typoHeadlineBase64 = null
      }
    }
    items.push({
      id: w.id,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      productName: w.productName,
      thumbDataUrl: w.thumbDataUrl,
      input: w.input,
      copy: w.copy,
      imagesBase64,
      // v4.4: 이미지 id 도 함께 백업 — 복원 시 photoAnalysis imageId 정합용.
      imageIds: w.imageIds,
      packagingBase64,
      sizeBase64,
      enhanceImages: w.enhanceImages,
      // v4.4: 사진 분석 결과·토글도 백업(있을 때만 — undefined면 JSON에서 생략).
      photoAnalysis: w.photoAnalysis,
      photoAnalysisEnabled: w.photoAnalysisEnabled,
      // v4.6: 레이아웃 변주도 백업(undefined면 JSON에서 생략 → 로드 시 standard).
      layoutVariant: w.layoutVariant,
      // v5.0: 브랜드 스냅샷도 백업(undefined면 JSON에서 생략).
      brandSnapshot: w.brandSnapshot,
      // v6.1(작업E2): 숨긴 섹션 목록도 백업(undefined/빈 배열이면 생략 → 로드 시 전 섹션 노출).
      hiddenSections: w.hiddenSections && w.hiddenSections.length > 0 ? w.hiddenSections : undefined,
      // v6.3(작업3): 타이포 헤드라인 이미지 base64(없으면 생략 → 로드 시 텍스트 헤드라인).
      typoHeadlineBase64,
    })
  }
  return {
    format: "fdp-backup",
    version: 1,
    exportedAt: Date.now(),
    works: items,
  }
}

export async function importBackupJson(
  raw: unknown,
  opts: { merge?: boolean } = {},
): Promise<{ imported: number; skipped: number }> {
  if (
    !raw ||
    typeof raw !== "object" ||
    (raw as { format?: unknown }).format !== "fdp-backup"
  ) {
    throw new Error("INVALID_BACKUP")
  }
  const data = raw as WorkBackup
  if (!Array.isArray(data.works)) throw new Error("INVALID_WORKS")
  const map = opts.merge ? await readMap() : {}
  let imported = 0
  let skipped = 0
  for (const item of data.works) {
    if (!item || typeof item.id !== "string") {
      skipped++
      continue
    }
    try {
      const blobs: Blob[] = []
      for (const u of item.imagesBase64 ?? []) {
        if (typeof u === "string" && u.startsWith("data:")) {
          blobs.push(await dataUrlToBlob(u))
        }
      }
      // v3.7: 전용 슬롯 사진 복원(있을 때만). 구버전 백업엔 필드 자체가 없음(하위호환).
      let packagingBlob: Blob | null = null
      if (typeof item.packagingBase64 === "string" && item.packagingBase64.startsWith("data:")) {
        packagingBlob = await dataUrlToBlob(item.packagingBase64)
      }
      let sizeBlob: Blob | null = null
      if (typeof item.sizeBase64 === "string" && item.sizeBase64.startsWith("data:")) {
        sizeBlob = await dataUrlToBlob(item.sizeBase64)
      }
      // v6.3(작업3): 타이포 헤드라인 이미지 복원(구버전 백업엔 없음 — 하위호환). data: URL 만 통과.
      let typoHeadlineBlob: Blob | null = null
      if (
        typeof item.typoHeadlineBase64 === "string" &&
        item.typoHeadlineBase64.startsWith("data:")
      ) {
        typoHeadlineBlob = await dataUrlToBlob(item.typoHeadlineBase64)
      }
      // v4.4: 이미지 id 복원(구버전 백업엔 없음 — 하위호환). 문자열만 통과.
      const imageIds = Array.isArray(item.imageIds)
        ? item.imageIds.filter((x): x is string => typeof x === "string")
        : []
      // v4.4: 사진 분석은 신뢰 없는 외부 입력이므로 저장 시점 id 를 knownIds 로 재검증한다
      //   (role 화이트리스트·heroScore 클램프·visibleNote 절삭·미지 imageId 드롭·형태 오류 방어).
      //   imageIds 가 없으면(구버전 백업) 매칭 불가 → null → 복원 시 순서 기반 폴백.
      const photoAnalysis = validatePhotoAnalysis(item.photoAnalysis, imageIds) ?? undefined
      // v4.6: 레이아웃 변주는 신뢰 없는 외부 입력 — 화이트리스트(3개) 밖(손상/조작/구버전)이면
      //   undefined(→ 복원 시 standard). 하위호환: 필드 없어도 안전.
      const layoutVariant =
        item.layoutVariant === "soft" ||
        item.layoutVariant === "editorial" ||
        item.layoutVariant === "standard"
          ? item.layoutVariant
          : undefined
      // v5.0: 브랜드 스냅샷 형태 검증(비문자열 드롭·외부 URL 차단). 없으면 undefined.
      const brandSnapshot = sanitizeBrandSnapshot(item.brandSnapshot)
      // v6.1(작업E2): 숨긴 섹션 목록은 신뢰 없는 외부 입력 — 문자열만 통과, 중복 제거, 상한 64개.
      //   미지 id 가 섞여도 렌더 시 매칭되는 섹션이 없어 무해(방어적 필터). 없으면 undefined.
      const hiddenSections = Array.isArray(item.hiddenSections)
        ? Array.from(new Set(item.hiddenSections.filter((x): x is string => typeof x === "string"))).slice(0, 64)
        : []
      map[item.id] = {
        id: item.id,
        createdAt: item.createdAt ?? Date.now(),
        updatedAt: item.updatedAt ?? Date.now(),
        productName: item.productName ?? "",
        thumbDataUrl: item.thumbDataUrl ?? null,
        input: item.input,
        copy: item.copy ?? null,
        imageBlobs: blobs,
        imageIds: imageIds.length > 0 ? imageIds : undefined,
        packagingBlob,
        sizeBlob,
        enhanceImages: item.enhanceImages,
        // v4.4: 재검증 통과분만 저장(형태 오류·환각 imageId 방어). 없으면 undefined.
        photoAnalysis,
        photoAnalysisEnabled: item.photoAnalysisEnabled,
        // v4.6: 검증 통과한 레이아웃 변주만 저장(없으면 undefined → standard).
        layoutVariant,
        // v5.0: 검증 통과한 브랜드 스냅샷만 저장(없으면 undefined → 브랜드 미노출).
        brandSnapshot,
        // v6.1(작업E2): 검증 통과한 숨김 목록만 저장(빈 배열이면 undefined → 전 섹션 노출).
        hiddenSections: hiddenSections.length > 0 ? hiddenSections : undefined,
        // v6.3(작업3): 복원한 타이포 헤드라인 이미지(없으면 null → 텍스트 헤드라인).
        typoHeadlineBlob,
      }
      imported++
    } catch {
      skipped++
    }
  }
  await writeMap(map)
  return { imported, skipped }
}

/**
 * 이미지 File을 작은 썸네일 dataURL로 변환(목록 카드용).
 * - 비결정적 환경(SSR) 대비 typeof window 가드.
 * - 실패해도 null 반환(저장은 진행되어야 함).
 */
export async function makeThumbDataUrl(
  file: Blob,
  maxSize = 240,
): Promise<string | null> {
  if (typeof window === "undefined") return null
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close()
    return canvas.toDataURL("image/jpeg", 0.7)
  } catch {
    return null
  }
}
