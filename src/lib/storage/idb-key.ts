/**
 * IndexedDB로 암호화된 API 키 저장 (만료 옵션 포함).
 *
 * 라이브러리: idb-keyval (가벼움 < 1KB)
 */

import { get, set, del } from "idb-keyval"
import { STORAGE_KEYS } from "./keys"

export interface StoredKey {
  cipher: string
  iv: string
  expiresAt: number | null
}

export async function idbGetEncryptedKey(): Promise<StoredKey | null> {
  const raw = await get<StoredKey>(STORAGE_KEYS.ENCRYPTED_API_KEY)
  return raw ?? null
}

export async function idbSetEncryptedKey(key: StoredKey): Promise<void> {
  await set(STORAGE_KEYS.ENCRYPTED_API_KEY, key)
}

export async function idbClearEncryptedKey(): Promise<void> {
  await del(STORAGE_KEYS.ENCRYPTED_API_KEY)
}
