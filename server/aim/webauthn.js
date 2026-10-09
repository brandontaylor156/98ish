// WebAuthn (passkeys) verification for 98 Messenger, with no library: a small CBOR reader,
// the authenticator data parser, COSE keys -> Node KeyObjects, and the two ceremonies'
// checks (W3C WebAuthn Level 2, sections 7.1 "Registering a New Credential" and 7.2
// "Verifying an Authentication Assertion"). Used by ./passkeys.js; tested in
// test/webauthn.test.js (including wrong origin, wrong/replayed challenge, bad signature).
//
// Policy (what 98ish asks for and accepts):
// - attestation "none": the authenticator's attestation statement is not used (98ish doesn't
//   restrict which authenticators people use); the public key comes from the authenticator
//   data the browser signed off on, and adding a passkey needs the account's password again.
// - algorithms: ES256 (-7, every iPhone/Mac/Android passkey), RS256 (-257, Windows Hello),
//   EdDSA (-8, some security keys). Nothing else.
// - user presence AND user verification (Face ID / Touch ID / PIN) are required, because a
//   passkey is the only factor when signing on with it.
// - signature counters: a counter that doesn't go up (when either side is non-zero) is
//   refused as a possibly cloned key. Synced passkeys (iCloud Keychain) always send 0.

const crypto = require("crypto")

class WebAuthnError extends Error {
  constructor(code, message) {
    super(message || code)
    this.code = code
  }
}
const fail = (code, message) => {
  throw new WebAuthnError(code, message)
}

// ---- base64url ----

const b64url = (buf) => Buffer.from(buf).toString("base64url")
const fromB64url = (text, what = "value", max = 64 * 1024) => {
  if (typeof text !== "string" || !text || text.length > max || !/^[A-Za-z0-9_-]+={0,2}$/.test(text)) fail("bad_encoding", `The ${what} isn't base64url.`)
  return Buffer.from(text, "base64url")
}

// ---- CBOR (RFC 8949), the subset CTAP2 uses: definite lengths only ----

const MAX_DEPTH = 16
const MAX_ITEMS = 4096

// -> { value, end } reading one item at `offset`
const cborDecodeAt = (buf, offset = 0, depth = 0) => {
  if (depth > MAX_DEPTH) fail("bad_cbor", "CBOR nested too deeply.")
  const need = (n) => {
    if (offset + n > buf.length) fail("bad_cbor", "CBOR ended early.")
  }
  need(1)
  const first = buf[offset++]
  const major = first >> 5
  const info = first & 31
  let arg
  if (info < 24) arg = info
  else if (info === 24) (need(1), (arg = buf[offset]), (offset += 1))
  else if (info === 25) (need(2), (arg = buf.readUInt16BE(offset)), (offset += 2))
  else if (info === 26) (need(4), (arg = buf.readUInt32BE(offset)), (offset += 4))
  else if (info === 27) {
    need(8)
    const big = buf.readBigUInt64BE(offset)
    offset += 8
    if (major !== 7 && big > BigInt(Number.MAX_SAFE_INTEGER)) fail("bad_cbor", "CBOR number too big.")
    arg = major === 7 ? big : Number(big)
  } else fail("bad_cbor", "Indefinite-length CBOR isn't allowed.")

  switch (major) {
    case 0:
      return { value: arg, end: offset }
    case 1:
      return { value: -1 - arg, end: offset }
    case 2:
      need(arg)
      return { value: Buffer.from(buf.subarray(offset, offset + arg)), end: offset + arg }
    case 3:
      need(arg)
      return { value: buf.subarray(offset, offset + arg).toString("utf8"), end: offset + arg }
    case 4: {
      if (arg > MAX_ITEMS) fail("bad_cbor", "CBOR array too long.")
      const out = []
      for (let i = 0; i < arg; i++) {
        const item = cborDecodeAt(buf, offset, depth + 1)
        out.push(item.value)
        offset = item.end
      }
      return { value: out, end: offset }
    }
    case 5: {
      if (arg > MAX_ITEMS) fail("bad_cbor", "CBOR map too long.")
      const out = new Map()
      for (let i = 0; i < arg; i++) {
        const k = cborDecodeAt(buf, offset, depth + 1)
        if (typeof k.value !== "number" && typeof k.value !== "string") fail("bad_cbor", "CBOR map keys must be numbers or text.")
        const v = cborDecodeAt(buf, k.end, depth + 1)
        if (out.has(k.value)) fail("bad_cbor", "Duplicate CBOR map key.")
        out.set(k.value, v.value)
        offset = v.end
      }
      return { value: out, end: offset }
    }
    case 6: // a tag: keep what it tags
      return cborDecodeAt(buf, offset, depth + 1)
    default: {
      if (info === 20) return { value: false, end: offset }
      if (info === 21) return { value: true, end: offset }
      if (info === 22) return { value: null, end: offset }
      if (info === 23) return { value: undefined, end: offset }
      if (info === 25) return { value: halfFloat(arg), end: offset }
      if (info === 26) {
        const b = Buffer.alloc(4)
        b.writeUInt32BE(arg)
        return { value: b.readFloatBE(0), end: offset }
      }
      if (info === 27) {
        const b = Buffer.alloc(8)
        b.writeBigUInt64BE(arg)
        return { value: b.readDoubleBE(0), end: offset }
      }
      fail("bad_cbor", "Unknown CBOR simple value.")
    }
  }
}
const halfFloat = (h) => {
  const exp = (h >> 10) & 0x1f
  const mant = h & 0x3ff
  const val = exp === 0 ? mant * 2 ** -24 : exp === 31 ? (mant ? NaN : Infinity) : (mant + 1024) * 2 ** (exp - 25)
  return h & 0x8000 ? -val : val
}

