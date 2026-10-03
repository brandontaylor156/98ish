import * as G from "./game"
import { MAX_IDS, applyIntent, applyPatch, isBatch } from "./coopRules"

// Sunny Acres co-op, the browser's side: one co-op town the server keeps (server/town/coop.js).
// What you do happens on your screen at once (the same rules, applied to `view`) and goes to
// the server as an intent; the server's answer comes back as a patch with a revision number.
// `confirmed` is the town as the server last said; `view` is that plus whatever of yours the
// server hasn't answered yet, rebuilt (in place, so the game keeps the same object) whenever
// a patch arrives. A move the server turns down simply disappears from the view.
//
// Planting, harvesting, feeding and collecting wait a moment (FLUSH_MS) so a swipe across
// many fields goes as one intent.

const FLUSH_MS = 90
const clone = (v) => JSON.parse(JSON.stringify(v))

// request(event, payload) -> Promise(ack); socket: for the town's live events
export const createCoopSession = ({ id, request, socket, on = {} }) => {
  const st = {
    id,
    status: "joining", // joining | live | gone
    view: null,
    confirmed: null,
    rev: 0,
    offset: null, // the server's clock minus ours
    town: null,
    you: null,
    players: [],
    members: [],
    invited: [],
    feed: [],
    stats: [],
    ach: [],
  }
  let seq = 0
  let pending = [] // sent, waiting for the server: { seq, it, at }
  let queue = [] // not sent yet
  let flushTimer = 0
  let syncing = false
  const call = (name, ...args) => on[name]?.(...args)

  const now = () => Date.now() + (st.offset || 0)
  const clockFrom = (serverNow) => {
    if (typeof serverNow !== "number") return
    // what we hear is a little late, so the largest guess is the best one; a big jump
    // (the server's clock moved) is taken as it is
    const guess = serverNow - Date.now()
    if (st.offset === null || Math.abs(guess - st.offset) > 2000) st.offset = guess
    else st.offset = Math.max(guess, st.offset - 2)
  }

  // the view = the server's town + my moves still on their way
  const rebuild = () => {
    const fresh = clone(st.confirmed)
    for (const p of [...pending, ...queue]) applyIntent(fresh, p.it, p.at)
    G.drainEvents(fresh)
    if (!st.view) st.view = fresh
    else {
      for (const k of Object.keys(st.view)) delete st.view[k]
      Object.assign(st.view, fresh)
    }
  }

  const take = (r) => {
    st.confirmed = G.migrate(JSON.parse(r.state))
    delete st.confirmed.ev
    st.rev = r.rev
    clockFrom(r.now)
  }

  const resync = async () => {
    if (syncing || st.status === "gone") return
    syncing = true
    const r = await request("coop:sync", { id })
    syncing = false
    if (!r?.ok) {
      if (r?.gone) return join()
      return
    }
    take(r)
    pending = []
    rebuild()
    call("update")
  }

  // ---- sending ----

  const send = (p) => {
    p.seq = ++seq
    pending.push(p)
    request("coop:act", { id, seq: p.seq, it: p.it }).then((r) => {
      clockFrom(r?.now)
      if (r?.ok) {
        if (r.failed?.length && r.reason) call("reject", r.reason, p.it)
        // the patch normally comes first; if it got lost, ask for the whole town
        if (pending.includes(p) && r.rev > st.rev) resync()
        return
      }
      pending = pending.filter((x) => x !== p)
      if (r?.gone) return join()
      rebuild()
      call("update")
      call("reject", r?.reason || r?.error || "That didn't work.", p.it)
    })
  }
  const flush = () => {
    clearTimeout(flushTimer)
    flushTimer = 0
    const list = queue
    queue = []
    for (const p of list) send(p)
  }
  const enqueue = (it, at) => {
    const last = queue[queue.length - 1]
    if (last && isBatch(it.a) && last.it.a === it.a && last.it.crop === it.crop && last.it.ids.length + it.ids.length <= MAX_IDS) {
      last.it.ids.push(...it.ids)
    } else queue.push({ it, at })
    if (!isBatch(it.a)) return flush()
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS)
  }

  // do it here now (the game's own rules), and tell the server
  const local = (it, result) => {
    if (result.ok && st.status === "live") enqueue(it, now())
    return result
  }

  // The same calls the game makes (game.js), for the co-op town
  const actions = {
    plant: (s, i, crop, t) => local({ a: "plant", ids: [i], crop }, G.plant(s, i, crop, t)),
    harvest: (s, i, t) => local({ a: "harvest", ids: [i] }, G.harvest(s, i, t)),
    feedPen: (s, i, t) => local({ a: "feed", ids: [i] }, G.feedPen(s, i, t)),
    collectPen: (s, i, t) => local({ a: "collect", ids: [i] }, G.collectPen(s, i, t)),
    queueProduct: (s, i, g, t) => local({ a: "make", id: i, g }, G.queueProduct(s, i, g, t)),
    collectFactory: (s, i, t) => local({ a: "collectGoods", id: i }, G.collectFactory(s, i, t)),
    addSlot: (s, i) => local({ a: "addSlot", id: i }, G.addSlot(s, i)),
    upgradeBarn: (s) => local({ a: "barn" }, G.upgradeBarn(s)),
    sellGood: (s, g, n) => local({ a: "sellGood", g, n }, G.sellGood(s, g, n)),
    deliverOrder: (s, i, t) => {
      const need = s.orders[i]?.need ? { ...s.orders[i].need } : null
      return local({ a: "deliver", i, need }, G.deliverOrder(s, i, t))
    },
    skipOrder: (s, i, t) => local({ a: "skip", i }, G.skipOrder(s, i, t)),
    loadCar: (s, k, t) => local({ a: "load", k }, G.loadCar(s, k, t)),
    sendTrain: (s, t) => local({ a: "send" }, G.sendTrain(s, t)),
    build: (s, type, x, y, t, flip) => {
      const r = G.build(s, type, x, y, t)
      if (r.ok && flip) r.obj.f = 1
      return local({ a: "build", type, x, y, f: flip ? 1 : 0 }, r)
    },
    move: (s, i, x, y, flip) => local({ a: "move", id: i, x, y, f: flip ? 1 : 0 }, G.move(s, i, x, y, flip)),
    sellObj: (s, i) => local({ a: "sell", id: i }, G.sellObj(s, i)),
    expand: (s, k, t) => local({ a: "expand", k }, G.expand(s, k, t)),
    speedUp: (s, target, t) => local({ a: "hurry", target }, G.speedUp(s, target, t)),
  }

  // ---- hearing from the server ----

  const onPatch = (p) => {
    if (p?.id !== id || !st.confirmed) return
    if (p.rev <= st.rev) return
    if (p.rev !== st.rev + 1) return resync() // missed one
    // for floaters over others' work: what was on those fields before
    const before = p.done?.length ? Object.fromEntries(p.done.map((i) => [i, G.objById(st.confirmed, i)]).filter(([, o]) => o).map(([i, o]) => [i, { ...o }])) : null
    applyPatch(st.confirmed, p.patch)
    st.rev = p.rev
    clockFrom(p.now)
    const mine = p.from && p.from === st.you?.pid
    if (mine) pending = pending.filter((x) => x.seq !== p.seq)
    if (p.line) st.feed = [...st.feed, p.line].slice(-40)
    if (p.from) {
      const pl = st.players.find((x) => x.pid === p.from)
      if (pl) {
        pl.doing = p.doing
        pl.doingAt = Date.now()
      }
    }
    rebuild()
    // my own moves already showed their effects (level ups...) when I made them
    if (!mine && p.ev?.length) call("events", p.ev, p)
    if (p.ev?.some((e) => e.type === "coop-ach")) for (const e of p.ev) if (e.type === "coop-ach" && !st.ach.some((a) => a.id === e.id)) st.ach = [...st.ach, { id: e.id, name: e.name, text: e.text, at: p.now }]
    if (p.from && !mine) call("activity", p, before)
    call("update")
  }
  const onPlayers = (p) => {
    if (p?.id !== id) return
    const old = new Map(st.players.map((x) => [x.pid, x]))
    st.players = p.players.map((x) => ({ ...old.get(x.pid), ...x, cursor: old.get(x.pid)?.cursor || x.cursor }))
    st.members = p.members || st.members
    st.invited = p.invited || []
    call("players")
    call("update")
  }
  const onCursor = (p) => {
    if (p?.id !== id) return
    const pl = st.players.find((x) => x.pid === p.pid)
    if (pl) pl.cursor = { u: p.u, v: p.v }
  }
  const onFeed = (p) => {
    if (p?.id !== id) return
    st.feed = [...st.feed, p.item].slice(-40)
    call("update")
  }
  socket.on("coop:patch", onPatch)
  socket.on("coop:players", onPlayers)
  socket.on("coop:cursor", onCursor)
  socket.on("coop:feed", onFeed)

  const join = async () => {
    const r = await request("coop:join", { id })
    if (st.status === "gone") return r
    if (!r?.ok) {
      // coming back after the network dropped, and the town won't have me any more
      if (st.status === "live") call("failed", r)
      return r
    }
    take(r)
    st.town = r.town
    st.you = r.you
    st.players = r.players
    st.members = r.members
    st.invited = r.invited || []
    st.feed = r.feed || []
    st.stats = r.stats || []
    st.ach = r.ach || []
    pending = []
    queue = []
    rebuild()
    st.status = "live"
    call("update")
    return r
  }

  let lastCursor = ""
  const cursor = (u, v) => {
    const key = `${Math.round(u * 4)},${Math.round(v * 4)}`
    if (key === lastCursor || st.status !== "live") return
    lastCursor = key
    socket.emit("coop:cursor", { id, u, v })
  }

  const close = () => {
    flush()
    st.status = "gone"
    socket.off("coop:patch", onPatch)
    socket.off("coop:players", onPlayers)
    socket.off("coop:cursor", onCursor)
    socket.off("coop:feed", onFeed)
    socket.emit("coop:leave", { id })
  }

  return {
    st,
    actions,
    now,
    join,
    resync,
    flush,
    cursor,
    close,
    // stats change on the server: ask again (the members sheet)
    refreshStats: async () => {
      const r = await request("coop:stats", { id })
      if (r?.ok) {
        st.stats = r.stats || []
        st.ach = r.ach || st.ach
        call("update")
      }
    },
    pendingCount: () => pending.length + queue.length,
  }
}
