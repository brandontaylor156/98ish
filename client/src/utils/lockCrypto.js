// Passwords and PINs for the lock screen and Log On: only a salted PBKDF2-SHA256 hash is
// kept (WebCrypto, so it also runs in Node for the tests), never the secret itself.
// A record: { kind: "pin" | "password", algo, iterations, salt, hash } (salt and hash in base64).

export const ITERATIONS = 600_000 // OWASP's 2023 figure for PBKDF2-SHA256
const SALT_BYTES = 16
const HASH_BITS = 256

const subtle = () => {
  const s = globalThis.crypto?.subtle
  if (!s) throw new Error("This browser can't keep a password safely here (it needs a secure https page).")
  return s
}

const toBase64 = (bytes) => {
  let text = ""
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text)
}
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

const derive = async (secret, salt, iterations) => {
  const key = await subtle().importKey("raw", new TextEncoder().encode(String(secret).normalize("NFC")), "PBKDF2", false, ["deriveBits"])
  return new Uint8Array(await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, HASH_BITS))
}

// what a PIN or a password may be; null if fine, else a message for the person
export const checkSecret = (kind, secret) => {
  const s = String(secret ?? "")
  if (kind === "pin") {
    if (!/^\d+$/.test(s)) return "A PIN is digits only."
    if (s.length < 4 || s.length > 12) return "A PIN is 4 to 12 digits."
    return null
  }
  if (s.length < 4) return "A password needs at least 4 characters."
  if (s.length > 128) return "That password is too long."
  return null
}

export const hashSecret = async (kind, secret, { iterations = ITERATIONS, salt } = {}) => {
  const bytes = salt || globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const hash = await derive(secret, bytes, iterations)
  return { kind, algo: "PBKDF2-SHA256", iterations, salt: toBase64(bytes), hash: toBase64(hash) }
}

// true if `secret` matches the record (compared in constant time)
export const verifySecret = async (secret, record) => {
  if (!record?.salt || !record?.hash || !(record.iterations > 0)) return false
  const expected = fromBase64(record.hash)
  const actual = await derive(secret, fromBase64(record.salt), record.iterations)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i]
  return diff === 0
}

// ---- wrong tries: growing waits ----

// seconds to wait after `fails` wrong tries in a row: 3 free tries, then 5s, 15s, 45s...
// up to 15 minutes
export const delayAfter = (fails) => (fails < 3 ? 0 : Math.min(900, 5 * 3 ** (fails - 3)))
