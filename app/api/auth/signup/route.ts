import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { hashPassword, validateEmail, validatePassword } from "@/lib/password"
import { rateLimitByIp, rateLimitByKey } from "@/lib/rate-limit"
import { assertAuthEnv } from "@/lib/env"
import { createLogger, generateReqId, captureException } from "@/lib/observability"

export const runtime = "nodejs"

const log = createLogger("signup")

export async function POST(req: NextRequest) {
  const reqId = generateReqId()

  try {
    assertAuthEnv()
  } catch (err) {
    captureException(err, { component: "signup", reqId, extra: { phase: "assert-env" } })
    return NextResponse.json(
      { error: "Account signup is temporarily unavailable. Please try again later." },
      { status: 503, headers: { "x-request-id": reqId } },
    )
  }

  // Fail-closed rate limit: if Upstash is unreachable, refuse to sign up new
  // accounts rather than silently bypass the throttle (which would let an
  // attacker create unlimited accounts during a Redis outage).
  let rate: { allowed: boolean; reset?: number }
  try {
    rate = await rateLimitByIp(req, 5, "1 h")
  } catch (rlErr) {
    captureException(rlErr, { component: "signup", reqId, extra: { phase: "rate-limit" } })
    return NextResponse.json(
      { error: "Account signup is temporarily unavailable. Please try again later." },
      { status: 503, headers: { "Retry-After": "30", "x-request-id": reqId } },
    )
  }
  if (!rate.allowed) {
    const retryAfter = rate.reset
      ? String(Math.max(1, Math.ceil((rate.reset - Date.now()) / 1000)))
      : "60"
    return NextResponse.json(
      { error: "Too many signup attempts. Try again later." },
      { status: 429, headers: { "Retry-After": retryAfter, "x-request-id": reqId } },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid request." },
      { status: 400, headers: { "x-request-id": reqId } },
    )
  }

  const { email: rawEmail, password: rawPassword, name: rawName } = (body ?? {}) as {
    email?: string
    password?: string
    name?: string
  }

  const emailError = validateEmail(rawEmail ?? "")
  if (emailError) {
    return NextResponse.json(
      { error: emailError },
      { status: 400, headers: { "x-request-id": reqId } },
    )
  }

  const passwordError = validatePassword(rawPassword ?? "", rawEmail ?? "")
  if (passwordError) {
    return NextResponse.json(
      { error: passwordError },
      { status: 400, headers: { "x-request-id": reqId } },
    )
  }

  const email = (rawEmail as string).trim().toLowerCase()
  const password = rawPassword as string
  const name =
    typeof rawName === "string" && rawName.trim().length > 0 ? rawName.trim().slice(0, 80) : null

  // Per-email rate limit: prevents mass account creation via +1,+2,...
  // aliases and email enumeration. 5 attempts per hour per email.
  let emailRate: { allowed: boolean }
  try {
    emailRate = await rateLimitByKey(`signup-email:${email}`, 5, "1 h")
  } catch (rlErr) {
    captureException(rlErr, { component: "signup", reqId, extra: { phase: "email-rate-limit" } })
    return NextResponse.json(
      { error: "Account signup is temporarily unavailable. Please try again later." },
      { status: 503, headers: { "Retry-After": "30", "x-request-id": reqId } },
    )
  }
  if (!emailRate.allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts for this email. Try again later." },
      { status: 429, headers: { "Retry-After": "3600", "x-request-id": reqId } },
    )
  }

  try {
    const hashed = await hashPassword(password)
    await prisma.user.create({
      data: {
        email,
        password: hashed,
        name,
      },
    })

    return NextResponse.json({ ok: true }, { headers: { "x-request-id": reqId } })
  } catch (err) {
    captureException(err, { component: "signup", reqId, extra: { phase: "create" } })

    if (err instanceof Prisma.PrismaClientInitializationError) {
      return NextResponse.json(
        { error: "Account signup is temporarily unavailable. Please try again later." },
        { status: 503, headers: { "x-request-id": reqId } },
      )
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021") {
      log.error({ reqId }, "Database schema missing — run: npx prisma migrate deploy")
      return NextResponse.json(
        { error: "Account signup is temporarily unavailable. Please try again later." },
        { status: 503, headers: { "x-request-id": reqId } },
      )
    }

    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Return a generic success-like response to prevent email enumeration.
      // The per-email rate limit already throttles brute-force creation.
      return NextResponse.json(
        { ok: true },
        { status: 200, headers: { "x-request-id": reqId } },
      )
    }

    return NextResponse.json(
      { error: "Couldn't create account. Try again." },
      { status: 500, headers: { "x-request-id": reqId } },
    )
  }
}
