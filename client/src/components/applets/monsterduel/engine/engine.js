// Monster Duel's rules engine: one duel between two players, as plain data. Pure
// functions only (no timers, no I/O), so the browser (games against the computer, the
// tutorial) and the game server (online duels) run exactly the same rules.
//
// A duel `d` is a plain object (JSON-safe). Every change goes through act(d, seat, action),
// which mutates `d` (callers clone first: rules.js does) and then advance(d), which runs the
// automatic parts (chains resolving, triggers, battle, draw / standby / end phases) until
// somebody has to decide something:
//   d.wait = null           the turn player may do anything legal (main or battle phase)
//   d.wait = { kind, seat } that seat must answer: "respond" (activate something or pass),
//                           "choose" (pick cards while an effect resolves), "target" (pick
//                           targets for a trigger effect), "discard" (hand size at End Phase)
// legal(d, seat) lists what a seat may do right now; view(d, seat) is what it may see (no
// hands, deck order or face-down cards of the opponent).
//
// Simplifications (written in the Rules screen too): after a chain link the other player
// gets one chance to respond (back and forth while people keep responding); trigger effects
// are mandatory; a monster that leaves the field during an attack "replays" (the attacker
// may attack again); the first player can't attack on the first turn.

import { CARD } from "./cards.js"

export const START_LP = 8000
export const HAND_LIMIT = 6
export const ZONES = 5
export const PHASES = ["draw", "standby", "main1", "battle", "main2", "end"]
export const PHASE_NAMES = { draw: "Draw", standby: "Standby", main1: "Main 1", battle: "Battle", main2: "Main 2", end: "End" }
const WAIT = "wait"
const FIELD = ["m", "s", "f"]
const LOG_KEEP = 80
const FX_KEEP = 40

// The random source for the current call (shuffles, coins, random discards, card ids)
let rand = Math.random
export const setRandom = (r) => {
  rand = typeof r === "function" ? r : Math.random
}

const other = (s) => 1 - s
const defOf = (d, uid) => CARD[d.cards[uid]?.id] || null
export const cardDef = defOf

// ---------- creating a duel ----------

const newUid = (d, id, owner) => {
  let uid
  for (let i = 0; ; i++) {
    uid = "c" + Math.floor(rand() * 60466176).toString(36) + (i > 8 ? i : "")
    if (!d.cards[uid]) break
  }
  d.cards[uid] = { id, owner }
  return uid
}

const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// decks: [{ main: [ids], extra: [ids] }, ...]; first: the seat that goes first;
// noShuffle: decks are drawn in the given order (the tutorial)
export const newDuel = ({ decks, names = ["Player 1", "Player 2"], first = 0, lp = START_LP, noShuffle = false, prefs = ["auto", "auto"] }) => {
  const d = {
    turn: 0,
    active: first,
    first,
    phase: "draw",
    names,
    p: [],
    cards: {},
    chain: [],
    chainWin: null,
    resolving: false,
    queue: [],
    wait: null,
    battle: null,
    recent: null,
    summonWin: null,
    phaseWin: null,
    endStep: 0,
    opt: {},
    stamp: 0,
    fx: [],
    log: [],
    seq: 0,
    over: null,
    prefs: [...prefs],
    startLp: lp,
    stacked: noShuffle, // decks in a set order (the tutorial): searching them doesn't shuffle
  }
  for (const seat of [0, 1]) {
    const deck = decks[seat] || { main: [], extra: [] }
    const main = noShuffle ? [...deck.main] : shuffle([...deck.main])
    const p = { lp, deck: [], hand: [], gy: [], ban: [], extra: [], m: Array(ZONES).fill(null), s: Array(ZONES).fill(null), f: null, summoned: false }
    d.p.push(p)
    for (const id of main) p.deck.push(newUid(d, id, seat))
    for (const id of deck.extra || []) p.extra.push(newUid(d, id, seat))
  }
  for (const seat of [0, 1]) for (let i = 0; i < 5; i++) drawOne(d, seat, true)
  log(d, `${names[first]} goes first.`)
  startTurn(d, first)
  advance(d)
  return d
}

// Put a new card straight into a zone: "hand", "deck" (on top), "gy", "extra", "m", "s" or
// "f" (tests, and the tutorial's opening position) -> its uid
export const addCard = (d, seat, id, zone, { pos = "atk", up = true, turn = d.turn - 1 } = {}) => {
  const uid = newUid(d, id, seat)
  const p = d.p[seat]
  if (zone === "m") p.m[freeZone(p.m)] = { ...newMonster(uid, pos, up, turn), moved: false }
  else if (zone === "s") p.s[freeZone(p.s)] = { uid, up, turn, eq: null }
  else if (zone === "f") p.f = { uid, up, turn, eq: null }
  else if (zone === "deck") p.deck.unshift(uid)
  else p[zone].push(uid)
  return uid
}

// ---------- log and effects for the animations ----------

// text: what everyone reads; mine: what `seat` reads instead (it names a hidden card)
const log = (d, text, seat = null, mine = null) => {
  d.seq++
  d.log.push(seat == null ? { n: d.seq, t: text } : { n: d.seq, t: text, s: seat, m: mine })
  if (d.log.length > LOG_KEEP) d.log.splice(0, d.log.length - LOG_KEEP)
}
// k: the kind of thing that happened; priv: extra fields only `seat` sees
const fx = (d, k, data = {}, seat = null, priv = null) => {
  d.seq++
  d.fx.push({ n: d.seq, k, ...data, ...(seat != null ? { ps: seat, p: priv } : {}) })
  if (d.fx.length > FX_KEEP) d.fx.splice(0, d.fx.length - FX_KEEP)
}
const nameOf = (d, uid) => defOf(d, uid)?.name || "a card"

// ---------- where cards are ----------

const PILES = ["hand", "deck", "gy", "ban", "extra"]
export const where = (d, uid) => {
  for (const seat of [0, 1]) {
    const p = d.p[seat]
    for (let i = 0; i < ZONES; i++) {
      if (p.m[i]?.uid === uid) return { seat, zone: "m", i, slot: p.m[i] }
      if (p.s[i]?.uid === uid) return { seat, zone: "s", i, slot: p.s[i] }
    }
    if (p.f?.uid === uid) return { seat, zone: "f", i: 0, slot: p.f }
    for (const z of PILES) {
      const i = p[z].indexOf(uid)
      if (i >= 0) return { seat, zone: z, i }
    }
  }
  return null
}
const onField = (d, uid) => FIELD.includes(where(d, uid)?.zone)
const monsterAt = (d, uid) => {
  const at = where(d, uid)
  return at?.zone === "m" ? at : null
}

const take = (d, uid) => {
  const at = where(d, uid)
  if (!at) return null
  const p = d.p[at.seat]
  if (at.zone === "m") p.m[at.i] = null
  else if (at.zone === "s") p.s[at.i] = null
  else if (at.zone === "f") p.f = null
  else p[at.zone].splice(at.i, 1)
  return at
}

// Move a card to its owner's hand, deck, graveyard, banished pile or Extra Deck. Cards
// entering a hidden place get a new id, so nobody can follow them. -> the card's id now
const send = (d, uid, dest, { top = false } = {}) => {
  const info = d.cards[uid]
  if (!info) return null
  const def = CARD[info.id]
  const at = take(d, uid)
  if (at?.zone === "m") dropEquips(d, uid)
  if (def.token) {
    delete d.cards[uid]
    return null
  }
  let to = dest
  if (def.extra && (to === "hand" || to === "deck")) to = "extra"
  let now = uid
  if (to === "hand" || to === "deck" || to === "extra") {
    delete d.cards[uid]
    now = newUid(d, info.id, info.owner)
  }
  const p = d.p[info.owner]
  if (to === "deck") {
    if (top) p.deck.unshift(now)
    else p.deck.splice(Math.floor(rand() * (p.deck.length + 1)), 0, now)
  } else p[to].push(now)
  return now
}

// a monster left the field: its equip cards go to the graveyard
const dropEquips = (d, uid) => {
  for (const seat of [0, 1])
    for (const slot of d.p[seat].s)
      if (slot?.eq === uid) {
        slot.eq = null
        log(d, `${nameOf(d, slot.uid)} is sent to the Graveyard.`)
        fx(d, "destroy", { uid: slot.uid, id: d.cards[slot.uid].id, seat })
        send(d, slot.uid, "gy")
      }
}

