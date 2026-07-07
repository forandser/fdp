"use client"

/**
 * v5.0-B: "🏪 우리 가게" 사이드바 패널 — 브랜드 프로필 관리 + 선택.
 *
 * 이 패널은 브랜드 목록의 소유자가 아니다(DetailMaker 가 brands 를 소유·재로딩한다).
 * 여기서는 화면을 그리고 DB 변경(추가/편집/삭제/기본지정/불러오기)을 실행한 뒤
 * onBrandsChanged() 로 부모에게 재로딩을 요청한다. 선택 변경은 onSelect(brandId) 로 통지하고,
 * 부모가 그 프로필을 toSnapshot → Work.brandSnapshot 으로 박제한다.
 *
 * 편집기 영역이므로 이모지·CSS 변수 사용 OK(아트보드 위생 규칙은 ResultView 에만 적용).
 * 로고 미리보기는 objectURL(편집기 표시용). 아트보드로 나가는 로고는 부모가 toSnapshot 에서
 * dataURL 로 다운스케일한다(외부 URL 없음).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  newBrandId,
  saveBrand,
  deleteBrand,
  setDefaultBrandId,
  exportBrandsToJson,
  importBrandsJson,
  type BrandProfile,
} from "@/lib/storage/brand-db"

// 저장 경계(brand-db)와 동일 상한 — 입력 단계에서도 막아 사용자에게 즉시 피드백.
const NAME_MAX = 30
const SIGNATURE_MAX = 80
const CONTACT_MAX = 60
const LOGO_MAX_MB = 5

/** 대표색 프리셋 6종 — 과일 셀러가 자주 쓰는 밝은 톤. */
const COLOR_PRESETS = ["#E03131", "#F76707", "#F59F00", "#2F9E44", "#1971C2", "#7048E8"]
const DEFAULT_COLOR = "#E03131"

export interface BrandKitPanelProps {
  /** 전체 브랜드 목록(부모 소유). */
  brands: BrandProfile[]
  /** 현재 선택된 프로필 id. null 이면 미선택(또는 작업 박제 스냅샷 적용 중). */
  selectedBrandId: string | null
  /** 기본 브랜드 id — 드롭다운/목록에 별표 표시. */
  defaultBrandId: string | null
  /**
   * 작업에 박제된(불변) 스냅샷이 프로필과 미연결로 적용 중일 때 그 이름.
   * 있으면 "이 작업에 저장된 브랜드" 안내를 띄운다(프로필 선택 시 교체).
   */
  appliedSnapshotName?: string | null
  /** 사용자가 드롭다운에서 프로필 선택(선택 해제 시 null). */
  onSelect: (brandId: string | null) => void
  /** DB 변경 후 부모가 목록을 재로딩하도록. */
  onBrandsChanged: () => void | Promise<void>
  /** 생성 중 등 상호작용 잠금. */
  disabled?: boolean
}

type FormMode = "idle" | "add" | "edit"

