// Pickleball 98 tournaments (pure; the server's server/tourney imports this same file).
// Weekly in-game events at the real venues, with ORIGINAL names (no real tournament's name
// or branding, and no affiliation with the venue or any organizer). Sign up with your 98
// Messenger account in a division (doubles 3.0-3.5, doubles 4.0+, mixed, singles), bring a
// partner (they accept) or play with a computer partner; at the start time the bracket is
// drawn and computer teams fill it to 4, 8 or 16. Each round has 30 minutes: you play your
// match in the game at that venue (against computer players, or online against people) and
// the result goes in; computer-vs-computer matches play themselves. The winners get a trophy
// in their Locker Room.
//
// A tournament record (the server keeps it; ids `${event}-${yyyymmdd}`):
//   { id, event, name, venue, start, divisions: [divId], seed, status: "open"|"live"|"done",
//     entries: [entry], brackets: { divId: bracket } | null, awarded, members: [keys] }
// entry:   { id, div, keys: [captain, partner?], names: { key: name }, partner:
//            null | { k, name, ok } (invited; ok once they accept), at }
// bracket: { size, teams: { teamId: team }, rounds: [[match]], champion: teamId | null }
// team:    { id, cpu, players: [{ k?, name, cpu? }] }
// match:   { id, r, i, a, b, w: null | "a" | "b", score: [a, b] | null, how: "played" |
//            "sim" | "walkover" | "lots", by, room, here: { a, b } }

export const TZ = "America/Los_Angeles"
export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
export const ROUND_MS = 30 * MINUTE // each round's window to play your match
export const LIMITS = { perDivision: 16, myUpcoming: 6, keepDays: 14, trophies: 60, stored: 300, showDays: 8 }

export const DIVISIONS = {
  d30: { id: "d30", name: "Doubles 3.0-3.5", short: "Doubles 3.0-3.5", kind: "doubles", level: "intermediate" },
  d40: { id: "d40", name: "Doubles 4.0+", short: "Doubles 4.0+", kind: "doubles", level: "pro" },
  mx: { id: "mx", name: "Mixed Doubles", short: "Mixed", kind: "doubles", mixed: true, level: "intermediate" },
  s: { id: "s", name: "Singles Open", short: "Singles", kind: "singles", level: "intermediate" },
}

// the weekly events (day: 0 = Sunday ... 6 = Saturday, null = every day; at: local time in
// TZ). Names are made up for 98ish.
export const EVENTS = [
  { id: "fvclassic", name: "Fountain Valley Fall Classic", venue: "loscab", day: 6, at: "10:00", divisions: ["d30", "d40", "mx"] },
  { id: "narrows", name: "Narrows Open", venue: "whittier", day: 0, at: "14:00", divisions: ["d30", "d40", "s"] },
  { id: "backbay", name: "Back Bay Invitational", venue: "newport", day: 5, at: "18:00", divisions: ["d30", "d40", "mx"] },
  { id: "nightslam", name: "Van Nuys Night Slam", venue: "wolfbear", day: 4, at: "19:30", divisions: ["d30", "d40", "s"] },
  { id: "twilight", name: "Valencia Twilight Cup", venue: "paseo", day: 3, at: "18:00", divisions: ["d30", "mx"] },
  { id: "beachcities", name: "Beach Cities Indoor Open", venue: "smash", day: 2, at: "19:00", divisions: ["d30", "d40", "s"] },
  { id: "schoolyard", name: "Simi Schoolyard Shootout", venue: "sinaloa", day: 6, at: "16:00", divisions: ["d30", "s"] },
  { id: "canyon", name: "Canyon Country Classic", venue: "bouquet", day: 0, at: "10:00", divisions: ["d30", "d40", "mx"] },
  { id: "riverside", name: "Riverside Nightly", venue: "riverside", day: null, at: "20:00", divisions: ["d30", "s"] },
]
export const VENUE_NAMES = { loscab: "Los Cab", whittier: "Whittier Narrows", newport: "Newport Beach Club", wolfbear: "Wolf + Bear", paseo: "Paseo Club", smash: "California SMASH", sinaloa: "Sinaloa MS", bouquet: "Bouquet Canyon", riverside: "Riverside Park" }