// one whole CBOR item (nothing may follow it)
const cborDecode = (buf) => {
  const { value, end } = cborDecodeAt(buf, 0)
  if (end !== buf.length) fail("bad_cbor", "Extra bytes after CBOR.")
  return value
}

// The writer (for tests' soft authenticator and nothing else): numbers, text, Buffers,
// arrays, Maps and plain objects, in canonical-enough form
const head = (major, n) => {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 0x100) return Buffer.from([(major << 5) | 24, n])
  if (n < 0x10000) return Buffer.from([(major << 5) | 25, n >> 8, n & 0xff])
  const b = Buffer.alloc(5)
  b[0] = (major << 5) | 26
  b.writeUInt32BE(n, 1)
  return b
}
const cborEncode = (v) => {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v)
  if (typeof v === "string") {
    const b = Buffer.from(v, "utf8")
    return Buffer.concat([head(3, b.length), b])
  }
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)])
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cborEncode)])
  if (v === true) return Buffer.from([0xf5])
  if (v === false) return Buffer.from([0xf4])
  if (v === null) return Buffer.from([0xf6])
  const entries = v instanceof Map ? [...v.entries()] : Object.entries(v)
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cborEncode(k), cborEncode(x)])])
}

// ---- authenticator data ----

const FLAGS = { UP: 0x01, UV: 0x04, BE: 0x08, BS: 0x10, AT: 0x40, ED: 0x80 }

// -> { rpIdHash, flags: { up, uv, be, bs, at, ed }, signCount, aaguid?, credentialId?, coseKey? (Map), extensions? }
const parseAuthData = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 37) fail("bad_authdata", "Authenticator data is too short.")
  const rpIdHash = buf.subarray(0, 32)
  const f = buf[32]
  const flags = { up: !!(f & FLAGS.UP), uv: !!(f & FLAGS.UV), be: !!(f & FLAGS.BE), bs: !!(f & FLAGS.BS), at: !!(f & FLAGS.AT), ed: !!(f & FLAGS.ED) }
  const signCount = buf.readUInt32BE(33)
  let offset = 37
  const out = { rpIdHash, flags, signCount }
  if (flags.at) {
    if (buf.length < offset + 18) fail("bad_authdata", "Attested credential data is too short.")
    out.aaguid = buf.subarray(offset, offset + 16)
    const idLen = buf.readUInt16BE(offset + 16)
    offset += 18
    if (idLen < 1 || idLen > 1023 || buf.length < offset + idLen) fail("bad_authdata", "Bad credential id length.")
    out.credentialId = Buffer.from(buf.subarray(offset, offset + idLen))
    offset += idLen
    const key = cborDecodeAt(buf, offset)
    if (!(key.value instanceof Map)) fail("bad_authdata", "The credential public key isn't a COSE key.")
    out.coseKey = key.value
    offset = key.end
  }
  if (flags.ed) {
    const ext = cborDecodeAt(buf, offset)
    out.extensions = ext.value
    offset = ext.end
  }
  if (offset !== buf.length) fail("bad_authdata", "Extra bytes after the authenticator data.")
  return out
}

