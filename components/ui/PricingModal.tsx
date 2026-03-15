"use client"

import { useState } from "react"
import { X, Zap, Check, Shield } from "lucide-react"
import { useAuth } from "@/context/AuthContext"

interface Props {
  onClose: () => void
}

const PRO_FEATURES = [
  "Unlimited document analyses",
  "Full red flag detection",
  "Ready-to-send response letters",
  "Priority AI processing",
  "Analysis history & dashboard",
  "Cancel anytime",
]

export default function PricingModal({ onClose }: Props) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleUpgrade = async () => {
    if (!user) return
    setLoading(true)
    setError("")

    try {
      const token = await user.getIdToken()
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      })
      const data = await res.json()

      if (data.url) {
        window.location.href = data.url
      } else {
        setError("Failed to start checkout. Please try again.")
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-[#0F1117] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />

        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-8">
          {/* Badge */}
          <div className="flex justify-center mb-6">
            <span className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-bold tracking-wider px-3 py-1.5 rounded-full">
              <Zap className="w-3 h-3" />
              YOU'VE USED YOUR FREE ANALYSIS
            </span>
          </div>

          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white mb-2">
              Upgrade to ClearDoc Pro
            </h2>
            <p className="text-slate-400 text-sm">
              Keep fighting back. Unlimited analyses for one low monthly price.
            </p>
          </div>

          {/* Price */}
          <div className="bg-amber-400/5 border border-amber-400/20 rounded-2xl p-6 mb-6 text-center">
            <div className="flex items-end justify-center gap-1">
              <span className="text-5xl font-black text-white">$9</span>
              <span className="text-slate-400 mb-2">/month</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Cancel anytime. No hidden fees.</p>
          </div>

          {/* Features */}
          <ul className="space-y-2.5 mb-6">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
                <div className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                  <Check className="w-2.5 h-2.5 text-emerald-400" />
                </div>
                {f}
              </li>
            ))}
          </ul>

          {error && (
            <p className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">
              {error}
            </p>
          )}

          <button
            onClick={handleUpgrade}
            disabled={loading}
            className="w-full bg-amber-400 hover:bg-amber-300 text-black font-bold py-4 rounded-xl transition-all text-base disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Shield className="w-4 h-4" />
            {loading ? "Redirecting to checkout..." : "Upgrade to Pro — $9/mo"}
          </button>

          <p className="text-xs text-slate-600 text-center mt-3">
            Secured by Stripe · No credit card stored on our servers
          </p>
        </div>
      </div>
    </div>
  )
}
