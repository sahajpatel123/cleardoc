"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import type { RedFlag } from "@/lib/types"
import { ChevronDown } from "lucide-react"

interface Props { flag: RedFlag; index: number }

const cfg = {
  high:   { color: "var(--red)",   label: "HIGH",   labelClass: "label-red" },
  medium: { color: "var(--amber)", label: "MEDIUM", labelClass: "label-amber" },
  low:    { color: "var(--sky)",   label: "LOW",    labelClass: "label-sky" },
}

export default function RedFlagItem({ flag, index }: Props) {
  const c = cfg[flag.severity]
  const [open, setOpen] = useState(index === 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="relative py-5 border-b"
      style={{ borderColor: "var(--hairline-2)" }}
    >
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left flex items-start gap-5">
        <span
          className="mono text-[10px] tracking-[0.2em] mt-1 shrink-0"
          style={{ color: "var(--text-mute)" }}
        >
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap mb-1">
            <h4
              className="text-base sm:text-lg"
              style={{
                color: "var(--text)",
                fontFamily: "var(--font-syne,'Syne',sans-serif)",
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              {flag.issue}
            </h4>
            <span className={`label ${c.labelClass} !text-[9px]`}>{c.label}</span>
          </div>
          {!open && (
            <p className="text-sm line-clamp-2" style={{ color: "var(--text-3)" }}>
              {flag.explanation}
            </p>
          )}
        </div>
        <motion.div animate={{ rotate: open ? 180 : 0 }} className="shrink-0 mt-1">
          <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} />
        </motion.div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="pl-10 pt-5 space-y-4">
              {flag.source_text && (
                <div
                  className="text-sm leading-relaxed pl-4 italic"
                  style={{
                    borderLeft: `2px solid ${c.color}`,
                    color: c.color,
                    fontFamily: "ui-serif, Georgia, serif",
                  }}
                >
                  &ldquo;{flag.source_text}&rdquo;
                </div>
              )}
              <p className="text-sm leading-relaxed max-w-2xl" style={{ color: "var(--text-2)" }}>
                {flag.explanation}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
