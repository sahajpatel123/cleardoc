"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ChevronDown } from "lucide-react"
import type { FaqItem } from "@/lib/faq-content"

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

export default function FaqAccordion({
  items,
  defaultOpen = 0,
}: {
  items: FaqItem[]
  defaultOpen?: number | null
}) {
  const [open, setOpen] = useState<number | null>(defaultOpen)

  return (
    <div>
      {items.map((item, i) => (
        <motion.div
          key={`${item.q}-${i}`}
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.5, delay: i * 0.04 }}
          className="border-b"
          style={{ borderColor: "var(--hairline-2)" }}
        >
          <button
            type="button"
            className="w-full flex items-baseline justify-between py-6 text-left gap-6"
            onClick={() => setOpen(open === i ? null : i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault()
                const next = items[i + 1]
                if (next) {
                  const buttons = e.currentTarget.closest("div")?.querySelectorAll<HTMLElement>("button")
                  buttons?.[i + 1]?.focus()
                }
              } else if (e.key === "ArrowUp") {
                e.preventDefault()
                if (i > 0) {
                  const buttons = e.currentTarget.closest("div")?.querySelectorAll<HTMLElement>("button")
                  buttons?.[i - 1]?.focus()
                }
              }
            }}
            aria-expanded={open === i}
          >
            <span className="flex items-baseline gap-5 flex-1 min-w-0">
              <span
                className="mono text-[10px] tracking-[0.2em] shrink-0"
                style={{ color: "var(--text-mute)" }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className="min-w-0"
                style={{
                  color: "var(--text)",
                  fontFamily: "var(--font-syne,'Syne',sans-serif)",
                  fontWeight: 500,
                  letterSpacing: "-0.025em",
                  fontSize: "clamp(1.05rem, 1.8vw, 1.45rem)",
                }}
              >
                {item.q}
              </span>
            </span>
            <motion.div animate={{ rotate: open === i ? 180 : 0 }} className="shrink-0">
              <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} />
            </motion.div>
          </button>
          <AnimatePresence initial={false}>
            {open === i && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.35, ease: EASE }}
                className="overflow-hidden"
              >
                <div className="pb-8 pl-12 pr-4 sm:pr-12 max-w-3xl">
                  <p className="text-base leading-relaxed" style={{ color: "var(--text-3)" }}>
                    {item.a}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </div>
  )
}
