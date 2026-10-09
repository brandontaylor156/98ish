// Passkeys for 98 Messenger: "Sign On with a passkey" (Face ID / Touch ID / Windows Hello)
// and My AIM > Passkeys... (add, list, remove). The ceremonies' checks are in ./webauthn.js;
// the records in ./passkeyStore.js; the socket events in ./index.js:
//   aim:passkeyOptions {}                              -> { ok, challengeId, publicKey }   (anyone)
//   aim:signOnPasskey { challengeId, credential, remember } -> the same answer as aim:signOn
//   aim:passkeyAddStart { password }                   -> { ok, challengeId, publicKey }   (signed on)
//   aim:passkeyAdd { challengeId, credential, name }   -> { ok, passkey }
//   aim:passkeyList {}                                 -> { ok, passkeys: [...] }
//   aim:passkeyRemove { id }                           -> { ok }
//
// Where passkeys work (the RP ID and origin): a passkey belongs to one website, its "relying
// party ID". The page's origin is what the browser puts in the signed client data, and the
// socket's handshake Origin header picks which RP ID the options name:
//   https://98ish.vercel.app -> RP ID 98ish.vercel.app  (WEBAUTHN_ORIGINS overrides the list)
//   http(s)://localhost:<any port> -> RP ID localhost   (dev; WEBAUTHN_LOCALHOST=0 turns it off)
// Anything else (a Vercel preview URL, an IP address) gets "Passkeys aren't available here".
// vercel.app is a public suffix, so the RP ID can't be shortened to it; a passkey made on
// localhost never works on 98ish.vercel.app and the other way round (each record keeps its rpId
// and must match the origin it's used from).
//
// Challenges: 32 random bytes, kept in memory for 5 minutes, used once (taken before the
// answer is checked, so a replay or a second try with the same one fails), tied to the origin
// they were made for and, for adding, to the account. At most 2,000 waiting (oldest dropped).

const crypto = require("crypto")
const { verifyRegistration, verifyAuthentication, b64url, WebAuthnError, ALLOWED_ALGS } = require("./webauthn")

const DEFAULT_ORIGINS = ["https://98ish.vercel.app"]
const LOCALHOST = /^https?:\/\/localhost(:\d{1,5})?$/
const MAX_PASSKEYS = 10
const CHALLENGE_MS = 5 * 60_000
const MAX_PENDING = 2000
const RP_NAME = "98ish"

// { origins: [...], localhost: bool } from the environment
const configFromEnv = (env = process.env) => {
  const listed = String(env.WEBAUTHN_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean)
  // (localhost passkeys only in development: off on Render unless WEBAUTHN_LOCALHOST=1)
  const localhost = env.WEBAUTHN_LOCALHOST != null ? env.WEBAUTHN_LOCALHOST !== "0" : !env.RENDER
  return { origins: listed.length ? listed : DEFAULT_ORIGINS, localhost }
}

// the page origin -> { origin, rpId } or null where passkeys aren't offered
const rpFor = (origin, config) => {
  const o = String(origin || "").trim().replace(/\/+$/, "")
  if (!o || o.length > 200) return null
  let url
  try {
    url = new URL(o)
  } catch {
    return null
  }
  if (url.origin !== o) return null
  if (config.origins.includes(o) && url.protocol === "https:") return { origin: o, rpId: url.hostname }
  if (config.localhost && LOCALHOST.test(o)) return { origin: o, rpId: "localhost" }
  return null
}

const cleanName = (name) =>
  String(name ?? "")
    .replace(/[\u0000-\u001F\u007F<>]/g, "")
    .trim()
    .slice(0, 40) || "Passkey"

const summary = (r) => ({ id: r.id, name: r.name || "Passkey", createdAt: r.createdAt, lastUsedAt: r.lastUsedAt || null, backedUp: !!r.backedUp })

const NOT_HERE = "Passkeys aren't available on this copy of 98ish. Use https://98ish.vercel.app."

