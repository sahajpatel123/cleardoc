export type FaqItem = {
  q: string
  a: string
  chapter: string
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    chapter: "I · The basics",
    q: "What types of documents can I upload?",
    a: "Insurance denials, medical bills, eviction notices, visa letters, IRS notices, debt collection threats, landlord ultimatums, bank disputes, contracts, and more. We accept PDF, PNG, JPG, and WEBP up to 10MB.",
  },
  {
    chapter: "I · The basics",
    q: "How long does an analysis take?",
    a: "Most documents finish in under a minute. Complex or image-only scans can take a bit longer while our AI reads the full page.",
  },
  {
    chapter: "I · The basics",
    q: "Do I need an account?",
    a: "Sign up is free. The free plan includes 3 analyses per day (resets at midnight UTC): full summary, red flags, response letter draft, and ranked next steps.",
  },
  {
    chapter: "II · Privacy",
    q: "What happens to my uploaded files?",
    a: "Files are processed in memory and are not stored on our servers. Only the analysis output (summary, red flags, letter draft, next steps) is saved to your account. We do not use your documents to train AI models.",
  },
  {
    chapter: "II · Privacy",
    q: "Who can see my analyses?",
    a: "Only you. Analyses are tied to your account and we enforce ownership on every API request. No one else can open your saved results by ID.",
  },
  {
    chapter: "III · Plans",
    q: "What does the free plan include?",
    a: "Three saved analyses per UTC day: full plain-English summary, red flags, response letter draft, and ranked next steps. Upgrade to Pro for unlimited analyses.",
  },
  {
    chapter: "III · Plans",
    q: "What does Pro include?",
    a: "Unlimited analyses, full history on your dashboard, and the same complete output on every document. Billed monthly at $9 — cancel anytime from your dashboard via Stripe.",
  },
  {
    chapter: "III · Plans",
    q: "Can I cancel Pro?",
    a: "Yes. Open Account → Manage subscription in the billing portal. You keep Pro until the end of the current billing period. No cancellation fees.",
  },
  {
    chapter: "IV · Trust",
    q: "Is this legal advice?",
    a: "No. ClearDoc is general information and document analysis — not a law firm and not a substitute for a licensed attorney. For serious matters, consult a qualified professional; we often surface free legal-aid resources in your next steps.",
  },
  {
    chapter: "IV · Trust",
    q: "How accurate is the analysis?",
    a: "The AI is strong at spotting common manipulation, missing disclosures, and suspicious clauses. It can miss context only you know, misread poor scans, or get details wrong. Read critically and verify important claims before you act.",
  },
  {
    chapter: "IV · Trust",
    q: "What if the AI returns an error?",
    a: "If analysis fails after you started it, it does not count toward your daily limit — only successfully saved analyses count.",
  },
]

export const FAQ_CHAPTERS = [
  "I · The basics",
  "II · Privacy",
  "III · Plans",
  "IV · Trust",
] as const

/** Subset shown on the pricing page FAQ section */
export const PRICING_FAQ_ITEMS: FaqItem[] = [
  FAQ_ITEMS[0],
  FAQ_ITEMS[8],
  FAQ_ITEMS[9],
  FAQ_ITEMS[3],
  FAQ_ITEMS[7],
]
