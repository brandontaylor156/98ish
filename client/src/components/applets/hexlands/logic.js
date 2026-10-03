// Hexlands' building blocks shared by the rules (rules.js), the computer players (bot.js)
// and the board on screen: what things cost, the settings, and questions about a game
// ("where may Red build a road?", "how long is Blue's road?"). Every function here works
// on the full game state and on a player's view of it (rules.js view()) alike.

import { RES, PIPS, TERRAIN_RES, geometry, geoFor } from "./board.js"

export { RES, PIPS, TERRAIN_RES }

export const COSTS = {
  road: { timber: 1, clay: 1 },
  settlement: { timber: 1, clay: 1, wool: 1, grain: 1 },
  city: { grain: 2, ore: 3 },
  dev: { wool: 1, grain: 1, ore: 1 },
}
export const PIECES = { road: 15, settlement: 5, city: 4 }

export const RES_INFO = {
  timber: { label: "Timber", color: "#2f7a3a", from: "Forest" },
  clay: { label: "Clay", color: "#c0582c", from: "Hills" },
  wool: { label: "Wool", color: "#9fd06a", from: "Pasture" },
  grain: { label: "Grain", color: "#e8c13a", from: "Fields" },
  ore: { label: "Ore", color: "#8a93a3", from: "Mountains" },
}

// development cards (original names)
export const DEV = {
  ranger: { label: "Ranger", text: "Chase the Bandit off to another tile and take a card from someone there. Play 3 to win Largest Patrol." },
  roads: { label: "Trailblazers", text: "Build 2 roads for free, right now." },
  plenty: { label: "Bumper Crop", text: "Take any 2 resource cards from the bank." },
  monopoly: { label: "Market Corner", text: "Name a resource. Every other player hands you all of theirs." },
  monument: { label: "Monument", text: "Worth 1 victory point. It stays secret until it wins you the game." },
}
export const DEV_TYPES = ["ranger", "roads", "plenty", "monopoly", "monument"]
// the base deck (and the bigger deck for the 5-6 player island)
export const DECKS = {
  std: { ranger: 14, roads: 2, plenty: 2, monopoly: 2, monument: 5 },
  ext: { ranger: 20, roads: 3, plenty: 3, monopoly: 3, monument: 5 },
}
export const BANK = { std: 19, ext: 24 }

export const COLORS = [
  { id: "red", label: "Red", fill: "#d23b2f", dark: "#7c1a14", text: "#fff" },
  { id: "blue", label: "Blue", fill: "#2f67cf", dark: "#13306b", text: "#fff" },
  { id: "orange", label: "Orange", fill: "#ee8a1d", dark: "#86450a", text: "#1d1206" },
  { id: "cream", label: "White", fill: "#f4eedc", dark: "#6d6656", text: "#1d1a12" },
  { id: "green", label: "Green", fill: "#2f9a4a", dark: "#134a22", text: "#fff" },
  { id: "purple", label: "Purple", fill: "#8150c6", dark: "#3b1d63", text: "#fff" },
]

// ---------- settings ----------

export const TIMERS = [0, 45, 60, 90, 120, 180]
export const LAYOUTS = ["balanced", "random", "beginner"]
export const LEVELS = ["easy", "normal", "hard"]
export const DEFAULTS = {
  players: 4, // 2-6 (5-6 play on the bigger island)
  target: 10, // victory points to win, 8-14
  layout: "balanced", // balanced | random | beginner
  friendly: false, // the Bandit leaves players with 2 points or fewer alone
  timer: 0, // seconds per turn, 0 = no clock
  discard: 7, // more cards than this when a 7 is rolled: discard half
  botTrade: true, // computer players trade with people (and each other)
  level: "normal", // computer players: easy | normal | hard
  special: true, // 5-6 players: everyone may build between turns
  deck: null, // null: the base game's deck; else { ranger, roads, plenty, monopoly, monument }
}

const pick = (v, list, fallback) => (list.includes(v) ? v : fallback)
const int = (v, lo, hi, fallback) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback
}

