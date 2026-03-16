"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import type { LoadingStage } from "@/lib/types"
import { Shield } from "lucide-react"

const STAGES: { stage: LoadingStage; label: string; sub: string }[] = [
  { stage: "uploading", label: "Uploading your document",   sub: "Sending securely to our servers" },
  { stage: "reading",   label: "Reading your document",     sub: "Extracting text and structure" },
  { stage: "analyzing", label: "Analyzing for red flags",   sub: "Running through our expert AI engine" },
  { stage: "preparing", label: "Preparing your response",   sub: "Drafting your letter and next steps" },
]

export default function LoadingAnalysis({ stage }: { stage: LoadingStage }) {
  const [dots, setDots] = useState(".")
  const currentIdx = STAGES.findIndex(s => s.stage === stage)
  const current = STAGES[currentIdx] ?? STAGES[0]

  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? "." : d + "."), 500)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "#FAFAF8" }}>
      <div className="text-center max-w-sm w-full">
        {/* Animated icon */}
        <div className="relative inline-flex items-center justify-center mb-10">
          <motion.div
            animate={{ scale: [1, 1.12, 1] }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
            className="w-20 h-20 rounded-3xl flex items-center justify-center relative z-10 border"
            style={{ background: "#FEF0E6", borderColor: "rgba(232,101,26,0.2)" }}
          >
            <Shield className="w-9 h-9" style={{ color: "#E8651A" }} />
          </motion.div>
          <div className="absolute w-20 h-20 rounded-3xl animate-pulse-glow" />
        </div>

        {/* Stage label */}
        <AnimatePresence mode="wait">
          <motion.div key={stage}
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.4 }}>
            <h2 className="text-2xl font-black mb-2" style={{
              color: "#18130E",
              fontFamily: "var(--font-syne,'Syne',sans-serif)"
            }}>
              {current.label}<span style={{ color: "#E8651A" }}>{dots}</span>
            </h2>
            <p className="text-sm" style={{ color: "#A89484" }}>{current.sub}</p>
          </motion.div>
        </AnimatePresence>

        {/* Progress steps */}
        <div className="mt-12">
          <div className="flex items-center gap-2 mb-3">
            {STAGES.map((s, i) => (
              <div key={s.stage} className="flex-1 relative">
                <motion.div
                  className="h-1.5 rounded-full"
                  style={{ background: i <= currentIdx ? "#E8651A" : "#E8E2D9" }}
                  animate={i === currentIdx ? {
                    background: ["#E8651A", "#FF8C42", "#E8651A"]
                  } : {}}
                  transition={{ repeat: Infinity, duration: 1.5 }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs" style={{ color: "#A89484" }}>
            <span>Upload</span>
            <span>Read</span>
            <span>Analyze</span>
            <span>Prepare</span>
          </div>
        </div>

        <p className="mt-10 text-xs italic" style={{ color: "#CFC8BE" }}>
          Our AI reviews thousands of patterns in official documents to find what matters most.
        </p>
      </div>
    </div>
  )
}
