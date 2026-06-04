import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { randomBytes } from "node:crypto"
import { prisma } from "@/lib/prisma"
import { verifyPassword, validateEmail, validatePassword } from "@/lib/password"
import { rateLimitLoginByHeaders, rateLimitByKey } from "@/lib/rate-limit"
import { getTokenVersion, setTokenVersion } from "@/lib/token-version-cache"
import { createLogger, captureException } from "@/lib/observability"
import type { NextRequest } from "next/server"

const log = createLogger("auth")

let _auth: ReturnType<typeof createAuth> | null | undefined = undefined

const globalForAuth = globalThis as unknown as {
  _auth: ReturnType<typeof createAuth> | null | undefined
}
// In dev (HMR), preserve the NextAuth instance across reloads to avoid
// paying the construction cost on every code change — same pattern as Prisma.
if (process.env.NODE_ENV !== "production" && globalForAuth._auth !== undefined) {
  _auth = globalForAuth._auth
}

const MISSING_SECRET_ERROR = "Authentication service misconfigured"

// During `next build`, Next.js sets NODE_ENV=production and
// NEXT_PHASE=phase-production-build, but does NOT load .env / .env.local —
// those are only loaded by `next dev` and `next start`. That means
// NEXTAUTH_SECRET is legitimately absent during the build, even though
// the runtime secret is configured. The RSC auth-gate pages (BUG #14)
// call auth() during page-data collection, so the secret check fires
// once per page per worker — producing ~14 scary-looking error lines
// per build, even though the build SUCCEEDS.
//
// We silence the error log during the build phase. Runtime misconfig
// (a production deploy with no secret) still throws MISSING_SECRET_ERROR
// from the handlers and the auth() function logs once per process.
const IS_BUILD_PHASE = process.env.NEXT_PHASE === "phase-production-build"
const IS_DEV = process.env.NODE_ENV !== "production"
const _missingSecretWarned = { value: false }
const _devSecretWarned = { value: false }

function getSecret(): string {
  const explicit = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (explicit) return explicit

  // Dev-only fallback: if no secret is configured AND we're in development,
  // generate a per-process random secret. This lets `next dev` boot and
  // function without forcing every developer to set NEXTAUTH_SECRET in
  // .env.local. Sessions invalidate on dev server restart, which is
  // acceptable. The fallback is NEVER used in production — the throw
  // below guarantees that.
  if (IS_DEV) {
    const devSecret = require("crypto").randomBytes(32).toString("base64")
    process.env.NEXTAUTH_SECRET = devSecret
    if (!_devSecretWarned.value) {
      _devSecretWarned.value = true
      log.warn(
        "NEXTAUTH_SECRET is not set; using a per-process random fallback for dev. " +
          "Sessions will be invalidated on every dev server restart. " +
          "Set NEXTAUTH_SECRET in .env.local (32+ chars) for stable dev sessions.",
      )
    }
    return devSecret
  }

  throw new Error(MISSING_SECRET_ERROR)
}

