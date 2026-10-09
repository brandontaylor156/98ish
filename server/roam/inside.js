// Roam: going inside (an office, a home, the warehouse club, the mall), waving, and things put
// down in town (docs/open-world.md "Home, work, the stores and your Bag"). Memory only, per
// town instance (server/roam/index.js); nothing is kept per account.
//
// Rooms: an interior is drawn by each browser from its kind and seed (client/src/roam/life/
// layouts.js), at its own SLOT far out in the town's frame (slot k's floor starts at ORIGIN + k *
// STRIDE metres east), so positions inside go through the town's ordinary roam:pos/roam:m and
// the doing-things-together code works unchanged; the town simply never sees anyone that far out.
//   - a private room (your home or your office): yours; others come in only when you invite them
//     (roam:invite { num }: they get roam:invite { from, name, room, kind, label } and enter with
//     that room). Opening it again gives the same room while you're in it.
//   - a public room (a store, the mall): one per building (key), anyone in the town walks in.
// Things said in a room (roam:say { kind, data }: the shared cart, the TV, sitting down) go to the
// others in it only.
//
// Emotes (roam:emote { kind }): a wave, a thumbs up, a cheer, pointing, sitting down: everyone in
// the town instance sees them (roam:emote { num, kind }). No consent needed: they're solo.
//
// Put down (roam:place { kind, x, z, yaw }): a grill, a cooler, a beach umbrella... from your Bag,
// seen by everyone in the instance (roam:placed { item } / roam:unplaced { id }); 4 a person (the
// oldest picked up), 80 an instance; they go when you leave town.
//
// Socket events (client -> server, with an ack):
//   roam:enter  { kind, room?, key?, label?, seed? } -> { ok, room, kind, slot, origin: { x, z }, label, seed, people: [num] }
//   roam:exit   {}
//   roam:invite { num } -> { ok }
//   roam:say    { kind, data }
//   roam:emote  { kind }
//   roam:place  { kind, x, z, yaw } -> { ok, item }    roam:unplace { id }
// Server -> client: roam:in { num, room | null } (everyone: who's inside where), roam:invite,
// roam:say { from, kind, data }, roam:emote { num, kind }, roam:placed { item }, roam:unplaced { id }.

const ORIGIN = { x: 25000, z: 25000 } // metres
const STRIDE = 120
const SLOTS = 30
const KINDS = ["office", "home", "club", "mall"]
const PRIVATE = ["office", "home"]
const SAY = ["cart", "tv", "sit", "coffee", "claw"]
const EMOTES = ["wave", "thumbs", "cheer", "point", "sit", "chair", "stand", "eat"]
const PLACE_KINDS = ["grill", "cooler", "umbrella", "chairs", "float", "blanket"]
const PLACE_EACH = 4
const PLACE_MAX = 80
const KEY = /^[a-z0-9:._-]{1,48}$/

const text = (s, n) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f<>]/g, "")
    .slice(0, n)

