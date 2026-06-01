/**
 * @deprecated Use `lib/schemas.ts` `safeParseAnalysisResult` for new writes.
 *
 * This module provides two parsers:
 *
 *   - `parseAnalysisResult` / `safeParseAnalysisResult` — strict. Rejects the
 *     entire analysis if any field is malformed. Used for new analyses and
 *     the analyze write path.
 *
 *   - `parseAnalysisResultLenient` — used for *reading* legacy analyses that
 *     were saved by the pre-remediation validator (which tolerated and
 *     dropped malformed deadlines / extra fields per field). The lenient
 *     parser:
 *       1. Tries strict first.
 *       2. On failure, runs a tolerant per-field recovery that strips
 *          unknown keys, drops malformed deadlines instead of rejecting the
 *          whole record, clamps red_flags to the schema's max, etc.
 *       3. Re-runs the strict parser on the recovered object.
 *
 *     Legacy rows saved before the strict validator are still rendered for
 *     chat, rephrase, and dashboard loads. New writes still go through the
 *     strict parser.
 */
import { z } from "zod"
import { safeParseAnalysisResult, AnalysisResultSchema } from "./schemas"
import type { AnalysisResultStrict as AnalysisResult } from "./schemas"

export const parseAnalysisResult = safeParseAnalysisResult
export type { AnalysisResult }

const TolerantDeadlineSchema = z
  .object({
    date_type: z.union([z.literal("absolute"), z.literal("relative")]).optional(),
    absolute_date: z.string().optional(),
    relative_rule: z.string().optional(),
    anchor_date: z.string().optional(),
    label: z.string().optional(),
    description: z.string().optional(),
    urgency: z.union([z.literal("critical"), z.literal("high"), z.literal("medium")]).optional(),
    source_text: z.string().optional(),
  })
  .passthrough()

/** Per-field recovery for a legacy analysis row. Returns a strict-valid object or null. */
function recoverStrict(input: unknown): unknown {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>

  // Strict-validate the top-level shape first; if it already passes, no work.
  if (safeParseAnalysisResult(raw)) return raw

  // Recover deadlines: drop entries that violate the discriminated union.
  // Anything in `deadlines` must be a full Absolute or Relative deadline;
  // legacy rows may have hybrids or missing fields. We keep the entry only
  // if it's unambiguous and re-strict-validates.
  let recoveredDeadlines: unknown[] | undefined
  if (Array.isArray(raw.deadlines)) {
    recoveredDeadlines = raw.deadlines.filter((d: unknown) => {
      const parsed = TolerantDeadlineSchema.safeParse(d)
      if (!parsed.success) return false
      const v = parsed.data
      if (v.date_type === "absolute") {
        return typeof v.absolute_date === "string" && v.absolute_date.length > 0
      }
      if (v.date_type === "relative") {
        return (
          typeof v.relative_rule === "string" &&
          v.relative_rule.length > 0 &&
          typeof v.anchor_date === "string" &&
          v.anchor_date.length > 0
        )
      }
      // No date_type means pre-remediation row; drop rather than guess.
      return false
    })
  }

  // Try again with the cleaned deadlines array.
  const candidate: Record<string, unknown> = { ...raw, deadlines: recoveredDeadlines }
  // Strip any extra top-level keys not in the strict schema (defense-in-depth).
  const allowedKeys = new Set([
    "plain_summary",
    "red_flags",
    "response_letter",
    "next_steps",
    "overall_verdict",
    "deadlines",
    "letter_tone",
  ])
  for (const k of Object.keys(candidate)) {
    if (!allowedKeys.has(k)) delete candidate[k]
  }
  // Re-validate strict.
  const result = AnalysisResultSchema.safeParse(candidate)
  if (result.success) return result.data
  return null
}

export function parseAnalysisResultLenient(raw: unknown): AnalysisResult | null {
  const strict = safeParseAnalysisResult(raw)
  if (strict) return strict
  const recovered = recoverStrict(raw)
  if (recovered == null) return null
  return safeParseAnalysisResult(recovered)
}