// cleaned settings, or { error }
export const validateSettings = (raw = {}) => {
  const s = raw && typeof raw === "object" ? raw : {}
  const out = {
    players: int(s.players, 2, 6, DEFAULTS.players),
    target: int(s.target, 8, 14, DEFAULTS.target),
    layout: pick(s.layout, LAYOUTS, DEFAULTS.layout),
    friendly: !!s.friendly,
    timer: pick(Number(s.timer), TIMERS, DEFAULTS.timer),
    discard: int(s.discard, 5, 12, DEFAULTS.discard),
    botTrade: s.botTrade !== false,
    level: pick(s.level, LEVELS, DEFAULTS.level),
    special: s.special !== false,
    deck: null,
  }
  if (s.deck && typeof s.deck === "object") {
    const deck = Object.fromEntries(DEV_TYPES.map((t) => [t, int(s.deck[t], 0, 25, 0)]))
    if (DEV_TYPES.reduce((n, t) => n + deck[t], 0) < 1) return { error: "The development deck needs at least one card." }
    const base = DECKS[geoFor(out.players)]
    if (DEV_TYPES.some((t) => deck[t] !== base[t])) out.deck = deck
  }
  return out
}
export const seats = (s) => validateSettings(s).players
export const deckFor = (settings) => settings.deck || DECKS[geoFor(settings.players)]

// "4 players, 10 points, balanced map, 90s turns"
export const describeSettings = (s) =>
  [`${s.players} players`, `${s.target} points`, `${s.layout} map`, s.timer ? `${s.timer}s turns` : null, s.friendly ? "friendly Bandit" : null, s.discard !== 7 ? `discard over ${s.discard}` : null, s.deck ? "custom deck" : null].filter(Boolean).join(", ")

// ---------- cards ----------

