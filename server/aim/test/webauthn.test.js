// Passkeys (WebAuthn) for 98 Messenger: the verification in ../webauthn.js, the ceremonies
// and challenges in ../passkeys.js, and the socket events end to end (add, sign on, remove,
// Delete My Account). Wrong origin, wrong/replayed/expired challenge, bad signature, copied
// key (counter), wrong website, no Face ID check: all refused.
const test = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("node:crypto")
const http = require("node:http")
const path = require("node:path")
const { Server } = require("socket.io")
const w = require("../webauthn")
const { createPasskeys, rpFor, configFromEnv } = require("../passkeys")
const { memoryStore } = require("../passkeyStore")
const { softAuthenticator, keysFor } = require("./softAuthenticator")

const PROD = "https://98ish.vercel.app"
const RP = "98ish.vercel.app"
const challenge = () => w.b64url(crypto.randomBytes(32))
const codeOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.code
  }
  return "no error"
}

test("CBOR: reads what CTAP2 writes, refuses junk", () => {
  const value = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from([1, 2, 3])], ["fmt", "none"], ["list", [true, false, null, 500, 70000]]])
  const back = w.cborDecode(w.cborEncode(value))
  assert.equal(back.get(3), -7)
  assert.deepEqual(back.get(-2), Buffer.from([1, 2, 3]))
  assert.deepEqual(back.get("list"), [true, false, null, 500, 70000])
  assert.equal(codeOf(() => w.cborDecode(Buffer.from([0x9f, 0x01, 0xff]))), "bad_cbor", "indefinite length")
  assert.equal(codeOf(() => w.cborDecode(Buffer.from([0x01, 0x02]))), "bad_cbor", "trailing bytes")
  assert.equal(codeOf(() => w.cborDecode(Buffer.from([0x5a, 0xff, 0xff, 0xff, 0xff]))), "bad_cbor", "length past the end")
  assert.equal(codeOf(() => w.cborDecode(Buffer.from([0xa2, 0x01, 0x01, 0x01, 0x02]))), "bad_cbor", "duplicate key")
  let deep = Buffer.from([0x01])
  for (let i = 0; i < 40; i++) deep = Buffer.concat([Buffer.from([0x81]), deep])
  assert.equal(codeOf(() => w.cborDecode(deep)), "bad_cbor", "nesting limit")
})

for (const [alg, name] of [[-7, "ES256"], [-257, "RS256"], [-8, "EdDSA"]]) {
  test(`register and sign in: ${name}`, () => {
    const auth = softAuthenticator({ alg, userHandle: "aGFuZGxl" })
    const c1 = challenge()
    const reg = w.verifyRegistration({ credential: auth.create(c1), challenge: c1, origin: PROD, rpId: RP })
    assert.equal(reg.id, auth.id)
    assert.equal(reg.alg, alg)
    assert.equal(reg.backedUp, true)
    assert.deepEqual(reg.transports, ["internal", "hybrid"])
    const stored = { alg: reg.alg, jwk: reg.jwk, counter: reg.counter, userHandle: "aGFuZGxl" }
    const c2 = challenge()
    const result = w.verifyAuthentication({ credential: auth.get(c2), challenge: c2, origin: PROD, rpId: RP, stored })
    assert.equal(result.counter, alg === -7 ? 1 : 0)
  })
}

