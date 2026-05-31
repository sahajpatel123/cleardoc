"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react"
import { useSession, signOut } from "next-auth/react"
import type { UserPlanProfile } from "@/lib/types"

interface AuthContextValue {
  user: {
    id: string
    email: string
    name?: string | null
    image?: string | null
  } | null
  profile: UserPlanProfile | null
  loading: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  profile: null,
  loading: true,
  signOut: async () => {},
  refreshProfile: async () => {},
})

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const [profile, setProfile] = useState<UserPlanProfile | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const refreshProfile = useCallback(async () => {
    if (!session?.user?.id) {
      setProfile(null)
      return
    }
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    try {
      const res = await fetch("/api/usage", { signal: abortRef.current.signal })
      if (!res.ok) {
        setProfile(null)
        return
      }
      const data = (await res.json()) as {
        error?: string
        freeUsesRemaining?: number
        freeAnalysesRemainingToday?: number
        freeAnalysesUsedToday?: number
        freeDailyLimit?: number
        resetsAt?: string
        plan?: string
        subscriptionStatus?: string
        unlimited?: boolean
      }
      if (data.error) {
        setProfile(null)
        return
      }
      setProfile({
        plan: data.plan ?? "free",
        freeUsesRemaining: data.freeAnalysesRemainingToday ?? data.freeUsesRemaining ?? 0,
        subscriptionStatus: data.subscriptionStatus ?? "inactive",
        freeDailyLimit: data.freeDailyLimit,
        freeAnalysesUsedToday: data.freeAnalysesUsedToday,
        freeAnalysesRemainingToday: data.freeAnalysesRemainingToday,
        resetsAt: data.resetsAt,
        unlimited: data.unlimited,
      })
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setProfile(null)
    }
  }, [session?.user?.id])

  useEffect(() => {
    if (status === "authenticated") {
      refreshProfile()
    } else {
      setProfile(null)
    }
    return () => abortRef.current?.abort()
  }, [status, refreshProfile])

  const user =
    session?.user?.id && session.user.email
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          image: session.user.image,
        }
      : null

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading: status === "loading",
        signOut: () => signOut({ callbackUrl: "/" }),
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
