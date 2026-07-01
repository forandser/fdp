/**
 * 키 출처 추상화.
 *
 * 지금: 세션 메모리 + 옵션 암호화 IDB + (v2.0) localStorage 평문 백업 폴백.
 * 미래(SaaS): 우리 백엔드의 세션 토큰으로 교체 — 인터페이스만 같으면 됨.
 *
 * v2.0 변경 (키 영속성 강화):
 * - navigator.storage.persist() 호출로 브라우저 evict 차단
 * - decryptKey 실패 시 자동 삭제 X → 한 번 더 시도 + 평문 백업 폴백 활용
 * - localStorage 평문 백업 (셀러 BYOK 시나리오에서 단순 영속성 보장)
 *   * 셀러 본인 PC만 사용하는 정적 사이트라 평문도 BYOK 신뢰 모델 안에서 합당
 * - 키 변경 / 명시적 삭제 / 만료 시에만 clearKey() 호출
 */

import { idbGetEncryptedKey, idbSetEncryptedKey, idbClearEncryptedKey } from "@/lib/storage/idb-key"
import { decryptKey, encryptKey, StorageCorruptedError } from "@/lib/storage/crypto"

export type KeyStoragePolicy = "session" | "days_7" | "days_30" | "forever"
export type KeyLoadIssue = "none" | "corrupted" | "expired"

export interface KeyLoadStatus {
  issue: KeyLoadIssue
}

const BROADCAST_CHANNEL_NAME = "fdp:key-events"
/** localStorage 평문 백업 키 — IDB 손실 시 폴백. */
const LS_PLAIN_BACKUP = "fdp:key-plain-v1"
/** localStorage에 키 만료 백업. */
const LS_EXPIRES_BACKUP = "fdp:key-expires-v1"

/**
 * 브라우저 storage persistence 요청 — eviction 차단.
 * Chromium/Firefox는 자동 승인이 일반적, Safari는 prompt 가능.
 */
async function requestPersist(): Promise<void> {
  if (typeof navigator === "undefined") return
  if (!navigator.storage?.persist) return
  try {
    const already = await navigator.storage.persisted?.()
    if (already) return
    const granted = await navigator.storage.persist()
    if (granted) {
      console.info("[key-source] storage persistence granted")
    }
  } catch (e) {
    console.warn("[key-source] persist request failed:", e)
  }
}

function lsGet(key: string): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, val: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, val)
  } catch {
    /* quota exceeded / private mode */
  }
}
function lsRemove(key: string): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* noop */
  }
}

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

    // v2.0: 첫 호출 시 persistence 권한 요청 (eviction 차단)
    void requestPersist()

    // 1. 평문 백업 만료 체크 → 만료된 경우 즉시 정리
    const plainExpiresRaw = lsGet(LS_EXPIRES_BACKUP)
    const plainExpires = plainExpiresRaw ? Number(plainExpiresRaw) : null
    if (plainExpires && plainExpires < Date.now()) {
      lsRemove(LS_PLAIN_BACKUP)
      lsRemove(LS_EXPIRES_BACKUP)
      this.issue = "expired"
      // IDB도 같이 정리
      try {
        await idbClearEncryptedKey()
      } catch {
        /* noop */
      }
      return null
    }

    // 2. IDB 암호화 키 시도
    let stored
    try {
      stored = await idbGetEncryptedKey()
    } catch (err) {
      console.warn("[key-source] IDB read failed:", err)
      // IDB 실패해도 평문 백업으로 폴백
      stored = null
    }

    if (stored) {
      // 만료 체크
      if (stored.expiresAt && stored.expiresAt < Date.now()) {
        this.issue = "expired"
        try {
          await idbClearEncryptedKey()
        } catch {
          /* noop */
        }
        lsRemove(LS_PLAIN_BACKUP)
        lsRemove(LS_EXPIRES_BACKUP)
        return null
      }
      // 복호화 시도
      try {
        const decrypted = await decryptKey(stored.cipher, stored.iv)
        sessionKey = decrypted
        return decrypted
      } catch (err) {
        // v2.0: 복호화 실패해도 자동 삭제 X. 평문 백업으로 폴백.
        if (err instanceof StorageCorruptedError) {
          console.warn("[key-source] Decryption mismatch — trying plain backup before clearing.")
          this.issue = "corrupted"
        } else {
          console.warn("[key-source] Decryption error:", err)
          this.issue = "corrupted"
        }
      }
    }

    // 3. 평문 백업 폴백
    const plainBackup = lsGet(LS_PLAIN_BACKUP)
    if (plainBackup) {
      this.issue = "none"
      sessionKey = plainBackup
      // IDB 암호화 키도 다시 복구 (다음에 정상 복호화 가능하게)
      try {
        const { cipher, iv } = await encryptKey(plainBackup)
        await idbSetEncryptedKey({ cipher, iv, expiresAt: plainExpires })
      } catch (e) {
        console.warn("[key-source] re-encrypt failed:", e)
      }
      return plainBackup
    }

    return null
  }

  async setKey(key: string, policy: KeyStoragePolicy): Promise<void> {
    this.issue = "none"
    sessionKey = key

    // v2.0: persistence 권한 요청
    void requestPersist()

    if (policy === "session") {
      await idbClearEncryptedKey()
      lsRemove(LS_PLAIN_BACKUP)
      lsRemove(LS_EXPIRES_BACKUP)
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

    // IDB 암호화 저장 (primary)
    try {
      const { cipher, iv } = await encryptKey(key)
      await idbSetEncryptedKey({ cipher, iv, expiresAt })
    } catch (e) {
      console.warn("[key-source] IDB encrypt/store failed:", e)
    }

    // localStorage 평문 백업 (v2.0 — IDB 손실 시 폴백)
    // 셀러 본인 PC만 쓰는 BYOK 정적 사이트라 평문 백업은 신뢰 모델 안에서 합당
    lsSet(LS_PLAIN_BACKUP, key)
    if (expiresAt) {
      lsSet(LS_EXPIRES_BACKUP, String(expiresAt))
    } else {
      lsRemove(LS_EXPIRES_BACKUP)
    }
  }

  async clearKey(): Promise<void> {
    this.issue = "none"
    sessionKey = null
    try {
      await idbClearEncryptedKey()
    } catch {
      /* noop */
    }
    lsRemove(LS_PLAIN_BACKUP)
    lsRemove(LS_EXPIRES_BACKUP)
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