export const total = (hand) => (hand ? RES.reduce((n, r) => n + (hand[r] || 0), 0) : 0)
export const emptyHand = () => ({ timber: 0, clay: 0, wool: 0, grain: 0, ore: 0 })
export const hasAll = (hand, cost) => !!hand && Object.entries(cost).every(([r, n]) => (hand[r] || 0) >= n)
// a clean { res: n } with positive whole numbers, or null if it isn't one
export const cleanCards = (cards, { allowEmpty = false } = {}) => {
  if (!cards || typeof cards !== "object") return null
  const out = {}
  for (const [r, n] of Object.entries(cards)) {
    if (!RES.includes(r)) return null
    if (n === 0 || n == null) continue
    if (!Number.isInteger(n) || n < 0 || n > 99) return null
    out[r] = n
  }
  return allowEmpty || Object.keys(out).length ? out : null
}
export const missing = (hand, cost) => {
  const out = {}
  for (const [r, n] of Object.entries(cost)) if ((hand?.[r] || 0) < n) out[r] = n - (hand?.[r] || 0)
  return out
}
export const cardsText = (cards) =>
  Object.entries(cards || {})
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n} ${RES_INFO[r].label.toLowerCase()}`)
    .join(", ") || "nothing"

// ---------- the board ----------

export const geo = (s) => geometry(s.geo)

// what a corner is next to: [{ tile, res, number, pips }]
export const vertexTiles = (s, v) =>
  geo(s).vertices[v].tiles.map((t) => {
    const tile = s.tiles[t]
    return { tile: t, res: TERRAIN_RES[tile.t], number: tile.n, pips: PIPS[tile.n] || 0 }
  })

// the harbor at a corner: "any" | resource | null
export const harborAt = (s, v) => {
  const g = geo(s)
  for (const h of s.harbors) {
    const e = g.edges[h.e]
    if (e.a === v || e.b === v) return h.r
  }
  return null
}

// a player's bank trade ratio for each resource (4:1, 3:1 with any harbor, 2:1 with its own)
export const ratios = (s, p) => {
  const out = { timber: 4, clay: 4, wool: 4, grain: 4, ore: 4 }
  const g = geo(s)
  for (const h of s.harbors) {
    const e = g.edges[h.e]
    if (s.verts[e.a]?.p !== p && s.verts[e.b]?.p !== p) continue
    if (h.r === "any") RES.forEach((r) => (out[r] = Math.min(out[r], 3)))
    else out[h.r] = 2
  }
  return out
}

// the distance rule: no building on this corner or the ones next to it
export const roomFor = (s, v) => !s.verts[v] && geo(s).vertices[v].adj.every((a) => !s.verts[a])

const touchesOwnRoad = (s, p, v) => geo(s).vertices[v].edges.some((e) => s.edges[e] === p)

// corners where player p may build a settlement (setup: anywhere with room)
export const legalSettlements = (s, p, setup = false) => {
  const out = []
  const n = geo(s).vertices.length
  for (let v = 0; v < n; v++) if (roomFor(s, v) && (setup || touchesOwnRoad(s, p, v))) out.push(v)
  return out
}

// edges where player p may build a road: next to their building, or their road (unless an
// opponent's building sits on the corner in between). from: in setup, only next to this corner
export const legalRoads = (s, p, from = null) => {
  const g = geo(s)
  const out = []
  g.edges.forEach((e, i) => {
    if (s.edges[i] != null) return
    if (from != null) {
      if (e.a === from || e.b === from) out.push(i)
      return
    }
    const ok = [e.a, e.b].some((v) => {
      const b = s.verts[v]
      if (b) return b.p === p
      return g.vertices[v].edges.some((o) => o !== i && s.edges[o] === p)
    })
    if (ok) out.push(i)
  })
  return out
}

export const legalCities = (s, p) => s.verts.map((b, v) => (b && b.p === p && b.k === "s" ? v : -1)).filter((v) => v >= 0)

// ---------- longest road ----------

// The longest unbroken trail of player p's roads (no road counted twice). An opponent's
// building on a corner breaks the trail there.
export const roadLength = (s, p) => {
  const g = geo(s)
  const mine = []
  s.edges.forEach((o, i) => o === p && mine.push(i))
  if (!mine.length) return 0
  const used = new Set()
  const blocked = (v) => s.verts[v] && s.verts[v].p !== p
  let best = 0
  const walk = (v, len) => {
    if (len > best) best = len
    if (blocked(v)) return
    for (const e of g.vertices[v].edges) {
      if (s.edges[e] !== p || used.has(e)) continue
      used.add(e)
      const edge = g.edges[e]
      walk(edge.a === v ? edge.b : edge.a, len + 1)
      used.delete(e)
    }
  }
  const starts = new Set()
  mine.forEach((e) => {
    starts.add(g.edges[e].a)
    starts.add(g.edges[e].b)
  })
  for (const v of starts) {
    // starting on an opponent's building: only the edges leaving it, one at a time
    if (blocked(v)) {
      for (const e of g.vertices[v].edges) {
        if (s.edges[e] !== p) continue
        used.add(e)
        const edge = g.edges[e]
        walk(edge.a === v ? edge.b : edge.a, 1)
        used.delete(e)
      }
    } else walk(v, 0)
    if (best === mine.length) break
  }
  return best
}

// Who holds Longest Road now. The holder keeps it on a tie; if their road is broken and
// others tie for the lead, nobody holds it until someone pulls ahead. Needs 5 roads.
export const longestHolder = (lengths, holder) => {
  const top = Math.max(...lengths)
  if (holder != null && lengths[holder] >= 5 && lengths[holder] === top) return holder
  if (top < 5) return null
  const leaders = lengths.map((l, i) => (l === top ? i : -1)).filter((i) => i >= 0)
  return leaders.length === 1 ? leaders[0] : null
}

// Largest Patrol: 3+ Rangers played, and more than the holder
export const armyHolder = (rangers, holder) => {
  let h = holder
  rangers.forEach((n, i) => {
    if (n >= 3 && (h == null || n > rangers[h])) h = i
  })
  return h
}

// ---------- points ----------

// the points everyone can see (not secret Monuments)
export const publicPoints = (s, p) => {
  let vp = 0
  for (const b of s.verts) if (b && b.p === p) vp += b.k === "c" ? 2 : 1
  if (s.longest === p) vp += 2
  if (s.army === p) vp += 2
  return vp
}

// the Bandit's tile choices for player p (it must move; a friendly Bandit avoids anyone
// with 2 points or fewer, unless that leaves nowhere to go)
export const protectedPlayers = (s, p) => (s.settings.friendly ? s.players.map((_, i) => i).filter((i) => i !== p && publicPoints(s, i) <= 2) : [])
export const banditTiles = (s, p) => {
  const g = geo(s)
  const safe = protectedPlayers(s, p)
  const all = g.tiles.map((_, i) => i).filter((i) => i !== s.bandit)
  if (!safe.length) return all
  const ok = all.filter((t) => !g.tiles[t].corners.some((v) => s.verts[v] && safe.includes(s.verts[v].p)))
  return ok.length ? ok : all
}
// who player p could take a card from with the Bandit on this tile (cards: a count per player)
export const victimsAt = (s, tile, p, cardsOf) => {
  const safe = protectedPlayers(s, p)
  const out = new Set()
  for (const v of geo(s).tiles[tile].corners) {
    const b = s.verts[v]
    if (b && b.p !== p && !safe.includes(b.p) && cardsOf(b.p) > 0) out.add(b.p)
  }
  return [...out]
}

// production dots on a corner, by resource
export const vertexPips = (s, v, skipBandit = false) => {
  const out = {}
  for (const t of vertexTiles(s, v)) {
    if (!t.res || (skipBandit && t.tile === s.bandit)) continue
    out[t.res] = (out[t.res] || 0) + t.pips
  }
  return out
}
