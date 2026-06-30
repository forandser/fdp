"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { DetailMaker } from "@/features/detail/DetailMaker"
import { AppHeader } from "@/components/ui/AppHeader"
import { getKeySource } from "@/lib/ai/key-source"
import { t } from "@/lib/i18n"

export default function DetailPage() {
  const router = useRouter()
  const [hasKey, setHasKey] = useState<boolean | null>(null)
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
      const key = await getKeySource().getKey()
      const mask = await getKeySource().getKeyMask()
      if (cancelled) return
      if (!key) {
        router.replace("/")
        return
      }
      setHasKey(true)
      setKeyMask(mask)
    })()

    const unsubscribe = getKeySource().subscribe(() => {
      router.replace("/")
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [router])

  if (hasKey === null) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div style={{ color: "var(--color-neutral-500)" }}>{t.app.loading}</div>
      </main>
    )
  }

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
          router.replace("/")
        }}
      />
      <DetailMaker initialWorkId={workId} />
    </main>
  )
}
