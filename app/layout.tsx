import type { Metadata } from "next"
import { Syne, DM_Sans } from "next/font/google"
import "./globals.css"
import { auth } from "@/auth"
import { Providers } from "@/components/Providers"
import Navbar from "@/components/ui/Navbar"
import Footer from "@/components/ui/Footer"

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-syne",
  weight: ["400", "500", "600", "700", "800"],
})

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["300", "400", "500", "600", "700"],
})

export const metadata: Metadata = {
  title: "ClearDoc — A second pair of eyes on the document that scares you.",
  description:
    "Upload any official document — insurance denial, legal notice, medical bill, landlord threat. Get plain English, red flags, a counter-letter, and ranked next steps in 30 seconds.",
  keywords: [
    "document analysis",
    "insurance denial",
    "legal notice",
    "AI document reader",
    "consumer rights",
    "tenant rights",
  ],
  openGraph: {
    title: "ClearDoc — A second pair of eyes.",
    description:
      "Upload any scary official document. Walk back armed.",
    type: "website",
  },
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
          <Navbar />
          <main className="flex-1 relative">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
