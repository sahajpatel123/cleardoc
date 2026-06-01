"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import {
  motion, useScroll, useTransform, AnimatePresence, useMotionValueEvent,
} from "framer-motion"
import Link from "next/link"
import UploadZone from "@/components/ui/UploadZone"
import PricingModal from "@/components/ui/PricingModal"
// Free tier analysis limit is now handled via freeUsesRemaining in user record
// import { FREE_DAILY_ANALYSIS_LIMIT } from "@/lib/free-quota"
import { useAuth } from "@/context/AuthContext"
import { setPendingAnalysis } from "@/lib/pending-analysis-store"
import { isProUser } from "@/lib/user-plan"
import { ArrowUpRight, ArrowRight, Plus } from "lucide-react"
import { Grid, Tilt, Vignette } from "@/components/ui/Atmosphere"
import { Reveal, SplitWords, Counter, Magnetic, Marquee, Word } from "@/components/ui/Kinetic"

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

const USE_CASES = [
  "Insurance denials",
  "Eviction notices",
  "Medical bills",
  "IRS letters",
  "Visa rejections",
  "Debt collection",
  "Landlord ultimatums",
  "Bank disputes",
  "Contract traps",
  "Consumer rights",
  "Billing errors",
  "Legal threats",
]

const ROTATING = [
  "insurance denial",
  "eviction notice",
  "medical bill",
  "IRS letter",
  "visa rejection",
  "debt collection threat",
  "landlord ultimatum",
]

const PROMISE = [
  {
    n: "I",
    title: "Plain English",
    body: "Every clause, demand, and Latin phrase — explained like a friend at your kitchen table. No jargon, no hedging.",
  },
  {
    n: "II",
    title: "Red flags, named",
    body: "Illegal demands, manipulation, and bluffs flagged with the exact sentence that triggered each one.",
  },
  {
    n: "III",
    title: "A counter-letter",
    body: "A firm, formal reply quoting the relevant statutes back at them. Print, sign, send.",
  },
  {
    n: "IV",
    title: "Your next moves",
    body: "Three to five concrete actions, ranked by likelihood of working — with free resources you can call today.",
  },
]

const STEPS = [
  { n: "01", title: "Upload", body: "PDF, PNG, or JPG. Up to 10MB." },
  { n: "02", title: "Whisper context", body: "One line about the situation, if you want." },
  { n: "03", title: "Walk back armed", body: "Plain English, red flags, letter, and next steps." },
]

const VOICES = [
  {
    quote:
      "It found a clause my landlord was bluffing about and wrote the exact letter that made him back off. I read it three times before I sent it.",
    name: "Mariana R.",
    tag: "Eviction notice",
  },
  {
    quote:
      "My insurance denial said 'final.' ClearDoc surfaced the appeal window and drafted my response in two minutes. Coverage approved.",
    name: "Jordan K.",
    tag: "Insurance denial",
  },
  {
    quote:
      "I thought the medical bill was non-negotiable. The analysis caught a duplicate charge and a missing itemization request. Saved $2,140.",
    name: "Priya S.",
    tag: "Medical bill",
  },
]

/* ────────────────────────────────────────────────────────────────────────
 * Document Demo — the centerpiece interactive moment.
 * A printed letter is read in real time. As you scroll, the AI underlines
 * each line and writes a plain-English margin note next to it.
 * ──────────────────────────────────────────────────────────────────────── */
const DOC_LINES: { text: string; note?: { label: "Threat" | "Bluff" | "Illegal" | "Procedural"; body: string } }[] = [
  { text: "Re: Notice to Quit" },
  { text: "Date: 12 October 2026" },
  { text: "" },
  { text: "Dear Tenant," },
  {
    text:
      "You are hereby commanded to vacate the premises within seventy-two (72) hours of receipt of this notice.",
    note: { label: "Illegal", body: "Your state requires a minimum 30-day written notice. 72 hours is not enforceable." },
  },
  {
    text:
      "Failure to comply will result in immediate eviction proceedings and forfeiture of your security deposit.",
    note: { label: "Bluff", body: "A landlord cannot keep your security deposit as a forfeiture penalty. State law caps deductions to documented damages." },
  },
  {
    text:
      "Late fees shall accrue at fifteen percent (15%) per day, compounding, until full vacancy is achieved.",
    note: { label: "Illegal", body: "Statute caps late fees at 5% per month — not 15% per day. This clause is unenforceable." },
  },
  { text: "This notice is issued under authority granted by the lease executed January 1, 2024." },
  {
    text: "Signed this day of October by the undersigned landlord.",
    note: { label: "Procedural", body: "Notice lacks notarization and a specific date — both required in your jurisdiction." },
  },
]

