/**
 * Strict runtime validation for AI outputs and user-submitted payloads.
 *
 * Why zod: the previous validate-analysis.ts used hand-written type guards
 * that allowed `NaN` / `Infinity` for numeric fields, accepted the model
 * output's "outermost { ... }" slice regardless of nested braces, and ended
 * with a terminal `as AnalysisResult` cast that laundered unsoundness
 * through the type system. Zod gives us:
 *
 *   - finite-only numbers (z.number().finite())
 *   - bounded array lengths (prevents model-output DoS)
 *   - discriminated union for date_type (rejects invalid relative/absolute mixes)
 *   - parse() returns a typed result OR throws — no `as` laundering
 *
 * The exported schemas are the new trust boundary. The route layer must
 * call .parse() on every AI response and on every user-submitted body.
 */
import { z } from "zod"

// ── Primitive constraints ───────────────────────────────────────────

const NonEmptyString = z.string().min(1).max(100_000)
const ShortString = z.string().min(1).max(2_000)
const LabelString = z.string().min(1).max(200)
const DescriptionString = z.string().min(1).max(2_000)
const IsoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")

// Finite, in-range, safe-integer-friendly priority. NaN/Infinity rejected.
const Priority = z
  .number()
  .finite()
  .min(1)
  .max(10)
  .refine((n) => Number.isSafeInteger(n), "Priority must be a safe integer")

// ── Enums ──────────────────────────────────────────────────────────

const Verdict = z.enum(["legitimate", "suspicious", "likely_illegal"])
const Severity = z.enum(["high", "medium", "low"])
const Urgency = z.enum(["critical", "high", "medium"])
const LetterTone = z.enum(["firm", "cooperative", "hardship", "assertive"])

// ── Deadline (relative vs absolute) ────────────────────────────────

const DeadlineBase = z.object({
  label: LabelString,
  description: DescriptionString,
  urgency: Urgency,
  source_text: ShortString,
})

const AbsoluteDeadline = DeadlineBase.extend({
  date_type: z.literal("absolute"),
  absolute_date: IsoDateString,
}).strict()

const RelativeDeadline = DeadlineBase.extend({
  date_type: z.literal("relative"),
  relative_rule: ShortString,
  anchor_date: IsoDateString,
}).strict()

const Deadline = z.discriminatedUnion("date_type", [AbsoluteDeadline, RelativeDeadline])

// ── AI AnalysisResult ──────────────────────────────────────────────

export const AnalysisResultSchema = z
  .object({
    plain_summary: NonEmptyString,
    red_flags: z
      .array(
        z
          .object({
            issue: LabelString,
            severity: Severity,
            explanation: DescriptionString,
            source_text: ShortString,
          })
          .strict(),
      )
      .max(50, "Too many red flags (model runaway?)"),
    response_letter: NonEmptyString.max(50_000),
    next_steps: z
      .array(
        z
          .object({
            action: LabelString,
            reason: DescriptionString,
            priority: Priority,
          })
          .strict(),
      )
      .max(20),
    overall_verdict: Verdict,
    deadlines: z.array(Deadline).max(50).optional(),
    letter_tone: LetterTone.optional(),
  })
  .strict()

export type AnalysisResultStrict = z.infer<typeof AnalysisResultSchema>

// ── User-submitted form bodies (analyze, chat, rephrase) ───────────

export const AnalyzeContextSchema = z
  .object({
    context: z.string().max(2_000, "Context too long").default(""),
    parentId: z.string().cuid().optional().or(z.literal("")),
  })
  .strict()

export const ChatMessageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().min(1).max(2_000),
  })
  .strict()

export const ChatRequestSchema = z
  .object({
    analysisId: z.string().cuid("Invalid analysis id"),
    message: z.string().min(1).max(2_000),
  })
  .strict()

export const RephraseRequestSchema = z
  .object({
    analysisId: z.string().cuid("Invalid analysis id"),
    tone: LetterTone,
  })
  .strict()

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Parse `data` and return either the strict-typed result or `null`. The
 * previous code path returned `null` for any validation failure; preserve
 * that contract so existing callers don't have to change error semantics.
 */
export function safeParseAnalysisResult(data: unknown) {
  const out = AnalysisResultSchema.safeParse(data)
  return out.success ? out.data : null
}

/**
 * Helper: try to parse a request body, returning a typed result or a
 * standard NextResponse error payload.
 */
export function parseOrError<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): { ok: true; data: z.infer<T> } | { ok: false; error: string } {
  const out = schema.safeParse(data)
  if (out.success) return { ok: true, data: out.data }
  const first = out.error.issues[0]
  return {
    ok: false,
    error: first ? `${first.path.join(".")}: ${first.message}` : "Invalid input",
  }
}
