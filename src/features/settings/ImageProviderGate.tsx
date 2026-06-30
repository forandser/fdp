"use client"

/**
 * 이미지 프로바이더 키 입력 + 검증 UI.
 *
 * Anthropic 키와 별개. 사용자가 사진 합성/배경 제거 옵션을 켜려면
 * Google AI Studio 등에서 발급한 키를 입력해야 함.
 */

import { useEffect, useState } from "react"
import {
  IMAGE_PROVIDER_OPTIONS,
  clearImageProviderConfig,
  getSavedImageProviderConfig,
  saveImageProviderConfig,
} from "@/lib/ai/image-providers/registry"
import { GeminiFlashImageProvider } from "@/lib/ai/image-providers/gemini-flash-image"
import type { ImageProviderId } from "@/lib/ai/types"
import { t } from "@/lib/i18n"

export function ImageProviderGate() {
  const [providerId, setProviderId] = useState<ImageProviderId>(
    "gemini-2.5-flash-image",
  )
  const [apiKey, setApiKey] = useState("")
  const [savedMask, setSavedMask] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const saved = await getSavedImageProviderConfig()
      if (saved) {
        setProviderId(saved.providerId)
        setSavedMask(maskKey(saved.apiKey))
      }
    })()
  }, [])

  const handleSave = async () => {
    if (!apiKey.trim()) {
      setMsg(t.imageProvider.errors.empty)
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      // 진단
      const provider = new GeminiFlashImageProvider(apiKey.trim())
      const diag = await provider.diagnose()
      if (diag.status !== "ok") {
        setMsg(diag.message)
        return
      }
      await saveImageProviderConfig({ providerId, apiKey: apiKey.trim() })
      setSavedMask(maskKey(apiKey.trim()))
      setApiKey("")
      setMsg(t.imageProvider.savedOk)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "오류")
    } finally {
      setBusy(false)
    }
  }

  const handleClear = async () => {
    if (typeof window !== "undefined" && !window.confirm(t.imageProvider.confirmClear))
      return
    await clearImageProviderConfig()
    setSavedMask(null)
    setMsg(t.imageProvider.cleared)
  }

  const opt = IMAGE_PROVIDER_OPTIONS.find((o) => o.id === providerId)

  return (
    <div
      style={{
        padding: 18,
        background: "var(--color-bg-surface)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-neutral-100)",
        marginBottom: 20,
      }}
    >
      <h3
        style={{
          fontSize: 17,
          fontWeight: 800,
          color: "var(--color-neutral-900)",
          margin: 0,
          marginBottom: 4,
        }}
      >
        {t.imageProvider.title}
      </h3>
      <p
        style={{
          fontSize: 13,
          color: "var(--color-neutral-500)",
          margin: 0,
          marginBottom: 14,
          lineHeight: 1.5,
        }}
      >
        {t.imageProvider.subtitle}
      </p>

      <label
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 6,
          color: "var(--color-neutral-900)",
        }}
      >
        {t.imageProvider.providerLabel}
      </label>
      <select
        value={providerId}
        onChange={(e) => setProviderId(e.target.value as ImageProviderId)}
        style={{
          width: "100%",
          padding: "8px 10px",
          marginBottom: 6,
          border: "1px solid var(--color-neutral-300)",
          borderRadius: 6,
          fontSize: 14,
          background: "#FFFFFF",
        }}
      >
        {IMAGE_PROVIDER_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {opt && (
        <p
          style={{
            fontSize: 12,
            color: "var(--color-neutral-500)",
            margin: 0,
            marginBottom: 12,
            lineHeight: 1.45,
          }}
        >
          {opt.description}
          <br />
          <a
            href={opt.consoleUrl}
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: "#E03131", textDecoration: "underline" }}
          >
            {t.imageProvider.getKey}
          </a>
        </p>
      )}

      {savedMask ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 12px",
            background: "var(--color-bg-subtle)",
            borderRadius: 6,
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 13, color: "var(--color-neutral-700)" }}>
            ✅ {t.imageProvider.savedKey}: <code>{savedMask}</code>
          </span>
          <button
            type="button"
            onClick={() => void handleClear()}
            style={{
              padding: "4px 10px",
              fontSize: 12,
              border: "1px solid var(--color-neutral-300)",
              background: "#FFFFFF",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            {t.imageProvider.clear}
          </button>
        </div>
      ) : null}

      <label
        style={{
          display: "block",
          fontSize: 13,
          fontWeight: 600,
          marginBottom: 6,
          color: "var(--color-neutral-900)",
          marginTop: savedMask ? 8 : 0,
        }}
      >
        {savedMask ? t.imageProvider.replaceLabel : t.imageProvider.newLabel}
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={t.imageProvider.placeholder}
          style={{
            flex: 1,
            padding: "8px 10px",
            border: "1px solid var(--color-neutral-300)",
            borderRadius: 6,
            fontSize: 13,
            background: "#FFFFFF",
            fontFamily: "monospace",
          }}
        />
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={busy || !apiKey.trim()}
          style={{
            padding: "8px 14px",
            background: busy ? "var(--color-neutral-300)" : "#E03131",
            color: "#FFFFFF",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !apiKey.trim() ? "not-allowed" : "pointer",
          }}
        >
          {busy ? t.imageProvider.verifying : t.imageProvider.save}
        </button>
      </div>

      {msg && (
        <p
          style={{
            marginTop: 10,
            fontSize: 12,
            color: msg.includes("성공") || msg.includes("완료") ? "#2D9F45" : "#E03131",
          }}
        >
          {msg}
        </p>
      )}
    </div>
  )
}

function maskKey(key: string): string {
  if (key.length < 8) return "****"
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