const freeZone = (zones) => zones.findIndex((z) => !z)

// ---------- stats, flags and auras ----------

// every face-up aura on the field: fn(sourceUid, controllerSeat, aura)
const eachAura = (d, fn) => {
  for (const seat of [0, 1]) {
    const p = d.p[seat]
    for (const slot of [...p.m, ...p.s, p.f]) {
      if (!slot?.up) continue
      const def = defOf(d, slot.uid)
      for (const e of def.effects || []) if (e.type === "aura") fn(slot.uid, seat, e)
    }
  }
}

const countOf = (d, seat, src, sel) => select(d, seat, sel, src).length
const amountOf = (d, seat, src, v) => (typeof v === "number" ? v : v?.per ? v.per * countOf(d, seat, src, v.count) : 0)

// a monster's ATK, DEF and flags right now (on the field: with equips, auras and boosts)
export const statsOf = (d, uid) => {
  const def = defOf(d, uid)
  const out = { atk: def?.atk ?? 0, def: def?.def ?? 0, level: def?.level ?? 0, flags: [] }
  const at = monsterAt(d, uid)
  if (!at || !at.slot.up) return out
  const flags = new Set(def.flags || [])
  let atk = out.atk
  let dfn = out.def
  for (const m of at.slot.mods) {
    atk += m.atk || 0
    dfn += m.def || 0
  }
  for (const f of at.slot.flags) flags.add(f.f)
  for (const seat of [0, 1])
    for (const slot of d.p[seat].s) {
      if (!slot?.up || slot.eq !== uid) continue
      const eq = defOf(d, slot.uid).equip || {}
      atk += eq.atk || 0
      dfn += eq.def || 0
      for (const f of eq.flags || []) flags.add(f)
    }
  eachAura(d, (src, seat, a) => {
    if (a.self ? src !== uid : !auraReaches(d, src, seat, a, uid, at.seat)) return
    atk += amountOf(d, seat, src, a.atk)
    dfn += amountOf(d, seat, src, a.def)
    for (const f of a.flags || []) flags.add(f)
  })
  return { ...out, atk: Math.max(0, atk), def: Math.max(0, dfn), flags: [...flags] }
}
const hasFlag = (d, uid, f) => statsOf(d, uid).flags.includes(f)

const auraReaches = (d, src, srcSeat, a, uid, seat) => {
  if (a.notSelf && src === uid) return false
  if (a.side === "self" && seat !== srcSeat) return false
  if (a.side === "opp" && seat === srcSeat) return false
  return !a.filter || matches(d, uid, a.filter, { base: true })
}

// does a card match a filter? Face-down cards on the field only show that they're
// monsters (or Spell/Trap cards) and their position: nothing else can be checked.
export const matches = (d, uid, f = {}, { base = false } = {}) => {
  const def = defOf(d, uid)
  if (!def) return false
  const at = where(d, uid)
  const fielded = at && FIELD.includes(at.zone)
  const hidden = fielded && !at.slot.up
  if (f.kind) {
    if (f.kind === "st") {
      if (def.kind === "monster") return false
    } else if (hidden && f.kind !== "monster" && def.kind !== "monster") return false
    else if (def.kind !== f.kind) return false
  }
  if (f.up !== undefined && (!fielded || at.slot.up !== f.up)) return false
  if (f.pos && (!fielded || at.zone !== "m" || at.slot.pos !== f.pos)) return false
  const deep = ["race", "races", "attr", "atkMin", "atkMax", "defMax", "levelMax", "levelMin", "sub", "ids", "notIds", "normal"]
  if (hidden && deep.some((k) => f[k] !== undefined)) return false
  if (f.race && def.race !== f.race) return false
  if (f.races && !f.races.includes(def.race)) return false
  if (f.attr && def.attr !== f.attr) return false
  if (f.sub && def.sub !== f.sub) return false
  if (f.ids && !f.ids.includes(def.id)) return false
  if (f.notIds && f.notIds.includes(def.id)) return false
  if (f.normal && def.sub !== "normal") return false
  if (f.levelMax !== undefined && !(def.level <= f.levelMax)) return false
  if (f.levelMin !== undefined && !(def.level >= f.levelMin)) return false
  if (f.atkMin !== undefined || f.atkMax !== undefined || f.defMax !== undefined) {
    if (def.kind !== "monster") return false
    const st = !base && at?.zone === "m" ? statsOf(d, uid) : def
    if (f.atkMin !== undefined && !(st.atk >= f.atkMin)) return false
    if (f.atkMax !== undefined && !(st.atk <= f.atkMax)) return false
    if (f.defMax !== undefined && !(st.def <= f.defMax)) return false
  }
  return true
}

// cards matching a selector, from `seat`'s point of view. src: the card asking (notSelf)
export const select = (d, seat, sel = {}, src = null) => {
  const sides = sel.side === "opp" ? [other(seat)] : sel.side === "both" ? [seat, other(seat)] : [seat]
  const out = []
  for (const s of sides) {
    const p = d.p[s]
    let uids
    if (sel.from === "monsters") uids = p.m.filter(Boolean).map((x) => x.uid)
    else if (sel.from === "spells") uids = [...p.s, p.f].filter(Boolean).map((x) => x.uid)
    else if (sel.from === "field") uids = [...p.m, ...p.s, p.f].filter(Boolean).map((x) => x.uid)
    else if (PILES.includes(sel.from)) uids = [...p[sel.from]]
    else uids = []
    for (const uid of uids) if ((!sel.notSelf || uid !== src) && matches(d, uid, sel.filter)) out.push(uid)
  }
  return out
}

// ---------- life points, drawing, winning ----------

const changeLp = (d, seat, delta) => {
  if (!delta) return
  const p = d.p[seat]
  p.lp = Math.max(0, p.lp + delta)
  fx(d, "lp", { seat, delta, lp: p.lp })
  log(d, delta < 0 ? `${d.names[seat]} takes ${-delta} damage (${p.lp} LP).` : `${d.names[seat]} gains ${delta} LP (${p.lp} LP).`)
}

const drawOne = (d, seat, quiet = false) => {
  const p = d.p[seat]
  if (!p.deck.length) {
    if (!d.over) {
      d.over = { winner: other(seat), reason: "deckout" }
      log(d, `${d.names[seat]} can't draw a card!`)
    }
    return null
  }
  const uid = p.deck.shift()
  p.hand.push(uid)
  if (!quiet) {
    fx(d, "draw", { seat }, seat, { uid, id: d.cards[uid].id })
    log(d, `${d.names[seat]} draws a card.`, seat, `You draw ${nameOf(d, uid)}.`)
  }
  return uid
}

const checkWin = (d) => {
  if (d.over) return
  const out = [0, 1].filter((s) => d.p[s].lp <= 0)
  if (out.length === 2) d.over = { winner: null, reason: "lp" }
  else if (out.length === 1) d.over = { winner: other(out[0]), reason: "lp" }
  if (d.over) log(d, d.over.winner == null ? "Both players are out of Life Points: it's a draw!" : `${d.names[d.over.winner]} wins the duel!`)
}

// ---------- turns and phases ----------

const startTurn = (d, seat) => {
  d.turn++
  d.active = seat
  d.phase = "draw"
  d.endStep = 0
  d.p[seat].summoned = false
  for (const s of [0, 1])
    for (const slot of d.p[s].m)
      if (slot) {
        slot.attacks = 0
        slot.moved = false
      }
  log(d, `Turn ${d.turn}: ${d.names[seat]}.`)
  fx(d, "turn", { seat, turn: d.turn })
}

// the End Phase's tidying: boosts that last "this turn" wear off, borrowed monsters go home
const endOfTurn = (d) => {
  for (const s of [0, 1])
    for (const slot of d.p[s].m)
      if (slot) {
        slot.mods = slot.mods.filter((m) => m.until !== d.turn)
        slot.flags = slot.flags.filter((f) => f.until !== d.turn)
      }
  for (const s of [0, 1])
    for (let i = 0; i < ZONES; i++) {
      const slot = d.p[s].m[i]
      if (!slot?.borrow || slot.borrow.until !== d.turn) continue
      const home = slot.borrow.from
      const zone = freeZone(d.p[home].m)
      d.p[s].m[i] = null
      if (zone < 0) {
        d.p[s].m[i] = slot
        destroy(d, [slot.uid], "effect")
        continue
      }
      slot.borrow = null
      d.p[home].m[zone] = slot
      log(d, `${nameOf(d, slot.uid)} returns to ${d.names[home]}.`)
      fx(d, "control", { uid: slot.uid, seat: home })
    }
}

