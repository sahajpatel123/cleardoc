"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Zap, Check, Shield } from "lucide-react"
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
      const token = await user.getIdToken()
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else setError("Failed to start checkout. Please try again.")
    } catch { setError("Something went wrong. Please try again.") }
    finally { setLoading(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="absolute inset-0 backdrop-blur-md"
        style={{ background: "rgba(24,19,14,0.4)" }}
        onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 16 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        className="relative w-full max-w-md rounded-3xl overflow-hidden shadow-2xl"
        style={{ background: "white", border: "1px solid #E8E2D9" }}
      >
        <div className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: "linear-gradient(90deg, transparent, #E8651A, transparent)" }} />
        <button onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl transition-colors"
          style={{ color: "#A89484" }}>
          <X className="w-4 h-4" />
        </button>

        <div className="p-8">
          {/* Badge */}
          <div className="flex justify-center mb-6">
            <span className="tag tag-orange">
              <Zap className="w-3 h-3" /> YOU'VE USED YOUR FREE ANALYSIS
            </span>
          </div>

          <div className="text-center mb-6">
            <h2 className="text-2xl font-black mb-2" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
              Upgrade to Pro
            </h2>
            <p className="text-sm" style={{ color: "#6B5E52" }}>
              Keep fighting back. Unlimited analyses for one low monthly price.
            </p>
          </div>

          {/* Price card */}
          <div className="rounded-2xl p-5 text-center mb-5"
            style={{ background: "#FEF0E6", border: "1px solid rgba(232,101,26,0.2)" }}>
            <div className="flex items-end justify-center gap-1">
              <span className="text-5xl font-black" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>$9</span>
              <span className="mb-1.5 text-sm" style={{ color: "#6B5E52" }}>/month</span>
            </div>
            <p className="text-xs mt-1" style={{ color: "#A89484" }}>Cancel anytime. No hidden fees.</p>
          </div>

          {/* Features */}
          <ul className="space-y-2.5 mb-5">
            {FEATURES.map((f, i) => (
              <motion.li key={f} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-2.5 text-sm"
                style={{ color: "#4A3F35" }}>
                <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.2)" }}>
                  <Check className="w-2.5 h-2.5" style={{ color: "#059669" }} />
                </div>
                {f}
              </motion.li>
            ))}
          </ul>

          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-xs px-3 py-2 rounded-xl mb-3"
                style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid rgba(220,38,38,0.15)" }}>
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <motion.button onClick={handleUpgrade} disabled={loading}
            whileHover={{ scale: 1.02, y: -2 }} whileTap={{ scale: 0.98 }}
            className="w-full btn-primary justify-center !py-4 !rounded-2xl text-base">
            <Shield className="w-5 h-5" />
            {loading ? "Redirecting..." : "Upgrade to Pro — $9/mo"}
          </motion.button>

          <p className="text-xs text-center mt-3" style={{ color: "#A89484" }}>
            🔒 Secured by Stripe · No card stored on our servers
          </p>
        </div>
      </motion.div>
    </div>
  )
}
