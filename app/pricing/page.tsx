"use client"

import { useAuth } from "@/context/AuthContext"
import { isProUser } from "@/lib/user-plan"
import { useBilling } from "@/hooks/useBilling"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Check, ArrowRight } from "lucide-react"
import { Reveal, Magnetic } from "@/components/ui/Kinetic"
import FaqAccordion from "@/components/ui/FaqAccordion"
import { PRICING_FAQ_ITEMS } from "@/lib/faq-content"

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

export default function PricingPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const { startCheckout, loading, error: billingError } = useBilling()

  const handleUpgrade = async () => {
    if (!user) {
      router.push(`/login?mode=signup&redirect=${encodeURIComponent("/pricing")}`)
      return
    }
    await startCheckout()
  }

  const isPro = isProUser(
    profile
      ? { plan: profile.plan, subscriptionStatus: profile.subscriptionStatus }
      : null,
  )

  return (
    <div className="min-h-screen pt-32 pb-32">
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
                <>
                  {billingError && (
                    <p className="text-xs mb-4" style={{ color: "var(--red)" }}>
                      {billingError}
                    </p>
                  )}
                  <Magnetic strength={6}>
                    <button
                      onClick={() => void handleUpgrade()}
                      disabled={loading}
                      className="btn btn-primary w-full justify-center"
                    >
                      {loading ? "Loading..." : "Upgrade to Pro"}
                      {!loading && <ArrowRight className="w-4 h-4" />}
                    </button>
                  </Magnetic>
                </>
              )}
            </div>
          </Reveal>
        </div>

        {/* FAQ */}
        <section id="faq" className="mt-32">
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
            <FaqAccordion items={PRICING_FAQ_ITEMS} defaultOpen={0} />
          </div>
          <p className="mt-8">
            <Link
              href="/faq"
              className="text-sm inline-flex items-center gap-1.5 transition-colors"
              style={{ color: "var(--text-3)" }}
            >
              View all questions
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </p>
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
