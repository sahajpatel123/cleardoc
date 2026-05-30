"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { clearPendingAnalysis } from "@/lib/pending-analysis-store"
import { isProUser } from "@/lib/user-plan"
import { useState, useEffect } from "react"
import { motion, AnimatePresence, LayoutGroup } from "framer-motion"
import { Menu, X, ArrowRight } from "lucide-react"

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Index" },
  { href: "/pricing", label: "Pricing" },
  { href: "/dashboard", label: "Account" },
]

const RAIL_SPRING = { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.75 }

function NavRail({ pathname }: { pathname: string }) {
  return (
    <LayoutGroup id="nav-rail">
      <div className="nav-rail">
        {LINKS.map((l) => {
          const active = pathname === l.href
          return (
            <Link
              key={l.href}
              href={l.href}
              className="nav-rail__link"
              aria-current={active ? "page" : undefined}
            >
              {active && (
                <motion.span
                  layoutId="nav-rail-pill"
                  className="nav-rail__pill"
                  transition={RAIL_SPRING}
                  aria-hidden
                />
              )}
              <motion.span
                className="nav-rail__label"
                animate={{
                  color: active ? "var(--text)" : "var(--text-3)",
                  scale: active ? 1 : 0.98,
                }}
                transition={{
                  color: { duration: 0.22, ease: EASE },
                  scale: RAIL_SPRING,
                }}
              >
                {l.label}
              </motion.span>
            </Link>
          )
        })}
      </div>
    </LayoutGroup>
  )
}

function NavBrand({ showWhisper = false }: { showWhisper?: boolean }) {
  return (
    <>
      <span className="nav-brand__lockup">
        <span className="nav-brand__word">
          Clear<span className="nav-brand__word-accent">Doc</span>
        </span>
        {showWhisper && (
          <>
            <span className="nav-brand__sep" aria-hidden>
              /
            </span>
            <span className="nav-brand__whisper">
              read what they really sent.
            </span>
          </>
        )}
      </span>
    </>
  )
}

export default function Navbar() {
  const pathname = usePathname()
  const { user, profile, loading: authLoading, signOut } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    window.addEventListener("scroll", onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : ""
    return () => {
      document.body.style.overflow = ""
    }
  }, [mobileOpen])

  const handleSignOut = async () => {
    setSigningOut(true)
    await clearPendingAnalysis()
    await signOut()
    setSigningOut(false)
    setMobileOpen(false)
  }

  return (
    <>
      <motion.header
        initial={{ y: -48, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.85, ease: EASE }}
        className="fixed top-0 left-0 right-0 z-50"
      >
        <div className="nav-masthead__accent" aria-hidden />
        <div
          className={`nav-masthead transition-all duration-500 ${scrolled ? "nav-masthead--scrolled" : ""}`}
        >
          <div className="container-edition">
            {/* Mobile */}
            <div className="flex md:hidden items-center justify-between gap-4 min-h-[4.25rem] py-3">
              <Link href="/" className="nav-brand min-w-0">
                <NavBrand />
              </Link>
              <button
                type="button"
                className="flex items-center justify-center w-11 h-11 shrink-0 rounded-full border transition-colors"
                style={{
                  color: "var(--text)",
                  borderColor: mobileOpen ? "var(--hairline-2)" : "var(--hairline)",
                  background: mobileOpen ? "var(--ink-3)" : "transparent",
                }}
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-expanded={mobileOpen}
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>

            {/* Desktop — true 3-column: brand | centered rail | actions */}
            <div className="hidden md:grid md:grid-cols-[1fr_auto_1fr] md:items-center md:gap-8 md:min-h-[var(--nav-height)]">
              <Link href="/" className="nav-brand min-w-0 justify-self-start">
                <NavBrand showWhisper />
              </Link>

              <nav className="justify-self-center" aria-label="Primary">
                <NavRail pathname={pathname} />
              </nav>

              <div className="flex items-center justify-end gap-5 justify-self-end">
                {authLoading ? (
                  <span className="nav-actions__text opacity-0 pointer-events-none" aria-hidden>
                    &nbsp;
                  </span>
                ) : user ? (
                  <>
                    {isProUser(
                      profile
                        ? {
                            plan: profile.plan,
                            subscriptionStatus: profile.subscriptionStatus,
                          }
                        : null,
                    ) && (
                      <span className="label label-ember">Pro</span>
                    )}
                    <button
                      type="button"
                      onClick={handleSignOut}
                      disabled={signingOut}
                      className="nav-actions__text"
                    >
                      {signingOut ? "Signing out…" : "Sign out"}
                    </button>
                  </>
                ) : (
                  <>
                    <Link href="/login" className="nav-actions__text">
                      Sign in
                    </Link>
                    <Link href="/#upload" className="btn btn-primary">
                      Try free
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.header>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 md:hidden"
              style={{ background: "rgba(5,5,5,0.94)", backdropFilter: "blur(24px)" }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="fixed left-0 right-0 z-50 md:hidden"
              style={{
                top: "var(--nav-height)",
                background: "var(--ink)",
                borderBottom: "1px solid var(--hairline)",
              }}
            >
              <div className="container-edition py-8">
                <nav aria-label="Mobile primary">
                  {LINKS.map((l, i) => (
                    <motion.div
                      key={l.href}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                    >
                      <Link
                        href={l.href}
                        className="block py-4 border-b text-2xl"
                        style={{
                          borderColor: "var(--hairline)",
                          color: pathname === l.href ? "var(--text)" : "var(--text-2)",
                          fontFamily: "var(--font-syne,'Syne',sans-serif)",
                          fontWeight: 500,
                          letterSpacing: "-0.03em",
                        }}
                        onClick={() => setMobileOpen(false)}
                      >
                        {l.label}
                      </Link>
                    </motion.div>
                  ))}
                </nav>
                <div className="hairline mt-6 mb-8" />
                {authLoading ? null : user ? (
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="text-sm font-medium"
                    style={{ color: "var(--red)" }}
                  >
                    {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                ) : (
                  <div className="flex flex-col gap-4">
                    <Link
                      href="/login"
                      className="nav-actions__text"
                      onClick={() => setMobileOpen(false)}
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/#upload"
                      className="btn btn-primary w-full justify-center"
                      onClick={() => setMobileOpen(false)}
                    >
                      Try free
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
