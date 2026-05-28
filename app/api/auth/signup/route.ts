import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hashPassword, validateEmail, validatePassword } from "@/lib/password"
import { rateLimitByIp } from "@/lib/rate-limit"
import { assertAuthEnv } from "@/lib/env"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    assertAuthEnv()
  } catch (err) {
    console.error("[signup] Server env not configured:", err)
    return NextResponse.json(
      { error: "Account signup is temporarily unavailable. Please try again later." },
      { status: 503 },
    )
  }

  const rate = await rateLimitByIp(req, 10, "1 h")
  if (!rate.allowed) {
    return NextResponse.json({ error: "Too many signup attempts. Try again later." }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 })
  }

  const { email: rawEmail, password: rawPassword, name: rawName } = (body ?? {}) as {
    email?: string
    password?: string
    name?: string
  }

  const emailError = validateEmail(rawEmail ?? "")
  if (emailError) return NextResponse.json({ error: emailError }, { status: 400 })

  const passwordError = validatePassword(rawPassword ?? "")
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 })

  const email = (rawEmail as string).trim().toLowerCase()
  const password = rawPassword as string
  const name = typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim().slice(0, 80) : null

  try {
    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      )
    }

    const hashed = await hashPassword(password)
    await prisma.user.create({
      data: {
        email,
        password: hashed,
        name,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[signup] Database error:", err)

    if (err instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json(
        { error: "Account signup is temporarily unavailable. Please try again later." },
        { status: 503 },
      )
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      console.error("[signup] Database schema missing — run: npx prisma migrate deploy")
      return NextResponse.json(
        { error: "Account signup is temporarily unavailable. Please try again later." },
        { status: 503 },
      )
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 },
      )
    }

    return NextResponse.json(
      { error: "Couldn't create account. Try again." },
      { status: 500 },
    )
  }
}