// ---------- summoning ----------

const newMonster = (uid, pos, up, turn) => ({ uid, pos, up, turn, moved: true, attacks: 0, mods: [], flags: [], borrow: null })

// put a card from anywhere into a free Monster Zone of `seat`. how: normal | set | flip |
// special | fusion | token -> true if it worked
const place = (d, seat, uid, pos, up, how) => {
  const zone = freeZone(d.p[seat].m)
  if (zone < 0) return false
  take(d, uid)
  d.p[seat].m[zone] = newMonster(uid, pos, up, d.turn)
  const id = d.cards[uid].id
  if (up) fx(d, "summon", { uid, id, seat, zone, how })
  else fx(d, "set", { uid, seat, zone, kind: "monster" }, seat, { id })
  return true
}

// after a summon: the monster's own triggers, cards that react to it, and a window for the
// opponent (Snare Pit and friends)
const summoned = (d, uids, seat, how) => {
  for (const uid of uids) {
    if (how === "flip") queueTriggers(d, uid, "flip")
    else {
      queueTriggers(d, uid, "summon")
      if (how === "normal") queueTriggers(d, uid, "normalSummon")
    }
  }
  d.recent = { kind: "summon", seat, uids: [...uids] }
  d.summonWin = { seat, uids: [...uids] }
}

export const tributesNeeded = (def) => (def.level >= 7 ? 2 : def.level >= 5 ? 1 : 0)

// ---------- destroying ----------

// reason: "battle" | "effect" -> the cards that were destroyed
const destroy = (d, uids, reason) => {
  const gone = []
  for (const uid of uids) {
    const at = where(d, uid)
    if (!at || !FIELD.includes(at.zone)) continue
    if (at.zone === "m" && at.slot.up) {
      const flags = statsOf(d, uid).flags
      if (reason === "battle" && flags.includes("noBattleDestroy")) continue
      if (reason === "effect" && flags.includes("noEffectDestroy")) {
        log(d, `${nameOf(d, uid)} can't be destroyed by card effects.`)
        continue
      }
    }
    const id = d.cards[uid].id
    log(d, `${nameOf(d, uid)} is destroyed.`)
    fx(d, "destroy", { uid, id, seat: at.seat, zone: at.zone, i: at.i })
    const now = send(d, uid, "gy")
    gone.push(uid)
    if (at.zone === "m" && now) {
      queueTriggers(d, now, "destroyed", { reason })
      if (reason === "battle") queueTriggers(d, now, "destroyedBattle")
    }
  }
  return gone
}

// ---------- triggers and chains ----------

const queueTriggers = (d, uid, when, info = {}) => {
  const def = defOf(d, uid)
  ;(def?.effects || []).forEach((e, ei) => {
    if (e.type === "trigger" && e.on === when) d.queue.push({ uid, ei, when, seat: controllerOf(d, uid), info })
  })
}
// who controls a card: the field side it's on, else its owner
const controllerOf = (d, uid) => {
  const at = where(d, uid)
  return at && FIELD.includes(at.zone) ? at.seat : d.cards[uid]?.owner ?? 0
}

// a trigger that's still allowed to happen (its card is where the trigger expects)
const triggerStillValid = (d, t) => {
  const at = where(d, t.uid)
  if (!at) return false
  if (t.when === "destroyed" || t.when === "destroyedBattle") return at.zone === "gy"
  // a flip effect still happens if the monster was destroyed in the battle that flipped it
  if (t.when === "flip") return (at.zone === "m" && at.slot.up) || at.zone === "gy"
  if (t.when === "standby") return FIELD.includes(at.zone) && at.slot.up
  if (t.when === "battleDestroy" || t.when === "battleDamage") return at.zone === "m" && at.slot.up
  return at.zone === "m" && at.slot.up
}

// candidates for an effect's target
const targetOptions = (d, seat, spec, src) => {
  if (spec.from === "attacker") return d.battle && monsterAt(d, d.battle.att) && matches(d, d.battle.att, spec.filter) ? [d.battle.att] : []
  if (spec.from === "event") return (d.recent?.kind === "summon" && d.recent.seat !== seat ? d.recent.uids : []).filter((u) => monsterAt(d, u) && matches(d, u, spec.filter))
  return select(d, seat, spec, src)
}
const targetRange = (spec) => [spec.min ?? spec.n ?? 1, spec.n ?? 1]

const linkFor = (d, seat, uid, ei, targets, trig = false) => {
  const def = defOf(d, uid)
  const speed = def.kind === "trap" ? (def.sub === "counter" ? 3 : 2) : def.kind === "spell" ? (def.sub === "quick" ? 2 : 1) : 1
  return { uid, id: def.id, seat, ei, kind: def.kind, speed, targets: targets || [], step: 0, negated: false, trig }
}

const pushLink = (d, link) => {
  d.chain.push(link)
  d.chainWin = other(link.seat)
  d.resolving = false
  const def = CARD[link.id]
  fx(d, "activate", { uid: link.uid, id: link.id, seat: link.seat, link: d.chain.length, targets: link.targets })
  log(d, `${d.names[link.seat]} ${link.trig ? "triggers" : "activates"} ${def.name}${d.chain.length > 1 ? ` (chain link ${d.chain.length})` : ""}.`)
}

// trigger effects waiting to happen -> chain links (the turn player's first)
const buildFromQueue = (d) => {
  d.queue.sort((a, b) => (a.seat === d.active ? 0 : 1) - (b.seat === d.active ? 0 : 1))
  while (d.queue.length) {
    const t = d.queue[0]
    if (!triggerStillValid(d, t)) {
      d.queue.shift()
      continue
    }
    const eff = defOf(d, t.uid).effects[t.ei]
    if (eff.target) {
      const options = targetOptions(d, t.seat, eff.target, t.uid)
      const [min, max] = targetRange(eff.target)
      if (options.length < min) {
        d.queue.shift()
        log(d, `${nameOf(d, t.uid)}'s effect has no target.`)
        continue
      }
      if (options.length > max || min < max) {
        d.wait = { kind: "target", seat: t.seat, uid: t.uid, options, min: Math.min(min, options.length), max: Math.min(max, options.length), title: `${nameOf(d, t.uid)}: choose ${max === 1 ? "a target" : "targets"}`, stamp: ++d.stamp }
        return WAIT
      }
      d.queue.shift()
      pushLink(d, linkFor(d, t.seat, t.uid, t.ei, options, true))
      continue
    }
    d.queue.shift()
    pushLink(d, linkFor(d, t.seat, t.uid, t.ei, [], true))
  }
}

// ---------- activating ----------

const isMain = (d) => d.phase === "main1" || d.phase === "main2"
// the moment `seat` could act without anything pending: "free" (the turn player's open
// game state) or "respond" (a response window)
const modeFor = (d, seat) => {
  if (d.over) return null
  if (d.wait) return d.wait.kind === "respond" && d.wait.seat === seat ? "respond" : null
  if (seat !== d.active || d.chain.length || d.queue.length || d.battle) return null
  return isMain(d) || d.phase === "battle" ? "free" : null
}

const condOk = (d, seat, cond, uid) => {
  if (!cond) return true
  if (cond.controls && !select(d, seat, cond.controls, uid).length) return false
  if (cond.has && select(d, seat, cond.has, uid).length < (cond.has.min ?? 1)) return false
  if (cond.gy && select(d, seat, { from: "gy", ...cond.gy }, uid).length < (cond.gy.min ?? 1)) return false
  if (cond.fusion && !fusionOptions(d, seat, uid).length) return false
  return true
}

// what paying an effect's cost could look like: null if it can't be paid
const costOptions = (d, seat, cost, uid) => {
  if (!cost) return {}
  const out = {}
  if (cost.payLp && !(d.p[seat].lp > cost.payLp)) return null
  if (cost.discard) {
    const hand = d.p[seat].hand.filter((u) => u !== uid)
    if (hand.length < cost.discard) return null
    out.discard = { n: cost.discard, options: hand }
  }
  return out
}

