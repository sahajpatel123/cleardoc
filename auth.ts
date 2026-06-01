import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
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

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET
  if (!secret) {
    throw new Error(MISSING_SECRET_ERROR)
  }
  return secret
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
            // Timing-attack mitigation: run a dummy scrypt with a static salt
            // so the "missing user" path has similar latency to the "wrong password" path.
            await verifyPassword("dummy", "scrypt:0000000000000000:0000000000000000")
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
      log.error({ err }, "auth initialization failed")
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
    log.error(MISSING_SECRET_ERROR)
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