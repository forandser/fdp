/**
 * 저장소 키 중앙 정의 — 컴포넌트가 각자 다른 키 이름을 쓰는 사고 방지.
 */

export const STORAGE_KEYS = {
  // IndexedDB
  ENCRYPTED_API_KEY: "fdp:encrypted-api-key",
  WORKS_DB: "fdp:works",
  DIRECTORY_HANDLE: "fdp:dir-handle",
  EXPORT_PRESETS: "fdp:export-presets",
  // v5.0-A: 브랜드 프로필 저장소({ [brandId]: BrandProfile } 맵) + 기본 브랜드 id.
  BRANDS_DB: "fdp:brands",
  BRAND_DEFAULT: "fdp:brand-default",
  // localStorage
  USAGE_TOTAL: "fdp:usage-total",
  LOCALE: "fdp:locale",
  LAST_OPENED_WORK: "fdp:last-opened-work",
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