type DocLine = (typeof DOC_LINES)[number]

/* Map a note label to its accent colour + matching pill class. */
function noteTheme(label?: NonNullable<DocLine["note"]>["label"]) {
  if (label === "Illegal" || label === "Threat")
    return { accent: "var(--red)", soft: "rgba(229,90,62,0.20)", labelClass: "label-red" }
  if (label === "Bluff")
    return { accent: "var(--amber)", soft: "rgba(217,165,82,0.22)", labelClass: "label-amber" }
  return { accent: "var(--sky)", soft: "rgba(111,168,214,0.20)", labelClass: "label-sky" }
}

/* ── DocumentClause — one line of the notice. Shared by ALL breakpoints.
 * Renders the highlighter sweep (scaleX), the colored underline (scaleX), and
 * the ember active-caret (scaleY). Past flags stay marked; only the active flag
 * gets the caret + bold ink. Transform/opacity only — prod-build-safe. */
function DocumentClause({
  line,
  index,
  active,
  annotatedIndices,
  refCb,
}: {
  line: DocLine
  index: number
  active: number
  annotatedIndices: number[]
  refCb: (el: HTMLDivElement | null) => void
}) {
  const note = line.note
  const { accent, soft } = noteTheme(note?.label)

  const myFlagPos = annotatedIndices.indexOf(index)
  const activeFlagPos = annotatedIndices.indexOf(active)
  // A flag is "revealed" once active has reached or passed it (counts up only).
  const revealed = note != null && myFlagPos >= 0 && activeFlagPos >= myFlagPos
  const isActive = active === index
  const isEmpty = line.text === ""

  return (
    <div ref={refCb} className="relative">
      <p
        className="relative inline-block text-[12px] sm:text-[15px] transition-colors duration-500"
        style={{
          color: isEmpty ? "transparent" : "var(--ink)",
          fontFamily: "ui-serif, Georgia, serif",
          fontWeight: isActive ? 600 : 400,
          minHeight: isEmpty ? 10 : undefined,
        }}
      >
        {/* highlighter sweep behind the text (subtle tint of the flag colour) */}
        {note && (
          <motion.span
            aria-hidden
            className="absolute -inset-x-1 -inset-y-[3px] rounded-[3px] origin-left"
            style={{ background: soft, zIndex: 0 }}
            initial={false}
            animate={{ scaleX: revealed ? 1 : 0 }}
            transition={{ duration: 0.7, ease: EASE }}
          />
        )}
        <span className="relative" style={{ zIndex: 1 }}>
          {line.text || "—"}
        </span>
        {/* underline accent under the flagged clause */}
        {note && (
          <motion.span
            aria-hidden
            className="absolute left-0 right-0 -bottom-[2px] h-[2px] origin-left"
            style={{ background: accent, zIndex: 1 }}
            initial={false}
            animate={{ scaleX: revealed ? 1 : 0 }}
            transition={{ duration: 0.85, ease: EASE, delay: 0.08 }}
          />
        )}
      </p>
      {/* ember caret marking the CURRENTLY active clause */}
      {note && (
        <motion.span
          aria-hidden
          className="absolute -left-2.5 sm:-left-3 top-0 h-full w-[2px] origin-top"
          style={{ background: "var(--ember)" }}
          initial={false}
          animate={{ scaleY: isActive ? 1 : 0, opacity: isActive ? 1 : 0 }}
          transition={{ duration: 0.4, ease: EASE }}
        />
      )}
    </div>
  )
}

