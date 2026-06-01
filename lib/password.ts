import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

// SECURITY FIX (L-21): Bump scrypt N from Node default (16384) to 131072
// (8× increase, OWASP / modern recommendation). The params are encoded in
// the stored hash so verifyPassword uses the SAME cost that created the hash.
const SCRYPT_N = 131072
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 64

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options?: { N?: number; r?: number; p?: number; maxmem?: number },
) => Promise<Buffer>

/**
 * Hash format (new): scrypt:<N>:<r>:<p>:<salt-hex>:<derived-hex>
 * Hash format (legacy): scrypt:<salt-hex>:<derived-hex>
 * Legacy hashes use Node's default scrypt params (N=16384 at creation time).
 * New hashes encode N=131072 explicitly.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  })
  return `scrypt:${SCRYPT_N}:${SCRYPT_R}:${SCRYPT_P}:${salt.toString("hex")}:${derived.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split(":")
  if (parts[0] !== "scrypt") return false

  let salt: Buffer
  let expected: Buffer
  let opts: { N?: number; r?: number; p?: number; maxmem?: number } | undefined

  if (parts.length === 6) {
    // New format: scrypt:N:r:p:salt:derived
    const n = Number(parts[1])
    const r = Number(parts[2])
    const p = Number(parts[3])
    if ([n, r, p].some((v) => Number.isNaN(v))) return false
    // Defensive cap: prevent memory-DoS from attacker-controlled hash params.
    const MAX_N = 524288
    const MAX_MAXMEM = 256 * 1024 * 1024
    if (n > MAX_N) return false
    salt = Buffer.from(parts[4], "hex")
    expected = Buffer.from(parts[5], "hex")
    opts = { N: n, r, p, maxmem: MAX_MAXMEM }
  } else if (parts.length === 3) {
    // Legacy format: scrypt:salt:derived (Node default N=16384 at time of creation)
    salt = Buffer.from(parts[1], "hex")
    expected = Buffer.from(parts[2], "hex")
    opts = { maxmem: 256 * 1024 * 1024 }
  } else {
    return false
  }

  const derived = await scryptAsync(password, salt, expected.length, opts)
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

/** Reject obviously weak patterns: all same char, sequential digits/letters. */
function isObviousWeak(password: string): boolean {
  if (password.length < 3) return true
  // All identical characters (e.g., "aaaaaaaa")
  if (password.split("").every((c) => c === password[0])) return true
  // Sequential digits (e.g., "12345678")
  const digits = password.replace(/\D/g, "")
  if (digits.length >= 6 && isSequential(digits)) return true
  return false
}

function isSequential(s: string): boolean {
  for (let i = 1; i < s.length; i++) {
    if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== 1) return false
  }
  return true
}

export function validatePassword(password: string, email?: string): string | null {
  if (typeof password !== "string") return "Password is required."
  if (password.length < 12) return "Password must be at least 12 characters."
  if (password.length > 200) return "Password is too long."
  if (email && password.toLowerCase().includes(email.split("@")[0]?.toLowerCase() ?? "")) {
    return "Password must not contain your email."
  }
  if (isObviousWeak(password)) {
    return "Password is too predictable."
  }
  return null
}

export function validateEmail(email: string): string | null {
  if (typeof email !== "string") return "Email is required."
  const trimmed = email.trim()
  if (trimmed.length === 0) return "Email is required."
  if (trimmed.length > 320) return "Email is too long."
  // Lightweight RFC-ish check — full RFC validation is not worth the surface area.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Enter a valid email."
  return null
}