// can `seat` activate effect `ei` of card `uid` in this mode? -> { uid, ei, targets, min,
// max, cost } with the possible targets, or null
export const activation = (d, seat, uid, ei, mode) => {
  const def = defOf(d, uid)
  const eff = def?.effects?.[ei]
  if (!eff || !mode) return null
  const at = where(d, uid)
  if (!at || at.seat !== seat) return null
  if (def.kind === "monster") {
    if (eff.type !== "ignition" || mode !== "free" || !isMain(d)) return null
    if (at.zone !== "m" || !at.slot.up) return null
    if (eff.once && d.opt[`${uid}:${ei}`] === d.turn) return null
  } else {
    if (eff.type !== "activate") return null
    const fromHand = at.zone === "hand"
    const fromSet = (at.zone === "s" || at.zone === "f") && !at.slot.up
    if (!fromHand && !fromSet) return null
    const mine = d.active === seat
    if (def.kind === "trap") {
      if (!fromSet || at.slot.turn >= d.turn) return null
    } else if (def.sub === "quick") {
      if (fromHand && !mine) return null
      if (fromSet && at.slot.turn >= d.turn) return null
    } else if (mode !== "free" || !isMain(d)) return null
    if (fromHand && def.sub !== "field" && freeZone(d.p[seat].s) < 0) return null
    const top = d.chain[d.chain.length - 1]
    const speed = def.kind === "trap" ? (def.sub === "counter" ? 3 : 2) : def.sub === "quick" ? 2 : 1
    if (top && top.speed === 3 && speed < 3) return null
    const trigger = eff.trigger || "any"
    if (trigger === "attack" && !(mode === "respond" && d.battle && d.recent?.kind === "attack" && d.recent.seat !== seat)) return null
    if (trigger === "oppSummon" && !(mode === "respond" && d.recent?.kind === "summon" && d.recent.seat !== seat)) return null
    if (trigger === "chain" && !(mode === "respond" && top && top.seat !== seat && !top.negated && (eff.chainKinds || ["spell", "trap"]).includes(top.kind))) return null
  }
  if (!condOk(d, seat, eff.cond, uid)) return null
  const cost = costOptions(d, seat, eff.cost, uid)
  if (!cost) return null
  let targets = null
  let min = 0
  let max = 0
  if (eff.target) {
    targets = targetOptions(d, seat, eff.target, uid)
    ;[min, max] = targetRange(eff.target)
    if (targets.length < min) return null
    max = Math.min(max, targets.length)
  }
  return { uid, ei, targets, min, max, cost }
}

// everything `seat` could activate now
const activations = (d, seat, mode) => {
  if (!mode) return []
  const p = d.p[seat]
  const uids = [...p.hand, ...p.m.filter(Boolean).map((x) => x.uid), ...p.s.filter(Boolean).map((x) => x.uid), ...(p.f ? [p.f.uid] : [])]
  const out = []
  for (const uid of uids) {
    const def = defOf(d, uid)
    ;(def.effects || []).forEach((_, ei) => {
      const a = activation(d, seat, uid, ei, mode)
      if (a) out.push(a)
    })
  }
  return out
}

const activate = (d, seat, a, { targets = [], cost = [] } = {}) => {
  const def = defOf(d, a.uid)
  const eff = def.effects[a.ei]
  // targets
  const picks = [...new Set(Array.isArray(targets) ? targets : [])]
  if (eff.target) {
    if (picks.length < a.min || picks.length > a.max || picks.some((t) => !a.targets.includes(t))) return { error: "Pick a valid target." }
  }
  // costs
  if (a.cost.discard) {
    const paid = [...new Set(Array.isArray(cost) ? cost : [])]
    if (paid.length !== a.cost.discard.n || paid.some((u) => !a.cost.discard.options.includes(u))) return { error: `Choose ${a.cost.discard.n} card${a.cost.discard.n > 1 ? "s" : ""} to discard.` }
    for (const u of paid) {
      log(d, `${d.names[seat]} discards ${nameOf(d, u)}.`)
      fx(d, "discard", { uid: u, id: d.cards[u].id, seat })
      send(d, u, "gy")
    }
  }
  if (eff.cost?.payLp) changeLp(d, seat, -eff.cost.payLp)
  // the card itself
  const at = where(d, a.uid)
  if (def.kind !== "monster") {
    if (at.zone === "hand") {
      if (def.sub === "field") {
        const old = d.p[seat].f
        if (old) {
          log(d, `${nameOf(d, old.uid)} is replaced.`)
          send(d, old.uid, "gy")
        }
        take(d, a.uid)
        d.p[seat].f = { uid: a.uid, up: true, turn: d.turn, eq: null }
      } else {
        take(d, a.uid)
        d.p[seat].s[freeZone(d.p[seat].s)] = { uid: a.uid, up: true, turn: d.turn, eq: null }
      }
    } else at.slot.up = true
  } else if (eff.once) d.opt[`${a.uid}:${a.ei}`] = d.turn
  pushLink(d, linkFor(d, seat, a.uid, a.ei, picks))
  return { ok: true }
}

// ---------- resolving ----------

const resolveTop = (d) => {
  const link = d.chain[d.chain.length - 1]
  if (!link.negated) {
    const ops = CARD[link.id].effects[link.ei].do || []
    if (link.step === 0 && !link.started) {
      link.started = true
      fx(d, "resolve", { uid: link.uid, id: link.id, seat: link.seat })
    }
    while (link.step < ops.length) {
      if (runOp(d, link, ops[link.step]) === WAIT) return WAIT
      link.step++
      link.answer = undefined
      if (d.over) break
    }
  }
  d.chain.pop()
  // a Spell or Trap card after it resolves
  const def = CARD[link.id]
  const at = where(d, link.uid)
  if (def.kind !== "monster" && at && FIELD.includes(at.zone) && d.cards[link.uid]?.id === link.id) {
    const stays = !link.negated && (def.sub === "continuous" || def.sub === "field" || (def.sub === "equip" && at.slot.eq && monsterAt(d, at.slot.eq)))
    if (!stays) send(d, link.uid, "gy")
  }
}

// the cards an op works on
const resolveWhat = (d, link, what) => {
  if (what === "self") return d.cards[link.uid] ? [link.uid] : []
  if (what === "attacker") return d.battle && monsterAt(d, d.battle.att) ? [d.battle.att] : []
  if (what === "targets") {
    const spec = CARD[link.id].effects[link.ei].target || {}
    return link.targets.filter((u) => {
      const at = where(d, u)
      if (!at) return false
      if (spec.from === "gy") return at.zone === "gy"
      if (spec.from === "monsters" || spec.from === "event" || spec.from === "attacker") return at.zone === "m"
      if (spec.from === "spells") return at.zone === "s" || at.zone === "f"
      return FIELD.includes(at.zone)
    })
  }
  if (what?.all) return select(d, link.seat, what.all, link.uid)
  return []
}

const statValue = (d, link, n) => {
  const uids = resolveWhat(d, link, n.of)
  const uid = uids[0] || (n.of === "attacker" ? d.battle?.att : link.targets[0])
  if (!uid || !d.cards[uid]) return 0
  const st = monsterAt(d, uid) ? statsOf(d, uid) : defOf(d, uid)
  return Math.floor((st[n.stat] || 0) * (n.mul ?? 1))
}
const amount = (d, link, n) => (typeof n === "number" ? n : n?.stat ? statValue(d, link, n) : n?.per ? n.per * select(d, link.seat, n.count, link.uid).length : 0)
const seatsFor = (link, who) => (who === "both" ? [link.seat, other(link.seat)] : who === "opp" ? [other(link.seat)] : [link.seat])

// ask `seat` to pick cards while an effect resolves
const ask = (d, link, { seat = link.seat, options, min = 1, max = 1, title, kind = "choose" }) => {
  d.wait = { kind, seat, options, min: Math.min(min, options.length), max: Math.min(max, options.length), title, stamp: ++d.stamp }
  return WAIT
}

const discardCards = (d, seat, uids) => {
  for (const u of uids) {
    log(d, `${d.names[seat]} discards ${nameOf(d, u)}.`)
    fx(d, "discard", { uid: u, id: d.cards[u].id, seat })
    send(d, u, "gy")
  }
}

