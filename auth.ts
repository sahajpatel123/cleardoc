import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { verifyPassword, validateEmail, validatePassword } from "@/lib/password"
import type { NextRequest } from "next/server"

let _auth: ReturnType<typeof createAuth> | null = null

function getSecret(): string {
  return process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET ?? ""
}

function createAuth() {
  const secret = getSecret()
  if (!secret) {
    throw new Error(
      "Missing NEXTAUTH_SECRET or AUTH_SECRET. Generate one: openssl rand -base64 32",
    )
  }
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
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email.trim().toLowerCase() },
          })
          if (dbUser) token.id = dbUser.id
        }
        return token
      },
      async session({ session, token }) {
        if (session.user?.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: session.user.email.trim().toLowerCase() },
          })
          if (dbUser) {
            session.user.id = dbUser.id
            return session
          }
        }
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
  if (!_auth) _auth = createAuth()
  return _auth
}

type NextAuthHandler = (req: NextRequest, ...args: unknown[]) => Promise<Response> | Response

export const handlers: { GET: NextAuthHandler; POST: NextAuthHandler } = {
  GET: async (req) => getAuth().handlers.GET(req),
  POST: async (req) => getAuth().handlers.POST(req),
}

export async function auth() {
  return getAuth().auth()
}

export async function signIn(...args: Parameters<Awaited<ReturnType<typeof NextAuth>>["signIn"]>) {
  return getAuth().signIn(...args)
}

export async function signOut(...args: Parameters<Awaited<ReturnType<typeof NextAuth>>["signOut"]>) {
  return getAuth().signOut(...args)
}
