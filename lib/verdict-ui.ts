import { CheckCircle, XCircle, AlertCircle } from "lucide-react"
import type { AnalysisResult } from "@/lib/types"

export const VERDICT_UI = {
  legitimate: {
    label: "Legitimate",
    Icon: CheckCircle,
    accent: "var(--moss)",
    labelClass: "label-moss",
    desc: "This document appears legal and fair.",
  },
  suspicious: {
    label: "Suspicious",
    Icon: AlertCircle,
    accent: "var(--amber)",
    labelClass: "label-amber",
    desc: "Review red flags carefully before responding.",
  },
  likely_illegal: {
    label: "Likely Illegal",
    Icon: XCircle,
    accent: "var(--red)",
    labelClass: "label-red",
    desc: "This may violate laws or regulations.",
  },
} as const

export function getVerdictUi(verdict: AnalysisResult["overall_verdict"]) {
  return VERDICT_UI[verdict] ?? VERDICT_UI.suspicious
}
