// Hexlands' computer players. They see only what a person in their seat would (rules.js
// hands them their own view), and choose one move at a time:
//   setup: corners with big numbers and a spread of resources (the second one fills gaps),
//          roads pointing at the next good corner
//   turns: cities on their best settlements, settlements on the best corners they can
//          reach, roads toward those (or for Longest Road), development cards with what's
//          left; bank, harbor and player trades when a card or two short of a build
//   the Bandit: on the leader's best tile, never their own; taking from the leader
//   trades from others: yes when it helps them and the offerer isn't about to win
// Personalities tilt those choices; the level (easy, normal, hard) decides how carefully.

import * as L from "./logic.js"
import { geometry } from "./board.js"

const { RES, COSTS } = L

export const PERSONAS = {
  steady: { label: "the Settler", text: "Spreads out and builds steadily.", city: 1, settlement: 1.1, road: 1, dev: 1.25, trade: 1 },
  builder: { label: "the Builder", text: "Loves ore, grain and big cities.", city: 1.35, settlement: 0.95, road: 0.85, dev: 1.15, trade: 1 },
  roads: { label: "the Trailblazer", text: "Races everyone for Longest Road.", city: 0.95, settlement: 1.05, road: 1.4, dev: 1.05, trade: 1 },
  trader: { label: "the Merchant", text: "Will trade with anyone, for nearly anything.", city: 1, settlement: 1, road: 1, dev: 1.2, trade: 1.6 },
  schemer: { label: "the Schemer", text: "Buys development cards and sends Rangers after the leader.", city: 0.95, settlement: 0.95, road: 0.9, dev: 1.5, trade: 0.9 },
}
const PERSONA_IDS = Object.keys(PERSONAS)

// the same name always gets the same personality ("Ada (computer)" too)
export const personaFor = (name = "") => {
  const base = String(name).replace(/\s*\(computer\)$/, "")
  let h = 7
  for (const ch of base) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PERSONA_IDS[h % PERSONA_IDS.length]
}

const NOISE = { easy: 0.9, normal: 0.25, hard: 0.04 }

// ---------- what things are worth ----------

const production = (v, p) => {
  const out = { timber: 0, clay: 0, wool: 0, grain: 0, ore: 0 }
  v.verts.forEach((b, i) => {
    if (!b || b.p !== p) return
    const pips = L.vertexPips(v, i, true)
    for (const [r, n] of Object.entries(pips)) out[r] += n * (b.k === "c" ? 2 : 1)
  })
  return out
}

// how good a corner is to settle for player p
const spotValue = (v, p, vx, { setup = false, prod = null } = {}) => {
  const pips = L.vertexPips(v, vx)
  const mine = prod || production(v, p)
  let value = 0
  for (const [r, n] of Object.entries(pips)) {
    let w = 1
    if (setup && (r === "timber" || r === "clay")) w += 0.12
    if (!setup && (r === "ore" || r === "grain")) w += 0.1
    if (mine[r] === 0) w += 0.45 // something new
    else if (mine[r] >= 8) w -= 0.25
    value += n * w
  }
  value += Object.keys(pips).length * 1.1
  const harbor = L.harborAt(v, vx)
  if (harbor === "any") value += 1.4
  else if (harbor) value += 0.6 + (mine[harbor] + (pips[harbor] || 0)) * 0.25
  // the Bandit sits there now
  if (geometry(v.geo).vertices[vx].tiles.includes(v.bandit)) value -= 1
  return value
}

const jitter = (random, level) => 1 + (random() - 0.5) * 2 * (NOISE[level] ?? 0.25)
const best = (list, score) => {
  let top = null
  let topScore = -Infinity
  for (const x of list) {
    const s = score(x)
    if (s > topScore) [top, topScore] = [x, s]
  }
  return top
}

