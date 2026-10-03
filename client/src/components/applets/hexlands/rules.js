// Hexlands' rules: one file that runs games against the computer in the browser (local.js)
// and online games on the server (server/arcade/games/hexlands.js, through the online room
// system in server/arcade/rooms.js). It follows the room system's contract:
//   create({ players, settings, random, now, after }) -> a new game
//   action(state, seat, action, ctx) -> the next state, or { error } (seat null = the server:
//     the turn clock and trade offers running out)
//   view(state, seat) -> what that player may see (other hands only as counts, development
//     cards hidden, the deck's order hidden, a stolen card shown only to the two players)
//   isOver(state), bot(state, seat, ctx), botDelay(state, seat, action)
// Nothing here mutates a state: every move clones it first.
//
// Moves (all { type, ... }):
//   build { what: "road" | "settlement" | "city", at: edge or corner id }
//   roll | buy | end | done (stop placing free roads)
//   discard { cards: { res: n } }        when a 7 makes you discard half
//   bandit { tile, victim }              move the Bandit, take a card from victim
//   play { card: "ranger" | "roads" | "plenty" | "monopoly", res }   res: [r1, r2] or r
//   bank { give: res, get: res, count }  with the bank or your harbors
//   offer { give, get, to: [seats] }     to other players (give/get from your side)
//   reply { id, answer: "accept" | "decline" | "counter", give, get }  (counter terms are
//     from the offerer's side, like the offer)
//   confirm { id, with: seat }  |  cancel { id }

import { geometry, makeBoard, geoFor } from "./board.js"
import * as L from "./logic.js"
import { chooseAction, thinkTime, personaFor } from "./bot.js"

const { RES, COSTS, PIECES } = L
export { DEFAULTS, validateSettings, seats } from "./logic.js"

const LOG_MAX = 150
const TRADE_MS = 45_000 // a person's trade offer stays open this long
const BOT_TRADE_MS = 9_000 // a computer player's
const MAX_OFFERS = 25 // per turn

const clone = (s) => structuredClone(s)
const name = (s, p) => s.players[p]?.name || `Player ${p + 1}`
const others = (s, p) => s.players.map((_, i) => i).filter((i) => i !== p)
const roll = (random) => 1 + Math.floor(random() * 6)
const err = (error) => ({ error })
const add = (hand, cards, sign = 1) => Object.entries(cards).forEach(([r, n]) => (hand[r] = (hand[r] || 0) + sign * n))

export const points = (s, p) => L.publicPoints(s, p) + s.players[p].dev.filter((d) => d.t === "monument").length

const log = (s, entry) => {
  s.log.push({ id: ++s.seq, turn: s.turnNo, ...entry })
  if (s.log.length > LOG_MAX) s.log.splice(0, s.log.length - LOG_MAX)
}

const shuffle = (list, random) => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ---------- a new game ----------

export const create = ({ players, settings: raw, random = Math.random, now = Date.now(), after }) => {
  let settings = L.validateSettings({ ...raw, players: players.length })
  if (settings.error) settings = L.validateSettings({ players: players.length })
  const n = players.length
  const geo = geoFor(n)
  const g = geometry(geo)
  const board = makeBoard({ geo, layout: settings.layout, random })
  const deck = shuffle(
    Object.entries(L.deckFor(settings)).flatMap(([t, k]) => Array(k).fill(t)),
    random
  )
  const first = Math.floor(random() * n)
  const ring = Array.from({ length: n }, (_, i) => (first + i) % n)
  const s = {
    v: 1,
    settings,
    geo,
    tiles: board.tiles,
    harbors: board.harbors,
    bandit: board.bandit,
    verts: Array(g.vertices.length).fill(null),
    edges: Array(g.edges.length).fill(null),
    bank: Object.fromEntries(RES.map((r) => [r, L.BANK[geo]])),
    deck,
    players: players.map((pl, i) => ({
      name: pl.name || `Player ${i + 1}`,
      bot: !!pl.bot,
      color: L.COLORS[i % L.COLORS.length].id,
      hand: L.emptyHand(),
      dev: [],
      rangers: 0,
      pieces: { ...PIECES },
      road: 0,
      stats: { gained: L.emptyHand(), stolen: 0, lost: 0, discarded: 0, trades: 0, built: { road: 0, settlement: 0, city: 0 }, devBought: 0, blocked: 0 },
    })),
    phase: "setup",
    resume: null,
    turn: first,
    turnNo: 0,
    first,
    order: [...ring, ...[...ring].reverse()],
    setupStep: 0,
    setupVertex: null,
    dice: null,
    rolls: Array(13).fill(0),
    discards: {},
    devPlayed: false,
    freeRoads: 0,
    trade: null,
    tradeSeq: 0,
    offers: 0,
    longest: null,
    army: null,
    special: null,
    deadline: null,
    stamp: 0,
    acts: 0,
    log: [],
    seq: 0,
    winner: null,
    startedAt: now,
    endedAt: null,
  }
  log(s, { k: "start", p: first, text: `Welcome to Hexlands! ${name(s, first)} places first.` })
  armClock(null, s, { after }, now)
  return s
}