/* ── DocumentReader — ONE responsive sticky scrollytelling section.
 *
 * Desktop (lg+): bone paper card (left, 7 cols) + margin-note rail
 *   (right, 5 cols, lg:sticky lg:top-32). scrollYProgress drives `active`
 *   through the annotated lines; underlines reveal progressively; the rail
 *   note swaps in.
 *
 * Mobile (<lg): SAME engine, SAME `active`. The pinned frame (below the navbar,
 *   100svh tall via the .reader-pin class) stacks the compact paper card on top
 *   and a fixed-height "margin note" dock below it. Only the active note is
 *   shown (AnimatePresence) so card + note always fit 390x844 with zero
 *   clipping. The card body scrolls INTERNALLY (capped height + JS scrollTo
 *   centring the active clause) so the page scroll only ever advances
 *   scrollYProgress.
 *
 * Prod-build-safe: opacity / x / y / scaleX / scaleY only — never height:"auto",
 * never framer repeat:Infinity (the live dot uses CSS .dot-pulse).
 * ──────────────────────────────────────────────────────────────────────── */
function DocumentReader() {
  const ref = useRef<HTMLDivElement | null>(null)
  const cardScrollRef = useRef<HTMLDivElement | null>(null)
  const lineRefs = useRef<(HTMLDivElement | null)[]>([])
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  })
  const [active, setActive] = useState(-1)

  const annotatedIndices = DOC_LINES
    .map((l, i) => (l.note ? i : -1))
    .filter((i) => i >= 0)
  const totalFlags = annotatedIndices.length

  // One scroll-driver for ALL breakpoints. (totalFlags + 1) frames over
  // scrollYProgress: frame 0 = intro (-1), then each annotated index in order.
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    const frame = Math.min(totalFlags, Math.floor(v * (totalFlags + 1)))
    const next = frame === 0 ? -1 : annotatedIndices[frame - 1]
    setActive((prev) => (prev === next ? prev : next))
  })

  // Mobile only (no-op on desktop where the card isn't height-capped): keep the
  // active clause centred inside the card's internal scroll viewport. This is a
  // real element scroll (scrollTo), NOT a transform, so it never fights the
  // page scroll that drives scrollYProgress.
  useEffect(() => {
    const box = cardScrollRef.current
    if (!box) return
    if (active < 0) {
      box.scrollTo({ top: 0, behavior: "smooth" })
      return
    }
    const el = lineRefs.current[active]
    if (!el) return
    const target = el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2
    box.scrollTo({ top: Math.max(0, target), behavior: "smooth" })
  }, [active])

  const activeNote = active >= 0 ? DOC_LINES[active]?.note : undefined
  const activeTheme = noteTheme(activeNote?.label)
  const foundCount = active < 0 ? 0 : annotatedIndices.indexOf(active) + 1
  const done = foundCount >= totalFlags

  return (
    <section
      ref={ref}
      className="relative"
      style={{ height: `${(totalFlags + 1) * 90}vh` }}
    >
      {/* Pinned frame. Desktop: top:0, h:100vh, content vertically centred.
          Mobile: pinned below the fixed navbar, h:100svh-navbar (the .reader-pin
          class sets top/height per breakpoint so the iOS dynamic toolbar can
          never crop the bottom note dock). */}
      <div className="reader-pin sticky overflow-hidden flex items-center">
        <div className="absolute inset-0 pointer-events-none">
          <Grid opacity={0.025} />
        </div>

        <div className="relative z-10 w-full">
          <div className="container-edition">
            {/* Section label + live red-flag counter (mobile) / hint (desktop) */}
            <div className="mb-5 sm:mb-10 lg:mb-14 flex items-baseline justify-between gap-4">
              <p className="eyebrow">Demonstration · 01</p>

              {/* Desktop hint */}
              <p
                className="mono text-[10px] hidden lg:block"
                style={{ color: "var(--text-mute)" }}
              >
                Scroll to read along
              </p>

              {/* Mobile live counter — the "alive analyst" readout. */}
              <span className="flex items-center gap-2 lg:hidden shrink-0">
                <span
                  className={`block h-1.5 w-1.5 rounded-full ${done ? "" : "dot-pulse"}`}
                  style={{ background: done ? "var(--moss)" : "var(--ember)" }}
                />
                <motion.span
                  key={foundCount}
                  initial={{ y: 6, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.35, ease: EASE }}
                  className="mono text-[10px] uppercase tracking-[0.16em]"
                  style={{ color: done ? "var(--moss)" : "var(--ember)" }}
                >
                  {foundCount}/{totalFlags}
                </motion.span>
                <span
                  className="mono text-[10px] tracking-[0.12em]"
                  style={{ color: "var(--text-mute)" }}
                >
                  FLAGS
                </span>
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-16 items-start">
              {/* ── THE DOCUMENT (top on mobile, left col on desktop) ── */}
              <div className="lg:col-span-7">
                <div
                  className="paper rounded-lg relative p-5 sm:p-8 lg:p-12"
                  style={{ boxShadow: "0 40px 120px rgba(0,0,0,0.6)" }}
                >
                  <p
                    className="mono uppercase tracking-[0.3em] text-[9px] sm:text-[10px] mb-4 sm:mb-6 lg:mb-8"
                    style={{ color: "rgba(0,0,0,0.45)" }}
                  >
                    Notice to Quit · From the Office of the Landlord
                  </p>

                  {/* Internal scroll viewport — capped height on mobile so the
                      card never pushes the bottom note dock off-screen. On
                      desktop .reader-card-scroll is height:auto (no cap). */}
                  <div
                    ref={cardScrollRef}
                    className="reader-card-scroll space-y-1.5 sm:space-y-2 lg:space-y-2.5 leading-relaxed"
                  >
                    {DOC_LINES.map((line, i) => (
                      <DocumentClause
                        key={i}
                        line={line}
                        index={i}
                        active={active}
                        annotatedIndices={annotatedIndices}
                        refCb={(el) => { lineRefs.current[i] = el }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {/* ── THE MARGIN NOTE ──
                  Desktop: right rail, lg:sticky lg:top-32.
                  Mobile: fixed-height dock directly below the card; only the
                  ACTIVE note shows, swapped via AnimatePresence.
                  Lives OUTSIDE .paper so var(--text) (bone) is not overridden
                  by the `.paper h3 { color: var(--ink) }` rule. */}
              <div className="lg:col-span-5 lg:sticky lg:top-32">
                <p className="eyebrow mb-3 sm:mb-6">
                  {active >= 0 ? "Margin note" : "Read with us"}
                </p>

                <div className="reader-note-dock relative">
                  <AnimatePresence mode="wait">
                    {activeNote ? (
                      <motion.div
                        key={active}
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -14 }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="absolute inset-0 lg:static"
                      >
                        <span className={`label ${activeTheme.labelClass}`}>
                          {activeNote.label}
                        </span>
                        <h3
                          className="display mt-4 sm:mt-5 reader-note-body"
                          style={{ color: "var(--text)" }}
                        >
                          {activeNote.body}
                        </h3>
                        <div className="hairline mt-4 sm:mt-8 mb-3 sm:mb-6" />
                        <p
                          className="text-[13px] sm:text-sm reader-note-source"
                          style={{ color: "var(--text-3)" }}
                        >
                          Source:{" "}
                          <span style={{ color: "var(--text-2)" }} className="italic">
                            &ldquo;{DOC_LINES[active]?.text}&rdquo;
                          </span>
                        </p>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="intro"
                        initial={{ opacity: 0, y: 14 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -14 }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="absolute inset-0 lg:static"
                      >
                        <h3 className="display reader-note-body" style={{ color: "var(--text)" }}>
                          A real eviction notice, marked up the way we&apos;d mark it up for you.
                        </h3>
                        <div className="hairline mt-4 sm:mt-8 mb-3 sm:mb-6" />
                        <p
                          className="text-[13px] sm:text-sm reader-note-source"
                          style={{ color: "var(--text-3)" }}
                        >
                          Keep scrolling. Each underline is a place where our AI found
                          something worth flagging.
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
function HomeContent() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const uploadRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [context, setContext] = useState("")
  const [parentAnalysisId, setParentAnalysisId] = useState("")
  const [priorAnalyses, setPriorAnalyses] = useState<
    { id: string; documentName: string; createdAt: string }[]
  >([])
  const [showPricing, setShowPricing] = useState(false)
  const [limitQuota, setLimitQuota] = useState<{
    limit: number
    used: number
    remaining: number
    resetsAt?: string
  } | null>(null)
  const [rotIdx, setRotIdx] = useState(0)

  const { scrollY } = useScroll()
  const heroY = useTransform(scrollY, [0, 600], [0, -60])

  useEffect(() => {
    const t = setInterval(() => setRotIdx((i) => (i + 1) % ROTATING.length), 2400)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#upload") return
    const scroll = () =>
      uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
    requestAnimationFrame(scroll)
    const t = setTimeout(scroll, 400)
    return () => clearTimeout(t)
  }, [])

  const isPro =
    profile &&
    isProUser({ plan: profile.plan, subscriptionStatus: profile.subscriptionStatus })

  useEffect(() => {
    if (!user || !isPro) return
    const controller = new AbortController()
    fetch("/api/analyses", { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: { id: string; documentName: string; createdAt: string }[]) => {
        if (Array.isArray(data)) setPriorAnalyses(data)
      })
      .catch((err) => {
        if (err?.name === "AbortError") return
        // Optional feature (case-linking picker) — degrade silently but log.
        console.warn("[home] failed to load prior analyses:", err)
      })
    return () => controller.abort()
  }, [user, isPro])

  const scrollToUpload = () =>
    uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })

  const handleAnalyze = async () => {
    if (!file) return
    await setPendingAnalysis({
      file,
      context,
      parentAnalysisId: parentAnalysisId || undefined,
    })
    if (!user) {
      router.push(`/login?mode=signup&redirect=${encodeURIComponent("/analyze/session")}`)
      return
    }
    if (
      profile &&
      !isProUser({
        plan: profile.plan,
        subscriptionStatus: profile.subscriptionStatus,
      }) &&
      (profile.freeAnalysesRemainingToday ?? profile.freeUsesRemaining) <= 0
    ) {
      setLimitQuota({
        limit: profile.freeDailyLimit ?? 3,
        used: profile.freeAnalysesUsedToday ?? 0,
        remaining: 0,
        resetsAt: profile.resetsAt,
      })
      setShowPricing(true)
      return
    }
    router.push("/analyze/session")
  }

  return (
    <div className="relative">
      {/* ─── HERO ─────────────────────────────────────────────────── */}
      <section
        ref={heroRef}
        className="relative min-h-[92vh] pt-32 sm:pt-40 pb-24 overflow-x-clip overflow-y-visible max-md:min-h-[80vh] max-md:pt-20"
      >
        <div className="absolute inset-0 pointer-events-none">
          <Grid opacity={0.035} />
          <Vignette />
        </div>

        <motion.div
          style={{ y: heroY }}
          className="container-edition relative z-10"
        >
          {/* The big idea */}
          <h1
            className="display hero-headline max-w-[16ch] mb-2 sm:mb-4"
            style={{
              fontSize: "clamp(2.6rem, 8vw, 7rem)",
              color: "var(--text)",
            }}
          >
            <SplitWords text="A second pair of eyes" delay={0.15} />
            <br />
            <span style={{ color: "var(--text-3)" }}>
              <SplitWords text="on the" delay={0.5} />{" "}
            </span>
            <Word delay={0.7}>
              <span className="ember-mark">document</span>
            </Word>{" "}
            <Word delay={0.85}>
              <span className="serif-italic" style={{ color: "var(--text-2)" }}>
                that
              </span>
            </Word>{" "}
            <Word delay={1.0}>
              <span className="serif-italic" style={{ color: "var(--text-2)" }}>
                scares
              </span>
            </Word>{" "}
            <Word delay={1.15}>
              <span className="serif-italic" style={{ color: "var(--text-2)" }}>
                you.
              </span>
            </Word>
          </h1>

          {/* Sub-meta row */}
          <div className="mt-16 sm:mt-24 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start max-md:mt-10 max-md:gap-6">
            <div className="lg:col-span-7">
              <Reveal delay={0.5}>
                <p
                  className="text-[clamp(1rem,1.3vw,1.25rem)] max-w-xl leading-relaxed"
                  style={{ color: "var(--text-2)" }}
                >
                  Upload any official document and walk back with plain English, the bluffs and illegal
                  clauses named, a ready-to-send counter-letter, and the next moves that actually work.
                  Thirty seconds.
                </p>
              </Reveal>

              <Reveal delay={0.7}>
                <div className="mt-9 flex items-center gap-3 flex-wrap">
                  <Magnetic strength={6}>
                    <button onClick={scrollToUpload} className="btn btn-primary">
                      Try free
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </Magnetic>
                  <Link href="#demo" className="btn btn-ghost">
                    See it work
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </Reveal>

              <Reveal delay={0.85}>
                <div className="mt-12 flex items-center gap-5 text-xs" style={{ color: "var(--text-mute)" }}>
                  <span>3 analyses free per day</span>
                  <span className="w-px h-3 hidden sm:block" style={{ background: "var(--hairline-2)" }} />
                  <span className="hidden sm:inline">Files not stored · only results saved</span>
                </div>
              </Reveal>
            </div>

            {/* Sidebar — rotating doc type */}
            <div className="lg:col-span-5">
              <Reveal delay={0.8}>
                <div
                  className="hero-built-for border-l pl-6 sm:pl-7 max-md:border-l-0 max-md:pl-0"
                  style={{ borderColor: "var(--hairline-2)" }}
                >
                  <p className="eyebrow mb-5">Built for</p>
                  <div className="hero-rotate-slot" aria-live="polite" aria-atomic="true">
                    <AnimatePresence mode="wait">
                      <motion.h3
                        key={rotIdx}
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -20, opacity: 0 }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="display hero-rotate-phrase"
                        style={{
                          color: "var(--text)",
                          position: "absolute",
                          inset: "0.06em 0 0 0",
                        }}
                      >
                        the {ROTATING[rotIdx]}.
                      </motion.h3>
                    </AnimatePresence>
                  </div>
                  <p className="mt-5 sm:mt-6 text-xs leading-relaxed" style={{ color: "var(--text-3)" }}>
                    And dozens more — IRS letters, visa rejections, debt collection, bank disputes, contracts.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </motion.div>

        <div className="container-edition relative z-10 mt-20 sm:mt-32 max-md:mt-12">
          <div className="hairline" />
        </div>
      </section>

      {/* ─── MARQUEE ─────────────────────────────────────────────── */}
      <section className="relative py-12 sm:py-16 overflow-hidden">
        <Marquee>
          {USE_CASES.map((u, i) => (
            <div key={`${u}-${i}`} className="flex items-baseline shrink-0">
              <span
                className="display whitespace-nowrap pr-10"
                style={{
                  fontSize: "clamp(2.5rem, 6vw, 4.5rem)",
                  color: "var(--text)",
                  letterSpacing: "-0.04em",
                }}
              >
                {u}
              </span>
              <Plus className="w-4 h-4 shrink-0 mr-10" style={{ color: "var(--ember)" }} />
            </div>
          ))}
        </Marquee>
      </section>

      <div className="container-edition"><div className="hairline" /></div>

      {/* ─── PROMISE / WHAT YOU GET ──────────────────────────────── */}
      <section className="relative py-28 sm:py-40 max-md:py-16">
        <div className="container-edition">
          <Reveal>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-20 sm:mb-28 items-end max-md:mb-12 max-md:gap-6">
              <div className="md:col-span-3">
                <p className="eyebrow">Chapter 01</p>
              </div>
              <h2
                className="md:col-span-9 display"
                style={{ fontSize: "clamp(2rem, 5.5vw, 5rem)", color: "var(--text)" }}
              >
                What we hand back to you.
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16 sm:gap-y-24 max-md:gap-y-10">
            {PROMISE.map((p, i) => (
              <Reveal key={p.n} delay={i * 0.08}>
                <div>
                  <div className="flex items-baseline gap-4 mb-5">
                    <span
                      className="mono text-[11px]"
                      style={{ color: "var(--text-mute)", letterSpacing: "0.2em" }}
                    >
                      {p.n}
                    </span>
                    <div className="flex-1 h-px" style={{ background: "var(--hairline-2)" }} />
                  </div>
                  <h3
                    className="display mb-4"
                    style={{
                      fontSize: "clamp(1.6rem, 2.8vw, 2.5rem)",
                      color: "var(--text)",
                    }}
                  >
                    {p.title}
                  </h3>
                  <p className="text-base leading-relaxed max-w-md" style={{ color: "var(--text-3)" }}>
                    {p.body}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── DOCUMENT READER (the wow) ─────────────────────────── */}
      <div id="demo">
        <DocumentReader />
      </div>

      {/* ─── HOW IT WORKS ──────────────────────────────────────── */}
      <section className="relative py-28 sm:py-40 border-t max-md:py-16" style={{ borderColor: "var(--hairline)" }}>
        <div className="container-edition">
          <Reveal>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-20 items-end max-md:mb-12 max-md:gap-6">
              <div className="md:col-span-3">
                <p className="eyebrow">Chapter 02</p>
              </div>
              <h2
                className="md:col-span-9 display"
                style={{ fontSize: "clamp(2rem, 5.5vw, 5rem)", color: "var(--text)" }}
              >
                Three steps. Thirty seconds.
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-l max-md:border-l-0" style={{ borderColor: "var(--hairline-2)" }}>
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.1}>
                <div
                  className="p-8 sm:p-10 border-b border-r relative min-h-[260px] flex flex-col justify-between max-md:p-5 max-md:min-h-[180px]"
                  style={{ borderColor: "var(--hairline-2)" }}
                >
                  <span
                    className="mono text-[11px] tracking-[0.2em]"
                    style={{ color: "var(--text-mute)" }}
                  >
                    {s.n}
                  </span>
                  <div>
                    <h3
                      className="display mb-3"
                      style={{
                        fontSize: "clamp(1.6rem, 2.6vw, 2.2rem)",
                        color: "var(--text)",
                      }}
                    >
                      {s.title}
                    </h3>
                    <p className="text-sm leading-relaxed" style={{ color: "var(--text-3)" }}>
                      {s.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── UPLOAD ────────────────────────────────────────────── */}
      <section
        ref={uploadRef}
        id="upload"
        className="relative py-28 sm:py-40 border-t max-md:py-16"
        style={{ borderColor: "var(--hairline)" }}
      >
        <div className="container-edition relative">
          <Reveal>
            <div className="mb-16 sm:mb-20 text-center max-w-4xl mx-auto">
              <p className="eyebrow mb-6 sm:mb-8">Chapter 03</p>
              <h2
                className="display balance"
                style={{ fontSize: "clamp(2rem, 5.5vw, 5rem)", color: "var(--text)" }}
              >
                Hand us the document.
              </h2>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="max-w-2xl mx-auto">
              <UploadZone file={file} onFileSelect={setFile} onClear={() => setFile(null)} />
              <div className="mt-6">
                <input
                  type="text"
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder='Optional whisper — e.g. "Insurance denied my surgery"'
                  className="field"
                />
              </div>
              {isPro && priorAnalyses.length > 0 && (
                <div className="mt-4">
                  <label
                    className="mono text-[10px] tracking-[0.18em] block mb-2"
                    style={{ color: "var(--text-mute)" }}
                  >
                    Follow-up to a previous document? (Pro)
                  </label>
                  <select
                    value={parentAnalysisId}
                    onChange={(e) => setParentAnalysisId(e.target.value)}
                    className="field w-full"
                  >
                    <option value="">No — this is a new case</option>
                    {priorAnalyses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.documentName} (
                        {new Date(a.createdAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                        )
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="mt-10 flex items-center gap-4 flex-wrap">
                <Magnetic strength={6}>
                  <button
                    onClick={handleAnalyze}
                    disabled={!file}
                    className={file ? "btn btn-primary" : "btn btn-ghost"}
                    style={!file ? { opacity: 0.45, cursor: "not-allowed" } : {}}
                  >
                    Analyze
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </Magnetic>
                <p className="mono text-[11px]" style={{ color: "var(--text-mute)" }}>
                  Encrypted in transit · original files not stored
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── VOICES ────────────────────────────────────────────── */}
      <section className="relative py-28 sm:py-40 border-t max-md:py-16" style={{ borderColor: "var(--hairline)" }}>
        <div className="container-edition">
          <Reveal>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-20 items-end max-md:mb-12 max-md:gap-6">
              <div className="md:col-span-3">
                <p className="eyebrow">Chapter 04</p>
              </div>
              <h2
                className="md:col-span-9 display"
                style={{ fontSize: "clamp(2rem, 5.5vw, 5rem)", color: "var(--text)" }}
              >
                <span style={{ color: "var(--text)" }}>People who walked in scared.</span>{" "}
                <span className="serif-italic" style={{ color: "var(--text-3)" }}>
                  Walked out winning.
                </span>
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0">
            {VOICES.map((v, i) => (
              <Reveal key={i} delay={i * 0.1}>
                <Tilt intensity={2}>
                  <div
                    className="p-8 sm:p-10 h-full flex flex-col justify-between border-l max-md:p-5"
                    style={{ borderColor: "var(--hairline-2)", minHeight: "clamp(240px, 50vw, 320px)" }}
                  >
                    <p
                      className="text-lg leading-snug mb-8 serif-italic"
                      style={{ color: "var(--text)", fontFamily: "ui-serif, Georgia, serif" }}
                    >
                      &ldquo;{v.quote}&rdquo;
                    </p>
                    <div className="flex items-baseline justify-between">
                      <p className="text-sm" style={{ color: "var(--text-2)" }}>
                        — {v.name}
                      </p>
                      <span
                        className="mono text-[10px] uppercase tracking-widest"
                        style={{ color: "var(--text-mute)" }}
                      >
                        {v.tag}
                      </span>
                    </div>
                  </div>
                </Tilt>
              </Reveal>
            ))}
          </div>
          <p className="mt-8 mono text-[10px]" style={{ color: "var(--text-mute)" }}>
            Illustrative examples. Individual results vary.
          </p>
        </div>
      </section>

      {/* ─── STATS ─────────────────────────────────────────────── */}
      <section className="relative py-24 border-y max-md:py-16" style={{ borderColor: "var(--hairline)" }}>
        <div className="container-edition">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
            {[
              { v: 30, suffix: "s", label: "Average time" },
              { v: 18, suffix: "k+", label: "Patterns recognized" },
              { v: 8, suffix: "+", label: "Document categories" },
              { v: 100, suffix: "%", label: "Private · results only" },
            ].map((s, i) => (
              <Reveal key={i} delay={i * 0.08}>
                <div
                  className="px-2 md:px-6 py-4 md:border-r max-md:py-3"
                  style={{ borderColor: i < 3 ? "var(--hairline-2)" : "transparent" }}
                >
                  <Counter
                    to={s.v}
                    suffix={s.suffix}
                    className="display"
                  />
                  <style jsx>{`
                    div :global(.display) {
                      font-size: clamp(2.2rem, 5vw, 4rem);
                      color: var(--text);
                      display: block;
                      margin-bottom: 6px;
                    }
                  `}</style>
                  <p className="mono text-[10px] uppercase tracking-[0.18em]" style={{ color: "var(--text-mute)" }}>
                    {s.label}
                  </p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─────────────────────────────────────────── */}
      <section className="relative py-32 sm:py-48 overflow-hidden max-md:py-20">
        <div className="absolute inset-0 pointer-events-none">
          <Grid opacity={0.04} />
        </div>
        <div className="container-edition relative">
          <Reveal>
            <p className="eyebrow mb-10">Last page</p>
            <h2
              className="display max-w-[14ch]"
              style={{ fontSize: "clamp(2.6rem, 9vw, 8rem)", color: "var(--text)" }}
            >
              <span>Ready </span>
              <span className="serif-italic" style={{ color: "var(--ember)" }}>when</span>
              <span> you are.</span>
            </h2>
          </Reveal>

          <Reveal delay={0.2}>
            <div className="mt-12 sm:mt-16 flex items-center gap-4 flex-wrap max-md:mt-8">
              <Magnetic strength={8}>
                <button onClick={scrollToUpload} className="btn btn-primary !px-6 !py-3.5 !text-[15px]">
                  Try free
                  <ArrowRight className="w-4 h-4" />
                </button>
              </Magnetic>
              <Link href="/pricing" className="btn-link">
                $9/month, unlimited
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      <AnimatePresence>
        {showPricing && (
          <PricingModal
            onClose={() => setShowPricing(false)}
            quota={limitQuota ?? undefined}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default function HomePage() {
  return <HomeContent />
}
