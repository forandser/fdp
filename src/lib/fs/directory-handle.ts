/**
 * File System Access API 어댑터.
 *
 * 셀러가 한 번 폴더를 선택하면 directoryHandle을 IndexedDB에 저장 → 다음 세션에서 재사용.
 *
 * 지원: Chrome / Edge / Whale 데스크탑.
 * 미지원(Safari, Firefox, iOS): isSupported() === false → 호출부가 다운로드 폴백 사용.
 */

import { get, set, del } from "idb-keyval"
import { STORAGE_KEYS } from "@/lib/storage/keys"

type FileSystemHandlePermissionDescriptor = {
  mode: "read" | "readwrite"
}

interface FileSystemHandleWithPermissions {
  queryPermission: (desc: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>
  requestPermission: (desc: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle>
  }
}

export function isFsAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function"
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFsAccessSupported() || !window.showDirectoryPicker) return null
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" })
    await set(STORAGE_KEYS.DIRECTORY_HANDLE, handle)
    return handle
  } catch {
    // 사용자 취소 등
    return null
  }
}

export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await get<FileSystemDirectoryHandle>(STORAGE_KEYS.DIRECTORY_HANDLE)
  return handle ?? null
}

export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
): Promise<boolean> {
  const h = handle as unknown as FileSystemHandleWithPermissions
  const perm = await h.queryPermission({ mode: "readwrite" })
  if (perm === "granted") return true
  const requested = await h.requestPermission({ mode: "readwrite" })
  return requested === "granted"
}

export async function clearStoredHandle(): Promise<void> {
  await del(STORAGE_KEYS.DIRECTORY_HANDLE)
}

/**
 * NFC normalize 후 파일 쓰기. 한글 파일명 Windows/Mac 호환.
 */
export async function writeFileToDirectory(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob,
): Promise<void> {
  const normalized = fileName.normalize("NFC")
  const fileHandle = await dir.getFileHandle(normalized, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
}

/**
 * 폴백: 일반 다운로드 (Safari/Firefox/iOS).
 */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = fileName.normalize("NFC")
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
