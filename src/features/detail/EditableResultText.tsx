"use client"

/**
 * EditableResultText — InlineEdit를 CopyOutput 경로 기반으로 래핑.
 *
 * 사용 예:
 *   <EditableResultText copy={copy} onChange={onCopyChange} path={["headline"]} />
 *   <EditableResultText copy={copy} onChange={onCopyChange} path={["story"]} multiline />
 *   <EditableResultText copy={copy} onChange={onCopyChange} path={["spec", 0, "value"]} />
 *   <EditableResultText copy={copy} onChange={onCopyChange} path={["faq", 1, "q"]} />
 *
 * 부모(ResultView)는 onCopyChange(updated: CopyOutput) 하나만 책임지면 된다.
 * 이 래퍼가 immutable update를 담당.
 */

import type { CSSProperties } from "react"
import type { CopyOutput, CopySpec, CopyFAQ, CopyKeyPoint } from "@/lib/ai/types"
import { InlineEdit } from "./InlineEdit"

/** CopyOutput 안에서 편집 가능한 string 경로. 타입 안전성을 위해 union으로 제한. */
export type CopyTextPath =
  | readonly ["headline"]
  | readonly ["subheadline"]
  | readonly ["story"]
  | readonly ["storage"]
  | readonly ["highlightBox"]
  | readonly ["spec", number, "label" | "value"]
  | readonly ["faq", number, "q" | "a"]
  | readonly ["highlightBadges", number]
  | readonly ["keyPoints", number, "title" | "body"]
  | readonly ["farmStory"]
  | readonly ["cautions", number]
  | readonly ["recommendFor", number]
  | readonly ["problemArc", "question"]
  | readonly ["problemArc", "problems", number]

export interface EditableResultTextProps {
  copy: CopyOutput
  onChange: (next: CopyOutput) => void
  path: CopyTextPath
  multiline?: boolean
  maxLength?: number
  placeholder?: string
  style?: CSSProperties
  disabled?: boolean
  ariaLabel?: string
  preserveWhitespace?: boolean
}

export function EditableResultText({
  copy,
  onChange,
  path,
  multiline,
  maxLength,
  placeholder,
  style,
  disabled,
  ariaLabel,
  preserveWhitespace,
}: EditableResultTextProps) {
  const current = readPath(copy, path)

  return (
    <InlineEdit
      value={current}
      onChange={(next) => onChange(writePath(copy, path, next))}
      multiline={multiline}
      maxLength={maxLength}
      placeholder={placeholder}
      style={style}
      disabled={disabled}
      ariaLabel={ariaLabel}
      preserveWhitespace={preserveWhitespace}
    />
  )
}

// ────────────────────────────────────────────────
// path read/write — narrow union 기반, any 금지
// ────────────────────────────────────────────────

function readPath(copy: CopyOutput, path: CopyTextPath): string {
  switch (path[0]) {
    case "headline":
      return copy.headline
    case "subheadline":
      return copy.subheadline
    case "story":
      return copy.story
    case "storage":
      return copy.storage
    case "spec": {
      const item = copy.spec[path[1]]
      if (!item) return ""
      return path[2] === "label" ? item.label : item.value
    }
    case "faq": {
      const item = copy.faq[path[1]]
      if (!item) return ""
      return path[2] === "q" ? item.q : item.a
    }
    case "highlightBadges":
      return copy.highlightBadges[path[1]] ?? ""
    case "highlightBox":
      return copy.highlightBox ?? ""
    case "keyPoints": {
      const item = copy.keyPoints?.[path[1]]
      if (!item) return ""
      return path[2] === "title" ? item.title : item.body
    }
    case "farmStory":
      return copy.farmStory
    case "cautions":
      return copy.cautions[path[1]] ?? ""
    case "recommendFor":
      return copy.recommendFor[path[1]] ?? ""
    case "problemArc": {
      const arc = copy.problemArc
      if (!arc) return ""
      if (path[1] === "question") return arc.question
      return arc.problems[path[2]] ?? ""
    }
  }
}

function writePath(copy: CopyOutput, path: CopyTextPath, next: string): CopyOutput {
  switch (path[0]) {
    case "headline":
      return { ...copy, headline: next }
    case "subheadline":
      return { ...copy, subheadline: next }
    case "story":
      return { ...copy, story: next }
    case "storage":
      return { ...copy, storage: next }
    case "spec": {
      const idx = path[1]
      const field = path[2]
      const nextSpec: CopySpec[] = copy.spec.map((s, i) =>
        i === idx ? { ...s, [field]: next } : s,
      )
      return { ...copy, spec: nextSpec }
    }
    case "faq": {
      const idx = path[1]
      const field = path[2]
      const nextFaq: CopyFAQ[] = copy.faq.map((f, i) =>
        i === idx ? { ...f, [field]: next } : f,
      )
      return { ...copy, faq: nextFaq }
    }
    case "highlightBadges": {
      const idx = path[1]
      const nextBadges = copy.highlightBadges.map((b, i) => (i === idx ? next : b))
      return { ...copy, highlightBadges: nextBadges }
    }
    case "highlightBox":
      return { ...copy, highlightBox: next }
    case "keyPoints": {
      const idx = path[1]
      const field = path[2]
      const src = copy.keyPoints ?? []
      const nextPoints: CopyKeyPoint[] = src.map((p, i) =>
        i === idx ? { ...p, [field]: next } : p,
      )
      return { ...copy, keyPoints: nextPoints }
    }
    case "farmStory":
      return { ...copy, farmStory: next }
    case "cautions": {
      const idx = path[1]
      const nextCautions = copy.cautions.map((c, i) => (i === idx ? next : c))
      return { ...copy, cautions: nextCautions }
    }
    case "recommendFor": {
      const idx = path[1]
      const nextItems = copy.recommendFor.map((r, i) => (i === idx ? next : r))
      return { ...copy, recommendFor: nextItems }
    }
    case "problemArc": {
      const arc = copy.problemArc
      if (!arc) return copy
      if (path[1] === "question") {
        return { ...copy, problemArc: { ...arc, question: next } }
      }
      const idx = path[2]
      const nextProblems = arc.problems.map((p, i) => (i === idx ? next : p))
      return { ...copy, problemArc: { ...arc, problems: nextProblems } }
    }
  }
}
