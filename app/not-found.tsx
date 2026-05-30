import Link from "next/link"
import { ArrowRight } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-[80vh] flex items-center pt-32 pb-24">
      <div className="container-edition">
        <p className="eyebrow mb-8" style={{ color: "var(--ember)" }}>
          Error · 404
        </p>
        <h1
          className="display max-w-[16ch] mb-6"
          style={{ fontSize: "clamp(2.6rem, 8vw, 6rem)", color: "var(--text)" }}
        >
          <span>This page </span>
          <span className="serif-italic" style={{ color: "var(--text-3)" }}>
            went missing.
          </span>
        </h1>
        <p
          className="text-base leading-relaxed max-w-md mb-10"
          style={{ color: "var(--text-3)" }}
        >
          The document you were looking for isn&apos;t here. It may have been
          moved, or the link was mistyped. Let&apos;s get you back to where the
          work happens.
        </p>
        <div className="flex items-center gap-4 flex-wrap">
          <Link href="/" className="btn btn-primary">
            Back to home
            <ArrowRight className="w-4 h-4" />
          </Link>
          <Link href="/dashboard" className="btn btn-ghost">
            Your dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
