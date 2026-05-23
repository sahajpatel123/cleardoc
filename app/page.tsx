"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  motion, useScroll, useTransform, AnimatePresence, useMotionValueEvent,
} from "framer-motion"
import Link from "next/link"
import UploadZone from "@/components/ui/UploadZone"
import AuthModal from "@/components/ui/AuthModal"
import PricingModal from "@/components/ui/PricingModal"
import { useAuth } from "@/context/AuthContext"
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

function DocumentReader() {
  const ref = useRef<HTMLDivElement | null>(null)
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  })
  const [active, setActive] = useState(-1)

  const annotatedIndices = DOC_LINES.map((l, i) => (l.note ? i : -1)).filter((i) => i >= 0)

  useMotionValueEvent(scrollYProgress, "change", (v) => {
    // 6 sticky frames: -1, then each annotated index in order
    const frame = Math.min(annotatedIndices.length, Math.floor(v * (annotatedIndices.length + 1)))
    const next = frame === 0 ? -1 : annotatedIndices[frame - 1]
    setActive(next)
  })

  const activeNote = active >= 0 ? DOC_LINES[active]?.note : undefined

  return (
    <section
      ref={ref}
      className="relative"
      style={{ height: `${(annotatedIndices.length + 1) * 90}vh` }}
    >
      <div className="sticky top-0 h-screen flex items-center overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <Grid opacity={0.025} />
        </div>

        <div className="relative z-10 w-full">
          <div className="container-edition">
            {/* Section label */}
            <div className="mb-10 sm:mb-14 flex items-baseline justify-between">
              <p className="eyebrow">Demonstration · 01</p>
              <p className="mono text-[10px]" style={{ color: "var(--text-mute)" }}>
                Scroll to read along
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-start">
              {/* LEFT: the document */}
              <div className="lg:col-span-7">
                <div className="paper rounded-lg p-8 sm:p-12 relative" style={{ boxShadow: "0 40px 120px rgba(0,0,0,0.6)" }}>
                  <p
                    className="mono text-[10px] uppercase tracking-[0.3em] mb-8"
                    style={{ color: "rgba(0,0,0,0.45)" }}
                  >
                    Notice to Quit · From the Office of the Landlord
                  </p>
                  <div className="space-y-2 sm:space-y-2.5 leading-relaxed">
                    {DOC_LINES.map((line, i) => {
                      const isActive = active === i
                      const isPast = annotatedIndices.indexOf(i) >= 0 && annotatedIndices.indexOf(i) <= annotatedIndices.indexOf(active)
                      return (
                        <div key={i} className="relative">
                          <p
                            className="text-[13px] sm:text-[15px] transition-colors duration-500"
                            style={{
                              color: line.text === "" ? "transparent" : "var(--ink)",
                              fontFamily: "ui-serif, Georgia, serif",
                              minHeight: line.text === "" ? 12 : "auto",
                            }}
                          >
                            {line.text || "—"}
                          </p>
                          {line.note && (
                            <motion.div
                              className="absolute left-0 right-0 -bottom-[2px] h-[2px] origin-left"
                              style={{
                                background:
                                  line.note.label === "Illegal"
                                    ? "var(--red)"
                                    : line.note.label === "Bluff"
                                      ? "var(--amber)"
                                      : line.note.label === "Threat"
                                        ? "var(--red)"
                                        : "var(--sky)",
                              }}
                              initial={{ scaleX: 0 }}
                              animate={{ scaleX: isPast ? 1 : 0 }}
                              transition={{ duration: 0.9, ease: EASE }}
                            />
                          )}
                          {isActive && line.note && (
                            <motion.div
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              exit={{ opacity: 0 }}
                              className="absolute -left-3 top-0 h-full w-[2px]"
                              style={{ background: "var(--ember)" }}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* RIGHT: the margin note */}
              <div className="lg:col-span-5 lg:sticky lg:top-32">
                <p className="eyebrow mb-6">
                  {active >= 0 ? "Margin note" : "Read with us"}
                </p>
                <AnimatePresence mode="wait">
                  {activeNote ? (
                    <motion.div
                      key={active}
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -16 }}
                      transition={{ duration: 0.6, ease: EASE }}
                    >
                      <span
                        className={`label ${
                          activeNote.label === "Illegal" || activeNote.label === "Threat"
                            ? "label-red"
                            : activeNote.label === "Bluff"
                              ? "label-amber"
                              : "label-sky"
                        } mb-5`}
                      >
                        {activeNote.label}
                      </span>
                      <h3
                        className="display mt-5"
                        style={{ fontSize: "clamp(1.5rem, 2.5vw, 2.2rem)", color: "var(--text)" }}
                      >
                        {activeNote.body}
                      </h3>
                      <div className="hairline mt-8 mb-6" />
                      <p className="text-sm" style={{ color: "var(--text-3)" }}>
                        Source: <span style={{ color: "var(--text-2)" }} className="italic">&ldquo;{DOC_LINES[active]?.text}&rdquo;</span>
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="intro"
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -16 }}
                      transition={{ duration: 0.6, ease: EASE }}
                    >
                      <h3
                        className="display"
                        style={{ fontSize: "clamp(1.5rem, 2.5vw, 2.2rem)", color: "var(--text)" }}
                      >
                        A real eviction notice, marked up the way we&apos;d mark it up for you.
                      </h3>
                      <div className="hairline mt-8 mb-6" />
                      <p className="text-sm" style={{ color: "var(--text-3)" }}>
                        Keep scrolling. Each underline is a place where our AI found something worth flagging.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
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
  const searchParams = useSearchParams()
  const { user, profile } = useAuth()
  const uploadRef = useRef<HTMLDivElement>(null)
  const heroRef = useRef<HTMLDivElement>(null)

  const [file, setFile] = useState<File | null>(null)
  const [context, setContext] = useState("")
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signup")
  const [showPricing, setShowPricing] = useState(false)
  const [rotIdx, setRotIdx] = useState(0)
  const pendingAnalysis = useRef(false)

  const { scrollY } = useScroll()
  const heroY = useTransform(scrollY, [0, 600], [0, -60])

  useEffect(() => {
    const t = setInterval(() => setRotIdx((i) => (i + 1) % ROTATING.length), 2400)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const p = searchParams.get("auth")
    if (p === "signin" || p === "signup") {
      queueMicrotask(() => {
        setAuthMode(p)
        setShowAuth(true)
      })
    }
  }, [searchParams])

  const scrollToUpload = () =>
    uploadRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })

  const handleAnalyze = async () => {
    if (!file) return
    if (!user) {
      pendingAnalysis.current = true
      setAuthMode("signup")
      setShowAuth(true)
      return
    }
    if (profile && profile.plan !== "pro" && profile.freeUsesRemaining <= 0) {
      setShowPricing(true)
      return
    }
    const ab = await file.arrayBuffer()
    const u8 = new Uint8Array(ab)
    const b64 = btoa(String.fromCharCode(...Array.from(u8)))
    sessionStorage.setItem(
      "pendingAnalysis",
      JSON.stringify({
        fileName: file.name,
        fileType: file.type,
        fileBase64: b64,
        context,
      }),
    )
    router.push("/analyze")
  }

  const handleAuthSuccess = () => {
    setShowAuth(false)
    if (pendingAnalysis.current && file) {
      pendingAnalysis.current = false
      setTimeout(handleAnalyze, 300)
    }
  }

  return (
    <div className="relative">
      {/* ─── HERO ─────────────────────────────────────────────────── */}
      <section
        ref={heroRef}
        className="relative min-h-[92vh] pt-32 sm:pt-40 pb-24 overflow-hidden"
      >
        <div className="absolute inset-0 pointer-events-none">
          <Grid opacity={0.035} />
          <Vignette />
        </div>

        <motion.div
          style={{ y: heroY }}
          className="container-edition relative z-10"
        >
          {/* Top meta strip */}
          <Reveal>
            <div className="flex items-baseline justify-between mb-16 sm:mb-24">
              <p className="eyebrow">Vol. 01 · The Atelier Edition</p>
              <div className="hidden sm:flex items-center gap-3 mono text-[10px]" style={{ color: "var(--text-mute)" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--moss)" }} />
                LIVE · 2026
              </div>
            </div>
          </Reveal>

          {/* The big idea */}
          <h1
            className="display max-w-[16ch]"
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
          <div className="mt-16 sm:mt-24 grid grid-cols-1 lg:grid-cols-12 gap-10 items-end">
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
                  <span>First analysis free</span>
                  <span className="w-px h-3" style={{ background: "var(--hairline-2)" }} />
                  <span>No card required</span>
                  <span className="w-px h-3 hidden sm:block" style={{ background: "var(--hairline-2)" }} />
                  <span className="hidden sm:inline">Auto-deleted after 30 days</span>
                </div>
              </Reveal>
            </div>

            {/* Sidebar — rotating doc type */}
            <div className="lg:col-span-5">
              <Reveal delay={0.8}>
                <div className="border-l pl-6" style={{ borderColor: "var(--hairline-2)" }}>
                  <p className="eyebrow mb-4">Built for</p>
                  <div className="relative" style={{ height: 56 }}>
                    <AnimatePresence mode="wait">
                      <motion.h3
                        key={rotIdx}
                        initial={{ y: 24, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -24, opacity: 0 }}
                        transition={{ duration: 0.5, ease: EASE }}
                        className="display"
                        style={{
                          fontSize: "clamp(1.8rem, 3.5vw, 2.8rem)",
                          color: "var(--text)",
                          position: "absolute",
                          left: 0,
                          right: 0,
                        }}
                      >
                        the {ROTATING[rotIdx]}.
                      </motion.h3>
                    </AnimatePresence>
                  </div>
                  <p className="mt-4 text-xs" style={{ color: "var(--text-3)" }}>
                    And dozens more — IRS letters, visa rejections, debt collection, bank disputes, contracts.
                  </p>
                </div>
              </Reveal>
            </div>
          </div>
        </motion.div>

        <div className="container-edition relative z-10 mt-20 sm:mt-32">
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
      <section className="relative py-28 sm:py-40">
        <div className="container-edition">
          <Reveal>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-20 sm:mb-28 items-end">
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-16 sm:gap-y-24">
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
      <section className="relative py-28 sm:py-40 border-t" style={{ borderColor: "var(--hairline)" }}>
        <div className="container-edition">
          <Reveal>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-20 items-end">
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

          <div className="grid grid-cols-1 md:grid-cols-3 gap-0 border-t border-l" style={{ borderColor: "var(--hairline-2)" }}>
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.1}>
                <div
                  className="p-8 sm:p-10 border-b border-r relative min-h-[260px] flex flex-col justify-between"
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
        className="relative py-28 sm:py-40 border-t"
        style={{ borderColor: "var(--hairline)" }}
      >
        <div className="container-edition relative">
          <Reveal>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-16 items-end">
              <div className="md:col-span-3">
                <p className="eyebrow">Chapter 03</p>
              </div>
              <h2
                className="md:col-span-9 display"
                style={{ fontSize: "clamp(2rem, 5.5vw, 5rem)", color: "var(--text)" }}
              >
                Hand us the document.
              </h2>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="max-w-2xl">
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
                  Encrypted · auto-deleted after 30 days · no card required
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── VOICES ────────────────────────────────────────────── */}
      <section className="relative py-28 sm:py-40 border-t" style={{ borderColor: "var(--hairline)" }}>
        <div className="container-edition">
          <Reveal>
            <div className="grid grid-cols-1 md:grid-cols-12 gap-10 mb-20 items-end">
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
                    className="p-8 sm:p-10 h-full flex flex-col justify-between border-l"
                    style={{ borderColor: "var(--hairline-2)", minHeight: 320 }}
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
        </div>
      </section>

      {/* ─── STATS ─────────────────────────────────────────────── */}
      <section className="relative py-24 border-y" style={{ borderColor: "var(--hairline)" }}>
        <div className="container-edition">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0">
            {[
              { v: 30, suffix: "s", label: "Average time" },
              { v: 18, suffix: "k+", label: "Patterns recognized" },
              { v: 8, suffix: "+", label: "Document categories" },
              { v: 100, suffix: "%", label: "Private · auto-deleted" },
            ].map((s, i) => (
              <Reveal key={i} delay={i * 0.08}>
                <div
                  className="px-2 md:px-6 py-4 md:border-r"
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
      <section className="relative py-32 sm:py-48 overflow-hidden">
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
            <div className="mt-12 sm:mt-16 flex items-center gap-4 flex-wrap">
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
        {showAuth && (
          <AuthModal
            mode={authMode}
            onClose={() => {
              setShowAuth(false)
              pendingAnalysis.current = false
            }}
            onSuccess={handleAuthSuccess}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showPricing && <PricingModal onClose={() => setShowPricing(false)} />}
      </AnimatePresence>
    </div>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "var(--ink)" }} />}>
      <HomeContent />
    </Suspense>
  )
}
