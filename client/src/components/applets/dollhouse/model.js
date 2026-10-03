// Dream House's rules: the rooms, where things may go (snapping to floors, walls, ceilings
// and tabletops), stacking order, saving in a compact form, and merging edits made by two
// people at once. Plain ES module with no browser code: the server (server/dollhouse)
// loads this very file to check and merge shared houses.
//
// A house: { rooms: { [roomId]: { wall, floor, ver, by } }, items: { [id]: item } }
// An item: { id, k (catalog id), x, y (its bottom middle), f (1 = flipped), z (stacking),
//            ver, by, name?, look? (people) }; a deleted one is { id, del: 1, ver, by }.
// Every change bumps the thing's ver. When two edits meet, the higher ver wins, and on a
// tie the higher "by" (each device's random tag), so everyone ends up with the same house.

import { ITEM, itemDef, SKINS, HAIR_COLORS, HAIR_STYLES, OUTFITS, CLOTHES, ACCESSORIES, DEFAULT_LOOKS } from "./catalogData.js"

export const FORMAT = 2
export const WORLD = { w: 1200, h: 820, ground: 740 }
export const MAX_ITEMS = 300
export const MAX_TOMBS = 400
export const MAX_NAME = 16

export const ROOMS = [
  { id: "attic", name: "Attic", x: 240, y: 140, w: 420, h: 120, floorD: 24 },
  { id: "bedroom", name: "Bedroom", x: 60, y: 272, w: 410, h: 218, floorD: 34 },
  { id: "bathroom", name: "Bathroom", x: 480, y: 272, w: 360, h: 218, floorD: 34 },
  { id: "living", name: "Living Room", x: 60, y: 502, w: 460, h: 218, floorD: 34 },
  { id: "kitchen", name: "Kitchen", x: 530, y: 502, w: 310, h: 218, floorD: 34 },
  { id: "garden", name: "Garden", x: 870, y: 420, w: 310, h: 320, floorD: 54, outdoor: true },
]
export const ROOM = Object.fromEntries(ROOMS.map((r) => [r.id, r]))

export const WALLS = [
  ["cream", "Buttercream"], ["hearts", "Little Hearts"], ["stripes", "Candy Stripes"], ["dots", "Polka Dots"],
  ["clouds", "Clouds"], ["floral", "Rosebuds"], ["gingham", "Gingham"], ["stars", "Starry"],
  ["wood", "Wood Panels"], ["scallop", "Scallops"], ["tiles", "Bath Tiles"], ["brick", "Brick"],
  ["daisy", "Daisies"], ["sky", "Open Sky"], ["fence", "Garden Fence"], ["hedge", "Hedge"], ["roses", "Rose Trellis"],
]
export const FLOORS = [
  ["oak", "Light Oak"], ["walnut", "Walnut"], ["parquet", "Parquet"], ["checker", "Pink Checks"],
  ["mono", "Diner Checks"], ["mint", "Mint Tiles"], ["lilac", "Lilac Carpet"], ["blue", "Blue Carpet"],
  ["stone", "Stone"], ["grass", "Grass"], ["meadow", "Meadow"], ["path", "Stepping Stones"], ["sand", "Sand"],
]
const WALL_IDS = new Set(WALLS.map((w) => w[0]))
const FLOOR_IDS = new Set(FLOORS.map((f) => f[0]))

export const DEFAULT_ROOMS = {
  attic: { wall: "stars", floor: "walnut" },
  bedroom: { wall: "hearts", floor: "lilac" },
  bathroom: { wall: "tiles", floor: "mint" },
  living: { wall: "floral", floor: "oak" },
  kitchen: { wall: "gingham", floor: "checker" },
  garden: { wall: "sky", floor: "grass" },
}

// ---------- small helpers ----------

const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const isInt = (n) => Number.isInteger(n)
const ID = /^[a-z0-9]{1,16}$/
const BY = /^[a-z0-9]{1,12}$/

export const newId = () => Math.random().toString(36).slice(2, 10) || "i0"
export const newTag = () => Math.random().toString(36).slice(2, 8) || "t0"