const runOp = (d, link, op) => {
  const seat = link.seat
  const src = link.uid
  switch (op.op) {
    case "damage":
      for (const s of seatsFor(link, op.to)) changeLp(d, s, -amount(d, link, op.n))
      return
    case "heal":
      for (const s of seatsFor(link, op.to)) changeLp(d, s, amount(d, link, op.n))
      return
    case "draw":
      for (const s of seatsFor(link, op.to)) for (let i = 0; i < op.n; i++) drawOne(d, s)
      return
    case "destroy":
      destroy(d, resolveWhat(d, link, op.what), "effect")
      return
    case "bounce":
    case "banish":
    case "shuffle":
      for (const uid of resolveWhat(d, link, op.what)) {
        const at = where(d, uid)
        if (!at) continue
        const id = d.cards[uid].id
        const to = op.op === "bounce" ? "hand" : op.op === "banish" ? "ban" : "deck"
        log(d, `${nameOf(d, uid)} ${to === "hand" ? "returns to the hand" : to === "ban" ? "is banished" : "is shuffled into the Deck"}.`)
        fx(d, to === "hand" ? "bounce" : "banish", { uid, id, seat: at.seat })
        send(d, uid, to)
      }
      return
    case "buff":
      for (const uid of resolveWhat(d, link, op.what)) {
        const at = monsterAt(d, uid)
        if (!at || !at.slot.up) continue
        const atk = op.atk === "half" ? -Math.floor(statsOf(d, uid).atk / 2) : op.atk || 0
        at.slot.mods.push({ atk, def: op.def || 0, until: op.until === "turn" ? d.turn : null })
        fx(d, "buff", { uid, atk, def: op.def || 0 })
        const parts = [atk && `${atk > 0 ? "+" : ""}${atk} ATK`, op.def && `${op.def > 0 ? "+" : ""}${op.def} DEF`].filter(Boolean)
        log(d, `${nameOf(d, uid)}: ${parts.join(", ")}${op.until === "turn" ? " this turn" : ""}.`)
      }
      return
    case "flag":
      for (const uid of resolveWhat(d, link, op.what)) {
        const at = monsterAt(d, uid)
        if (at) at.slot.flags.push({ f: op.flag, until: op.until === "turn" ? d.turn : null })
      }
      return
    case "position":
      for (const uid of resolveWhat(d, link, op.what)) changePosition(d, uid, op.to)
      return
    case "search": {
      const options = select(d, seat, { from: op.from, side: "self", filter: op.filter })
      if (!options.length) {
        if (op.from === "deck") log(d, `${d.names[seat]} has nothing to add.`)
        return
      }
      if (link.answer === undefined) return ask(d, link, { options, min: 1, max: op.n || 1, title: `Add ${op.n > 1 ? `${op.n} cards` : "a card"} to your hand from your ${op.from === "gy" ? "Graveyard" : "Deck"}` })
      for (const uid of link.answer) {
        const id = d.cards[uid].id
        log(d, `${d.names[seat]} adds ${CARD[id].name} to their hand.`)
        const now = send(d, uid, "hand")
        fx(d, "tohand", { uid: now, id, seat, from: op.from })
      }
      if (op.from === "deck" && !d.stacked) shuffle(d.p[seat].deck)
      return
    }
    case "special": {
      const room = ZONES - d.p[seat].m.filter(Boolean).length
      if (!room) return
      const options = select(d, seat, { from: op.from, side: op.side || "self", filter: op.filter }).filter((u) => !CARD[d.cards[u].id].extra)
      if (!options.length) return
      if (link.answer === undefined) return ask(d, link, { options, min: 1, max: Math.min(op.n || 1, room), title: `Special Summon from your ${op.from === "gy" ? "Graveyard" : op.from === "hand" ? "hand" : "Deck"}` })
      const done = []
      for (const uid of link.answer) {
        const from = where(d, uid)?.zone
        if (place(d, seat, uid, op.pos === "def" ? "def" : "atk", true, "special")) {
          done.push(uid)
          log(d, `${d.names[seat]} Special Summons ${nameOf(d, uid)}${from === "gy" ? " from the Graveyard" : ""}.`)
        }
      }
      if (op.from === "deck" && !d.stacked) shuffle(d.p[seat].deck)
      if (done.length) summoned(d, done, seat, "special")
      return
    }
    case "summon": {
      const done = []
      for (const uid of resolveWhat(d, link, op.what)) {
        if (place(d, seat, uid, op.pos === "def" ? "def" : "atk", true, "special")) {
          done.push(uid)
          log(d, `${d.names[seat]} Special Summons ${nameOf(d, uid)}.`)
        }
      }
      if (done.length) summoned(d, done, seat, "special")
      return
    }
    case "summonSelf": {
      if (d.cards[src] && !onField(d, src) && place(d, seat, src, op.pos === "def" ? "def" : "atk", true, "special")) {
        log(d, `${d.names[seat]} Special Summons ${nameOf(d, src)}.`)
        summoned(d, [src], seat, "special")
      }
      return
    }
    case "token": {
      const done = []
      for (let i = 0; i < op.n; i++) {
        if (freeZone(d.p[seat].m) < 0) break
        const uid = newUid(d, op.id, seat)
        d.p[seat].hand.push(uid)
        place(d, seat, uid, op.pos === "def" ? "def" : "atk", true, "token")
        done.push(uid)
      }
      if (done.length) {
        log(d, `${d.names[seat]} Special Summons ${done.length} ${CARD[op.id].name}${done.length > 1 ? "s" : ""}.`)
        summoned(d, done, seat, "special")
      }
      return
    }
    case "discard": {
      for (const s of seatsFor(link, op.who)) {
        const hand = d.p[s].hand
        if (!hand.length) continue
        const n = Math.min(op.n || 1, hand.length)
        if (op.random) {
          const picks = shuffle([...hand]).slice(0, n)
          discardCards(d, s, picks)
        } else if (hand.length <= n) discardCards(d, s, [...hand])
        else {
          if (link.answer === undefined) return ask(d, link, { seat: s, options: [...hand], min: n, max: n, title: `Discard ${n} card${n > 1 ? "s" : ""}` })
          discardCards(d, s, link.answer)
        }
      }
      return
    }
    case "mill":
      for (const s of seatsFor(link, op.who)) {
        const cards = d.p[s].deck.slice(0, op.n)
        for (const uid of cards) {
          const id = d.cards[uid].id
          const now = send(d, uid, "gy")
          fx(d, "mill", { uid: now, id, seat: s })
        }
        if (cards.length) log(d, `${d.names[s]} sends ${cards.length} card${cards.length > 1 ? "s" : ""} from the top of their Deck to the Graveyard.`)
      }
      return
    case "negate": {
      const idx = d.chain.indexOf(link)
      const prev = d.chain[idx - 1]
      if (!prev) return
      prev.negated = true
      log(d, `${CARD[prev.id].name} is negated!`)
      fx(d, "negate", { uid: prev.uid, id: prev.id })
      if (op.destroy && onField(d, prev.uid)) {
        if (prev.kind === "monster") destroy(d, [prev.uid], "effect")
        else {
          const at = where(d, prev.uid)
          fx(d, "destroy", { uid: prev.uid, id: prev.id, seat: at.seat, zone: at.zone, i: at.i })
          send(d, prev.uid, "gy")
        }
      }
      return
    }
    case "negateAttack":
      if (d.battle) {
        d.battle.negated = true
        log(d, "The attack is negated.")
        fx(d, "negateAttack", { uid: d.battle.att })
      }
      return
    case "endBattle":
      if (d.battle) d.battle.negated = true
      if (d.phase === "battle") d.endBattle = true
      log(d, "The attack is stopped, and the Battle Phase ends.")
      return
    case "equip": {
      const target = resolveWhat(d, link, "targets")[0]
      const at = where(d, src)
      if (!target || !at || !FIELD.includes(at.zone) || !monsterAt(d, target)?.slot.up) return
      at.slot.eq = target
      log(d, `${nameOf(d, src)} is equipped to ${nameOf(d, target)}.`)
      fx(d, "equip", { uid: src, target })
      return
    }
    case "control":
      for (const uid of resolveWhat(d, link, op.what)) {
        const at = monsterAt(d, uid)
        if (!at || at.seat === seat) continue
        const zone = freeZone(d.p[seat].m)
        if (zone < 0) continue
        d.p[at.seat].m[at.i] = null
        at.slot.borrow = at.slot.borrow ? { ...at.slot.borrow, until: d.turn } : { from: at.seat, until: d.turn }
        if (at.slot.borrow.from === seat) at.slot.borrow = null
        d.p[seat].m[zone] = at.slot
        at.slot.moved = false
        log(d, `${d.names[seat]} takes control of ${nameOf(d, uid)}.`)
        fx(d, "control", { uid, seat })
      }
      return
    case "fusion": {
      const options = fusionOptions(d, seat)
      if (!options.length) return
      if (link.answer === undefined) return ask(d, link, { options, min: 1, max: 1, title: "Choose a Fusion Monster to Summon" })
      const uid = link.answer[0]
      const mats = fusionMaterials(d, seat, CARD[d.cards[uid].id])
      if (!mats) return
      for (const m of mats) {
        log(d, `${nameOf(d, m)} is sent to the Graveyard as Fusion Material.`)
        fx(d, "fuse", { uid: m, id: d.cards[m].id, seat })
        send(d, m, "gy")
      }
      if (place(d, seat, uid, "atk", true, "fusion")) {
        log(d, `${d.names[seat]} Fusion Summons ${nameOf(d, uid)}!`)
        summoned(d, [uid], seat, "special")
      }
      return
    }
    case "coin": {
      const heads = rand() < 0.5
      log(d, `The coin lands ${heads ? "heads" : "tails"}.`)
      fx(d, "coin", { heads })
      for (const sub of (heads ? op.heads : op.tails) || []) if (sub.op !== "search" && sub.op !== "special" && sub.op !== "fusion") runOp(d, { ...link, answer: [] }, sub)
      return
    }
  }
}

