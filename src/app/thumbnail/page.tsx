"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AppHeader } from "@/components/ui/AppHeader"
import { ThumbnailMaker } from "@/features/thumbnail/ThumbnailMaker"
import { getKeySource } from "@/lib/ai/key-source"
import { t } from "@/lib/i18n"

export default function ThumbnailPage() {
  const router = useRouter()
  const [keyMask, setKeyMask] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

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
      setKeyMask(mask)
      setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  if (!ready) {
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
      <ThumbnailMaker />
    </main>
  )
}
