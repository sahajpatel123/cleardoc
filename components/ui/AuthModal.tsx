"use client"

import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"
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
          <p className="eyebrow mb-6">Sign in</p>
          <h2
            className="display mb-3"
            style={{ fontSize: "clamp(1.8rem, 3.2vw, 2.4rem)", color: "var(--text)" }}
          >
            {mode === "signup" ? (
              <>
                <span>Welcome to </span>
                <span className="serif-italic" style={{ color: "var(--ember)" }}>
                  ClearDoc.
                </span>
              </>
            ) : (
              <>Welcome back.</>
            )}
          </h2>
          <p className="text-sm mb-10" style={{ color: "var(--text-3)" }}>
            {mode === "signup"
              ? "Get one free analysis. No card required."
              : "Sign in to access your analyses."}
          </p>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="btn btn-ghost w-full justify-center"
            style={{ padding: "13px 22px" }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-xs mt-4"
                style={{ color: "var(--red)" }}
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <p className="text-[11px] mt-8" style={{ color: "var(--text-mute)" }}>
            By continuing you agree to our terms and acknowledge ClearDoc provides general information only — not legal advice.
          </p>
        </div>
      </motion.div>
    </div>
  )
}
