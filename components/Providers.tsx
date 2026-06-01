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
  // Disable NextAuth's default polling (60s interval) and window-focus refetch.
  // Polling burns unnecessary /api/usage calls (up to 1 RPS per open tab).
  // Session state is driven by JWT callbacks; polling provides no benefit.
  return (
    <SessionProvider
      session={session}
      refetchInterval={0}
      refetchOnWindowFocus={false}
    >
      <AuthProvider>{children}</AuthProvider>
    </SessionProvider>
  )
}
