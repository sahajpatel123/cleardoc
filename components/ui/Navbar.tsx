"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { isProUser } from "@/lib/user-plan"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Menu, X, ArrowRight } from "lucide-react"

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number]

const LINKS: { href: string; label: string; index: string }[] = [
  { href: "/", label: "Index", index: "01" },
  { href: "/pricing", label: "Pricing", index: "02" },
  { href: "/dashboard", label: "Account", index: "03" },
]

export default function Navbar() {
  const pathname = usePathname()
  const { user, profile, signOut } = useAuth()
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
            <div className="grid grid-cols-[auto_1fr_auto] md:grid-cols-[1fr_auto_1fr] items-center gap-4 min-h-[var(--nav-height)] py-3 md:py-0">
              {/* Brand */}
              <Link href="/" className="flex items-center gap-3 md:gap-3.5 group min-w-0">
                <span className="nav-brand__mark" aria-hidden>
                  CD
                </span>
                <span className="flex flex-col min-w-0 gap-0.5">
                  <span className="nav-brand__title">ClearDoc</span>
                  <span className="nav-brand__tagline hidden sm:block truncate max-w-[220px] lg:max-w-none">
                    Read what they really sent
                  </span>
                </span>
              </Link>

              {/* Desktop nav — centered rail */}
              <nav
                className="hidden md:flex justify-center col-start-2"
                aria-label="Primary"
              >
                <div className="nav-rail">
                  {LINKS.map((l) => {
                    const active = pathname === l.href
                    return (
                      <Link
                        key={l.href}
                        href={l.href}
                        className={`nav-rail__link ${active ? "nav-rail__link--active" : ""}`}
                      >
                        <span className="nav-rail__index">{l.index}</span>
                        {l.label}
                      </Link>
                    )
                  })}
                </div>
              </nav>

              {/* Desktop actions */}
              <div className="hidden md:flex items-center justify-end gap-5 col-start-3">
                {user ? (
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
                    <Link href="/login?mode=signup" className="btn btn-primary">
                      Try free
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </>
                )}
              </div>

              {/* Mobile menu toggle */}
              <button
                type="button"
                className="md:hidden col-start-3 justify-self-end flex items-center justify-center w-11 h-11 rounded-full border transition-colors"
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
          </div>
        </div>
      </motion.header>

      {/* Mobile menu */}
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
                        className="flex items-baseline gap-4 py-4 border-b"
                        style={{
                          borderColor: "var(--hairline)",
                          color: pathname === l.href ? "var(--text)" : "var(--text-2)",
                        }}
                        onClick={() => setMobileOpen(false)}
                      >
                        <span
                          className="mono text-[11px] shrink-0"
                          style={{
                            color: pathname === l.href ? "var(--ember)" : "var(--text-mute)",
                            letterSpacing: "0.16em",
                          }}
                        >
                          {l.index}
                        </span>
                        <span
                          className="text-2xl"
                          style={{
                            fontFamily: "var(--font-syne,'Syne',sans-serif)",
                            fontWeight: 500,
                            letterSpacing: "-0.03em",
                          }}
                        >
                          {l.label}
                        </span>
                      </Link>
                    </motion.div>
                  ))}
                </nav>
                <div className="hairline mt-6 mb-8" />
                {user ? (
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
                      href="/login?mode=signup"
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