test("registration refuses: wrong origin, challenge, type, website, no presence/verification, id swap, bad alg, bad attestation", () => {
  const auth = softAuthenticator()
  const c = challenge()
  const reg = (bad, opts = {}) => codeOf(() => w.verifyRegistration({ credential: auth.create(c, bad), challenge: c, origin: PROD, rpId: RP, ...opts }))
  assert.equal(reg({}), "no error")
  assert.equal(reg({ origin: "https://evil.example" }), "wrong_origin")
  assert.equal(reg({ origin: "https://98ish.vercel.app.evil.example" }), "wrong_origin")
  assert.equal(reg({ origin: "http://98ish.vercel.app" }), "wrong_origin")
  assert.equal(reg({ challenge: challenge() }), "wrong_challenge")
  assert.equal(reg({ type: "webauthn.get" }), "wrong_type")
  assert.equal(reg({ crossOrigin: true }), "cross_origin")
  assert.equal(reg({ rpId: "evil.example" }), "wrong_rp")
  assert.equal(reg({ up: false }), "no_presence")
  assert.equal(reg({ uv: false }), "no_verification")
  assert.equal(reg({ id: w.b64url(crypto.randomBytes(32)) }), "id_mismatch")
  assert.equal(reg({ cose: new Map([[1, 2], [3, -35], [-1, 2], [-2, Buffer.alloc(48)], [-3, Buffer.alloc(48)]]) }), "unsupported_alg")
  assert.equal(reg({ cose: new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(32, 1)], [-3, Buffer.alloc(32, 2)]]) }), "bad_key", "a point not on the curve")
  assert.equal(reg({ attStmt: new Map([["sig", Buffer.alloc(4)]]) }), "bad_attestation")
  assert.equal(codeOf(() => w.verifyRegistration({ credential: { ...auth.create(c), type: "password" }, challenge: c, origin: PROD, rpId: RP })), "bad_credential")
  assert.equal(codeOf(() => w.verifyRegistration({ credential: { type: "public-key", id: "x", response: { clientDataJSON: "!!!", attestationObject: "AA" } }, challenge: c, origin: PROD, rpId: RP })), "bad_encoding")
  // the one setting that lets a missing Face ID check pass is off by default
  assert.equal(reg({ uv: false }, { requireUserVerification: false }), "no error")
})

test("sign in refuses: wrong origin, challenge, website, bad or foreign signature, copied key, other account", () => {
  const auth = softAuthenticator({ userHandle: "dXNlcjE" })
  const c = challenge()
  const reg = w.verifyRegistration({ credential: auth.create(c), challenge: c, origin: PROD, rpId: RP })
  const stored = { alg: reg.alg, jwk: reg.jwk, counter: 5, userHandle: "dXNlcjE" }
  const get = (bad, s = stored) => {
    const c2 = challenge()
    return codeOf(() => w.verifyAuthentication({ credential: auth.get(c2, bad), challenge: c2, origin: PROD, rpId: RP, stored: s }))
  }
  assert.equal(get({ counter: 6 }), "no error")
  assert.equal(get({ counter: 7, origin: "https://evil.example" }), "wrong_origin")
  assert.equal(get({ counter: 7, challenge: challenge() }), "wrong_challenge")
  assert.equal(get({ counter: 7, type: "webauthn.create" }), "wrong_type")
  assert.equal(get({ counter: 7, rpId: "evil.example" }), "wrong_rp")
  assert.equal(get({ counter: 7, uv: false }), "no_verification")
  assert.equal(get({ counter: 7, up: false }), "no_presence")
  assert.equal(get({ counter: 7, flipSignature: true }), "bad_signature")
  assert.equal(get({ counter: 7, signer: keysFor(-7).sign }), "bad_signature", "signed by another key")
  assert.equal(get({ counter: 5 }), "counter", "the counter didn't go up")
  assert.equal(get({ counter: 3 }), "counter", "the counter went back")
  assert.equal(get({ counter: 0 }), "counter", "zero after non-zero")
  assert.equal(get({ counter: 7, userHandleOut: "b3RoZXI" }), "wrong_user")
  assert.equal(get({ counter: 0 }, { ...stored, counter: 0 }), "no error", "synced passkeys always send 0")
  assert.equal(get({ counter: 7 }, null), "unknown_credential")
  assert.equal(get({ counter: 7 }, { ...stored, alg: -257 }), "bad_key", "stored as another algorithm")
})

