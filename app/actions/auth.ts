"use server"

import { auth, signOut } from "@/auth"
import { incrementTokenVersion } from "@/lib/db"
import { captureException } from "@/lib/observability"

/**
 * Server action: sign out the current user AND invalidate their token version
 * so all other active JWTs (other devices, tabs) are forced to re-authenticate.
 *
 * This replaces the raw next-auth/react signOut() which only clears the local
 * session cookie without bumping tokenVersion.
 */
export async function signOutAndInvalidate(): Promise<void> {
  try {
    const session = await auth()
    if (session?.user?.id) {
      await incrementTokenVersion(session.user.id)
    }
  } catch (err) {
    // Log but do not block sign-out if tokenVersion bump fails.
    captureException(err, { component: "auth", extra: { phase: "signout-invalidate" } })
  }
  await signOut({ redirectTo: "/" })
}
