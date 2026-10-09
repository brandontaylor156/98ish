// Roam life: waving and the other solo emotes, and doing things together (a hug first, then
// holding hands and walking together, a high five, a twirl, a dance, following) in the open
// world and inside (an office, a home, the stores). One plug-in for any roam world (world.use):
// the town (world.js) and the interiors (interior.js) speak the same few calls (meNow,
// peopleNow, net, myNum, camYaw).
//
// The owner: "Provide ability to hug other user so I can hug my gf", "Ability to wave". The rules
// are My Park's (host.together = park/together.js; the server's consent rules are
// server/park/together.js, run by server/roam with roam: events):
// - solo emotes (wave, thumbs up, cheer, point, sit down) need nobody's yes; everyone near sees
//   them (roam:emote). A wave turns you toward the person you're facing (or the nearest).
// - together things are ASKED (roam:ask), and start only after a yes. Nothing moves your player
//   for you except what you both said yes to: stepping into place for a hug, walking beside the
//   one you hold hands with; your own stick breaks away at once (rules.breaksAway).
//
//   const social = createSocial({ world, rules: host.together, friends: () => Set(keys), onState })
//   world.use(social.plugin)
//   social.emote("wave"); social.ask("hug"); social.answer(id, yes); social.stop(kind)

export const EMOTES = [
  { id: "wave", icon: "👋", label: "Wave" },
  { id: "thumbs", icon: "👍", label: "Thumbs up" },
  { id: "cheer", icon: "🙌", label: "Cheer" },
  { id: "point", icon: "👉", label: "Point" },
  { id: "sit", icon: "🧘", label: "Sit down" },
]
// what you can do together here, in order (hug first: the owner's ask)
export const TOGETHER_HERE = ["hug", "hand", "highfive", "twirl", "dance", "follow"]
const MOOD_OF = { wave: ["wave", 0], thumbs: ["thumbs", 0], cheer: ["cheer", 2], point: ["point", 0] }
const SOLO_SECONDS = 2.6

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))
// (the town's walker doesn't move under a 15% push, My Park's does: the last steps into place
// get just past the dead zone, a slow walk, so the two really meet)
const WALK_MIN = 0.17
export const HUG_GAP = 0.3 // metres between the two (their middles) in a hug
const minPush = (p) => {
  const m = Math.hypot(p.x, p.y)
  if (p.arrived || m < 1e-6 || m >= WALK_MIN) return p
  return { ...p, x: (p.x / m) * WALK_MIN, y: (p.y / m) * WALK_MIN }
}

// who a wave turns to: the nearest person within 20 m in front of you (within 75 degrees), else the
// nearest within 8 m anywhere -> the yaw to face, or null
export const waveYaw = (me, people) => {
  let best = null
  for (const p of people) {
    const dx = p.x - me.x
    const dz = p.z - me.z
    const d = Math.hypot(dx, dz)
    if (d < 0.3) continue
    const yaw = Math.atan2(dx, dz)
    const off = Math.abs(wrap(yaw - me.yaw))
    const score = off < 1.31 && d < 20 ? d : d < 8 ? d + 100 : Infinity
    if (score < Infinity && (!best || score < best.score)) best = { yaw, score }
  }
  return best ? best.yaw : null
}

