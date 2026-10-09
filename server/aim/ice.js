// ICE servers for 98 Messenger calls and spatial voice (My Park, Come Over, Watch Together).
// STUN (Google's public servers) always; TURN only when configured, because a relay carries
// the audio/video itself and no TURN stays free without an account. Any one of these turns
// it on (the first two are free accounts; the key stays on the server either way):
//   CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN   Cloudflare Realtime TURN (free
//                       1,000 GB/month): short-lived credentials are minted here per request
//                       batch (cached an hour, valid 6 hours)
//   METERED_TURN_APP + METERED_TURN_API_KEY              Metered's Open Relay (free account,
//                       20 GB/month); APP is the "<app>.metered.live" name
//   TURN_URLS + TURN_SECRET                              your own coturn with
//                       `use-auth-secret`: time-limited credentials minted here (TURN REST API)
//   TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL          any other TURN server, fixed login
// With none set, connections are STUN-only: most Wi-Fi works, cellular and strict NATs often
// can't connect (the apps then say so).
// (Public "no-signup" TURN servers were tried on 2026-10-09: openrelay.metered.ca's shared
// login and freestun.net hand out no relay any more, so none is built in.)

const crypto = require("crypto")

const STUN = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }]
const CACHE_MS = 60 * 60_000
const FETCH_TIMEOUT_MS = 5000
const MINT_TTL_S = 6 * 3600

const turnUrls = (env) =>
  String(env.TURN_URLS || "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => /^turns?:/.test(u))

// fixed login, or a coturn shared secret (TURN REST API: username "<expiry>:98ish",
// credential base64(HMAC-SHA1(secret, username)))
const staticTurn = (env, now = Date.now()) => {
  const urls = turnUrls(env)
  if (!urls.length) return []
  const secret = String(env.TURN_SECRET || "")
  if (secret) {
    const username = `${Math.floor(now / 1000) + MINT_TTL_S}:98ish`
    const credential = crypto.createHmac("sha1", secret).update(username).digest("base64")
    return [{ urls, username, credential }]
  }
  return [{ urls, username: String(env.TURN_USERNAME || ""), credential: String(env.TURN_CREDENTIAL || "") }]
}

// browsers time out on port 53 (Cloudflare lists it for native apps): leave those out
const usableUrl = (u) => typeof u === "string" && /^(stun|turns?):/.test(u) && !/:53(\?|$)/.test(u)

// only what an RTCPeerConnection needs, from whatever the provider sent back
const cleanServers = (list) =>
  (Array.isArray(list) ? list : list && typeof list === "object" ? [list] : [])
    .filter((s) => s && (typeof s.urls === "string" || Array.isArray(s.urls)))
    .map((s) => ({ ...s, urls: Array.isArray(s.urls) ? s.urls.filter(usableUrl) : usableUrl(s.urls) ? s.urls : null }))
    .filter((s) => (Array.isArray(s.urls) ? s.urls.length : s.urls))
    .slice(0, 8)
    .map((s) => ({
      urls: s.urls,
      ...(s.username ? { username: String(s.username) } : {}),
      ...(s.credential ? { credential: String(s.credential) } : {}),
    }))

const hasTurn = (servers) => servers.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)))

const createIce = ({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) => {
  // one cached, de-duplicated fetch per provider
  const provider = (name, request) => {
    let cached = null // { servers, at }
    let pending = null
    return async () => {
      const req = request()
      if (!req || !fetchImpl) return []
      if (cached && now() - cached.at < CACHE_MS) return cached.servers
      if (!pending) {
        pending = (async () => {
          try {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
            const response = await fetchImpl(req.url, { ...req.init, signal: controller.signal })
            clearTimeout(timer)
            const servers = cleanServers(response.ok ? req.pick(await response.json()) : [])
            if (servers.length) cached = { servers, at: now() }
            else console.error(`[ice] ${name} TURN gave no servers (HTTP ${response.status}); using STUN only`)
            return servers
          } catch {
            console.error(`[ice] ${name} TURN credentials unavailable; using STUN only`)
            return cached?.servers || []
          } finally {
            pending = null
          }
        })()
      }
      return pending
    }
  }

  const metered = provider("Metered", () => {
    const app = String(env.METERED_TURN_APP || "").trim().replace(/\.metered\.live$/i, "")
    const key = String(env.METERED_TURN_API_KEY || "").trim()
    if (!app || !key || !/^[a-z0-9-]+$/i.test(app)) return null
    return { url: `https://${app}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`, init: {}, pick: (j) => j }
  })

  // Cloudflare Realtime TURN: POST .../keys/<id>/credentials/generate-ice-servers
  // -> { iceServers: [{ urls }, { urls, username, credential }] } (the older
  // .../credentials/generate answered { iceServers: { urls, username, credential } })
  const cloudflare = provider("Cloudflare", () => {
    const id = String(env.CLOUDFLARE_TURN_KEY_ID || "").trim()
    const token = String(env.CLOUDFLARE_TURN_API_TOKEN || "").trim()
    if (!id || !token || !/^[a-z0-9]+$/i.test(id)) return null
    return {
      url: `https://rtc.live.cloudflare.com/v1/turn/keys/${id}/credentials/generate-ice-servers`,
      init: { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ ttl: MINT_TTL_S }) },
      pick: (j) => j?.iceServers,
    }
  })

  // { iceServers, turn } where turn says whether a relay is available
  const config = async () => {
    const [cf, me] = await Promise.all([cloudflare(), metered()])
    const turn = [...staticTurn(env, now()), ...cf, ...me]
    return { iceServers: [...STUN, ...turn], turn: hasTurn(turn) }
  }

  // which providers are set up (names only, for the startup log)
  const providers = () =>
    [
      env.CLOUDFLARE_TURN_KEY_ID && env.CLOUDFLARE_TURN_API_TOKEN ? "Cloudflare" : null,
      env.METERED_TURN_APP && env.METERED_TURN_API_KEY ? "Metered" : null,
      turnUrls(env).length ? (env.TURN_SECRET ? "own TURN (shared secret)" : "own TURN") : null,
    ].filter(Boolean)

  return { config, providers }
}

module.exports = { createIce, STUN, cleanServers, staticTurn }
