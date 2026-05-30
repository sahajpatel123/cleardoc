"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowUpRight } from "lucide-react"

export default function Footer() {
  return (
    <footer className="relative border-t" style={{ borderColor: "var(--hairline)" }}>
      <div className="container-edition py-20 sm:py-28 max-md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-8 items-end max-md:gap-8">
          <div className="md:col-span-7">
            <p className="eyebrow mb-6">Colophon</p>
            <h2
              className="display"
              style={{ fontSize: "clamp(2.2rem, 5vw, 4.2rem)" }}
            >
              <span style={{ color: "var(--text)" }}>Read what they </span>
              <span className="serif-italic" style={{ color: "var(--ember)" }}>really </span>
              <span style={{ color: "var(--text)" }}>sent.</span>
            </h2>
            <p className="mt-6 max-w-md text-sm leading-relaxed" style={{ color: "var(--text-3)" }}>
              Hand us the document that scares you. We&apos;ll hand back the truth — and the
              words to fight it.
            </p>
            <div className="mt-8">
              <Link href="/#upload" className="btn btn-primary">
                Try free
                <ArrowUpRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          <div className="md:col-span-5 grid grid-cols-2 gap-8 max-md:gap-4">
            <FooterCol
              title="Product"
              links={[
                { label: "Analyze", href: "/" },
                { label: "Pricing", href: "/pricing" },
                { label: "Account", href: "/dashboard" },
              ]}
            />
            <FooterCol
              title="Index"
              links={[
                { label: "FAQ", href: "/faq" },
                { label: "Disclaimer", href: "/disclaimer" },
                { label: "Privacy", href: "/privacy" },
                { label: "Terms", href: "/terms" },
              ]}
            />
          </div>
        </div>

        <div className="hairline my-16" />

        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-baseline">
          <p className="mono text-[11px] md:col-span-3" style={{ color: "var(--text-mute)" }}>
            © {new Date().getFullYear()} ClearDoc
          </p>
          <p
            id="disclaimer"
            className="md:col-span-9 text-[11px] leading-relaxed italic"
            style={{ color: "var(--text-mute)" }}
          >
            This is not legal advice. ClearDoc provides general information only and does not
            constitute legal, financial, or professional advice. Always consult a qualified
            attorney for advice specific to your situation.
          </p>
        </div>
      </div>

      {/* Wordmark watermark */}
      <div className="overflow-hidden border-t" style={{ borderColor: "var(--hairline)" }}>
        <motion.div
          aria-hidden
          initial={{ y: 12, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
          className="container-edition py-10 flex items-baseline justify-between"
        >
          <span
            className="display stroke-text"
            style={{
              fontSize: "clamp(4.5rem, 16vw, 16rem)",
              fontFamily: "var(--font-syne,'Syne',sans-serif)",
              lineHeight: 0.85,
              letterSpacing: "-0.06em",
            }}
          >
            ClearDoc
          </span>
          <span className="mono text-[10px] tracking-[0.3em] shrink-0 hidden sm:inline" style={{ color: "var(--text-mute)" }}>
            EST. 2026
          </span>
        </motion.div>
      </div>
    </footer>
  )
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="eyebrow mb-5">{title}</p>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link
              href={l.href}
              className="group inline-flex items-center gap-1.5 text-sm transition-colors"
              style={{ color: "var(--text-2)" }}
            >
              <span className="group-hover:text-white transition-colors">{l.label}</span>
              <ArrowUpRight
                className="w-3 h-3 opacity-0 -translate-x-0.5 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
                style={{ color: "var(--text-2)" }}
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