// how much each card is worth to p right now (needed for the next build: more)
const cardValues = (v, p, goalCost) => {
  const hand = v.players[p].hand
  const prod = production(v, p)
  const out = {}
  for (const r of RES) {
    let w = 1
    const need = goalCost?.[r] || 0
    if (need > hand[r]) w += 1.3
    else if (hand[r] - need >= 2) w -= 0.45
    if (prod[r] === 0) w += 0.35
    else if (prod[r] >= 9) w -= 0.2
    out[r] = Math.max(0.15, w)
  }
  return out
}
const worth = (cards, values) => Object.entries(cards).reduce((n, [r, k]) => n + values[r] * k, 0)

// ---------- plans ----------

// the corners p could settle after building roads: [{ vx, dist, first }] (first: the road
// to build now), up to 3 roads away
const reachableSpots = (v, p) => {
  const g = geometry(v.geo)
  const dist = new Map()
  const first = new Map()
  const queue = []
  const blocked = (vx) => v.verts[vx] && v.verts[vx].p !== p
  g.vertices.forEach((vert, i) => {
    if (blocked(i)) return
    if (v.verts[i]?.p === p || vert.edges.some((e) => v.edges[e] === p)) {
      dist.set(i, 0)
      queue.push(i)
    }
  })
  while (queue.length) {
    const cur = queue.shift()
    const d = dist.get(cur)
    if (d >= 3) continue
    for (const e of g.vertices[cur].edges) {
      if (v.edges[e] != null) continue
      const edge = g.edges[e]
      const nx = edge.a === cur ? edge.b : edge.a
      if (dist.has(nx) || blocked(nx)) continue
      dist.set(nx, d + 1)
      first.set(nx, d === 0 ? e : first.get(cur))
      queue.push(nx)
    }
  }
  const out = []
  for (const [vx, d] of dist) if (d > 0 && L.roomFor(v, vx)) out.push({ vx, dist: d, first: first.get(vx) })
  return out
}

const roadTowardSpot = (v, p, prod) => {
  const spots = reachableSpots(v, p)
  if (!spots.length) return null
  const top = best(spots, (s) => spotValue(v, p, s.vx, { prod }) / (1 + s.dist * 0.55))
  return top ? { edge: top.first, value: spotValue(v, p, top.vx, { prod }), dist: top.dist } : null
}

// the road that makes p's longest road longest
const longestRoadMove = (v, p) => {
  const legal = L.legalRoads(v, p)
  if (!legal.length) return null
  const now = v.players[p].road
  let top = null
  let len = now
  for (const e of legal) {
    const edges = [...v.edges]
    edges[e] = p
    const l = L.roadLength({ ...v, edges }, p)
    if (l > len) [top, len] = [e, l]
  }
  return top == null ? null : { edge: top, gain: len - now, len }
}

const pointsOf = (v, p) => v.players[p].points
const leader = (v, me) => best(v.players.map((_, i) => i).filter((i) => i !== me), (i) => pointsOf(v, i) * 10 + v.players[i].cards * 0.1 + v.players[i].devCount * 0.3)

// ---------- choices ----------

const setupMove = (v, me, opts) => {
  const g = geometry(v.geo)
  if (v.setupVertex == null) {
    const prod = production(v, me)
    const spots = L.legalSettlements(v, me, true)
    const vx = best(spots, (x) => spotValue(v, me, x, { setup: true, prod }) * jitter(opts.random, opts.level))
    return { type: "build", what: "settlement", at: vx }
  }
  // the road toward the best corner two steps away
  const roads = L.legalRoads(v, me, v.setupVertex)
  const prod = production(v, me)
  const e = best(roads, (e) => {
    const edge = g.edges[e]
    const far = edge.a === v.setupVertex ? edge.b : edge.a
    const next = g.vertices[far].adj.filter((x) => x !== v.setupVertex && L.roomFor(v, x))
    const top = next.length ? Math.max(...next.map((x) => spotValue(v, me, x, { prod }))) : 0
    return (top + g.vertices[far].tiles.length * 0.4) * jitter(opts.random, opts.level)
  })
  return { type: "build", what: "road", at: e }
}

const playable = (v, me, card) => !v.devPlayed && v.players[me].dev?.some((d) => d.t === card && !d.fresh)

