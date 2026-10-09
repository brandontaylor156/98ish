// My Park "Together" (Pickleball 98): things two people in the same park do together.
// The owner: "Me and my girlfriend. Add some other fun stuff at the venues that me and her can
// do together."
//
// Everything is by consent: one person asks (park:ask), the other says yes or no (park:answer),
// and only a yes starts anything. Either of them can stop it at any time (park:unlink for
// walking together, park:tgend for the rest), and leaving the park, walking off to play or
// drifting far apart ends it too.
//
// Kinds:
//   hand     hold hands: the asker leads, the other walks beside them (their browser steers its
//            own player there; their own stick breaks away at once)
//   follow   the asker follows the other (the same rule)
//   sit      sit together (the asker's browser picked two seats side by side: data.seats)
//   sunset   watch the sunset: sit together (data.seats), the sky time-lapses
//   selfie   a selfie of the two of you (each browser takes its own picture)
//   date     date night (golden hour or the court lights, the lo-fi music, the regulars give you space)
//   hug, highfive, twirl, dance   paired emotes
//   team     mixed doubles: the two of you against the computers (a private room, both on one side)
//   rally    "how long can we rally": a co-op Free rally drill (practice/coop.js) for the two
//   tennis, horse, workout   My Park activities (client park/acts/): tennis on a tennis court
//            (a match or a co-op rally), H-O-R-S-E on a basketball court, a workout together;
//            a private "parkact" room (server/arcade/games/parkact.js), both stay in the park
//
// Only states go over the network (who's linked to whom, what started): the walking itself is
// each browser's own position updates, as always. Signed-on people only (a 98 Messenger
// account on both sides), never between people who block each other, and only within a few
// metres for the close-up things.
//
// Socket events (client -> server, with an ack):
//   park:ask    { to: num, kind, data? }  -> { ok, id }
//   park:answer { id, yes }               -> { ok }
//   park:unlink {}                        stop walking together
//   park:tgend  { to: num, kind }         stop something you said yes to (date, sunset, selfie...)
// Server -> client:
//   park:ask    { id, from: num, name, kind, data }        (to the one asked)
//   park:answer { id, yes, num }                           (to the asker)
//   park:link   { a, b, kind: "hand" | "follow" | null, lead, by }   (everyone in the park:
//               hand-holding shows; kind null: it ended)
//   park:tg     { kind, a, b, data }                       (everyone in the park: the hug shows)
//   park:tgend  { from: num, kind }                        (to the other one)

const crypto = require("crypto")

const KINDS = {
  hand: { near: 8, link: true },
  follow: { near: 14, link: true },
  sit: { near: 12 },
  sunset: { near: 30 },
  selfie: { near: 8 },
  date: { near: 60 },
  hug: { near: 6 },
  highfive: { near: 6 },
  twirl: { near: 6 },
  dance: { near: 12 },
  team: { near: 60, game: true },
  rally: { near: 60, game: true },
  // My Park activities (client park/acts/): a private room of the "parkact" game (relay), the
  // two stay in the park; data { spot, mode }
  tennis: { near: 30, act: true },
  horse: { near: 30, act: true },
  workout: { near: 30, act: true },
}
const ACT_MODES = { tennis: ["match", "rally"], horse: ["horse"], workout: ["daily", "quick", "together"] }
const SPOT_ID = /^[a-z0-9-]{1,40}$/
const ASK_MS = 30_000 // an unanswered ask goes after this long
const APART_M = 22 // walking together ends past this
const MAX_ASKS = 3 // pending asks to one person
const MATE_MS = 3 * 3600_000 // how long a yes lets one stop the other's side ("tgend")
const SEAT_ID = /^[A-Za-z0-9_:.-]{1,40}$/

