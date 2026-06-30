"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ApiKeyGate } from "@/features/api-key/ApiKeyGate"
import { AppHeader } from "@/components/ui/AppHeader"
import { RecentWorks } from "@/features/works/RecentWorks"
import { ImageProviderGate } from "@/features/settings/ImageProviderGate"
import { getKeySource } from "@/lib/ai/key-source"
import { t } from "@/lib/i18n"

export default function HomePage() {
  const router = useRouter()
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [keyMask, setKeyMask] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const key = await getKeySource().getKey()
      const mask = await getKeySource().getKeyMask()
      if (cancelled) return
      setHasKey(Boolean(key))
      setKeyMask(mask)
    })()

    const unsubscribe = getKeySource().subscribe(() => {
      setHasKey(false)
      setKeyMask(null)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  if (hasKey === null) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div style={{ color: "var(--color-neutral-500)" }}>{t.app.loading}</div>
      </main>
    )
  }

  if (!hasKey) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <ApiKeyGate
          onSuccess={() => {
            setHasKey(true)
            void getKeySource()
              .getKeyMask()
              .then((m) => setKeyMask(m))
          }}
        />
      </main>
    )
  }

  return (
    <main className="min-h-screen flex flex-col">
      <AppHeader
        keyMask={keyMask}
        onClearKey={async () => {
          await getKeySource().clearKey()
          setHasKey(false)
          setKeyMask(null)
        }}
      />
      <section
        className="flex-1 flex items-center justify-center px-4"
        style={{ background: "var(--color-bg-page)" }}
      >
        <div style={{ maxWidth: 960, width: "100%" }}>
          <div style={{ textAlign: "center", marginBottom: "var(--space-10)" }}>
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "5px 12px",
                borderRadius: 999,
                background: "#FFF5F5",
                color: "#C92A2A",
                fontSize: 12,
                fontWeight: 700,
                marginBottom: 16,
              }}
            >
              <span aria-hidden>🇰🇷</span>
              {t.menu.eyebrow}
            </div>
            <h2
              style={{
                fontSize: 36,
                fontWeight: 800,
                color: "var(--color-neutral-900)",
                marginBottom: 12,
                lineHeight: 1.25,
                letterSpacing: -0.5,
              }}
            >
              {t.menu.title}
            </h2>
            <p
              style={{
                fontSize: "var(--font-size-lg)",
                color: "var(--color-neutral-500)",
                lineHeight: 1.55,
              }}
            >
              {t.menu.subtitle}
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
              gap: "var(--space-7)",
            }}
          >
            <MenuCard
              href="/detail"
              icon="📄"
              title={t.menu.detail.title}
              description={t.menu.detail.description}
              cta={t.menu.detail.cta}
              primary
            />
            <MenuCard
              href="/thumbnail"
              icon="🖼️"
              title={t.menu.thumbnail.title}
              description={t.menu.thumbnail.description}
              cta={t.menu.thumbnail.cta}
            />
          </div>

          <div style={{ marginTop: "var(--space-10)" }}>
            <HowItWorks />
          </div>

          <div style={{ marginTop: "var(--space-10)" }}>
            <RecentWorks onSelect={(id) => router.push(`/detail?work=${id}`)} />
          </div>

          <div style={{ marginTop: "var(--space-10)" }}>
            <details>
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: "var(--font-size-md)",
                  fontWeight: 700,
                  color: "var(--color-neutral-700)",
                  marginBottom: 12,
                }}
              >
                ⚙️ 사진 합성 옵션 (선택)
              </summary>
              <div style={{ marginTop: 12 }}>
                <ImageProviderGate />
              </div>
            </details>
          </div>
        </div>
      </section>
    </main>
  )
}

function HowItWorks() {
  const steps = [
    {
      icon: "📷",
      title: "1. 사진 올리고",
      body: "과일·야채 사진 2~30장. 상품명·산지·중량만 적으면 끝.",
    },
    {
      icon: "✨",
      title: "2. AI가 카피 작성",
      body: "한국형 상세페이지 패턴(POINT 3가지·강조 박스·FAQ)으로 자동 구성.",
    },
    {
      icon: "📥",
      title: "3. JPG로 다운로드",
      body: "쿠팡·스마트스토어·11번가·자사몰 폭에 맞춰 자동 분할 출력.",
    },
  ]
  return (
    <section>
      <h3
        style={{
          fontSize: "var(--font-size-lg)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          marginBottom: 14,
        }}
      >
        이렇게 동작해요
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {steps.map((s, i) => (
          <div
            key={`step-${i}`}
            style={{
              padding: 18,
              background: "var(--color-bg-surface)",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--color-neutral-100)",
            }}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>{s.icon}</div>
            <div
              style={{
                fontSize: "var(--font-size-md)",
                fontWeight: 700,
                color: "var(--color-neutral-900)",
                marginBottom: 4,
              }}
            >
              {s.title}
            </div>
            <p
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--color-neutral-500)",
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}

function MenuCard({
  href,
  icon,
  title,
  description,
  cta,
  primary,
  badge,
}: {
  href: string
  icon: string
  title: string
  description: string
  cta: string
  primary?: boolean
  badge?: string
}) {
  return (
    <Link
      href={href}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "var(--space-10)",
        background: "var(--color-bg-surface)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
        border: primary
          ? "2px solid var(--color-primary-600)"
          : "1px solid var(--color-neutral-100)",
        textDecoration: "none",
        color: "inherit",
        transition: "transform 0.15s",
      }}
    >
      {badge && (
        <span
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "var(--color-neutral-100)",
            color: "var(--color-neutral-700)",
            fontSize: "var(--font-size-sm)",
            padding: "4px 10px",
            borderRadius: "var(--radius-xs)",
          }}
        >
          {badge}
        </span>
      )}
      <div style={{ fontSize: 40, marginBottom: 4 }}>{icon}</div>
      <h3
        style={{
          fontSize: "var(--font-size-xl)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontSize: "var(--font-size-md)",
          color: "var(--color-neutral-500)",
          lineHeight: 1.5,
          minHeight: 48,
        }}
      >
        {description}
      </p>
      <div
        style={{
          marginTop: 8,
          display: "inline-flex",
          alignItems: "center",
          alignSelf: "flex-start",
          padding: "10px 18px",
          background: primary ? "var(--color-primary-600)" : "var(--color-neutral-100)",
          color: primary ? "var(--color-text-on-primary)" : "var(--color-neutral-900)",
          borderRadius: "var(--radius-xs)",
          fontSize: "var(--font-size-md)",
          fontWeight: 600,
        }}
      >
        {cta} →
      </div>
    </Link>
  )
}
