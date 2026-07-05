"use client"

import { useCallback, useRef, useState } from "react"
import { t } from "@/lib/i18n"

export interface UploadedImage {
  id: string
  file: File
  url: string
  width: number
  height: number
}

interface ImageUploaderProps {
  images: UploadedImage[]
  onChange: (images: UploadedImage[]) => void
  maxCount?: number
  maxSizeMB?: number
}

function loadImage(file: File): Promise<{ url: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new window.Image()
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("이미지 로드 실패"))
    }
    img.src = url
  })
}

export function ImageUploader({
  images,
  onChange,
  maxCount = 30,
  maxSizeMB = 10,
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const remaining = maxCount - images.length

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList).slice(0, remaining)
      setErrorMsg(null)
      const validFiles: File[] = []
      for (const f of files) {
        if (!f.type.startsWith("image/")) continue
        if (f.size > maxSizeMB * 1024 * 1024) {
          setErrorMsg(`${f.name} 파일이 ${maxSizeMB}MB를 초과해요`)
          continue
        }
        validFiles.push(f)
      }
      const loaded: UploadedImage[] = []
      for (const f of validFiles) {
        try {
          const meta = await loadImage(f)
          loaded.push({
            id: `${Date.now()}-${Math.round(performance.now())}-${loaded.length}`,
            file: f,
            ...meta,
          })
        } catch {
          // skip
        }
      }
      if (loaded.length > 0) {
        onChange([...images, ...loaded])
      }
    },
    [images, onChange, remaining, maxSizeMB],
  )

  const handleRemove = (id: string) => {
    const removed = images.find((i) => i.id === id)
    if (removed) URL.revokeObjectURL(removed.url)
    onChange(images.filter((i) => i.id !== id))
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer?.files?.length) {
      void addFiles(e.dataTransfer.files)
    }
  }

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-10) var(--space-7)",
          border: `2px dashed ${
            isDragging ? "var(--color-primary-600)" : "var(--color-neutral-300)"
          }`,
          borderRadius: "var(--radius-md)",
          background: isDragging
            ? "var(--color-primary-50)"
            : "var(--color-bg-subtle)",
          cursor: remaining > 0 ? "pointer" : "not-allowed",
          textAlign: "center",
          transition: "all 0.15s",
        }}
      >
        <div style={{ fontSize: 36, marginBottom: 8 }}>📷</div>
        <p
          style={{
            fontSize: "var(--font-size-md)",
            fontWeight: 600,
            color: "var(--color-neutral-900)",
            marginBottom: 6,
          }}
        >
          {t.detail.dropzone.title}
        </p>
        <p style={{ fontSize: "var(--font-size-sm)", color: "var(--color-neutral-500)" }}>
          {t.detail.dropzone.tip}
        </p>
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-primary-600)",
            marginTop: 8,
            fontWeight: 600,
          }}
        >
          {images.length} / {maxCount}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files)
            e.target.value = ""
          }}
          style={{ display: "none" }}
        />
      </div>

      {errorMsg && (
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-danger)",
            marginTop: 8,
          }}
        >
          ⚠️ {errorMsg}
        </p>
      )}

      {images.length === 0 && (
        <p
          style={{
            fontSize: "var(--font-size-sm)",
            color: "var(--color-neutral-400)",
            marginTop: 12,
            textAlign: "center",
          }}
        >
          {t.detail.dropzone.empty}
        </p>
      )}

      {images.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))",
            gap: 10,
            marginTop: 16,
          }}
        >
          {images.map((img, idx) => (
            <div
              key={img.id}
              style={{
                position: "relative",
                aspectRatio: "1",
                borderRadius: "var(--radius-xs)",
                overflow: "hidden",
                border: "1px solid var(--color-neutral-100)",
                background: "var(--color-bg-subtle)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={`업로드 ${idx + 1}`}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
              <span
                style={{
                  position: "absolute",
                  top: 4,
                  left: 4,
                  background: "rgba(0,0,0,0.6)",
                  color: "var(--color-text-on-primary)",
                  fontSize: 10,
                  padding: "1px 5px",
                  borderRadius: 2,
                }}
              >
                {idx + 1}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(img.id)}
                aria-label={`이미지 ${idx + 1} 삭제`}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "rgba(0,0,0,0.6)",
                  border: "none",
                  color: "var(--color-text-on-primary)",
                  fontSize: 12,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * v3.7: 전용 사진 슬롯 업로더 — 포장/크기비교 옵션 카드용 소형 단일 슬롯.
 *
 * 일반 ImageUploader(다중·드롭존)와 별개로, 한 장만 넣고 교체/삭제하는 카드.
 * 여기서 넣은 사진은 일반 풀(planImages)에 절대 섞이지 않는다 — 호출부가 별도 상태로 관리.
 * 촬영 팁 한 줄(tip)을 카드 안에 표시해 셀러가 무엇을 찍어야 하는지 유도한다.
 */
export function SingleSlotUploader({
  image,
  onChange,
  title,
  tip,
  emoji,
  maxSizeMB = 10,
}: {
  image: UploadedImage | null
  onChange: (next: UploadedImage | null) => void
  /** 카드 제목 (예: "📦 포장 사진"). */
  title: string
  /** 촬영 팁 한 줄 (예: "송장·완충재가 보이게"). */
  tip: string
  /** 좌측 아이콘 이모지 (예: "📦" / "📏"). */
  emoji: string
  maxSizeMB?: number
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const pick = useCallback(
    async (file: File) => {
      setErrorMsg(null)
      if (!file.type.startsWith("image/")) {
        setErrorMsg("이미지 파일만 넣을 수 있어요")
        return
      }
      if (file.size > maxSizeMB * 1024 * 1024) {
        setErrorMsg(`${maxSizeMB}MB를 초과해요`)
        return
      }
      try {
        const meta = await loadImage(file)
        // 이전 슬롯 사진 objectURL 정리 후 교체.
        if (image) URL.revokeObjectURL(image.url)
        onChange({
          id: `slot-${Date.now()}-${Math.round(performance.now())}`,
          file,
          ...meta,
        })
      } catch {
        setErrorMsg("이미지를 불러오지 못했어요")
      }
    },
    [image, onChange, maxSizeMB],
  )

  const handleRemove = () => {
    if (image) URL.revokeObjectURL(image.url)
    onChange(null)
    setErrorMsg(null)
  }

  return (
    <div
      style={{
        border: "1px solid var(--color-neutral-100)",
        borderRadius: "var(--radius-xs)",
        padding: "12px 14px",
        background: "var(--color-bg-subtle)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span aria-hidden style={{ fontSize: 22, lineHeight: 1.1 }}>
          {emoji}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: "var(--font-size-sm)",
              fontWeight: 700,
              color: "var(--color-neutral-900)",
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-neutral-500)",
              lineHeight: 1.4,
              marginTop: 2,
            }}
          >
            📸 {tip}
          </div>
        </div>
      </div>

      {image ? (
        <div
          style={{
            position: "relative",
            borderRadius: "var(--radius-xs)",
            overflow: "hidden",
            border: "1px solid var(--color-neutral-100)",
            background: "#fff",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt={title}
            style={{
              width: "100%",
              maxHeight: 180,
              objectFit: "contain",
              display: "block",
              background: "#fff",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              display: "flex",
              gap: 6,
            }}
          >
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                background: "rgba(0,0,0,0.6)",
                border: "none",
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              교체
            </button>
            <button
              type="button"
              onClick={handleRemove}
              aria-label={`${title} 삭제`}
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.6)",
                border: "none",
                color: "#fff",
                fontSize: 14,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
            >
              ×
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{
            padding: "16px 12px",
            border: "2px dashed var(--color-neutral-300)",
            borderRadius: "var(--radius-xs)",
            background: "var(--color-bg-surface)",
            color: "var(--color-neutral-700)",
            fontSize: "var(--font-size-sm)",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          + 사진 넣기 (선택)
        </button>
      )}

      {errorMsg && (
        <p style={{ fontSize: "var(--font-size-xs)", color: "var(--color-danger)", margin: 0 }}>
          ⚠️ {errorMsg}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void pick(f)
          e.target.value = ""
        }}
        style={{ display: "none" }}
      />
    </div>
  )
}