// what an ask may carry, cleaned (or null: refused)
const cleanData = (kind, data) => {
  const d = data && typeof data === "object" && !Array.isArray(data) ? data : {}
  if (kind === "sit" || kind === "sunset") {
    const seats = Array.isArray(d.seats) ? d.seats : null
    if (!seats || seats.length !== 2 || !seats.every((s) => typeof s === "string" && SEAT_ID.test(s)) || seats[0] === seats[1]) return null
    return { seats: [seats[0], seats[1]] }
  }
  if (KINDS[kind]?.game) return { court: Number.isInteger(d.court) && d.court >= 0 && d.court < 64 ? d.court : null }
  if (KINDS[kind]?.act) {
    if (typeof d.spot !== "string" || !SPOT_ID.test(d.spot)) return null
    const mode = ACT_MODES[kind].includes(d.mode) ? d.mode : ACT_MODES[kind][0]
    return { spot: d.spot, mode }
  }
  if (kind === "date") return { night: d.night === true }
  return {}
}

// send(pid, event, payload), toAll(inst, event, payload), blocked(pidA, pidB), clock,
// limit(n, ms) -> a sliding-window counter, startGame(inst, [pid, pid], kind, court) -> { ok }
// (park/index.js: a private room on a free court)
// startAct(inst, [pid, pid], kind, data) -> { ok } (park/index.js: a "parkact" room for the two)
const createTogether = ({ send, toAll, blocked = () => false, clock, limit, startGame, startAct = () => ({ ok: false, error: "That isn't ready yet." }) }) => {
  const askLimit = limit(8, 30_000)
  const endLimit = limit(20, 30_000)
  const distOf = (p, q) => (p.pos && q.pos ? Math.hypot(p.pos[0] - q.pos[0], p.pos[1] - q.pos[1]) / 20 : Infinity)
  const byNum = (inst, num) => {
    for (const q of inst.people.values()) if (q.num === num) return q
    return null
  }
  const state = (inst) => {
    inst.tg ??= { asks: new Map(), links: new Map(), mates: new Map() }
    return inst.tg
  }

  const ask = (inst, pid, { to, kind, data } = {}) => {
    const k = KINDS[kind]
    if (!k) return { ok: false, error: "That isn't something to do together." }
    const p = inst.people.get(pid)
    const q = Number.isInteger(to) ? byNum(inst, to) : null
    if (!p || !q || q.pid === pid) return { ok: false, error: "They're not in the park any more." }
    if (!p.key || !q.key) return { ok: false, error: "Doing things together needs both of you signed on to 98 Messenger." }
    if (blocked(pid, q.pid)) return { ok: false, error: "They're not in the park any more." }
    if (p.playing !== null || q.playing !== null) return { ok: false, error: `${q.name} is playing a game right now.` }
    if (distOf(p, q) > k.near) return { ok: false, error: `Walk over to ${q.name} first.` }
    if (askLimit(pid)) return { ok: false, error: "Slow down a little." }
    const clean = cleanData(kind, data)
    if (!clean) return { ok: false, error: "That didn't work. Please try again." }
    const s = state(inst)
    // (one ask per pair: a new one replaces it; at most a few waiting for one person)
    for (const [id, a] of s.asks) if ((a.from === pid && a.to === q.pid) || clock.now() - a.at > ASK_MS) s.asks.delete(id)
    const waiting = [...s.asks.values()].filter((a) => a.to === q.pid)
    if (waiting.length >= MAX_ASKS) s.asks.delete([...s.asks.entries()].find(([, a]) => a === waiting[0])[0])
    const id = crypto.randomBytes(5).toString("hex")
    s.asks.set(id, { id, from: pid, to: q.pid, kind, data: clean, at: clock.now() })
    send(q.pid, "park:ask", { id, from: p.num, name: p.name, kind, data: clean })
    return { ok: true, id }
  }

  const linkOf = (inst, pid) => state(inst).links.get(pid) || null
  const endLink = (inst, pid, by = null) => {
    const s = state(inst)
    const l = s.links.get(pid)
    if (!l) return false
    s.links.delete(l.a)
    s.links.delete(l.b)
    const a = inst.people.get(l.a)
    const b = inst.people.get(l.b)
    toAll(inst, "park:link", { a: a?.num ?? l.an, b: b?.num ?? l.bn, kind: null, lead: null, by })
    return true
  }
  const mate = (inst, a, b) => {
    const s = state(inst)
    const t = clock.now()
    for (const [x, y] of [
      [a, b],
      [b, a],
    ]) {
      const m = s.mates.get(x) || new Map()
      m.set(y, t)
      s.mates.set(x, m)
    }
  }

  const answer = (inst, pid, { id, yes } = {}) => {
    const s = state(inst)
    const a = typeof id === "string" ? s.asks.get(id) : null
    if (!a || a.to !== pid || clock.now() - a.at > ASK_MS) {
      if (a && clock.now() - a.at > ASK_MS) s.asks.delete(id)
      return { ok: false, error: "That ask has gone." }
    }
    s.asks.delete(id)
    const p = inst.people.get(a.from)
    const q = inst.people.get(pid)
    if (!p || !q) return { ok: false, error: "They've left the park." }
    if (!yes) {
      send(p.pid, "park:answer", { id, yes: false, num: q.num })
      return { ok: true }
    }
    if (p.playing !== null || q.playing !== null) return { ok: false, error: "One of you is playing a game right now." }
    const k = KINDS[a.kind]
    if (k.game) {
      const r = startGame(inst, [p.pid, q.pid], a.kind, a.data.court)
      if (!r.ok) {
        send(p.pid, "park:answer", { id, yes: false, num: q.num, error: r.error })
        return r
      }
      endLink(inst, p.pid)
      endLink(inst, q.pid)
    } else if (k.act) {
      const r = startAct(inst, [p.pid, q.pid], a.kind, a.data)
      if (!r.ok) {
        send(p.pid, "park:answer", { id, yes: false, num: q.num, error: r.error })
        return r
      }
      endLink(inst, p.pid)
      endLink(inst, q.pid)
    } else if (k.link) {
      endLink(inst, p.pid)
      endLink(inst, q.pid)
      // hold hands: the asker leads; follow: the asker follows the one asked
      const lead = a.kind === "hand" ? p : q
      const l = { a: p.pid, b: q.pid, an: p.num, bn: q.num, kind: a.kind, lead: lead.pid, since: clock.now() }
      s.links.set(p.pid, l)
      s.links.set(q.pid, l)
      toAll(inst, "park:link", { a: p.num, b: q.num, kind: a.kind, lead: lead.num, by: null })
    } else toAll(inst, "park:tg", { kind: a.kind, a: p.num, b: q.num, data: a.data })
    mate(inst, p.pid, q.pid)
    send(p.pid, "park:answer", { id, yes: true, num: q.num })
    return { ok: true }
  }

  const unlink = (inst, pid) => {
    const p = inst.people.get(pid)
    if (endLimit(pid)) return { ok: false, error: "Slow down a little." }
    endLink(inst, pid, p?.num ?? null)
    return { ok: true }
  }

  const tgEnd = (inst, pid, { to, kind } = {}) => {
    const p = inst.people.get(pid)
    const q = Number.isInteger(to) ? byNum(inst, to) : null
    if (!p || !q) return { ok: false }
    if (!(kind === "all" || (KINDS[kind] && !KINDS[kind].link && !KINDS[kind].game))) return { ok: false }
    const at = state(inst).mates.get(pid)?.get(q.pid)
    if (!at || clock.now() - at > MATE_MS) return { ok: false }
    if (endLimit(pid)) return { ok: false, error: "Slow down a little." }
    send(q.pid, "park:tgend", { from: p.num, kind })
    return { ok: true }
  }

  // someone left the park (or went off to play): their link and asks go
  const forget = (inst, pid) => {
    if (!inst.tg) return
    endLink(inst, pid)
    const s = inst.tg
    for (const [id, a] of s.asks) if (a.from === pid || a.to === pid) s.asks.delete(id)
    s.mates.delete(pid)
    for (const m of s.mates.values()) m.delete(pid)
  }
  // a linked person moved: drifted too far apart, the link ends
  const moved = (inst, pid) => {
    const l = inst.tg?.links.get(pid)
    if (!l) return
    const p = inst.people.get(l.a)
    const q = inst.people.get(l.b)
    if (p && q && distOf(p, q) > APART_M) endLink(inst, pid, null)
  }

  return { ask, answer, unlink, tgEnd, forget, moved, linkOf, KINDS }
}

module.exports = { createTogether, cleanData, KINDS, ACT_MODES, ASK_MS, APART_M }
