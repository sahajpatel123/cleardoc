"use client"

import { useState, useEffect } from "react"
import { useAuth } from "./useAuth"

interface UsageState {
  freeUsesRemaining: number
  plan: "free" | "pro"
  loading: boolean
}

export function useUsage(): UsageState {
  const { user, profile, loading: authLoading } = useAuth()
  const [usage, setUsage] = useState<UsageState>({
    freeUsesRemaining: 1,
    plan: "free",
    loading: true,
  })

  useEffect(() => {
    if (authLoading) return

    if (!user) {
      setUsage({ freeUsesRemaining: 1, plan: "free", loading: false })
      return
    }

    if (profile) {
      setUsage({
        freeUsesRemaining: profile.freeUsesRemaining,
        plan: profile.plan,
        loading: false,
      })
      return
    }

    // Fallback: fetch from API
    user
      .getIdToken()
      .then((token) =>
        fetch("/api/usage", {
          headers: { Authorization: `Bearer ${token}` },
        }).then((r) => r.json())
      )
      .then((data) => {
        setUsage({
          freeUsesRemaining: data.freeUsesRemaining ?? 0,
          plan: data.plan ?? "free",
          loading: false,
        })
      })
      .catch(() => {
        setUsage({ freeUsesRemaining: 0, plan: "free", loading: false })
      })
  }, [user, profile, authLoading])

  return usage
}
