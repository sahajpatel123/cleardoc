import type { Analysis as PrismaAnalysis } from "@prisma/client"

export interface RedFlag {
  issue: string
  severity: "high" | "medium" | "low"
  explanation: string
  source_text: string
}

export interface NextStep {
  action: string
  reason: string
  priority: number
}

export interface AnalysisResult {
  plain_summary: string
  red_flags: RedFlag[]
  response_letter: string
  next_steps: NextStep[]
  overall_verdict: "legitimate" | "suspicious" | "likely_illegal"
}

/** Plan fields synced from /api/usage (Prisma User). */
export interface UserPlanProfile {
  plan: string
  freeUsesRemaining: number
  subscriptionStatus: string
}

export type Analysis = PrismaAnalysis

export interface UploadState {
  file: File | null
  context: string
  isUploading: boolean
  error: string | null
}

export type LoadingStage =
  | "idle"
  | "uploading"
  | "reading"
  | "analyzing"
  | "preparing"
  | "done"
