import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { verifyPassword, validateEmail, validatePassword } from "@/lib/password"

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.NEXTAUTH_SECRET,
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
    strategy: "jwt", // JWT so API routes can verify via getToken()
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
