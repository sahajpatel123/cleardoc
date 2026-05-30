import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { verifyPassword, validateEmail, validatePassword } from "@/lib/password"
import type { NextRequest } from "next/server"

let _auth: ReturnType<typeof createAuth> | null | undefined = undefined

const MISSING_SECRET_ERROR =
  "Missing NEXTAUTH_SECRET or AUTH_SECRET. Generate one: openssl rand -base64 32"

function getSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ""
}

function createAuth() {
  const secret = getSecret()
  if (!secret) return null
  return NextAuth({
    secret,
    trustHost: true,
    adapter: PrismaAdapter(prisma),
    providers: [
      Credentials({
        name: "Email & Password",
        credentials: {
          email: { label: "Email", type: "email" },
          password: { label: "Password", type: "password" },
        },
        async authorize(raw) {
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
        } else if (typeof token.email === "string") {
          // Only query DB if token is missing id (first refresh after sign-in)
          if (!token.id) {
            const dbUser = await prisma.user.findUnique({
              where: { email: token.email.trim().toLowerCase() },
              select: { id: true, tokenVersion: true },
            })
            if (dbUser) {
              token.id = dbUser.id
              token.ver = dbUser.tokenVersion ?? 0
            }
          } else if (typeof token.ver === "number") {
            // Validate token version hasn't been revoked
            const dbUser = await prisma.user.findUnique({
              where: { id: token.id as string },
              select: { tokenVersion: true },
            })
            if (dbUser && (dbUser.tokenVersion ?? 0) > token.ver) {
              throw new Error("Session invalidated. Please sign in again.")
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
  return instance ? instance.auth() : null
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