test("RP ID and origins: production, localhost in dev, nothing else", () => {
  const config = configFromEnv({})
  assert.deepEqual(rpFor("https://98ish.vercel.app", config), { origin: PROD, rpId: RP })
  assert.deepEqual(rpFor("https://98ish.vercel.app/", config), { origin: PROD, rpId: RP })
  assert.deepEqual(rpFor("http://localhost:5304", config), { origin: "http://localhost:5304", rpId: "localhost" })
  assert.equal(rpFor("http://98ish.vercel.app", config), null)
  assert.equal(rpFor("https://98ish-git-main-brandon.vercel.app", config), null, "preview deployments")
  assert.equal(rpFor("http://127.0.0.1:5304", config), null, "IP addresses can't be RP IDs")
  assert.equal(rpFor("https://localhost.evil.example", config), null)
  assert.equal(rpFor("null", config), null)
  assert.equal(rpFor("", config), null)
  assert.equal(rpFor("http://localhost:5304", configFromEnv({ WEBAUTHN_LOCALHOST: "0" })), null)
  const custom = configFromEnv({ WEBAUTHN_ORIGINS: "https://example.com, https://98ish.example/" })
  assert.deepEqual(rpFor("https://98ish.example", custom), { origin: "https://98ish.example", rpId: "98ish.example" })
  assert.equal(rpFor(PROD, custom), null)
})

