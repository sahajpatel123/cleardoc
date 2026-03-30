# ClearDoc — Project Memory

## Overview
ClearDoc is an AI-powered document analysis tool that helps everyday people fight back against confusing, threatening, or manipulative official documents (insurance denials, medical bills, legal notices, eviction notices, visa rejections, IRS letters, etc.).

**Core value prop**: Upload any scary official document → get plain English, red flags with severity, a ready-to-send response letter, and ranked next steps. Instantly.

**Monetization**: Free (1 analysis) → Pro ($9/month unlimited via Stripe).

---

## Tech Stack
- **Framework**: Next.js 14 (App Router, TypeScript strict)
- **Styling**: Tailwind CSS v4 (`@import "tailwindcss"` — NO config file needed)
- **AI**: Anthropic Claude API (`claude-sonnet-4-20250514`, temp=0, max_tokens=4000)
- **PDF Parsing**: pdf2json (server-side text extraction; serverless-safe)
- **Auth**: Firebase Authentication (Email/Password + Google OAuth)
- **Database**: Firebase Firestore
- **File Storage**: Not wired in app code — optional `storageUrl` on analyses reserved for future use
- **Payments**: Stripe (subscriptions + webhooks)
- **Admin**: firebase-admin for server-side token verification
- **Fonts**: Syne (display/headings) + DM Sans (body) from next/font/google

---

## File Structure
```
/app
  page.tsx                          — Landing page with upload zone
  layout.tsx                        — Root layout (AuthProvider, Navbar, Footer)
  globals.css                       — Global styles (Tailwind v4 import)
  /analyze
    page.tsx                        — Results page (4-panel analysis output)
    /[id]/page.tsx                  — View a saved analysis from dashboard
  /dashboard
    page.tsx                        — User history & account dashboard
  /pricing
    page.tsx                        — Pricing page with FAQ
  /api
    /analyze/route.ts               — Core analysis endpoint (PDF parse + Claude)
    /usage/route.ts                 — Check user's remaining free uses
    /stripe
      /create-checkout/route.ts     — Create Stripe checkout session
      /webhook/route.ts             — Handle Stripe subscription events

/components/ui
  Navbar.tsx                        — Top nav with auth state
  Footer.tsx                        — Footer with legal disclaimer
  UploadZone.tsx                    — Drag & drop file upload (react-dropzone)
  ResultCard.tsx                    — Reusable card wrapper for result panels
  ResponseLetter.tsx                — Letter display with copy + download
  RedFlagItem.tsx                   — Single red flag with severity badge
  NextStepItem.tsx                  — Single next step with priority number
  LoadingAnalysis.tsx               — Multi-stage loading animation
  AuthModal.tsx                     — Firebase auth modal (Google + email)
  PricingModal.tsx                  — Paywall modal shown at free limit

/lib
  types.ts                          — All TypeScript interfaces
  firebase.ts                       — Firebase client app initialization
  firebase-auth.ts                  — Auth helpers (signIn, signOut, etc.)
  firestore.ts                      — All Firestore read/write helpers
  claude.ts                         — Claude API wrapper + system prompt
  pdf-parser.ts                     — PDF text extraction (pdf2json); image → vision payload for Claude
  stripe.ts                         — Stripe client + checkout helper

/context
  AuthContext.tsx                   — Global auth provider + useAuth hook

/hooks
  useAuth.ts                        — Re-exports useAuth from AuthContext
```

---

## Firestore Collections

### `users/{uid}`
```typescript
{
  email: string
  createdAt: Timestamp
  plan: "free" | "pro"
  stripeCustomerId?: string
  stripeSubscriptionId?: string
  subscriptionStatus: "active" | "inactive" | "cancelled"
  freeUsesRemaining: number  // starts at 1 for new users
}
```

### `analyses/{auto-id}`
```typescript
{
  userId: string
  createdAt: Timestamp
  documentName: string
  documentType: string  // user-provided context
  storageUrl?: string   // optional; reserved when file storage is implemented
  result: AnalysisResult
}
```

---

## TypeScript Interfaces

```typescript
interface RedFlag {
  issue: string
  severity: "high" | "medium" | "low"
  explanation: string
  source_text: string  // exact sentence from document
}

interface NextStep {
  action: string
  reason: string
  priority: number  // 1 = highest
}

interface AnalysisResult {
  plain_summary: string
  red_flags: RedFlag[]
  response_letter: string
  next_steps: NextStep[]
  overall_verdict: "legitimate" | "suspicious" | "likely_illegal"
}
```

---

## Environment Variables

```bash
# Firebase (Client)
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=

# Firebase Admin (Server — from Service Account)
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=   # Include \n characters, wrap in quotes

# Anthropic
ANTHROPIC_API_KEY=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## Key Conventions

### TypeScript
- Strict mode enabled
- No `any` types — use proper interfaces
- All API routes validate auth server-side via firebase-admin

### Components
- All client components have `"use client"` directive
- Server components are the default
- `useSearchParams()` must be wrapped in `<Suspense>`

### Styling
- Tailwind CSS v4 — uses `@import "tailwindcss"` (no tailwind.config.js)
- Color palette:
  - Background: `#0A0A0F` (deep near-black)
  - Surface: `#0F1117` (dark navy)
  - Accent: `#F59E0B` (amber-400)
  - Danger: `#EF4444` (red-500)
  - Success: `#10B981` (emerald-500)
  - Text: `#F8F8F2` primary, `#94A3B8` secondary

### API Routes
- All analyze/stripe routes use firebase-admin to verify ID tokens
- Rate limiting: **disabled** in code — production must use e.g. Upstash Redis (`@upstash/ratelimit`); see `app/api/analyze/route.ts` comment block
- Max file size: 10MB
- Claude API called server-side only (API key never exposed)

### Analysis Flow
1. User uploads file → stored in sessionStorage as base64
2. `/analyze` page reconstructs file and POSTs to `/api/analyze`
3. API extracts text (pdf2json) or sends images to Claude vision, calls Claude, saves to Firestore
4. Result returned to client and rendered in 4 cards

---

## How to Run Locally

```bash
npm install
# Fill in .env.local with all required values
npm run dev
# Open http://localhost:3000
```

## Stripe Webhook (local testing)
```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

## Deployment (Vercel)
1. Push to GitHub
2. Import repo in Vercel
3. Add all environment variables from `.env.local`
4. Set `NEXT_PUBLIC_APP_URL` to your Vercel URL
5. Add Stripe webhook pointing to `https://your-domain.com/api/stripe/webhook`

## Firebase Setup
1. Create Firebase project at console.firebase.google.com
2. Enable Authentication (Email/Password + Google)
3. Create Firestore database
4. Download Service Account JSON → copy `client_email` and `private_key` to env
5. Enable Storage (optional — for document uploads)

---

## Known Limitations / Future Work
- Scanned PDFs with no extractable text: user should add context; consider OCR later
- Production rate limiting not implemented (see API route comments)
- Optional Firebase Storage / `storageUrl` for persisted file blobs — not implemented in app
- Non-English documents: Claude handles them but note the limitation in UI
- Document chunking for very long docs: currently capped at 80k chars to Claude
