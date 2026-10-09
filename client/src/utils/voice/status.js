// Spatial voice: what to tell you about it, in words (pure; the HUD chips in My Park, Come
// Over and Watch Together show the first line). A session's state (session.js) + names by id.
//   voiceStatus(state, names) -> { line, problem: bool, hearing: n, connecting: [name], far: [name], failed: [name] }

const nameOf = (names, id) => names?.[id] || `Player ${id}`
const list = (xs) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, 2).join(", ")} and ${xs.length - 2} more`)

export const voiceStatus = (state, names = {}) => {
  const out = { line: "", problem: false, hearing: 0, connecting: [], far: [], failed: [] }
  if (!state || state.status === "off") return out
  if (state.status === "error") return { ...out, line: state.error || "Voice isn't available right now.", problem: true }
  if (state.status === "starting") return { ...out, line: "Starting your microphone..." }
  if (state.status === "paused") return { ...out, line: state.error || "Voice paused: back in 98ish to talk." }
  const peers = state.peers || {}
  for (const [id, p] of Object.entries(peers)) {
    if (p.state === "connected") out.hearing++
    else if (p.state === "new" || p.state === "connecting" || p.state === "checking") out.connecting.push(nameOf(names, id))
  }
  const problems = Object.entries(state.problems || {})
  out.failed = problems.map(([id]) => nameOf(names, id))
  out.far = (state.far || []).filter((id) => !peers[id]).map((id) => nameOf(names, id))
  if (problems.length) {
    const needsRelay = problems.some(([, p]) => !p.turn)
    out.problem = true
    out.line = needsRelay
      ? `Voice couldn't connect to ${list(out.failed)}: one of you is on a network that needs a relay (often cellular data). Try both on Wi-Fi. Trying again soon.`
      : `Voice couldn't connect to ${list(out.failed)}. Trying again soon.`
    return out
  }
  if (out.connecting.length) return { ...out, line: `Connecting to ${list(out.connecting)}...` }
  if (out.hearing) return { ...out, line: out.hearing === 1 ? "Hearing 1 person near you" : `Hearing ${out.hearing} people near you` }
  if (out.far.length) return { ...out, line: `${list(out.far)} ${out.far.length === 1 ? "has" : "have"} voice on but ${out.far.length === 1 ? "is" : "are"} too far away. Walk closer.` }
  return { ...out, line: "Nobody near you has voice on yet. Friends tap the mic too." }
}
