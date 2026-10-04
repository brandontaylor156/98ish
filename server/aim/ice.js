// ICE servers for 98 Messenger calls. STUN (Google's public servers) always; TURN only when
// configured, because relaying video costs bandwidth and TURN is never free for long:
//   METERED_TURN_APP + METERED_TURN_API_KEY  Metered's Open Relay (free account, 20 GB/month):
//                                            credentials are fetched here, so the key stays
//                                            on the server (APP is the "<app>.metered.live" name)
//   TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL  any other TURN server (comma-separated URLs)
// With neither set, calls are STUN-only: most Wi-Fi works, some cellular/strict NATs won't.

const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
const CACHE_MS = 60 * 60_000
const FETCH_TIMEOUT_MS = 5000

const staticTurn = (env) => {
  const urls = String(env.TURN_URLS || "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => /^turns?:/.test(u))
  if (!urls.length) return []
  return [{ urls, username: String(env.TURN_USERNAME || ""), credential: String(env.TURN_CREDENTIAL || "") }]
}

// only what an RTCPeerConnection needs, from whatever the provider sent back
const cleanServers = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((s) => s && (typeof s.urls === "string" || Array.isArray(s.urls)))
    .slice(0, 8)
    .map((s) => ({
      urls: s.urls,
      ...(s.username ? { username: String(s.username) } : {}),
      ...(s.credential ? { credential: String(s.credential) } : {}),
    }))

const createIce = ({ env = process.env, fetchImpl = globalThis.fetch } = {}) => {
  let cached = null // { servers, at }
  let pending = null

  const metered = async () => {
    const app = String(env.METERED_TURN_APP || "").trim().replace(/\.metered\.live$/i, "")
    const key = String(env.METERED_TURN_API_KEY || "").trim()
    if (!app || !key || !/^[a-z0-9-]+$/i.test(app) || !fetchImpl) return []
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.servers
    if (!pending) {
      pending = (async () => {
        try {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
          const response = await fetchImpl(`https://${app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`, {
            signal: controller.signal,
          })
          clearTimeout(timer)
          const servers = cleanServers(response.ok ? await response.json() : [])
          if (servers.length) cached = { servers, at: Date.now() }
          return servers
        } catch {
          console.error("[aim] TURN credentials unavailable; calls fall back to STUN only")
          return cached?.servers || []
        } finally {
          pending = null
        }
      })()
    }
    return pending
  }

  // { iceServers, turn } where turn says whether a relay is available
  const config = async () => {
    const turn = [...staticTurn(env), ...(await metered())]
    return { iceServers: [...STUN, ...turn], turn: turn.length > 0 }
  }

  return { config }
}

module.exports = { createIce, STUN }