// ---------- time in the venues' time zone ----------
const fmt = typeof Intl !== "undefined" ? new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }) : null
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
// the wall clock in TZ at instant t
export const zoned = (t) => {
  const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]))
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, min: +parts.minute, s: +parts.second, wd: WEEKDAYS[parts.weekday] }
}
// the instant when the wall clock in TZ reads y-m-d h:min
export const instantOf = (y, m, d, h, min) => {
  const want = Date.UTC(y, m - 1, d, h, min)
  let t = want
  for (let i = 0; i < 3; i++) {
    const z = zoned(t)
    const seen = Date.UTC(z.y, z.m - 1, z.d, z.h, z.min)
    if (seen === want) return t
    t += want - seen
  }
  return t
}
const pad = (n) => String(n).padStart(2, "0")
const ymd = (z) => `${z.y}${pad(z.m)}${pad(z.d)}`

export const eventById = (id) => EVENTS.find((e) => e.id === id) || null

// one event on one day: its id and start
export const instance = (ev, y, m, d) => {
  const [h, min] = ev.at.split(":").map(Number)
  const start = instantOf(y, m, d, h, min)
  return { id: `${ev.id}-${y}${pad(m)}${pad(d)}`, event: ev.id, name: ev.name, venue: ev.venue, start, divisions: [...ev.divisions] }
}

// "narrows-20261011" -> that instance, or null (not an event, not its weekday)
export const parseId = (id) => {
  const m = /^([a-z]+)-(\d{4})(\d{2})(\d{2})$/.exec(String(id || ""))
  if (!m) return null
  const ev = eventById(m[1])
  if (!ev) return null
  const [y, mo, d] = [+m[2], +m[3], +m[4]]
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const inst = instance(ev, y, mo, d)
  const z = zoned(inst.start)
  if (z.d !== d || z.m !== mo) return null
  if (ev.day !== null && z.wd !== ev.day) return null
  return inst
}