const myTileUnderBandit = (v, me) => {
  const g = geometry(v.geo)
  const tile = v.tiles[v.bandit]
  if (!tile.n) return 0
  let hurt = 0
  for (const vx of g.tiles[v.bandit].corners) {
    const b = v.verts[vx]
    if (b?.p === me) hurt += L.PIPS[tile.n] * (b.k === "c" ? 2 : 1)
  }
  return hurt
}

const shouldRanger = (v, me, opts) => {
  if (!playable(v, me, "ranger")) return false
  if (myTileUnderBandit(v, me) >= 3) return true
  const mine = v.players[me].rangers + 1
  const holder = v.army
  if (holder !== me && mine >= 3 && (holder == null || mine > v.players[holder].rangers)) return true
  // the Schemer harasses the leader
  if (opts.persona === "schemer" && opts.random() < 0.5) return true
  return opts.level === "hard" && pointsOf(v, leader(v, me)) >= v.settings.target - 3
}

const banditMove = (v, me, opts) => {
  const g = geometry(v.geo)
  const lead = leader(v, me)
  const tiles = L.banditTiles(v, me)
  const score = (t) => {
    const tile = v.tiles[t]
    const pips = L.PIPS[tile.n] || 0
    let s = 0
    for (const vx of g.tiles[t].corners) {
      const b = v.verts[vx]
      if (!b) continue
      const mult = b.k === "c" ? 2 : 1
      if (b.p === me) s -= pips * mult * 3
      else s += pips * mult * (1 + pointsOf(v, b.p) / v.settings.target) * (b.p === lead ? 1.6 : 1)
    }
    const victims = L.victimsAt(v, t, me, (p) => v.players[p].cards)
    if (victims.length) s += 1.5 + Math.max(...victims.map((p) => v.players[p].cards)) * 0.2
    if (!tile.n) s -= 2
    return s * jitter(opts.random, opts.level)
  }
  const tile = best(tiles, score)
  const victims = L.victimsAt(v, tile, me, (p) => v.players[p].cards)
  const victim = victims.length ? best(victims, (p) => pointsOf(v, p) * 3 + v.players[p].cards) : null
  return { type: "bandit", tile, victim }
}

const discardMove = (v, me, opts) => {
  const need = v.discards[me]
  const hand = { ...v.players[me].hand }
  const goal = pickGoal(v, me, opts)
  const keep = goal ? { ...COSTS[goal.what] } : {}
  const cards = {}
  for (let i = 0; i < need; i++) {
    const r = best(
      RES.filter((r) => hand[r] > 0),
      (r) => hand[r] - (keep[r] || 0) * 1.5 + opts.random() * 0.1
    )
    hand[r]--
    cards[r] = (cards[r] || 0) + 1
  }
  return { type: "discard", cards }
}

// what to save for next: [city | settlement | road | dev] by value per missing card
const pickGoal = (v, me, opts) => {
  const P = PERSONAS[opts.persona] || PERSONAS.steady
  const pl = v.players[me]
  const hand = pl.hand
  const options = []
  const cities = L.legalCities(v, me)
  if (pl.pieces.city > 0 && cities.length) options.push({ what: "city", value: 3.2 * P.city })
  const spots = L.legalSettlements(v, me)
  if (pl.pieces.settlement > 0 && spots.length) options.push({ what: "settlement", value: 3.4 * P.settlement })
  if (pl.pieces.settlement > 0 && !spots.length && pl.pieces.road > 0 && roadTowardSpot(v, me)) options.push({ what: "road", value: 1.8 * P.road })
  if (v.deck > 0) options.push({ what: "dev", value: 1.6 * P.dev })
  if (!options.length) return null
  return best(options, (o) => o.value / (1 + L.total(L.missing(hand, COSTS[o.what])) * 0.8))
}

