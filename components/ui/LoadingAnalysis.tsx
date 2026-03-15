"use client"

import { useEffect, useState } from "react"
import type { LoadingStage } from "@/lib/types"

const STAGES: { stage: LoadingStage; label: string; sublabel: string }[] = [
  {
    stage: "uploading",
    label: "Uploading your document...",
    sublabel: "Sending securely to our servers",
  },
  {
    stage: "reading",
    label: "Reading your document...",
    sublabel: "Extracting text and structure",
  },
  {
    stage: "analyzing",
    label: "Analyzing for red flags...",
    sublabel: "Running through our expert AI engine",
  },
  {
    stage: "preparing",
    label: "Preparing your response...",
    sublabel: "Drafting your letter and next steps",
  },
]

interface Props {
  stage: LoadingStage
}

export default function LoadingAnalysis({ stage }: Props) {
  const [dots, setDots] = useState(".")
  const [visible, setVisible] = useState(false)

  const currentIndex = STAGES.findIndex((s) => s.stage === stage)
  const currentStage = STAGES[currentIndex] ?? STAGES[0]

  useEffect(() => {
    setVisible(false)
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [stage])

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((d) => (d.length >= 3 ? "." : d + "."))
    }, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="min-h-screen bg-[#0A0A0F] flex items-center justify-center px-4">
      <div className="text-center max-w-md w-full">
        {/* Animated shield / icon */}
        <div className="relative inline-flex items-center justify-center mb-10">
          <div className="w-20 h-20 rounded-full border border-amber-400/30 animate-ping absolute" />
          <div className="w-16 h-16 rounded-full border border-amber-400/50 animate-pulse absolute" />
          <div className="w-12 h-12 bg-amber-400/10 rounded-full flex items-center justify-center relative z-10 border border-amber-400/30">
            <svg
              className="w-6 h-6 text-amber-400 animate-spin"
              style={{ animationDuration: "3s" }}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
        </div>

        {/* Stage label */}
        <div
          className={`transition-all duration-500 ${
            visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
        >
          <h2 className="text-2xl font-bold text-white mb-2">
            {currentStage.label.replace("...", "")}
            <span className="text-amber-400">{dots}</span>
          </h2>
          <p className="text-slate-400 text-sm">{currentStage.sublabel}</p>
        </div>

        {/* Progress bar */}
        <div className="mt-10">
          <div className="flex items-center gap-2 mb-3">
            {STAGES.map((s, i) => (
              <div key={s.stage} className="flex-1 flex flex-col items-center gap-1.5">
                <div
                  className={`h-1 w-full rounded-full transition-all duration-700 ${
                    i <= currentIndex
                      ? "bg-amber-400"
                      : "bg-white/10"
                  }`}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-600">
            <span>Upload</span>
            <span>Read</span>
            <span>Analyze</span>
            <span>Prepare</span>
          </div>
        </div>

        {/* Fun fact */}
        <p className="mt-8 text-xs text-slate-600 italic">
          Our AI has analyzed thousands of official documents — it knows every trick in the book.
        </p>
      </div>
    </div>
  )
}
