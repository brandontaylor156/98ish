// Monster Duel's computer players. They see only what a player in their seat would see:
// their own hand and set cards, and the public parts of the field. To weigh a move they
// try it on a copy of the duel (the engine is pure) with the opponent passing, then score
// the result with evalFor(), which also only looks at public information. Attacks are
// judged by hand (simulating them would peek at face-down monsters).
//
// level: "easy" (misses things, attacks recklessly), "normal", "hard" (no mistakes, uses
// tricks in battle); style: "balanced" | "aggro" (loves damage) | "defensive" (sets, walls)
// | "trickster" (traps first)

import { CARD } from "./cards.js"
import { act, attackTargets, autoAnswer, legal, statsOf, where } from "./engine.js"

const other = (s) => 1 - s
const clone = (x) => (typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x)))

export const LEVELS = ["easy", "normal", "hard"]
export const STYLES = ["balanced", "aggro", "defensive", "trickster"]

// how much a card is worth having (in hand, in a deck search...)
export const cardValue = (id) => {
  const c = CARD[id]
  if (!c) return 0
  if (c.kind === "monster") {
    const lv = c.level || 1
    const tribute = lv >= 7 ? 2 : lv >= 5 ? 1 : 0
    return c.atk * 0.6 + c.def * 0.2 + (c.effects || c.flags ? 250 : 0) - tribute * 350 + 300
  }
  const strong = ["G01", "G02", "G03", "G04", "G06", "G13", "T01", "T03"]
  return strong.includes(id) ? 1500 : c.kind === "trap" ? 700 : 800
}

// ---------- scoring a position (public information only) ----------

const lpValue = (lp, w) => (lp <= 0 ? -1e6 : lp * w + (lp < 2000 ? -(2000 - lp) * 0.5 : 0))

// the ATK a monster keeps after this turn (boosts that end this turn don't count)
const lastingAtk = (d, slot) => statsOf(d, slot.uid).atk - slot.mods.filter((m) => m.until === d.turn).reduce((a, m) => a + (m.atk || 0), 0)

export const evalFor = (d, seat, style = "balanced") => {
  if (d.over) return d.over.winner === seat ? 1e7 : d.over.winner == null ? 0 : -1e7
  const me = d.p[seat]
  const op = d.p[other(seat)]
  const dmgW = style === "aggro" ? 0.75 : 0.6
  let score = lpValue(me.lp, 0.6) - lpValue(op.lp, dmgW)
  const theirs = op.m.filter((x) => x?.up && x.pos === "atk").map((x) => statsOf(d, x.uid).atk)
  const threat = Math.max(0, ...theirs)
  const threatW = style === "defensive" ? 1.5 : style === "aggro" ? 0.7 : 1
  for (const slot of me.m) {
    if (!slot) continue
    const def = CARD[d.cards[slot.uid].id]
    const st = statsOf(d, slot.uid)
    const atk = slot.up ? lastingAtk(d, slot) : def.atk
    const dfn = slot.up ? st.def : def.def
    let v = 450 + (slot.pos === "atk" ? atk : Math.max(atk * 0.55, dfn * 0.75))
    if (slot.pos === "atk" && threat > atk && !st.flags.includes("noBattleDestroy")) v -= (v * 0.6 + (threat - atk) * 0.6) * threatW
    if (slot.pos === "def" && threat > dfn && !st.flags.includes("noBattleDestroy")) v -= v * 0.35 * threatW
    if (slot.borrow) v *= 0.3
    score += v
  }
  for (const slot of op.m) {
    if (!slot) continue
    if (!slot.up) score -= 450 + 1100
    else {
      const st = statsOf(d, slot.uid)
      score -= 450 + (slot.pos === "atk" ? st.atk : Math.max(st.atk * 0.55, st.def * 0.75)) + (slot.borrow ? -800 : 0)
    }
  }
  score += me.hand.length * 330 - op.hand.length * 330
  for (const slot of [...me.s, me.f]) if (slot) score += slot.up ? 350 : 380
  for (const slot of [...op.s, op.f]) if (slot) score -= slot.up ? 350 : 380
  score += Math.min(me.deck.length, 5) * 40 - Math.min(op.deck.length, 5) * 40
  return score
}

// ---------- trying moves on a copy ----------

