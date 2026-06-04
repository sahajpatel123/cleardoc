/**
 * AI response parsing + input sanitization — extracted from lib/ai.ts as
 * part of BUG #15 (god-module split). These helpers are pure, side-effect-
 * free, and depend only on the strict schema validator. Keeping them in a
 * focused module means the analyzeDocument orchestration in lib/ai.ts is
 * shorter, and these functions can be unit-tested without pulling in the
 * full AI client / circuit breaker stack.
 *
 * No new behavior — this is a pure relocation. The exported
 * AI_INVALID_JSON_ERROR_MESSAGE is re-exported from lib/ai.ts for callers
 * that already import it from there.
 */
import type { AnalysisResult } from "./types"
import { safeParseAnalysisResult } from "./schemas"
import { captureException, createLogger } from "./observability"

const log = createLogger("ai-parse")

/** Thrown when JSON.parse fails; API route maps this to a user-safe message. */
export const AI_INVALID_JSON_ERROR_MESSAGE = "Model returned invalid JSON"

/**
 * Log a model-output failure WITHOUT leaking raw document/model content in
 * production. The raw payload is derived from the user's uploaded document, so
 * per privacy rules it must never reach prod logs — we emit only a generic
 * error. The full payload is still logged locally for debugging.
 *
 * Also forwards the failure to Sentry (when configured) so model regressions
 * are visible without exposing user content.
 *
 * Exported because lib/ai.ts's analyzeDocument orchestration also calls
 * this for non-parse failures (e.g. "model returned empty response").
 */
export function logRawModelFailure(
  stage: string,
  raw: string,
  attempt?: number,
  maxAttempts?: number,
  reqId?: string,
): void {
  if (process.env.NODE_ENV === "production") {
    log.error({ stage, rawLength: raw.length, attempt, maxAttempts, reqId }, "model returned invalid output")
  } else {
    log.debug({ stage, rawPreview: raw.slice(0, 500), attempt, maxAttempts, reqId }, "model returned invalid output")
  }
  captureException(new Error(`ai: ${stage}`), {
    component: "ai-parse",
    reqId,
    extra: { stage, rawLength: raw.length, attempt, maxAttempts },
  })
}

/**
 * Strip JS-style comments and trailing commas from a string that should be
 * near-JSON. Some model responses include `// …` annotations or trailing
 * commas before closing braces that are valid JS/TS but trip JSON.parse.
 * String literals are respected — comments inside strings are preserved.
 */
function stripJsonCommentsAndTrailingCommas(input: string): string {
  let out = ""
  let i = 0
  const len = input.length
  while (i < len) {
    const c = input[i]
    const n = input[i + 1]
    if (c === "/" && n === "/") {
      while (i < len && input[i] !== "\n") i++
      continue
    }
    if (c === "/" && n === "*") {
      i += 2
      while (i < len && !(input[i] === "*" && input[i + 1] === "/")) i++
      i += 2
      continue
    }
    if (c === '"') {
      out += c
      i++
      while (i < len) {
        const sc = input[i]
        out += sc
        if (sc === "\\" && i + 1 < len) {
          out += input[i + 1]
          i += 2
          continue
        }
        if (sc === '"') {
          i++
          break
        }
        i++
      }
      continue
    }
    out += c
    i++
  }
  return out.replace(/,(\s*[}\]])/g, "$1")
}

/**
 * Locate the first JSON object in `s` whose braces are balanced. Returns the
 * inclusive { start, end } of the outermost object, or -1 if not found.
 *
 * Replaces the previous `indexOf("{")` + `lastIndexOf("}")` heuristic which
 * was incorrect for any prose containing stray braces.
 *
 * The scanner respects string literals so braces inside JSON strings do not
 * count toward the depth.
 */
