"use client"

import { useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { isProUser } from "@/lib/user-plan"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { Check, ArrowRight, ChevronDown } from "lucide-react"
import { Reveal, Magnetic } from "@/components/ui/Kinetic"

const FREE_FEATURES = [
  "1 document analysis",
  "Plain English summary",
  "Red flag detection",
  "Response letter draft",
  "Next steps guide",
]

const PRO_FEATURES = [
  "Unlimited document analyses",
  "Full red flag detection",
  "Ready-to-send response letters",
  "Priority AI processing",
  "Analysis history & dashboard",
  "All document types supported",
  "Cancel anytime",
]

const FAQ = [
  {
    q: "What types of documents can I upload?",
    a: "Any official document: insurance denial letters, medical bills, eviction notices, visa rejections, IRS letters, debt collection letters, legal notices, bank dispute letters, and more. If it's official and intimidating, ClearDoc can help.",
  },
  {
    q: "Is this actually legal advice?",
    a: "No — ClearDoc is a general information tool, not a law firm. Our AI gives you a starting point to understand your situation and respond. For serious legal matters, also consult a licensed attorney (we'll often suggest free legal aid resources in your next steps).",
  },
  {
    q: "How accurate is the AI analysis?",
    a: "Our AI is trained to identify common red flags, illegal clauses, and manipulation tactics used in official documents. It's highly accurate for pattern recognition, but always read the analysis critically and verify specific legal claims with a professional.",
  },
  {
    q: "What happens to my uploaded documents?",
    a: "Your documents are processed securely and never shared. We don't use your documents to train AI models. Documents are automatically deleted from our servers after 30 days.",
  },
  {
    q: "Can I cancel my Pro subscription?",
    a: "Yes, anytime. Cancel from your account settings and you'll retain Pro access until the end of your billing period. No cancellation fees.",
  },
]

export default function PricingPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  const handleUpgrade = async () => {
    if (!user) {
      router.push(`/login?mode=signup&redirect=${encodeURIComponent("/pricing")}`)
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/stripe/create-checkout", { method: "POST" })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch {
      alert("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const isPro = isProUser(
    profile
      ? { plan: profile.plan, subscriptionStatus: profile.subscriptionStatus }
      : null,
  )

  return (
    <div className="min-h-screen pt-28 pb-32">
      <div className="container-edition">
        {/* Hero */}
        <Reveal>
          <div className="flex items-baseline justify-between mb-10">
            <p className="eyebrow">Pricing · honest</p>
            <p className="mono text-[10px]" style={{ color: "var(--text-mute)" }}>
              CHAPTER 02 · INVESTMENT
            </p>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <h1
            className="display max-w-[20ch] mb-8"
            style={{ fontSize: "clamp(2.6rem, 8vw, 7rem)", color: "var(--text)" }}
          >
            <span>Everyone deserves </span>
            <span className="serif-italic" style={{ color: "var(--ember)" }}>
              someone smart
            </span>
            <span> in their corner.</span>
          </h1>
        </Reveal>

        <Reveal delay={0.2}>
          <p className="max-w-md text-base mt-8" style={{ color: "var(--text-3)" }}>
            Start free. Upgrade when you need more than one document a month.
          </p>
        </Reveal>

        {/* Pricing — two columns side by side, hairlines only */}
        <div className="mt-24 grid grid-cols-1 md:grid-cols-2 border-t" style={{ borderColor: "var(--hairline-2)" }}>
          {/* Free */}
          <Reveal>
            <div
              className="p-8 sm:p-12 md:border-r"
              style={{ borderColor: "var(--hairline-2)", minHeight: 480 }}
            >
              <div className="flex items-baseline justify-between mb-2">
                <p className="eyebrow !ml-0" style={{ color: "var(--text-3)" }}>
                  Plan I
                </p>
              </div>
              <h3
                className="display mt-4 mb-8"
                style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)", color: "var(--text)" }}
              >
                Free
              </h3>
              <div className="flex items-baseline gap-1 mb-2">
                <span
                  className="display"
                  style={{
                    fontSize: "clamp(2.6rem, 5vw, 4rem)",
                    color: "var(--text-3)",
                  }}
                >
                  $0
                </span>
                <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
                  /month
                </span>
              </div>
              <p className="mono text-[10px] mb-10" style={{ color: "var(--text-mute)" }}>
                NO CARD REQUIRED
              </p>

              <div className="hairline-fade mb-8" />

              <ul className="space-y-4 mb-12">
                {FREE_FEATURES.map((f, i) => (
                  <motion.li
                    key={f}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    className="flex items-center gap-3 text-sm"
                    style={{ color: "var(--text-2)" }}
                  >
                    <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--text-3)" }} />
                    {f}
                  </motion.li>
                ))}
              </ul>

              <button onClick={() => router.push("/")} className="btn btn-ghost w-full justify-center">
                Get started
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </Reveal>

          {/* Pro */}
          <Reveal delay={0.08}>
            <div className="p-8 sm:p-12 relative" style={{ minHeight: 480 }}>
              {/* Top ember accent */}
              <div
                className="absolute top-[-1px] left-0 right-0 h-px"
                style={{ background: "var(--ember)" }}
              />
              <div className="flex items-baseline justify-between mb-2">
                <p className="eyebrow !ml-0" style={{ color: "var(--ember)" }}>
                  Plan II
                </p>
                <span className="label label-ember">Recommended</span>
              </div>
              <h3
                className="display mt-4 mb-8"
                style={{ fontSize: "clamp(2rem, 4vw, 3.5rem)", color: "var(--text)" }}
              >
                Pro
              </h3>
              <div className="flex items-baseline gap-1 mb-2">
                <span
                  className="display"
                  style={{
                    fontSize: "clamp(2.6rem, 5vw, 4rem)",
                    color: "var(--text)",
                  }}
                >
                  $9
                </span>
                <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
                  /month
                </span>
              </div>
              <p className="mono text-[10px] mb-10" style={{ color: "var(--text-mute)" }}>
                CANCEL ANYTIME
              </p>

              <div className="hairline-fade mb-8" />

              <ul className="space-y-4 mb-12">
                {PRO_FEATURES.map((f, i) => (
                  <motion.li
                    key={f}
                    initial={{ opacity: 0, x: -8 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    className="flex items-center gap-3 text-sm"
                    style={{ color: "var(--text-2)" }}
                  >
                    <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ember)" }} />
                    {f}
                  </motion.li>
                ))}
              </ul>

              {isPro ? (
                <div
                  className="w-full py-3 text-center text-sm rounded-full"
                  style={{
                    background: "rgba(107,175,138,0.06)",
                    border: "1px solid rgba(107,175,138,0.30)",
                    color: "var(--moss)",
                  }}
                >
                  ✓ You&apos;re on Pro
                </div>
              ) : (
                <Magnetic strength={6}>
                  <button
                    onClick={handleUpgrade}
                    disabled={loading}
                    className="btn btn-primary w-full justify-center"
                  >
                    {loading ? "Loading..." : "Upgrade to Pro"}
                    {!loading && <ArrowRight className="w-4 h-4" />}
                  </button>
                </Magnetic>
              )}
            </div>
          </Reveal>
        </div>

        {/* FAQ */}
        <section className="mt-32">
          <Reveal>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-16 items-end">
              <div className="md:col-span-3">
                <p className="eyebrow">FAQ</p>
              </div>
              <h2
                className="md:col-span-9 display"
                style={{ fontSize: "clamp(2rem, 5.5vw, 5rem)", color: "var(--text)" }}
              >
                Questions, candidly answered.
              </h2>
            </div>
          </Reveal>

          <div className="border-t" style={{ borderColor: "var(--hairline-2)" }}>
            {FAQ.map((item, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.05 }}
                className="border-b"
                style={{ borderColor: "var(--hairline-2)" }}
              >
                <button
                  className="w-full flex items-baseline justify-between py-6 text-left gap-6"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="flex items-baseline gap-5 flex-1">
                    <span
                      className="mono text-[10px] tracking-[0.2em] shrink-0"
                      style={{ color: "var(--text-mute)" }}
                    >
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span
                      style={{
                        color: "var(--text)",
                        fontFamily: "var(--font-syne,'Syne',sans-serif)",
                        fontWeight: 500,
                        letterSpacing: "-0.025em",
                        fontSize: "clamp(1.1rem, 1.8vw, 1.5rem)",
                      }}
                    >
                      {item.q}
                    </span>
                  </span>
                  <motion.div animate={{ rotate: openFaq === i ? 180 : 0 }} className="shrink-0">
                    <ChevronDown className="w-4 h-4" style={{ color: "var(--text-3)" }} />
                  </motion.div>
                </button>
                <AnimatePresence>
                  {openFaq === i && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="pb-8 pl-12 pr-12 max-w-3xl">
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
        </section>

        {/* Bottom CTA */}
        <section className="mt-32">
          <Reveal>
            <h2
              className="display max-w-[18ch] mb-8"
              style={{ fontSize: "clamp(2.4rem, 7vw, 5.5rem)", color: "var(--text)" }}
            >
              <span>Ready to </span>
              <span className="serif-italic" style={{ color: "var(--ember)" }}>fight back?</span>
            </h2>
            <div className="flex items-center gap-4 flex-wrap">
              <Magnetic strength={6}>
                <button onClick={() => router.push("/")} className="btn btn-primary">
                  Analyze a document
                  <ArrowRight className="w-4 h-4" />
                </button>
              </Magnetic>
              <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
                NO CARD REQUIRED · ~30S
              </span>
            </div>
          </Reveal>

          <p className="mt-16 text-xs italic" style={{ color: "var(--text-mute)" }}>
            This is not legal advice. ClearDoc provides general information only.
          </p>
        </section>
      </div>

    </div>
  )
}
