"use client"

import { useState } from "react"
import { exportNodeAsSlicedJpg } from "@/lib/exporters/html-to-jpg"
import { t } from "@/lib/i18n"

interface ExportPanelProps {
  /** 캡처 대상 DOM 노드 (ResultView 전체) */
  targetRef: React.RefObject<HTMLElement | null>
  /** 파일명 접두사 */
  baseName: string
}

type SliceMode = "sections" | "single"
type WidthPreset = 780 | 860 | 1000 | 831

const WIDTH_PRESETS: { value: WidthPreset; label: string }[] = [
  { value: 780, label: t.detail.result.exportPanel.platformCoupang },
  { value: 860, label: t.detail.result.exportPanel.platformSmartstore },
  { value: 831, label: t.detail.result.exportPanel.platform11st },
  { value: 1000, label: t.detail.result.exportPanel.platformSelf },
]

export function ExportPanel({ targetRef, baseName }: ExportPanelProps) {
  const [width, setWidth] = useState<WidthPreset>(860)
  const [slice, setSlice] = useState<SliceMode>("sections")
  const [targetSliceHeight, setTargetSliceHeight] = useState<number>(3000)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  )

  const handleDownload = async () => {
    if (!targetRef.current) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await exportNodeAsSlicedJpg(targetRef.current, {
        width,
        mode: slice,
        targetSliceHeight,
        quality: 0.92,
        pixelRatio: 2,
        baseName,
      })
      setMessage({
        kind: "success",
        text: t.detail.result.exportPanel.files.replace(
          "{count}",
          String(result.fileCount),
        ),
      })
    } catch (err) {
      console.error(err)
      setMessage({ kind: "error", text: t.detail.result.exportPanel.error })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        background: "var(--color-bg-subtle)",
        borderRadius: "var(--radius-xs)",
        padding: "var(--space-5)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h4
        style={{
          fontSize: "var(--font-size-md)",
          fontWeight: 700,
          color: "var(--color-neutral-900)",
          margin: 0,
        }}
      >
        {t.detail.result.exportPanel.title}
      </h4>

      <div>
        <label
          style={{
            display: "block",
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--color-neutral-900)",
            marginBottom: 6,
          }}
        >
          {t.detail.result.exportPanel.widthLabel}
        </label>
        <select
          value={width}
          onChange={(e) => setWidth(Number(e.target.value) as WidthPreset)}
          disabled={busy}
          style={selectStyle}
        >
          {WIDTH_PRESETS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          style={{
            display: "block",
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--color-neutral-900)",
            marginBottom: 6,
          }}
        >
          {t.detail.result.exportPanel.sliceLabel}
        </label>
        <select
          value={slice}
          onChange={(e) => setSlice(e.target.value as SliceMode)}
          disabled={busy}
          style={selectStyle}
        >
          <option value="sections">{t.detail.result.exportPanel.sliceAuto}</option>
          <option value="single">{t.detail.result.exportPanel.sliceSingle}</option>
        </select>
        {slice === "single" && (
          <p
            style={{
              marginTop: 6,
              fontSize: "var(--font-size-sm)",
              color: "var(--color-danger)",
              lineHeight: 1.4,
            }}
          >
            {t.detail.result.exportPanel.warningIos}
          </p>
        )}
      </div>

      {slice === "sections" && (
        <div>
          <label
            style={{
              display: "block",
              fontSize: "var(--font-size-sm)",
              fontWeight: 600,
              color: "var(--color-neutral-900)",
              marginBottom: 6,
            }}
          >
            장당 목표 세로 크기
          </label>
          <select
            value={targetSliceHeight}
            onChange={(e) => setTargetSliceHeight(Number(e.target.value))}
            disabled={busy}
            style={selectStyle}
          >
            <option value={2000}>2000px (짧게 · 파일 많음)</option>
            <option value={3000}>3000px (권장 · 쿠팡·스마트스토어 기본)</option>
            <option value={4000}>4000px (길게 · 컬리·자사몰)</option>
            <option value={5000}>5000px (매우 길게)</option>
          </select>
          <p
            style={{
              marginTop: 6,
              fontSize: 11,
              color: "var(--color-neutral-600)",
              lineHeight: 1.5,
            }}
          >
            섹션 사이의 자연 경계에서 자르기 때문에 실제 크기는 이 값보다 약간 작을 수 있어요.
            내용이 중간에 잘리지 않아요.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={busy}
        style={{
          marginTop: 4,
          padding: "12px 16px",
          background: busy ? "var(--color-neutral-300)" : "var(--color-primary-600)",
          color: "var(--color-text-on-primary)",
          border: "none",
          borderRadius: "var(--radius-xs)",
          fontSize: "var(--font-size-md)",
          fontWeight: 700,
          cursor: busy ? "not-allowed" : "pointer",
        }}
      >
        {busy
          ? `⏳ ${t.detail.result.exportPanel.downloading}`
          : `📥 ${t.detail.result.exportPanel.download}`}
      </button>

      {message && (
        <div
          style={{
            padding: 10,
            borderRadius: "var(--radius-xs)",
            fontSize: "var(--font-size-sm)",
            background:
              message.kind === "success"
                ? "var(--color-success-tint)"
                : "var(--color-danger-tint)",
            color:
              message.kind === "success"
                ? "var(--color-success)"
                : "var(--color-danger)",
          }}
        >
          {message.kind === "success" ? "✅ " : "⚠️ "}
          {message.text}
        </div>
      )}
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid var(--color-neutral-300)",
  borderRadius: "var(--radius-xs)",
  background: "var(--color-bg-surface)",
  color: "var(--color-neutral-900)",
  fontSize: "var(--font-size-sm)",
  cursor: "pointer",
}