export const cleanName = (text) =>
  String(text ?? "")
    .replace(/[\u0000-\u001F\u007F‪-‮⁦-⁩]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME)

export const floorTop = (room) => room.y + room.h - room.floorD
export const bottomOf = (room) => room.y + room.h

// the room a point is in (null if none)
export const roomAt = (x, y) => ROOMS.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || null

// the room nearest a point
export const nearestRoom = (x, y) => {
  let best = ROOMS[0]
  let bestD = Infinity
  for (const r of ROOMS) {
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w))
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h))
    const d = dx * dx + dy * dy
    if (d < bestD) {
      bestD = d
      best = r
    }
  }
  return best
}

// which room an item belongs to: the one under its middle
export const roomOf = (item) => {
  const def = itemDef(item.k)
  const cy = item.y - (def ? def.h / 2 : 0)
  return roomAt(item.x, cy) || nearestRoom(item.x, cy)
}

export const live = (house) => Object.values(house.items).filter((i) => !i.del)
export const sorted = (house) => live(house).sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1))
export const boxOf = (item) => {
  const def = itemDef(item.k)
  return { x: item.x - def.w / 2, y: item.y - def.h, w: def.w, h: def.h }
}

// ---------- the look of a person ----------

export const cleanLook = (look, fallback = DEFAULT_LOOKS[0]) => {
  const l = look && typeof look === "object" ? look : {}
  const index = (v, list, d) => (isInt(v) && v >= 0 && v < list.length ? v : d)
  const pick = (v, list, d) => (list.includes(v) ? v : d)
  return {
    skin: index(l.skin, SKINS, fallback.skin),
    hair: index(l.hair, HAIR_COLORS, fallback.hair),
    hairStyle: pick(l.hairStyle, HAIR_STYLES, fallback.hairStyle),
    top: index(l.top, CLOTHES, fallback.top),
    bottom: index(l.bottom, CLOTHES, fallback.bottom),
    outfit: pick(l.outfit, OUTFITS, fallback.outfit),
    acc: pick(l.acc, ACCESSORIES, fallback.acc),
  }
}

// ---------- snapping ----------

// Things with a tabletop or shelf in a room: [{ item, y (the surface), x0, x1 }]
const surfacesIn = (house, room, skipId) =>
  live(house)
    .filter((i) => i.id !== skipId && itemDef(i.k)?.top && roomOf(i) === room)
    .map((i) => {
      const def = itemDef(i.k)
      return { item: i, y: i.y - def.top, x0: i.x - def.w / 2 + 3, x1: i.x + def.w / 2 - 3 }
    })

// Where a thing dropped with its bottom middle at (x, y) ends up: in a room, on the floor,
// on a wall, hanging from the ceiling, or (small things) on the nearest tabletop below.
export const snap = (house, kind, x, y, skipId = null) => {
  const def = itemDef(kind)
  if (!def) return { x, y, room: nearestRoom(x, y).id }
  const room = roomAt(x, y - def.h / 2) || nearestRoom(x, y - def.h / 2)
  const half = def.w / 2
  const left = room.x + half + 2
  const right = room.x + room.w - half - 2
  const sx = left > right ? room.x + room.w / 2 : clamp(x, left, right)
  const bottom = bottomOf(room)
  const top = floorTop(room)
  const onFloor = () => clamp(y, top + Math.min(8, room.floorD * 0.3), bottom - 6)
  let sy
  if (def.mount === "ceiling") sy = room.y + def.h
  else if (def.mount === "wall") sy = clamp(y, Math.min(room.y + def.h + 4, top + 4), top + 4)
  else if (def.mount === "floor") sy = onFloor()
  else {
    // free: rests on the first surface below where it was let go, else the floor
    let best = null
    for (const s of surfacesIn(house, room, skipId)) {
      if (sx < s.x0 || sx > s.x1 || s.y < y - 18) continue
      if (s.y - def.h < room.y - 4) continue
      if (!best || s.y < best.y) best = s
    }
    sy = best && best.y < top ? best.y : onFloor()
  }
  return { x: Math.round(sx), y: Math.round(sy), room: room.id }
}