// ---------- the turn clock ----------

const stepKey = (s) => (s ? `${s.phase}|${s.turn}|${s.setupStep}|${s.setupVertex != null}|${s.special?.at ?? ""}` : "")
const stepMs = (s) => {
  const t = s.settings.timer
  if (!t) return 0
  if (s.phase === "roll") return Math.min(t, 30) * 1000
  if (s.phase === "main" || s.phase === "setup") return t * 1000
  return Math.min(t, 45) * 1000
}
const armClock = (prev, s, ctx, now) => {
  if (s.phase === "over") {
    s.deadline = null
    ctx.cancel?.("turn")
    ctx.cancel?.("trade")
    return
  }
  if (stepKey(prev) === stepKey(s)) return
  const ms = stepMs(s)
  s.stamp++
  if (!ms) {
    s.deadline = null
    return
  }
  s.deadline = now + ms
  ctx.after?.(ms, { type: "timeout", stamp: s.stamp }, "turn")
}

// ---------- after every move ----------

const settle = (prev, s, ctx, now) => {
  // seats a computer player took over (someone left) trade like computer players
  ctx.players?.forEach((p, i) => {
    if (s.players[i] && p.bot && !s.players[i].bot) s.players[i].bot = true
  })
  // Longest Road can change hands whenever a road is built or broken
  const lengths = s.players.map((_, p) => L.roadLength(s, p))
  lengths.forEach((l, p) => (s.players[p].road = l))
  const holder = L.longestHolder(lengths, s.longest)
  if (holder !== s.longest) {
    if (holder == null) log(s, { k: "longest", p: null, text: `Nobody holds Longest Road now.` })
    else log(s, { k: "longest", p: holder, text: `${name(s, holder)} takes Longest Road (${lengths[holder]} roads)!` })
    s.longest = holder
  }
  const army = L.armyHolder(s.players.map((pl) => pl.rangers), s.army)
  if (army !== s.army) {
    log(s, { k: "army", p: army, text: `${name(s, army)} takes Largest Patrol (${s.players[army].rangers} Rangers)!` })
    s.army = army
  }
  s.acts++
  // you win on your own turn
  if (s.phase !== "setup" && s.phase !== "over" && points(s, s.turn) >= s.settings.target) {
    s.phase = "over"
    s.winner = s.turn
    s.endedAt = now
    s.trade = null
    log(s, { k: "win", p: s.turn, text: `${name(s, s.turn)} wins with ${points(s, s.turn)} points!` })
  }
  armClock(prev, s, ctx, now)
  return s
}

export const action = (state, seat, a, ctx = {}) => {
  if (!a || typeof a !== "object" || typeof a.type !== "string") return err("That isn't a move.")
  if (state.phase === "over") return err("The game is over.")
  const now = ctx.now ?? Date.now()
  const random = ctx.random || Math.random
  let next
  if (seat == null) next = serverMove(state, a, { random, now, ctx })
  else {
    if (!Number.isInteger(seat) || !state.players[seat]) return err("You're not playing in this game.")
    next = move(state, seat, a, { random, now, ctx })
  }
  if (!next || next.error || next === state) return next
  return settle(state, next, ctx, now)
}

// ---------- moves ----------

const move = (state, seat, a, env) => {
  switch (a.type) {
    case "build":
      return build(state, seat, a.what, a.at)
    case "roll":
      return doRoll(state, seat, env)
    case "discard":
      return discard(state, seat, a.cards)
    case "bandit":
      return bandit(state, seat, a, env)
    case "buy":
      return buy(state, seat)
    case "play":
      return play(state, seat, a)
    case "done":
      return doneRoads(state, seat)
    case "bank":
      return bankTrade(state, seat, a)
    case "offer":
      return offer(state, seat, a, env)
    case "reply":
      return reply(state, seat, a)
    case "confirm":
      return confirm(state, seat, a, env)
    case "cancel":
      return cancelOffer(state, seat, a, env)
    case "end":
      return endTurn(state, seat, env)
    default:
      return err("That isn't a move.")
  }
}

