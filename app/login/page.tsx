"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { signIn } from "next-auth/react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight, ArrowUpRight } from "lucide-react"
import { Grid, Vignette } from "@/components/ui/Atmosphere"
import { Reveal, SplitWords, Word, Magnetic } from "@/components/ui/Kinetic"

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

type Mode = "signin" | "signup"

const PROMISES: { n: string; line: string }[] = [
  { n: "I", line: "Plain English on every clause." },
  { n: "II", line: "The illegal demands named." },
  { n: "III", line: "A counter-letter, ready to send." },
  { n: "IV", line: "Your next moves, ranked." },
]

function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()

  const initialMode: Mode = params.get("mode") === "signup" ? "signup" : "signin"
  const rawRedirect = params.get("redirect") || "/"
  const redirectTo =
    rawRedirect.startsWith("/") && !rawRedirect.includes("//") ? rawRedirect : "/"

  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const clear = () => setError("");
    clear();
  }, [mode])

  const headline = useMemo(
    () =>
      mode === "signin"
        ? { eyebrow: "Sign in · returning reader", primary: "Welcome", italic: "back." }
        : { eyebrow: "Sign up · first chapter", primary: "Open the", italic: "door." },
    [mode],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading) return
    setError("")
    setLoading(true)

    try {
      if (mode === "signup") {
        const res = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) {
          // If the account already exists, try signing in — the user may have
          // already registered and just re-submitted. Any other 5xx could also
          // mean the account was written but the 201 response was lost, so
          // optimistically attempt signIn before surfacing an error.
          const accountExists = data.error?.toLowerCase().includes("already exists")
          const serverError = res.status >= 500
          if (accountExists || serverError) {
            const attempt = await signIn("credentials", {
              email,
              password,
              redirect: false,
            })
            if (!attempt?.error) {
              setLoading(false)
              router.push(redirectTo)
              router.refresh()
              return
            }
          }
          setError(data.error || "Couldn't create account. Try again.")
          setLoading(false)
          return
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError("Email or password doesn't match.")
        setLoading(false)
        return
      }
      setLoading(false)
      router.push(redirectTo)
      router.refresh()
    } catch {
      // Network-level failure: if we were signing up, attempt signIn anyway —
      // the account may have been created before the connection dropped.
      if (mode === "signup") {
        try {
          const attempt = await signIn("credentials", {
            email,
            password,
            redirect: false,
          })
          if (!attempt?.error) {
            setLoading(false)
            router.push(redirectTo)
            router.refresh()
            return
          }
        } catch {
          // signIn also failed; fall through to generic error
        }
      }
      setError("Something went wrong. Try again.")
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <Grid opacity={0.035} />
        <Vignette />
      </div>

      <div className="container-edition relative z-10 pt-32 sm:pt-40 pb-24 max-md:pt-20">
        {/* Top meta */}
        <Reveal>
          <div className="flex items-baseline justify-between mb-16 sm:mb-24 max-md:mb-10">
            <p className="eyebrow">{headline.eyebrow}</p>
            <Link
              href="/"
              className="mono text-[10px] inline-flex items-center gap-1.5 transition-colors"
              style={{ color: "var(--text-mute)" }}
            >
              ← Back to ClearDoc
            </Link>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-20 items-start max-md:gap-6">
          {/* LEFT — editorial headline + promises */}
          <div className="lg:col-span-7">
            <h1
              className="display max-w-[14ch]"
              style={{ fontSize: "clamp(2.6rem, 7.4vw, 6.2rem)", color: "var(--text)" }}
              key={mode}
            >
              <SplitWords text={headline.primary} delay={0.1} />{" "}
              <Word delay={0.45}>
                <span className="serif-italic" style={{ color: "var(--ember)" }}>
                  {headline.italic}
                </span>
              </Word>
            </h1>

            <Reveal delay={0.55}>
              <p
                className="mt-10 max-w-md text-[clamp(1rem,1.2vw,1.15rem)] leading-relaxed max-md:mt-4 max-md:text-sm"
                style={{ color: "var(--text-2)" }}
              >
                {mode === "signin"
                  ? "Sign in to your analyses, your counter-letters, and the documents you've already taken apart."
                  : "One account opens every chapter — 3 free analyses per day, no card required."}
              </p>
            </Reveal>

            <Reveal delay={0.75}>
              <div className="mt-16 border-l pl-6 max-md:mt-6 max-md:border-l-0 max-md:pl-0" style={{ borderColor: "var(--hairline-2)" }}>
                <p className="eyebrow mb-6 max-md:mb-3 max-md:text-[9px]">What you get inside</p>
                <ul className="space-y-3 max-md:space-y-2">
                  {PROMISES.map((p, i) => (
                    <motion.li
                      key={p.n}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.85 + i * 0.07, ease: EASE }}
                      className="flex items-baseline gap-5"
                    >
                      <span
                        className="mono text-[10px] tracking-[0.2em] shrink-0 w-6"
                        style={{ color: "var(--text-mute)" }}
                      >
                        {p.n}
                      </span>
                      <span
                        className="text-[clamp(0.95rem,1.05vw,1.05rem)]"
                        style={{ color: "var(--text-2)" }}
                      >
                        {p.line}
                      </span>
                    </motion.li>
                  ))}
                </ul>
              </div>
            </Reveal>

            <Reveal delay={1}>
              <div className="mt-16 flex items-center gap-5 mono text-[10px] max-md:mt-6 max-md:gap-3 max-md:text-[8px]" style={{ color: "var(--text-mute)" }}>
                <span>3 ANALYSES FREE PER DAY</span>
                <span className="w-px h-3" style={{ background: "var(--hairline-2)" }} />
                <span className="w-px h-3 hidden sm:block" style={{ background: "var(--hairline-2)" }} />
                <span className="hidden sm:inline">FILES NOT STORED · RESULTS ONLY</span>
              </div>
            </Reveal>
          </div>

          {/* RIGHT — the form, hairline only, no card */}
          <div className="lg:col-span-5 lg:pt-3">
            <Reveal delay={0.35}>
              <div
                className="relative pl-8 sm:pl-10 max-md:pl-0 max-md:pt-6 max-md:border-t max-md:border-l-0"
                style={{ borderLeft: "1px solid var(--hairline-2)" }}
              >
                {/* Ember mark on the rule */}
                <span
                  className="absolute left-[-1px] top-0 w-px h-10 max-md:left-0 max-md:top-[-1px] max-md:w-10 max-md:h-px"
                  style={{ background: "var(--ember)" }}
                />

                {/* Mode toggle — two words, single underline slides */}
                <div className="flex items-baseline gap-7 mb-12 relative max-md:mb-8 max-md:gap-5">
                  {(["signin", "signup"] as Mode[]).map((m) => {
                    const active = mode === m
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className="relative pb-2 mono text-[11px] tracking-[0.22em] max-md:text-[13px] max-md:pb-3 max-md:tracking-[0.18em]"
                        style={{
                          color: active ? "var(--text)" : "var(--text-3)",
                          letterSpacing: "0.22em",
                        }}
                      >
                        {m === "signin" ? "SIGN IN" : "SIGN UP"}
                        {active && (
                          <motion.span
                            layoutId="login-mode-underline"
                            transition={{ type: "spring", stiffness: 320, damping: 30 }}
                            className="absolute left-0 right-0 -bottom-px h-px"
                            style={{ background: "var(--ember)" }}
                          />
                        )}
                      </button>
                    )
                  })}
                  <span
                    className="ml-auto mono text-[10px] max-md:hidden"
                    style={{ color: "var(--text-mute)" }}
                  >
                    No. {mode === "signin" ? "01" : "02"}
                  </span>
                </div>

                <form onSubmit={handleSubmit} className="space-y-7 max-md:space-y-5">
                  <AnimatePresence initial={false}>
                    {mode === "signup" && (
                      <motion.div
                        key="name-field"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.4, ease: EASE }}
                        className="overflow-hidden"
                      >
                        <div>
                          <label
                            className="mono text-[10px] tracking-[0.24em] block mb-3"
                            style={{ color: "var(--text-mute)" }}
                          >
                            FULL NAME · OPTIONAL
                          </label>
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Mariana Reyes"
                          autoComplete="name"
                          className="field max-md:text-sm"
                        />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div>
                    <label
                      className="mono text-[10px] tracking-[0.24em] block mb-3"
                      style={{ color: "var(--text-mute)" }}
                    >
                      EMAIL
                    </label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@quiet.address"
                        autoComplete="email"
                        required
                        className="field max-md:text-sm"
                      />
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between mb-3">
                      <label
                        className="mono text-[10px] tracking-[0.24em]"
                        style={{ color: "var(--text-mute)" }}
                      >
                        PASSWORD
                      </label>
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        className="mono text-[10px] tracking-[0.22em]"
                        style={{ color: "var(--text-3)" }}
                      >
                        {showPassword ? "HIDE" : "SHOW"}
                      </button>
                    </div>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={mode === "signup" ? "At least eight characters" : "Your password"}
                      autoComplete={mode === "signup" ? "new-password" : "current-password"}
                      required
                      minLength={8}
                      className="field max-md:text-sm"
                    />
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-xs"
                        style={{ color: "var(--red)" }}
                      >
                        {error}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <div className="pt-3 max-md:pt-2">
                    <Magnetic strength={5}>
                      <button
                        type="submit"
                        disabled={loading}
                        className="btn btn-primary max-md:w-full max-md:justify-center"
                        style={loading ? { opacity: 0.55, cursor: "wait" } : {}}
                      >
                        {loading
                          ? mode === "signup"
                            ? "Opening your account…"
                            : "Signing in…"
                          : mode === "signup"
                            ? "Create account"
                            : "Sign in"}
                        {!loading && <ArrowRight className="w-4 h-4" />}
                      </button>
                    </Magnetic>
                  </div>

                  <div className="hairline-fade mt-8 max-md:mt-6" />

                  <p className="text-xs mt-8 max-md:mt-6" style={{ color: "var(--text-3)" }}>
                    {mode === "signup" ? (
                      <>
                        Already have an account?{" "}
                        <button
                          type="button"
                          onClick={() => setMode("signin")}
                          className="serif-italic transition-colors"
                          style={{ color: "var(--ember)" }}
                        >
                          Sign in instead
                        </button>
                      </>
                    ) : (
                      <>
                        New here?{" "}
                        <button
                          type="button"
                          onClick={() => setMode("signup")}
                          className="serif-italic transition-colors"
                          style={{ color: "var(--ember)" }}
                        >
                          Open an account
                        </button>
                      </>
                    )}
                  </p>

                  <p className="text-[11px] mt-6 leading-relaxed max-md:mt-4 max-md:text-[10px]" style={{ color: "var(--text-mute)" }}>
                    By continuing you agree to our{" "}
                    <Link href="/terms" className="underline underline-offset-2" style={{ color: "var(--text-3)" }}>
                      Terms
                    </Link>{" "}
                    and{" "}
                    <Link href="/privacy" className="underline underline-offset-2" style={{ color: "var(--text-3)" }}>
                      Privacy Policy
                    </Link>
                    , and acknowledge ClearDoc provides general information only — not legal advice.
                  </p>
                </form>
              </div>
            </Reveal>

            <Reveal delay={0.9}>
              <div className="mt-12 flex items-baseline justify-between mono text-[10px] max-md:mt-6 max-md:text-[8px] max-md:hidden" style={{ color: "var(--text-mute)" }}>
                <span>VOL. 01 · THE ATELIER EDITION</span>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-1 transition-colors"
                  style={{ color: "var(--text-3)" }}
                >
                  See pricing
                  <ArrowUpRight className="w-3 h-3" />
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </div>

      <div className="container-edition relative z-10">
        <div className="hairline" />
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ background: "var(--ink)" }} />}>
      <LoginInner />
    </Suspense>
  )
}