// ---------- making and changing a house ----------

export const emptyHouse = () => ({
  rooms: Object.fromEntries(ROOMS.map((r) => [r.id, { ...DEFAULT_ROOMS[r.id], ver: 0, by: "" }])),
  items: {},
})

const zRange = (house) => {
  const items = live(house)
  if (!items.length) return [0, 0]
  let lo = Infinity
  let hi = -Infinity
  for (const i of items) {
    lo = Math.min(lo, i.z)
    hi = Math.max(hi, i.z)
  }
  return [lo, hi]
}

// Each change returns the ops that describe it (to save, and to send to a partner)
const itemOp = (item) => (item.del ? { t: "d", e: [item.id, item.ver, item.by] } : { t: "i", e: packItem(item) })
const roomOp = (id, r) => ({ t: "r", id, e: [r.wall, r.floor, r.ver, r.by] })

export const liveCount = (house) => live(house).length

// -> { item, ops } or null (the house is full / not a catalog thing)
export const addItem = (house, kind, x, y, by, extra = {}) => {
  const def = itemDef(kind)
  if (!def || liveCount(house) >= MAX_ITEMS) return null
  const [lo, hi] = zRange(house)
  let id = newId()
  while (house.items[id]) id = newId()
  const pos = snap(house, kind, x, y)
  const prev = house.items[id]
  const item = { id, k: kind, x: pos.x, y: pos.y, f: extra.f ? 1 : 0, z: def.low ? lo - 1 : hi + 1, ver: (prev?.ver || 0) + 1, by }
  if (kind === "avatar") {
    item.name = cleanName(extra.name)
    item.look = cleanLook(extra.look, DEFAULT_LOOKS[live(house).filter((i) => i.k === "avatar").length % 2])
  }
  house.items[id] = item
  return { item, ops: [itemOp(item)] }
}

// edits never change an item in place (undo keeps the old copies)
const change = (house, id, by, fn) => {
  const current = house.items[id]
  if (!current || current.del) return null
  const item = { ...current }
  fn(item)
  item.ver = current.ver + 1
  item.by = by
  house.items[id] = item
  return { item, ops: [itemOp(item)] }
}

export const moveItem = (house, id, x, y, by) =>
  change(house, id, by, (item) => {
    const pos = snap(house, item.k, x, y, id)
    item.x = pos.x
    item.y = pos.y
  })

export const flipItem = (house, id, by) => change(house, id, by, (item) => (item.f = item.f ? 0 : 1))

export const setPerson = (house, id, { name, look }, by) =>
  change(house, id, by, (item) => {
    if (name !== undefined) item.name = cleanName(name)
    if (look !== undefined) item.look = cleanLook(look, item.look || DEFAULT_LOOKS[0])
  })

export const removeItem = (house, id, by) => {
  const item = house.items[id]
  if (!item || item.del) return null
  const dead = { id, del: 1, ver: item.ver + 1, by }
  house.items[id] = dead
  pruneTombs(house)
  return { item: dead, ops: [itemOp(dead)] }
}

export const duplicateItem = (house, id, by) => {
  const item = house.items[id]
  if (!item || item.del) return null
  return addItem(house, item.k, item.x + 18, item.y, by, { f: item.f, name: item.name, look: item.look })
}

// Stacking: "forward" / "backward" swap with the next thing up or down that it overlaps
// (or the next in line), "front" / "back" go all the way. -> { ops } (null if no change)
export const restack = (house, id, how, by) => {
  const item = house.items[id]
  if (!item || item.del) return null
  const list = sorted(house)
  const at = list.findIndex((i) => i.id === id)
  const touched = []
  const bump = (i, z) => {
    const next = { ...i, z, ver: i.ver + 1, by }
    house.items[i.id] = next
    touched.push(next)
  }
  if (how === "front") {
    if (at === list.length - 1) return null
    bump(item, list[list.length - 1].z + 1)
  } else if (how === "back") {
    if (at === 0) return null
    bump(item, list[0].z - 1)
  } else {
    const step = how === "forward" ? 1 : -1
    const a = boxOf(item)
    const overlaps = (o) => {
      const b = boxOf(o)
      return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
    }
    let j = at + step
    while (j >= 0 && j < list.length && !overlaps(list[j])) j += step
    if (j < 0 || j >= list.length) j = at + step
    if (j < 0 || j >= list.length) return null
    const other = list[j]
    const z = item.z
    // with equal z the swap alone wouldn't change the order: push past it
    if (other.z === z) bump(item, z + step)
    else {
      bump(item, other.z)
      bump(other, z)
    }
  }
  return { ops: touched.map(itemOp) }
}