function createAuth() {
  const secret = getSecret()
  return NextAuth({
    secret,
    adapter: PrismaAdapter(prisma),
    providers: [
      Credentials({
        name: "Email & Password",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(raw, request) {
          // Brute-force throttle: cap credential attempts per IP BEFORE any DB
          // lookup or scrypt verification. Returning null yields the normal
          // "invalid credentials" response, so the next-auth client contract is
          // preserved (no custom 429 that would crash signIn()).
          if (request) {
            const rl = await rateLimitLoginByHeaders(request.headers)
            if (!rl.allowed) return null
          }

          const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : ""
          // Per-email rate limit: prevents a botnet from spraying one email from
          // thousands of IPs. 5 attempts per 15 min per email.
          const emailRl = await rateLimitByKey(`login-email:${email}`, 5, "15 m")
          if (!emailRl.allowed) return null

          const password = typeof raw?.password === "string" ? raw.password : ""
          if (validateEmail(email) || validatePassword(password, email)) return null

          const user = await prisma.user.findUnique({ where: { email } })
          if (!user || !user.password) {
            // Timing-attack mitigation: run a real-format scrypt verify at the
            // SAME cost (N=131072) used for real-password checks, so the
            // "missing user" path has equivalent latency to the "wrong
            // password" path. The previous dummy used the legacy 3-part
            // format which triggered Node's default N=16384 path — that's a
            // 10x speedup, distinguishable to an attacker via response-time
            // measurement and so leaks email registration state.
            //
            // Format must match the NEW hash format (6 parts, new params).
            // A 16-byte static salt and 64-byte zero derived key is enough
            // to drive verifyPassword through the scrypt path; the result
            // is discarded (return null either way).
            await verifyPassword(
              "dummy",
              `scrypt:131072:8:1:${"00".repeat(16)}:${"00".repeat(64)}`,
            )
            return null
          }

          const ok = await verifyPassword(password, user.password)
          if (!ok) return null

          return {
            id: user.id,
            email: user.email,
            name: user.name ?? undefined,
            image: user.image ?? undefined,
          }
        },
      }),
    ],
    session: {
      strategy: "jwt",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.id = user.id
          token.email = user.email
          // Intentional: defaulting tokenVersion to 0 on sign-in is acceptable
          // for a fresh JWT. A transient DB error (or not-yet-migrated column)
          // must not block an otherwise-valid sign-in — the next refresh will
          // re-seed the correct version.
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: user.id },
              select: { tokenVersion: true },
            })
            token.ver = dbUser?.tokenVersion ?? 0
          } catch (err) {
            captureException(err, { component: "auth", extra: { phase: "signin-tokenVersion" } })
            token.ver = 0
          }
        } else if (typeof token.email === "string") {
          if (!token.id) {
            const dbUser = await prisma.user.findUnique({
              where: { email: token.email.trim().toLowerCase() },
              select: { id: true, tokenVersion: true },
            })
            if (dbUser) {
              token.id = dbUser.id
              token.ver = dbUser.tokenVersion ?? 0
              // Cache the token version now so the next jwt callback
              // (which will have token.id) can skip the DB query entirely.
              await setTokenVersion(dbUser.id, dbUser.tokenVersion ?? 0)
            }
          } else {
            // Always check token version — including legacy tokens without `ver`.
            // Legacy tokens (ver=undefined) are treated as version 0, which will
            // be invalidated if the user has ever changed their password.
            //
            // H10 fix: FAIL CLOSED on DB / probe errors. A deleted user whose
            // JWT is still valid must NOT continue to authenticate, and a
            // transient DB blip must not silently grant access to a user whose
            // password was just changed. We allow one retry on connection-class
            // errors; if the retry also fails, we treat the session as
            // invalidated rather than fail open.
            //
            // Cache: try the in-memory TTL cache first to avoid a DB query on
            // every auth() call. The cache is invalidated immediately when
            // tokenVersion is incremented (password change / sign-out all).
            const userId = token.id as string
            const tokenVer = typeof token.ver === "number" ? token.ver : 0
            const cached = await getTokenVersion(userId)
            if (cached !== null) {
              if (cached > tokenVer) {
                throw new Error("Session invalidated. Please sign in again.")
              }
              // Cache hit and token is valid — skip DB query entirely.
            } else {
              const isTransient = (e: unknown): boolean => {
                const code = (e as Record<string, unknown>)?.code
                return typeof code === "string" && ["P1001", "P1002", "P1008", "P1017"].includes(code)
              }

              const validateTokenVersion = async (): Promise<void> => {
                const dbUser = await prisma.user.findUnique({
                  where: { id: userId },
                  select: { tokenVersion: true },
                })
                if (!dbUser) {
                  // User was deleted between sign-in and now. Fail closed —
                  // a stale JWT must not keep a deleted user authenticated.
                  throw new Error("Session invalidated. Please sign in again.")
                }
                const dbVer = dbUser.tokenVersion
                await setTokenVersion(userId, dbVer)
                if (dbVer > tokenVer) {
                  throw new Error("Session invalidated. Please sign in again.")
                }
              }

              try {
                await validateTokenVersion()
              } catch (err) {
                if (err instanceof Error && err.message.startsWith("Session invalidated")) {
                  throw err
                }
                if (isTransient(err)) {
                  // Retry once after 500ms for transient connection errors.
                  await new Promise((resolve) => setTimeout(resolve, 500))
                  try {
                    await validateTokenVersion()
                  } catch (retryErr) {
                    captureException(retryErr, { component: "auth", extra: { phase: "tokenVersion-retry" } })
                    log.warn(
                      { userId, err: retryErr instanceof Error ? retryErr.message : String(retryErr) },
                      "auth fail-closed after retry: tokenVersion DB check failed twice — forcing re-authentication",
                    )
                    // Fail closed on the second failure: a healthy session is
                    // not worth more than the cost of a re-authentication, and
                    // a deleted or recently-rotated user must not be allowed
                    // through during a DB outage.
                    throw new Error("Session invalidated. Please sign in again.")
                  }
                } else {
                  // Non-transient errors (e.g. missing column, bad query) are treated
                  // as session invalidation: fail closed so a broken DB state does not
                  // leave sessions alive after a password change.
                  captureException(err, { component: "auth", extra: { phase: "tokenVersion-non-transient" } })
                  throw new Error("Session invalidated. Please sign in again.")
                }
              }
            }
          }
        }
        return token
      },
      async session({ session, token }) {
        if (token?.id && session.user) {
          session.user.id = token.id as string
        }
        return session
      },
    },
    pages: {
      signIn: "/login",
    },
  })
}

