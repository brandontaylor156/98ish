// Compass's browsing session on the 98ish server's web relay (server/web). One session per
// 98ish tab, shared by every Compass window; made with the signed-on 98 Messenger token.

export const SERVER = (import.meta.env.VITE_SOCKET_URL || "http://localhost:8000").replace(/\/$/, "")

let current = null // { sid, guest, used, limit, token }
let pending = null // { token, promise }
const listeners = new Set()
const emit = () => listeners.forEach((fn) => fn(current))
export const onSession = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export const currentSession = () => current

export class RelayError extends Error {
  constructor(message, status, extra = {}) {
    super(message)
    this.status = status
    Object.assign(this, extra)
  }
}

const withTimeout = (promise, ms, onSlow) => {
  const slow = onSlow ? setTimeout(onSlow, 3000) : null
  return Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new RelayError("The 98ish server didn't answer. It may be waking up; try again in a moment.", 0, { offline: true })), ms))]).finally(() => clearTimeout(slow))
}

// The session for this token (made if needed). onSlow: the server is waking up (Render naps)
export const ensureSession = (token, { fresh = false, onSlow } = {}) => {
  const key = token || null
  if (!fresh && current && current.token === key) return Promise.resolve(current)
  if (!fresh && pending && pending.token === key) return pending.promise
  const promise = withTimeout(
    fetch(`${SERVER}/api/web/session`, { method: "POST", headers: key ? { authorization: `Bearer ${key}` } : {} }).then(async (r) => {
      const body = await r.json().catch(() => ({}))
      if (!r.ok) throw new RelayError(body.error || "The web relay isn't available.", r.status, { signOn: r.status === 401 })
      return body
    }),
    65000,
    onSlow
  )
    .then((body) => {
      current = { ...body, token: key }
      emit()
      return current
    })
    .catch((error) => {
      if (error instanceof RelayError) throw error
      throw new RelayError("Compass can't reach the 98ish server. Check your connection.", 0, { offline: true })
    })
    .finally(() => {
      if (pending?.promise === promise) pending = null
    })
  pending = { token: key, promise }
  return promise
}

export const dropSession = () => {
  current = null
  emit()
}

// Can this page go straight into a frame? -> { ok, frameable, url, https } (never throws)
export const checkFrame = async (sid, url) => {
  try {
    const r = await withTimeout(fetch(`${SERVER}/api/web/check?sid=${sid}&url=${encodeURIComponent(url)}`), 20000)
    return await r.json()
  } catch {
    return { ok: false }
  }
}

export const refreshUsage = async () => {
  if (!current) return null
  try {
    const r = await fetch(`${SERVER}/api/web/usage?sid=${current.sid}`)
    if (!r.ok) return null
    const body = await r.json()
    current = { ...current, ...body }
    emit()
    return current
  } catch {
    return null
  }
}

// Forget the cookies the relay keeps for this account (signs you out of relayed sites)
export const clearCookies = async () => {
  if (!current) return false
  try {
    const r = await fetch(`${SERVER}/api/web/clear?sid=${current.sid}`, { method: "POST" })
    return r.ok
  } catch {
    return false
  }
}
