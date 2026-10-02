// SPECTRA game rules: pure and deterministic (seeded), no rendering. The tube is straight
// in game space: a position is (s, theta) = distance along the tube and angle around it.
// The renderer bends and colors it; nothing here depends on how it looks.
//
// Fairness: every gate is generated so it's reachable from every gap of the gate before
// it, in the time between them, at keyboard turning speed (see reachable()). A bot test
// flies thousands of gates at every difficulty to prove it.

export const TAU = Math.PI * 2
export const MAX_OMEGA = 4.2 // rad/s at full keyboard steer
export const PLAYER_HALF = 0.1 // half the ship's width, in radians
export const GRAZE_MARGIN = 0.14 // passing this close to a gap's edge is a graze
export const SHARD_RADIUS = 0.3 // how close (rad) you must be to collect a shard
export const OVERDRIVE_SECONDS = 4
export const OVERDRIVE_BOOST = 1.35
export const ZONE_LENGTH = 1200
const FAIR = 0.55 // fraction of the theoretical turn budget a gate may demand
const VIEW_AHEAD = 230 // gates exist this far ahead
const COMBO_PER_TIER = 6
const MAX_MULTIPLIER = 8
const METER_PER_SHARD = 0.05

export const ZONES = ["Aurora", "Ultraviolet", "Solar Flare", "Deep Bloom", "Hyperprism", "Event Horizon"]
export const zoneName = (zone) => ZONES[zone % ZONES.length] + (zone >= ZONES.length ? ` ${Math.floor(zone / ZONES.length) + 1}` : "")

// ---- math ----

