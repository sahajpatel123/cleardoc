import { parseAnalysisResult } from "./validate-analysis"

const MAX_CONTEXT_CHARS = 6000

/** Build prior-case context for Claude from a chain of parent analyses. */
export function buildCaseContextFromAnalyses(
  parents: Array<{ documentName: string; createdAt: Date; result: unknown }>,
): string {
  if (parents.length === 0) return ""

  const sections: string[] = [
    "PREVIOUS CASE CONTEXT (analyze the new document in light of this history):",
  ]

  for (const [idx, row] of parents.entries()) {
    const parsed = parseAnalysisResult(row.result)
    if (!parsed) continue

    const date = row.createdAt.toISOString().slice(0, 10)
    sections.push(
      [
        `--- Document ${idx + 1}: "${row.documentName}" (${date}) ---`,
        `Summary: ${parsed.plain_summary}`,
        `Verdict: ${parsed.overall_verdict}`,
        parsed.red_flags.length > 0
          ? `Key issues: ${parsed.red_flags
              .slice(0, 3)
              .map((f) => f.issue)
              .join("; ")}`
          : "",
        `Response letter the user was given:\n${parsed.response_letter.slice(0, 1500)}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
  }

  let text = sections.join("\n\n")
  if (text.length > MAX_CONTEXT_CHARS) {
    const cut = text.lastIndexOf(" ", MAX_CONTEXT_CHARS)
    text = text.slice(0, cut > 0 ? cut : MAX_CONTEXT_CHARS) + "\n\n[Prior context truncated.]"
  }
  return text
}

export function mergeUserContextWithCase(
  userContext: string | undefined,
  caseContext: string,
): string | undefined {
  const parts = [caseContext, userContext?.trim()].filter(Boolean)
  if (parts.length === 0) return undefined
  return parts.join("\n\n")
}
