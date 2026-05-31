import type { AnalysisResult, DocumentDeadline } from "./types"

const VERDICTS = new Set(["legitimate", "suspicious", "likely_illegal"])
const SEVERITIES = new Set(["high", "medium", "low"])
const URGENCIES = new Set(["critical", "high", "medium"])
const DATE_TYPES = new Set(["absolute", "relative"])
const LETTER_TONES = new Set(["firm", "cooperative", "hardship", "assertive"])

function parseDeadline(raw: unknown): DocumentDeadline | null {
  if (!raw || typeof raw !== "object") return null
  const d = raw as Record<string, unknown>
  if (
    typeof d.label !== "string" ||
    typeof d.description !== "string" ||
    typeof d.urgency !== "string" ||
    !URGENCIES.has(d.urgency) ||
    typeof d.date_type !== "string" ||
    !DATE_TYPES.has(d.date_type) ||
    typeof d.source_text !== "string"
  ) {
    return null
  }
  if (d.absolute_date !== undefined && typeof d.absolute_date !== "string") return null
  if (d.relative_rule !== undefined && typeof d.relative_rule !== "string") return null
  if (d.anchor_date !== undefined && typeof d.anchor_date !== "string") return null

  return {
    label: d.label,
    description: d.description,
    urgency: d.urgency as DocumentDeadline["urgency"],
    date_type: d.date_type as DocumentDeadline["date_type"],
    absolute_date: d.absolute_date as string | undefined,
    relative_rule: d.relative_rule as string | undefined,
    anchor_date: d.anchor_date as string | undefined,
    source_text: d.source_text,
  }
}

export function parseAnalysisResult(data: unknown): AnalysisResult | null {
  if (!data || typeof data !== "object") return null
  const o = data as Record<string, unknown>

  if (typeof o.plain_summary !== "string") return null
  if (typeof o.response_letter !== "string") return null
  if (typeof o.overall_verdict !== "string" || !VERDICTS.has(o.overall_verdict)) return null
  if (!Array.isArray(o.red_flags) || !Array.isArray(o.next_steps)) return null

  for (const flag of o.red_flags) {
    if (!flag || typeof flag !== "object") return null
    const f = flag as Record<string, unknown>
    if (
      typeof f.issue !== "string" ||
      typeof f.explanation !== "string" ||
      typeof f.source_text !== "string" ||
      typeof f.severity !== "string" ||
      !SEVERITIES.has(f.severity)
    ) {
      return null
    }
  }

  for (const step of o.next_steps) {
    if (!step || typeof step !== "object") return null
    const s = step as Record<string, unknown>
    if (
      typeof s.action !== "string" ||
      typeof s.reason !== "string" ||
      typeof s.priority !== "number"
    ) {
      return null
    }
  }

  let deadlines: DocumentDeadline[] | undefined
  if (o.deadlines !== undefined) {
    if (!Array.isArray(o.deadlines)) return null
    deadlines = []
    for (const item of o.deadlines) {
      const parsed = parseDeadline(item)
      if (parsed) {
        deadlines.push(parsed)
      } else {
        // Stay corruption-resilient (one bad deadline must not void the whole
        // analysis), but make the loss observable — metadata only, no content.
        const d = (item ?? {}) as Record<string, unknown>
        console.warn("[validate] dropped malformed deadline", {
          hasLabel: typeof d.label === "string",
          urgency: typeof d.urgency === "string" ? d.urgency : typeof d.urgency,
          dateType: typeof d.date_type === "string" ? d.date_type : typeof d.date_type,
        })
      }
    }
  }

  if (o.letter_tone !== undefined) {
    if (typeof o.letter_tone !== "string" || !LETTER_TONES.has(o.letter_tone)) return null
  }

  return {
    plain_summary: o.plain_summary,
    red_flags: o.red_flags,
    response_letter: o.response_letter,
    next_steps: o.next_steps,
    overall_verdict: o.overall_verdict,
    ...(deadlines !== undefined ? { deadlines } : {}),
    ...(o.letter_tone !== undefined ? { letter_tone: o.letter_tone as AnalysisResult["letter_tone"] } : {}),
  } as AnalysisResult
}
