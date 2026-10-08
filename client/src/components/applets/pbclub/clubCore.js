// Real Games' rules (Pickleball 98), shared by the app and the server (server/pbclub loads this very
// file): the venues, what a logged match and a play session look like, the friends' ratings,
// stats, and who's in / waitlisted for a session. Pure: no React, no storage.
//
// A match: { id, by, at, venue, kind: "doubles" | "singles", teams: [[p, p], [p, p]],
//   games: [[11, 7], ...], note, session, status, names }
//   p = { k: account key } or { g: "Guest name" }
//   status: "pending" (waiting for an opponent to confirm), "confirmed", "disputed",
//   "expired" (nobody confirmed in 7 days), "removing" (a player asked to take it back;
//   it still counts until someone on the other team agrees), "unrated" (an opponent is a
//   guest: it's in your record but not in the ratings)
// A session: { id, host, title, venue, start, minutes, max, courts, skill, note, invited,
//   rsvps: { key: { s: "in" | "maybe" | "out", at, late } }, chat, rotation, cancelled }

export const LIMITS = {
  matchesPerAccount: 2000, // logged by one account (years of play)
  matchesPerDay: 60,
  sessionsHosted: 30, // upcoming at once
  sessionPlayers: 32,
  invited: 40,
  chat: 100,
  chatText: 300,
  note: 300,
  matchNote: 140,
  games: 5,
}
export const CONFIRM_DAYS = 7
export const SESSION_KEEP_DAYS = 30 // after it starts
export const DAY = 86_400_000

// The owner's group's courts (ids match Pickleball 98's My Park venues)
export const VENUES = [
  { id: "loscab", name: "Los Cab Sports Village", short: "Los Cab", address: "17272 Newhope St, Fountain Valley, CA 92708", lat: 33.714, lon: -117.924, indoor: false, access: "Members club" },
  { id: "newport", name: "The Tennis & Pickleball Club at Newport Beach", short: "Newport Beach Club", address: "11 Clubhouse Dr, Newport Beach, CA 92660", lat: 33.61096, lon: -117.87988, indoor: false, access: "Members club" },
  { id: "wolfbear", name: "Wolf + Bear Indoor Pickleball", short: "Wolf + Bear", address: "14933 Calvert St, Van Nuys, CA 91411", lat: 34.180934, lon: -118.457967, indoor: true, access: "Public, reservations" },
  { id: "whittier", name: "iPickle Whittier Narrows", short: "Whittier Narrows", address: "1201 Potrero Ave, South El Monte, CA 91733", lat: 34.0439, lon: -118.0576, indoor: false, access: "Public, reservations" },
  { id: "paseo", name: "The Paseo Club", short: "Paseo Club", address: "27650 Dickason Dr, Valencia, CA 91355", lat: 34.4377, lon: -118.562, indoor: false, access: "Members club" },
  { id: "sinaloa", name: "Sinaloa Middle School", short: "Sinaloa MS", address: "601 Royal Ave, Simi Valley, CA 93065", lat: 34.2654, lon: -118.7846, indoor: false, access: "Public courts" },
  { id: "smash", name: "California SMASH", short: "California SMASH", address: "815 N Nash St, El Segundo, CA 90245", lat: 33.92722, lon: -118.38807, indoor: true, access: "Public, reservations" },
  { id: "bouquet", name: "Bouquet Canyon Park", short: "Bouquet Canyon", address: "28127 Wellston Dr, Santa Clarita, CA 91350", lat: 34.45352, lon: -118.50507, indoor: false, access: "Public courts" },
]
export const venueById = (id) => VENUES.find((v) => v.id === id) || null

// a venue as stored: { id } for a known one, { name, address } for your own
export const venueName = (v, { short = false } = {}) => {
  const known = v?.id ? venueById(v.id) : null
  if (known) return short ? known.short : known.name
  return v?.name || "Somewhere"
}
export const venueAddress = (v) => (v?.id ? venueById(v.id)?.address : v?.address) || ""
export const mapsLinks = (v) => {
  const known = v?.id ? venueById(v.id) : null
  const q = encodeURIComponent(known ? `${known.name}, ${known.address}` : [v?.name, v?.address].filter(Boolean).join(", "))
  return {
    apple: known ? `https://maps.apple.com/?q=${encodeURIComponent(known.name)}&ll=${known.lat},${known.lon}&address=${encodeURIComponent(known.address)}` : `https://maps.apple.com/?q=${q}`,
    google: `https://www.google.com/maps/search/?api=1&query=${q}`,
  }
}

