"use client"

import { useEffect, useState } from "react"
import { DetailMaker } from "@/features/detail/DetailMaker"
import { AppHeader } from "@/components/ui/AppHeader"
import { getKeySource } from "@/lib/ai/key-source"

export default function DetailPage() {
  // v5.4(작업1): 키 없이도 진입·입력·미리보기 가능. 키 유무는 헤더 마스크 표시에만 쓴다.
  const [keyMask, setKeyMask] = useState<string | null>(null)
  const [workId, setWorkId] = useState<string | undefined>(undefined)

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    const w = params.get("work")
    if (w) setWorkId(w)
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const mask = await getKeySource().getKeyMask()
      if (cancelled) return
      setKeyMask(mask)
    })()

    // 다른 탭에서 키가 삭제돼도 추방하지 않는다 — 마스크만 지우고 둘러보기는 유지.
    const unsubscribe = getKeySource().subscribe(() => {
      setKeyMask(null)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ background: "var(--color-bg-page)" }}
    >
      <AppHeader
        keyMask={keyMask}
        showBack
        onClearKey={async () => {
          await getKeySource().clearKey()
          setKeyMask(null)
        }}
      />
      <DetailMaker
        initialWorkId={workId}
        onKeyRegistered={async () => {
          // 모달로 키를 등록하면 헤더 마스크를 즉시 갱신(재마운트 없이 동기화).
          const mask = await getKeySource().getKeyMask()
          setKeyMask(mask)
        }}
      />
    </main>
  )
}
