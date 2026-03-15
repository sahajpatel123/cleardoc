"use client"

import Link from "next/link"
import { useAuth } from "@/context/AuthContext"
import { signOut } from "@/lib/firebase-auth"
import { Shield, LogOut, LayoutDashboard, Zap } from "lucide-react"
import { useState } from "react"

export default function Navbar() {
  const { user, profile } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/5 bg-[#0A0A0F]/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="relative">
              <Shield className="w-6 h-6 text-amber-400 group-hover:text-amber-300 transition-colors" />
              <div className="absolute inset-0 bg-amber-400/20 blur-md rounded-full group-hover:bg-amber-400/30 transition-all" />
            </div>
            <span className="font-bold text-lg tracking-tight text-white">
              Clear<span className="text-amber-400">Doc</span>
            </span>
          </Link>

          {/* Nav links */}
          <div className="flex items-center gap-6">
            <Link
              href="/pricing"
              className="text-sm text-slate-400 hover:text-white transition-colors"
            >
              Pricing
            </Link>

            {user ? (
              <div className="flex items-center gap-4">
                {profile?.plan === "pro" && (
                  <span className="flex items-center gap-1 text-xs bg-amber-400/10 text-amber-400 border border-amber-400/20 px-2.5 py-1 rounded-full font-medium">
                    <Zap className="w-3 h-3" />
                    Pro
                  </span>
                )}
                <Link
                  href="/dashboard"
                  className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Link>
                <button
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-red-400 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  {signingOut ? "Signing out..." : "Sign out"}
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  href="/?auth=signin"
                  className="text-sm text-slate-400 hover:text-white transition-colors"
                >
                  Sign in
                </Link>
                <Link
                  href="/?auth=signup"
                  className="text-sm bg-amber-400 text-black font-semibold px-4 py-1.5 rounded-lg hover:bg-amber-300 transition-colors"
                >
                  Get started
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