// a quick pick for a prompt (no simulation): the best cards to get, the worst to lose
const quickChoice = (d, seat) => {
  const w = d.wait
  if (!w || w.seat !== seat) return null
  if (w.kind === "respond") return { type: "pass" }
  const n = w.min || 1
  const p = d.p[seat]
  const scored = w.options.map((u) => {
    const at = where(d, u)
    const id = d.cards[u].id
    let v = cardValue(id)
    if (w.kind === "discard" || (at?.zone === "hand" && /discard/i.test(w.title || ""))) v = -v
    else if (at && ["m", "s", "f"].includes(at.zone)) {
      const known = at.slot.up || at.seat === seat
      const base = at.zone === "m" && known ? statsOf(d, u).atk + 500 : 1200
      v = at.seat === seat ? base * 0.2 : base
    }
    return { u, v: v + (p.hand.includes(u) && w.kind !== "discard" ? 0 : 0) }
  })
  scored.sort((a, b) => b.v - a.v)
  return { type: "choose", picks: scored.slice(0, n).map((s) => s.u) }
}

// apply a move to a copy, let things play out (the opponent passes) -> the copy, or null
export const simulate = (d, seat, move) => {
  const c = clone(d)
  const r = act(c, seat, move)
  if (r.error) return null
  for (let i = 0; i < 40 && !c.over && c.wait; i++) {
    const s = c.wait.seat
    const a = s === seat ? quickChoice(c, s) : autoAnswer(c, s)
    if (!a || act(c, s, a).error) break
  }
  return c
}

// the concrete moves behind a legal entry (one per target choice, tributes picked)
const expand = (d, seat, m, level) => {
  const p = d.p[seat]
  if (m.type === "activate") {
    const cost = m.cost ? m.cost.options.map((u) => ({ u, v: cardValue(d.cards[u].id) })).sort((a, b) => a.v - b.v).slice(0, m.cost.n).map((x) => x.u) : []
    if (!m.targets) return [{ type: "activate", uid: m.uid, ei: m.ei, cost }]
    if (m.max > 1) {
      // as many of the opponent's cards as allowed; our own only if the card needs more
      const ranked = rankTargets(d, seat, m.targets)
      const theirs = ranked.filter((u) => where(d, u)?.seat !== seat).slice(0, m.max)
      const picks = theirs.length >= m.min ? theirs : [...theirs, ...ranked.filter((u) => !theirs.includes(u))].slice(0, m.min)
      return [{ type: "activate", uid: m.uid, ei: m.ei, targets: picks, cost }]
    }
    const opts = level === "easy" ? m.targets.slice(0, 2) : m.targets.slice(0, 10)
    return opts.map((t) => ({ type: "activate", uid: m.uid, ei: m.ei, targets: [t], cost }))
  }
  if ((m.type === "summon" || m.type === "set") && m.tributes) {
    // the weakest monsters go
    const fodder = m.options
      .map((u) => {
        const slot = p.m.find((x) => x?.uid === u)
        return { u, v: slot.up ? statsOf(d, u).atk + (slot.borrow ? -5000 : 0) : CARD[d.cards[u].id].atk }
      })
      .sort((a, b) => a.v - b.v)
    return [{ type: m.type, uid: m.uid, tributes: fodder.slice(0, m.tributes).map((x) => x.u) }]
  }
  if (m.type === "summon" || m.type === "set") return [{ type: m.type, uid: m.uid, tributes: [] }]
  return [m]
}

// opponent's best cards first, then ours
const rankTargets = (d, seat, uids) =>
  uids
    .map((u) => {
      const at = where(d, u)
      const mine = at?.seat === seat
      const known = at && (at.slot?.up || mine)
      const v = at?.zone === "m" && known ? statsOf(d, u).atk + 400 : at?.zone === "gy" ? cardValue(d.cards[u].id) : 1000
      return { u, v: mine ? v * 0.1 : v }
    })
    .sort((a, b) => b.v - a.v)
    .map((x) => x.u)

// ---------- battle ----------

// a guess at what's under a face-down monster
const HIDDEN_DEF = 1500

const attackValue = (d, seat, uid, tgt, style, level) => {
  const st = statsOf(d, uid)
  const atk = st.atk
  const foe = other(seat)
  if (tgt === null) return atk * (style === "aggro" ? 1 : 0.8) + 50
  const at = where(d, tgt)
  const slot = at.slot
  const myValue = 450 + atk
  if (!slot.up) {
    const guess = level === "easy" ? 1000 : HIDDEN_DEF
    if (atk > guess) return 1200 + (style === "aggro" ? 300 : 0)
    return style === "aggro" && atk >= 1500 ? 200 : -500
  }
  const ts = statsOf(d, tgt)
  const theirValue = 450 + Math.max(ts.atk, ts.def * 0.7)
  if (slot.pos === "atk") {
    if (atk > ts.atk) return theirValue + (atk - ts.atk) * 0.7
    if (atk === ts.atk) return atk > 0 && theirValue >= myValue ? 100 : -400
    return -(myValue + (ts.atk - atk))
  }
  if (atk > ts.def) return theirValue + (st.flags.includes("pierce") ? (atk - ts.def) * 0.7 : 0)
  if (atk === ts.def) return -50
  return -(ts.def - atk) * (foe === d.active ? 1 : 0.8) - 100
}