// whose move it is to build now (main phase: the player whose turn it is; between turns
// with 5-6 players: whoever's special build it is)
const builder = (s) => (s.phase === "special" ? s.special.queue[s.special.at] : s.turn)

const pay = (s, p, cost) => {
  add(s.players[p].hand, cost, -1)
  add(s.bank, cost)
}

const build = (state, seat, what, at) => {
  if (!["road", "settlement", "city"].includes(what)) return err("Build a road, a settlement or a city.")
  const n = Number(at)
  if (!Number.isInteger(n)) return err("Pick a spot on the board.")
  const me = state.players[seat]
  if (state.phase === "setup") {
    if (state.turn !== seat) return err(`It's ${name(state, state.turn)}'s turn to place.`)
    const need = state.setupVertex == null ? "settlement" : "road"
    if (what !== need) return err(need === "settlement" ? "Place a settlement first." : "Now place a road next to your new settlement.")
    if (what === "settlement") {
      if (!L.legalSettlements(state, seat, true).includes(n)) return err("Settlements need a free corner with no building on the corners right next to it.")
      const s = clone(state)
      s.verts[n] = { p: seat, k: "s" }
      s.players[seat].pieces.settlement--
      s.setupVertex = n
      log(s, { k: "build", p: seat, what, at: n, text: `${name(s, seat)} places a settlement.` })
      // the second settlement collects one of each resource around it
      if (s.setupStep >= s.players.length) {
        const gains = []
        for (const t of L.vertexTiles(s, n)) {
          if (!t.res || s.bank[t.res] < 1) continue
          s.bank[t.res]--
          s.players[seat].hand[t.res]++
          s.players[seat].stats.gained[t.res]++
          gains.push({ p: seat, tile: t.tile, r: t.res, n: 1 })
        }
        if (gains.length) log(s, { k: "produce", gains, text: `${name(s, seat)} collects ${L.cardsText(sumGains(gains)[seat])}.` })
      }
      return s
    }
    if (!L.legalRoads(state, seat, state.setupVertex).includes(n)) return err("Place the road touching the settlement you just built.")
    const s = clone(state)
    s.edges[n] = seat
    s.players[seat].pieces.road--
    s.setupVertex = null
    s.setupStep++
    log(s, { k: "build", p: seat, what, at: n, text: `${name(s, seat)} places a road.` })
    if (s.setupStep >= s.order.length) {
      s.phase = "roll"
      s.turn = s.first
      s.turnNo = 1
      s.acts = 0
      log(s, { k: "turn", p: s.turn, text: `Setup is done. ${name(s, s.turn)} rolls first.` })
    } else s.turn = s.order[s.setupStep]
    return s
  }

  const free = state.phase === "roads" && what === "road"
  if (state.phase === "roads" && what !== "road" && state.turn === seat) return err("Place your free roads first (or press Done).")
  if (!(state.phase === "main" || state.phase === "special" || free)) return err(state.phase === "roll" ? "Roll the dice first." : "You can't build right now.")
  if (builder(state) !== seat) return err("It isn't your turn.")
  const piece = what === "city" ? "city" : what
  if (me.pieces[piece] < 1) return err(`You have no ${what === "city" ? "cities" : `${what}s`} left to build.`)
  if (!free && !L.hasAll(me.hand, COSTS[what])) return err(`You need ${L.cardsText(L.missing(me.hand, COSTS[what]))} more for a ${what}.`)
  if (what === "road" && !L.legalRoads(state, seat).includes(n)) return err("Roads connect to your own roads, settlements or cities.")
  if (what === "settlement" && !L.legalSettlements(state, seat).includes(n)) return err("A settlement needs your road leading to it and no building on the corners next to it.")
  if (what === "city" && !L.legalCities(state, seat).includes(n)) return err("Cities replace one of your settlements.")
  const s = clone(state)
  const pl = s.players[seat]
  if (free) s.freeRoads--
  else pay(s, seat, COSTS[what])
  if (what === "road") s.edges[n] = seat
  else if (what === "settlement") s.verts[n] = { p: seat, k: "s" }
  else {
    s.verts[n] = { p: seat, k: "c" }
    pl.pieces.settlement++
  }
  pl.pieces[piece]--
  pl.stats.built[what]++
  log(s, { k: "build", p: seat, what, at: n, text: `${name(s, seat)} builds a ${what}${free ? " (free)" : ""}.` })
  if (s.phase === "roads" && (s.freeRoads < 1 || pl.pieces.road < 1 || !L.legalRoads(s, seat).length)) {
    s.phase = s.resume || "main"
    s.resume = null
    s.freeRoads = 0
  }
  return s
}