export const setRoom = (house, roomId, patch, by) => {
  const current = house.rooms[roomId]
  if (!current) return null
  const r = { ...current, ver: current.ver + 1, by }
  if (patch.wall && WALL_IDS.has(patch.wall)) r.wall = patch.wall
  if (patch.floor && FLOOR_IDS.has(patch.floor)) r.floor = patch.floor
  house.rooms[roomId] = r
  return { ops: [roomOp(roomId, r)] }
}

// Undo: puts an item back as it was (prior null: it didn't exist, so it goes) as a new edit
export const restoreItem = (house, id, prior, by) => {
  const current = house.items[id]
  const ver = (current?.ver || 0) + 1
  if (!prior || prior.del) {
    if (!current || current.del) return null
    const dead = { id, del: 1, ver, by }
    house.items[id] = dead
    return { ops: [itemOp(dead)] }
  }
  if ((!current || current.del) && liveCount(house) >= MAX_ITEMS) return null
  const item = { ...prior, ver, by }
  house.items[id] = item
  return { ops: [itemOp(item)] }
}

export const restoreRoom = (house, id, prior, by) => {
  const current = house.rooms[id]
  if (!current || !prior) return null
  const r = { wall: prior.wall, floor: prior.floor, ver: current.ver + 1, by }
  house.rooms[id] = r
  return { ops: [roomOp(id, r)] }
}

const pruneTombs = (house) => {
  const tombs = Object.values(house.items).filter((i) => i.del)
  if (tombs.length <= MAX_TOMBS) return
  tombs.sort((a, b) => a.ver - b.ver)
  for (const t of tombs.slice(0, tombs.length - MAX_TOMBS)) delete house.items[t.id]
}

// ---------- compact form ----------
//   { v: 2, r: { roomId: [wall, floor, ver, by] }, i: [[id, k, x, y, f, z, ver, by, extra?]],
//     d: [[id, ver, by]] }   extra (people): { n: name, l: look }

export const packItem = (i) => {
  const row = [i.id, i.k, Math.round(i.x), Math.round(i.y), i.f ? 1 : 0, i.z, i.ver, i.by || ""]
  if (i.k === "avatar") row.push({ n: i.name || "", l: i.look })
  return row
}

export const serialize = (house) => ({
  v: FORMAT,
  r: Object.fromEntries(Object.entries(house.rooms).map(([id, r]) => [id, [r.wall, r.floor, r.ver, r.by || ""]])),
  i: sorted(house).map(packItem),
  d: Object.values(house.items).filter((i) => i.del).map((i) => [i.id, i.ver, i.by || ""]),
})

// a checked item from its compact row (null if it isn't valid)
export const unpackItem = (row) => {
  if (!Array.isArray(row) || row.length < 8) return null
  const [id, k, x, y, f, z, ver, by, extra] = row
  if (typeof id !== "string" || !ID.test(id) || !ITEM[k]) return null
  if (![x, y].every((n) => typeof n === "number" && Number.isFinite(n))) return null
  if (!isInt(z) || Math.abs(z) > 1e6 || !isInt(ver) || ver < 0 || ver > 1e9) return null
  if (typeof by !== "string" || (by && !BY.test(by))) return null
  const item = { id, k, x: Math.round(clamp(x, 0, WORLD.w)), y: Math.round(clamp(y, 0, WORLD.h)), f: f ? 1 : 0, z, ver, by }
  if (k === "avatar") {
    item.name = cleanName(extra?.n)
    item.look = cleanLook(extra?.l)
  }
  return item
}