const changePosition = (d, uid, to) => {
  const at = monsterAt(d, uid)
  if (!at) return
  const slot = at.slot
  const wasDown = !slot.up
  if (to === "down") {
    if (!slot.up) return
    slot.up = false
    slot.pos = "def"
    slot.mods = []
    slot.flags = []
    log(d, `${nameOf(d, uid)} is turned face-down.`)
    fx(d, "position", { uid, seat: at.seat, pos: "def", up: false })
    return
  }
  const pos = to === "swap" ? (slot.pos === "atk" ? "def" : "atk") : to
  if (pos === slot.pos && slot.up) return
  slot.pos = pos
  if (wasDown && pos === "atk") slot.up = true
  log(d, `${slot.up ? nameOf(d, uid) : "A face-down monster"} changes to ${pos === "atk" ? "Attack" : "Defense"} Position.`)
  fx(d, "position", { uid, seat: at.seat, pos, up: slot.up, id: slot.up ? d.cards[uid].id : undefined })
  if (wasDown && slot.up) queueTriggers(d, uid, "flip")
}

// ---------- fusion ----------

// the materials (cards in hand or monsters on the field) for this Fusion Monster, or null
const fusionMaterials = (d, seat, def, exclude = null) => {
  const p = d.p[seat]
  const pool = [...p.hand.filter((u) => u !== exclude && defOf(d, u).kind === "monster"), ...p.m.filter((x) => x?.up).map((x) => x.uid)]
  const used = []
  // specific cards first, then the "any X" materials, cheapest first
  const needs = [...def.materials].sort((a, b) => (typeof a === "string" ? 0 : 1) - (typeof b === "string" ? 0 : 1))
  for (const need of needs) {
    const fits = pool.filter((u) => !used.includes(u) && (typeof need === "string" ? d.cards[u].id === need : matches(d, u, { kind: "monster", ...need }) || matchesHand(d, u, need)))
    fits.sort((a, b) => (p.hand.includes(a) ? 0 : 1) - (p.hand.includes(b) ? 0 : 1) || defOf(d, a).atk - defOf(d, b).atk)
    if (!fits.length) return null
    used.push(fits[0])
  }
  const freed = used.filter((u) => monsterAt(d, u)).length
  if (freeZone(p.m) < 0 && !freed) return null
  return used
}
const matchesHand = (d, uid, need) => {
  const def = defOf(d, uid)
  return def.kind === "monster" && (!need.race || def.race === need.race) && (!need.attr || def.attr === need.attr)
}
export const fusionOptions = (d, seat, exclude = null) => d.p[seat].extra.filter((u) => fusionMaterials(d, seat, defOf(d, u), exclude))

// ---------- battle ----------

const canAttack = (d, uid) => {
  const at = monsterAt(d, uid)
  if (!at || !at.slot.up || at.slot.pos !== "atk") return false
  const st = statsOf(d, uid)
  if (st.flags.includes("cannotAttack")) return false
  return at.slot.attacks < (st.flags.includes("twice") ? 2 : 1)
}
// who `uid` may attack: monster uids, plus null for a direct attack
export const attackTargets = (d, uid) => {
  const at = monsterAt(d, uid)
  if (!at || !canAttack(d, uid)) return []
  const theirs = d.p[other(at.seat)].m.filter(Boolean).map((x) => x.uid)
  const direct = !theirs.length || statsOf(d, uid).flags.includes("direct")
  return direct ? [...theirs, null] : theirs
}

const stepBattle = (d) => {
  const b = d.battle
  if (b.stage === "declare") {
    b.stage = "window"
    d.recent = { kind: "attack", seat: b.seat, uids: [b.att] }
    if (openWindow(d, other(b.seat), "attack")) return WAIT
    return
  }
  // the damage step
  d.battle = null
  d.recent = null
  const finishBattle = () => {
    if (d.endBattle) {
      d.endBattle = false
      d.phase = "main2"
      fx(d, "phase", { phase: "main2" })
    }
  }
  const at = monsterAt(d, b.att)
  if (b.negated || !at || at.seat !== b.seat || at.slot.pos !== "atk" || !at.slot.up) return finishBattle()
  const foe = other(b.seat)
  if (b.tgt === null ? d.p[foe].m.some(Boolean) && !hasFlag(d, b.att, "direct") : monsterAt(d, b.tgt)?.seat !== foe) {
    // the target left (or a monster appeared): the attacker may attack again
    at.slot.attacks--
    log(d, "The attack target changed: the attack is replayed.")
    return finishBattle()
  }
  const atk = statsOf(d, b.att).atk
  if (b.tgt === null) {
    log(d, `${nameOf(d, b.att)} attacks directly!`)
    fx(d, "hit", { att: b.att, tgt: null, seat: foe })
    changeLp(d, foe, -atk)
    if (atk > 0) queueTriggers(d, b.att, "battleDamage")
    return finishBattle()
  }
  const t = monsterAt(d, b.tgt)
  if (!t.slot.up) {
    t.slot.up = true
    log(d, `${nameOf(d, b.tgt)} is flipped face-up.`)
    fx(d, "flip", { uid: b.tgt, id: d.cards[b.tgt].id, seat: foe })
    queueTriggers(d, b.tgt, "flip")
  }
  const ts = statsOf(d, b.tgt)
  const attName = nameOf(d, b.att)
  const tgtName = nameOf(d, b.tgt)
  fx(d, "hit", { att: b.att, tgt: b.tgt, seat: foe })
  const pierce = statsOf(d, b.att).flags.includes("pierce")
  if (t.slot.pos === "atk") {
    log(d, `${attName} (${atk}) battles ${tgtName} (${ts.atk}).`)
    if (atk > ts.atk) {
      const won = destroy(d, [b.tgt], "battle").length
      changeLp(d, foe, -(atk - ts.atk))
      queueTriggers(d, b.att, "battleDamage")
      if (won) queueTriggers(d, b.att, "battleDestroy")
    } else if (atk < ts.atk) {
      const won = destroy(d, [b.att], "battle").length
      changeLp(d, b.seat, -(ts.atk - atk))
      if (won && monsterAt(d, b.tgt)) queueTriggers(d, b.tgt, "battleDestroy")
    } else if (atk > 0) destroy(d, [b.att, b.tgt], "battle")
  } else {
    log(d, `${attName} (${atk}) attacks ${tgtName} (DEF ${ts.def}).`)
    if (atk > ts.def) {
      const won = destroy(d, [b.tgt], "battle").length
      if (pierce) {
        changeLp(d, foe, -(atk - ts.def))
        queueTriggers(d, b.att, "battleDamage")
      }
      if (won) queueTriggers(d, b.att, "battleDestroy")
    } else if (atk < ts.def) changeLp(d, b.seat, -(ts.def - atk))
  }
  finishBattle()
}

