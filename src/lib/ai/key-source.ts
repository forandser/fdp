/**
 * 키 출처 추상화.
 *
 * 지금: 세션 메모리 + 옵션 암호화 IDB.
 * 미래(SaaS): 우리 백엔드의 세션 토큰으로 교체 — 인터페이스만 같으면 됨.
 *
 * 검수 반영(2026-06-30):
 * - catch{} 무성 → 손상 감지 시 자동 정리 + 호출부에 noticeable 신호
 * - 다중 탭 동기화 (BroadcastChannel)
 */

import { idbGetEncryptedKey, idbSetEncryptedKey, idbClearEncryptedKey } from "@/lib/storage/idb-key"
import { decryptKey, encryptKey, StorageCorruptedError } from "@/lib/storage/crypto"

export type KeyStoragePolicy = "session" | "days_7" | "days_30" | "forever"
export type KeyLoadIssue = "none" | "corrupted" | "expired"

export interface KeyLoadStatus {
  issue: KeyLoadIssue
}

const BROADCAST_CHANNEL_NAME = "fdp:key-events"

export interface KeySource {
  /** 현재 사용 가능한 키 (없으면 null) */
  getKey(): Promise<string | null>

  /** 키 저장 */
  setKey(key: string, policy: KeyStoragePolicy): Promise<void>

  /** 키 삭제 */
  clearKey(): Promise<void>

  /** 키 일부만 노출 (sk-ant-•••XYZW 형태) */
  getKeyMask(): Promise<string | null>

  /** 마지막 키 로드 시 발생한 이슈 (직전 getKey 호출 기준) */
  lastIssue(): KeyLoadIssue

  /** 다중 탭에서 키 삭제 시 알림 받기 */
  subscribe(listener: (event: "cleared") => void): () => void
}

let sessionKey: string | null = null

function getDaysExpiry(policy: KeyStoragePolicy): number | null {
  if (policy === "session") return null
  if (policy === "days_7") return 7
  if (policy === "days_30") return 30
  if (policy === "forever") return null
  return null
}

function mask(key: string): string {
  if (key.length <= 8) return "•••"
  const last4 = key.slice(-4)
  return `sk-ant-•••${last4}`
}

class BrowserKeySource implements KeySource {
  private issue: KeyLoadIssue = "none"
  private channel: BroadcastChannel | null = null
  private listeners = new Set<(event: "cleared") => void>()

  private ensureChannel(): BroadcastChannel | null {
    if (typeof window === "undefined") return null
    if (typeof BroadcastChannel === "undefined") return null
    if (!this.channel) {
      this.channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME)
      this.channel.onmessage = (e: MessageEvent<{ type: string }>) => {
        if (e.data?.type === "cleared") {
          sessionKey = null
          for (const l of this.listeners) l("cleared")
        }
      }
    }
    return this.channel
  }

  async getKey(): Promise<string | null> {
    this.issue = "none"
    if (sessionKey) return sessionKey
    if (typeof window === "undefined") return null

    let stored
    try {
      stored = await idbGetEncryptedKey()
    } catch (err) {
      console.warn("[key-source] IDB read failed:", err)
      this.issue = "corrupted"
      return null
    }
    if (!stored) return null

    if (stored.expiresAt && stored.expiresAt < Date.now()) {
      this.issue = "expired"
      await idbClearEncryptedKey()
      return null
    }

    try {
      const decrypted = await decryptKey(stored.cipher, stored.iv)
      sessionKey = decrypted
      return decrypted
    } catch (err) {
      if (err instanceof StorageCorruptedError) {
        console.warn("[key-source] Stored key corrupted, clearing.")
        this.issue = "corrupted"
        await idbClearEncryptedKey()
        return null
      }
      console.warn("[key-source] Decryption error:", err)
      this.issue = "corrupted"
      await idbClearEncryptedKey()
      return null
    }
  }

  async setKey(key: string, policy: KeyStoragePolicy): Promise<void> {
    this.issue = "none"
    sessionKey = key
    if (policy === "session") {
      await idbClearEncryptedKey()
      return
    }
    // forever 는 expiresAt=null로 저장 → 만료 검사 통과 → 영구
    const days = getDaysExpiry(policy)
    const expiresAt =
      policy === "forever"
        ? null
        : days != null
          ? Date.now() + days * 24 * 60 * 60 * 1000
          : null
    const { cipher, iv } = await encryptKey(key)
    await idbSetEncryptedKey({ cipher, iv, expiresAt })
  }

  async clearKey(): Promise<void> {
    this.issue = "none"
    sessionKey = null
    await idbClearEncryptedKey()
    const channel = this.ensureChannel()
    channel?.postMessage({ type: "cleared" })
    for (const l of this.listeners) l("cleared")
  }

  async getKeyMask(): Promise<string | null> {
    const key = await this.getKey()
    return key ? mask(key) : null
  }

  lastIssue(): KeyLoadIssue {
    return this.issue
  }

  subscribe(listener: (event: "cleared") => void): () => void {
    this.ensureChannel()
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

let instance: KeySource | null = null

export function getKeySource(): KeySource {
  if (!instance) {
    instance = new BrowserKeySource()
  }
  return instance
}