const createInside = ({ send, toAll, clock, limit, reach = 300000 }) => {
  const enterLimit = limit(20, 60_000)
  const sayLimit = limit(40, 10_000)
  const emoteLimit = limit(12, 10_000)
  const placeLimit = limit(20, 60_000)
  let nextPlaced = 1
  const rooms = (inst) => (inst.rooms ??= new Map())
  const placed = (inst) => (inst.placed ??= new Map())
  const freeSlot = (inst) => {
    const used = new Set([...rooms(inst).values()].map((r) => r.slot))
    for (let k = 0; k < SLOTS; k++) if (!used.has(k)) return k
    return -1
  }
  const view = (r) => ({ room: r.id, kind: r.kind, slot: r.slot, origin: { x: ORIGIN.x + r.slot * STRIDE, z: ORIGIN.z }, label: r.label, seed: r.seed })

  const exit = (inst, p) => {
    if (!p?.inside) return { ok: true }
    const r = rooms(inst).get(p.inside)
    p.inside = null
    if (r) {
      r.members.delete(p.pid)
      if (!r.members.size) rooms(inst).delete(r.id)
    }
    toAll(inst, "roam:in", { num: p.num, room: null })
    return { ok: true }
  }

  const enter = (inst, p, { kind, room, key, label, seed } = {}) => {
    if (enterLimit(p.pid)) return { ok: false, error: "Slow down a little." }
    let r = null
    if (typeof room === "string") {
      r = rooms(inst).get(room) || null
      if (!r) return { ok: false, error: "Nobody's in there any more." }
      if (r.owner && r.owner !== p.pid && !r.allow.has(p.pid)) return { ok: false, error: "You need an invitation to go in." }
    } else {
      if (!KINDS.includes(kind)) return { ok: false, error: "There's no such place." }
      const id = PRIVATE.includes(kind) ? `own:${p.num}:${kind}` : typeof key === "string" && KEY.test(key) ? `pub:${kind}:${key}` : null
      if (!id) return { ok: false, error: "Which building?" }
      r = rooms(inst).get(id) || null
      if (!r) {
        if (p.inside) exit(inst, p)
        const slot = freeSlot(inst)
        if (slot < 0) return { ok: false, error: "Every room in town is busy. Try again in a minute." }
        r = { id, kind, slot, owner: PRIVATE.includes(kind) ? p.pid : null, label: text(label, 40), seed: Number.isInteger(seed) ? seed >>> 0 : 1, allow: new Set(), members: new Set() }
        rooms(inst).set(id, r)
      }
    }
    if (p.inside && p.inside !== r.id) exit(inst, p)
    r.members.add(p.pid)
    p.inside = r.id
    toAll(inst, "roam:in", { num: p.num, room: r.id }, p.pid)
    const people = [...r.members].filter((pid) => pid !== p.pid).map((pid) => inst.people.get(pid)?.num).filter(Number.isInteger)
    return { ok: true, ...view(r), people }
  }

  const invite = (inst, p, { num } = {}) => {
    const r = p.inside ? rooms(inst).get(p.inside) : null
    if (!r || r.owner !== p.pid) return { ok: false, error: "Go into your own place first." }
    const q = [...inst.people.values()].find((x) => x.num === num) || null
    if (!q || q.pid === p.pid) return { ok: false, error: "They're not in town." }
    if (sayLimit(p.pid)) return { ok: false, error: "Slow down a little." }
    r.allow.add(q.pid)
    send(q.pid, "roam:invite", { from: p.num, name: p.name, room: r.id, kind: r.kind, label: r.label })
    return { ok: true }
  }

  const say = (inst, p, { kind, data } = {}) => {
    const r = p.inside ? rooms(inst).get(p.inside) : null
    if (!r || !SAY.includes(kind) || sayLimit(p.pid)) return { ok: false }
    const json = JSON.stringify(data ?? null)
    if (json.length > 600) return { ok: false }
    for (const pid of r.members) if (pid !== p.pid) send(pid, "roam:say", { from: p.num, kind, data: JSON.parse(json) })
    return { ok: true }
  }

  const emote = (inst, p, { kind } = {}) => {
    if (!EMOTES.includes(kind) || emoteLimit(p.pid)) return { ok: false }
    toAll(inst, "roam:emote", { num: p.num, kind }, p.pid)
    return { ok: true }
  }

  const place = (inst, p, { kind, x, z, yaw } = {}) => {
    if (!PLACE_KINDS.includes(kind)) return { ok: false, error: "That can't be put down." }
    if (![x, z, yaw].every(Number.isFinite) || Math.abs(x) * 10 > reach || Math.abs(z) * 10 > reach) return { ok: false, error: "Not there." }
    if (placeLimit(p.pid)) return { ok: false, error: "Slow down a little." }
    const all = placed(inst)
    const mine = [...all.values()].filter((it) => it.by === p.num)
    if (mine.length >= PLACE_EACH) unplace(inst, p, { id: mine[0].id })
    if (all.size >= PLACE_MAX) return { ok: false, error: "There's a lot set out in town already." }
    const item = { id: `pl${nextPlaced++}`, by: p.num, kind, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, yaw: Math.round(yaw * 100) / 100 }
    all.set(item.id, item)
    toAll(inst, "roam:placed", { item })
    return { ok: true, item }
  }
  const unplace = (inst, p, { id } = {}) => {
    const it = placed(inst).get(id)
    if (!it || it.by !== p.num) return { ok: false }
    placed(inst).delete(id)
    toAll(inst, "roam:unplaced", { id })
    return { ok: true }
  }

  // someone left the town: out of their room, their things picked up
  const forget = (inst, p) => {
    exit(inst, p)
    for (const it of [...placed(inst).values()]) if (it.by === p.num) unplace(inst, p, { id: it.id })
    for (const r of rooms(inst).values()) r.allow.delete(p.pid)
  }
  const joinView = (inst) => ({ placed: [...placed(inst).values()], inside: [...inst.people.values()].filter((q) => q.inside).map((q) => ({ num: q.num, room: q.inside })) })

  return { enter, exit, invite, say, emote, place, unplace, forget, joinView }
}

module.exports = { createInside, ORIGIN, STRIDE, SLOTS, EMOTES, PLACE_KINDS }
