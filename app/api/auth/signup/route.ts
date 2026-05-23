import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { hashPassword, validateEmail, validatePassword } from "@/lib/password"

export const runtime = "nodejs"

export async function POST(req: Request) {
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
}
