// Tetherball on the online room system (server/arcade/rooms.js): a real-time game in relay
// mode, one against one. The host's browser runs the match (client/src/components/applets/
// tetherball/netplay.js): physics, both players' runs, the score. The guest's browser sends
// its swings (with the host time they started) and draws the host's snapshots; the server
// only seats people, checks the settings and the relay messages, and records the result.

const TARGETS = [1, 2, 3]
const defaultSettings = { target: 2 }

const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null)

module.exports = {
  id: "tetherball",
  name: "Tetherball",
  minPlayers: 2,
  maxPlayers: 2,
  relay: true,
  spectate: false,
  defaultSettings,
  validateSettings: (s = {}) => {
    const out = { ...defaultSettings }
    if (s.target !== undefined) {
      const t = Number(s.target)
      if (!TARGETS.includes(t)) return { error: "Play to 1, 2 or 3 games." }
      out.target = t
    }
    return out
  },
  bucket: (s) => `to${s.target}`,
  // reliable messages: the guest's swing ({ type: "swing", at, power, loft }), the host's
  // start ({ type: "start", seed, target }) and the final score ({ type: "final", games })
  filterRelay: (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null
    if (data.type === "swing") {
      const at = num(data.at, 0, 1e7)
      const power = num(data.power, 0, 1)
      const loft = num(data.loft, -0.6, 0.9)
      if (at === null || power === null || loft === null) return null
      return { type: "swing", at, power, loft, id: Number.isInteger(data.id) ? data.id : 0 }
    }
    if (data.type === "start") return { type: "start", seed: Number.isInteger(data.seed) ? data.seed : 1, target: TARGETS.includes(data.target) ? data.target : 2 }
    if (data.type === "final") return { type: "final", games: Array.isArray(data.games) ? data.games.slice(0, 2).map((g) => num(g, 0, 9) ?? 0) : [0, 0], winner: data.winner === 1 ? 1 : 0 }
    if (data.type === "hello" || data.type === "again") return { type: data.type }
    return null
  },
}
