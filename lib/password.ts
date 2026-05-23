import { randomBytes, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

// Hashes are stored as: scrypt:<salt-hex>:<derived-hex>
const KEYLEN = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, KEYLEN)
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false
  const parts = stored.split(":")
  if (parts.length !== 3 || parts[0] !== "scrypt") return false
  const salt = Buffer.from(parts[1], "hex")
  const expected = Buffer.from(parts[2], "hex")
  const derived = await scryptAsync(password, salt, expected.length)
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}

export function validatePassword(password: string): string | null {
  if (typeof password !== "string") return "Password is required."
  if (password.length < 8) return "Password must be at least 8 characters."
  if (password.length > 200) return "Password is too long."
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
