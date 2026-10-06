// LAN Party 98: the lobby for DOS LAN games (DOOM/Heretic shareware over IPX).
//
// The game traffic never comes here. js-dos runs DOSBox's IPX network over WebRTC (HumbleNet):
// the host's emulator starts an IPX server and gets a peer id from js-dos's signaling server;
// the others connect to that peer id, phone to phone. This module only lets friends find the
// host's game: the host publishes { game, players, mode, peerId } under a short code, buddies
// see it in their list, anyone with the code can join, and the host hears who's coming.
// Memory only: nothing is stored, a game is forgotten when its host stops or leaves, or after
// MAX_MS. (So Delete My Account has nothing to erase.)
//
// Socket events (client -> server, with an ack):
//   lan:host  { game, nodes, deathmatch, peerId }   -> { ok, code }
//   lan:stop  {}                                    -> { ok }
//   lan:join  { code }                              -> { ok, game: { code, game, nodes, deathmatch, peerId, host } }
//   lan:leave { code }                              -> { ok }
//   lan:list  {}                                    -> { ok, games: [view] }   (your buddies' games, and your own)
// Server -> client: lan:joined { code, name, count }, lan:left { code, name, count }, lan:end { code, reason }

const crypto = require("crypto")

const GAMES = new Set(["doom", "heretic"])
const MAX_GAMES = 40
const MAX_NODES = 4
const MAX_MS = 3 * 60 * 60 * 1000
const RATE = { n: 20, ms: 60_000 }
const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v)
const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

const createLanParty = ({ emit = () => {}, aim = () => null, now = Date.now, limits = {} } = {}) => {
  const L = { maxGames: MAX_GAMES, maxMs: MAX_MS, ...limits }
  const games = new Map() // code -> game
  const byHost = new Map() // pid -> code
  const hits = new Map() // pid -> [times]

  const allowed = (pid) => {
    const t = now()
    const list = (hits.get(pid) || []).filter((x) => t - x < RATE.ms)
    if (list.length >= RATE.n) return false
    list.push(t)
    hits.set(pid, list)
    return true
  }

  const newCode = () => {
    for (;;) {
      const code = crypto.randomBytes(3).toString("hex").slice(0, 5).toUpperCase().replace(/[01]/g, "7")
      if (!games.has(code)) return code
    }
  }

  // may `me` see this game in their list? (their own, or a buddy's who hasn't blocked them)
  // (signed-on 98 Messenger users, as server/broadcast looks them up)
  const userOf = (key) => (key ? aim()?.sessions?.get(key)?.user || null : null)
  const buddiesOf = (u) => new Set((u?.groups || []).flatMap((x) => x.buddies || []).map(keyOf))
  const canSee = (me, g) => {
    if (g.hostPid === me.pid) return true
    if (!me.key || !g.hostKey) return false
    const host = userOf(g.hostKey)
    const mine = userOf(me.key)
    if (!host) return false
    if ((host.blocked || []).includes(me.key) || (mine?.blocked || []).includes(g.hostKey)) return false
    return buddiesOf(host).has(me.key) || buddiesOf(mine).has(g.hostKey)
  }

  const view = (g) => ({ code: g.code, game: g.game, nodes: g.nodes, deathmatch: g.deathmatch, peerId: g.peerId, host: g.hostName, count: 1 + g.players.size, startedAt: g.startedAt })

  const end = (code, reason) => {
    const g = games.get(code)
    if (!g) return
    games.delete(code)
    byHost.delete(g.hostPid)
    for (const pid of g.players.keys()) emit(pid, "lan:end", { code, reason })
  }

  const host = (me, p) => {
    if (!allowed(me.pid)) return { ok: false, error: "Slow down a little." }
    const game = String(p.game || "")
    if (!GAMES.has(game)) return { ok: false, error: "That game can't be played on the LAN." }
    const peerId = Number(p.peerId)
    if (!Number.isInteger(peerId) || peerId <= 0 || peerId > 0x7fffffff) return { ok: false, error: "The game's network isn't ready yet." }
    const old = byHost.get(me.pid)
    if (old) end(old, "replaced")
    if (games.size >= L.maxGames) return { ok: false, error: "Too many LAN games are running right now. Try again soon." }
    const nodes = Math.max(2, Math.min(MAX_NODES, Math.round(Number(p.nodes) || 2)))
    const code = newCode()
    games.set(code, { code, game, nodes, deathmatch: !!p.deathmatch, peerId, hostPid: me.pid, hostKey: me.key || null, hostName: me.name || "Someone", players: new Map(), startedAt: now() })
    byHost.set(me.pid, code)
    return { ok: true, code }
  }

  const stop = (me) => {
    const code = byHost.get(me.pid)
    if (code) end(code, "stopped")
    return { ok: true }
  }

  const join = (me, p) => {
    if (!allowed(me.pid)) return { ok: false, error: "Slow down a little." }
    const code = String(p.code || "").trim().toUpperCase()
    const g = games.get(code)
    if (!g) return { ok: false, error: "There's no LAN game with that code. Check it with your friend." }
    if (g.hostPid === me.pid) return { ok: false, error: "That's your own game." }
    if (!g.players.has(me.pid) && 1 + g.players.size >= g.nodes) return { ok: false, error: "That game is full." }
    g.players.set(me.pid, me.name || "Someone")
    emit(g.hostPid, "lan:joined", { code, name: me.name || "Someone", count: 1 + g.players.size })
    return { ok: true, game: view(g) }
  }

  const leave = (me, p) => {
    const g = games.get(String(p.code || "").toUpperCase())
    if (g && g.players.delete(me.pid)) emit(g.hostPid, "lan:left", { code: g.code, name: me.name || "Someone", count: 1 + g.players.size })
    return { ok: true }
  }

  const list = (me) => {
    const t = now()
    for (const g of [...games.values()]) if (t - g.startedAt > L.maxMs) end(g.code, "expired")
    return { ok: true, games: [...games.values()].filter((g) => canSee(me, g)).map(view) }
  }

  // a computer left the network: its game ends, its seats free up
  const drop = (pid) => {
    const code = byHost.get(pid)
    if (code) end(code, "host-left")
    for (const g of games.values()) if (g.players.delete(pid)) emit(g.hostPid, "lan:left", { code: g.code, name: "Someone", count: 1 + g.players.size })
    hits.delete(pid)
  }

  // ---------- sockets (server/net: wire(socket, current, who)) ----------
  const wire = (socket, current, who) => {
    const on = (event, handler) =>
      socket.on(event, (payload = {}, ack = () => {}) => {
        if (typeof ack !== "function") ack = () => {}
        const computer = current()
        if (!computer) return ack({ ok: false, error: "Not connected to the network." })
        try {
          ack(handler(who(computer), isObject(payload) ? payload : {}) || { ok: true })
        } catch (error) {
          console.error(`[lanparty] ${event} failed`, error)
          ack({ ok: false, error: "Something went wrong. Please try again." })
        }
      })
    on("lan:host", host)
    on("lan:stop", stop)
    on("lan:join", join)
    on("lan:leave", leave)
    on("lan:list", list)
  }

  return { host, stop, join, leave, list, drop, wire, games }
}

module.exports = { createLanParty, MAX_NODES }
