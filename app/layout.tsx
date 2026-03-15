import type { Metadata } from "next"
import { Syne, DM_Sans } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/context/AuthContext"
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
  title: "ClearDoc — Fight Back Against Confusing Official Documents",
  description:
    "Upload any scary official document — insurance denial, legal notice, medical bill, landlord threat — and get plain English, red flags, a response letter, and next steps. Instantly.",
  keywords: [
    "document analysis",
    "insurance denial",
    "legal notice",
    "AI document reader",
    "consumer rights",
    "tenant rights",
  ],
  openGraph: {
    title: "ClearDoc — They sent you a document. Now fight back.",
    description:
      "AI-powered document analysis for insurance denials, legal notices, medical bills, and more.",
    type: "website",
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable}`}>
      <body className="bg-[#0A0A0F] text-white antialiased min-h-screen flex flex-col">
        <AuthProvider>
          <Navbar />
          <main className="flex-1 pt-16">{children}</main>
          <Footer />
        </AuthProvider>
      </body>
    </html>
  )
}