// ---------- response windows ----------

// give `seat` the chance to respond (if they can, or always want to be asked) -> true if
// we now wait for them
const openWindow = (d, seat, reason) => {
  if (d.summonWin && seat !== d.summonWin.seat) d.summonWin = null
  const pref = d.prefs?.[seat] || "auto"
  if (pref === "never") return false
  const can = activations(d, seat, "respond").length > 0
  if (!can && pref !== "always") return false
  d.wait = { kind: "respond", seat, reason, stamp: ++d.stamp }
  return true
}

// ---------- the automatic parts ----------

export const advance = (d) => {
  for (let guard = 0; guard < 400; guard++) {
    checkWin(d)
    if (d.over) {
      d.wait = null
      return
    }
    if (d.wait) return
    if (d.chain.length && d.resolving) {
      if (resolveTop(d) === WAIT) return
      if (!d.chain.length) d.resolving = false
      continue
    }
    if (d.chain.length) {
      const s = d.chainWin
      d.chainWin = null
      if (s != null && openWindow(d, s, "chain")) return
      d.resolving = true
      continue
    }
    if (d.queue.length) {
      if (buildFromQueue(d) === WAIT) return
      continue
    }
    if (d.summonWin) {
      const sw = d.summonWin
      d.summonWin = null
      if (openWindow(d, other(sw.seat), "summon")) return
      continue
    }
    if (d.battle) {
      if (stepBattle(d) === WAIT) return
      continue
    }
    if (d.phaseWin) {
      const reason = d.phaseWin
      d.phaseWin = null
      if (openWindow(d, other(d.active), reason)) return
      continue
    }
    d.recent = null
    if (d.phase === "draw") {
      if (d.turn > 1) drawOne(d, d.active)
      d.phase = "standby"
      fx(d, "phase", { phase: "standby" })
      for (const slot of [...d.p[d.active].m, ...d.p[d.active].s, d.p[d.active].f]) if (slot?.up) queueTriggers(d, slot.uid, "standby")
      continue
    }
    if (d.phase === "standby") {
      d.phase = "main1"
      fx(d, "phase", { phase: "main1" })
      continue
    }
    if (d.phase === "end") {
      if (d.endStep === 0) {
        d.endStep = 1
        if (openWindow(d, other(d.active), "end")) return
        continue
      }
      if (d.endStep === 1) {
        d.endStep = 2
        const extra = d.p[d.active].hand.length - HAND_LIMIT
        if (extra > 0) {
          d.wait = { kind: "discard", seat: d.active, options: [...d.p[d.active].hand], min: extra, max: extra, title: `Your hand is over ${HAND_LIMIT} cards: discard ${extra}`, stamp: ++d.stamp }
          return
        }
        continue
      }
      endOfTurn(d)
      startTurn(d, other(d.active))
      continue
    }
    return
  }
}

// ---------- what a seat may do ----------

// the main and battle phase moves, for the turn player with nothing pending
const freeMoves = (d, seat) => {
  const out = []
  const p = d.p[seat]
  const main = isMain(d)
  if (main) {
    const zonesFree = p.m.filter((x) => !x).length
    const mine = p.m.filter(Boolean).map((x) => x.uid)
    for (const uid of p.hand) {
      const def = defOf(d, uid)
      if (def.kind === "monster") {
        if (p.summoned) continue
        const need = tributesNeeded(def)
        if (mine.length < need) continue
        if (need === 0 && !zonesFree) continue
        out.push({ type: "summon", uid, tributes: need, options: need ? mine : [] })
        out.push({ type: "set", uid, tributes: need, options: need ? mine : [] })
      } else if (freeZone(p.s) >= 0 || def.sub === "field") out.push({ type: "set", uid })
    }
    for (const slot of p.m) {
      if (!slot) continue
      if (!slot.up && slot.turn < d.turn && !slot.moved) out.push({ type: "flip", uid: slot.uid })
      else if (slot.up && slot.turn < d.turn && !slot.moved && !slot.attacks) out.push({ type: "position", uid: slot.uid })
    }
  }
  if (d.phase === "battle") {
    for (const slot of p.m) {
      if (!slot) continue
      const targets = attackTargets(d, slot.uid)
      if (targets.length) out.push({ type: "attack", uid: slot.uid, targets })
    }
  }
  if (d.phase === "main1" && d.turn > 1) out.push({ type: "phase", to: "battle" })
  if (d.phase === "battle") out.push({ type: "phase", to: "main2" })
  out.push({ type: "phase", to: "end" })
  return out
}

// everything `seat` may do right now (the client builds its buttons from this)
export const legal = (d, seat) => {
  if (d.over || seat == null) return []
  if (d.wait) {
    if (d.wait.seat !== seat) return []
    if (d.wait.kind === "respond") return [...activations(d, seat, "respond").map(activationMove), { type: "pass" }]
    return [{ type: "choose", options: d.wait.options, min: d.wait.min, max: d.wait.max }]
  }
  const mode = modeFor(d, seat)
  if (mode !== "free") return []
  return [...freeMoves(d, seat), ...activations(d, seat, "free").map(activationMove)]
}
const activationMove = (a) => ({ type: "activate", uid: a.uid, ei: a.ei, targets: a.targets, min: a.min, max: a.max, cost: a.cost.discard || null })

// ---------- acting ----------

const err = (error) => ({ error })

// a move by `seat`: mutates d -> { ok: true } or { error }
export const act = (d, seat, action) => {
  if (!action || typeof action !== "object") return err("That isn't a move.")
  if (d.over) return err("The duel is over.")
  if (action.type === "surrender") {
    d.over = { winner: other(seat), reason: "surrender" }
    d.wait = null
    log(d, `${d.names[seat]} surrenders.`)
    return { ok: true }
  }
  const result = actInner(d, seat, action)
  if (result.error) return result
  advance(d)
  return { ok: true }
}

