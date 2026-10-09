// A software passkey for tests: makes what navigator.credentials.create()/get() would hand
// the page (as JSON, base64url buffers), with switches to make it wrong in one way at a time.
const crypto = require("crypto")
const { cborEncode, b64url, sha256 } = require("../webauthn")

const keysFor = (alg) => {
  if (alg === -257) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
    const jwk = publicKey.export({ format: "jwk" })
    return { privateKey, cose: new Map([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, "base64url")], [-2, Buffer.from(jwk.e, "base64url")]]), sign: (data) => crypto.sign("sha256", data, privateKey) }
  }
  if (alg === -8) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
    const jwk = publicKey.export({ format: "jwk" })
    return { privateKey, cose: new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, "base64url")]]), sign: (data) => crypto.sign(null, data, privateKey) }
  }
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
  const jwk = publicKey.export({ format: "jwk" })
  return {
    privateKey,
    cose: new Map([[1, 2], [3, alg], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]),
    sign: (data) => crypto.sign("sha256", data, { key: privateKey, dsaEncoding: "der" }),
  }
}

const authData = ({ rpId, up = true, uv = true, be = true, bs = true, counter = 0, credentialId = null, cose = null }) => {
  const flags = (up ? 0x01 : 0) | (uv ? 0x04 : 0) | (be ? 0x08 : 0) | (bs ? 0x10 : 0) | (credentialId ? 0x40 : 0)
  const count = Buffer.alloc(4)
  count.writeUInt32BE(counter)
  const parts = [sha256(rpId), Buffer.from([flags]), count]
  if (credentialId) {
    const len = Buffer.alloc(2)
    len.writeUInt16BE(credentialId.length)
    parts.push(Buffer.alloc(16), len, credentialId, cborEncode(cose))
  }
  return Buffer.concat(parts)
}

const clientData = ({ type, challenge, origin, crossOrigin }) => Buffer.from(JSON.stringify({ type, challenge, origin, ...(crossOrigin ? { crossOrigin: true } : {}) }))

const softAuthenticator = ({ alg = -7, rpId = "98ish.vercel.app", origin = "https://98ish.vercel.app", userHandle = null } = {}) => {
  const keys = keysFor(alg)
  const credentialId = crypto.randomBytes(32)
  const id = b64url(credentialId)
  let counter = 0
  let handle = userHandle

  // options: what the server sent (publicKey.challenge, publicKey.user.id); `bad` makes one thing wrong
  const create = (challenge, bad = {}) => {
    if (bad.userHandle !== undefined) handle = bad.userHandle
    const cd = clientData({ type: bad.type || "webauthn.create", challenge: bad.challenge || challenge, origin: bad.origin || origin, crossOrigin: bad.crossOrigin })
    const ad = authData({ rpId: bad.rpId || rpId, up: bad.up !== false, uv: bad.uv !== false, credentialId, cose: bad.cose || keys.cose, counter: 0 })
    const att = cborEncode(new Map([["fmt", bad.fmt || "none"], ["attStmt", bad.attStmt || new Map()], ["authData", ad]]))
    return { id: bad.id || id, rawId: bad.id || id, type: "public-key", response: { clientDataJSON: b64url(cd), attestationObject: b64url(att), transports: ["internal", "hybrid"] } }
  }

  const get = (challenge, bad = {}) => {
    counter = bad.counter ?? (alg === -7 && !bad.keepZero ? counter + 1 : counter)
    const cd = clientData({ type: bad.type || "webauthn.get", challenge: bad.challenge || challenge, origin: bad.origin || origin, crossOrigin: bad.crossOrigin })
    const ad = authData({ rpId: bad.rpId || rpId, up: bad.up !== false, uv: bad.uv !== false, counter })
    let signature = (bad.signer || keys.sign)(Buffer.concat([ad, sha256(cd)]))
    if (bad.flipSignature) {
      signature = Buffer.from(signature)
      signature[signature.length - 5] ^= 0x01
    }
    return { id, rawId: id, type: "public-key", response: { clientDataJSON: b64url(cd), authenticatorData: b64url(ad), signature: b64url(signature), userHandle: bad.userHandleOut ?? handle } }
  }

  return { id, create, get, keys, setHandle: (h) => (handle = h) }
}

module.exports = { softAuthenticator, keysFor }
