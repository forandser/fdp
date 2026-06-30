"use client"

/**
 * 작업 JSON 내보내기/임포트 (v1.9).
 *
 * 현재 작업을 JSON 파일로 내보내거나, 외부 JSON을 받아 카피만 복원.
 * 이미지는 포함 X (base64 너무 큼). 이미지는 별도 업로드 필요.
 *
 * 사용처:
 * - 다른 PC/브라우저로 작업 백업
 * - 셀러 간 카피 공유
 * - 작업 안전망 (브라우저 IDB 손실 시 복원)
 */

import { useRef, useState } from "react"
import type { CopyOutput, TrustInfo } from "@/lib/ai/types"

export interface WorkSnapshot {
  version: 1
  exportedAt: string
  productName: string
  price: number
  origin?: string
  weight?: string
  copy: CopyOutput
  trust?: TrustInfo
}

interface WorkJsonExporterProps {
  copy: CopyOutput
  productName: string
  price: number
  origin?: string
  weight?: string
  trust?: TrustInfo
  /** 임포트 시 카피를 부모에 반영. */
  onImport?: (copy: CopyOutput) => void
}

export function WorkJsonExporter({
  copy,
  productName,
  price,
  origin,
  weight,
  trust,
  onImport,
}: WorkJsonExporterProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const handleExport = () => {
    const snapshot: WorkSnapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      productName,
      price,
      origin,
      weight,
      copy,
      trust,
    }
    const json = JSON.stringify(snapshot, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const date = new Date().toISOString().slice(0, 10)
    const safeName = (productName || "fdp-work").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40)
    a.href = url
    a.download = `${safeName}_${date}.fdp.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file: File) => {
    setImportError(null)
    try {
      const text = await file.text()
      const data = JSON.parse(text) as unknown
      if (typeof data !== "object" || data === null) {
        setImportError("JSON 형식이 올바르지 않아요.")
        return
      }
      const snap = data as Partial<WorkSnapshot>
      if (!snap.copy || typeof snap.copy !== "object") {
        setImportError("copy 필드가 없는 JSON이에요.")
        return
      }
      if (onImport) {
        onImport(snap.copy as CopyOutput)
      }
    } catch (e) {
      console.error("[json-import]", e)
      setImportError("JSON 파싱에 실패했어요.")
    }
  }

  return (
    <div className="fdp-no-print" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={handleExport}
          style={{
            flex: 1,
            padding: "8px 10px",
            background: "var(--color-bg-surface)",
            border: "1px solid var(--color-neutral-300)",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-neutral-900)",
            cursor: "pointer",
          }}
        >
          💾 JSON 내보내기
        </button>
        {onImport && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            style={{
              flex: 1,
              padding: "8px 10px",
              background: "var(--color-bg-surface)",
              border: "1px solid var(--color-neutral-300)",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--color-neutral-900)",
              cursor: "pointer",
            }}
          >
            📤 JSON 불러오기
          </button>
        )}
      </div>
      {onImport && (
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleImport(f)
            // 입력 초기화 (같은 파일 재선택 가능하도록)
            e.target.value = ""
          }}
        />
      )}
      {importError && (
        <p style={{ margin: 0, fontSize: 11, color: "var(--color-danger)" }}>
          ⚠️ {importError}
        </p>
      )}
    </div>
  )
}