const actInner = (d, seat, action) => {
  const w = d.wait
  if (w) {
    if (w.seat !== seat) return err("Waiting for your opponent.")
    if (action.type === "pass" && w.kind === "respond") {
      d.wait = null
      if (w.reason === "chain") d.resolving = true
      return { ok: true }
    }
    if (action.type === "activate" && w.kind === "respond") {
      const a = activation(d, seat, action.uid, action.ei | 0, "respond")
      if (!a) return err("You can't activate that now.")
      const saved = d.wait
      d.wait = null
      const r = activate(d, seat, a, action)
      if (r.error) d.wait = saved
      return r
    }
    if (action.type === "choose" && w.kind !== "respond") {
      const picks = [...new Set(Array.isArray(action.picks) ? action.picks : [])]
      if (picks.length < w.min || picks.length > w.max || picks.some((u) => !w.options.includes(u))) return err(w.min === w.max ? `Choose ${w.min}.` : `Choose ${w.min} to ${w.max}.`)
      d.wait = null
      return answer(d, w, picks)
    }
    return err(w.kind === "respond" ? "Respond or pass first." : "Make your choice first.")
  }
  if (modeFor(d, seat) !== "free") return err(seat === d.active ? "Wait a moment." : "It's not your turn.")
  const p = d.p[seat]
  switch (action.type) {
    case "activate": {
      const a = activation(d, seat, action.uid, action.ei | 0, "free")
      if (!a) return err("You can't activate that now.")
      return activate(d, seat, a, action)
    }
    case "summon":
    case "set": {
      const uid = action.uid
      if (!p.hand.includes(uid)) return err("That card isn't in your hand.")
      const def = defOf(d, uid)
      if (!isMain(d)) return err("You can only do that in a Main Phase.")
      if (def.kind !== "monster") {
        if (action.type !== "set") return err("Activate it or set it.")
        if (def.sub === "field") {
          if (p.f) send(d, p.f.uid, "gy")
          take(d, uid)
          p.f = { uid, up: false, turn: d.turn, eq: null }
        } else {
          const zone = freeZone(p.s)
          if (zone < 0) return err("Your Spell & Trap Zones are full.")
          take(d, uid)
          p.s[zone] = { uid, up: false, turn: d.turn, eq: null }
        }
        fx(d, "set", { uid, seat, kind: "st" }, seat, { id: def.id })
        log(d, `${d.names[seat]} sets a card.`, seat, `You set ${def.name}.`)
        return { ok: true }
      }
      if (p.summoned) return err("You already Normal Summoned or Set a monster this turn.")
      const need = tributesNeeded(def)
      const tributes = [...new Set(Array.isArray(action.tributes) ? action.tributes : [])]
      if (tributes.length !== need) return err(need ? `Tribute ${need} monster${need > 1 ? "s" : ""} to Summon this card.` : "This card doesn't need tributes.")
      if (tributes.some((u) => monsterAt(d, u)?.seat !== seat)) return err("Tribute monsters you control.")
      if (!need && freeZone(p.m) < 0) return err("Your Monster Zones are full.")
      for (const u of tributes) {
        log(d, `${d.names[seat]} tributes ${monsterAt(d, u).slot.up ? nameOf(d, u) : "a face-down monster"}.`)
        fx(d, "tribute", { uid: u, id: d.cards[u].id, seat })
        send(d, u, "gy")
      }
      p.summoned = true
      if (action.type === "summon") {
        place(d, seat, uid, "atk", true, "normal")
        log(d, `${d.names[seat]} ${need ? "Tribute " : "Normal "}Summons ${def.name}.`)
        summoned(d, [uid], seat, "normal")
      } else {
        place(d, seat, uid, "def", false, "set")
        log(d, `${d.names[seat]} sets a monster.`, seat, `You set ${def.name}.`)
      }
      return { ok: true }
    }
    case "flip": {
      const at = monsterAt(d, action.uid)
      if (!at || at.seat !== seat || at.slot.up) return err("Flip one of your face-down monsters.")
      if (!isMain(d)) return err("You can only do that in a Main Phase.")
      if (at.slot.turn >= d.turn || at.slot.moved) return err("You can't Flip Summon that monster this turn.")
      at.slot.up = true
      at.slot.pos = "atk"
      at.slot.moved = true
      const def = defOf(d, action.uid)
      log(d, `${d.names[seat]} Flip Summons ${def.name}.`)
      fx(d, "flip", { uid: action.uid, id: def.id, seat })
      summoned(d, [action.uid], seat, "flip")
      return { ok: true }
    }
    case "position": {
      const at = monsterAt(d, action.uid)
      if (!at || at.seat !== seat || !at.slot.up) return err("Pick one of your face-up monsters.")
      if (!isMain(d)) return err("You can only do that in a Main Phase.")
      if (at.slot.turn >= d.turn || at.slot.moved || at.slot.attacks) return err("You can't change that monster's position this turn.")
      at.slot.moved = true
      changePosition(d, action.uid, "swap")
      return { ok: true }
    }
    case "attack": {
      if (d.phase !== "battle") return err("Attacks happen in the Battle Phase.")
      const targets = attackTargets(d, action.uid)
      const tgt = action.target ?? null
      if (!targets.length) return err("That monster can't attack.")
      if (!targets.includes(tgt)) return err(tgt === null ? "You can't attack directly while your opponent has monsters." : "Pick a monster your opponent controls.")
      monsterAt(d, action.uid).slot.attacks++
      d.battle = { att: action.uid, tgt, seat, stage: "declare", negated: false }
      const tgtName = tgt === null ? "directly" : monsterAt(d, tgt).slot.up ? `${nameOf(d, tgt)}` : "a face-down monster"
      log(d, `${nameOf(d, action.uid)} attacks ${tgtName}.`)
      fx(d, "attack", { att: action.uid, tgt, seat })
      return { ok: true }
    }
    case "phase": {
      const to = action.to
      const ok = (d.phase === "main1" && (to === "end" || (to === "battle" && d.turn > 1))) || (d.phase === "battle" && (to === "main2" || to === "end")) || (d.phase === "main2" && to === "end")
      if (!ok) return err(to === "battle" && d.turn === 1 ? "The first player can't attack on the first turn." : "You can't go to that phase now.")
      d.phase = to
      fx(d, "phase", { phase: to })
      log(d, `${d.names[seat]} enters the ${PHASE_NAMES[to]} Phase.`)
      if (to === "battle") d.phaseWin = "battle"
      return { ok: true }
    }
  }
  return err("That isn't a move.")
}

// an answer to d.wait (already checked and cleared)
const answer = (d, w, picks) => {
  if (w.kind === "target") {
    const t = d.queue.shift()
    pushLink(d, linkFor(d, t.seat, t.uid, t.ei, picks, true))
    return { ok: true }
  }
  if (w.kind === "discard") {
    discardCards(d, w.seat, picks)
    return { ok: true }
  }
  // "choose": the link that asked carries on with the answer
  const link = d.chain[d.chain.length - 1]
  link.answer = picks
  return { ok: true }
}

export const setPref = (d, seat, pref) => {
  if (["always", "auto", "never"].includes(pref)) d.prefs[seat] = pref
}

// A computer-ish answer to whatever `seat` is being asked (timeouts and auto-play):
// pass, or the first sensible picks
export const autoAnswer = (d, seat) => {
  const w = d.wait
  if (!w || w.seat !== seat) return null
  if (w.kind === "respond") return { type: "pass" }
  return { type: "choose", picks: w.options.slice(0, w.min || 1) }
}

// ---------- views ----------

const slotView = (d, slot, owner, seat, zone) => {
  if (!slot) return null
  const info = d.cards[slot.uid]
  const known = slot.up || owner === seat
  const base = { uid: slot.uid, up: slot.up, owner: info.owner }
  if (zone === "m") {
    base.pos = slot.pos
    base.attacks = slot.attacks
    base.fresh = slot.turn === d.turn
    base.moved = slot.moved
    if (slot.borrow) base.borrowed = true
  } else if (slot.eq) base.eq = slot.eq
  if (!known) return base
  base.id = info.id
  if (zone === "m") {
    const st = statsOf(d, slot.uid)
    base.atk = st.atk
    base.def = st.def
    base.flags = st.flags
  }
  return base
}

const cardView = (d, uid) => ({ uid, id: d.cards[uid].id })

// what `seat` may see (null: a spectator, who sees what both players see publicly)
export const view = (d, seat) => ({
  turn: d.turn,
  active: d.active,
  first: d.first,
  phase: d.phase,
  names: d.names,
  startLp: d.startLp,
  players: d.p.map((p, s) => ({
    lp: p.lp,
    deck: p.deck.length,
    hand: s === seat ? p.hand.map((u) => cardView(d, u)) : p.hand.length,
    gy: p.gy.map((u) => cardView(d, u)),
    ban: p.ban.map((u) => cardView(d, u)),
    extra: s === seat ? p.extra.map((u) => cardView(d, u)) : p.extra.length,
    m: p.m.map((x) => slotView(d, x, s, seat, "m")),
    s: p.s.map((x) => slotView(d, x, s, seat, "s")),
    f: slotView(d, p.f, s, seat, "f"),
    summoned: p.summoned,
  })),
  chain: d.chain.map((l) => ({ uid: l.uid, id: l.id, seat: l.seat, negated: l.negated, targets: l.targets })),
  battle: d.battle && { att: d.battle.att, tgt: d.battle.tgt, seat: d.battle.seat },
  wait: d.wait && {
    kind: d.wait.kind,
    seat: d.wait.seat,
    reason: d.wait.reason || null,
    title: d.wait.seat === seat ? d.wait.title || null : null,
    min: d.wait.min,
    max: d.wait.max,
    stamp: d.wait.stamp,
    // what the chooser picks from (cards from a deck are only shown to them)
    options: d.wait.seat === seat && d.wait.options ? d.wait.options.map((u) => ({ uid: u, id: d.cards[u]?.id, zone: where(d, u)?.zone })) : undefined,
  },
  fx: d.fx.map((f) => {
    const { ps, p, ...pub } = f
    return ps === seat && p ? { ...pub, ...p } : pub
  }),
  log: d.log.map((l) => ({ n: l.n, t: l.s === seat && l.m ? l.m : l.t })),
  seq: d.seq,
  over: d.over,
})
