"use client"

import { SessionProvider } from "next-auth/react"
import type { Session } from "next-auth"
import { AuthProvider } from "@/context/AuthContext"

export function Providers({
  children,
  session,
}: {
  children: React.ReactNode
  session: Session | null
}) {
  return (
    <SessionProvider session={session}>
      <AuthProvider>{children}</AuthProvider>
    </SessionProvider>
  )
}
