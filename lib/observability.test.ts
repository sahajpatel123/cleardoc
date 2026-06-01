import { describe, it } from "node:test"
import assert from "node:assert/strict"
import { isBannedKey, sanitizeForSentry } from "./observability"

describe("observability", () => {
  describe("isBannedKey", () => {
    it("flags substring banned keys", () => {
      const banned = [
        "password",
        "secret",
        "token",
        "apiKey",
        "api_key",
        "authorization",
        "cookie",
        "documentText",
        "filename",
        "userEmail",
      ]
      for (const key of banned) {
        assert.strictEqual(isBannedKey(key), true, `expected ${key} to be banned`)
      }
    })

    it("flags exact-match banned keys", () => {
      const banned = ["email", "file", "content", "body", "prompt", "message", "usercontent"]
      for (const key of banned) {
        assert.strictEqual(isBannedKey(key), true, `expected ${key} to be banned`)
      }
    })

    it("does not flag non-banned keys", () => {
      const safe = [
        "userId",
        "status",
        "model",
        "reqId",
        "count",
        "myEmail",
        "emailAddress",
        "contents",
        "bodyText",
        "prompts",
        "messages",
        "userContents",
      ]
      for (const key of safe) {
        assert.strictEqual(isBannedKey(key), false, `expected ${key} to not be banned`)
      }
    })
  })

  describe("sanitizeForSentry", () => {
    it("redacts banned substring keys", () => {
      const input = {
        password: "supersecret",
        secret: "shh",
        token: "abc123",
        apiKey: "key",
        api_key: "key",
        authorization: "Bearer token",
        cookie: "session=xyz",
        documentText: "secret doc",
        filename: "doc.pdf",
        userEmail: "user@example.com",
      }
      const out = sanitizeForSentry(input)
      for (const key of Object.keys(input)) {
        assert.strictEqual(out[key], "[REDACTED]", `expected ${key} to be redacted`)
      }
    })

    it("redacts exact-match banned keys", () => {
      const input = {
        email: "a@b.com",
        file: "f.txt",
        content: "c",
        body: "b",
        prompt: "p",
        message: "m",
        usercontent: "uc",
      }
      const out = sanitizeForSentry(input)
      for (const key of Object.keys(input)) {
        assert.strictEqual(out[key], "[REDACTED]", `expected ${key} to be redacted`)
      }
    })

    it("passes through non-banned keys unchanged", () => {
      const input = {
        userId: "123",
        status: "ok",
        model: "gpt-4",
        reqId: "abc",
        count: 42,
        nested: { foo: "bar" },
        arr: [1, 2, 3],
      }
      const out = sanitizeForSentry(input)
      assert.deepStrictEqual(out, input)
    })

    it("truncates strings over 500 chars", () => {
      const long = "a".repeat(600)
      const input = { note: long }
      const out = sanitizeForSentry(input)
      assert.strictEqual(out.note, `${"a".repeat(500)}…[+100]`)
    })

    it("does not truncate strings of exactly 500 chars", () => {
      const exact = "b".repeat(500)
      const input = { note: exact }
      const out = sanitizeForSentry(input)
      assert.strictEqual(out.note, exact)
    })

    it("recursively redacts banned keys inside nested objects", () => {
      const input = {
        meta: {
          password: "secret",
          email: "a@b.com",
          safeKey: "keep-me",
        },
      }
      const out = sanitizeForSentry(input)
      assert.deepStrictEqual(out.meta, {
        password: "[REDACTED]",
        email: "[REDACTED]",
        safeKey: "keep-me",
      })
    })
  })
})
