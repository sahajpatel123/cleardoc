import { Shield } from "lucide-react"
import Link from "next/link"

export default function Footer() {
  return (
    <footer className="border-t" style={{ background: "#18130E", borderColor: "#2E261E" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "#E8651A" }}>
                <Shield className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="font-black text-base text-white" style={{ fontFamily: "var(--font-syne,'Syne',sans-serif)" }}>
                Clear<span style={{ color: "#E8651A" }}>Doc</span>
              </span>
            </div>
            <p className="text-xs" style={{ color: "#4A3F35" }}>AI-powered consumer protection</p>
          </div>
          <div className="flex items-center gap-6 text-sm" style={{ color: "#4A3F35" }}>
            <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
            <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t" style={{ borderColor: "#2E261E" }}>
          <p className="text-xs text-center leading-relaxed max-w-2xl mx-auto" style={{ color: "#4A3F35" }}>
            <span style={{ color: "#6B5E52" }}>Legal Disclaimer:</span>{" "}
            This is not legal advice. ClearDoc provides general information only and does not constitute legal,
            financial, or professional advice. Always consult a qualified attorney or relevant professional
            for advice specific to your situation.
          </p>
        </div>
      </div>
    </footer>
  )
}