export const unpackTomb = (row) => {
  if (!Array.isArray(row)) return null
  const [id, ver, by] = row
  if (typeof id !== "string" || !ID.test(id) || !isInt(ver) || ver < 0 || ver > 1e9) return null
  if (typeof by !== "string" || (by && !BY.test(by))) return null
  return { id, del: 1, ver, by }
}

const unpackRoom = (row) => {
  if (!Array.isArray(row)) return null
  const [wall, floor, ver, by] = row
  if (!WALL_IDS.has(wall) || !FLOOR_IDS.has(floor) || !isInt(ver) || ver < 0 || ver > 1e9) return null
  if (typeof by !== "string" || (by && !BY.test(by))) return null
  return { wall, floor, ver, by }
}

// Older saves: { version: 1, rooms: { id: { wallpaper, floor } }, items: [{ kind, x, y, flip, name, look }] }
export const migrate = (data) => {
  if (!data || typeof data !== "object") return null
  if (data.v === FORMAT) return data
  if (data.version === 1 && Array.isArray(data.items)) {
    const r = {}
    for (const [id, room] of Object.entries(data.rooms || {})) r[id] = [room?.wallpaper, room?.floor, 1, ""]
    const i = data.items.map((it, n) => {
      const row = [`m${n}`, it?.kind, it?.x, it?.y, it?.flip ? 1 : 0, n, 1, ""]
      if (it?.kind === "avatar") row.push({ n: it.name, l: it.look })
      return row
    })
    return { v: FORMAT, r, i, d: [] }
  }
  return null
}