// a quick-play or trap that pumps one of our monsters enough to win this battle
const battleTrick = (d, seat, moves, uid, need) => {
  for (const m of moves) {
    if (m.type !== "activate" || !m.targets?.includes(uid)) continue
    const eff = CARD[d.cards[m.uid].id].effects[m.ei]
    const boost = (eff.do || []).find((o) => o.op === "buff" && o.what === "targets" && (o.atk || 0) >= need)
    if (boost) return { type: "activate", uid: m.uid, ei: m.ei, targets: [uid], cost: m.cost ? m.cost.options.slice(0, m.cost.n) : [] }
  }
  return null
}

const chooseAttack = (d, seat, moves, opts) => {
  const { style, level, random } = opts
  const attacks = moves.filter((m) => m.type === "attack")
  // an easy opponent sometimes just forgets to attack
  if (level === "easy" && attacks.length && random() < 0.15) return null
  let best = null
  const good = []
  for (const m of attacks) {
    let mine = null
    for (const tgt of m.targets) {
      let v = attackValue(d, seat, m.uid, tgt, style, level)
      if (level === "easy") v += (random() - 0.3) * 1200
      else if (level === "normal") v += (random() - 0.5) * 300
      if (!best || v > best.v) best = { v, uid: m.uid, tgt }
      if (!mine || v > mine.v) mine = { v, uid: m.uid, tgt }
    }
    if (mine && mine.v > 0) good.push(mine)
  }
  // a hard opponent facing set cards sends its weakest good attacker first, to spring traps
  const setCards = d.p[other(seat)].s.filter((x) => x && !x.up).length
  if (level === "probe" && setCards && good.length > 1) {
    good.sort((a, b) => statsOf(d, a.uid).atk - statsOf(d, b.uid).atk)
    best = good[0]
  }
  // a losing battle that a trick in hand would win
  if (level !== "easy" && attacks.length) {
    for (const m of attacks) {
      const atk = statsOf(d, m.uid).atk
      for (const tgt of m.targets) {
        if (tgt === null) continue
        const slot = where(d, tgt).slot
        if (!slot.up) continue
        const ts = statsOf(d, tgt)
        const wall = slot.pos === "atk" ? ts.atk : ts.def
        if (atk > wall) continue
        const trick = battleTrick(d, seat, moves, m.uid, wall - atk + 1)
        if (trick && (!best || best.v < 400)) return trick
      }
    }
  }
  if (best && best.v > 0) return { type: "attack", uid: best.uid, target: best.tgt }
  return null
}

// ---------- the decision ----------