// ---- small helpers ----

const KEY_RE = /^[a-z0-9]{1,24}$/
export const ID_RE = /^[a-f0-9]{16}$/
const text = (v, max) =>
  String(v ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
const int = (v) => (Number.isInteger(Number(v)) && v !== null && v !== "" && v !== true ? Number(v) : NaN)
export const newId = () => {
  const bytes = new Uint8Array(8)
  ;(globalThis.crypto || {}).getRandomValues?.(bytes) ?? bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)))
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
}

// a player's id in stats and rotations: "k:alice" or "g:Uncle Bob"
export const pid = (p) => (p?.k ? `k:${p.k}` : `g:${p?.g || "?"}`)
export const playerName = (p, names = {}) => (p?.k ? names[p.k] || p.k : p?.g || "Guest")

const cleanVenue = (v) => {
  if (v?.id && venueById(v.id)) return { id: v.id }
  const name = text(v?.name, 60)
  if (!name) return null
  const address = text(v?.address, 120)
  return address ? { name, address } : { name }
}

const cleanPlayer = (p) => {
  if (p?.k && KEY_RE.test(String(p.k))) return { k: String(p.k) }
  const g = text(p?.g, 24)
  return g ? { g } : null
}

// ---- matches ----

export const matchWinner = (m) => {
  const won = [0, 0]
  for (const [a, b] of m.games || []) won[a > b ? 0 : 1]++
  return won[0] === won[1] ? null : won[0] > won[1] ? 0 : 1
}
export const hasGuest = (m) => (m.teams || []).flat().some((p) => !p.k)
export const keysIn = (m) => (m.teams || []).flat().filter((p) => p.k).map((p) => p.k)
export const teamOf = (m, key) => (m.teams || []).findIndex((t) => t.some((p) => p.k === key))
export const counts = (m) => m.status === "confirmed" || m.status === "removing" || m.status === "unrated"
export const rated = (m) => (m.status === "confirmed" || m.status === "removing") && !hasGuest(m)

// what a device sends -> { ok, match } | { ok: false, error } (id, by, status are the server's)
export const cleanMatch = (input, now = Date.now()) => {
  const kind = input?.kind === "singles" ? "singles" : "doubles"
  const size = kind === "singles" ? 1 : 2
  const teams = Array.isArray(input?.teams) ? input.teams.slice(0, 2).map((t) => (Array.isArray(t) ? t.slice(0, size).map(cleanPlayer) : [])) : []
  if (teams.length !== 2 || teams.some((t) => t.length !== size || t.some((p) => !p))) return { ok: false, error: kind === "singles" ? "Pick one player on each side." : "Pick two players on each team." }
  const ids = teams.flat().map(pid)
  if (new Set(ids).size !== ids.length) return { ok: false, error: "Someone is in the match twice." }
  if (!teams.flat().some((p) => p.k)) return { ok: false, error: "Add at least one 98 Messenger player." }
  const games = Array.isArray(input?.games) ? input.games.slice(0, LIMITS.games + 1) : []
  if (!games.length || games.length > LIMITS.games) return { ok: false, error: "Enter the score of each game (1 to 5 games)." }
  const clean = []
  for (const g of games) {
    const a = int(g?.[0])
    const b = int(g?.[1])
    if (!(a >= 0 && a <= 99 && b >= 0 && b <= 99)) return { ok: false, error: "A game's score isn't a number from 0 to 99." }
    if (a === b) return { ok: false, error: "A game can't end in a tie." }
    clean.push([a, b])
  }
  const m = { kind, teams, games: clean }
  if (matchWinner(m) === null) return { ok: false, error: "Nobody won: check the games." }
  const at = Number(input?.at)
  if (!Number.isFinite(at) || at > now + 10 * 60_000 || at < now - 400 * DAY) return { ok: false, error: "When was it played? (The last year or so.)" }
  const venue = input?.venue ? cleanVenue(input.venue) : null
  const id = ID_RE.test(String(input?.id || "")) ? String(input.id) : null
  const session = ID_RE.test(String(input?.session || "")) ? String(input.session) : null
  const to = [11, 15, 21].includes(Number(input?.to)) ? Number(input.to) : null
  return { ok: true, match: { id, at: Math.round(at), venue, kind, teams, games: clean, note: text(input?.note, LIMITS.matchNote), session, to } }
}

