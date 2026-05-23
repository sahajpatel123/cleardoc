"use client"

import { useEffect, useRef } from "react"
import { motion, useMotionValue, useTransform } from "framer-motion"

/* ─────────────────────────────────────────────────────────────────────────
 * Atmosphere — minimal background pieces.
 *
 *   <Grid />           Subtle technical grid (uses CSS, no DOM noise)
 *   <Vignette />       Soft radial darkness for sections
 *   <Tilt />           Restrained 3D tilt (small intensity by default)
 * ───────────────────────────────────────────────────────────────────────── */

export function Grid({ className = "", opacity = 0.04 }: { className?: string; opacity?: number }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(to right, rgba(245,242,235," + opacity + ") 1px, transparent 1px), linear-gradient(to bottom, rgba(245,242,235," + opacity + ") 1px, transparent 1px)",
        backgroundSize: "80px 80px",
        maskImage:
          "radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 80% 70% at 50% 50%, black 30%, transparent 100%)",
      }}
    />
  )
}

export function Vignette({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        background:
          "radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,106,31,0.06) 0%, transparent 60%), radial-gradient(ellipse 60% 50% at 50% 100%, rgba(245,242,235,0.03) 0%, transparent 60%)",
      }}
    />
  )
}

export function Tilt({
  children,
  intensity = 4,
  className = "",
}: { children: React.ReactNode; intensity?: number; className?: string }) {
  const mx = useMotionValue(0)
  const my = useMotionValue(0)
  const rx = useTransform(my, [-0.5, 0.5], [intensity, -intensity])
  const ry = useTransform(mx, [-0.5, 0.5], [-intensity, intensity])
  const ref = useRef<HTMLDivElement | null>(null)

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    mx.set((e.clientX - rect.left) / rect.width - 0.5)
    my.set((e.clientY - rect.top) / rect.height - 0.5)
  }
  const handleLeave = () => {
    mx.set(0); my.set(0)
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      style={{ perspective: 1200 }}
      className={className}
    >
      <motion.div
        style={{ rotateX: rx, rotateY: ry, transformStyle: "preserve-3d" }}
        transition={{ type: "spring", stiffness: 220, damping: 24 }}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

/* Stay quiet: a small ambient cursor that ONLY appears over interactive sections
   in case we want to opt in later. Disabled by default — re-add by including <Cursor/>
   manually. Listed here for completeness. */
export function Cursor() {
  const x = useMotionValue(-100)
  const y = useMotionValue(-100)

  useEffect(() => {
    if (typeof window === "undefined") return
    if (window.matchMedia("(pointer: coarse)").matches) return
    const move = (e: MouseEvent) => {
      x.set(e.clientX)
      y.set(e.clientY)
    }
    window.addEventListener("mousemove", move)
    return () => window.removeEventListener("mousemove", move)
  }, [x, y])

  return (
    <motion.div
      aria-hidden
      style={{ x, y }}
      className="fixed top-0 left-0 z-[60] pointer-events-none mix-blend-screen"
    >
      <div
        className="-translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          width: 320,
          height: 320,
          background:
            "radial-gradient(closest-side, rgba(255,106,31,0.10), rgba(255,106,31,0.03) 50%, transparent 70%)",
          filter: "blur(28px)",
        }}
      />
    </motion.div>
  )
}
