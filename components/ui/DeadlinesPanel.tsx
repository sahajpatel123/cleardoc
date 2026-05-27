"use client"

import { useState } from "react"
import { CalendarPlus, AlertTriangle } from "lucide-react"
import type { DocumentDeadline } from "@/lib/types"
import { buildIcsEvent, computeDeadlineDate, downloadIcsFile } from "@/lib/ics"

interface Props {
  deadlines: DocumentDeadline[]
}

const URGENCY_STYLE: Record<
  DocumentDeadline["urgency"],
  { border: string; bg: string; label: string; labelClass: string }
> = {
  critical: {
    border: "rgba(229,90,62,0.35)",
    bg: "rgba(229,90,62,0.08)",
    label: "Critical",
    labelClass: "label-red",
  },
  high: {
    border: "rgba(245,166,35,0.35)",
    bg: "rgba(245,166,35,0.08)",
    label: "High",
    labelClass: "label-amber",
  },
  medium: {
    border: "rgba(255,106,31,0.25)",
    bg: "rgba(255,106,31,0.05)",
    label: "Medium",
    labelClass: "label-ember",
  },
}

function formatDisplayDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function DeadlineRow({ deadline, index }: { deadline: DocumentDeadline; index: number }) {
  const style = URGENCY_STYLE[deadline.urgency]
  const defaultAnchor =
    deadline.anchor_date ??
    (deadline.date_type === "relative" ? new Date().toISOString().slice(0, 10) : "")
  const [anchorDate, setAnchorDate] = useState(defaultAnchor)

  const eventDate = computeDeadlineDate(deadline, anchorDate || undefined)

  const handleDownload = () => {
    if (!eventDate) return
    const ics = buildIcsEvent({
      title: deadline.label,
      description: `${deadline.description}\n\nSource: "${deadline.source_text}"`,
      startDate: eventDate,
      uid: `cleardoc-deadline-${index}-${Date.now()}@cleardoc.app`,
    })
    const slug = deadline.label.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 40)
    downloadIcsFile(ics, `${slug || "deadline"}.ics`)
  }

  return (
    <div
      className="p-5 rounded-lg border space-y-4"
      style={{ borderColor: style.border, background: style.bg }}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={`label ${style.labelClass}`}>{style.label}</span>
            <p
              style={{
                color: "var(--text)",
                fontFamily: "var(--font-syne,'Syne',sans-serif)",
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              {deadline.label}
            </p>
          </div>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
            {deadline.description}
          </p>
          <p className="mono text-[10px] mt-3 leading-relaxed" style={{ color: "var(--text-mute)" }}>
            &ldquo;{deadline.source_text}&rdquo;
          </p>
        </div>
        {eventDate && (
          <p
            className="mono text-[11px] shrink-0"
            style={{ color: deadline.urgency === "critical" ? "var(--red)" : "var(--amber)" }}
          >
            {formatDisplayDate(eventDate)}
          </p>
        )}
      </div>

      {deadline.date_type === "relative" && (
        <div className="flex flex-col sm:flex-row sm:items-end gap-3 pt-2 border-t" style={{ borderColor: style.border }}>
          <div className="flex-1">
            <label className="mono text-[10px] tracking-[0.18em] block mb-2" style={{ color: "var(--text-mute)" }}>
              {deadline.relative_rule ?? "Relative deadline"} — confirm receipt / notice date
            </label>
            <input
              type="date"
              value={anchorDate}
              onChange={(e) => setAnchorDate(e.target.value)}
              className="field w-full max-w-xs"
            />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleDownload}
        disabled={!eventDate}
        className="btn btn-ghost !py-2 !px-4 !text-[13px] disabled:opacity-40"
      >
        <CalendarPlus className="w-4 h-4" />
        Add to calendar
      </button>
    </div>
  )
}

export default function DeadlinesPanel({ deadlines }: Props) {
  if (deadlines.length === 0) return null

  const sorted = [...deadlines].sort(
    (a, b) =>
      ({ critical: 0, high: 1, medium: 2 }[a.urgency] - { critical: 0, high: 1, medium: 2 }[b.urgency]),
  )

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 mb-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--amber)" }} />
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
          Confirm dates before adding to your calendar — especially for relative deadlines.
        </p>
      </div>
      {sorted.map((d, i) => (
        <DeadlineRow key={`${d.label}-${i}`} deadline={d} index={i} />
      ))}
    </div>
  )
}