// the status a new match starts with: no opponent on 98 Messenger -> nobody can confirm
export const startStatus = (m, by) => {
  const mine = teamOf(m, by)
  const opponents = mine < 0 ? m.teams.flat() : m.teams[1 - mine]
  if (hasGuest(m)) return "unrated"
  return opponents.some((p) => p.k && p.k !== by) ? "pending" : "unrated"
}

// may `key` confirm or dispute it? Someone on the other team from whoever logged it (or
// either team, when it was logged by someone who didn't play)
export const canConfirm = (m, key) => {
  if (m.status !== "pending" || !keysIn(m).includes(key) || key === m.by) return false
  const loggerTeam = teamOf(m, m.by)
  return loggerTeam < 0 ? true : teamOf(m, key) !== loggerTeam
}
// a "removing" request is settled by someone on the other team from who asked
export const canAgreeRemove = (m, key) => m.status === "removing" && keysIn(m).includes(key) && m.removeTeam !== undefined && teamOf(m, key) !== m.removeTeam

export const expireStatus = (m, now = Date.now()) => (m.status === "pending" && now - (m.createdAt || m.at) > CONFIRM_DAYS * DAY ? "expired" : m.status)

// ---- ratings (a friends-only Elo, partner-adjusted in doubles) ----

export const RATING = { start: 1500, kNew: 40, k: 24, newGames: 10 }
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400))
// a close game moves ratings less than a blowout: 0.75 (11-10) to 1.25 (11-0)
export const marginWeight = (a, b) => {
  const target = Math.max(a, b, 11)
  return 0.75 + 0.5 * Math.min(1, Math.abs(a - b) / target)
}
export const levelOf = (r) => Math.round(Math.min(6.5, Math.max(2, 3.5 + (r - RATING.start) / 200)) * 10) / 10

// matches -> { singles: { pid: row }, doubles: { pid: row } }, row = { r, games, w, l }
// Only confirmed matches with no guests count, oldest first; each game is a result.
export const computeRatings = (matches, { since = 0, until = Infinity } = {}) => {
  const out = { singles: {}, doubles: {} }
  const list = (matches || []).filter((m) => rated(m) && m.at >= since && m.at < until).sort((a, b) => a.at - b.at || String(a.id).localeCompare(String(b.id)))
  const row = (table, id) => (table[id] ??= { r: RATING.start, games: 0, w: 0, l: 0 })
  const kOf = (x) => (x.games < RATING.newGames ? RATING.kNew : RATING.k)
  for (const m of list) {
    const table = out[m.kind === "singles" ? "singles" : "doubles"]
    const ids = m.teams.map((t) => t.map(pid))
    for (const [a, b] of m.games) {
      const w = a > b ? 0 : 1
      const mov = marginWeight(a, b)
      const rows = ids.map((t) => t.map((id) => row(table, id)))
      const avg = rows.map((t) => t.reduce((n, x) => n + x.r, 0) / t.length)
      const deltas = rows.map((t, ti) =>
        t.map((x, i) => {
          // in doubles, your own rating counts most: the stronger partner is expected to win
          // more, so gains less and loses more
          const partner = t.length > 1 ? t[1 - i].r : x.r
          const eff = t.length > 1 ? 0.75 * x.r + 0.25 * partner : x.r
          return kOf(x) * mov * ((ti === w ? 1 : 0) - expected(eff, avg[1 - ti]))
        })
      )
      rows.forEach((t, ti) =>
        t.forEach((x, i) => {
          x.r += deltas[ti][i]
          x.games++
          if (ti === w) x.w++
          else x.l++
        })
      )
    }
  }
  for (const table of Object.values(out)) for (const x of Object.values(table)) x.r = Math.round(x.r)
  return out
}

// a leaderboard: [{ id, r, level, games, w, l }] best first (players with at least `min` games)
export const ladder = (table, { min = 1 } = {}) =>
  Object.entries(table || {})
    .filter(([, x]) => x.games >= min)
    .map(([id, x]) => ({ id, ...x, level: levelOf(x.r) }))
    .sort((a, b) => b.r - a.r || b.games - a.games)

// ---- stats for one player (from the matches they're in) ----

