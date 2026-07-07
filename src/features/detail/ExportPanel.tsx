"use client"

import { useEffect, useState } from "react"
import { exportNodeAsSlicedJpg } from "@/lib/exporters/html-to-jpg"
import { t } from "@/lib/i18n"
import { STORAGE_KEYS } from "@/lib/storage/keys"
import {
  isFsAccessSupported,
  pickDirectory,
  getStoredDirectoryHandle,
  ensurePermission,
  clearStoredHandle,
} from "@/lib/fs/directory-handle"

interface ExportPanelProps {
  /** 캡처 대상 DOM 노드 (ResultView 전체) */
  targetRef: React.RefObject<HTMLElement | null>
  /** 파일명 접두사 */
  baseName: string
  /**
   * 지정되면 다운로드를 막고 이유를 표시한다.
   * (빈 카피 상태로 placeholder투성이 JPG를 저장하는 사고 방지 — v3.0.1)
   */
  blockedReason?: string
}

type SliceMode = "sections" | "single"
type WidthPreset = 780 | 860 | 1000 | 831

const WIDTH_PRESETS: { value: WidthPreset; label: string }[] = [
  { value: 780, label: t.detail.result.exportPanel.platformCoupang },
  { value: 860, label: t.detail.result.exportPanel.platformSmartstore },
  { value: 831, label: t.detail.result.exportPanel.platform11st },
  { value: 1000, label: t.detail.result.exportPanel.platformSelf },
]

/**
 * v2.7: File System Access API 지원 여부 (Chrome/Edge only).
 * v5.4 하이드레이션 수정: 모듈 상수로 두면 서버(false)와 클라이언트(Edge true)가 갈려
 * 프리렌더 HTML과 첫 클라이언트 렌더가 어긋난다(React #418 실측). 컴포넌트 안에서
 * 서버 기본값(false)으로 시작해 마운트 후 동기화한다 — 아래 useState/useEffect 참고.
 */
const supportsDirPickerNow = () => isFsAccessSupported()

/** v5.4(작업4): 내보내기 설정 복원 시 허용값 화이트리스트 — 저장본 오염 방어. */
const VALID_WIDTHS = new Set<WidthPreset>([780, 860, 831, 1000])
const VALID_SLICE_HEIGHTS = new Set<number>([2000, 3000, 4000, 5000])

