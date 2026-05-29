"use client"

import Link from "next/link"
import { Link2 } from "lucide-react"
import type { Analysis } from "@/lib/types"
import { parseAnalysisResult } from "@/lib/validate-analysis"
import { getVerdictUi } from "@/lib/verdict-ui"

interface Props {
  analyses: Analysis[]
  currentId: string
}

export default function CaseTimeline({ analyses, currentId }: Props) {
  if (analyses.length <= 1) return null

  return (
    <div
      className="mt-10 p-5 rounded-lg border"
      style={{ borderColor: "var(--hairline-2)", background: "rgba(255,106,31,0.03)" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <Link2 className="w-4 h-4" style={{ color: "var(--ember)" }} />
        <p className="eyebrow !mb-0">Case timeline</p>
      </div>
      <ol className="space-y-3">
        {analyses.map((a, idx) => {
          const ar = parseAnalysisResult(a.result)
          const vc = ar ? getVerdictUi(ar.overall_verdict) : null
          const isCurrent = a.id === currentId
          return (
            <li key={a.id} className="flex items-baseline gap-4">
              <span className="mono text-[10px] shrink-0" style={{ color: "var(--text-mute)" }}>
                {String(idx + 1).padStart(2, "0")}
              </span>
              {isCurrent ? (
                <span
                  className="text-sm truncate"
                  style={{
                    color: "var(--ember)",
                    fontFamily: "var(--font-syne,'Syne',sans-serif)",
                    fontWeight: 500,
                  }}
                >
                  {a.documentName} · current
                </span>
              ) : (
                <Link
                  href={`/analyze/${a.id}`}
                  className="text-sm truncate hover:text-white transition-colors"
                  style={{ color: "var(--text-2)" }}
                >
                  {a.documentName}
                  {vc ? ` · ${vc.label}` : ""}
                </Link>
              )}
              <span className="mono text-[10px] shrink-0 ml-auto hidden sm:inline" style={{ color: "var(--text-mute)" }}>
                {new Date(a.createdAt).toLocaleDateString("en-US", {
                  timeZone: "UTC",
                  month: "short",
                  day: "numeric",
                }).toUpperCase()}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