export const createSocial = ({ world, rules, friends = () => new Set(), onState = () => {}, now = () => performance.now() / 1000 }) => {
  const R = rules
  const solo = new Map() // key ("me" | num) -> { kind, until, seat? }
  const applied = new Map() // key -> the mood string a figure last got
  const tg = { link: null, links: new Map(), emote: null, moveTo: null, pal: null, others: new Map() }
  let asks = [] // asks to me: [{ id, from, name, kind, at }]
  let pending = null
  let note = null
  let faceOnce = null
  let clock = 0
  let lastState = ""

  const net = () => world.net
  const meNow = () => world.meNow?.()
  const person = (num) => world.peopleNow?.().find((p) => p.num === num) || null
  const say = (text) => {
    note = { text, at: clock }
    push(true)
  }
  const state = () => ({
    pal: tg.pal,
    link: tg.link ? { kind: tg.link.kind, lead: tg.link.lead, name: person(tg.link.other)?.name || "", num: tg.link.other } : null,
    emote: tg.emote ? tg.emote.kind : null,
    sitting: !!solo.get("me")?.seat,
    asks: asks.filter((a) => clock - a.at < 30),
    pending: pending ? { kind: pending.kind, name: pending.name } : null,
    note: note && clock - note.at < 4 ? note.text : null,
    signedIn: world.myNum !== null && world.myNum !== undefined,
  })
  const push = (force = false) => {
    const s = state()
    const j = JSON.stringify(s)
    if (!force && j === lastState) return
    lastState = j
    onState(s)
  }

  // ---- solo emotes ----
  const emote = (kind) => {
    const me = meNow()
    if (!me || !EMOTES.some((e) => e.id === kind)) return false
    if (kind === "sit") {
      solo.set("me", { kind: "sit", until: Infinity, seat: { x: me.x, y: me.y, z: me.z, yaw: me.yaw, ground: true } })
    } else {
      if (kind === "wave") {
        const yaw = waveYaw(me, world.peopleNow?.() || [])
        if (yaw !== null) faceOnce = yaw
      }
      solo.set("me", { kind, until: clock + SOLO_SECONDS })
    }
    net()?.request?.("roam:emote", { kind }).catch?.(() => {})
    push(true)
    return true
  }
  // sit on something (a chair, a couch, a desk chair; h: its seat height) or the ground by a grill,
  // facing yaw; where you are now (the caller stands you there first)
  const sitAt = ({ x, y, z, yaw, h = 0 }) => {
    solo.set("me", { kind: h ? "chair" : "sit", until: Infinity, seat: h ? { x, y: y || 0, z, yaw, h } : { x, y: y || 0, z, yaw, ground: true } })
    net()?.request?.("roam:emote", { kind: h ? "chair" : "sit" }).catch?.(() => {})
    push(true)
  }
  const standUp = () => {
    if (!solo.get("me")?.seat) return
    solo.delete("me")
    net()?.request?.("roam:emote", { kind: "stand" }).catch?.(() => {})
    push(true)
  }

  // ---- together (asked first) ----
  const ask = async (kind) => {
    const who = tg.pal || (tg.link ? { num: tg.link.other, name: person(tg.link.other)?.name } : null)
    if (!who || !net()?.request) return { ok: false, error: "Walk up to a friend first." }
    const r = await net().request("roam:ask", { to: who.num, kind }).catch(() => null)
    if (r?.ok) {
      pending = { id: r.id, kind, name: who.name, at: clock }
      say(`Asked ${who.name}...`)
    } else say(r?.error || "That didn't work. Please try again.")
    return r || { ok: false }
  }
  const answer = async (id, yes) => {
    asks = asks.filter((a) => a.id !== id)
    push(true)
    const r = await net()?.request?.("roam:answer", { id, yes }).catch(() => null)
    if (yes && r && !r.ok) say(r.error || "That didn't work.")
    return r
  }
  const unlink = () => {
    if (!tg.link) return
    tg.link = null
    net()?.request?.("roam:unlink", {}).catch?.(() => {})
    push(true)
  }
  const stop = (kind) => {
    if (kind === "hand" || kind === "follow") return unlink()
    if (kind === "sit") return standUp()
    if (tg.emote) {
      const other = tg.emote.other
      tg.emote = null
      tg.moveTo = null
      net()?.request?.("roam:tgend", { to: other, kind }).catch?.(() => {})
    }
    push(true)
  }

  // a paired emote everyone sees (roam:tg { kind, a, b }): the two step into place, then do it
  const startPair = (kind, a, b) => {
    const mine = world.myNum
    const pose = R.EMOTE_POSE[kind]
    if (!pose) return
    // (everyone animates the two; the two themselves also step into place)
    tg.others.set(a, { kind, mood: pose[0], at: clock + 1.2 })
    tg.others.set(b, { kind, mood: pose[1], at: clock + 1.2 })
    if (a !== mine && b !== mine) return
    const me = meNow()
    const other = person(a === mine ? b : a)
    if (!me || !other) return
    const spots = R.emoteSpots(a === mine ? me : other, b === mine ? me : other, kind)
    // (a real hug: chest to chest, closer than My Park's spacing)
    if (kind === "hug") {
      const mx = (spots[0].x + spots[1].x) / 2
      const mz = (spots[0].z + spots[1].z) / 2
      for (const s of spots) {
        s.x = mx + (s.x - mx) * (HUG_GAP / R.EMOTE_GAP.hug)
        s.z = mz + (s.z - mz) * (HUG_GAP / R.EMOTE_GAP.hug)
      }
    }
    const role = a === mine ? 0 : 1
    tg.moveTo = { ...spots[role], until: clock + 3.2 }
    tg.emote = { kind, other: role === 0 ? b : a, role, t: 0, started: false, spot: spots[role] }
    tg.others.delete(mine)
    if (kind === "hug") say(`A hug with ${other.name} ♥`)
  }

  // ---- the plug-in the world calls ----
  const plugin = {
    // your walk: sitting stands up when you push; walking together / stepping into place
    input(mv, dt, camYaw) {
      const push_ = Math.hypot(mv.x, mv.y)
      if (solo.get("me")?.seat && push_ > 0.3) standUp()
      if (faceOnce !== null) {
        const f = faceOnce
        faceOnce = null
        return { ...mv, face: f }
      }
      const me = meNow()
      if (!me) return null
      if (tg.moveTo) {
        if (R.breaksAway(mv) || clock > tg.moveTo.until + 2) {
          tg.moveTo = null
          if (tg.emote && !tg.emote.started) tg.emote = null
          return null
        }
        const p = R.padToward(me, tg.moveTo, camYaw, { stopWithin: 0.05 })
        if (p.arrived || clock > tg.moveTo.until) {
          const face = tg.moveTo.yaw
          tg.moveTo = null
          return { x: 0, y: 0, sprint: false, face }
        }
        return { ...minPush(p), face: undefined }
      }
      if (tg.emote?.started) {
        if (R.breaksAway(mv)) {
          stop(tg.emote.kind)
          return null
        }
        const e = tg.emote
        // (the one being twirled turns round once)
        if (e.kind === "twirl" && e.role === 1) return { x: 0, y: 0, sprint: false, face: wrap(e.spot.yaw + R.twirlAngle(e.t)) }
        return { x: 0, y: 0, sprint: false, face: e.spot.yaw }
      }
      const l = tg.link
      if (l && !l.lead) {
        if (R.breaksAway(mv)) {
          unlink()
          say("You let go.")
          return null
        }
        const leader = person(l.other)
        if (!leader) return null
        const lv = { x: leader.x, z: leader.z, yaw: leader.yaw, vx: Math.sin(leader.yaw) * (leader.speed || 0), vz: Math.cos(leader.yaw) * (leader.speed || 0) }
        const target = R.followTarget(l.kind, lv, R.LEAD_S, 1)
        const p = R.padToward(me, target, camYaw, { speed: leader.speed || 0 })
        return p.arrived ? { x: 0, y: 0, sprint: false, face: leader.yaw } : minPush(p)
      }
      return null
    },
    step(dt) {
      clock += dt
      for (const [k, s] of solo) if (s.until < clock) solo.delete(k)
      // remote sitters stand when they walk off
      for (const [k, s] of solo) {
        if (k === "me" || !s.seat) continue
        const p = person(k)
        if (!p || p.speed > 0.4) solo.delete(k)
      }
      if (tg.emote) {
        const e = tg.emote
        e.t += dt
        if (!e.started && (!tg.moveTo || e.t > 3.4)) {
          e.started = true
          e.t = 0
          tg.moveTo = null
        }
        if (e.started && e.t > (R.EMOTE_SECONDS[e.kind] || 2.6) + 0.2) tg.emote = null
      }
      for (const [k, o] of tg.others) if (clock > o.at + (R.EMOTE_SECONDS[o.kind] || 2.6) + 0.4) tg.others.delete(k)
      // your partner or a buddy near you: the Together button
      const me = meNow()
      const keys = friends()
      tg.pal = me && !tg.link && !tg.emote ? R.nearestPal(me, (world.peopleNow?.() || []).map((p) => ({ ...p, hidden: false })), keys, 6) : null
      if (pending && clock - pending.at > 31) pending = null
      push(false)
    },
    // each figure's mood: a solo emote, a paired one, holding hands
    figure(key, fig) {
      const mine = key === "me"
      const num = mine ? world.myNum : key
      let want = null
      const s = solo.get(key)
      if (s?.seat) {
        if (applied.get(key) !== "seat") {
          fig.setMood?.(null)
          applied.set(key, "seat")
        }
        fig.setSeat?.(mine ? s.seat : { ...s.seat })
        return
      }
      if (applied.get(key) === "seat") fig.setSeat?.(null)
      if (s && MOOD_OF[s.kind]) want = [...MOOD_OF[s.kind], false]
      // paired: mine (stepped in and started), or two others doing one
      if (mine && tg.emote?.started) {
        const pose = R.EMOTE_POSE[tg.emote.kind][tg.emote.role]
        want = [pose[0], pose[1], tg.emote.kind === "dance"]
      } else if (!mine) {
        const o = tg.others.get(num)
        if (o && clock >= o.at) want = [o.mood[0], o.mood[1], o.kind === "dance"]
        if (tg.emote?.started && tg.emote.other === num) {
          const pose = R.EMOTE_POSE[tg.emote.kind][1 - tg.emote.role]
          want = [pose[0], pose[1], tg.emote.kind === "dance"]
        }
      }
      // holding hands: the near hand out (who's on which side)
      const link = mine ? tg.link : tg.link && tg.link.other === num ? { ...tg.link, lead: !tg.link.lead } : tg.links.get(num)
      if (!want && link?.kind === "hand") want = ["hold", link.lead ? 0 : 1, true]
      const sig = want ? want.join(":") : ""
      if (applied.get(key) !== sig) {
        applied.set(key, sig)
        fig.setMood?.(want ? want[0] : null, want ? want[1] : 0, want ? want[2] : false)
      }
    },
    netEvent(type, d) {
      if (!d) return
      if (type === "roam:emote" && Number.isInteger(d.num)) {
        if (d.kind === "stand") solo.delete(d.num)
        else if (d.kind === "sit" || d.kind === "chair") {
          const p = person(d.num)
          if (p) solo.set(d.num, { kind: d.kind, until: Infinity, seat: { x: p.x, y: p.y, z: p.z, yaw: p.yaw, ...(d.kind === "chair" ? { h: 0.45 } : { ground: true }) } })
        } else solo.set(d.num, { kind: d.kind, until: clock + SOLO_SECONDS })
      } else if (type === "roam:ask") {
        asks = [...asks.filter((a) => a.from !== d.from), { id: d.id, from: d.from, name: d.name, kind: d.kind, at: clock }]
        push(true)
      } else if (type === "roam:answer") {
        if (pending?.id === d.id) pending = null
        if (!d.yes) say(d.error || `${person(d.num)?.name || "They"} said not now.`)
        push(true)
      } else if (type === "roam:link") {
        const mine = world.myNum
        if (d.a === mine || d.b === mine) {
          if (!d.kind) {
            if (tg.link) say(d.by && d.by !== mine ? `${person(tg.link.other)?.name || "They"} let go.` : "Walking on your own again.")
            tg.link = null
          } else {
            const other = d.a === mine ? d.b : d.a
            tg.link = { kind: d.kind, other, lead: d.lead === mine }
            const name = person(other)?.name || "your friend"
            say(d.kind === "hand" ? (tg.link.lead ? `Holding hands with ${name}. Walk anywhere.` : `Holding hands with ${name}. Push your stick to let go.`) : tg.link.lead ? `${name} is following you.` : `Following ${name}. Push your stick to stop.`)
          }
        } else if (d.kind) {
          tg.links.set(d.a, { kind: d.kind, lead: d.lead === d.a })
          tg.links.set(d.b, { kind: d.kind, lead: d.lead === d.b })
        } else {
          tg.links.delete(d.a)
          tg.links.delete(d.b)
        }
        push(true)
      } else if (type === "roam:tg") {
        startPair(d.kind, d.a, d.b)
        push(true)
      } else if (type === "roam:tgend") {
        if (tg.emote && tg.emote.other === d.from) {
          tg.emote = null
          tg.moveTo = null
          say(`${person(d.from)?.name || "They"} stopped.`)
        }
      } else if (type === "roam:gone") {
        solo.delete(d.num)
        tg.others.delete(d.num)
        if (tg.link?.other === d.num) tg.link = null
      }
    },
  }
  return { plugin, emote, ask, answer, stop, standUp, sitAt, get state() { return state() }, _tg: tg, _solo: solo }
}
