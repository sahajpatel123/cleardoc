/** In-memory handoff for upload → login → /analyze (client navigations only). */
export type PendingAnalysisPayload = {
  file: File
  context: string
}

let pending: PendingAnalysisPayload | null = null

export function setPendingAnalysis(payload: PendingAnalysisPayload): void {
  pending = payload
}

export function takePendingAnalysis(): PendingAnalysisPayload | null {
  const value = pending
  pending = null
  return value
}