// the move for `seat` in duel `d` -> a move, or null if there's nothing to do
export const chooseMove = (d, seat, { level = "normal", style = "balanced", random = Math.random } = {}) => {
  const moves = legal(d, seat)
  if (!moves.length) return null
  const opts = { level, style, random }
  const w = d.wait
  if (w && w.seat === seat) {
    if (w.kind !== "respond") return pickChoice(d, seat, opts)
    return pickResponse(d, seat, moves, opts)
  }
  if (d.phase === "battle") {
    const attack = chooseAttack(d, seat, moves, opts)
    if (attack) return attack
    const quick = bestActivation(d, seat, moves.filter((m) => m.type === "activate"), opts, 500)
    if (quick) return quick
    return { type: "phase", to: "main2" }
  }
  // main phases: the best improving move, else on to battle / end the turn
  const base = evalFor(d, seat, style)
  let best = null
  const fine = []
  const scored = []
  for (const m of moves) {
    if (m.type === "phase") continue
    if (m.type === "activate") {
      const def = CARD[d.cards[m.uid].id]
      // set traps wait for a better moment unless they're worth it now
      if (def.kind === "trap" && style !== "trickster" && level !== "easy") {
        const eff = def.effects[m.ei]
        if ((eff.do || []).some((o) => o.op === "buff" && o.until === "turn")) continue
      }
    }
    if (m.type === "set" && CARD[d.cards[m.uid].id].kind !== "monster") {
      const def = CARD[d.cards[m.uid].id]
      // set Traps and Quick-Play Spells; normal Spells are for using
      if (def.kind === "spell" && def.sub !== "quick") continue
    }
    for (const move of expand(d, seat, m, level)) {
      const after = simulate(d, seat, move)
      if (!after) continue
      let v = evalFor(after, seat, style) - base
      if (move.type === "set" && CARD[d.cards[move.uid].id].kind !== "monster") v += style === "trickster" ? 220 : 120
      if (move.type === "set" && CARD[d.cards[move.uid].id].kind === "monster" && style === "defensive") v += 120
      if (move.type === "summon" && style === "aggro") v += 120
      if (level === "easy") v += (random() - 0.5) * 700
      else if (level === "normal") v += (random() - 0.5) * 260
      if (!best || v > best.v) best = { v, move }
      if (v > 60) fine.push(move)
      if (level === "hard") scored.push({ v, move, after })
    }
  }
  // an easy opponent plays any decent move, not the best one
  if (level === "easy" && fine.length) return fine[Math.floor(random() * fine.length)]
  // a hard opponent looks one move further: the best first move of the best pair
  if (level === "hard" && scored.length > 1) {
    scored.sort((a, b) => b.v - a.v)
    let pick = null
    for (const first of scored.slice(0, 6)) {
      const next = bestFollowUp(first.after, seat, style)
      const v = Math.max(first.v, first.v + next)
      if (!pick || v > pick.v) pick = { v, move: first.move }
    }
    if (pick && pick.v > 30) return pick.move
  }
  const threshold = level === "easy" ? 60 : 30
  if (best && best.v > threshold) return best.move
  if (d.phase === "main1" && moves.some((m) => m.type === "phase" && m.to === "battle") && moves.length) {
    const p = d.p[seat]
    const canHit = p.m.some((x) => x && attackTargets(d, x.uid).length)
    if (canHit) return { type: "phase", to: "battle" }
  }
  return { type: "phase", to: "end" }
}

// how much the best single main phase move from `d` would add (0 if nothing helps)
const bestFollowUp = (d, seat, style) => {
  if (d.over || d.wait || d.active !== seat || !(d.phase === "main1" || d.phase === "main2")) return 0
  const base = evalFor(d, seat, style)
  let best = 0
  for (const m of legal(d, seat)) {
    if (m.type === "phase" || m.type === "position") continue
    if (m.type === "set" && CARD[d.cards[m.uid].id].kind === "spell" && CARD[d.cards[m.uid].id].sub !== "quick") continue
    for (const move of expand(d, seat, m, "normal").slice(0, 4)) {
      const after = simulate(d, seat, move)
      if (after) best = Math.max(best, evalFor(after, seat, style) - base)
    }
  }
  return best
}

// the best activation among `moves` if it gains at least `threshold`
const bestActivation = (d, seat, moves, opts, threshold) => {
  const base = evalFor(d, seat, opts.style)
  let best = null
  for (const m of moves) {
    for (const move of expand(d, seat, m, opts.level)) {
      const after = simulate(d, seat, move)
      if (!after) continue
      const v = evalFor(after, seat, opts.style) - base
      if (!best || v > best.v) best = { v, move }
    }
  }
  return best && best.v > threshold ? best.move : null
}

const pickResponse = (d, seat, moves, opts) => {
  const { level, random, style } = opts
  const acts = moves.filter((m) => m.type === "activate")
  if (!acts.length) return { type: "pass" }
  if (level === "easy" && random() < 0.6) return { type: "pass" }
  if (level === "normal" && random() < 0.15) return { type: "pass" }
  const passed = simulate(d, seat, { type: "pass" })
  const base = passed ? evalFor(passed, seat, style) : evalFor(d, seat, style)
  let best = null
  for (const m of acts) {
    for (const move of expand(d, seat, m, level)) {
      const after = simulate(d, seat, move)
      if (!after) continue
      const v = evalFor(after, seat, style) - base - (style === "trickster" ? 0 : 150)
      if (!best || v > best.v) best = { v, move }
    }
  }
  return best && best.v > 0 ? best.move : { type: "pass" }
}

const pickChoice = (d, seat, opts) => {
  const w = d.wait
  if (opts.level === "easy" || w.options.length > 10 || w.max > 1 || w.kind === "discard") return quickChoice(d, seat)
  let best = null
  for (const u of w.options) {
    const after = simulate(d, seat, { type: "choose", picks: [u] })
    if (!after) continue
    const v = evalFor(after, seat, opts.style)
    if (!best || v > best.v) best = { v, u }
  }
  return best ? { type: "choose", picks: [best.u] } : quickChoice(d, seat)
}
