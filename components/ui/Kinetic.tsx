"use client"

import { motion, useInView } from "framer-motion"
import { useEffect, useRef, useState } from "react"

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

/* ── Reveal — quiet scroll-triggered reveal (no blur) ────────────────────── */
export function Reveal({
  children,
  delay = 0,
  y = 24,
  className = "",
  once = true,
}: {
  children: React.ReactNode
  delay?: number
  y?: number
  className?: string
  once?: boolean
}) {
  // Reveal-on-scroll WITHOUT relying on framer's `whileInView`. Its
  // IntersectionObserver callbacks coalesce under fast scrolling (especially on
  // mobile, where the main thread is busier), so an element can cross the whole
  // trigger zone between cycles and never latch — leaving the section stuck at
  // opacity 0 ("everything below is blank"). Instead we drive visibility from a
  // rAF-throttled scroll/resize check with a 240px pre-trigger margin: it fires
  // every frame the user scrolls, so it is impossible to skip. Once shown (the
  // default `once` behaviour) the listener detaches and the element stays visible.
  const ref = useRef<HTMLDivElement | null>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (shown && once) return // already revealed and staying — no listener needed
    let raf = 0
    const PRE = 240
    const evaluate = () => {
      raf = 0
      const node = ref.current
      if (!node) return
      const r = node.getBoundingClientRect()
      const visible = r.top < window.innerHeight + PRE && r.bottom > -PRE
      if (visible) setShown(true)
      else if (!once) setShown(false)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(evaluate) }
    evaluate() // initial check — reveals above-the-fold content on mount
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll, { passive: true })
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [shown, once])

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y }}
      animate={shown ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{ duration: 0.95, delay, ease: EASE }}
      className={className}
    >
      {children}
    </motion.div>
  )
}

/* ── SplitWords — line-by-line word rise (overflow masks) ────────────────── */
export function SplitWords({
  text,
  className = "",
  delay = 0,
  perWordDelay = 0.05,
}: { text: string; className?: string; delay?: number; perWordDelay?: number }) {
  const words = text.split(" ")
  return (
    <span className={className}>
      {words.map((w, i) => (
        <span key={i}>
          <span className="inline-block overflow-hidden align-baseline">
            <motion.span
              className="inline-block"
              initial={{ y: "110%" }}
              animate={{ y: "0%" }}
              transition={{ duration: 1.1, delay: delay + i * perWordDelay, ease: EASE }}
            >
              {w}
            </motion.span>
          </span>
          {i < words.length - 1 ? " " : ""}
        </span>
      ))}
    </span>
  )
}

/* ── Counter — animated number on view ───────────────────────────────────── */
export function Counter({
  to,
  duration = 1.8,
  prefix = "",
  suffix = "",
  className = "",
}: { to: number; duration?: number; prefix?: string; suffix?: string; className?: string }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const inView = useInView(ref, { once: true, margin: "-60px" })
  const [val, setVal] = useState(0)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (!inView || hasAnimated.current) return
    hasAnimated.current = true
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / (duration * 1000))
      const eased = 1 - Math.pow(1 - p, 3)
      setVal(Math.round(to * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, to, duration])

  return <span ref={ref} className={className}>{prefix}{val.toLocaleString()}{suffix}</span>
}

/* ── Magnetic — subtle pull toward cursor ────────────────────────────────── */
export function Magnetic({
  children,
  strength = 8,
  className = "",
}: { children: React.ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  const handleMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const dx = (e.clientX - cx) / rect.width
    const dy = (e.clientY - cy) / rect.height
    setPos({ x: dx * strength, y: dy * strength })
  }
  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMove}
      onMouseLeave={() => setPos({ x: 0, y: 0 })}
      animate={{ x: pos.x, y: pos.y }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
      className={`inline-block ${className}`}
    >
      {children}
    </motion.div>
  )
}

/* ── Marquee — slow editorial scroll ─────────────────────────────────────── */
export function Marquee({
  children,
  className = "",
}: { children: React.ReactNode; className?: string }) {
  // Duplicating children for the infinite-scroll illusion requires unique
  // keys per copy, otherwise React warns about duplicate keys and silently
  // reconciles the wrong subtree (visible animation glitches). We wrap each
  // copy in a keyed fragment so React keeps the two DOM subtrees distinct.
  const items = Array.isArray(children) ? children : [children]
  return (
    <div
      className={`marquee-host relative overflow-hidden ${className}`}
      aria-hidden="true"
      style={{
        WebkitMaskImage:
          "linear-gradient(90deg, transparent, black 140px, black calc(100% - 140px), transparent)",
        maskImage:
          "linear-gradient(90deg, transparent, black 140px, black calc(100% - 140px), transparent)",
      }}
    >
      <div className="marquee-track flex w-max" aria-hidden={false}>
        {items.map((child, i) => (
          <div key={`marquee-a-${i}`} className="flex shrink-0">
            {child}
          </div>
        ))}
        {items.map((child, i) => (
          <div key={`marquee-b-${i}`} className="flex shrink-0" aria-hidden="true">
            {child}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Word — single word, fade-up reveal ──────────────────────────────────── */
export function Word({
  children,
  delay = 0,
  className = "",
}: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <span className={`inline-block overflow-hidden align-baseline ${className}`}>
      <motion.span
        className="inline-block"
        initial={{ y: "110%" }}
        animate={{ y: "0%" }}
        transition={{ duration: 1.1, delay, ease: EASE }}
      >
        {children}
      </motion.span>
    </span>
  )
}