function findFirstBalancedObject(s: string): { start: number; end: number } | -1 {
  let start = -1
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (escaped) {
      escaped = false
      continue
    }
    if (inString) {
      if (c === "\\") {
        escaped = true
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      continue
    }
    if (c === "{") {
      if (depth === 0) start = i
      depth++
    } else if (c === "}") {
      depth--
      if (depth === 0 && start !== -1) {
        return { start, end: i }
      }
      if (depth < 0) return -1
    }
  }
  return -1
}

/**
 * Parse a raw model completion string into a validated AnalysisResult.
 * Handles markdown fencing, prose-wrapped JSON, JS-style comments, and
 * trailing commas. Throws AI_INVALID_JSON_ERROR_MESSAGE on any failure —
 * the caller maps that to a user-safe error.
 */
export function parseAnalysisResponse(raw: string, reqId?: string): AnalysisResult {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()

  let data: unknown
  try {
    data = JSON.parse(cleaned)
  } catch {
    const sanitized = stripJsonCommentsAndTrailingCommas(cleaned)
    const start = findFirstBalancedObject(sanitized)
    if (start === -1) {
      logRawModelFailure("Invalid JSON from model.", raw, undefined, undefined, reqId)
      throw new Error(AI_INVALID_JSON_ERROR_MESSAGE)
    }
    try {
      data = JSON.parse(sanitized.slice(start.start, start.end + 1))
    } catch {
      logRawModelFailure("Invalid JSON from model.", raw, undefined, undefined, reqId)
      throw new Error(AI_INVALID_JSON_ERROR_MESSAGE)
    }
  }

  const parsed = safeParseAnalysisResult(data)
  if (!parsed) {
    logRawModelFailure("Schema validation failed.", raw, undefined, undefined, reqId)
    throw new Error(AI_INVALID_JSON_ERROR_MESSAGE)
  }
  return parsed
}

/**
 * Strip control characters and common prompt-injection markers from
 * user-supplied strings before interpolating them into AI messages.
 * Defense-in-depth — the surrounding delimiters and temperature=0 already
 * reduce injection efficacy, but stripping role-prefix patterns removes the
 * most obvious attack vectors. See lib/analysis-ai.ts for the structural
 * prompt-injection defense (USER_MESSAGE block + system-prompt rule).
 */
export function sanitizeUserInput(input: string): string {
  return input
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/^\s*(system|user|assistant)\s*:/gim, "")
    .replace(/ignore\s+(all\s+)?(previous|above|prior)\s+instructions/gi, "[REMOVED]")
    .replace(/disregard\s+(all\s+)?(previous|above|prior)\s+instructions/gi, "[REMOVED]")
    .replace(/new\s+system\s+prompt/gi, "[REMOVED]")
    .replace(/system\s+(override|reset)/gi, "[REMOVED]")
    .replace(/pretend\s+(you\s+are|to\s+be|that\s+you\s+are)/gi, "[REMOVED]")
    .replace(/act\s+as\s+(if\s+you\s+are|an?\s+)/gi, "[REMOVED]")
    .replace(/you\s+are\s+now\s+(a\s+)?/gi, "[REMOVED]")
    .replace(/from\s+now\s+on\s*,?\s*(you\s+are|act\s+as)/gi, "[REMOVED]")
    .replace(/DAN\s*[:\-]?\s*Do\s+Anything\s+Now/gi, "[REMOVED]")
    .replace(/^#{1,6}\s*(system|prompt|instruction|override)/gim, "[REMOVED]")
    .replace(/<system\b[^>]*>[\s\S]*?<\/system>/gi, "[REMOVED]")
    .replace(/<instructions?\b[^>]*>[\s\S]*?<\/instructions?>/gi, "[REMOVED]")
    .replace(/<\/?(prompt|command|role)\b[^>]*>/gi, "[REMOVED]")
    .replace(/\{\{[\s\S]*?\}\}/g, "[REMOVED]")
    .replace(/<!--[\s\S]*?-->/g, "[REMOVED]")
    .trim()
}