// -> a house (bad bits dropped, missing rooms back to their defaults), or null if it isn't one
export const deserialize = (input) => {
  let data = input
  if (typeof data === "string") {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  data = migrate(data)
  if (!data) return null
  const house = emptyHouse()
  for (const [id, row] of Object.entries(data.r || {})) {
    const room = ROOM[id] && unpackRoom(row)
    if (room) house.rooms[id] = room
  }
  let count = 0
  for (const row of Array.isArray(data.i) ? data.i : []) {
    const item = unpackItem(row)
    if (!item || count >= MAX_ITEMS) continue
    house.items[item.id] = item
    count++
  }
  for (const row of Array.isArray(data.d) ? data.d.slice(0, MAX_TOMBS) : []) {
    const t = unpackTomb(row)
    if (t && !(house.items[t.id] && house.items[t.id].ver >= t.ver)) house.items[t.id] = t
  }
  return house
}

// ---------- merging (shared houses) ----------

export const wins = (incoming, current) => !current || incoming.ver > current.ver || (incoming.ver === current.ver && String(incoming.by || "") > String(current.by || ""))

// A checked op ({ t: "i" | "d" | "r", ... }) or null
export const cleanOp = (op) => {
  if (!op || typeof op !== "object") return null
  if (op.t === "i") {
    const item = unpackItem(op.e)
    return item && { t: "i", e: packItem(item) }
  }
  if (op.t === "d") {
    const t = unpackTomb(op.e)
    return t && { t: "d", e: [t.id, t.ver, t.by] }
  }
  if (op.t === "r") {
    const r = ROOM[op.id] && unpackRoom(op.e)
    return r && { t: "r", id: op.id, e: [r.wall, r.floor, r.ver, r.by] }
  }
  return null
}

// Applies one op if it's newer than what the house has. -> true if it changed the house
export const applyOp = (house, op) => {
  const clean = cleanOp(op)
  if (!clean) return false
  if (clean.t === "r") {
    const r = unpackRoom(clean.e)
    if (!wins(r, house.rooms[clean.id])) return false
    house.rooms[clean.id] = r
    return true
  }
  const entity = clean.t === "i" ? unpackItem(clean.e) : unpackTomb(clean.e)
  const current = house.items[entity.id]
  if (!wins(entity, current)) return false
  if (!entity.del && (!current || current.del) && liveCount(house) >= MAX_ITEMS) return false
  house.items[entity.id] = entity
  if (entity.del) pruneTombs(house)
  return true
}

// the entity an op is about, as the house has it now (to answer a refused op with)
export const currentOpFor = (house, op) => {
  if (op.t === "r") return house.rooms[op.id] ? roomOp(op.id, house.rooms[op.id]) : null
  const id = op.e?.[0]
  const item = house.items[id]
  return item ? itemOp(item) : null
}

// Everything in b that's newer than in a, applied to a copy of a
export const merge = (a, b) => {
  const out = deserialize(serialize(a))
  for (const op of opsOf(b)) applyOp(out, op)
  return out
}

// the whole house as ops
export const opsOf = (house) => [
  ...Object.entries(house.rooms).map(([id, r]) => roomOp(id, r)),
  ...Object.values(house.items).map(itemOp),
]

// ---------- the starter house ----------

const STARTER = [
  // attic
  ["star_mobile", 330, 200], ["telescope", 600, 258], ["beanbag", 300, 258], ["books", 420, 258], ["fairy_lights", 450, 196], ["window_round", 520, 205],
  // bedroom
  ["rug_round", 205, 486], ["bed", 200, 480], ["nightstand", 320, 480], ["table_lamp", 320, 300], ["window_round", 140, 380], ["poster_heart", 410, 390], ["garland", 230, 330], ["cat", 380, 486],
  // bathroom
  ["bathtub", 600, 484], ["bath_sink", 770, 484], ["mirror", 770, 380], ["duck", 640, 300], ["hanging_plant", 520, 380], ["towels", 690, 380], ["bath_mat", 690, 488],
  // living room
  ["rug_heart", 240, 716], ["sofa", 220, 700], ["floor_lamp", 100, 700], ["side_table", 340, 700], ["tv", 340, 600], ["painting", 210, 600], ["monstera", 470, 700], ["fairy_lights", 300, 545], ["dog", 420, 716],
  // kitchen
  ["fridge", 568, 712], ["counter_sink", 652, 712], ["stove", 737, 712], ["kettle", 737, 560], ["fruit_bowl", 652, 560], ["wall_cabinet", 660, 600], ["pendant", 800, 610], ["cake", 800, 716],
  // garden
  ["tree", 950, 736], ["flower_bed", 1100, 736], ["mailbox", 1155, 736], ["lamp_post", 890, 736], ["bunny", 1050, 736], ["bush", 1010, 736],
]

export const starterHouse = (by = "start") => {
  const house = emptyHouse()
  for (const [kind, x, y] of STARTER) addItem(house, kind, x, y, by)
  addItem(house, "avatar", 172, 716, by, { look: DEFAULT_LOOKS[0] })
  addItem(house, "avatar", 262, 716, by, { look: DEFAULT_LOOKS[1], f: 1 })
  return house
}

// ---------- pets wander ----------

// how far a pet has wandered from where it was put (in house units) at time t seconds,
// and which way it faces. Same numbers for drawing and for picking it up.
export const petOffset = (item, t) => {
  const def = itemDef(item.k)
  if (!def?.pet) return { dx: 0, dy: 0, dir: 0, moving: false }
  const room = roomOf(item)
  const seed = [...item.id].reduce((s, ch) => s + ch.charCodeAt(0), 0)
  const range = Math.max(0, Math.min(90, room.w / 2 - def.w))
  const lo = Math.max(room.x + def.w / 2 + 2 - item.x, -range)
  const hi = Math.min(room.x + room.w - def.w / 2 - 2 - item.x, range)
  // walk for a while, then sit for a while
  const period = 14 + (seed % 7)
  const phase = (t + seed) % period
  const cycle = Math.floor((t + seed) / period)
  const walking = phase < period * 0.45
  const target = (k) => {
    const r = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453
    return lo + (r - Math.floor(r)) * (hi - lo)
  }
  const from = target(cycle)
  const to = target(cycle + 1)
  const p = walking ? (1 - Math.cos((phase / (period * 0.45)) * Math.PI)) / 2 : 1
  const dx = hi > lo ? from + (to - from) * p : 0
  const hop = def.pet === "hop" && walking ? -Math.abs(Math.sin(phase * 6)) * 8 : 0
  return { dx, dy: hop, dir: to >= from ? 1 : -1, moving: walking && Math.abs(to - from) > 2 }
}
