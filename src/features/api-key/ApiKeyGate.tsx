"use client"

import { useEffect, useRef, useState } from "react"
import { getKeySource, type KeyStoragePolicy } from "@/lib/ai/key-source"
import { getAIProvider } from "@/lib/ai/provider"
import type { DiagnosticResult } from "@/lib/ai/types"
import { t } from "@/lib/i18n"

interface ApiKeyGateProps {
  onSuccess: () => void
}

type DiagnosticStep = "idle" | "running" | "success" | "failed"

const API_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]+$/
const API_KEY_MIN_LEN = 80

export function ApiKeyGate({ onSuccess }: ApiKeyGateProps) {
  const [key, setKey] = useState("")
  const [policy, setPolicy] = useState<KeyStoragePolicy>("forever")
  const [spendLimitAck, setSpendLimitAck] = useState(false)
  const [step, setStep] = useState<DiagnosticStep>("idle")
  const [diagnostic, setDiagnostic] = useState<DiagnosticResult | null>(null)
  const [progressStep, setProgressStep] = useState<1 | 2 | 3>(1)
  const [formatWarning, setFormatWarning] = useState(false)

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [])

  const trimmedKey = key.trim()
  const keyValid = API_KEY_PATTERN.test(trimmedKey) && trimmedKey.length >= API_KEY_MIN_LEN
  const canSubmit = keyValid && spendLimitAck && step !== "running"

  const handleKeyChange = (raw: string) => {
    setKey(raw)
    if (raw.length === 0) {
      setFormatWarning(false)
      return
    }
    const t2 = raw.trim()
    setFormatWarning(t2.length > 0 && !API_KEY_PATTERN.test(t2))
  }

  const handleSubmit = async () => {
    setStep("running")
    setDiagnostic(null)
    setProgressStep(1)

    try {
      await getKeySource().setKey(trimmedKey, policy)
      setProgressStep(2)
      const result = await getAIProvider().diagnose()
      setProgressStep(3)
      setDiagnostic(result)
      if (result.status === "ok") {
        setStep("success")
        timeoutRef.current = setTimeout(() => {
          onSuccess()
          timeoutRef.current = null
        }, 800)
      } else {
        setStep("failed")
        await getKeySource().clearKey()
      }
    } catch (err) {
      console.error(err)
      setStep("failed")
      setDiagnostic({
        status: "unknown_error",
        reachable: false,
        modelAvailable: false,
        message: t.diagnostic.fail.unknown_error,
      })
      await getKeySource().clearKey()
    }
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 560,
        padding: "var(--space-10)",
        background: "var(--color-bg-surface)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div style={{ marginBottom: "var(--space-8)" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <span style={{ fontSize: 28 }}>🍑</span>
          <h1
            style={{
              fontSize: "var(--font-size-xl)",
              fontWeight: 600,
              color: "var(--color-neutral-900)",
            }}
          >
            {t.app.name} {t.apiKey.gateTitle}
          </h1>
        </div>
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-neutral-500)",
            lineHeight: 1.6,
          }}
        >
          {t.apiKey.step1Label}
        </p>
      </div>

      <div style={{ marginBottom: "var(--space-7)" }}>
        <label
          htmlFor="api-key-input"
          style={{
            display: "block",
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--color-neutral-900)",
            marginBottom: 6,
          }}
        >
          {t.apiKey.title}
        </label>
        <input
          id="api-key-input"
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={key}
          onChange={(e) => handleKeyChange(e.target.value)}
          placeholder={t.apiKey.placeholder}
          disabled={step === "running"}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: "1px solid var(--color-neutral-100)",
            borderRadius: "var(--radius-xs)",
            fontSize: "var(--font-size-md)",
            fontFamily: "monospace",
            color: "var(--color-neutral-900)",
            background: "var(--color-bg-surface)",
          }}
        />
        {formatWarning && (
          <p
            style={{
              fontSize: "var(--font-size-sm)",
              color: "var(--color-danger)",
              marginTop: 6,
            }}
          >
            {t.apiKey.invalidFormat}
          </p>
        )}
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-neutral-500)",
            marginTop: 8,
          }}
        >
          💡 {t.apiKey.needGuide}
        </p>
      </div>

      <fieldset style={{ marginBottom: "var(--space-7)", border: 0, padding: 0 }}>
        <legend
          style={{
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--color-neutral-900)",
            marginBottom: 8,
          }}
        >
          {t.apiKey.storage.title}
        </legend>
        {(["forever", "days_30", "days_7", "session"] as KeyStoragePolicy[]).map((p) => (
          <label
            key={p}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: "var(--font-size-sm)",
              color: "var(--color-neutral-900)",
              padding: "6px 0",
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="storage-policy"
              value={p}
              checked={policy === p}
              onChange={() => setPolicy(p)}
              disabled={step === "running"}
            />
            {p === "forever" && t.apiKey.storage.forever}
            {p === "session" && t.apiKey.storage.session}
            {p === "days_7" && t.apiKey.storage.days7}
            {p === "days_30" && t.apiKey.storage.days30}
          </label>
        ))}
      </fieldset>

      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: "var(--font-size-sm)",
          color: "var(--color-neutral-900)",
          marginBottom: "var(--space-7)",
          cursor: "pointer",
        }}
      >
        <input
          type="checkbox"
          checked={spendLimitAck}
          onChange={(e) => setSpendLimitAck(e.target.checked)}
          disabled={step === "running"}
        />
        ✅ {t.apiKey.spendLimitCheck}
      </label>

      {step === "running" && <DiagnosticProgress step={progressStep} />}

      {step === "success" && diagnostic && (
        <div
          style={{
            padding: 12,
            background: "var(--color-success-tint)",
            border: "1px solid var(--color-success)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-success)",
            fontSize: "var(--font-size-sm)",
            marginBottom: "var(--space-5)",
          }}
        >
          ✅ {diagnostic.message}
        </div>
      )}

      {step === "failed" && diagnostic && (
        <div
          style={{
            padding: 12,
            background: "var(--color-danger-tint)",
            border: "1px solid var(--color-danger)",
            borderRadius: "var(--radius-xs)",
            color: "var(--color-danger)",
            fontSize: "var(--font-size-sm)",
            marginBottom: "var(--space-5)",
            lineHeight: 1.5,
          }}
        >
          ❌ {diagnostic.message}
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleSubmit()}
        disabled={!canSubmit}
        style={{
          width: "100%",
          padding: "12px 16px",
          background: canSubmit ? "var(--color-primary-600)" : "var(--color-neutral-300)",
          color: "var(--color-text-on-primary)",
          border: "none",
          borderRadius: "var(--radius-xs)",
          fontSize: "var(--font-size-md)",
          fontWeight: 600,
          cursor: canSubmit ? "pointer" : "not-allowed",
          transition: "background 0.15s",
        }}
      >
        {step === "running" ? t.apiKey.verifying : t.apiKey.submit}
      </button>

      <p
        style={{
          fontSize: "var(--font-size-sm)",
          color: "var(--color-neutral-500)",
          marginTop: "var(--space-5)",
          lineHeight: 1.5,
          textAlign: "center",
        }}
      >
        ℹ️ {t.apiKey.notice}
      </p>
    </div>
  )
}

function DiagnosticProgress({ step }: { step: 1 | 2 | 3 }) {
  const items = [
    { n: 1, label: t.diagnostic.step1 },
    { n: 2, label: t.diagnostic.step2 },
    { n: 3, label: t.diagnostic.step3 },
  ]
  return (
    <div
      style={{
        padding: 16,
        background: "var(--color-bg-subtle)",
        borderRadius: "var(--radius-xs)",
        marginBottom: "var(--space-5)",
      }}
    >
      <p
        style={{
          fontSize: "var(--font-size-sm)",
          color: "var(--color-neutral-500)",
          marginBottom: 12,
        }}
      >
        {t.diagnostic.runningTitle}
      </p>
      {items.map((it) => {
        const state = step > it.n ? "done" : step === it.n ? "active" : "wait"
        return (
          <div
            key={it.n}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 0",
              fontSize: "var(--font-size-sm)",
              color:
                state === "wait"
                  ? "var(--color-neutral-400)"
                  : "var(--color-neutral-900)",
            }}
          >
            {state === "done" && "✅"}
            {state === "active" && "⏳"}
            {state === "wait" && "⚪"}
            <span>
              {it.n}/3 {it.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}