const sumGains = (gains) => {
  const out = {}
  for (const g of gains) {
    out[g.p] ||= {}
    out[g.p][g.r] = (out[g.p][g.r] || 0) + g.n
  }
  return out
}

const doRoll = (state, seat, { random }) => {
  if (state.phase !== "roll") return err(state.phase === "setup" ? "Finish setting up first." : "You already rolled this turn.")
  if (state.turn !== seat) return err("It isn't your turn.")
  const s = clone(state)
  const dice = [roll(random), roll(random)]
  const sum = dice[0] + dice[1]
  s.dice = dice
  s.rolls[sum]++
  log(s, { k: "roll", p: seat, dice, text: `${name(s, seat)} rolls ${sum}.` })
  if (sum === 7) {
    s.discards = {}
    s.players.forEach((pl, i) => {
      const n = L.total(pl.hand)
      if (n > s.settings.discard) s.discards[i] = Math.floor(n / 2)
    })
    const who = Object.keys(s.discards).map(Number)
    s.resume = "main"
    if (who.length) {
      s.phase = "discard"
      log(s, { k: "seven", text: `Seven! ${who.map((p) => `${name(s, p)} (${s.discards[p]})`).join(", ")} must discard half.` })
    } else {
      s.phase = "bandit"
      log(s, { k: "seven", text: `Seven! ${name(s, seat)} moves the Bandit.` })
    }
    return s
  }
  produce(s, sum)
  s.phase = "main"
  return s
}

// every tile with this number pays its corners: 1 per settlement, 2 per city. If the bank
// runs short of a resource, nobody gets it (unless only one player was owed it).
const produce = (s, sum) => {
  const g = geometry(s.geo)
  const owed = {}
  let blocked = null
  s.tiles.forEach((tile, i) => {
    if (tile.n !== sum) return
    const res = L.TERRAIN_RES[tile.t]
    if (!res) return
    if (i === s.bandit) {
      blocked = i
      g.tiles[i].corners.forEach((v) => s.verts[v] && s.players[s.verts[v].p].stats.blocked++)
      return
    }
    for (const v of g.tiles[i].corners) {
      const b = s.verts[v]
      if (b) (owed[res] ||= []).push({ p: b.p, tile: i, r: res, n: b.k === "c" ? 2 : 1 })
    }
  })
  const gains = []
  const short = []
  for (const [res, list] of Object.entries(owed)) {
    const want = list.reduce((n, x) => n + x.n, 0)
    if (s.bank[res] >= want) gains.push(...list)
    else {
      const who = new Set(list.map((x) => x.p))
      if (who.size === 1 && s.bank[res] > 0) {
        let left = s.bank[res]
        for (const x of list) {
          const n = Math.min(left, x.n)
          if (n > 0) gains.push({ ...x, n })
          left -= n
        }
      }
      short.push(res)
    }
  }
  for (const x of gains) {
    s.bank[x.r] -= x.n
    s.players[x.p].hand[x.r] += x.n
    s.players[x.p].stats.gained[x.r] += x.n
  }
  const per = sumGains(gains)
  const parts = Object.entries(per).map(([p, cards]) => `${name(s, Number(p))} gets ${L.cardsText(cards)}`)
  let text = parts.length ? `${parts.join("; ")}.` : "Nobody collects anything."
  if (blocked != null) text += ` The Bandit blocks the ${L.RES_INFO[L.TERRAIN_RES[s.tiles[blocked].t]].from.toLowerCase()}.`
  if (short.length) text += ` The bank is short of ${short.join(" and ")}.`
  log(s, { k: "produce", gains, blocked, text })
}

