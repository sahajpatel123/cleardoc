"use client"

import { useCallback, useState } from "react"
import { useAuth } from "@/context/AuthContext"

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

/**
 * Open-redirect defense for server-returned `redirectTo` paths. The /api/stripe/portal
 * route returns { redirectTo: "/pricing" } when a user has no Stripe customer
 * (e.g. a brand-new account). If that value is ever influenced by user input
 * or a future code path returns an attacker-controlled URL, the client
 * would navigate to it. Allowlist to a strict set of internal paths.
 */
function isSafeInternalRedirect(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false
  // Must start with a single forward slash (absolute internal path) and NOT
  // be a protocol-relative URL (//evil.com) or a backslash variant (/\evil.com).
  if (url[0] !== "/") return false
  if (url[1] === "/" || url[1] === "\\") return false
  // Reject control characters and whitespace that some browsers tolerate.
  if (/[\x00-\x1F\x7F\s]/.test(url)) return false
  // Allowlist: only these internal paths may receive a server-driven redirect.
  // Add new paths here as features grow — never accept a generic "/path".
  const allowed = new Set(["/pricing", "/dashboard", "/analyze", "/account", "/login"])
  const pathOnly = url.split("?")[0].split("#")[0]
  return allowed.has(pathOnly)
}

export function useBilling() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const { refreshProfile } = useAuth()

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
        // Profile will be fresh after Stripe redirect completes (webhook updates DB)
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
        if (!isSafeInternalRedirect(redirectTo)) {
          setError("Unexpected server response. Please try again.")
          return
        }
        // Refresh profile after portal interaction so UI shows updated status
        await refreshProfile()
        window.location.href = redirectTo
        return
      }
      if (url) {
        if (!isStripeUrl(url)) {
          setError("Unexpected billing portal URL. Please try again.")
          return
        }
        // Refresh profile after portal interaction so UI shows updated status
        await refreshProfile()
        window.location.href = url
        return
      }
      setError(error ?? "Failed to open billing portal.")
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [refreshProfile])

  return { startCheckout, openPortal, loading, error, setError }
}
