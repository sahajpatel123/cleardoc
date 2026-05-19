"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Shield } from "lucide-react"
import { signIn } from "next-auth/react"

interface Props {
  onClose: () => void
  onSuccess: () => void
  mode?: "signin" | "signup"
}

export default function AuthModal({ onClose, onSuccess, mode = "signup" }: Props) {
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  const handleGoogle = async () => {
    setLoading(true)
    setError("")
    try {
      const res = await signIn("google", { redirect: false })
      if (res?.error) {
        setError("Google sign-in failed. Please try again.")
      } else if (res?.ok) {
        onSuccess()
      }
    } catch {
      setError("Google sign-in failed. Please try again.")
    } finally {
      setLoading(false)
    }
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
        className="relative w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
        style={{ background: "white", border: "1px solid #E8E2D9" }}
      >
        <div className="absolute top-0 left-0 right-0 h-0.5"
          style={{ background: "linear-gradient(90deg, transparent, #E8651A, transparent)" }} />

        <button onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl transition-colors z-10"
          style={{ color: "#A89484" }}>
          <X className="w-4 h-4" />
        </button>

        <div className="p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center"
              style={{ background: "#FEF0E6" }}>
              <Shield className="w-7 h-7" style={{ color: "#E8651A" }} />
            </div>
            <h2 className="text-2xl font-black mb-2" style={{ color: "#18130E", fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
              {mode === "signup" ? "Create your free account" : "Welcome back"}
            </h2>
            <p className="text-sm" style={{ color: "#6B5E52" }}>
              {mode === "signup" ? "Get 1 free document analysis. No credit card required." : "Sign in to access your analyses."}
            </p>
          </div>

          <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }}
            onClick={handleGoogle} disabled={loading}
            className="w-full flex items-center justify-center gap-3 font-medium py-3 px-4 rounded-2xl mb-4 border transition-all"
            style={{ background: "#F9F6F1", border: "1px solid #E8E2D9", color: "#18130E" }}>
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </motion.button>

          <AnimatePresence>
            {error && (
              <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs px-3 py-2 rounded-xl"
                style={{ background: "#FEF2F2", color: "#991B1B", border: "1px solid rgba(220,38,38,0.15)" }}>
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}
