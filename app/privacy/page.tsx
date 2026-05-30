import type { Metadata } from "next"
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How ClearDoc collects, uses, stores, and protects your data — including documents, account details, and payment information.",
}

const LAST_UPDATED = "May 2026"

const SECTIONS: { n: string; title: string; body: string[] }[] = [
  {
    n: "01",
    title: "What we collect",
    body: [
      "Account information: your email address and a securely hashed version of your password (we never store your password in plain text).",
      "Document content: the file you upload is processed in memory to produce your analysis. We do not store the original file after processing. The structured analysis results (summary, red flags, response letter, next steps, deadlines) are saved to your account so you can revisit them.",
      "Payment information: handled entirely by Stripe. We store only a Stripe customer and subscription identifier and your plan status — never your card number.",
      "Usage and technical data: limited request metadata (such as IP address) used for rate limiting and abuse prevention.",
    ],
  },
  {
    n: "02",
    title: "How we use it",
    body: [
      "To provide the core service — analyzing your document and returning a summary, red flags, a response letter, and next steps.",
      "To maintain your account, saved analyses, and subscription status.",
      "To protect the service from abuse through rate limiting and basic security monitoring.",
      "We do not sell, rent, or share your document content or analysis results with third parties for marketing or advertising.",
    ],
  },
  {
    n: "03",
    title: "Third-party processors",
    body: [
      "Anthropic (Claude): your document content and any context you provide are sent to Anthropic's API to generate the analysis, subject to Anthropic's data handling terms.",
      "Stripe: processes subscription payments and stores your payment details under its PCI-compliant infrastructure.",
      "Supabase / PostgreSQL: stores your account record and saved analysis results.",
      "Upstash (if enabled): stores short-lived counters used for rate limiting.",
    ],
  },
  {
    n: "04",
    title: "Data retention",
    body: [
      "Uploaded files are not persisted — they exist only in memory during processing.",
      "Saved analyses remain in your account until you delete them or your account is closed.",
      "If you cancel Pro, your existing saved analyses remain accessible under the free tier.",
    ],
  },
  {
    n: "05",
    title: "Security",
    body: [
      "Connections use TLS encryption in transit. Passwords are hashed with scrypt and never stored in plain text.",
      "Access to saved analyses is scoped to your account — every read is checked against your user ID.",
      "No system is perfectly secure. You should avoid uploading documents containing third-party sensitive data (e.g., other people's Social Security or account numbers) unless essential, and consider redacting them first.",
    ],
  },
  {
    n: "06",
    title: "Your rights",
    body: [
      "Depending on your jurisdiction (including GDPR and CCPA), you may have the right to access, correct, export, or delete your personal data.",
      "You can manage your subscription and billing through the Stripe portal linked in your dashboard.",
      "To request access to or deletion of your account data, contact us at support@cleardoc.app.",
    ],
  },
  {
    n: "07",
    title: "Cookies & sessions",
    body: [
      "We use a session cookie to keep you signed in. We do not use third-party advertising or cross-site tracking cookies.",
    ],
  },
  {
    n: "08",
    title: "Changes",
    body: [
      "We may update this policy as the product evolves. Material changes will be reflected here with an updated date. Continued use after changes constitutes acceptance.",
    ],
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-screen pt-32 pb-32">
      <div className="container-edition max-w-4xl">
        <div className="flex items-baseline justify-between mb-10 gap-4 flex-wrap">
          <p className="eyebrow">Index · legal</p>
          <Link
            href="/"
            className="mono text-[10px] inline-flex items-center gap-1.5 transition-colors hover:opacity-80"
            style={{ color: "var(--text-mute)" }}
          >
            ← Back to home
          </Link>
        </div>

        <h1
          className="display max-w-[18ch] mb-6"
          style={{ fontSize: "clamp(2.4rem, 7vw, 5rem)", color: "var(--text)" }}
        >
          <span>Privacy </span>
          <span className="serif-italic" style={{ color: "var(--ember)" }}>
            Policy.
          </span>
        </h1>
        <p
          className="text-lg leading-relaxed max-w-2xl serif-italic"
          style={{ color: "var(--text-2)", fontFamily: "ui-serif, Georgia, serif" }}
        >
          What we collect, why we collect it, and the choices you have. Your
          documents are processed to help you — never sold.
        </p>
        <p className="mono text-[11px] mt-6" style={{ color: "var(--text-mute)" }}>
          Last updated · {LAST_UPDATED}
        </p>

        <div className="hairline my-14" />

        <div className="space-y-14">
          {SECTIONS.map((s) => (
            <section key={s.n} id={s.title.toLowerCase().replace(/[^a-z]+/g, "-")}>
              <div className="flex items-baseline gap-4 mb-5">
                <span className="mono text-[11px] tracking-[0.2em]" style={{ color: "var(--text-mute)" }}>
                  {s.n}
                </span>
                <div className="flex-1 h-px" style={{ background: "var(--hairline-2)" }} />
              </div>
              <h2
                className="display mb-5"
                style={{ fontSize: "clamp(1.4rem, 2.6vw, 2.1rem)", color: "var(--text)" }}
              >
                {s.title}
              </h2>
              <div className="space-y-4">
                {s.body.map((p, i) => (
                  <div key={i} className="flex gap-3.5">
                    <span
                      className="shrink-0 mt-[0.6rem] w-1 h-1 rounded-full"
                      style={{ background: "var(--text-mute)" }}
                    />
                    <p className="text-[0.95rem] leading-[1.75] max-w-2xl" style={{ color: "var(--text-3)" }}>
                      {p}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="hairline my-14" />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <p className="text-sm leading-relaxed max-w-md" style={{ color: "var(--text-3)" }}>
            See also our{" "}
            <Link href="/terms" className="underline underline-offset-4" style={{ color: "var(--text-2)" }}>
              Terms of Service
            </Link>{" "}
            and the full{" "}
            <Link href="/disclaimer" className="underline underline-offset-4" style={{ color: "var(--text-2)" }}>
              disclaimer
            </Link>
            .
          </p>
          <Link href="/" className="btn btn-primary shrink-0">
            Start analyzing
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  )
}
