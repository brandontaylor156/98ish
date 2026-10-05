// Pickleball 98: standing like an athlete. Pure JavaScript (Node-tested in idle.test.js).
//
// A player standing still is never frozen (the owner: "even just standing there they look
// creepy"): between points the weight goes from one leg to the other every few seconds (the
// hips over the standing leg, the other hip dropping: contrapposto), the chest rises and falls
// with the breath, heavier after a long run; ready in a rally, a light, uneven bounce on the
// balls of the feet and small weight shifts, the way a player stays live waiting for the ball.
// anim.js moves the motion-captured body by these (motion matching only: the procedural
// footwork has its own sway and bob); athlete.js turns the breath into the chest and shoulders.
//
// stepIdle(st, { between, still, run, dt }) -> { shift (m, + to the body's right), bob (m, up),
//   roll (rad, the pelvis tilting toward the unloaded side), breath (-1..1), depth (0..1) }

// numbers (meters, seconds): how far the hips go over a leg, how often, the bounce
export const IDLE = {
  between: { shift: 0.028, roll: 0.05, every: [3.2, 6.5], ease: 0.9 },
  ready: { shift: 0.01, roll: 0.012, every: [1.2, 2.6], ease: 0.35, bob: 0.009, hz: 1.7 },
  // breaths a minute at rest and after hard running, and how long the heavy breathing lasts
  breath: { rest: 15, hard: 34, settle: 8 },
}

// a small deterministic random sequence (so a player's idle is the same in tests and replays)
const rand = (st) => {
  st.r = (st.r * 16807) % 2147483647
  return st.r / 2147483647
}

export const createIdle = (seed = 1) => {
  const r = Math.max(1, Math.floor(Math.abs(seed) * 2147483) % 2147483646)
  const st = { r, t: 0, side: 1, last: 1, next: 0, shift: 0, shiftV: 0, roll: 0, breathPh: 0, exert: 0, bobPh: 0 }
  st.next = 1 + rand(st) * 3
  st.breathPh = rand(st) * Math.PI * 2
  st.bobPh = rand(st) * Math.PI * 2
  return st
}

// a critically damped spring toward x over about `time` seconds
const spring = (st, key, target, time, dt) => {
  const w = 2 / Math.max(0.05, time)
  const v = key + "V"
  const x = st[key] - target
  const e = Math.exp(-w * dt)
  const nx = (x + (st[v] + w * x) * dt) * e
  st[v] = (st[v] - w * (st[v] + w * x) * dt) * e
  st[key] = target + nx
  return st[key]
}

// between: standing between points (relaxed) or ready in a rally; still: 0..1 how much the
// player is standing still; run: 0..1 how hard they're moving now (builds the breathing up)
export const stepIdle = (st, { between = true, still = 1, run = 0 }, dt) => {
  st.t += dt
  const P = between ? IDLE.between : IDLE.ready
  // effort builds while running and settles over several seconds
  st.exert += ((run > st.exert ? run : 0) - st.exert) * (1 - Math.exp(-dt / (run > st.exert ? 1.5 : IDLE.breath.settle)))
  // the weight shift: every few seconds over to the other leg (sometimes back to the middle)
  st.next -= dt
  if (st.next <= 0) {
    const u = rand(st)
    // (over to the other leg; now and then back to both feet first)
    if (st.side && u < 0.25) st.side = 0
    else {
      st.side = -(st.last || -1)
      st.last = st.side
    }
    st.next = P.every[0] + rand(st) * (P.every[1] - P.every[0])
  }
  const shift = spring(st, "shift", st.side * P.shift * still, P.ease, dt)
  const roll = (shift / Math.max(1e-6, P.shift)) * P.roll
  // breathing: faster and deeper after running
  const bpm = IDLE.breath.rest + (IDLE.breath.hard - IDLE.breath.rest) * st.exert
  st.breathPh += (bpm / 60) * 2 * Math.PI * dt
  const breath = Math.sin(st.breathPh)
  const depth = 0.45 + 0.55 * st.exert
  // the ready bounce: light and a little uneven (two rates mixed), only standing still
  let bob = 0
  if (!between) {
    st.bobPh += 2 * Math.PI * P.hz * dt * (0.9 + 0.2 * Math.sin(st.t * 0.7))
    bob = (0.5 - 0.5 * Math.cos(st.bobPh)) * P.bob * still
  } else bob = breath * 0.002 * depth * still
  return { shift, bob, roll, breath, depth }
}
