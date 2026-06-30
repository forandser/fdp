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