const discard = (state, seat, raw) => {
  if (state.phase !== "discard") return err("Nobody needs to discard now.")
  const need = state.discards[seat]
  if (!need) return err("You don't need to discard.")
  const cards = L.cleanCards(raw)
  if (!cards) return err("Pick the cards to discard.")
  const n = Object.values(cards).reduce((a, b) => a + b, 0)
  if (n !== need) return err(`Discard exactly ${need} cards.`)
  if (!L.hasAll(state.players[seat].hand, cards)) return err("You don't have those cards.")
  const s = clone(state)
  pay(s, seat, cards)
  s.players[seat].stats.discarded += n
  delete s.discards[seat]
  log(s, { k: "discard", p: seat, cards, text: `${name(s, seat)} discards ${n} cards (${L.cardsText(cards)}).` })
  if (!Object.keys(s.discards).length) s.phase = "bandit"
  return s
}

const bandit = (state, seat, a, { random }) => {
  if (state.phase !== "bandit") return err("You can't move the Bandit now.")
  if (state.turn !== seat) return err("It isn't your turn.")
  const tile = Number(a.tile)
  if (!L.banditTiles(state, seat).includes(tile)) return err(tile === state.bandit ? "The Bandit has to move to a different tile." : "The Bandit can't go there.")
  const victims = L.victimsAt({ ...state, bandit: tile }, tile, seat, (p) => L.total(state.players[p].hand))
  let victim = a.victim == null ? null : Number(a.victim)
  if (victims.length && victim == null && victims.length === 1) victim = victims[0]
  if (victims.length && !victims.includes(victim)) return err("Pick who to take a card from.")
  if (!victims.length) victim = null
  const s = clone(state)
  s.bandit = tile
  const where = L.RES_INFO[L.TERRAIN_RES[s.tiles[tile].t]]?.from.toLowerCase() || "desert"
  if (victim != null) {
    const hand = s.players[victim].hand
    const pile = RES.flatMap((r) => Array(hand[r]).fill(r))
    const r = pile[Math.floor(random() * pile.length)]
    hand[r]--
    s.players[seat].hand[r]++
    s.players[seat].stats.stolen++
    s.players[victim].stats.lost++
    log(s, {
      k: "steal",
      p: seat,
      tile,
      by: seat,
      from: victim,
      text: `${name(s, seat)} moves the Bandit to the ${where} and takes a card from ${name(s, victim)}.`,
      priv: { to: [seat, victim], r, text: `${name(s, seat)} moves the Bandit to the ${where} and takes ${L.RES_INFO[r].label.toLowerCase()} from ${name(s, victim)}.` },
    })
  } else log(s, { k: "bandit", p: seat, tile, text: `${name(s, seat)} moves the Bandit to the ${where}.` })
  s.phase = s.resume || "main"
  s.resume = null
  return s
}

const buy = (state, seat) => {
  if (!(state.phase === "main" || state.phase === "special")) return err(state.phase === "roll" ? "Roll the dice first." : "You can't buy a card now.")
  if (builder(state) !== seat) return err("It isn't your turn.")
  if (!state.deck.length) return err("The development deck is empty.")
  if (!L.hasAll(state.players[seat].hand, COSTS.dev)) return err(`You need ${L.cardsText(L.missing(state.players[seat].hand, COSTS.dev))} more for a development card.`)
  const s = clone(state)
  pay(s, seat, COSTS.dev)
  const t = s.deck.pop()
  s.players[seat].dev.push({ t, at: s.turnNo })
  s.players[seat].stats.devBought++
  log(s, { k: "buy", p: seat, text: `${name(s, seat)} buys a development card.`, priv: { to: [seat], card: t, text: `You buy a development card: ${L.DEV[t].label}.` } })
  return s
}

