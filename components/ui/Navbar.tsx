"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/context/AuthContext"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Menu, X } from "lucide-react"

const LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Index" },
  { href: "/pricing", label: "Pricing" },
  { href: "/dashboard", label: "Account" },
]

export default function Navbar() {
  const pathname = usePathname()
  const { user, profile, signOut } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16)
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
    setMobileOpen(false)
  }

  return (
    <>
      <motion.div
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="fixed top-0 left-0 right-0 z-50"
      >
        <div
          className="transition-all duration-500"
          style={{
            background: scrolled ? "rgba(5,5,5,0.78)" : "transparent",
            backdropFilter: scrolled ? "blur(18px) saturate(140%)" : "none",
            WebkitBackdropFilter: scrolled ? "blur(18px) saturate(140%)" : "none",
            borderBottom: scrolled ? "1px solid var(--hairline)" : "1px solid transparent",
          }}
        >
          <div className="container-edition">
            <div className="flex items-center justify-between h-16">
              {/* Wordmark */}
              <Link href="/" className="flex items-baseline gap-2 group">
                <span
                  className="text-base tracking-tight"
                  style={{
                    fontFamily: "var(--font-syne,'Syne',sans-serif)",
                    color: "var(--text)",
                    fontWeight: 600,
                    letterSpacing: "-0.04em",
                  }}
                >
                  ClearDoc
                </span>
                <span className="mono text-[10px]" style={{ color: "var(--text-mute)" }}>
                  / read what they really sent.
                </span>
              </Link>

              {/* Desktop links */}
              <div className="hidden md:flex items-center gap-1">
                {LINKS.map((l) => {
                  const active = pathname === l.href
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="relative px-3.5 py-1.5 group"
                    >
                      <span
                        className="relative z-10 text-sm transition-colors"
                        style={{ color: active ? "var(--text)" : "var(--text-3)" }}
                      >
                        {l.label}
                      </span>
                      {active && (
                        <motion.span
                          layoutId="nav-underline"
                          transition={{ type: "spring", stiffness: 320, damping: 28 }}
                          className="absolute left-3.5 right-3.5 -bottom-0.5 h-px"
                          style={{ background: "var(--ember)" }}
                        />
                      )}
                    </Link>
                  )
                })}
              </div>

              {/* Right side */}
              <div className="hidden md:flex items-center gap-4">
                {user ? (
                  <>
                    {profile?.plan === "pro" && (
                      <span className="label label-ember">Pro</span>
                    )}
                    <button
                      onClick={handleSignOut}
                      disabled={signingOut}
                      className="text-sm transition-colors"
                      style={{ color: "var(--text-3)" }}
                    >
                      {signingOut ? "..." : "Sign out"}
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="text-sm transition-colors"
                      style={{ color: "var(--text-3)" }}
                    >
                      Sign in
                    </Link>
                    <Link href="/login?mode=signup" className="btn btn-primary !py-2 !px-4 !text-[13px]">
                      Try free
                    </Link>
                  </>
                )}
              </div>

              {/* Mobile toggle */}
              <button
                className="md:hidden p-2"
                style={{ color: "var(--text)" }}
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label="Menu"
              >
                {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 md:hidden"
              style={{ background: "rgba(5,5,5,0.92)", backdropFilter: "blur(20px)" }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="fixed top-16 left-0 right-0 z-50 md:hidden"
              style={{ background: "var(--ink)", borderBottom: "1px solid var(--hairline)" }}
            >
              <div className="container-edition py-8">
                {LINKS.map((l, i) => (
                  <motion.div
                    key={l.href}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.06 }}
                  >
                    <Link
                      href={l.href}
                      className="block py-4 text-2xl"
                      style={{
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
                <div className="hairline mt-4 mb-6" />
                {user ? (
                  <button
                    onClick={handleSignOut}
                    className="text-sm"
                    style={{ color: "var(--red)" }}
                  >
                    {signingOut ? "Signing out..." : "Sign out"}
                  </button>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="block py-2 text-sm"
                      style={{ color: "var(--text-3)" }}
                      onClick={() => setMobileOpen(false)}
                    >
                      Sign in
                    </Link>
                    <Link
                      href="/login?mode=signup"
                      className="btn btn-primary mt-4"
                      onClick={() => setMobileOpen(false)}
                    >
                      Try free
                    </Link>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
