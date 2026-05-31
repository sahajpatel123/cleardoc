import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { verifyPassword, validateEmail, validatePassword } from "@/lib/password"
import { rateLimitLoginByHeaders } from "@/lib/rate-limit"
import type { NextRequest } from "next/server"

let _auth: ReturnType<typeof createAuth> | null | undefined = undefined

const MISSING_SECRET_ERROR =
  "Missing NEXTAUTH_SECRET or AUTH_SECRET. Generate one: openssl rand -base64 32"

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
          const password = typeof raw?.password === "string" ? raw.password : ""
          if (validateEmail(email) || validatePassword(password)) return null

          const user = await prisma.user.findUnique({ where: { email } })
          if (!user || !user.password) return null

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
    },
    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          token.id = user.id
          token.email = user.email
          // Also fetch tokenVersion on sign-in to enable immediate validation.
          // Fail open: a transient DB error (or a not-yet-migrated tokenVersion
          // column) must not block an otherwise-valid sign-in — default to 0 and
          // let the next refresh re-seed it.
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: user.id },
              select: { tokenVersion: true },
            })
            token.ver = dbUser?.tokenVersion ?? 0
          } catch (err) {
            console.error("[auth] tokenVersion fetch failed on sign-in; defaulting to 0:", err)
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
            // Fail open on DB/probe errors (transient outage, un-migrated column)
            // so a healthy session is not force-logged-out by an infra blip; the
            // intentional revocation throw is always re-raised.
            try {
              const dbUser = await prisma.user.findUnique({
                where: { id: token.id as string },
                select: { tokenVersion: true },
              })
              const tokenVer = typeof token.ver === "number" ? token.ver : 0
              if (dbUser && (dbUser.tokenVersion ?? 0) > tokenVer) {
                throw new Error("Session invalidated. Please sign in again.")
              }
            } catch (err) {
              if (err instanceof Error && err.message.startsWith("Session invalidated")) {
                throw err
              }
              console.error("[auth] tokenVersion validation skipped (DB error):", err)
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
  if (_auth === undefined) _auth = createAuth()
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
    console.error("[auth]", MISSING_SECRET_ERROR)
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