const play = (state, seat, a) => {
  if (!(state.phase === "roll" || state.phase === "main")) return err("You can't play a card now.")
  if (state.turn !== seat) return err("Play cards on your own turn.")
  const card = a.card
  if (!L.DEV[card] || card === "monument") return err(card === "monument" ? "Monuments count by themselves: keep them secret." : "That isn't a card.")
  if (state.devPlayed) return err("You've already played a development card this turn.")
  const me = state.players[seat]
  const idx = me.dev.findIndex((d) => d.t === card && d.at < state.turnNo)
  if (idx < 0) return err(me.dev.some((d) => d.t === card) ? "You can't play a card on the turn you bought it." : "You don't have that card.")
  if ((card === "roads" || card === "plenty" || card === "monopoly") && state.phase === "roll") {
    // allowed: any card may be played before rolling
  }
  let s = clone(state)
  const pl = s.players[seat]
  if (card === "plenty") {
    const res = Array.isArray(a.res) ? a.res : []
    if (res.length !== 2 || !res.every((r) => RES.includes(r))) return err("Pick two resources.")
    const want = {}
    res.forEach((r) => (want[r] = (want[r] || 0) + 1))
    if (!L.hasAll(s.bank, want)) return err("The bank doesn't have those.")
    add(s.bank, want, -1)
    add(pl.hand, want)
    add(pl.stats.gained, want)
    log(s, { k: "play", p: seat, card, text: `${name(s, seat)} plays Bumper Crop and takes ${L.cardsText(want)}.` })
  } else if (card === "monopoly") {
    const r = a.res
    if (!RES.includes(r)) return err("Name a resource.")
    let got = 0
    others(s, seat).forEach((o) => {
      got += s.players[o].hand[r]
      s.players[o].hand[r] = 0
    })
    pl.hand[r] += got
    log(s, { k: "play", p: seat, card, r, n: got, text: `${name(s, seat)} plays Market Corner on ${r} and collects ${got}.` })
  } else if (card === "ranger") {
    pl.rangers++
    s.resume = s.phase
    s.phase = "bandit"
    log(s, { k: "play", p: seat, card, text: `${name(s, seat)} plays a Ranger.` })
  } else if (card === "roads") {
    const n = Math.min(2, pl.pieces.road)
    log(s, { k: "play", p: seat, card, text: `${name(s, seat)} plays Trailblazers.` })
    if (n > 0 && L.legalRoads(s, seat).length) {
      s.freeRoads = n
      s.resume = s.phase
      s.phase = "roads"
    }
  }
  pl.dev.splice(idx, 1)
  s.devPlayed = true
  return s
}

const doneRoads = (state, seat) => {
  if (state.phase !== "roads" || state.turn !== seat) return err("Nothing to finish.")
  const s = clone(state)
  s.phase = s.resume || "main"
  s.resume = null
  s.freeRoads = 0
  return s
}

const bankTrade = (state, seat, a) => {
  if (state.phase !== "main") return err(state.phase === "roll" ? "Roll the dice first." : "You can't trade now.")
  if (state.turn !== seat) return err("Trade on your own turn.")
  const { give, get } = a
  const count = a.count == null ? 1 : Number(a.count)
  if (!RES.includes(give) || !RES.includes(get) || give === get) return err("Pick a resource to give and a different one to get.")
  if (!Number.isInteger(count) || count < 1 || count > 10) return err("Trade 1 to 10 cards at a time.")
  const ratio = L.ratios(state, seat)[give]
  if (state.players[seat].hand[give] < ratio * count) return err(`You need ${ratio * count} ${give} for that.`)
  if (state.bank[get] < count) return err(`The bank is out of ${get}.`)
  const s = clone(state)
  pay(s, seat, { [give]: ratio * count })
  s.bank[get] -= count
  s.players[seat].hand[get] += count
  log(s, { k: "bank", p: seat, give: { [give]: ratio * count }, get: { [get]: count }, text: `${name(s, seat)} trades ${ratio * count} ${give} with the bank for ${count} ${get}.` })
  return s
}

const cleanTerms = (a) => {
  const give = L.cleanCards(a.give)
  const get = L.cleanCards(a.get)
  if (!give || !get) return err("A trade needs cards on both sides.")
  if (Object.keys(give).some((r) => get[r])) return err("You can't trade a resource for the same resource.")
  return { give, get }
}

const offer = (state, seat, a, { now, ctx }) => {
  if (state.phase !== "main") return err(state.phase === "roll" ? "Roll the dice first." : "You can't trade now.")
  if (state.turn !== seat) return err("Only the player whose turn it is can offer trades.")
  if (state.offers >= MAX_OFFERS) return err("That's enough offers for one turn.")
  const terms = cleanTerms(a)
  if (terms.error) return terms
  if (!L.hasAll(state.players[seat].hand, terms.give)) return err("You don't have the cards you're offering.")
  let to = Array.isArray(a.to) ? [...new Set(a.to.map(Number))].filter((i) => i !== seat && state.players[i]) : others(state, seat)
  if (!state.settings.botTrade) to = to.filter((i) => !state.players[i].bot)
  if (!to.length) return err(state.settings.botTrade ? "Pick who to offer it to." : "Trading with computer players is off in this game.")
  const s = clone(state)
  const ms = s.players[seat].bot ? BOT_TRADE_MS : TRADE_MS
  s.trade = { id: ++s.tradeSeq, from: seat, give: terms.give, get: terms.get, to, replies: {}, expires: now + ms }
  s.offers++
  log(s, { k: "offer", p: seat, text: `${name(s, seat)} offers ${L.cardsText(terms.give)} for ${L.cardsText(terms.get)}.` })
  ctx.after?.(ms, { type: "expire", id: s.trade.id }, "trade")
  return s
}