// every event from a little while ago (still being played) to `days` ahead, soonest first
export const upcoming = (now, days = LIMITS.showDays) => {
  const out = []
  for (let k = -1; k <= days; k++) {
    const z = zoned(now + k * DAY)
    for (const ev of EVENTS) {
      if (ev.day !== null && ev.day !== z.wd) continue
      const inst = instance(ev, z.y, z.m, z.d)
      if (inst.start < now - 3 * HOUR || inst.start > now + days * DAY) continue
      if (!out.some((o) => o.id === inst.id)) out.push(inst)
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

// a fresh record for an instance
export const freshTourney = (inst, seed) => ({ id: inst.id, event: inst.event, name: inst.name, venue: inst.venue, start: inst.start, divisions: inst.divisions, seed: seed >>> 0, status: "open", entries: [], brackets: null, awarded: false, members: [] })

// ---------- randomness that every server and phone agrees on ----------
export const hash = (s) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
export const rng = (seed) => {
  let x = seed >>> 0 || 0x9e3779b9
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
}

// ---------- entries ----------
export const membersOf = (doc) => {
  const keys = new Set()
  for (const e of doc.entries || []) for (const k of e.keys) keys.add(k)
  for (const e of doc.entries || []) if (e.partner?.k) keys.add(e.partner.k)
  return [...keys]
}
export const entryOf = (doc, key) => (doc.entries || []).find((e) => e.keys.includes(key) || e.partner?.k === key) || null

// a screen name, a division, a partner (a key or null = a computer partner)
export const canEnter = (doc, key, div, partnerKey, now) => {
  if (doc.status !== "open" || now >= doc.start) return "Sign-ups for this one have closed."
  if (!doc.divisions.includes(div) || !DIVISIONS[div]) return "That division isn't in this tournament."
  if (entryOf(doc, key)) return "You're already signed up for this one."
  if (partnerKey) {
    if (DIVISIONS[div].kind !== "doubles") return "Singles is just you."
    if (partnerKey === key) return "Pick someone else as your partner."
    if (entryOf(doc, partnerKey)) return "Your partner is already signed up for this one."
  }
  if (doc.entries.filter((e) => e.div === div).length >= LIMITS.perDivision) return "That division is full (16 teams)."
  return null
}

// ---------- the draw ----------
// where seeds go in a bracket of n (1 meets n, 2 meets n-1, ..., top seeds apart)
export const seedOrder = (n) => {
  let order = [1]
  while (order.length < n) {
    const m = order.length * 2
    order = order.flatMap((s) => [s, m + 1 - s])
  }
  return order
}
export const bracketSize = (n) => {
  let size = 4
  while (size < n && size < LIMITS.perDivision) size *= 2
  return size
}

const FIRST = ["Marisol", "Dev", "Keiko", "Tomas", "Renee", "Jalen", "Priya", "Walt", "Bea", "Omar", "Lucy", "Hank", "Ines", "Rafa", "Dot", "Mateo", "June", "Ari", "Glen", "Noor", "Pete", "Cass", "Yuki", "Bo"]
const TEAM = ["Kitchen Kings", "Dink Dynasty", "Third Shot Club", "Erne Express", "Soft Hands", "Net Rushers", "Drop Shop", "Baseline Bandits", "Spin Doctors", "The Resets", "Paddle Pals", "Lob City", "Fast Hands", "Two Bounce Crew", "Volley Llamas"]

const cpuTeam = (id, kind, r) => {
  const pick = () => FIRST[Math.floor(r() * FIRST.length)]
  if (kind === "singles") return { id, cpu: true, players: [{ name: pick(), cpu: true }] }
  const a = pick()
  let b = pick()
  if (b === a) b = FIRST[(FIRST.indexOf(a) + 7) % FIRST.length]
  return { id, cpu: true, name: TEAM[Math.floor(r() * TEAM.length)], players: [{ name: a, cpu: true }, { name: b, cpu: true }] }
}

export const teamName = (t) => (!t ? "TBD" : t.cpu && t.name ? t.name : t.players.map((p) => p.name).join(" & "))

const humanTeam = (e, kind, r) => {
  const players = [{ k: e.keys[0], name: e.names[e.keys[0]] || e.keys[0] }]
  if (kind === "doubles") {
    if (e.partner?.k && e.partner.ok) players.push({ k: e.partner.k, name: e.partner.name })
    else players.push({ name: FIRST[Math.floor(r() * FIRST.length)], cpu: true })
  }
  return { id: e.id, cpu: false, players }
}

// the bracket for one division, from its entries in sign-up order
export const draw = (entries, divId, seed) => {
  const div = DIVISIONS[divId]
  const r = rng(seed ^ hash(divId))
  const list = entries.filter((e) => e.div === divId).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)).slice(0, LIMITS.perDivision)
  if (!list.length) return null
  const size = bracketSize(list.length)
  const teams = {}
  const bySeed = []
  for (const e of list) {
    const t = humanTeam(e, div.kind, r)
    teams[t.id] = t
    bySeed.push(t.id)
  }
  for (let i = bySeed.length; i < size; i++) {
    const t = cpuTeam(`c${divId}${i}`, div.kind, r)
    teams[t.id] = t
    bySeed.push(t.id)
  }
  const order = seedOrder(size)
  const rounds = []
  let n = size / 2
  for (let rd = 0; n >= 1; rd++, n /= 2) {
    const row = []
    for (let i = 0; i < n; i++) row.push({ id: `${divId}-r${rd}-m${i}`, r: rd, i, a: rd === 0 ? bySeed[order[2 * i] - 1] : null, b: rd === 0 ? bySeed[order[2 * i + 1] - 1] : null, w: null, score: null, how: null, by: null, room: null, here: { a: false, b: false } })
    rounds.push(row)
  }
  return { size, teams, rounds, champion: null }
}

export const roundDeadline = (doc, r) => doc.start + (r + 1) * ROUND_MS
export const findMatch = (doc, matchId) => {
  for (const b of Object.values(doc.brackets || {})) if (b) for (const row of b.rounds) for (const m of row) if (m.id === matchId) return { bracket: b, match: m }
  return null
}
export const sideOf = (bracket, match, key) => {
  if (bracket.teams[match.a]?.players.some((p) => p.k === key)) return "a"
  if (bracket.teams[match.b]?.players.some((p) => p.k === key)) return "b"
  return null
}

// a final score to 11, win by 2 (or more past 11 only by exactly 2): [a, b]
export const validScore = (s) => {
  if (!Array.isArray(s) || s.length !== 2 || !s.every((n) => Number.isInteger(n) && n >= 0 && n <= 99)) return false
  const [hi, lo] = s[0] > s[1] ? s : [s[1], s[0]]
  if (hi < 11 || hi - lo < 2) return false
  return hi === 11 || hi - lo === 2
}

const simScore = (r) => [11, 3 + Math.floor(r() * 7)]

const decide = (bracket, m, w, score, how, by = null) => {
  m.w = w
  m.score = score
  m.how = how
  m.by = by
  const next = bracket.rounds[m.r + 1]
  if (next) {
    const nm = next[Math.floor(m.i / 2)]
    nm[m.i % 2 === 0 ? "a" : "b"] = w === "a" ? m.a : m.b
  } else bracket.champion = w === "a" ? m.a : m.b
}

// Bring a tournament up to `now`: draw the brackets at the start, play computer-vs-computer
// matches, settle matches whose round ran out (a team that checked in beats one that didn't;
// a team that didn't play its computer opponents loses to them; neither side: drawing lots),
// and finish. Changes doc in place; -> true if anything changed. The same doc and time give
// the same result on any machine.
export const progress = (doc, now) => {
  let changed = false
  if (doc.status === "open" && now >= doc.start) {
    const brackets = {}
    for (const div of doc.divisions) brackets[div] = draw(doc.entries, div, doc.seed)
    doc.brackets = brackets
    doc.status = Object.values(brackets).some(Boolean) ? "live" : "done"
    changed = true
  }
  if (doc.status !== "live") return changed
  let moved = true
  while (moved) {
    moved = false
    for (const [divId, b] of Object.entries(doc.brackets)) {
      if (!b || b.champion) continue
      for (const row of b.rounds) {
        for (const m of row) {
          if (m.w || !m.a || !m.b) continue
          const A = b.teams[m.a]
          const B = b.teams[m.b]
          const r = rng(doc.seed ^ hash(m.id))
          if (A.cpu && B.cpu) {
            const w = r() < 0.5 ? "a" : "b"
            const s = simScore(r)
            decide(b, m, w, w === "a" ? s : [s[1], s[0]], "sim")
            moved = changed = true
          } else if (now >= roundDeadline(doc, m.r)) {
            let w
            let how = "walkover"
            if (A.cpu !== B.cpu) w = A.cpu ? "a" : "b"
            else if (m.here.a !== m.here.b) w = m.here.a ? "a" : "b"
            else {
              w = r() < 0.5 ? "a" : "b"
              how = "lots"
            }
            decide(b, m, w, null, how)
            moved = changed = true
          }
        }
      }
      void divId
    }
  }
  if (Object.values(doc.brackets).every((b) => !b || b.champion)) {
    doc.status = "done"
    changed = true
  }
  return changed
}

// a result from a player in the match -> null or why not
export const report = (doc, matchId, key, score, now) => {
  if (doc.status !== "live") return "This tournament isn't being played right now."
  const f = findMatch(doc, matchId)
  if (!f) return "That match isn't in this tournament."
  const { bracket, match } = f
  if (!match.a || !match.b) return "That match is waiting for the round before."
  if (match.w) return "That match is already decided."
  const side = sideOf(bracket, match, key)
  if (!side) return "You're not in that match."
  if (now >= roundDeadline(doc, match.r)) return "Time ran out for that round."
  if (!validScore(score)) return "A game goes to 11, win by 2."
  decide(bracket, match, score[0] > score[1] ? "a" : "b", [score[0], score[1]], "played", key)
  return null
}

// your next match: { div, bracket, match, side, mine, them, vsCpu, deadline } or null
export const nextMatchFor = (doc, key) => {
  if (doc.status !== "live") return null
  for (const [div, b] of Object.entries(doc.brackets || {})) {
    if (!b) continue
    for (const row of b.rounds) {
      for (const m of row) {
        if (m.w) continue
        const side = m.a && m.b ? sideOf(b, m, key) : null
        if (!side) continue
        const mine = b.teams[side === "a" ? m.a : m.b]
        const them = b.teams[side === "a" ? m.b : m.a]
        return { div, bracket: b, match: m, side, mine, them, vsCpu: !!them.cpu, deadline: roundDeadline(doc, m.r) }
      }
    }
  }
  return null
}

// how you did: { place: 1 | 2 | null, out: round | null }
export const placeOf = (doc, key) => {
  for (const b of Object.values(doc.brackets || {})) {
    if (!b) continue
    const mineId = Object.values(b.teams).find((t) => t.players.some((p) => p.k === key))?.id
    if (!mineId) continue
    const final = b.rounds.at(-1)[0]
    if (b.champion === mineId) return { place: 1, team: mineId }
    if (final.w && (final.a === mineId || final.b === mineId)) return { place: 2, team: mineId }
    return { place: null, team: mineId }
  }
  return null
}

// the trophies a finished tournament gives: [{ k, trophy }]
export const trophiesOf = (doc) => {
  const out = []
  if (doc.status !== "done") return out
  for (const [div, b] of Object.entries(doc.brackets || {})) {
    if (!b?.champion) continue
    const final = b.rounds.at(-1)[0]
    const runner = final.w === "a" ? final.b : final.a
    for (const [teamId, place] of [
      [b.champion, 1],
      [runner, 2],
    ]) {
      for (const p of b.teams[teamId]?.players || []) {
        if (!p.k) continue
        out.push({ k: p.k, trophy: { id: `${doc.id}-${div}`, name: doc.name, venue: doc.venue, div: DIVISIONS[div]?.name || div, place, at: doc.start, score: final.score, partner: (b.teams[teamId].players.find((q) => q !== p) || {}).name || null } })
      }
    }
  }
  return out
}

// Delete My Account: before the start their entries go (a partner's spot becomes a computer
// partner); after, they become "Deleted player" in the bracket (others' results stay)
export const eraseFrom = (doc, key, anon) => {
  if (doc.status === "open") {
    doc.entries = doc.entries
      .filter((e) => e.keys[0] !== key)
      .map((e) => (e.partner?.k === key ? { ...e, keys: e.keys.filter((k) => k !== key), partner: null, names: Object.fromEntries(Object.entries(e.names).filter(([k]) => k !== key)) } : e))
  } else {
    for (const e of doc.entries) {
      if (!e.keys.includes(key) && e.partner?.k !== key) continue
      e.keys = e.keys.map((k) => (k === key ? anon : k))
      if (e.names[key]) {
        e.names[anon] = "Deleted player"
        delete e.names[key]
      }
      if (e.partner?.k === key) e.partner = { k: anon, name: "Deleted player", ok: e.partner.ok }
    }
    for (const b of Object.values(doc.brackets || {})) {
      if (!b) continue
      for (const t of Object.values(b.teams)) for (const p of t.players) if (p.k === key) Object.assign(p, { k: anon, name: "Deleted player" })
      for (const row of b.rounds) for (const m of row) if (m.by === key) m.by = anon
    }
  }
  doc.members = membersOf(doc)
  return doc
}

// "Sat Oct 10, 10:00 AM" in the venues' time zone
export const whenText = (t) => new Date(t).toLocaleString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
