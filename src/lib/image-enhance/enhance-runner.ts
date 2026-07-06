/**
 * enhanceImageBlob 실행 오케스트레이션 — 동시성 제한 큐 + 결과 URL 캐시.
 *
 * - 캐시 키: 원본 Blob(File) 객체 자체(세션 내 동일 참조). 값: 보정본 objectURL.
 *   → 토글 ON/OFF 반복 시 재연산 없이 즉시 스왑(중복 픽셀 연산 방지).
 * - 동시 처리 2개로 제한(모바일에서 보정 연산이 UI 를 멎게 하지 않도록).
 * - revoke 는 "이미지 실제 제거" 시점에만(revokeEnhanced) — 토글만으로는 유지(보수적).
 *   블롭 URL 소량 누수는 허용(캐시 수명 기준). 세션 종료 시 브라우저가 정리.
 */

import { enhanceImageBlob } from "./enhance"

const MAX_CONCURRENT = 2

let active = 0
const waiters: Array<() => void> = []

async function runQueued<T>(job: () => Promise<T>): Promise<T> {
  // 슬롯이 빌 때까지 대기(깨어난 뒤 재확인 — 다중 wake 안전).
  while (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  active++
  try {
    return await job()
  } finally {
    active--
    const next = waiters.shift()
    if (next) next()
  }
}

/** 원본 blob → 보정본 objectURL. 캐시/인플라이트 dedup. */
const cache = new Map<Blob, string>()
const inflight = new Map<Blob, Promise<string>>()

export function getEnhancedUrl(file: Blob): Promise<string> {
  const cached = cache.get(file)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(file)
  if (pending) return pending
  const p = runQueued(async () => {
    const blob = await enhanceImageBlob(file) // 실패해도 원본 blob 반환(throw 없음)
    const url = URL.createObjectURL(blob)
    cache.set(file, url)
    return url
  }).finally(() => {
    inflight.delete(file)
  })
  inflight.set(file, p)
  return p
}

/** 이미지 실제 제거 시 호출 — 보정본 URL revoke + 캐시 정리. */
export function revokeEnhanced(file: Blob): void {
  const url = cache.get(file)
  if (url) {
    URL.revokeObjectURL(url)
    cache.delete(file)
  }
}
