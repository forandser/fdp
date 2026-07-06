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
import type { CopyInput, CopyOutput } from "@/lib/ai/types"

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
  map[work.id] = {
    ...work,
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
  /** v3.7: 포장 전용 슬롯 사진 base64(dataURL). 없으면 생략(하위호환). */
  packagingBase64?: string | null
  /** v3.7: 크기 비교 전용 슬롯 사진 base64(dataURL). 없으면 생략(하위호환). */
  sizeBase64?: string | null
  /** 사진 자동 보정 토글 상태. 없으면 기본 ON(하위호환). */
  enhanceImages?: boolean
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
    items.push({
      id: w.id,
      createdAt: w.createdAt,
      updatedAt: w.updatedAt,
      productName: w.productName,
      thumbDataUrl: w.thumbDataUrl,
      input: w.input,
      copy: w.copy,
      imagesBase64,
      packagingBase64,
      sizeBase64,
      enhanceImages: w.enhanceImages,
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
      map[item.id] = {
        id: item.id,
        createdAt: item.createdAt ?? Date.now(),
        updatedAt: item.updatedAt ?? Date.now(),
        productName: item.productName ?? "",
        thumbDataUrl: item.thumbDataUrl ?? null,
        input: item.input,
        copy: item.copy ?? null,
        imageBlobs: blobs,
        packagingBlob,
        sizeBlob,
        enhanceImages: item.enhanceImages,
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
