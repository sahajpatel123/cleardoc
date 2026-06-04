import type { Metadata, Viewport } from "next"
import { Syne, DM_Sans } from "next/font/google"
import "./globals.css"
import { auth } from "@/auth"
import { Providers } from "@/components/Providers"
import Navbar from "@/components/ui/Navbar"
import Footer from "@/components/ui/Footer"
import { WebVitals } from "@/app/web-vitals"
import { resolveSiteUrl } from "@/lib/site-url"

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  weight: ["400", "500", "600"],
})

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500", "600"],
})

const SITE_URL = resolveSiteUrl()
const TITLE = "ClearDoc — A second pair of eyes on the document that scares you."
const DESCRIPTION =
  "Upload any official document — insurance denial, legal notice, medical bill, landlord threat. Get plain English, red flags, a counter-letter, and ranked next steps in 30 seconds."

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · ClearDoc",
  },
  description: DESCRIPTION,
  applicationName: "ClearDoc",
  keywords: [
    "document analysis",
    "insurance denial",
    "legal notice",
    "AI document reader",
    "consumer rights",
    "tenant rights",
    "medical bill help",
    "eviction notice",
  ],
  authors: [{ name: "ClearDoc" }],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "ClearDoc — A second pair of eyes.",
    description: "Upload any scary official document. Walk back armed.",
    url: SITE_URL,
    siteName: "ClearDoc",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClearDoc — A second pair of eyes.",
    description: "Upload any scary official document. Walk back armed.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
}

export const viewport: Viewport = {
  themeColor: "#050505",
  colorScheme: "dark",
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable}`}>
      <body className="antialiased min-h-screen flex flex-col">
        <Providers session={session}>
          <WebVitals />
          <Navbar />
          <main className="flex-1 relative">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