// ---- COSE keys (RFC 9053) -> JWK ----

const ALGS = { "-7": "ES256", "-257": "RS256", "-8": "EdDSA" }
const ALLOWED_ALGS = [-7, -257, -8]

// a COSE_Key Map -> { alg, jwk } (throws for anything 98ish doesn't accept)
const coseToJwk = (cose) => {
  if (!(cose instanceof Map)) fail("bad_key", "Not a COSE key.")
  const kty = cose.get(1)
  const alg = cose.get(3)
  if (!ALLOWED_ALGS.includes(alg)) fail("unsupported_alg", "That kind of passkey isn't supported.")
  const bytes = (label, len) => {
    const v = cose.get(label)
    if (!Buffer.isBuffer(v) || (len && v.length !== len)) fail("bad_key", "The public key is malformed.")
    return v
  }
  let jwk
  if (alg === -7) {
    if (kty !== 2 || cose.get(-1) !== 1) fail("bad_key", "ES256 needs a P-256 key.")
    jwk = { kty: "EC", crv: "P-256", x: b64url(bytes(-2, 32)), y: b64url(bytes(-3, 32)) }
  } else if (alg === -257) {
    if (kty !== 3) fail("bad_key", "RS256 needs an RSA key.")
    const n = bytes(-1)
    if (n.length < 256 || n.length > 512) fail("bad_key", "RSA keys must be 2048-4096 bits.")
    jwk = { kty: "RSA", n: b64url(n), e: b64url(bytes(-2)) }
  } else {
    if (kty !== 1 || cose.get(-1) !== 6) fail("bad_key", "EdDSA needs an Ed25519 key.")
    jwk = { kty: "OKP", crv: "Ed25519", x: b64url(bytes(-2, 32)) }
  }
  keyFromJwk(jwk) // throws for a point that isn't on the curve, etc.
  return { alg, jwk }
}

const keyFromJwk = (jwk) => {
  try {
    return crypto.createPublicKey({ key: jwk, format: "jwk" })
  } catch {
    fail("bad_key", "The public key is invalid.")
  }
}

// does `signature` sign `data` with this stored key?
const KEY_TYPES = { "-7": "ec", "-257": "rsa", "-8": "ed25519" }
const verifySignature = (alg, jwk, data, signature) => {
  const key = keyFromJwk(jwk)
  if (key.asymmetricKeyType !== KEY_TYPES[alg]) fail("bad_key", "The stored key doesn't match its algorithm.")
  try {
    if (alg === -7) return crypto.verify("sha256", data, { key, dsaEncoding: "der" }, signature)
    if (alg === -257) return crypto.verify("sha256", data, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, signature)
    if (alg === -8) return crypto.verify(null, data, key, signature)
  } catch {
    return false
  }
  return false
}

// ---- client data ----

const sha256 = (data) => crypto.createHash("sha256").update(data).digest()
const sameText = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

const checkClientData = (raw, { type, challenge, origin }) => {
  let data
  try {
    data = JSON.parse(raw.toString("utf8"))
  } catch {
    fail("bad_client_data", "The client data isn't JSON.")
  }
  if (!data || typeof data !== "object") fail("bad_client_data", "The client data isn't an object.")
  if (data.type !== type) fail("wrong_type", `Expected ${type}.`)
  if (typeof data.challenge !== "string" || !challenge || !sameText(data.challenge, challenge)) fail("wrong_challenge", "The challenge doesn't match.")
  if (data.origin !== origin) fail("wrong_origin", "The passkey was used on another website.")
  if (data.crossOrigin === true) fail("cross_origin", "Passkeys can't be used from an embedded frame.")
  return data
}

