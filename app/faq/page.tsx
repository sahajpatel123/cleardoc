"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { Reveal, Magnetic } from "@/components/ui/Kinetic"
import FaqAccordion from "@/components/ui/FaqAccordion"
import { FAQ_CHAPTERS, FAQ_ITEMS } from "@/lib/faq-content"

export default function FaqPage() {
  return (
    <div className="min-h-screen pt-32 pb-32 max-md:pt-20 max-md:pb-20">
      <div className="container-edition">
        <Reveal>
          <div className="flex items-baseline justify-between mb-10 gap-4 flex-wrap max-md:mb-6">
            <p className="eyebrow">Index · questions</p>
            <Link
              href="/"
              className="mono text-[10px] inline-flex items-center gap-1.5 transition-colors hover:opacity-80"
              style={{ color: "var(--text-mute)" }}
            >
              ← Back to home
            </Link>
          </div>
        </Reveal>

        <Reveal delay={0.08}>
          <h1
            className="display max-w-[18ch] mb-8"
            style={{ fontSize: "clamp(2.6rem, 8vw, 7rem)", color: "var(--text)" }}
          >
            <span>Answers before </span>
            <span className="serif-italic" style={{ color: "var(--ember)" }}>
              you upload.
            </span>
          </h1>
        </Reveal>

        <Reveal delay={0.15}>
          <p className="max-w-xl text-base leading-relaxed" style={{ color: "var(--text-3)" }}>
            Everything we get asked about privacy, plans, and what ClearDoc can — and cannot — do
            for you.
          </p>
        </Reveal>

        <div className="mt-20 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 max-md:mt-12 max-md:gap-8">
          <aside className="lg:col-span-4">
            <Reveal delay={0.2}>
              <p className="eyebrow mb-6">Chapters</p>
              <ul className="space-y-3">
                {FAQ_CHAPTERS.map((ch) => (
                  <li key={ch}>
                    <span
                      className="text-sm"
                      style={{
                        color: "var(--text-2)",
                        fontFamily: "var(--font-syne,'Syne',sans-serif)",
                        letterSpacing: "-0.02em",
                      }}
                    >
                      {ch}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="hairline my-10" />
              <p className="text-sm leading-relaxed mb-6" style={{ color: "var(--text-3)" }}>
                Still stuck? Start with a document — the analysis usually makes the next question
                obvious.
              </p>
              <Magnetic strength={5}>
                <Link href="/" className="btn btn-primary">
                  Try free
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </Magnetic>
            </Reveal>
          </aside>

          <div className="lg:col-span-8">
            {FAQ_CHAPTERS.map((chapter, ci) => {
              const items = FAQ_ITEMS.filter((f) => f.chapter === chapter)
              if (items.length === 0) return null
              return (
                <section key={chapter} className={ci > 0 ? "mt-16" : ""}>
                  <Reveal delay={0.1 + ci * 0.05}>
                    <p className="eyebrow mb-6">{chapter}</p>
                  </Reveal>
                  <FaqAccordion
                    items={items}
                    defaultOpen={ci === 0 ? 0 : null}
                  />
                </section>
              )
            })}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="mt-28 p-8 sm:p-10 rounded-lg border max-md:mt-16 max-md:p-6"
          style={{
            borderColor: "var(--hairline-2)",
            background: "rgba(255, 106, 31, 0.04)",
          }}
        >
          <p className="eyebrow mb-4" style={{ color: "var(--ember)" }}>
            Legal note
          </p>
          <p className="text-sm leading-relaxed max-w-2xl" style={{ color: "var(--text-2)" }}>
            ClearDoc is not a law firm. Read our full{" "}
            <Link href="/disclaimer" className="underline underline-offset-4" style={{ color: "var(--text)" }}>
              disclaimer
            </Link>{" "}
            before relying on any output.
          </p>
          <Link
            href="/disclaimer"
            className="inline-flex items-center gap-1.5 mt-6 text-sm transition-colors"
            style={{ color: "var(--text-3)" }}
          >
            Read disclaimer
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </motion.div>
      </div>
    </div>
  )
}