function getAuth() {
  if (_auth === undefined) {
    try {
      _auth = createAuth()
    } catch (err) {
      // Initialization failure (e.g. missing NEXTAUTH_SECRET) should not
      // propagate as an unhandled throw from signIn/signOut. Return null so
      // callers hit the explicit `if (!instance)` guard and throw a typed
      // error instead of a raw stack trace.
      //
      // Build-phase silence: during `next build` .env files are not loaded,
      // so the missing secret is expected — see IS_BUILD_PHASE above. The
      // build still succeeds: auth() returns null, RSC pages redirect, the
      // pages are correctly marked as dynamic. Do not pollute the build
      // output with a per-page error from every worker.
      if (!IS_BUILD_PHASE) {
        log.error({ err }, "auth initialization failed")
      }
      _auth = null
    }
  }
  if (process.env.NODE_ENV !== "production") {
    globalForAuth._auth = _auth
  }
  return _auth
}

type NextAuthHandler = (req: NextRequest, ...args: unknown[]) => Promise<Response> | Response

export const handlers: { GET: NextAuthHandler; POST: NextAuthHandler } = {
  GET: async (req) => {
    const instance = getAuth()
    if (!instance) throw new Error(MISSING_SECRET_ERROR)
    return instance.handlers.GET(req)
  },
  POST: async (req) => {
    const instance = getAuth()
    if (!instance) throw new Error(MISSING_SECRET_ERROR)
    return instance.handlers.POST(req)
  },
}

export async function auth() {
  const instance = getAuth()
  if (!instance) {
    // Build-phase silence: see IS_BUILD_PHASE above. The build does not
    // load .env files, so a missing NEXTAUTH_SECRET is expected — auth()
    // returning null is the correct behavior (RSC pages redirect to
    // /login). We deliberately do NOT log here during build.
    //
    // At runtime, log once per process so a real production misconfig
    // (a deploy that forgot to set NEXTAUTH_SECRET) is still visible in
    // logs — but only once, not on every RSC render.
    if (!IS_BUILD_PHASE && !_missingSecretWarned.value) {
      _missingSecretWarned.value = true
      log.error(MISSING_SECRET_ERROR)
    }
    return null
  }
  return instance.auth()
}

export async function signIn(...args: Parameters<Awaited<ReturnType<typeof NextAuth>>["signIn"]>) {
  const instance = getAuth()
  if (!instance) throw new Error(MISSING_SECRET_ERROR)
  return instance.signIn(...args)
}

export async function signOut(...args: Parameters<Awaited<ReturnType<typeof NextAuth>>["signOut"]>) {
  const instance = getAuth()
  if (!instance) throw new Error(MISSING_SECRET_ERROR)
  return instance.signOut(...args)
}