export const statsFor = (key, matches, names = {}) => {
  const me = `k:${key}`
  const list = (matches || []).filter((m) => counts(m) && keysIn(m).includes(key)).sort((a, b) => a.at - b.at)
  const s = { matches: 0, w: 0, l: 0, gw: 0, gl: 0, pf: 0, pa: 0, streak: 0, best: 0, form: "", opponents: {}, partners: {}, venues: {} }
  let run = 0
  for (const m of list) {
    const t = teamOf(m, key)
    const won = matchWinner(m) === t
    s.matches++
    won ? s.w++ : s.l++
    for (const [a, b] of m.games) {
      const mine = t === 0 ? a : b
      const theirs = t === 0 ? b : a
      s.pf += mine
      s.pa += theirs
      mine > theirs ? s.gw++ : s.gl++
    }
    run = won ? (run > 0 ? run + 1 : 1) : run < 0 ? run - 1 : -1
    if (run > s.best) s.best = run
    s.form = (s.form + (won ? "W" : "L")).slice(-10)
    const diff = m.games.reduce((n, [a, b]) => n + (t === 0 ? a - b : b - a), 0)
    for (const p of m.teams[1 - t]) {
      const o = (s.opponents[pid(p)] ??= { name: playerName(p, { ...names, ...m.names }), w: 0, l: 0 })
      won ? o.w++ : o.l++
    }
    for (const p of m.teams[t]) {
      if (pid(p) === me) continue
      const o = (s.partners[pid(p)] ??= { name: playerName(p, { ...names, ...m.names }), w: 0, l: 0, diff: 0 })
      won ? o.w++ : o.l++
      o.diff += diff
    }
    const v = venueName(m.venue, { short: true })
    if (m.venue) s.venues[v] = (s.venues[v] || 0) + 1
  }
  s.streak = run
  return s
}

// "W3" / "L2" / ""
export const streakText = (n) => (n > 0 ? `W${n}` : n < 0 ? `L${-n}` : "")

// ---- play sessions ----

export const SKILLS = [2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0]
export const LATE = [5, 10, 15, 30]

export const cleanSession = (input, now = Date.now()) => {
  const venue = cleanVenue(input?.venue)
  if (!venue) return { ok: false, error: "Pick where you're playing." }
  const start = Number(input?.start)
  if (!Number.isFinite(start) || start < now - 6 * 3_600_000 || start > now + 180 * DAY) return { ok: false, error: "Pick a time in the next six months." }
  const minutes = Math.min(480, Math.max(30, int(input?.minutes) || 120))
  const max = Math.min(LIMITS.sessionPlayers, Math.max(2, int(input?.max) || 8))
  const courts = Math.min(8, Math.max(1, int(input?.courts) || Math.max(1, Math.floor(max / 4))))
  let skill = null
  const lo = Number(input?.skill?.min)
  const hi = Number(input?.skill?.max)
  if (SKILLS.includes(lo) && SKILLS.includes(hi) && lo <= hi) skill = { min: lo, max: hi }
  const title = text(input?.title, 60) || `Open play at ${venueName(venue, { short: true })}`
  return { ok: true, session: { title, venue, start: Math.round(start), minutes, max, courts, skill, note: text(input?.note, LIMITS.note), open: input?.open !== false } }
}

// who's in: the first `max` "in" answers (by when they said in), then the waitlist
export const rsvpLists = (session) => {
  const entries = Object.entries(session?.rsvps || {})
  const going = entries.filter(([, r]) => r.s === "in").sort((a, b) => a[1].at - b[1].at || a[0].localeCompare(b[0]))
  const max = session?.max || 8
  return {
    in: going.slice(0, max).map(([k]) => k),
    waitlist: going.slice(max).map(([k]) => k),
    maybe: entries.filter(([, r]) => r.s === "maybe").map(([k]) => k),
    out: entries.filter(([, r]) => r.s === "out").map(([k]) => k),
  }
}
export const rsvpOf = (session, key) => {
  const lists = rsvpLists(session)
  if (lists.in.includes(key)) return "in"
  if (lists.waitlist.includes(key)) return "waitlist"
  return session?.rsvps?.[key]?.s || null
}

// people the session is visible to
export const sessionMembers = (session) => [...new Set([session.host, ...(session.invited || []), ...Object.keys(session.rsvps || {})])]

export const lateText = (late) => (late === "here" ? "Here" : Number(late) > 0 ? `${late} min late` : "")

export const sessionWhen = (start, minutes, { locale, timeZone } = {}) => {
  const d = new Date(start)
  const opts = { weekday: "short", month: "short", day: "numeric", ...(timeZone ? { timeZone } : {}) }
  const t = { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }
  const end = new Date(start + minutes * 60_000)
  return `${d.toLocaleDateString(locale, opts)}, ${d.toLocaleTimeString(locale, t)} to ${end.toLocaleTimeString(locale, t)}`
}