const createPasskeys = ({ store, config = configFromEnv(), now = () => Date.now(), challengeMs = CHALLENGE_MS, maxPasskeys = MAX_PASSKEYS, maxPending = MAX_PENDING } = {}) => {
  const pending = new Map() // challengeId -> { kind, challenge, origin, rpId, key?, userHandle?, expires }

  const sweep = () => {
    const t = now()
    for (const [id, p] of pending) if (p.expires <= t) pending.delete(id)
    while (pending.size >= maxPending) pending.delete(pending.keys().next().value)
  }
  const issue = (entry) => {
    sweep()
    const challengeId = crypto.randomBytes(16).toString("hex")
    const challenge = b64url(crypto.randomBytes(32))
    pending.set(challengeId, { ...entry, challenge, expires: now() + challengeMs })
    return { challengeId, challenge }
  }
  // used once: gone whether or not what comes with it checks out
  const take = (challengeId, kind) => {
    const id = String(challengeId || "")
    const p = pending.get(id)
    if (!p) return null
    pending.delete(id)
    if (p.kind !== kind || p.expires <= now()) return null
    return p
  }

  const failed = (error) => {
    if (error instanceof WebAuthnError) return { ok: false, code: error.code, error: "That passkey didn't work. Please try again." }
    throw error
  }

  // ---- adding a passkey (signed on, password already checked) ----
  const registrationOptions = async ({ key, screenName, origin }) => {
    const rp = rpFor(origin, config)
    if (!rp) return { ok: false, error: NOT_HERE }
    const mine = await store.list(key)
    if (mine.length >= maxPasskeys) return { ok: false, error: `You already have ${maxPasskeys} passkeys. Remove one first.` }
    // one random user handle per account (never the screen name), shared by its passkeys
    const userHandle = mine.find((r) => r.userHandle)?.userHandle || b64url(crypto.randomBytes(16))
    const { challengeId, challenge } = issue({ kind: "create", key, userHandle, ...rp })
    return {
      ok: true,
      challengeId,
      publicKey: {
        challenge,
        rp: { id: rp.rpId, name: RP_NAME },
        user: { id: userHandle, name: screenName, displayName: screenName },
        pubKeyCredParams: ALLOWED_ALGS.map((alg) => ({ type: "public-key", alg })),
        timeout: challengeMs - 10_000,
        attestation: "none",
        authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
        excludeCredentials: mine.filter((r) => r.rpId === rp.rpId).map((r) => ({ type: "public-key", id: r.id, ...(r.transports?.length ? { transports: r.transports } : {}) })),
      },
    }
  }

  const register = async ({ key, challengeId, credential, origin, name }) => {
    const p = take(challengeId, "create")
    if (!p || p.key !== key || p.origin !== String(origin || "").replace(/\/+$/, "")) return { ok: false, code: "wrong_challenge", error: "That took too long. Please try again." }
    let verified
    try {
      verified = verifyRegistration({ credential, challenge: p.challenge, origin: p.origin, rpId: p.rpId })
    } catch (error) {
      return failed(error)
    }
    if ((await store.count(key)) >= maxPasskeys) return { ok: false, error: `You already have ${maxPasskeys} passkeys. Remove one first.` }
    const record = {
      id: verified.id,
      key,
      userHandle: p.userHandle,
      rpId: p.rpId,
      alg: verified.alg,
      jwk: verified.jwk,
      counter: verified.counter,
      backedUp: verified.backedUp,
      transports: verified.transports,
      name: cleanName(name),
      createdAt: now(),
      lastUsedAt: 0,
    }
    if (!(await store.add(record))) return { ok: false, code: "duplicate", error: "That passkey is already added." }
    return { ok: true, passkey: summary(record) }
  }

  // ---- signing on with a passkey (nobody signed on yet) ----
  const authenticationOptions = ({ origin }) => {
    const rp = rpFor(origin, config)
    if (!rp) return { ok: false, error: NOT_HERE }
    const { challengeId, challenge } = issue({ kind: "get", ...rp })
    // no allowCredentials: the phone offers whichever 98ish passkeys it has (discoverable)
    return { ok: true, challengeId, publicKey: { challenge, rpId: rp.rpId, timeout: challengeMs - 10_000, userVerification: "required", allowCredentials: [] } }
  }

  // -> { ok: true, key } | { ok: false, error, code }
  const authenticate = async ({ challengeId, credential, origin }) => {
    const p = take(challengeId, "get")
    if (!p || p.origin !== String(origin || "").replace(/\/+$/, "")) return { ok: false, code: "wrong_challenge", error: "That took too long. Please try again." }
    const id = typeof credential?.id === "string" && credential.id.length <= 1400 && /^[A-Za-z0-9_-]+$/.test(credential.id) ? credential.id : null
    const stored = id && (await store.byId(id))
    if (!stored || stored.rpId !== p.rpId) return { ok: false, code: "unknown_credential", error: "This passkey isn't linked to a 98 Messenger account any more. Sign on with your password." }
    let result
    try {
      result = verifyAuthentication({ credential, challenge: p.challenge, origin: p.origin, rpId: p.rpId, stored })
    } catch (error) {
      return failed(error)
    }
    await store.update(stored.id, { counter: result.counter, backedUp: result.backedUp, lastUsedAt: now() })
    return { ok: true, key: stored.key, id: stored.id }
  }

  const list = async (key) => (await store.list(key)).map(summary)
  const remove = async (key, id) => store.remove(key, String(id || "").slice(0, 1400))
  // Delete My Account (server/account): every passkey record of the account
  const eraseAccount = async (ctx) => ({ removed: await store.removeAll(ctx.key) })

  return { registrationOptions, register, authenticationOptions, authenticate, list, remove, eraseAccount, pendingCount: () => pending.size, rpFor: (origin) => rpFor(origin, config) }
}

module.exports = { createPasskeys, configFromEnv, rpFor, MAX_PASSKEYS, DEFAULT_ORIGINS }
