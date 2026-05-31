"use client"

import { useEffect, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "framer-motion"
import { X, Check, ArrowRight } from "lucide-react"
import { useAuth } from "@/context/AuthContext"
import { useBilling } from "@/hooks/useBilling"
import { FREE_DAILY_ANALYSIS_LIMIT, formatQuotaResetLabel } from "@/lib/free-quota"
import type { FreeLimitQuota } from "@/components/ui/FreeLimitView"

const FEATURES = [
  "Unlimited document analyses",
  "Full red flag detection",
  "Ready-to-send response letters",
  "Analysis history & dashboard",
  "Cancel anytime via dashboard",
]

export default function PricingModal({
  onClose,
  quota,
  triggerRef,
}: {
  onClose: () => void
  quota?: FreeLimitQuota
  triggerRef?: React.RefObject<HTMLButtonElement | null>
}) {
  const router = useRouter()
  const { user } = useAuth()
  const { startCheckout, loading, error } = useBilling()
  const modalRef = useRef<HTMLDivElement>(null)

  const handleUpgrade = async () => {
    if (!user) {
      router.push(`/login?mode=signup&redirect=${encodeURIComponent("/pricing")}`)
      return
    }
    await startCheckout()
  }

  // Focus-trap: trap Tab within the modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
        return
      }
      if (e.key !== "Tab") return
      const modal = modalRef.current
      if (!modal) return
      const focusable = modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [onClose],
  )

  // Close on Escape + focus-trap
  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [handleKeyDown])

  // Focus the modal on mount; restore trigger on unmount
  useEffect(() => {
    const trigger = triggerRef?.current
    const timer = setTimeout(() => {
      const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      firstFocusable?.focus()
    }, 50)
    return () => {
      clearTimeout(timer)
      trigger?.focus()
    }
  }, [triggerRef])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Upgrade to ClearDoc Pro"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0"
        style={{ background: "rgba(5,5,5,0.85)", backdropFilter: "blur(16px)" }}
        onClick={onClose}
      />

      <motion.div
        ref={modalRef}
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
          aria-label="Close upgrade dialog"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-10">
          <p className="eyebrow mb-6">Daily allowance</p>
          <h2
            className="display mb-3"
            style={{ fontSize: "clamp(1.8rem, 3.2vw, 2.4rem)", color: "var(--text)" }}
          >
            <span>Today&apos;s </span>
            <span className="serif-italic" style={{ color: "var(--ember)" }}>{quota?.limit} are used.</span>
          </h2>
          <p className="text-sm mb-6 leading-relaxed" style={{ color: "var(--text-3)" }}>
            Free accounts include {FREE_DAILY_ANALYSIS_LIMIT} analyses per day.
            {quota?.resetsAt ? (
              <> Resets {formatQuotaResetLabel(quota.resetsAt)}.</>
            ) : (
              <> Resets at midnight UTC.</>
            )}
          </p>

          {quota && (
            <div
              className="flex items-center justify-between gap-4 mb-8 py-3 px-4 rounded-lg border"
              style={{ borderColor: "var(--hairline-2)", background: "rgba(255,106,31,0.04)" }}
            >
              <span className="mono text-[10px] tracking-[0.18em]" style={{ color: "var(--text-mute)" }}>
                TODAY
              </span>
              <span
                style={{
                  color: "var(--ember)",
                  fontFamily: "var(--font-syne,'Syne',sans-serif)",
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                }}
              >
                {quota.used} / {quota.limit}
              </span>
            </div>
          )}

          <p className="text-sm mb-8" style={{ color: "var(--text-3)" }}>
            Upgrade for unlimited analyses — one flat monthly price.
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
            onClick={() => void handleUpgrade()}
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