export const wrap = (a) => ((a % TAU) + TAU) % TAU
// signed shortest angle from a to b, in (-PI, PI]
export const angleDelta = (a, b) => {
  const d = wrap(b - a)
  return d > Math.PI ? d - TAU : d
}
export const angleDist = (a, b) => Math.abs(angleDelta(a, b))
const lerp = (a, b, t) => a + (b - a) * t
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// mulberry32: small, fast, seedable
export const createRng = (seed) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---- difficulty curve (by distance, so pausing or slow frames can't change it) ----

export const difficulty = (distance) => clamp(distance / 9000, 0, 1)
export const baseSpeed = (distance) => 16 + 26 * difficulty(distance)
const timeGapAt = (d) => lerp(1.5, 0.72, d) // seconds between gates
const gapHalfAt = (d) => lerp(0.95, 0.42, d)

// How far (rad) the player can be asked to turn between two gates
export const turnBudget = (timeGap) => Math.min(2.6, FAIR * MAX_OMEGA * timeGap)

// Gap center at the moment the player reaches the gate. Rotating gates turn as you
// approach and land exactly on `center` when you arrive, whatever your speed.
export const gapCenterAt = (gate, gap, distance) => wrap(gap.center + gate.spin * (gate.s - distance))

// Every passable position of every gap in `from` can reach some gap in `to`
export const reachable = (from, to, budget) =>
  from.gaps.every((p) =>
    to.gaps.some((n) => angleDist(p.center, n.center) + (p.half - PLAYER_HALF) <= budget + (n.half - PLAYER_HALF))
  )

// ---- level generation ----

const PATTERNS = ["drift", "drift", "spiral", "slalom", "double", "rotor", "breather"]

// Plans the next run of gates after `last` (or the start). Returns gate specs with gaps.
const planPattern = (rng, last, d) => {
  const unlocked = PATTERNS.filter((p) => (p === "rotor" ? d > 0.2 : p === "double" ? d > 0.1 : true))
  const kind = last ? unlocked[Math.floor(rng() * unlocked.length)] : "breather"
  const count = kind === "breather" ? 2 : 3 + Math.floor(rng() * (kind === "spiral" ? 5 : 3))
  const dir = rng() < 0.5 ? -1 : 1
  const specs = []
  for (let i = 0; i < count; i++) {
    const half = kind === "breather" ? Math.min(1.6, gapHalfAt(d) * 1.8) : gapHalfAt(d) * lerp(0.9, 1.1, rng())
    let shift
    switch (kind) {
      case "spiral":
        shift = dir * 0.8
        break
      case "slalom":
        shift = (i % 2 ? -1 : 1) * dir * 0.9
        break
      case "breather":
        shift = (rng() - 0.5) * 0.4
        break
      default:
        shift = (rng() * 2 - 1) * 0.85
    }
    specs.push({ kind, half, shift, double: kind === "double", spin: kind === "rotor" ? dir * lerp(0.02, 0.05, d) * (rng() < 0.5 ? -1 : 1) : 0 })
  }
  return specs
}

const makeGate = (s, spec, center) => ({
  s,
  spin: spec.spin,
  kind: spec.kind,
  gaps: spec.double
    ? [
        { center: wrap(center), half: spec.half },
        { center: wrap(center + Math.PI), half: spec.half },
      ]
    : [{ center: wrap(center), half: spec.half }],
  done: false,
  result: null, // "pass" | "graze" | "smash" | "crash"
})

// Shards along the line from one gate's gaps to the next's
const shardsBetween = (rng, a, b, out) => {
  const count = 3 + Math.floor(rng() * 3)
  for (const pa of a.gaps) {
    // aim at the closest gap of the next gate
    let target = b.gaps[0]
    for (const g of b.gaps) if (angleDist(pa.center, g.center) < angleDist(pa.center, target.center)) target = g
    const delta = angleDelta(pa.center, target.center)
    for (let i = 0; i < count; i++) {
      const t = (i + 1) / (count + 1)
      out.push({ s: lerp(a.s, b.s, t), theta: wrap(pa.center + delta * t), taken: false, missed: false })
    }
    if (a.gaps.length > 1 && rng() < 0.5) break // doubles: sometimes only one lane has shards
  }
}

const extendLevel = (state) => {
  const { rng } = state
  while (state.spawnS < state.distance + VIEW_AHEAD) {
    const last = state.gates[state.gates.length - 1] || null
    const d = difficulty(state.spawnS)
    const speed = baseSpeed(state.spawnS)
    const gap = timeGapAt(d)
    const budget = turnBudget(gap)
    for (const spec of planPattern(rng, last, d)) {
      const prev = state.gates[state.gates.length - 1] || null
      const s = prev ? prev.s + speed * gap : state.spawnS
      const from = prev ? prev.gaps[0].center : state.theta
      let gate = makeGate(s, spec, from + spec.shift * budget)
      // Fairness: if this gate can't be reached from every gap of the last one, pull it
      // toward the previous gap (always reachable), or drop the second gap of a double.
      if (prev && !reachable(prev, gate, budget)) {
        gate = makeGate(s, { ...spec, double: false }, from + spec.shift * budget * 0.4)
        if (!reachable(prev, gate, budget)) {
          // between both gaps of a double, or straight ahead
          const mid = prev.gaps.length > 1 ? prev.gaps[0].center + Math.PI / 2 : from
          gate = makeGate(s, { ...spec, double: false, spin: spec.spin }, mid)
          if (!reachable(prev, gate, budget)) gate = makeGate(s, { ...spec, double: false, half: Math.max(spec.half, 1.6) }, mid)
        }
      }
      if (prev) shardsBetween(rng, prev, gate, state.shards)
      state.gates.push(gate)
      state.spawnS = s
    }
  }
}

// ---- state ----

export const createGame = (seed = Date.now()) => {
  const state = {
    seed,
    rng: createRng(seed),
    status: "playing",
    time: 0,
    distance: 0,
    speed: baseSpeed(0),
    theta: 0,
    thetaVel: 0,
    score: 0,
    combo: 0,
    multiplier: 1,
    shardsCollected: 0,
    grazes: 0,
    smashes: 0,
    meter: 0,
    overdrive: 0, // seconds left
    zone: 0,
    gates: [],
    shards: [],
    spawnS: 40, // first gate 40 units out: a moment to get your bearings
    events: [],
  }
  extendLevel(state)
  return state
}

const emit = (state, type, data = {}) => state.events.push({ type, ...data })

const setCombo = (state, combo) => {
  const before = state.multiplier
  state.combo = combo
  state.multiplier = Math.min(MAX_MULTIPLIER, 1 + Math.floor(combo / COMBO_PER_TIER))
  if (state.multiplier !== before) emit(state, "multiplier", { multiplier: state.multiplier, up: state.multiplier > before })
}

// Judge a gate at the moment the player crosses it
const crossGate = (state, gate) => {
  gate.done = true
  // Clearance: how far inside the roomiest gap the ship's edge is (negative = it hits)
  let best = -Infinity
  for (const gap of gate.gaps) {
    const off = angleDist(state.theta, gapCenterAt(gate, gap, gate.s))
    best = Math.max(best, gap.half - PLAYER_HALF - off)
  }
  if (best >= 0) {
    if (best < GRAZE_MARGIN) {
      gate.result = "graze"
      state.grazes++
      state.score += 100 * state.multiplier
      emit(state, "graze", { theta: state.theta })
    } else {
      gate.result = "pass"
      emit(state, "pass")
    }
  } else if (state.overdrive > 0) {
    gate.result = "smash"
    state.smashes++
    state.score += 200 * state.multiplier
    emit(state, "smash", { s: gate.s })
  } else {
    gate.result = "crash"
    state.status = "over"
    emit(state, "crash", { theta: state.theta })
  }
}

// input: { steer: -1..1, turn: radians to add now (drag), overdrive: bool (pressed) }
export const step = (state, dt, input = {}) => {
  state.events = []
  if (state.status !== "playing") return state
  dt = Math.min(Math.max(dt, 0), 0.05)
  state.time += dt

  // steering: keyboard eases toward full turn speed; drags turn directly
  const target = clamp(input.steer || 0, -1, 1) * MAX_OMEGA
  state.thetaVel += (target - state.thetaVel) * Math.min(1, dt * 18)
  state.theta = wrap(state.theta + state.thetaVel * dt + (input.turn || 0))

  if (input.overdrive && state.meter >= 1 && state.overdrive <= 0) {
    state.overdrive = OVERDRIVE_SECONDS
    state.meter = 0
    emit(state, "overdrive")
  }

  state.speed = baseSpeed(state.distance) * (state.overdrive > 0 ? OVERDRIVE_BOOST : 1)
  const before = state.distance
  state.distance += state.speed * dt
  const after = state.distance

  // Everything crossed this frame, in order along the tube (no skipping, however long the frame)
  const crossings = []
  for (const gate of state.gates) if (!gate.done && gate.s > before && gate.s <= after) crossings.push({ s: gate.s, gate })
  for (const shard of state.shards) if (!shard.taken && !shard.missed && shard.s > before && shard.s <= after) crossings.push({ s: shard.s, shard })
  crossings.sort((a, b) => a.s - b.s)

  for (const { gate, shard } of crossings) {
    if (state.status !== "playing") break
    if (gate) crossGate(state, gate)
    else if (angleDist(state.theta, shard.theta) <= SHARD_RADIUS) {
      shard.taken = true
      state.shardsCollected++
      state.meter = Math.min(1, state.meter + METER_PER_SHARD)
      state.score += 50 * state.multiplier
      setCombo(state, state.combo + 1)
      emit(state, "shard", { theta: shard.theta, s: shard.s, combo: state.combo })
    } else {
      shard.missed = true
      // missing a shard drops you one multiplier tier (and its progress)
      setCombo(state, Math.max(0, (state.multiplier - 2) * COMBO_PER_TIER))
      emit(state, "miss")
    }
  }

  if (state.status !== "playing") return state

  if (state.overdrive > 0) {
    state.overdrive = Math.max(0, state.overdrive - dt)
    if (state.overdrive === 0) emit(state, "overdriveEnd")
  }

  state.score += state.speed * dt * 0.5 * state.multiplier * (state.overdrive > 0 ? 2 : 1)

  const zone = Math.floor(state.distance / ZONE_LENGTH)
  if (zone !== state.zone) {
    state.zone = zone
    emit(state, "zone", { zone })
  }

  // forget what's behind, build what's ahead
  state.gates = state.gates.filter((g) => g.s > state.distance - 12)
  state.shards = state.shards.filter((s) => s.s > state.distance - 12)
  extendLevel(state)
  return state
}

export const finalScore = (state) => Math.floor(state.score)