const reply = (state, seat, a) => {
  const t = state.trade
  if (!t || t.id !== a.id) return err("That offer is gone.")
  if (seat === t.from || !t.to.includes(seat)) return err("That offer isn't for you.")
  const answer = a.answer
  let entry
  if (answer === "accept") {
    if (!L.hasAll(state.players[seat].hand, t.get)) return err("You don't have the cards they're asking for.")
    entry = { a: "accept" }
  } else if (answer === "decline") entry = { a: "decline" }
  else if (answer === "counter") {
    const terms = cleanTerms(a)
    if (terms.error) return terms
    if (!L.hasAll(state.players[seat].hand, terms.get)) return err("You don't have the cards you're offering.")
    entry = { a: "counter", give: terms.give, get: terms.get }
  } else return err("Accept, decline or counter.")
  const s = clone(state)
  s.trade.replies[seat] = entry
  if (answer === "counter") log(s, { k: "counter", p: seat, text: `${name(s, seat)} counters: ${L.cardsText(entry.get)} for ${L.cardsText(entry.give)}.` })
  return s
}

const confirm = (state, seat, a, { ctx }) => {
  const t = state.trade
  if (!t || t.id !== a.id) return err("That offer is gone.")
  if (t.from !== seat || state.turn !== seat || state.phase !== "main") return err("Only the player who made the offer can complete it.")
  const w = Number(a.with)
  const r = t.replies[w]
  if (!r || (r.a !== "accept" && r.a !== "counter")) return err("They haven't accepted.")
  const terms = r.a === "counter" ? { give: r.give, get: r.get } : { give: t.give, get: t.get }
  if (!L.hasAll(state.players[seat].hand, terms.give)) return err("You no longer have the cards for this trade.")
  if (!L.hasAll(state.players[w].hand, terms.get)) return err(`${name(state, w)} no longer has the cards.`)
  const s = clone(state)
  add(s.players[seat].hand, terms.give, -1)
  add(s.players[w].hand, terms.give)
  add(s.players[w].hand, terms.get, -1)
  add(s.players[seat].hand, terms.get)
  s.players[seat].stats.trades++
  s.players[w].stats.trades++
  s.trade = null
  ctx.cancel?.("trade")
  log(s, { k: "trade", p: seat, with: w, give: terms.give, get: terms.get, text: `${name(s, seat)} trades ${L.cardsText(terms.give)} to ${name(s, w)} for ${L.cardsText(terms.get)}.` })
  return s
}

const cancelOffer = (state, seat, a, { ctx }) => {
  const t = state.trade
  if (!t || (a.id != null && t.id !== a.id)) return err("That offer is gone.")
  if (t.from !== seat) return err("That isn't your offer.")
  const s = clone(state)
  s.trade = null
  ctx.cancel?.("trade")
  return s
}

const nextTurn = (s) => {
  s.turn = (s.turn + 1) % s.players.length
  s.turnNo++
  s.phase = "roll"
  s.devPlayed = false
  s.freeRoads = 0
  s.offers = 0
  s.acts = 0
  s.special = null
  s.trade = null
  log(s, { k: "turn", p: s.turn, text: `${name(s, s.turn)}'s turn.` })
}

const endTurn = (state, seat, { ctx }) => {
  if (state.phase === "special") {
    if (builder(state) !== seat) return err("It isn't your turn to build.")
    const s = clone(state)
    s.special.at++
    if (s.special.at >= s.special.queue.length) nextTurn(s)
    return s
  }
  if (state.turn !== seat) return err("It isn't your turn.")
  if (state.phase !== "main") return err(state.phase === "roll" ? "Roll the dice first." : "Finish what you're doing first.")
  const s = clone(state)
  s.trade = null
  ctx.cancel?.("trade")
  // 5-6 players: everyone else who can afford something may build, in turn
  const n = s.players.length
  const queue = n >= 5 && s.settings.special ? Array.from({ length: n - 1 }, (_, i) => (s.turn + 1 + i) % n).filter((p) => canBuildSomething(s, p)) : []
  if (queue.length) {
    s.phase = "special"
    s.special = { queue, at: 0 }
    log(s, { k: "special", text: `Special building: ${queue.map((p) => name(s, p)).join(", ")} may build or buy.` })
  } else nextTurn(s)
  return s
}

