"use client"

import type { NextStep } from "@/lib/types"
import { motion } from "framer-motion"
import { ArrowUpRight } from "lucide-react"

interface Props { step: NextStep; index: number }

export default function NextStepItem({ step, index }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="group py-5 border-b transition-colors flex items-start gap-5"
      style={{ borderColor: "var(--hairline-2)" }}
    >
      <span
        className="mono text-[10px] tracking-[0.2em] mt-1 shrink-0"
        style={{ color: "var(--text-mute)" }}
      >
        {String(step.priority).padStart(2, "0")}
      </span>
      <div className="flex-1">
        <h4
          className="text-base sm:text-lg mb-2"
          style={{
            color: "var(--text)",
            fontFamily: "var(--font-syne,'Syne',sans-serif)",
            fontWeight: 500,
            letterSpacing: "-0.02em",
          }}
        >
          {step.action}
        </h4>
        <p className="text-sm leading-relaxed max-w-2xl" style={{ color: "var(--text-3)" }}>
          {step.reason}
        </p>
      </div>
      <ArrowUpRight
        className="w-4 h-4 mt-1 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
        style={{ color: "var(--ember)" }}
      />
    </motion.div>
  )
}
