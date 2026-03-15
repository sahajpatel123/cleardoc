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

export interface UserProfile {
  email: string
  createdAt: Date
  plan: "free" | "pro"
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  subscriptionStatus: "active" | "inactive" | "cancelled"
  freeUsesRemaining: number
}

export interface Analysis {
  id: string
  userId: string
  createdAt: Date
  documentName: string
  documentType: string
  storageUrl: string
  result: AnalysisResult
}

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
