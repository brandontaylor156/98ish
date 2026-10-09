// My Park > Work out (pure; no three.js, no DOM): working out as a rhythm game. The owner: "The
// ability to work out and make it like, fun where working out is a game."
//
// Each move is a set of reps on a beat: a squat every two beats, a curl, a press, a row (swipe
// down for it), jumping jacks, and sprints on a treadmill (a tap on every beat, quicker). Tap
// (or swipe) when the rep's note reaches the ring: within 70 ms is Perfect, 150 ms Good, later
// or not at all a Miss. A streak of good reps builds a multiplier (x1.5 at 10, x2 at 20, up to
// x3). Today's workout is five moves in an order and at tempos picked from the date, so it's
// the same for everyone today (and for the two of you, working out together). Real reps: the
// phone's camera counts them (repCounter below; MediaPipe's pose, on the phone only).
//
//   const w = createWorkout({ plan, start }); w.tap(now); w.step(now) -> events; w.state
//   todaysPlan(date) / quickPlan(move)
//   repCounter(move) -> { push(landmarks, t) -> rep? }

export const MOVES = {
  squat: { name: "Squats", icon: "🏋", input: "tap", every: 2, mood: "squat", bpm: [84, 104], how: "Down on the beat" },
  curl: { name: "Curls", icon: "💪", input: "tap", every: 2, mood: "curl", bpm: [88, 108], how: "Curl on the beat" },
  press: { name: "Shoulder press", icon: "🙌", input: "tap", every: 2, mood: "press", bpm: [84, 100], how: "Press up on the beat" },
  row: { name: "Rows", icon: "🚣", input: "swipe", every: 2, mood: "row", bpm: [80, 96], how: "Swipe down to pull" },
  jack: { name: "Jumping jacks", icon: "⭐", input: "tap", every: 1, mood: "jack", bpm: [100, 120], how: "Jump on every beat" },
  sprint: { name: "Treadmill sprint", icon: "🏃", input: "tap", every: 0.5, mood: null, bpm: [120, 140], how: "Tap on every step", treadmill: true },
}
export const MOVE_IDS = Object.keys(MOVES)
export const WINDOW = { perfect: 0.07, good: 0.15 }
export const SET_S = 20 // a move in today's workout
export const QUICK_S = 30
export const REST_S = 4
export const LEAD_S = 3 // the count-in before the first note

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const hash = (s) => {
  let h = 2166136261
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}
const rng = (seed) => {
  let s = seed >>> 0 || 1
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

// a set: { move, bpm, from (s after the start), notes: [t...] }
const setOf = (move, bpm, from, seconds) => {
  const M = MOVES[move]
  const beat = 60 / bpm
  const step = beat * M.every
  const notes = []
  for (let t = from; t <= from + seconds - step * 0.5; t += step) notes.push(Math.round(t * 1000) / 1000)
  return { move, bpm, from, to: from + seconds, beat, notes }
}

// today's workout: five moves (one of them on the treadmill, if the gym has one), tempos from the date
export const todaysPlan = (date = new Date(), { treadmill = true } = {}) => {
  const rand = rng(hash(`workout:${dayKey(date)}`))
  const pool = MOVE_IDS.filter((m) => treadmill || !MOVES[m].treadmill)
  const order = pool.slice().sort((a, b) => hash(`${dayKey(date)}:${a}`) - hash(`${dayKey(date)}:${b}`)).slice(0, 5)
  let t = LEAD_S
  const sets = order.map((m) => {
    const [lo, hi] = MOVES[m].bpm
    const bpm = Math.round(lo + rand() * (hi - lo))
    const s = setOf(m, bpm, t, SET_S)
    t += SET_S + REST_S
    return s
  })
  return { kind: "daily", day: dayKey(date), sets, length: t - REST_S }
}
export const quickPlan = (move = "squat", bpm = null) => {
  const M = MOVES[move] || MOVES.squat
  const b = bpm || Math.round((M.bpm[0] + M.bpm[1]) / 2)
  return { kind: "quick", sets: [setOf(move, b, LEAD_S, QUICK_S)], length: LEAD_S + QUICK_S }
}

// the multiplier a streak has earned
export const multOf = (streak) => Math.min(3, 1 + Math.floor(streak / 10) * 0.5)
export const POINTS = { perfect: 100, good: 50 }

// a workout running from `start` (seconds, any clock: the caller's); tap(now) / swipe(now) / step(now)
export const createWorkout = ({ plan }) => {
  const notes = []
  for (const s of plan.sets) for (const t of s.notes) notes.push({ t, move: s.move, input: MOVES[s.move].input, judged: null })
  const st = { score: 0, streak: 0, best: 0, perfect: 0, good: 0, miss: 0, real: 0, done: false, last: null, set: 0 }
  let next = 0 // the first note not judged yet
  const judge = (n, kind, now) => {
    n.judged = kind
    if (kind === "miss") {
      st.miss++
      st.streak = 0
    } else {
      st[kind]++
      st.streak++
      st.best = Math.max(st.best, st.streak)
      st.score += Math.round(POINTS[kind] * multOf(st.streak - 1))
    }
    st.last = { kind, t: now, at: n.t }
    return { type: "judge", kind, note: n, streak: st.streak }
  }
  // the note an input is for: the nearest unjudged one in reach of `now`
  const nearest = (now, input, reach) => {
    let best = null
    for (let i = next; i < notes.length && notes[i].t < now + reach; i++) {
      const n = notes[i]
      if (n.judged || (input && n.input !== input)) continue
      const d = Math.abs(n.t - now)
      if (d <= reach && (!best || d < Math.abs(best.t - now))) best = n
    }
    return best
  }
  const hit = (now, input, windows = WINDOW) => {
    if (st.done) return null
    const n = nearest(now, input, windows.good)
    if (!n) return null // (a tap between the notes: nothing; it never counts against you)
    const d = Math.abs(n.t - now)
    return judge(n, d <= windows.perfect ? "perfect" : "good", now)
  }
  const w = {
    plan,
    notes,
    state: st,
    tap: (now) => hit(now, "tap"),
    swipe: (now) => hit(now, "swipe") || hit(now, "tap"),
    // a rep the camera saw: more room either way (a body isn't a thumb)
    real(now) {
      const e = hit(now, null, { perfect: 0.22, good: 0.6 })
      if (e) st.real++
      return e
    },
    // notes gone by unanswered are misses; which set we're in; done at the end
    step(now) {
      const out = []
      while (next < notes.length && (notes[next].judged || notes[next].t < now - WINDOW.good)) {
        if (!notes[next].judged) out.push(judge(notes[next], "miss", now))
        next++
      }
      const si = plan.sets.findIndex((s) => now < s.to + REST_S * 0.5)
      st.set = si < 0 ? plan.sets.length - 1 : si
      if (!st.done && now > plan.length + 0.4) {
        st.done = true
        out.push({ type: "done" })
      }
      return out
    },
    // the set you're in at `now`, and where in its rep (0..1, the note at 0.5) the body is
    at(now) {
      const s = plan.sets[st.set] || plan.sets[0]
      const step = s.beat * MOVES[s.move].every
      const into = now - s.from
      const resting = now < s.from || now > s.to
      const p = resting ? 0 : (((into / step + 0.5) % 1) + 1) % 1
      return { set: s, index: st.set, p, resting, left: Math.max(0, s.to - now), beat: s.beat }
    },
    result() {
      return { reps: st.perfect + st.good, perfect: st.perfect, streak: st.best, score: st.score, misses: st.miss, real: st.real }
    },
  }
  return w
}

// ---------- real reps from the camera (MediaPipe pose landmarks, image coords, y down) ----------
// 0 nose, 11/12 shoulders, 13/14 elbows, 15/16 wrists, 23/24 hips, 25/26 knees, 27/28 ankles
const mid = (a, b) => (a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v ?? 1, b.v ?? 1) } : a || b)
// a signal per move, 0 at rest and 1 at the top of the rep, from the body's own lengths (so
// how far you stand from the phone doesn't matter)
export const repSignal = (move, lm) => {
  if (!lm || lm.length < 29) return null
  const sh = mid(lm[11], lm[12])
  const hip = mid(lm[23], lm[24])
  const torso = Math.abs(hip.y - sh.y)
  if (!(torso > 1e-3) || (sh.v ?? 1) < 0.3 || (hip.v ?? 1) < 0.3) return null
  const knee = mid(lm[25], lm[26])
  const wrist = mid(lm[15], lm[16])
  const elbow = mid(lm[13], lm[14])
  if (move === "squat") return clamp(1 - (knee.y - hip.y) / (torso * 0.95), 0, 1) // hips drop to the knees
  if (move === "curl") return clamp((elbow.y - wrist.y) / (torso * 0.45) + 0.5, 0, 1) // wrists up past the elbows
  if (move === "press" || move === "jack") return clamp((sh.y - wrist.y) / (torso * 0.9), 0, 1) // hands up over the head
  if (move === "row") return clamp(1 - Math.abs(wrist.y - hip.y) / (torso * 0.6), 0, 1) // hands pulled to the waist
  if (move === "sprint") {
    const k = Math.min(lm[25].y, lm[26].y)
    return clamp((hip.y + torso * 0.55 - k) / (torso * 0.45), 0, 1) // a knee up
  }
  return null
}
// counts reps with hysteresis: up past 0.65 and back under 0.35 is one (for a sprint, each
// knee lift); push(landmarks, t) -> true when a rep completes
export const repCounter = (move, { up = 0.65, down = 0.35 } = {}) => {
  let high = false
  let reps = 0
  let smooth = null
  return {
    get reps() {
      return reps
    },
    push(lm) {
      const s = repSignal(move, lm)
      if (s === null) return false
      smooth = smooth === null ? s : smooth + (s - smooth) * 0.6
      if (!high && smooth > up) {
        high = true
        // (a squat counts at the bottom, everything else at the top)
        reps++
        return true
      }
      if (high && smooth < down) high = false
      return false
    },
  }
}