export function ExportPanel({ targetRef, baseName, blockedReason }: ExportPanelProps) {
  const [width, setWidth] = useState<WidthPreset>(860)
  const [slice, setSlice] = useState<SliceMode>("sections")
  const [targetSliceHeight, setTargetSliceHeight] = useState<number>(3000)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(
    null,
  )
  /** v2.7: 사용자가 선택한 저장 폴더 핸들. 미선택 = 다운로드 폴더로 저장. */
  const [directoryHandle, setDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(
    null,
  )
  const [directoryName, setDirectoryName] = useState<string>("")
  /** 서버 기본값(false)으로 프리렌더와 일치시키고 마운트 후 실제 지원 여부로 동기화. */
  const [supportsDirPicker, setSupportsDirPicker] = useState(false)

  /**
   * v5.4(작업4): 마운트 시 내보내기 설정 복원.
   * - 폭 프리셋·장당 세로 크기: localStorage(fdp:export-presets)
   * - 저장 폴더: IDB 영속 핸들(directory-handle.ts) — 권한 요청은 다운로드 시점(사용자 제스처)으로 미룸.
   *   (마운트 시 requestPermission은 제스처가 없어 실패하므로 이름만 복원해 표시.)
   */
  useEffect(() => {
    setSupportsDirPicker(supportsDirPickerNow())
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.EXPORT_PRESETS)
      if (raw) {
        const parsed = JSON.parse(raw) as { width?: number; targetSliceHeight?: number }
        if (VALID_WIDTHS.has(parsed.width as WidthPreset)) {
          setWidth(parsed.width as WidthPreset)
        }
        if (typeof parsed.targetSliceHeight === "number" && VALID_SLICE_HEIGHTS.has(parsed.targetSliceHeight)) {
          setTargetSliceHeight(parsed.targetSliceHeight)
        }
      }
    } catch {
      // 프라이빗 모드·오염 JSON 등 복원 실패는 무시하고 기본값 사용
    }
    void (async () => {
      const handle = await getStoredDirectoryHandle()
      if (handle) {
        setDirectoryHandle(handle)
        setDirectoryName(handle.name)
      }
    })()
  }, [])

  /** v5.4(작업4): 폭·장당 세로 크기 변경을 localStorage에 즉시 기억. */
  const persistPresets = (next: { width: WidthPreset; targetSliceHeight: number }) => {
    try {
      localStorage.setItem(STORAGE_KEYS.EXPORT_PRESETS, JSON.stringify(next))
    } catch {
      // 저장 실패(프라이빗 모드 등)는 무시 — 이번 세션 동작엔 영향 없음
    }
  }

  const handleChangeWidth = (value: WidthPreset) => {
    setWidth(value)
    persistPresets({ width: value, targetSliceHeight })
  }

  const handleChangeSliceHeight = (value: number) => {
    setTargetSliceHeight(value)
    persistPresets({ width, targetSliceHeight: value })
  }

  const handlePickDirectory = async () => {
    // pickDirectory: showDirectoryPicker 호출 + IDB 영속 저장 + 취소 시 null.
    const handle = await pickDirectory()
    if (handle) {
      setDirectoryHandle(handle)
      setDirectoryName(handle.name)
    }
  }

  const handleClearDirectory = () => {
    setDirectoryHandle(null)
    setDirectoryName("")
    void clearStoredHandle()
  }

  const handleDownload = async () => {
    if (!targetRef.current) return
    setBusy(true)
    setMessage(null)
    try {
      // v5.4(작업4): 세션 넘어 복원된 핸들은 권한이 만료됐을 수 있다.
      // 이 클릭이 사용자 제스처이므로 여기서 재요청(자연 재요청). 실패 시 undefined → 다운로드 폴더 폴백.
      let dir = directoryHandle ?? undefined
      if (dir) {
        const granted = await ensurePermission(dir).catch(() => false)
        if (!granted) dir = undefined
      }
      const result = await exportNodeAsSlicedJpg(targetRef.current, {
        width,
        mode: slice,
        targetSliceHeight,
        quality: 0.92,
        pixelRatio: 2,
        baseName,
        directoryHandle: dir,
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
          onChange={(e) => handleChangeWidth(Number(e.target.value) as WidthPreset)}
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
            onChange={(e) => handleChangeSliceHeight(Number(e.target.value))}
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

      {/* v2.7: 저장 위치 선택 (File System Access API, Chrome/Edge만) */}
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
          저장 위치
        </label>
        {supportsDirPicker ? (
          <>
            {directoryName ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 10px",
                  background: "var(--color-success-tint)",
                  border: "1px solid var(--color-success)",
                  borderRadius: "var(--radius-xs)",
                  fontSize: 12,
                  color: "var(--color-neutral-900)",
                }}
              >
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  📁 {directoryName}
                </span>
                <button
                  type="button"
                  onClick={handleClearDirectory}
                  disabled={busy}
                  style={{
                    padding: "3px 8px",
                    background: "transparent",
                    border: "1px solid var(--color-neutral-300)",
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: "pointer",
                    color: "var(--color-neutral-700)",
                  }}
                >
                  변경
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handlePickDirectory()}
                disabled={busy}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  background: "var(--color-bg-surface)",
                  border: "1px dashed var(--color-neutral-300)",
                  borderRadius: "var(--radius-xs)",
                  fontSize: "var(--font-size-sm)",
                  color: "var(--color-neutral-700)",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
              >
                📁 저장 폴더 선택
              </button>
            )}
            <p
              style={{
                marginTop: 6,
                fontSize: 11,
                color: "var(--color-neutral-600)",
                lineHeight: 1.5,
              }}
            >
              {directoryName
                ? "선택한 폴더에 바로 저장됩니다."
                : "선택 안 하면 브라우저 기본 다운로드 폴더로 저장돼요."}
            </p>
          </>
        ) : (
          <p
            style={{
              margin: 0,
              padding: "8px 10px",
              background: "var(--color-bg-subtle)",
              borderRadius: "var(--radius-xs)",
              fontSize: 11.5,
              color: "var(--color-neutral-600)",
              lineHeight: 1.5,
            }}
          >
            브라우저 기본 다운로드 폴더로 저장돼요. 폴더 선택은 Chrome·Edge에서만 지원됩니다.
          </p>
        )}
      </div>

      {blockedReason && (
        <p
          style={{
            margin: 0,
            padding: "10px 12px",
            background: "var(--color-bg-surface)",
            border: "1px solid var(--color-neutral-100)",
            borderRadius: "var(--radius-xs)",
            fontSize: "var(--font-size-sm)",
            color: "var(--color-neutral-700)",
            lineHeight: 1.5,
          }}
        >
          ✍️ {blockedReason}
        </p>
      )}

      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={busy || blockedReason != null}
        style={{
          marginTop: 4,
          padding: "12px 16px",
          background:
            busy || blockedReason != null
              ? "var(--color-neutral-300)"
              : "var(--color-primary-600)",
          color: "var(--color-text-on-primary)",
          border: "none",
          borderRadius: "var(--radius-xs)",
          fontSize: "var(--font-size-md)",
          fontWeight: 700,
          cursor: busy || blockedReason != null ? "not-allowed" : "pointer",
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
