/**
 * 키 암호화 — Web Crypto API AES-GCM.
 *
 * 영구 random secret + 영구 random salt (둘 다 IDB에 저장)에서 PBKDF2 KDF →
 * AES-GCM 256bit 키 도출 → 키 자체 암호화/복호화.
 *
 * 검수 반영(2026-06-30):
 * - navigator.userAgent (Chrome UA Reduction 정책으로 freeze 변동) 제거
 * - screen 가변성 (외장 모니터 분리 등) 제거
 * - 솔트를 localStorage → IDB로 이전 (암호문과 같은 저장소에서 트랜잭션)
 *
 * 보안 한계 (룰북 9장 명시):
 * - 같은 origin의 JS가 복호화 가능 → XSS 방어 X
 * - 진짜 방어는 strict CSP + 서드파티 스크립트 0 + 의존성 최소화
 * - 이 암호화는 "디스크 포렌식, 백업 유출"에 대한 1차 방어선
 */

import { get, set } from "idb-keyval"

const SECRET_KEY = "fdp:crypto-secret-v1"
const SALT_KEY = "fdp:crypto-salt-v1"

export class StorageCorruptedError extends Error {
  constructor() {
    super("STORAGE_CORRUPTED")
    this.name = "StorageCorruptedError"
  }
}

function makeBuffer(len: number): { buf: ArrayBuffer; view: Uint8Array } {
  const buf = new ArrayBuffer(len)
  return { buf, view: new Uint8Array(buf) }
}

async function getOrCreate(idbKey: string, bytes: number): Promise<ArrayBuffer> {
  const existing = await get<ArrayBuffer>(idbKey)
  if (existing && existing.byteLength === bytes) return existing
  const { buf, view } = makeBuffer(bytes)
  crypto.getRandomValues(view)
  await set(idbKey, buf)
  return buf
}

async function deriveKey(): Promise<CryptoKey> {
  const secret = await getOrCreate(SECRET_KEY, 32)
  const salt = await getOrCreate(SALT_KEY, 16)

  const baseKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  )
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
}

function textToArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(u8.byteLength)
  new Uint8Array(buf).set(u8)
  return buf
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ""
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const buf = new ArrayBuffer(bin.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return buf
}

export interface EncryptedKey {
  cipher: string
  iv: string
}

export async function encryptKey(plain: string): Promise<EncryptedKey> {
  const key = await deriveKey()
  const { buf: ivBuf, view: ivView } = makeBuffer(12)
  crypto.getRandomValues(ivView)
  const plainBuf = textToArrayBuffer(new TextEncoder().encode(plain))
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: ivBuf },
    key,
    plainBuf,
  )
  return { cipher: bufToB64(cipherBuf), iv: bufToB64(ivBuf) }
}

/**
 * 복호화 실패 시 StorageCorruptedError를 던진다. 호출부가 분기해서
 * 저장소를 비우고 사용자에게 재입력 안내를 띄울 수 있게.
 */
export async function decryptKey(cipher: string, ivB64: string): Promise<string> {
  try {
    const key = await deriveKey()
    const ivBuf = b64ToBuf(ivB64)
    const cipherBuf = b64ToBuf(cipher)
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: ivBuf },
      key,
      cipherBuf,
    )
    return new TextDecoder().decode(plainBuf)
  } catch (err) {
    if (err instanceof Error && err.name === "OperationError") {
      throw new StorageCorruptedError()
    }
    throw err
  }
}
