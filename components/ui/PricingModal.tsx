"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Check, ArrowRight } from "lucide-react"
import { useAuth } from "@/context/AuthContext"

const FEATURES = [
  "Unlimited document analyses",
  "Full red flag detection",
  "Ready-to-send response letters",
  "Priority AI processing",
  "Analysis history & dashboard",
  "Cancel anytime",
]

export default function PricingModal({ onClose }: { onClose: () => void }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleUpgrade = async () => {
    if (!user) return
    setLoading(true); setError("")
    try {
      const res = await fetch("/api/stripe/create-checkout", { method: "POST" })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else setError("Failed to start checkout. Please try again.")
    } catch { setError("Something went wrong. Please try again.") }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgba(5,5,5,0.85)", backdropFilter: "blur(16px)" }}
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 16 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md overflow-hidden"
        style={{
          background: "var(--ink-1)",
          border: "1px solid var(--hairline-2)",
          borderRadius: 16,
          boxShadow: "0 60px 120px rgba(0,0,0,0.8)",
        }}
      >
        <div
          className="absolute top-0 left-0 h-px"
          style={{ width: 72, background: "var(--ember)" }}
        />

        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-full transition-colors z-10"
          style={{ color: "var(--text-3)" }}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-10">
          <p className="eyebrow mb-6">Free limit reached</p>
          <h2
            className="display mb-3"
            style={{ fontSize: "clamp(1.8rem, 3.2vw, 2.4rem)", color: "var(--text)" }}
          >
            <span>Keep </span>
            <span className="serif-italic" style={{ color: "var(--ember)" }}>fighting back.</span>
          </h2>
          <p className="text-sm mb-10" style={{ color: "var(--text-3)" }}>
            Unlimited analyses for one low monthly price.
          </p>

          <div className="flex items-baseline gap-1 mb-2">
            <span
              className="display"
              style={{ fontSize: "clamp(2.6rem, 5vw, 3.5rem)", color: "var(--text)" }}
            >
              $9
            </span>
            <span className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
              /month
            </span>
          </div>
          <p className="mono text-[10px] mb-8" style={{ color: "var(--text-mute)" }}>
            CANCEL ANYTIME · NO HIDDEN FEES
          </p>

          <div className="hairline-fade mb-8" />

          <ul className="space-y-3 mb-10">
            {FEATURES.map((f, i) => (
              <motion.li
                key={f}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center gap-3 text-sm"
                style={{ color: "var(--text-2)" }}
              >
                <Check className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--ember)" }} />
                {f}
              </motion.li>
            ))}
          </ul>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-xs mb-4"
                style={{ color: "var(--red)" }}
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="btn btn-primary w-full justify-center"
          >
            {loading ? "Redirecting..." : "Upgrade to Pro"}
            {!loading && <ArrowRight className="w-4 h-4" />}
          </button>

          <p className="text-[11px] text-center mt-5" style={{ color: "var(--text-mute)" }}>
            Secured by Stripe · no card stored on our servers
          </p>
        </div>
      </motion.div>
    </div>
  )
}
