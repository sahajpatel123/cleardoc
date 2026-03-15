import { Shield } from "lucide-react"
import Link from "next/link"

export default function Footer() {
  return (
    <footer className="border-t border-white/5 bg-[#0A0A0F] mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="text-sm font-semibold text-white">
              Clear<span className="text-amber-400">Doc</span>
            </span>
          </div>

          <div className="flex items-center gap-6 text-sm text-slate-500">
            <Link href="/pricing" className="hover:text-slate-300 transition-colors">
              Pricing
            </Link>
            <Link href="/dashboard" className="hover:text-slate-300 transition-colors">
              Dashboard
            </Link>
          </div>
        </div>

        <div className="mt-6 pt-6 border-t border-white/5">
          <p className="text-xs text-slate-600 text-center leading-relaxed max-w-2xl mx-auto">
            <span className="text-slate-500 font-medium">Legal Disclaimer:</span>{" "}
            This is not legal advice. ClearDoc provides general information only and does not
            constitute legal, financial, or professional advice. Always consult a qualified
            attorney or relevant professional for advice specific to your situation.
          </p>
        </div>
      </div>
    </footer>
  )
}
