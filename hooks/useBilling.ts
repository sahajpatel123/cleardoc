"use client"

import { useCallback, useState } from "react"

/** Validate that a URL returned by our server is on an expected Stripe origin. */
function isStripeUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "checkout.stripe.com" ||
        parsed.hostname === "billing.stripe.com" ||
        parsed.hostname.endsWith(".stripe.com"))
    )
  } catch {
    return false
  }
}

export function useBilling() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const startCheckout = useCallback(async () => {
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/stripe/create-checkout", { method: "POST" })
      const raw = await res.json()
      if (!raw || typeof raw !== "object") {
        setError("Something went wrong. Please try again.")
        return
      }
      const data = raw as Record<string, unknown>
      const url = typeof data.url === "string" ? data.url : undefined
      const error = typeof data.error === "string" ? data.error : undefined
      if (url) {
        if (!isStripeUrl(url)) {
          setError("Unexpected checkout URL. Please try again.")
          return
        }
        window.location.href = url
        return
      }
      setError(error ?? "Failed to start checkout. Please try again.")
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
      const raw = await res.json()
      if (!raw || typeof raw !== "object") {
        setError("Something went wrong. Please try again.")
        return
      }
      const data = raw as Record<string, unknown>
      const redirectTo = typeof data.redirectTo === "string" ? data.redirectTo : undefined
      const url = typeof data.url === "string" ? data.url : undefined
      const error = typeof data.error === "string" ? data.error : undefined
      if (redirectTo) {
        window.location.href = redirectTo
        return
      }
      if (url) {
        if (!isStripeUrl(url)) {
          setError("Unexpected billing portal URL. Please try again.")
          return
        }
        window.location.href = url
        return
      }
      setError(error ?? "Failed to open billing portal.")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [])

  return { startCheckout, openPortal, loading, error, setError }
}
