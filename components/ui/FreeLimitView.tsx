"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { Clock, FileText, ArrowRight, RotateCcw } from "lucide-react"
import { Reveal, Magnetic } from "@/components/ui/Kinetic"
import { formatQuotaResetLabel } from "@/lib/free-quota"
import { useBilling } from "@/hooks/useBilling"
import { useAuth } from "@/context/AuthContext"
import { useRouter } from "next/navigation"

export type FreeLimitQuota = {
  limit: number
  used: number
  remaining: number
  resetsAt?: string
}

interface Props {
  quota?: FreeLimitQuota
  onClose?: () => void
  showModalActions?: boolean
}

export default function FreeLimitView({ quota, onClose, showModalActions = true }: Props) {
  const router = useRouter()
  const { user } = useAuth()
  const { startCheckout, loading } = useBilling()

  const limit = quota?.limit ?? 3
  const used = quota?.used ?? limit
  const resetsAt = quota?.resetsAt

  const handleUpgrade = async () => {
    if (!user) {
      router.push(`/login?mode=signup&redirect=${encodeURIComponent("/pricing")}`)
      return
    }
    await startCheckout()
  }

  return (
    <div className="min-h-screen pt-32 pb-32">
      <div className="container-edition max-w-3xl">
        <Reveal>
          <p className="eyebrow mb-8" style={{ color: "var(--ember)" }}>
            Daily allowance
          </p>
        </Reveal>

        <Reveal delay={0.06}>
          <h1
            className="display max-w-[18ch] mb-6"
            style={{ fontSize: "clamp(2.2rem, 6.5vw, 5rem)", color: "var(--text)" }}
          >
            <span>You&apos;ve hit </span>
            <span className="serif-italic" style={{ color: "var(--ember)" }}>
              today&apos;s limit.
            </span>
          </h1>
        </Reveal>

        <Reveal delay={0.12}>
          <p
            className="text-lg leading-relaxed max-w-xl mb-10"
            style={{ color: "var(--text-2)", fontFamily: "ui-serif, Georgia, serif" }}
          >
            Free accounts get {limit} document analyses per day. Come back after the reset,
            or upgrade to Pro for unlimited analyses whenever you need them.
          </p>
        </Reveal>

        <Reveal delay={0.18}>
          <div
            className="grid grid-cols-1 sm:grid-cols-2 gap-0 border rounded-xl overflow-hidden mb-12"
            style={{ borderColor: "var(--hairline-2)" }}
          >
            <div
              className="p-6 sm:p-8 border-b sm:border-b-0 sm:border-r flex flex-col justify-between min-h-[140px]"
              style={{ borderColor: "var(--hairline-2)", background: "rgba(255,106,31,0.04)" }}
            >
              <p className="mono text-[10px] tracking-[0.22em]" style={{ color: "var(--text-mute)" }}>
                USED TODAY
              </p>
              <p
                className="display"
                style={{ fontSize: "clamp(2rem, 4vw, 3rem)", color: "var(--ember)" }}
              >
                {used}
                <span className="text-lg" style={{ color: "var(--text-3)" }}>
                  {" "}
                  / {limit}
                </span>
              </p>
              <div className="flex items-center gap-2 mt-2">
                <FileText className="w-3.5 h-3.5" style={{ color: "var(--text-mute)" }} />
                <span className="text-xs" style={{ color: "var(--text-3)" }}>
                  analyses saved today
                </span>
              </div>
            </div>
            <div className="p-6 sm:p-8 flex flex-col justify-between min-h-[140px]">
              <p className="mono text-[10px] tracking-[0.22em]" style={{ color: "var(--text-mute)" }}>
                RESETS
              </p>
              <p
                className="display"
                style={{ fontSize: "clamp(1.2rem, 2.2vw, 1.6rem)", color: "var(--text)" }}
              >
                {resetsAt ? formatQuotaResetLabel(resetsAt) : "Midnight UTC"}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <Clock className="w-3.5 h-3.5" style={{ color: "var(--text-mute)" }} />
                <span className="text-xs" style={{ color: "var(--text-3)" }}>
                  allowance refreshes automatically
                </span>
              </div>
            </div>
          </div>
        </Reveal>

        {showModalActions && (
          <Reveal delay={0.22}>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
              <Magnetic strength={5}>
                <button
                  type="button"
                  onClick={() => void handleUpgrade()}
                  disabled={loading}
                  className="btn btn-primary justify-center"
                >
                  {loading ? "Redirecting…" : "Upgrade to Pro — $9/mo"}
                  {!loading && <ArrowRight className="w-4 h-4" />}
                </button>
              </Magnetic>
              <button
                type="button"
                onClick={() => (onClose ? onClose() : router.push("/"))}
                className="btn btn-ghost justify-center"
              >
                <RotateCcw className="w-4 h-4" />
                {onClose ? "Close" : "Back to home"}
              </button>
              <Link href="/pricing" className="btn btn-ghost justify-center sm:ml-auto !text-[13px]">
                Compare plans
              </Link>
            </div>
          </Reveal>
        )}

        <Reveal delay={0.28}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mt-16 p-5 rounded-lg border"
            style={{
              borderColor: "rgba(255,106,31,0.15)",
              background: "rgba(255,106,31,0.03)",
            }}
          >
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-3)" }}>
              Pro keeps your history, unlocks case linking, and removes daily caps — built for
              disputes that take more than one letter.
            </p>
          </motion.div>
        </Reveal>
      </div>
    </div>
  )
}
