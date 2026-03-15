"use client"

import { useState } from "react"
import { useAuth } from "@/context/AuthContext"
import { useRouter } from "next/navigation"
import {
  Shield,
  Check,
  Zap,
  FileText,
  AlertTriangle,
  Mail,
  ArrowRight,
  ChevronRight,
} from "lucide-react"
import AuthModal from "@/components/ui/AuthModal"

const FREE_FEATURES = [
  "1 document analysis",
  "Plain English summary",
  "Red flag detection",
  "Response letter draft",
  "Next steps guide",
]

const PRO_FEATURES = [
  "Unlimited document analyses",
  "Full red flag detection",
  "Ready-to-send response letters",
  "Priority AI processing",
  "Analysis history & dashboard",
  "All document types supported",
  "Cancel anytime",
]

const FAQ = [
  {
    q: "What types of documents can I upload?",
    a: "Any official document: insurance denial letters, medical bills, eviction notices, visa rejections, IRS letters, debt collection letters, legal notices, bank dispute letters, and more. If it's official and intimidating, ClearDoc can help.",
  },
  {
    q: "Is this actually legal advice?",
    a: "No — ClearDoc is a general information tool, not a law firm. Our AI gives you a starting point to understand your situation and respond. For serious legal matters, also consult a licensed attorney (we'll often suggest free legal aid resources in your next steps).",
  },
  {
    q: "How accurate is the AI analysis?",
    a: "Our AI is trained to identify common red flags, illegal clauses, and manipulation tactics used in official documents. It's highly accurate for pattern recognition, but always read the analysis critically and verify specific legal claims with a professional.",
  },
  {
    q: "What happens to my uploaded documents?",
    a: "Your documents are processed securely and never shared. We don't use your documents to train AI models. Documents are automatically deleted from our servers after 30 days.",
  },
  {
    q: "Can I cancel my Pro subscription?",
    a: "Yes, anytime. Cancel from your account settings and you'll retain Pro access until the end of your billing period. No cancellation fees.",
  },
]

export default function PricingPage() {
  const router = useRouter()
  const { user, profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const handleUpgrade = async () => {
    if (!user) {
      setShowAuth(true)
      return
    }
    setLoading(true)
    try {
      const token = await user.getIdToken()
      const res = await fetch("/api/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
    } catch {
      alert("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const isPro = profile?.plan === "pro"

  return (
    <div className="relative min-h-screen bg-[#0A0A0F]">
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-amber-400/4 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 bg-amber-400/10 border border-amber-400/20 text-amber-400 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <Shield className="w-3 h-3" />
            Simple, honest pricing
          </div>
          <h1
            className="text-4xl sm:text-5xl font-black text-white mb-4"
            style={{ fontFamily: "var(--font-syne, sans-serif)" }}
          >
            Everyone deserves someone smart in their corner
          </h1>
          <p className="text-slate-400 text-lg max-w-xl mx-auto">
            Start free. Upgrade when you need more.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16 max-w-3xl mx-auto">
          {/* Free */}
          <div className="bg-[#0F1117] border border-white/5 rounded-2xl p-6">
            <div className="mb-6">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Free forever</p>
              <div className="flex items-end gap-1">
                <span className="text-4xl font-black text-white">$0</span>
                <span className="text-slate-500 mb-1">/month</span>
              </div>
              <p className="text-slate-500 text-xs mt-1">No credit card required</p>
            </div>

            <ul className="space-y-3 mb-6">
              {FREE_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-slate-400">
                  <div className="w-4 h-4 rounded-full bg-white/10 border border-white/10 flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5 text-slate-400" />
                  </div>
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => router.push("/")}
              className="w-full border border-white/10 hover:border-white/20 text-slate-300 hover:text-white py-3 rounded-xl transition-all text-sm font-medium"
            >
              Get started free
            </button>
          </div>

          {/* Pro */}
          <div className="relative bg-[#0F1117] border border-amber-400/30 rounded-2xl p-6 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
            <div className="absolute top-4 right-4">
              <span className="text-xs bg-amber-400/10 border border-amber-400/20 text-amber-400 font-bold px-2.5 py-1 rounded-full">
                MOST POPULAR
              </span>
            </div>

            <div className="mb-6">
              <p className="text-xs text-amber-400/70 uppercase tracking-wider mb-2">Pro plan</p>
              <div className="flex items-end gap-1">
                <span className="text-4xl font-black text-white">$9</span>
                <span className="text-slate-500 mb-1">/month</span>
              </div>
              <p className="text-slate-500 text-xs mt-1">Cancel anytime</p>
            </div>

            <ul className="space-y-3 mb-6">
              {PRO_FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-slate-300">
                  <div className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
                    <Check className="w-2.5 h-2.5 text-emerald-400" />
                  </div>
                  {f}
                </li>
              ))}
            </ul>

            {isPro ? (
              <div className="w-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-semibold py-3 rounded-xl text-sm text-center">
                ✓ You&apos;re on Pro
              </div>
            ) : (
              <button
                onClick={handleUpgrade}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-300 text-black font-bold py-3 rounded-xl transition-all text-sm disabled:opacity-50"
              >
                <Zap className="w-4 h-4" />
                {loading ? "Loading..." : "Upgrade to Pro"}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* What you get breakdown */}
        <div className="mb-16">
          <h2
            className="text-2xl font-black text-white text-center mb-8"
            style={{ fontFamily: "var(--font-syne, sans-serif)" }}
          >
            What you get with every analysis
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                icon: FileText,
                title: "Plain English Summary",
                desc: "What the document actually says, explained like a friend would.",
              },
              {
                icon: AlertTriangle,
                title: "Red Flag Detection",
                desc: "Illegal demands, manipulation tactics, and suspicious clauses — named explicitly.",
              },
              {
                icon: Mail,
                title: "Response Letter",
                desc: "A formal, assertive letter ready to send — with your details filled in.",
              },
              {
                icon: ChevronRight,
                title: "Next Steps",
                desc: "3-5 ranked actions with free resources and realistic expectations.",
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="bg-white/[0.02] border border-white/5 rounded-xl p-5 hover:border-white/10 transition-all"
              >
                <div className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center mb-3">
                  <Icon className="w-4 h-4 text-amber-400" />
                </div>
                <h3 className="text-white font-semibold text-sm mb-1">{title}</h3>
                <p className="text-slate-500 text-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2
            className="text-2xl font-black text-white text-center mb-8"
            style={{ fontFamily: "var(--font-syne, sans-serif)" }}
          >
            Frequently asked questions
          </h2>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <div
                key={i}
                className="bg-[#0F1117] border border-white/5 rounded-xl overflow-hidden"
              >
                <button
                  className="w-full flex items-center justify-between px-5 py-4 text-left"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-white font-medium text-sm">{item.q}</span>
                  <ChevronRight
                    className={`w-4 h-4 text-slate-500 shrink-0 ml-4 transition-transform ${
                      openFaq === i ? "rotate-90" : ""
                    }`}
                  />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4">
                    <p className="text-slate-400 text-sm leading-relaxed">{item.a}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {showAuth && (
        <AuthModal
          mode="signup"
          onClose={() => setShowAuth(false)}
          onSuccess={() => {
            setShowAuth(false)
            handleUpgrade()
          }}
        />
      )}
    </div>
  )
}
