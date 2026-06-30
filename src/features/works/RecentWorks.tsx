"use client"

import { useCallback, useEffect, useState } from "react"
import {
  deleteWork,
  exportAllWorksToJson,
  importBackupJson,
  listWorks,
  type WorkSummary,
} from "@/lib/storage/works-db"
import { t } from "@/lib/i18n"

interface RecentWorksProps {
  /** 카드 클릭 시 호출 — 부모는 해당 work를 로드해서 편집/재생성 화면으로 이동. */
  onSelect?: (id: string) => void
  /** 외부에서 갱신 강제할 때 키 증가시키면 재조회. */
  refreshKey?: number
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}.${m}.${day}`
}

export function RecentWorks({ onSelect, refreshKey = 0 }: RecentWorksProps) {
  const [works, setWorks] = useState<WorkSummary[] | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)

  const reload = useCallback(async () => {
    const list = await listWorks()
    setWorks(list)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  const handleDelete = useCallback(
    async (id: string) => {
      if (typeof window !== "undefined") {
        const ok = window.confirm(t.works.confirmDelete)
        if (!ok) return
      }
      setDeletingId(id)
      try {
        await deleteWork(id)
        await reload()
      } finally {
        setDeletingId(null)
      }
    },
    [reload],
  )

  const handleExport = useCallback(async () => {
    setBackupBusy(true)
    try {
      const data = await exportAllWorksToJson()
      const blob = new Blob([JSON.stringify(data)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      const ymd = new Date()
      const stamp = `${ymd.getFullYear()}${String(ymd.getMonth() + 1).padStart(2, "0")}${String(
        ymd.getDate(),
      ).padStart(2, "0")}`
      a.download = `fdp-backup-${stamp}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } finally {
      setBackupBusy(false)
    }
  }, [])

  const handleImport = useCallback(async () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = "application/json,.json"
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      setBackupBusy(true)
      try {
        const text = await file.text()
        const json = JSON.parse(text)
        const res = await importBackupJson(json, { merge: true })
        await reload()
        if (typeof window !== "undefined") {
          window.alert(
            `${res.imported}개 작업 복원 완료${res.skipped > 0 ? ` (${res.skipped}개 스킵)` : ""}`,
          )
        }
      } catch (e) {
        console.error("[import]", e)
        if (typeof window !== "undefined") {
          window.alert("백업 파일을 읽지 못했어요. 올바른 fdp-backup.json인지 확인해주세요.")
        }
      } finally {
        setBackupBusy(false)
      }
    }
    input.click()
  }, [reload])

  if (works === null) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "var(--space-7)",
          color: "var(--color-neutral-500)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        {t.app.loading}
      </div>
    )
  }

  if (works.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "var(--space-10) var(--space-5)",
          background: "var(--color-bg-surface)",
          borderRadius: "var(--radius-md)",
          border: "1px dashed var(--color-neutral-300)",
          color: "var(--color-neutral-500)",
          fontSize: "var(--font-size-sm)",
        }}
      >
        {t.works.empty}
      </div>
    )
  }

  return (
    <section>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <h3
          style={{
            fontSize: "var(--font-size-lg)",
            fontWeight: 700,
            color: "var(--color-neutral-900)",
            margin: 0,
          }}
        >
          {t.works.title}
        </h3>
        <div style={{ display: "flex", gap: 6 }}>
          <BackupButton
            onClick={() => void handleExport()}
            disabled={backupBusy || works.length === 0}
          >
            ⬇️ {t.works.backupExport}
          </BackupButton>
          <BackupButton onClick={() => void handleImport()} disabled={backupBusy}>
            ⬆️ {t.works.backupImport}
          </BackupButton>
        </div>
      </div>
      <p
        style={{
          fontSize: "var(--font-size-sm)",
          color: "var(--color-neutral-500)",
          marginBottom: 16,
        }}
      >
        {t.works.subtitle}
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: "var(--space-5)",
        }}
      >
        {works.map((w) => (
          <WorkCard
            key={w.id}
            work={w}
            disabled={deletingId === w.id}
            onOpen={() => onSelect?.(w.id)}
            onDelete={() => void handleDelete(w.id)}
          />
        ))}
      </div>
    </section>
  )
}

function BackupButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 10px",
        background: "var(--color-bg-surface)",
        border: "1px solid var(--color-neutral-300)",
        borderRadius: 6,
        fontSize: 12,
        color: "var(--color-neutral-700)",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function WorkCard({
  work,
  disabled,
  onOpen,
  onDelete,
}: {
  work: WorkSummary
  disabled: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <div
      style={{
        position: "relative",
        background: "var(--color-bg-surface)",
        borderRadius: "var(--radius-md)",
        border: "1px solid var(--color-neutral-100)",
        boxShadow: "var(--shadow-card)",
        overflow: "hidden",
        opacity: disabled ? 0.5 : 1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        style={{
          all: "unset",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          flexDirection: "column",
        }}
        aria-label={t.works.openAria.replace("{name}", work.productName)}
      >
        <div
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            background: "var(--color-neutral-100)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {work.thumbDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={work.thumbDataUrl}
              alt={work.productName}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <span
              style={{
                fontSize: 32,
                color: "var(--color-neutral-400)",
              }}
            >
              📄
            </span>
          )}
        </div>
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
          <div
            style={{
              fontSize: "var(--font-size-md)",
              fontWeight: 600,
              color: "var(--color-neutral-900)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {work.productName || t.works.untitled}
          </div>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-neutral-500)",
            }}
          >
            {formatDate(work.updatedAt)}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        disabled={disabled}
        title={t.works.delete}
        aria-label={t.works.deleteAria.replace("{name}", work.productName)}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "none",
          background: "rgba(0,0,0,0.55)",
          color: "#fff",
          fontSize: 14,
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ×
      </button>
    </div>
  )
}
