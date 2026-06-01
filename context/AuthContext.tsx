"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  useMemo,
} from "react"
import { useSession } from "next-auth/react"
import { signOutAndInvalidate } from "@/app/actions/auth"
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
      const raw = await res.json()
      if (!raw || typeof raw !== "object") {
        setProfile(null)
        return
      }
      const data = raw as Record<string, unknown>
      const error = typeof data.error === "string" ? data.error : undefined
      if (error) {
        setProfile(null)
        return
      }
      const plan = typeof data.plan === "string" ? data.plan : "free"
      const freeAnalysesRemainingToday = typeof data.freeAnalysesRemainingToday === "number" ? data.freeAnalysesRemainingToday : undefined
      const freeUsesRemaining = typeof data.freeUsesRemaining === "number" ? data.freeUsesRemaining : undefined
      const subscriptionStatus = typeof data.subscriptionStatus === "string" ? data.subscriptionStatus : "inactive"
      const freeDailyLimit = typeof data.freeDailyLimit === "number" ? data.freeDailyLimit : undefined
      const freeAnalysesUsedToday = typeof data.freeAnalysesUsedToday === "number" ? data.freeAnalysesUsedToday : undefined
      const resetsAt = typeof data.resetsAt === "string" ? data.resetsAt : undefined
      const unlimited = typeof data.unlimited === "boolean" ? data.unlimited : undefined
      setProfile({
        plan,
        freeUsesRemaining: freeAnalysesRemainingToday ?? freeUsesRemaining ?? 0,
        subscriptionStatus,
        freeDailyLimit,
        freeAnalysesUsedToday,
        freeAnalysesRemainingToday,
        resetsAt,
        unlimited,
      })
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setProfile(null)
    }
  }, [session?.user?.id])

  useEffect(() => {
    if (status === "authenticated") {
      // refreshProfile is async; the early `if (!session?.user?.id) setProfile(null)` paths
      // resolve synchronously, but the rule still flags this. The suppression is safe: we
      // explicitly want the profile to reset to null on unauth, and the async fetch path is
      // event-handler-equivalent (no sync cascading re-render in the success case).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      refreshProfile()
    } else {
      setProfile(null)
    }
    return () => abortRef.current?.abort()
  }, [status, refreshProfile])

  const user = useMemo(() => {
    // Build a stable session-user shape so the memo identity is preserved across
    // unrelated session ref changes. Returning a fresh object is intentional —
    // identity equality on `user` is what consumers use for change detection.
    return session?.user?.id && session.user.email
      ? {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          image: session.user.image,
        }
      : null
  }, [session])

  const handleSignOut = useCallback(() => signOutAndInvalidate(), [])

  const value = useMemo(
    () => ({
      user,
      profile,
      loading: status === "loading",
      signOut: handleSignOut,
      refreshProfile,
    }),
    [user, profile, status, handleSignOut, refreshProfile],
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