export function BrandKitPanel({
  brands,
  selectedBrandId,
  defaultBrandId,
  appliedSnapshotName,
  onSelect,
  onBrandsChanged,
  disabled = false,
}: BrandKitPanelProps) {
  const [mode, setMode] = useState<FormMode>("idle")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [signature, setSignature] = useState("")
  const [contact, setContact] = useState("")
  /** 편집 중 로고 원본 Blob(그대로 saveBrand 에 전달). null 이면 로고 없음. */
  const [logoBlob, setLogoBlob] = useState<Blob | null>(null)
  /** 로고 미리보기 objectURL(편집기 표시용). 우리가 만든 것만 담아 cleanup 에서 revoke. */
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [importMsg, setImportMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const logoInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  /** 우리가 생성한 현재 preview objectURL(교체·언마운트 시 revoke 대상). */
  const previewUrlRef = useRef<string | null>(null)

  const setPreview = useCallback((url: string | null) => {
    if (previewUrlRef.current && previewUrlRef.current !== url) {
      URL.revokeObjectURL(previewUrlRef.current)
    }
    previewUrlRef.current = url
    setLogoPreview(url)
  }, [])

  // 언마운트 시 preview objectURL 정리.
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
    }
  }, [])

  const resetForm = useCallback(() => {
    setName("")
    setColor(DEFAULT_COLOR)
    setSignature("")
    setContact("")
    setLogoBlob(null)
    setPreview(null)
    setFormError(null)
    setEditingId(null)
  }, [setPreview])

  const openAdd = useCallback(() => {
    resetForm()
    setMode("add")
  }, [resetForm])

  const openEdit = useCallback(
    (brand: BrandProfile) => {
      setEditingId(brand.id)
      setName(brand.name)
      setColor(brand.color || DEFAULT_COLOR)
      setSignature(brand.signature || "")
      setContact(brand.contact || "")
      setLogoBlob(brand.logoBlob ?? null)
      setPreview(brand.logoBlob ? URL.createObjectURL(brand.logoBlob) : null)
      setFormError(null)
      setMode("edit")
    },
    [setPreview],
  )

  const closeForm = useCallback(() => {
    resetForm()
    setMode("idle")
  }, [resetForm])

  const pickLogo = useCallback(
    (file: File) => {
      setFormError(null)
      if (!file.type.startsWith("image/")) {
        setFormError("이미지 파일만 넣을 수 있어요")
        return
      }
      if (file.size > LOGO_MAX_MB * 1024 * 1024) {
        setFormError(`로고는 ${LOGO_MAX_MB}MB 이하여야 해요`)
        return
      }
      setLogoBlob(file)
      setPreview(URL.createObjectURL(file))
    },
    [setPreview],
  )

  const removeLogo = useCallback(() => {
    setLogoBlob(null)
    setPreview(null)
  }, [setPreview])

  const submitForm = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError("스토어명을 입력해주세요")
      return
    }
    setBusy(true)
    try {
      const isNew = mode === "add" || !editingId
      const id = isNew ? newBrandId() : editingId
      const now = Date.now()
      const profile: BrandProfile = {
        id,
        name: trimmed.slice(0, NAME_MAX),
        logoBlob,
        color,
        signature: signature.trim().slice(0, SIGNATURE_MAX) || undefined,
        contact: contact.trim().slice(0, CONTACT_MAX) || undefined,
        // createdAt 은 저장 경계에서 기존값 보존(재저장 시). 신규는 now.
        createdAt: now,
        updatedAt: now,
      }
      await saveBrand(profile)
      // 첫 브랜드는 자동으로 기본 지정(셀러가 별도 클릭 없이 바로 쓰도록).
      if (isNew && brands.length === 0) {
        await setDefaultBrandId(id)
      }
      await onBrandsChanged()
      // 신규 추가·현재 선택 중인 프로필 편집이면 선택 상태로(스냅샷 갱신 유도).
      if (isNew || id === selectedBrandId) {
        onSelect(id)
      }
      closeForm()
    } catch (e) {
      console.error("[brand-save]", e)
      setFormError("저장에 실패했어요")
    } finally {
      setBusy(false)
    }
  }, [
    name,
    mode,
    editingId,
    logoBlob,
    color,
    signature,
    contact,
    brands.length,
    selectedBrandId,
    onBrandsChanged,
    onSelect,
    closeForm,
  ])

  const handleDelete = useCallback(
    async (brand: BrandProfile) => {
      if (typeof window !== "undefined") {
        const ok = window.confirm(`'${brand.name}' 브랜드를 삭제할까요?`)
        if (!ok) return
      }
      setBusy(true)
      try {
        await deleteBrand(brand.id)
        await onBrandsChanged()
        if (brand.id === selectedBrandId) onSelect(null)
        if (editingId === brand.id) closeForm()
      } catch (e) {
        console.error("[brand-delete]", e)
      } finally {
        setBusy(false)
      }
    },
    [onBrandsChanged, selectedBrandId, onSelect, editingId, closeForm],
  )

  const handleSetDefault = useCallback(
    async (id: string) => {
      setBusy(true)
      try {
        // 이미 기본이면 해제(토글), 아니면 기본 지정.
        await setDefaultBrandId(defaultBrandId === id ? null : id)
        await onBrandsChanged()
      } catch (e) {
        console.error("[brand-default]", e)
      } finally {
        setBusy(false)
      }
    },
    [defaultBrandId, onBrandsChanged],
  )

  const handleExport = useCallback(async () => {
    setImportMsg(null)
    try {
      const data = await exportBrandsToJson()
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      const date = new Date().toISOString().slice(0, 10)
      a.href = url
      a.download = `fdp-brands_${date}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error("[brand-export]", e)
      setImportMsg("내보내기에 실패했어요")
    }
  }, [])

  const handleImport = useCallback(
    async (file: File) => {
      setImportMsg(null)
      setBusy(true)
      try {
        const text = await file.text()
        const raw = JSON.parse(text) as unknown
        const res = await importBrandsJson(raw)
        await onBrandsChanged()
        setImportMsg(
          `브랜드 ${res.imported}개 불러왔어요${res.skipped > 0 ? ` (건너뜀 ${res.skipped}개)` : ""}`,
        )
      } catch (e) {
        console.error("[brand-import]", e)
        setImportMsg("불러오기에 실패했어요 (파일 형식 확인)")
      } finally {
        setBusy(false)
      }
    },
    [onBrandsChanged],
  )

  const lock = disabled || busy

  /** 드롭다운 표시값 — 작업 박제 스냅샷 적용 중이면 특수 옵션 선택. */
  const showWorkOption = selectedBrandId === null && !!appliedSnapshotName
  const selectValue = selectedBrandId ?? (showWorkOption ? "__work__" : "")

  const editingBrand = useMemo(
    () => (editingId ? brands.find((b) => b.id === editingId) ?? null : null),
    [editingId, brands],
  )

  return (
    <section style={{ marginBottom: 28 }}>
      <div
        style={{
          padding: "14px 16px",
          background: "var(--color-bg-subtle)",
          border: "1px solid var(--color-neutral-200)",
          borderRadius: "var(--radius-xs)",
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 800, color: "var(--color-neutral-900)" }}>
          🏪 우리 가게
        </div>
        <p
          style={{
            fontSize: 12,
            color: "var(--color-neutral-600)",
            lineHeight: 1.5,
            margin: "4px 0 12px",
          }}
        >
          로고·대표색·서명·문의를 저장해두면 상세페이지에 브랜드가 자동으로 들어가요.
        </p>

        {/* 프로필 선택 드롭다운 */}
        <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--color-neutral-700)" }}>
            적용할 브랜드
          </span>
          <select
            value={selectValue}
            disabled={lock}
            onChange={(e) => {
              const v = e.target.value
              if (v === "__work__") return // 작업 박제 유지 — 변화 없음
              onSelect(v === "" ? null : v)
            }}
            style={{
              ...selectStyle,
              cursor: lock ? "not-allowed" : "pointer",
            }}
          >
            {showWorkOption && (
              <option value="__work__">📌 {appliedSnapshotName} (이 작업에 저장됨)</option>
            )}
            <option value="">{brands.length === 0 ? "브랜드 없음" : "선택 안 함"}</option>
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.id === defaultBrandId ? "★ " : ""}
                {b.name}
              </option>
            ))}
          </select>
        </label>

        {showWorkOption && (
          <p
            style={{
              fontSize: 11,
              color: "var(--color-neutral-600)",
              lineHeight: 1.5,
              margin: "0 0 10px",
              padding: "6px 10px",
              background: "var(--color-bg-surface)",
              border: "1px dashed var(--color-neutral-300)",
              borderRadius: 4,
            }}
          >
            이 작업에는 <strong>{appliedSnapshotName}</strong> 브랜드가 저장돼 있어요. 위에서 프로필을
            선택하면 그 브랜드로 교체돼요.
          </p>
        )}

        {/* 브랜드 관리 목록 — 기본 지정 별표 · 편집 · 삭제 */}
        {brands.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {brands.map((b) => {
              const isDefault = b.id === defaultBrandId
              const isSelected = b.id === selectedBrandId
              return (
                <div
                  key={b.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: "var(--radius-xs)",
                    border: isSelected
                      ? "2px solid var(--color-primary-600)"
                      : "1px solid var(--color-neutral-200)",
                    background: "var(--color-bg-surface)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      flexShrink: 0,
                      background: b.color || "var(--color-neutral-300)",
                      border: "1px solid rgba(0,0,0,0.1)",
                    }}
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 13,
                      fontWeight: 700,
                      color: "var(--color-neutral-900)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleSetDefault(b.id)}
                    disabled={lock}
                    title={isDefault ? "기본 브랜드 해제" : "기본 브랜드로 지정"}
                    aria-label={isDefault ? "기본 브랜드 해제" : "기본 브랜드로 지정"}
                    style={{
                      ...iconBtnStyle,
                      color: isDefault ? "#F59F00" : "var(--color-neutral-400)",
                      cursor: lock ? "not-allowed" : "pointer",
                    }}
                  >
                    {isDefault ? "★" : "☆"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(b)}
                    disabled={lock}
                    title="편집"
                    aria-label={`${b.name} 편집`}
                    style={{ ...iconBtnStyle, cursor: lock ? "not-allowed" : "pointer" }}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(b)}
                    disabled={lock}
                    title="삭제"
                    aria-label={`${b.name} 삭제`}
                    style={{
                      ...iconBtnStyle,
                      color: "var(--color-danger)",
                      cursor: lock ? "not-allowed" : "pointer",
                    }}
                  >
                    🗑
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* 추가/편집 인라인 폼 */}
        {mode === "idle" ? (
          <button
            type="button"
            onClick={openAdd}
            disabled={lock}
            style={{
              width: "100%",
              padding: "10px 12px",
              background: "var(--color-bg-surface)",
              border: "1px dashed var(--color-neutral-300)",
              borderRadius: "var(--radius-xs)",
              color: "var(--color-neutral-700)",
              fontSize: 13,
              fontWeight: 700,
              cursor: lock ? "not-allowed" : "pointer",
            }}
          >
            + 브랜드 추가
          </button>
        ) : (
          <div
            style={{
              padding: "12px 12px",
              border: "1px solid var(--color-neutral-200)",
              borderRadius: "var(--radius-xs)",
              background: "var(--color-bg-surface)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--color-neutral-900)" }}>
              {mode === "add" ? "새 브랜드" : `브랜드 편집${editingBrand ? ` — ${editingBrand.name}` : ""}`}
            </div>

            {/* 스토어명(필수) */}
            <label style={fieldLabelStyle}>
              <span style={fieldTitleStyle}>
                스토어명 <span style={{ color: "var(--color-danger)" }}>*</span>
              </span>
              <input
                type="text"
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
                placeholder="예) 청송 김농부 사과"
                style={panelInputStyle}
              />
              <span style={countStyle}>
                {name.length} / {NAME_MAX}
              </span>
            </label>

            {/* 로고 업로드 + 미리보기 */}
            <div style={fieldLabelStyle}>
              <span style={fieldTitleStyle}>로고 (선택)</span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    flexShrink: 0,
                    borderRadius: "var(--radius-xs)",
                    border: "1px solid var(--color-neutral-200)",
                    background: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}
                >
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={logoPreview}
                      alt="로고 미리보기"
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  ) : (
                    <span aria-hidden style={{ fontSize: 22, opacity: 0.4 }}>
                      🏷️
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    style={smallBtnStyle}
                  >
                    {logoPreview ? "로고 교체" : "로고 올리기"}
                  </button>
                  {logoPreview && (
                    <button
                      type="button"
                      onClick={removeLogo}
                      style={{ ...smallBtnStyle, color: "var(--color-danger)" }}
                    >
                      로고 제거
                    </button>
                  )}
                </div>
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) pickLogo(f)
                  e.target.value = ""
                }}
              />
            </div>

            {/* 대표색 */}
            <div style={fieldLabelStyle}>
              <span style={fieldTitleStyle}>대표색</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  aria-label="대표색 선택"
                  style={{
                    width: 40,
                    height: 32,
                    padding: 0,
                    border: "1px solid var(--color-neutral-200)",
                    borderRadius: 6,
                    background: "none",
                    cursor: "pointer",
                  }}
                />
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      aria-label={`대표색 ${c}`}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        background: c,
                        border:
                          color.toLowerCase() === c.toLowerCase()
                            ? "3px solid var(--color-neutral-900)"
                            : "1px solid rgba(0,0,0,0.15)",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* 서명 문구 */}
            <label style={fieldLabelStyle}>
              <span style={fieldTitleStyle}>서명 문구 (선택)</span>
              <input
                type="text"
                value={signature}
                maxLength={SIGNATURE_MAX}
                onChange={(e) => setSignature(e.target.value.slice(0, SIGNATURE_MAX))}
                placeholder="예) 정직하게 키운 과일만 보냅니다"
                style={panelInputStyle}
              />
              <span style={countStyle}>
                {signature.length} / {SIGNATURE_MAX}
              </span>
            </label>

            {/* 문의 안내 */}
            <label style={fieldLabelStyle}>
              <span style={fieldTitleStyle}>문의 안내 (선택)</span>
              <input
                type="text"
                value={contact}
                maxLength={CONTACT_MAX}
                onChange={(e) => setContact(e.target.value.slice(0, CONTACT_MAX))}
                placeholder="예) 카톡 @김농부 · 평일 9-18시"
                style={panelInputStyle}
              />
              <span style={countStyle}>
                {contact.length} / {CONTACT_MAX}
              </span>
            </label>

            {formError && (
              <p style={{ margin: 0, fontSize: 12, color: "var(--color-danger)", fontWeight: 600 }}>
                ⚠️ {formError}
              </p>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => void submitForm()}
                disabled={lock}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  background: "var(--color-primary-600)",
                  color: "var(--color-text-on-primary)",
                  border: "none",
                  borderRadius: "var(--radius-xs)",
                  fontSize: 13,
                  fontWeight: 800,
                  cursor: lock ? "not-allowed" : "pointer",
                }}
              >
                저장
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={busy}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  background: "var(--color-bg-surface)",
                  color: "var(--color-neutral-700)",
                  border: "1px solid var(--color-neutral-300)",
                  borderRadius: "var(--radius-xs)",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                취소
              </button>
            </div>
          </div>
        )}

        {/* 내보내기 / 불러오기 */}
        <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={lock || brands.length === 0}
            style={{
              ...outlineBtnStyle,
              cursor: lock || brands.length === 0 ? "not-allowed" : "pointer",
              opacity: brands.length === 0 ? 0.5 : 1,
            }}
          >
            💾 내보내기
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={lock}
            style={{ ...outlineBtnStyle, cursor: lock ? "not-allowed" : "pointer" }}
          >
            📤 불러오기
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleImport(f)
              e.target.value = ""
            }}
          />
        </div>
        {importMsg && (
          <p style={{ margin: "8px 0 0", fontSize: 11, color: "var(--color-neutral-600)" }}>
            {importMsg}
          </p>
        )}
      </div>
    </section>
  )
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid var(--color-neutral-200)",
  borderRadius: "var(--radius-xs)",
  fontSize: 13,
  background: "var(--color-bg-surface)",
  color: "var(--color-neutral-900)",
  fontFamily: "inherit",
}

const panelInputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  border: "1px solid var(--color-neutral-200)",
  borderRadius: "var(--radius-xs)",
  fontSize: 13,
  background: "var(--color-bg-surface)",
  color: "var(--color-neutral-900)",
  fontFamily: "inherit",
}

const fieldLabelStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
}

const fieldTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--color-neutral-700)",
}

const countStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--color-neutral-500)",
  textAlign: "right",
}

const iconBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "none",
  border: "none",
  fontSize: 15,
  padding: 0,
  lineHeight: 1,
}

const smallBtnStyle: React.CSSProperties = {
  padding: "6px 12px",
  background: "var(--color-bg-surface)",
  border: "1px solid var(--color-neutral-300)",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 700,
  color: "var(--color-neutral-900)",
  cursor: "pointer",
}

const outlineBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  background: "var(--color-bg-surface)",
  border: "1px solid var(--color-neutral-300)",
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 700,
  color: "var(--color-neutral-900)",
}