const canBuildSomething = (s, p) => {
  const pl = s.players[p]
  const can = (what, piece, spots) => (!piece || pl.pieces[piece] > 0) && L.hasAll(pl.hand, COSTS[what]) && spots()
  return (
    can("road", "road", () => L.legalRoads(s, p).length > 0) ||
    can("settlement", "settlement", () => L.legalSettlements(s, p).length > 0) ||
    can("city", "city", () => L.legalCities(s, p).length > 0) ||
    can("dev", null, () => s.deck.length > 0)
  )
}

// ---------- the server's moves: clocks ----------

const serverMove = (state, a, env) => {
  if (a.type === "expire") {
    if (!state.trade || state.trade.id !== a.id) return state
    const s = clone(state)
    s.trade = null
    log(s, { k: "expire", p: state.trade.from, text: "The trade offer ran out." })
    return s
  }
  if (a.type === "timeout") {
    if (a.stamp !== state.stamp) return state
    return timeout(state, env)
  }
  return err("That isn't a move.")
}

// The turn clock ran out: do the least surprising thing for whoever we were waiting on
const timeout = (state, env) => {
  const auto = (s, p) => {
    const act = chooseAction(view(s, p), p, { random: env.random, level: "easy", persona: "steady", hurry: true })
    if (!act) return null
    const next = move(s, p, act, env)
    return next && !next.error ? next : null
  }
  let s = state
  switch (state.phase) {
    case "setup":
    case "roll":
    case "bandit":
      s = auto(state, state.turn)
      break
    case "discard": {
      for (const p of Object.keys(state.discards).map(Number)) s = auto(s, p) || s
      break
    }
    case "roads":
      s = doneRoads(state, state.turn)
      break
    case "special":
      s = endTurn(state, builder(state), env)
      break
    case "main":
      s = endTurn(state, state.turn, env)
      break
  }
  if (!s || s.error || s === state) return state
  const out = s === state ? clone(state) : s
  log(out, { k: "clock", text: "Time's up!" })
  return out
}

// ---------- what each player sees ----------

export const view = (s, seat) => {
  const over = s.phase === "over"
  const me = Number.isInteger(seat) && s.players[seat] ? seat : null
  const { deck, players, log: entries, ...rest } = s
  return {
    ...rest,
    deck: deck.length,
    you: me,
    players: players.map((pl, i) => {
      const mine = i === me
      const show = mine || over
      const monuments = pl.dev.filter((d) => d.t === "monument").length
      return {
        name: pl.name,
        bot: pl.bot,
        color: pl.color,
        cards: L.total(pl.hand),
        hand: show ? { ...pl.hand } : null,
        devCount: pl.dev.length,
        dev: mine ? pl.dev.map((d) => ({ t: d.t, fresh: d.at >= s.turnNo })) : over ? pl.dev.map((d) => ({ t: d.t })) : null,
        rangers: pl.rangers,
        pieces: pl.pieces,
        road: pl.road,
        points: L.publicPoints(s, i) + (show ? monuments : 0),
        shown: L.publicPoints(s, i),
        stats: over || mine ? pl.stats : null,
      }
    }),
    log: entries.map((e) => {
      if (!e.priv) return e
      const { priv, ...pub } = e
      if (me != null && priv.to.includes(me)) {
        const { to, ...extra } = priv
        return { ...pub, ...extra }
      }
      return pub
    }),
  }
}

export const isOver = (s) => (s.phase === "over" ? { winners: [s.winner], reason: "points", points: s.players.map((_, p) => points(s, p)) } : null)

// ---------- computer players ----------

export const bot = (s, seat, ctx = {}) => {
  if (s.phase === "over") return null
  return chooseAction(view(s, seat), seat, { random: ctx.random || Math.random, level: s.settings.level, persona: personaFor(s.players[seat].name) })
}
export const botDelay = (s, seat, act) => thinkTime(act, s, seat)
