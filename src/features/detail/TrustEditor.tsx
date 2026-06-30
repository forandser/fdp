"use client"

/**
 * 신뢰 옵션 입력 — 토글 4개 + 인증번호 3개 + 수확일.
 *
 * 식약처/원산지표시법/친환경농어업법에 따라 인증번호 입력이 없으면
 * "유기농/무농약/GAP" 같은 표현이 카피에 들어갈 수 없음.
 * 이 컴포넌트의 입력은 fruit-copy 프롬프트 규칙 17번이 처리.
 */

import type { TrustInfo } from "@/lib/ai/types"
import { t } from "@/lib/i18n"

interface Props {
  value: TrustInfo
  onChange: (next: TrustInfo) => void
}

export function TrustEditor({ value, onChange }: Props) {
  const set = <K extends keyof TrustInfo>(key: K, v: TrustInfo[K]) => {
    onChange({ ...value, [key]: v })
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <ToggleRow
        label={t.detail.trust.sameDayHarvest}
        on={!!value.sameDayHarvest}
        onChange={(v) => set("sameDayHarvest", v)}
      />
      <ToggleRow
        label={t.detail.trust.coldChain}
        on={!!value.coldChain}
        onChange={(v) => set("coldChain", v)}
      />
      <ToggleRow
        label={t.detail.trust.directFromFarm}
        on={!!value.directFromFarm}
        onChange={(v) => set("directFromFarm", v)}
      />
      <ToggleRow
        label={t.detail.trust.refundGuarantee}
        on={!!value.refundGuarantee}
        onChange={(v) => set("refundGuarantee", v)}
      />

      <div
        style={{
          marginTop: 6,
          paddingTop: 14,
          borderTop: "1px solid var(--color-neutral-100)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        <CertField
          label={t.detail.trust.gapNumber}
          placeholder={t.detail.trust.gapNumberPh}
          value={value.gapNumber ?? ""}
          onChange={(v) => set("gapNumber", v)}
        />
        <CertField
          label={t.detail.trust.organicNumber}
          placeholder={t.detail.trust.organicNumberPh}
          value={value.organicNumber ?? ""}
          onChange={(v) => set("organicNumber", v)}
        />
        <CertField
          label={t.detail.trust.pesticideFreeNumber}
          placeholder={t.detail.trust.pesticideFreeNumberPh}
          value={value.pesticideFreeNumber ?? ""}
          onChange={(v) => set("pesticideFreeNumber", v)}
        />
        <CertField
          label={t.detail.trust.harvestDateLabel}
          placeholder={t.detail.trust.harvestDateLabelPh}
          value={value.harvestDateLabel ?? ""}
          onChange={(v) => set("harvestDateLabel", v)}
        />
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  on,
  onChange,
}: {
  label: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        fontSize: "var(--font-size-md)",
        color: "var(--color-neutral-900)",
      }}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "#E03131", width: 18, height: 18 }}
      />
      {label}
    </label>
  )
}

function CertField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span
        style={{
          fontSize: "var(--font-size-sm)",
          fontWeight: 600,
          color: "var(--color-neutral-700)",
        }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 60))}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "8px 10px",
          border: "1px solid var(--color-neutral-100)",
          borderRadius: "var(--radius-xs)",
          fontSize: "var(--font-size-sm)",
          background: "var(--color-bg-surface)",
          color: "var(--color-neutral-900)",
          fontFamily: "inherit",
        }}
      />
    </label>
  )
}
