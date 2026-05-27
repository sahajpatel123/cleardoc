"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import ResultCard from "@/components/ui/ResultCard"
import RedFlagItem from "@/components/ui/RedFlagItem"
import NextStepItem from "@/components/ui/NextStepItem"
import ResponseLetter from "@/components/ui/ResponseLetter"
import DeadlinesPanel from "@/components/ui/DeadlinesPanel"
import AnalysisChat from "@/components/ui/AnalysisChat"
import CaseTimeline from "@/components/ui/CaseTimeline"
import { Reveal } from "@/components/ui/Kinetic"
import type { Analysis, AnalysisResult, ChatMessage, LetterTone } from "@/lib/types"
import { getVerdictUi } from "@/lib/verdict-ui"
import {
  CheckCircle, RotateCcw, LayoutDashboard, AlertTriangle,
} from "lucide-react"

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const

interface Props {
  result: AnalysisResult
  mode: "fresh" | "saved"
  analysisId?: string
  chatMessages?: ChatMessage[]
  caseAnalyses?: Analysis[]
  onResultChange?: (result: AnalysisResult) => void
}

export default function AnalysisResultsView({
  result,
  mode,
  analysisId,
  chatMessages = [],
  caseAnalyses = [],
  onResultChange,
}: Props) {
  const router = useRouter()
  const [localResult, setLocalResult] = useState(result)

  const verdict = getVerdictUi(localResult.overall_verdict)
  const VIcon = verdict.Icon
  const highFlags = localResult.red_flags.filter((f) => f.severity === "high")
  const sortedFlags = [...localResult.red_flags].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  )
  const deadlines = localResult.deadlines ?? []
  let panelNumber = 0
  const nextNum = () => {
    panelNumber += 1
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII"][panelNumber - 1] ?? String(panelNumber)
    return roman
  }

  const handleLetterChange = (letter: string, tone: LetterTone) => {
    const updated = { ...localResult, response_letter: letter, letter_tone: tone }
    setLocalResult(updated)
    onResultChange?.(updated)
  }

  return (
    <div className="min-h-screen pt-32 pb-32">
      <div className="container-edition">
        <Reveal>
          <div className="flex items-baseline justify-between mb-10">
            <p className="eyebrow">{mode === "saved" ? "Saved analysis" : "Analysis complete"}</p>
            <span className={`label ${verdict.labelClass}`}>
              <VIcon className="w-3 h-3" /> {verdict.label}
            </span>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <h1
            className="display max-w-[20ch] mb-6"
            style={{ fontSize: "clamp(2.4rem, 7vw, 6rem)", color: "var(--text)" }}
          >
            <span>Here&apos;s what </span>
            <span className="serif-italic" style={{ color: "var(--ember)" }}>
              we found.
            </span>
          </h1>
          <p className="max-w-md text-base" style={{ color: "var(--text-3)" }}>
            {verdict.desc}
          </p>
        </Reveal>

        {caseAnalyses.length > 1 && analysisId && (
          <CaseTimeline analyses={caseAnalyses} currentId={analysisId} />
        )}

        <AnimatePresence>
          {highFlags.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-10 flex items-start gap-4 p-5 rounded-lg"
              style={{
                background: "rgba(229,90,62,0.06)",
                border: "1px solid rgba(229,90,62,0.20)",
              }}
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "var(--red)" }} />
              <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)" }}>
                <strong style={{ color: "var(--red)" }}>
                  {highFlags.length} high-severity issue{highFlags.length > 1 ? "s" : ""}
                </strong>{" "}
                detected. Read the red flags below carefully before responding.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-20">
          <ResultCard
            number={nextNum()}
            title="What this actually says"
            subtitle="Plain English, zero jargon"
            accent="orange"
          >
            <p
              className="text-lg leading-relaxed max-w-3xl"
              style={{ color: "var(--text-2)", fontFamily: "ui-serif, Georgia, serif" }}
            >
              {localResult.plain_summary}
            </p>
          </ResultCard>

          {deadlines.length > 0 && (
            <ResultCard
              number={nextNum()}
              title="Critical deadlines"
              subtitle={`${deadlines.length} date${deadlines.length > 1 ? "s" : ""} to track`}
              accent="red"
            >
              <DeadlinesPanel deadlines={deadlines} />
            </ResultCard>
          )}

          <ResultCard
            number={nextNum()}
            title="Red flags found"
            subtitle={
              localResult.red_flags.length > 0
                ? `${localResult.red_flags.length} issue${localResult.red_flags.length > 1 ? "s" : ""} detected`
                : "Document reviewed"
            }
            accent="red"
          >
            {localResult.red_flags.length === 0 ? (
              <div className="flex items-center gap-4 py-2">
                <CheckCircle className="w-5 h-5 shrink-0" style={{ color: "var(--moss)" }} />
                <div>
                  <p
                    style={{
                      color: "var(--text)",
                      fontFamily: "var(--font-syne,'Syne',sans-serif)",
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    No major red flags found
                  </p>
                  <p className="text-xs mt-1" style={{ color: "var(--text-3)" }}>
                    This document appears straightforward.
                  </p>
                </div>
              </div>
            ) : (
              <div>
                {sortedFlags.map((flag, i) => (
                  <RedFlagItem key={i} flag={flag} index={i} />
                ))}
              </div>
            )}
          </ResultCard>

          <ResultCard
            number={nextNum()}
            title="Your response letter"
            subtitle="Ready to send — fill in the bracketed fields"
            accent="blue"
          >
            <ResponseLetter
              letter={localResult.response_letter}
              tone={localResult.letter_tone}
              analysisId={analysisId}
              onLetterChange={handleLetterChange}
            />
          </ResultCard>

          <ResultCard
            number={nextNum()}
            title="Your next moves"
            subtitle="Ranked by likelihood of success"
            accent="green"
          >
            <div>
              {[...localResult.next_steps]
                .sort((a, b) => a.priority - b.priority)
                .map((step, i) => (
                  <NextStepItem key={i} step={step} index={i} />
                ))}
            </div>
          </ResultCard>

          {analysisId && (
            <ResultCard
              number={nextNum()}
              title="Call prep chat"
              subtitle="Ask questions before you pick up the phone"
              accent="orange"
            >
              <AnalysisChat analysisId={analysisId} initialMessages={chatMessages} />
            </ResultCard>
          )}
        </div>

        <div className="hairline mt-16 mb-12" />
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <p className="text-xs italic max-w-md" style={{ color: "var(--text-mute)" }}>
            This is not legal advice. ClearDoc provides general information only.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => router.push("/")} className="btn btn-ghost">
              <RotateCcw className="w-4 h-4" /> Analyze another
            </button>
            <button onClick={() => router.push("/dashboard")} className="btn btn-primary">
              <LayoutDashboard className="w-4 h-4" /> View dashboard
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