// a bank or harbor trade that gets one missing card for the goal, if spare cards allow
const bankMove = (v, me, goalCost) => {
  const hand = v.players[me].hand
  const want = L.missing(hand, goalCost)
  const ratios = L.ratios(v, me)
  for (const r of Object.keys(want)) {
    if (v.bank[r] < 1) continue
    const give = best(
      RES.filter((g) => g !== r && hand[g] - (goalCost[g] || 0) >= ratios[g]),
      (g) => hand[g] - (goalCost[g] || 0) - ratios[g]
    )
    if (give) return { type: "bank", give, get: r, count: 1 }
  }
  return null
}

const spare = (hand, goalCost) => RES.filter((r) => hand[r] - (goalCost[r] || 0) >= 1).sort((a, b) => hand[b] - (goalCost[b] || 0) - (hand[a] - (goalCost[a] || 0)))

const mainMove = (v, me, opts) => {
  const P = PERSONAS[opts.persona] || PERSONAS.steady
  const pl = v.players[me]
  const hand = pl.hand
  const target = v.settings.target

  // our own offer: take the best answer, or give up on it
  if (v.trade && v.trade.from === me) {
    const t = v.trade
    const values = cardValues(v, me, pickGoal(v, me, opts) ? COSTS[pickGoal(v, me, opts).what] : null)
    const answers = Object.entries(t.replies).map(([p, r]) => ({ p: Number(p), ...r }))
    const yes = answers.filter((r) => r.a === "accept" && L.hasAll(hand, t.give))
    if (yes.length) return { type: "confirm", id: t.id, with: best(yes, (r) => -pointsOf(v, r.p)).p }
    const counters = answers.filter((r) => r.a === "counter" && L.hasAll(hand, r.give) && worth(r.get, values) - worth(r.give, values) > -0.2)
    if (counters.length) return { type: "confirm", id: t.id, with: counters[0].p }
    if (t.to.every((p) => t.replies[p])) return { type: "cancel", id: t.id }
    return null
  }
  if ((v.acts || 0) > 70) return { type: "end" }

  // cards worth playing now
  if (!v.devPlayed) {
    if (shouldRanger(v, me, opts)) return { type: "play", card: "ranger" }
    if (playable(v, me, "roads") && pl.pieces.road >= 1) {
      const toward = roadTowardSpot(v, me)
      const race = longestRoadMove(v, me)
      if ((toward && toward.dist <= 2) || (race && race.len >= 4)) return { type: "play", card: "roads" }
    }
    const goal = pickGoal(v, me, opts)
    if (playable(v, me, "plenty") && goal) {
      const miss = L.missing(hand, COSTS[goal.what])
      const list = Object.entries(miss).flatMap(([r, n]) => Array(n).fill(r))
      if (list.length >= 1 && list.length <= 2) {
        const res = list.length === 2 ? list : [list[0], best(RES, (r) => -hand[r] - (r === list[0] ? 1 : 0))]
        const want = {}
        res.forEach((r) => (want[r] = (want[r] || 0) + 1))
        if (L.hasAll(v.bank, want)) return { type: "play", card: "plenty", res }
      }
    }
    if (playable(v, me, "monopoly")) {
      // the resource the others make most of, if they hold plenty of cards
      const theirs = { timber: 0, clay: 0, wool: 0, grain: 0, ore: 0 }
      v.players.forEach((_, i) => {
        if (i === me) return
        const prod = production(v, i)
        RES.forEach((r) => (theirs[r] += prod[r]))
      })
      const held = v.players.reduce((n, x, i) => n + (i === me ? 0 : x.cards), 0)
      const need = goal ? L.missing(hand, COSTS[goal.what]) : {}
      const r = best(RES, (r) => theirs[r] * (need[r] ? 1.6 : 1))
      if (held >= 4 * (v.players.length - 1) || (held >= 8 && need[r])) return { type: "play", card: "monopoly", res: r }
    }
  }

  // build what we can, best first
  const cities = pl.pieces.city > 0 ? L.legalCities(v, me) : []
  if (cities.length && L.hasAll(hand, COSTS.city)) {
    const vx = best(cities, (x) => Object.values(L.vertexPips(v, x, true)).reduce((a, b) => a + b, 0))
    return { type: "build", what: "city", at: vx }
  }
  const spots = pl.pieces.settlement > 0 ? L.legalSettlements(v, me) : []
  if (spots.length && L.hasAll(hand, COSTS.settlement)) {
    const prod = production(v, me)
    return { type: "build", what: "settlement", at: best(spots, (x) => spotValue(v, me, x, { prod }) * jitter(opts.random, opts.level)) }
  }
  const goal = pickGoal(v, me, opts)
  const goalCost = goal ? COSTS[goal.what] : {}

  if (pl.pieces.road > 0 && L.hasAll(hand, COSTS.road)) {
    // roads to reach a new corner (when there's nowhere to settle yet), or for Longest Road
    const toward = !spots.length && pl.pieces.settlement > 0 ? roadTowardSpot(v, me) : null
    const savingForSettlement = goal?.what === "settlement" && L.total(L.missing(hand, COSTS.settlement)) <= 1 && spots.length
    if (toward && !savingForSettlement) return { type: "build", what: "road", at: toward.edge }
    const race = longestRoadMove(v, me)
    const holder = v.longest
    const theirs = holder != null && holder !== me ? v.players[holder].road : 4
    const want = race && (P.road > 1.2 || opts.level === "hard") ? race.len >= theirs - 1 && race.len >= 3 : race && race.len > theirs && race.len >= 5
    if (want && !savingForSettlement && !(goal?.what === "city" && hand.ore >= 2)) return { type: "build", what: "road", at: race.edge }
  }

  if (v.deck > 0 && L.hasAll(hand, COSTS.dev)) {
    // buy a card unless it eats into a city we're close to
    const cityClose = cities.length && L.total(L.missing(hand, COSTS.city)) <= 1
    const settleClose = spots.length && L.total(L.missing(hand, COSTS.settlement)) <= 1
    if ((!cityClose && !settleClose) || goal?.what === "dev" || L.total(hand) > v.settings.discard) return { type: "buy" }
  }

  // a card or two short: trade for it
  if (goal) {
    const short = L.total(L.missing(hand, goalCost))
    if (short >= 1 && short <= 2) {
      const bank = bankMove(v, me, goalCost)
      if (bank) return bank
      // one offer, then (if that fails) a sweeter one: two cards for the one we need
      const maxOffers = opts.level === "easy" ? 1 : 2
      if (v.settings.botTrade && (v.offers || 0) < maxOffers && !v.trade) {
        const want = Object.keys(L.missing(hand, goalCost))[0]
        const give = spare(hand, goalCost)[0]
        const giveN = (v.offers || 0) >= 1 ? 2 : 1
        if (want && give && hand[give] - (goalCost[give] || 0) >= giveN && (giveN === 1 || P.trade >= 1 || opts.level === "hard")) {
          const to = v.players.map((_, i) => i).filter((i) => i !== me && pointsOf(v, i) < target - 1)
          if (to.length) return { type: "offer", give: { [give]: giveN }, get: { [want]: 1 }, to }
        }
      }
    }
  }
  // too many cards for a 7: turn some into something
  if (L.total(hand) > v.settings.discard) {
    const ratios = L.ratios(v, me)
    const give = best(RES.filter((r) => hand[r] >= ratios[r] + (goalCost[r] || 0)), (r) => hand[r])
    const get = give && best(RES.filter((r) => r !== give && v.bank[r] > 0), (r) => (goalCost[r] || 0) - hand[r])
    if (give && get) return { type: "bank", give, get, count: 1 }
  }
  return { type: "end" }
}

