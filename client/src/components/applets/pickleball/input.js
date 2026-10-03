// Pickleball 98: controls. Key bindings for one player (solo) and for two people sharing a
// keyboard (p1 and p2), what the keys are called on screen, and the gamepad mapping (the
// standard layout: A topspin, X slice, B soft, Y lob, RB/RT power). Pure; the engine feeds it
// key codes and Gamepad objects.

export const ACTIONS = ["up", "down", "left", "right", "topspin", "slice", "soft", "lob", "power", "auto"]
export const SHOTS = ["topspin", "slice", "soft", "lob", "auto"]
export const ACTION_LABEL = {
  up: "Move up",
  down: "Move down",
  left: "Move left",
  right: "Move right",
  topspin: "Topspin drive",
  slice: "Slice",
  soft: "Dink / drop",
  lob: "Lob",
  power: "Power shot (hold)",
  auto: "Smart shot",
}

export const DEFAULT_KEYS = {
  solo: { up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"], left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], topspin: ["KeyJ"], slice: ["KeyK"], soft: ["KeyL"], lob: ["KeyI"], power: ["ShiftLeft", "ShiftRight", "KeyU"], auto: ["Space"] },
  p1: { up: ["KeyW"], down: ["KeyS"], left: ["KeyA"], right: ["KeyD"], topspin: ["KeyF"], slice: ["KeyG"], soft: ["KeyV"], lob: ["KeyR"], power: ["ShiftLeft"], auto: ["KeyC"] },
  p2: { up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"], topspin: ["KeyK", "Numpad1"], slice: ["KeyL", "Numpad2"], soft: ["Semicolon", "Numpad3"], lob: ["KeyO", "Numpad5"], power: ["ShiftRight", "Numpad0"], auto: ["Slash", "NumpadEnter"] },
}

// the bindings in use: defaults with the player's changes on top
export const bindingsFor = (custom = {}) => {
  const out = {}
  for (const set of Object.keys(DEFAULT_KEYS)) {
    out[set] = { ...DEFAULT_KEYS[set] }
    for (const [action, codes] of Object.entries(custom[set] || {})) if (Array.isArray(codes) && ACTIONS.includes(action)) out[set][action] = codes.filter((c) => typeof c === "string").slice(0, 3)
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
export const PAD = { topspin: 0, soft: 1, slice: 2, lob: 3, power: [4, 5, 6, 7], pause: 9 }
const DEAD = 0.22

// A gamepad's state in game terms: { x, z, buttons: { topspin, slice, soft, lob, power, pause } }
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
  return {
    x,
    z,
    buttons: { topspin: b(PAD.topspin), slice: b(PAD.slice), soft: b(PAD.soft), lob: b(PAD.lob), power: PAD.power.some(b), pause: b(PAD.pause) },
  }
}

// Edges between two readings: which shot buttons went down and up
export const padEdges = (prev, now) => {
  const down = []
  const up = []
  for (const k of ["topspin", "slice", "soft", "lob", "pause"]) {
    const was = !!prev?.buttons[k]
    const is = !!now?.buttons[k]
    if (is && !was) down.push(k)
    if (!is && was) up.push(k)
  }
  return { down, up }
}
