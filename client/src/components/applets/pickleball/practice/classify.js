// Pickleball 98 practice: what each of your shots was, in one word, and what to do about a
// mistake that keeps happening. Pure JavaScript.
//
// A result (session.js) is { outcome, shot, landing, fed, fault, ... }:
//   outcome: "in" | "out" | "net" | "miss" | "fault"
//   shot: match.js m.lastShot for your shot ({ kind, tag, label, tone, attackable, speed,
//         volley, grade, pace }) or null (you never hit it)
//   landing: where it bounced ({ x, z }) or null

import { HALF_L, HALF_W, KITCHEN } from "../physics.js"

export const MPH = 2.23694

const SOFT = new Set(["dink", "drop", "reset", "block"])

// The label: one short word or two, and a tone (good | ok | warn | bad)
export const classifyShot = (res) => {
  if (!res) return null
  const s = res.shot
  if (res.outcome === "miss" || !s) return { text: "Missed", tone: "bad", code: "miss" }
  if (res.outcome === "fault") return { text: /kitchen/i.test(res.fault || "") ? "Kitchen fault" : "Fault", tone: "bad", code: /kitchen/i.test(res.fault || "") ? "kitchen" : "fault" }
  if (res.outcome === "net") return { text: "Net", tone: "bad", code: SOFT.has(s.kind) || s.kind === "dink" ? "net-soft" : "net-hard" }
  if (res.outcome === "out") {
    const l = res.landing
    const wide = l && Math.abs(l.x) > HALF_W && Math.abs(l.z) <= HALF_L
    return { text: wide ? "Wide" : "Out", tone: "bad", code: wide ? "wide" : SOFT.has(s.kind) || s.kind === "lob" ? "long-soft" : "long" }
  }
  // in
  if (s.tag === "popup" || (SOFT.has(s.kind) && s.attackable)) return { text: "Pop-up", tone: "warn", code: "popup" }
  switch (s.kind) {
    case "dink":
      return { text: "Dink", tone: "good", code: "dink" }
    case "drop":
      return { text: "Drop", tone: "good", code: "drop" }
    case "reset":
    case "block":
      return { text: "Reset", tone: "good", code: "reset" }
    case "speedup":
      return s.tag === "speedup" && s.tone === "warn" ? { text: "Speed-up from low", tone: "warn", code: "low-attack" } : { text: "Speed-up", tone: "good", code: "speedup" }
    case "counter":
      return { text: "Counter", tone: "good", code: "counter" }
    case "smash":
      return { text: "Smash", tone: "good", code: "smash" }
    case "lob":
      return { text: "Lob", tone: "ok", code: "lob" }
    case "punch":
      return { text: "Volley", tone: "good", code: "volley" }
    case "serve":
      return { text: "Serve", tone: "ok", code: "serve" }
    case "return":
      return { text: "Return", tone: "ok", code: "return" }
    case "roll":
      return { text: "Roll", tone: "ok", code: "drive" }
    default:
      return { text: s.volley ? "Volley" : "Drive", tone: "ok", code: s.volley ? "volley" : "drive" }
  }
}

// What to do about each mistake (one line)
export const HINTS = {
  miss: "Get to the ball: press hit as it comes, let go just before it reaches you.",
  "net-soft": "Into the net: aim a little deeper so it clears the tape.",
  "net-hard": "Into the net: meet it out in front and let go a touch earlier.",
  long: "Long: from a low ball, tap softer (a shorter hold).",
  "long-soft": "Long: aim shorter, into the kitchen.",
  wide: "Wide: aim more toward the middle of their court.",
  popup: "Too high: aim lower over the net, a quick soft tap.",
  "low-attack": "Only speed up balls above the net. Dink the low ones.",
  kitchen: "Kitchen fault: after a volley, stop before the line.",
  fault: "Fault: let the serve and the return bounce first.",
  late: "Late: let go a little sooner.",
  early: "Early: wait a moment longer before letting go.",
}

// a timing grade that keeps going wrong is a mistake too
const timingCode = (res) => {
  const g = res?.shot?.grade
  if (g === "late" || g === "very late") return "late"
  if (g === "early" || g === "very early") return "early"
  return null
}

// The hint to show, if the same mistake happened in 2 of the last 3 shots (null otherwise).
// history: results, oldest first (each with .label from classifyShot)
export const hintFor = (history) => {
  const last = history.slice(-3)
  if (last.length < 2) return null
  const codes = last.map((r) => (r.label?.tone === "bad" || r.label?.tone === "warn" ? r.label.code : null))
  const now = codes.at(-1)
  if (now && HINTS[now] && codes.filter((c) => c === now).length >= 2) return HINTS[now]
  const t = last.map(timingCode)
  if (t.at(-1) && t.filter((c) => c === t.at(-1)).length >= 2) return HINTS[t.at(-1)]
  return null
}

// a landing in their kitchen (or close to it)
export const inTheirKitchen = (l, slack = 0.02) => !!l && l.z < 0 && -l.z <= KITCHEN + slack && Math.abs(l.x) <= HALF_W + 0.02
export const inTheirCourt = (l) => !!l && l.z < 0 && -l.z <= HALF_L + 0.02 && Math.abs(l.x) <= HALF_W + 0.02
export const deepInTheirCourt = (l) => inTheirCourt(l) && -l.z >= HALF_L - 2.4
