/** Build a minimal RFC 5545 .ics file for a single all-day or timed deadline event. */
export function buildIcsEvent(opts: {
  title: string
  description: string
  startDate: Date
  uid?: string
}): string {
  if (Number.isNaN(opts.startDate.getTime())) {
    throw new Error("buildIcsEvent: invalid startDate")
  }

  const pad = (n: number) => String(n).padStart(2, "0")
  const formatDate = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
  const formatUtc = (d: Date) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`

  const dtstamp = formatUtc(new Date())
  const dtstart = formatDate(opts.startDate)
  const end = new Date(opts.startDate)
  end.setUTCDate(end.getUTCDate() + 1)
  const dtend = formatDate(end)
  // crypto.randomUUID() produces a collision-resistant UID without relying on
  // Date.now() (non-deterministic, poor entropy, breaks idempotent exports).
  // Callers can override via opts.uid for fully deterministic IDs.
  const uid =
    opts.uid ??
    (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? `cleardoc-${crypto.randomUUID()}@cleardoc.app`
      : `cleardoc-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}@cleardoc.app`)

  const escape = (s: string) =>
    s
      .replace(/\\/g, "\\\\")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "")
      .replace(/\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")

  const foldLine = (line: string): string => {
    const parts: string[] = []
    let remaining = line
    while (remaining.length > 75) {
      let splitAt = 75
      // Don't split in the middle of an escape sequence (backslash + char)
      if (remaining[splitAt - 1] === "\\") splitAt = 74
      parts.push(remaining.slice(0, splitAt))
      remaining = " " + remaining.slice(splitAt)
    }
    parts.push(remaining)
    return parts.join("\r\n")
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ClearDoc//Deadline Export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    foldLine(`UID:${uid}`),
    foldLine(`DTSTAMP:${dtstamp}`),
    foldLine(`DTSTART;VALUE=DATE:${dtstart}`),
    foldLine(`DTEND;VALUE=DATE:${dtend}`),
    foldLine(`SUMMARY:${escape(opts.title)}`),
    foldLine(`DESCRIPTION:${escape(opts.description)}`),
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n")
}

/** Parse YYYY-MM-DD as UTC noon (avoids DST/timezone date drift). Returns null if invalid. */
export function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  const d = Number(m[3])
  const date = new Date(Date.UTC(y, mo, d, 12, 0, 0))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo || date.getUTCDate() !== d) {
    return null
  }
  return date
}

/** Extract day count from rules like "30 days from notice date". */
export function parseRelativeDays(rule: string): number | null {
  const m = /(\d+)\s*day/i.exec(rule)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

export function computeDeadlineDate(
  deadline: {
    date_type: "absolute" | "relative"
    absolute_date?: string
    relative_rule?: string
    anchor_date?: string
  },
  userAnchorDate?: string,
): Date | null {
  if (deadline.date_type === "absolute" && deadline.absolute_date) {
    return parseIsoDate(deadline.absolute_date)
  }
  const anchor = userAnchorDate ?? deadline.anchor_date
  if (!anchor) return null
  const base = parseIsoDate(anchor)
  if (!base || !deadline.relative_rule) return null
  const days = parseRelativeDays(deadline.relative_rule)
  if (!days) return null
  const result = new Date(base)
  result.setUTCDate(result.getUTCDate() + days)
  return result
}

export function downloadIcsFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename.endsWith(".ics") ? filename : `${filename}.ics`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
