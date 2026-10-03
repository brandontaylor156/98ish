// Pickleball 98: controls. One hit control (hold it for pace, let go to swing) plus moving
// and aiming. Key bindings for one player (solo, who aims with the mouse) and for two people
// sharing a keyboard (p1 and p2, who aim with their movement keys while holding hit), what
// the keys are called on screen, and the gamepad mapping (left stick moves, right stick aims,
// any face button or a trigger hits). Pure; the engine feeds it key codes and Gamepad objects.

export const ACTIONS = ["up", "down", "left", "right", "hit"]
export const ACTION_LABEL = {
  up: "Move up",
  down: "Move down",
  left: "Move left",
  right: "Move right",
  hit: "Hit (tap: soft, hold: hard)",
}

export const DEFAULT_KEYS = {
  solo: { up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], hit: ["Space", "KeyJ", "KeyK"] },
  p1: { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"], hit: ["KeyF", "KeyC"] },
  p2: { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"], hit: ["KeyL", "Slash", "Numpad0"] },
}

// the bindings in use: defaults with the player's changes on top
export const bindingsFor = (custom = {}) => {
  const out = {}
  for (const set of Object.keys(DEFAULT_KEYS)) {
    out[set] = { ...DEFAULT_KEYS[set] }
    for (const [action, codes] of Object.entries(custom?.[set] || {})) if (Array.isArray(codes) && ACTIONS.includes(action)) out[set][action] = codes.filter((c) => typeof c === "string").slice(0, 3)
  }
  return out
}

// Rebind one action: the new key replaces the action's first key and is taken off any other
// action in the same set (so one key never does two things)
export const rebind = (custom, set, action, code) => {
  const all = bindingsFor(custom)
  const next = { ...custom, [set]: { ...(custom[set] || {}) } }
  for (const a of ACTIONS) {
    const codes = all[set][a].filter((c) => c !== code)
    if (codes.length !== all[set][a].length) next[set][a] = codes.length ? codes : []
  }
  const mine = all[set][action].filter((c) => c !== code)
  next[set][action] = [code, ...mine.slice(0, 1)]
  return next
}

// which slot and action a key code means: sets is [[setName, slot], ...]
export const actionFor = (bindings, sets, code) => {
  for (const [set, slot] of sets) {
    const map = bindings[set]
    for (const a of ACTIONS) if (map[a]?.includes(code)) return { action: a, slot }
  }
  return null
}

const NAMES = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", ShiftLeft: "Shift", ShiftRight: "R-Shift", Space: "Space", Semicolon: ";", Comma: ",", Period: ".", Slash: "/", Quote: "'", BracketLeft: "[", BracketRight: "]", Enter: "Enter", NumpadEnter: "Num Enter", ControlLeft: "Ctrl", ControlRight: "R-Ctrl", AltLeft: "Alt", Tab: "Tab", Backquote: "`", Minus: "-", Equal: "=" }
export const keyName = (code) => {
  if (!code) return "-"
  if (NAMES[code]) return NAMES[code]
  if (code.startsWith("Key")) return code.slice(3)
  if (code.startsWith("Digit")) return code.slice(5)
  if (code.startsWith("Numpad")) return `Num ${code.slice(6)}`
  return code
}
export const keysLabel = (bindings, set, action) => (bindings[set][action] || []).map(keyName).join(" / ")

// ---- gamepads ----
export const PAD = { hit: [0, 1, 2, 3, 5, 7], pause: 9 }
const DEAD = 0.22

// A gamepad's state in game terms: { x, z (left stick: move), ax, az (right stick: aim),
// buttons: { hit, pause } }
export const readPad = (pad) => {
  if (!pad) return null
  const b = (i) => !!pad.buttons[i]?.pressed || (pad.buttons[i]?.value || 0) > 0.5
  let x = pad.axes[0] || 0
  let z = pad.axes[1] || 0
  if (Math.hypot(x, z) < DEAD) {
    x = 0
    z = 0
  }
  if (b(14)) x = -1
  if (b(15)) x = 1
  if (b(12)) z = -1
  if (b(13)) z = 1
  let ax = pad.axes[2] || 0
  let az = pad.axes[3] || 0
  if (Math.hypot(ax, az) < DEAD + 0.08) {
    ax = 0
    az = 0
  }
  return { x, z, ax, az, buttons: { hit: PAD.hit.some(b), pause: b(PAD.pause) } }
}

// Edges between two readings: which buttons went down and up
export const padEdges = (prev, now) => {
  const down = []
  const up = []
  for (const k of ["hit", "pause"]) {
    const was = !!prev?.buttons[k]
    const is = !!now?.buttons[k]
    if (is && !was) down.push(k)
    if (!is && was) up.push(k)
  }
  return { down, up }
}

// The right stick as an aim on the other court: x across (screen right = +), up the stick =
// deeper. Returns { u, v } in -1..1 (the engine turns it into a court point), or null when
// the stick is centered (aim where a sensible player would)
export const stickAim = (pad) => (pad && (pad.ax || pad.az) ? { u: Math.max(-1, Math.min(1, pad.ax)), v: Math.max(-1, Math.min(1, -pad.az)) } : null)
