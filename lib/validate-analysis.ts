import type { AnalysisResult } from "@/lib/types"

const VERDICTS = new Set(["legitimate", "suspicious", "likely_illegal"])
const SEVERITIES = new Set(["high", "medium", "low"])

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

  return {
    plain_summary: o.plain_summary,
    red_flags: o.red_flags,
    response_letter: o.response_letter,
    next_steps: o.next_steps,
    overall_verdict: o.overall_verdict,
  } as AnalysisResult
}
