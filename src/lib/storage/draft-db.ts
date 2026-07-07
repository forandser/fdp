/**
 * v5.4(작업2): 입력 초안 자동 저장소.
 *
 * 생성 성공(saveWork) 전에는 아무것도 저장되지 않아 새로고침·탭 킬·생성 실패 이탈 시
 * 사진 포함 전부 유실된다. 이 모듈은 입력 단계의 폼/토글/사진을 단일 초안 레코드로
 * 디바운스 저장해 재진입 시 "이어서 하기"를 가능하게 한다.
 *
 * - works-db 와 동일한 idb-keyval 인프라·Blob 저장 패턴을 재사용한다.
 * - 성능: 폼/토글 메타(DRAFT)와 사진 blob(DRAFT_PHOTOS)을 별도 키로 분리한다.
 *   폼 텍스트만 바뀌는 잦은 저장에서 사진 blob 을 반복 재직렬화하지 않도록,
 *   호출부가 photoSig(사진 id 집합 서명) 비교로 사진 레코드는 "변경됐을 때만" 다시 쓴다.
 * - 저장은 전부 로컬(IndexedDB), 외부 전송 없음(BYOK 신뢰 모델).
 */

import { get, set, del } from "idb-keyval"
import { STORAGE_KEYS } from "./keys"
import type { ProductCategory, SellerReview } from "@/lib/ai/types"

/** 레이아웃 무드 변주 — works-db 와 동일 유니온(features 결합 회피 위해 여기 재선언). */
type DraftLayoutVariant = "standard" | "soft" | "editorial"

/**
 * 초안 폼/토글 스냅샷 — 사진을 제외한 입력 단계의 모든 값.
 * ResultView 렌더에 영향을 주는 픽셀 필드는 없다(앱 셸 입력만).
 */
export interface DraftForm {
  category: ProductCategory
  productName: string
  variety: string
  origin: string
  /** 예시 채우기로 채워진 산지인지(복원 시 힌트 유지). */
  originFromDemo: boolean
  weight: string
  brix: string
  sizeGrade: string
  extraDescription: string
  farmIntro: string
  producerName: string
  producerRegion: string
  farmerYears: string
  sameDayHarvest: boolean
  coldChain: boolean
  refundGuarantee: boolean
  reviews: SellerReview[]
  presetKeywords: string[]
  customKeywords: string[]
  researchEnabled: boolean
  enhanceImages: boolean
  photoAnalysisEnabled: boolean
  layoutVariant: DraftLayoutVariant
}

/** 초안 사진 blob 묶음 — 일반 사진 목록 + 전용 슬롯 2종. */
export interface DraftPhotos {
  imageBlobs: Blob[]
  /** imageBlobs 와 같은 순서·길이. 복원 시 업로드 id 를 되살려 photoAnalysis 정합 유지. */
  imageIds: string[]
  packagingBlob: Blob | null
  sizeBlob: Blob | null
}

/** DRAFT 키에 저장되는 메타 레코드(폼 + 서명 + 저장시각). 사진 blob 은 별도 키. */
interface DraftMeta {
  savedAt: number
  /** 마지막으로 DRAFT_PHOTOS 에 기록한 사진 서명(복원·정합 확인용). */
  photoSig: string
  form: DraftForm
}

/**
 * 현재 사진 구성의 서명 — 업로드 id 집합(순서 포함)으로 만든다.
 * 추가/삭제/교체/순서변경이 모두 서명 변화로 잡혀, 사진 재기록 필요 여부를 판정한다.
 */
export function computePhotoSig(
  imageIds: string[],
  packagingId: string | null,
  sizeId: string | null,
): string {
  return `${imageIds.join(",")}|p:${packagingId ?? ""}|s:${sizeId ?? ""}`
}

/** 초안 존재 시 폼 메타 + 사진 blob 을 함께 돌려준다(없으면 null). */
export async function getDraft(): Promise<{
  form: DraftForm
  savedAt: number
  photoSig: string
  photos: DraftPhotos | null
} | null> {
  const meta = await get<DraftMeta>(STORAGE_KEYS.DRAFT)
  if (!meta || !meta.form) return null
  const photos = (await get<DraftPhotos>(STORAGE_KEYS.DRAFT_PHOTOS)) ?? null
  return { form: meta.form, savedAt: meta.savedAt, photoSig: meta.photoSig, photos }
}

/** 폼/토글 메타 저장(잦은 호출 — 사진 blob 은 건드리지 않음). */
export async function saveDraftMeta(form: DraftForm, photoSig: string): Promise<void> {
  const meta: DraftMeta = { savedAt: Date.now(), photoSig, form }
  await set(STORAGE_KEYS.DRAFT, meta)
}

/** 사진 blob 저장(서명이 바뀐 경우에만 호출 — 대용량 반복 기록 방지). */
export async function saveDraftPhotos(photos: DraftPhotos): Promise<void> {
  await set(STORAGE_KEYS.DRAFT_PHOTOS, photos)
}

/** 초안 삭제 — 생성 성공(saveWork) 시, 명시적 "버리기" 시 호출. 두 키 모두 제거. */
export async function deleteDraft(): Promise<void> {
  await del(STORAGE_KEYS.DRAFT)
  await del(STORAGE_KEYS.DRAFT_PHOTOS)
}
