"use client"

import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { signOut } from "@/lib/firebase-auth"
import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Shield, LogOut, LayoutDashboard, Zap, Menu, X } from "lucide-react"

export default function Navbar() {
  const { user, profile } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
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
      <motion.nav
        initial={{ y: -100, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "backdrop-blur-xl border-b shadow-sm"
            : "border-b"
        }`}
        style={{
          background: scrolled ? "rgba(250,250,248,0.92)" : "rgba(250,250,248,0.85)",
          borderColor: "#E8E2D9",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5 group">
              <motion.div
                whileHover={{ rotate: 10, scale: 1.1 }}
                transition={{ type: "spring", stiffness: 400 }}
                className="w-8 h-8 rounded-lg flex items-center justify-center shadow-sm"
                style={{ background: "#E8651A" }}
              >
                <Shield className="w-4 h-4 text-white" />
              </motion.div>
              <span className="font-black text-lg" style={{ fontFamily: "var(--font-syne,'Syne',sans-serif)", color: "#18130E" }}>
                Clear<span style={{ color: "#E8651A" }}>Doc</span>
              </span>
            </Link>

            {/* Desktop */}
            <div className="hidden md:flex items-center gap-8">
              <Link href="/pricing" className="text-sm font-medium transition-colors" style={{ color: "#6B5E52" }}>
                Pricing
              </Link>
              {user ? (
                <div className="flex items-center gap-4">
                  {profile?.plan === "pro" && (
                    <motion.span initial={{ scale: 0.8 }} animate={{ scale: 1 }}
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold tag-orange">
                      <Zap className="w-3 h-3" /> Pro
                    </motion.span>
                  )}
                  <Link href="/dashboard" className="flex items-center gap-1.5 text-sm font-medium transition-colors" style={{ color: "#6B5E52" }}>
                    <LayoutDashboard className="w-4 h-4" /> Dashboard
                  </Link>
                  <button onClick={handleSignOut} disabled={signingOut}
                    className="flex items-center gap-1.5 text-sm transition-colors" style={{ color: "#A89484" }}>
                    <LogOut className="w-4 h-4" /> {signingOut ? "..." : "Sign out"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <Link href="/?auth=signin" className="text-sm font-medium transition-colors" style={{ color: "#6B5E52" }}>
                    Sign in
                  </Link>
                  <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                    <Link href="/?auth=signup" className="btn-primary !py-2.5 !px-5 !text-sm">
                      Get started free
                    </Link>
                  </motion.div>
                </div>
              )}
            </div>

            {/* Mobile toggle */}
            <button className="md:hidden p-2 rounded-lg transition-colors" style={{ color: "#18130E" }}
              onClick={() => setMobileOpen(!mobileOpen)}>
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}
            className="fixed top-16 left-0 right-0 z-40 bg-white shadow-lg md:hidden"
            style={{ borderBottom: "1px solid #E8E2D9" }}>
            <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col gap-3">
              <Link href="/pricing" className="py-2 text-sm font-medium" style={{ color: "#6B5E52" }} onClick={() => setMobileOpen(false)}>Pricing</Link>
              {user ? (
                <>
                  <Link href="/dashboard" className="py-2 text-sm font-medium" style={{ color: "#6B5E52" }} onClick={() => setMobileOpen(false)}>Dashboard</Link>
                  <button onClick={handleSignOut} className="py-2 text-sm text-left" style={{ color: "#DC2626" }}>{signingOut ? "Signing out..." : "Sign out"}</button>
                </>
              ) : (
                <>
                  <Link href="/?auth=signin" className="py-2 text-sm font-medium" style={{ color: "#6B5E52" }} onClick={() => setMobileOpen(false)}>Sign in</Link>
                  <Link href="/?auth=signup" className="btn-primary justify-center text-sm" onClick={() => setMobileOpen(false)}>Get started free</Link>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