const checkRp = (auth, rpId, requireUserVerification) => {
  if (!auth.rpIdHash.equals(sha256(rpId))) fail("wrong_rp", "The passkey belongs to another website.")
  if (!auth.flags.up) fail("no_presence", "The passkey didn't confirm someone was there.")
  if (requireUserVerification && !auth.flags.uv) fail("no_verification", "The passkey didn't check Face ID, Touch ID or a PIN.")
}

// ---- the ceremonies ----

// credential: what the browser gave navigator.credentials.create(), as JSON with base64url
// buffers: { id, rawId, type: "public-key", response: { clientDataJSON, attestationObject,
// transports? } }. -> { id, alg, jwk, counter, backedUp, backupEligible, transports, aaguid }
const verifyRegistration = ({ credential, challenge, origin, rpId, requireUserVerification = true }) => {
  if (!credential || typeof credential !== "object" || credential.type !== "public-key") fail("bad_credential", "That isn't a passkey.")
  const response = credential.response || {}
  const clientDataJSON = fromB64url(response.clientDataJSON, "client data", 4096)
  checkClientData(clientDataJSON, { type: "webauthn.create", challenge, origin })
  const att = cborDecode(fromB64url(response.attestationObject, "attestation", 16 * 1024))
  if (!(att instanceof Map) || typeof att.get("fmt") !== "string" || !(att.get("attStmt") instanceof Map) || !Buffer.isBuffer(att.get("authData"))) fail("bad_attestation", "The attestation is malformed.")
  if (att.get("fmt") === "none" && att.get("attStmt").size !== 0) fail("bad_attestation", "A 'none' attestation must be empty.")
  const auth = parseAuthData(att.get("authData"))
  checkRp(auth, rpId, requireUserVerification)
  if (!auth.flags.at || !auth.credentialId) fail("bad_authdata", "No credential was created.")
  const id = b64url(auth.credentialId)
  if (credential.id !== id || (credential.rawId != null && credential.rawId !== id)) fail("id_mismatch", "The credential id doesn't match.")
  const { alg, jwk } = coseToJwk(auth.coseKey)
  const transports = Array.isArray(response.transports) ? response.transports.filter((t) => typeof t === "string" && /^[a-z-]{1,16}$/.test(t)).slice(0, 6) : []
  return { id, alg, jwk, counter: auth.signCount, backedUp: auth.flags.bs, backupEligible: auth.flags.be, transports, aaguid: auth.aaguid.toString("hex") }
}

// credential: from navigator.credentials.get(): { id, rawId, type, response: {
// clientDataJSON, authenticatorData, signature, userHandle? } }; stored: { alg, jwk,
// counter, userHandle }. -> { counter, backedUp }
const verifyAuthentication = ({ credential, challenge, origin, rpId, stored, requireUserVerification = true }) => {
  if (!credential || typeof credential !== "object" || credential.type !== "public-key") fail("bad_credential", "That isn't a passkey.")
  if (!stored) fail("unknown_credential", "That passkey isn't known.")
  const response = credential.response || {}
  const clientDataJSON = fromB64url(response.clientDataJSON, "client data", 4096)
  checkClientData(clientDataJSON, { type: "webauthn.get", challenge, origin })
  const authData = fromB64url(response.authenticatorData, "authenticator data", 4096)
  const auth = parseAuthData(authData)
  checkRp(auth, rpId, requireUserVerification)
  if (response.userHandle != null && response.userHandle !== "" && stored.userHandle && !sameText(response.userHandle, stored.userHandle)) fail("wrong_user", "The passkey is for another account.")
  const signature = fromB64url(response.signature, "signature", 2048)
  if (!verifySignature(stored.alg, stored.jwk, Buffer.concat([authData, sha256(clientDataJSON)]), signature)) fail("bad_signature", "The passkey's signature didn't check out.")
  const old = Number(stored.counter) || 0
  if ((auth.signCount !== 0 || old !== 0) && auth.signCount <= old) fail("counter", "This passkey may have been copied (its counter went backwards).")
  return { counter: auth.signCount, backedUp: auth.flags.bs }
}

module.exports = {
  WebAuthnError,
  b64url,
  fromB64url,
  cborDecode,
  cborEncode,
  parseAuthData,
  coseToJwk,
  verifySignature,
  verifyRegistration,
  verifyAuthentication,
  sha256,
  ALGS,
  ALLOWED_ALGS,
  FLAGS,
}