test("passkeys service: one-time challenges, tied to origin and account, caps, remove, erase", async () => {
  let t = 1_000_000
  const store = memoryStore()
  const pk = createPasskeys({ store, config: configFromEnv({}), now: () => t, maxPasskeys: 3 })
  const auth = softAuthenticator()

  // adding: options name the right website and ask for Face ID
  const opts = await pk.registrationOptions({ key: "rosie", screenName: "Rosie", origin: PROD })
  assert.equal(opts.ok, true)
  assert.equal(opts.publicKey.rp.id, RP)
  assert.equal(opts.publicKey.authenticatorSelection.userVerification, "required")
  assert.equal(opts.publicKey.attestation, "none")
  assert.notEqual(opts.publicKey.user.id, "rosie", "the user handle isn't the screen name")
  assert.deepEqual(opts.publicKey.pubKeyCredParams.map((p) => p.alg), [-7, -257, -8])
  auth.setHandle(opts.publicKey.user.id)
  const cred = auth.create(opts.publicKey.challenge)
  // the right challenge from another account or origin doesn't count (and uses it up)
  assert.equal((await pk.register({ key: "theo", challengeId: opts.challengeId, credential: cred, origin: PROD })).ok, false)
  assert.equal((await pk.register({ key: "rosie", challengeId: opts.challengeId, credential: cred, origin: PROD })).code, "wrong_challenge", "used up")
  const opts2 = await pk.registrationOptions({ key: "rosie", screenName: "Rosie", origin: PROD })
  const wrongOrigin = await pk.register({ key: "rosie", challengeId: opts2.challengeId, credential: cred, origin: "http://localhost:5304" })
  assert.equal(wrongOrigin.ok, false)
  const opts3 = await pk.registrationOptions({ key: "rosie", screenName: "Rosie", origin: PROD })
  auth.setHandle(opts3.publicKey.user.id)
  const added = await pk.register({ key: "rosie", challengeId: opts3.challengeId, credential: auth.create(opts3.publicKey.challenge), origin: PROD, name: "Rosie's iPhone<script>" })
  assert.equal(added.ok, true)
  assert.equal(added.passkey.name, "Rosie's iPhonescript")
  // the same passkey twice: refused, and excluded from the next options
  const opts4 = await pk.registrationOptions({ key: "rosie", screenName: "Rosie", origin: PROD })
  assert.deepEqual(opts4.publicKey.excludeCredentials.map((c) => c.id), [auth.id])
  assert.equal(opts4.publicKey.user.id, opts3.publicKey.user.id, "one user handle per account")
  assert.equal((await pk.register({ key: "rosie", challengeId: opts4.challengeId, credential: auth.create(opts4.publicKey.challenge), origin: PROD })).code, "duplicate")

  // signing on: discoverable, no account named
  const a1 = pk.authenticationOptions({ origin: PROD })
  assert.deepEqual(a1.publicKey.allowCredentials, [])
  assert.equal(a1.publicKey.rpId, RP)
  const assertion = auth.get(a1.publicKey.challenge)
  const signed = await pk.authenticate({ challengeId: a1.challengeId, credential: assertion, origin: PROD })
  assert.deepEqual([signed.ok, signed.key], [true, "rosie"])
  // replaying the very same assertion: the challenge is gone
  assert.equal((await pk.authenticate({ challengeId: a1.challengeId, credential: assertion, origin: PROD })).code, "wrong_challenge")
  // a fresh challenge with an old assertion: the challenge inside doesn't match
  const a2 = pk.authenticationOptions({ origin: PROD })
  assert.equal((await pk.authenticate({ challengeId: a2.challengeId, credential: assertion, origin: PROD })).code, "wrong_challenge")
  // expired
  const a3 = pk.authenticationOptions({ origin: PROD })
  t += 6 * 60_000
  assert.equal((await pk.authenticate({ challengeId: a3.challengeId, credential: auth.get(a3.publicKey.challenge), origin: PROD })).code, "wrong_challenge")
  // a challenge made for localhost can't be answered from production
  const a4 = pk.authenticationOptions({ origin: "http://localhost:5304" })
  assert.equal(a4.publicKey.rpId, "localhost")
  assert.equal((await pk.authenticate({ challengeId: a4.challengeId, credential: auth.get(a4.publicKey.challenge), origin: PROD })).ok, false)
  // ...and a production passkey used on localhost is unknown there
  const a5 = pk.authenticationOptions({ origin: "http://localhost:5304" })
  const local = auth.get(a5.publicKey.challenge, { origin: "http://localhost:5304", rpId: "localhost" })
  assert.equal((await pk.authenticate({ challengeId: a5.challengeId, credential: local, origin: "http://localhost:5304" })).code, "unknown_credential")
  // a bad signature
  const a6 = pk.authenticationOptions({ origin: PROD })
  assert.equal((await pk.authenticate({ challengeId: a6.challengeId, credential: auth.get(a6.publicKey.challenge, { flipSignature: true }), origin: PROD })).code, "bad_signature")
  // origins that aren't 98ish
  assert.equal(pk.authenticationOptions({ origin: "https://evil.example" }).ok, false)
  assert.equal((await pk.registrationOptions({ key: "rosie", screenName: "Rosie", origin: "https://evil.example" })).ok, false)

  // cap: at most 3 here (10 in production)
  for (let i = 0; i < 2; i++) {
    const another = softAuthenticator()
    const o = await pk.registrationOptions({ key: "rosie", screenName: "Rosie", origin: PROD })
    another.setHandle(o.publicKey.user.id)
    assert.equal((await pk.register({ key: "rosie", challengeId: o.challengeId, credential: another.create(o.publicKey.challenge), origin: PROD })).ok, true)
  }
  assert.equal((await pk.registrationOptions({ key: "rosie", screenName: "Rosie", origin: PROD })).ok, false)
  const list = await pk.list("rosie")
  assert.equal(list.length, 3)
  assert.ok(list.every((p) => !("jwk" in p) && !("userHandle" in p)), "the list carries no keys")
  assert.ok(list[0].lastUsedAt > 0)

  // remove: only your own
  assert.equal(await pk.remove("theo", list[0].id), false)
  assert.equal(await pk.remove("rosie", list[0].id), true)
  assert.equal((await pk.list("rosie")).length, 2)
  // Delete My Account
  assert.deepEqual(await pk.eraseAccount({ key: "rosie" }), { removed: 2 })
  assert.equal(store.size(), 0)
  // pending challenges are bounded
  const small = createPasskeys({ store, config: configFromEnv({}), maxPending: 5 })
  for (let i = 0; i < 50; i++) small.authenticationOptions({ origin: PROD })
  assert.ok(small.pendingCount() <= 5)
})