// someone else's trade offer to us
const replyMove = (v, me, opts) => {
  const t = v.trade
  if (!t || t.from === me || !t.to.includes(me) || t.replies[me]) return null
  if (!v.settings.botTrade) return { type: "reply", id: t.id, answer: "decline" }
  const hand = v.players[me].hand
  // we'd give t.get and receive t.give
  if (!L.hasAll(hand, t.get)) return { type: "reply", id: t.id, answer: "decline" }
  const P = PERSONAS[opts.persona] || PERSONAS.steady
  const target = v.settings.target
  const close = pointsOf(v, t.from) >= target - 2
  if (close && opts.level !== "easy") return { type: "reply", id: t.id, answer: "decline" }
  const goal = pickGoal(v, me, opts)
  const values = cardValues(v, me, goal ? COSTS[goal.what] : null)
  const gain = worth(t.give, values) - worth(t.get, values)
  const bar = (opts.level === "hard" ? 0.35 : opts.level === "easy" ? -0.4 : 0.1) - (P.trade - 1) * 0.6 + (pointsOf(v, t.from) >= target - 3 ? 0.5 : 0)
  return { type: "reply", id: t.id, answer: gain > bar ? "accept" : "decline" }
}

const freeRoadMove = (v, me, opts) => {
  const legal = L.legalRoads(v, me)
  if (!legal.length || v.players[me].pieces.road < 1) return { type: "done" }
  const toward = roadTowardSpot(v, me)
  if (toward && legal.includes(toward.edge)) return { type: "build", what: "road", at: toward.edge }
  const race = longestRoadMove(v, me)
  if (race) return { type: "build", what: "road", at: race.edge }
  return { type: "build", what: "road", at: legal[Math.floor(opts.random() * legal.length)] }
}

