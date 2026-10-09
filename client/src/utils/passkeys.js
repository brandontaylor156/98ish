// Passkeys in the browser (98 Messenger's "Sign On with a passkey" and My AIM > Passkeys...):
// turning the server's options (base64url text, server/aim/passkeys.js) into what
// navigator.credentials.create()/get() want, and the answer back into JSON.
//
// iPhones want create()/get() called straight from a tap (Safari keeps the "user gesture" only
// briefly and not across a socket round trip), so callers fetch the options BEFORE the tap and
// call these synchronously inside the click handler.

export const b64urlToBytes = (text) => {
  const s = String(text).replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(s + "===".slice((s.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export const bytesToB64url = (buf) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let bin = ""
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

// Can this browser make and use passkeys at all? (secure page + the API)
export const passkeysSupported = () =>
  typeof window !== "undefined" && !!window.isSecureContext && typeof window.PublicKeyCredential === "function" && !!navigator.credentials?.create

// server options (JSON) -> PublicKeyCredentialCreationOptions
export const creationOptions = (o) => ({
  ...o,
  challenge: b64urlToBytes(o.challenge),
  user: { ...o.user, id: b64urlToBytes(o.user.id) },
  excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: b64urlToBytes(c.id) })),
})

// server options (JSON) -> PublicKeyCredentialRequestOptions
export const requestOptions = (o) => ({
  ...o,
  challenge: b64urlToBytes(o.challenge),
  allowCredentials: (o.allowCredentials || []).map((c) => ({ ...c, id: b64urlToBytes(c.id) })),
})

// a PublicKeyCredential -> JSON the server reads
export const credentialJson = (cred) => {
  const r = cred.response
  const out = { id: cred.id, rawId: bytesToB64url(cred.rawId), type: cred.type, response: { clientDataJSON: bytesToB64url(r.clientDataJSON) } }
  if (r.attestationObject) {
    out.response.attestationObject = bytesToB64url(r.attestationObject)
    out.response.transports = typeof r.getTransports === "function" ? r.getTransports() : []
  } else {
    out.response.authenticatorData = bytesToB64url(r.authenticatorData)
    out.response.signature = bytesToB64url(r.signature)
    out.response.userHandle = r.userHandle ? bytesToB64url(r.userHandle) : null
  }
  return out
}

// Call from the tap. -> JSON credential; throws a friendly Error (`cancelled` when the person
// closed the Face ID sheet)
export const makePasskey = async (publicKey) => run(() => navigator.credentials.create({ publicKey: creationOptions(publicKey) }))
export const getPasskey = async (publicKey) => run(() => navigator.credentials.get({ publicKey: requestOptions(publicKey) }))

const run = async (call) => {
  try {
    const cred = await call()
    if (!cred) throw Object.assign(new Error("No passkey was chosen."), { cancelled: true })
    return credentialJson(cred)
  } catch (error) {
    if (error?.cancelled) throw error
    const name = error?.name
    if (name === "NotAllowedError" || name === "AbortError") throw Object.assign(new Error("No passkey was used (it was cancelled or took too long)."), { cancelled: true })
    if (name === "InvalidStateError") throw new Error("This device already has a passkey for this account.")
    if (name === "SecurityError") throw new Error("Passkeys only work on https://98ish.vercel.app.")
    if (name === "NotSupportedError") throw new Error("This device can't make a passkey 98ish accepts.")
    throw new Error(error?.message || "The passkey didn't work.")
  }
}

// A name for a new passkey from the device ("iPhone", "Mac", "Windows PC"...)
export const deviceName = (ua = typeof navigator !== "undefined" ? navigator.userAgent : "") => {
  if (/iPhone/.test(ua)) return "iPhone"
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1)) return "iPad"
  if (/Android/.test(ua)) return "Android phone"
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac"
  if (/Windows/.test(ua)) return "Windows PC"
  if (/CrOS/.test(ua)) return "Chromebook"
  if (/Linux/.test(ua)) return "Linux computer"
  return "Passkey"
}
