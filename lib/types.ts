/**
 * Domain types. The runtime-validated types from lib/schemas.ts are the
 * authoritative shape. The loose interfaces below exist for UI prop
 * signatures and backward compatibility; production code paths should
 * use the strict types from lib/schemas.ts.
 */
import type { Analysis as PrismaAnalysis } from "@prisma/client"
import type { AnalysisResultStrict as StrictAnalysisResult } from "./schemas"

export type AnalysisResult = StrictAnalysisResult

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

export type DeadlineUrgency = "critical" | "high" | "medium"
export type DeadlineDateType = "absolute" | "relative"

export interface DocumentDeadline {
  label: string
  description: string
  urgency: DeadlineUrgency
  date_type: DeadlineDateType
  /** ISO date YYYY-MM-DD when date_type is absolute */
  absolute_date?: string
  /** e.g. "30 days from notice date" */
  relative_rule?: string
  /** Date printed on the document, ISO YYYY-MM-DD */
  anchor_date?: string
  source_text: string
}

export type LetterTone = "firm" | "cooperative" | "hardship" | "assertive"

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  createdAt: string
}

/** Plan fields synced from /api/usage (Prisma User + daily quota). */
export interface UserPlanProfile {
  plan: string
  freeUsesRemaining: number
  subscriptionStatus: string
  freeDailyLimit?: number
  freeAnalysesUsedToday?: number
  freeAnalysesRemainingToday?: number
  resetsAt?: string
  unlimited?: boolean
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