const specialMove = (v, me, opts) => {
  const pl = v.players[me]
  const hand = pl.hand
  const cities = pl.pieces.city > 0 ? L.legalCities(v, me) : []
  if (cities.length && L.hasAll(hand, COSTS.city)) return { type: "build", what: "city", at: best(cities, (x) => Object.values(L.vertexPips(v, x, true)).reduce((a, b) => a + b, 0)) }
  const spots = pl.pieces.settlement > 0 ? L.legalSettlements(v, me) : []
  if (spots.length && L.hasAll(hand, COSTS.settlement)) {
    const prod = production(v, me)
    return { type: "build", what: "settlement", at: best(spots, (x) => spotValue(v, me, x, { prod })) }
  }
  if (!spots.length && pl.pieces.road > 0 && L.hasAll(hand, COSTS.road) && pl.pieces.settlement > 0) {
    const toward = roadTowardSpot(v, me)
    if (toward) return { type: "build", what: "road", at: toward.edge }
  }
  if (v.deck > 0 && L.hasAll(hand, COSTS.dev) && L.total(hand) > v.settings.discard - 2) return { type: "buy" }
  return { type: "end" }
}

// The computer player's next move in view v (its own view of the game), or null if it's
// waiting on someone else. opts: { random, level, persona, hurry }
export const chooseAction = (v, me, opts = {}) => {
  const o = { random: Math.random, level: "normal", persona: "steady", ...opts }
  if (!v || v.phase === "over" || me == null) return null
  switch (v.phase) {
    case "setup":
      return v.turn === me ? setupMove(v, me, o) : null
    case "roll":
      if (v.turn !== me) return null
      return shouldRanger(v, me, { ...o, persona: "steady" }) && myTileUnderBandit(v, me) >= 3 ? { type: "play", card: "ranger" } : { type: "roll" }
    case "discard":
      return v.discards[me] ? discardMove(v, me, o) : null
    case "bandit":
      return v.turn === me ? banditMove(v, me, o) : null
    case "roads":
      return v.turn === me ? freeRoadMove(v, me, o) : null
    case "special":
      return v.special.queue[v.special.at] === me ? specialMove(v, me, o) : null
    case "main":
      if (v.turn === me) return o.hurry ? { type: "end" } : mainMove(v, me, o)
      return replyMove(v, me, o)
    default:
      return null
  }
}

// how long a computer player "thinks" before each kind of move (ms)
const THINK = { build: 750, roll: 700, discard: 900, bandit: 1100, buy: 650, play: 850, bank: 600, offer: 700, reply: 1200, confirm: 650, cancel: 400, end: 650, done: 400 }
export const thinkTime = (act, s) => {
  let ms = THINK[act?.type] ?? 700
  if (s?.phase === "setup") ms += 250
  return ms
}