// ---- over real sockets ----

let ioClient = null
try {
  ioClient = require(path.join(__dirname, "../../../client/node_modules/socket.io-client"))
} catch {
  ioClient = null
}

test("sockets: add a passkey (password again), sign on with it, list, remove, Delete My Account erases them", { skip: !ioClient && "socket.io-client not installed" }, async () => {
  const { attachAim } = require("..")
  const { createStore } = require("../store")
  const server = http.createServer()
  const io = new Server(server)
  const store = await createStore("")
  const passkeyStore = memoryStore()
  await attachAim(io, { store, passkeyStore, passkeyConfig: configFromEnv({}) })
  await new Promise((r) => server.listen(0, r))
  const url = `http://127.0.0.1:${server.address().port}`
  const sockets = []
  const connect = async (origin = "http://localhost:5304") => {
    const socket = ioClient(url, { transports: ["websocket"], forceNew: true, extraHeaders: { origin } })
    sockets.push(socket)
    await new Promise((r) => socket.on("connect", r))
    return socket
  }
  const ask = (socket, event, payload) => new Promise((r) => socket.emit(event, payload, r))
  const origin = "http://localhost:5304"
  try {
    const a = await connect()
    assert.equal((await ask(a, "aim:signOn", { screenName: "Rosie", password: "hunter22", register: true })).ok, true)
    // not signed on: no adding
    const stranger = await connect()
    assert.equal((await ask(stranger, "aim:passkeyAddStart", { password: "hunter22" })).ok, false)
    // the password again, and it has to be right
    assert.equal((await ask(a, "aim:passkeyAddStart", { password: "wrong!!" })).ok, false)
    const opts = await ask(a, "aim:passkeyAddStart", { password: "hunter22" })
    assert.equal(opts.ok, true)
    assert.equal(opts.publicKey.rp.id, "localhost")
    const auth = softAuthenticator({ rpId: "localhost", origin, userHandle: opts.publicKey.user.id })
    const added = await ask(a, "aim:passkeyAdd", { challengeId: opts.challengeId, credential: auth.create(opts.publicKey.challenge), name: "Test iPhone" })
    assert.equal(added.ok, true)
    const listed = await ask(a, "aim:passkeyList", {})
    assert.deepEqual([listed.passkeys.length, listed.passkeys[0].name, listed.available], [1, "Test iPhone", true])

    // a new page signs on with the passkey (remember me too), bumping the old session
    const b = await connect()
    const options = await ask(b, "aim:passkeyOptions", {})
    assert.equal(options.ok, true)
    const welcome = await ask(b, "aim:signOnPasskey", { challengeId: options.challengeId, credential: auth.get(options.publicKey.challenge), remember: true })
    assert.equal(welcome.ok, true)
    assert.equal(welcome.me.screenName, "Rosie")
    assert.match(welcome.remember, /^[0-9a-f]{64}$/)
    // replay on another socket: refused
    const c = await connect()
    assert.equal((await ask(c, "aim:signOnPasskey", { challengeId: options.challengeId, credential: auth.get(options.publicKey.challenge) })).ok, false)
    // a page on another origin gets no options at all
    const evil = await connect("https://evil.example")
    assert.equal((await ask(evil, "aim:passkeyOptions", {})).ok, false)

    // Delete My Account erases the passkeys; the passkey no longer signs on
    const del = await ask(b, "aim:deleteAccount", { screenName: "Rosie", password: "hunter22" })
    assert.equal(del.ok, true)
    assert.equal(passkeyStore.size(), 0)
    const d = await connect()
    const again = await ask(d, "aim:passkeyOptions", {})
    assert.equal((await ask(d, "aim:signOnPasskey", { challengeId: again.challengeId, credential: auth.get(again.publicKey.challenge) })).ok, false)
  } finally {
    sockets.forEach((s) => s.close())
    io.close()
    server.close()
  }
})
