"use client"

import { useCallback, useState } from "react"

export function useBilling() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const startCheckout = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/stripe/create-checkout", { method: "POST" })
      const data = (await res.json()) as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      setError(data.error ?? "Failed to start checkout. Please try again.")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [])

  const openPortal = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/stripe/portal", { method: "POST" })
      const data = (await res.json()) as { url?: string; error?: string }
      if (data.url) {
        window.location.href = data.url
        return
      }
      setError(data.error ?? "Failed to open billing portal.")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [])

  return { startCheckout, openPortal, loading, error, setError }
}
