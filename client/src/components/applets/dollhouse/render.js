// Draws the whole Dream House scene in house units (the caller sets the zoom): sky, the
// house in cross-section, each room's wallpaper and floor, everything in it in stacking
// order, people's name tags, and at night the dark with lamps glowing.

import { itemDef } from "./catalogData.js"
import { ROOMS, ROOM, WORLD, floorTop, petOffset, roomOf, sorted } from "./model.js"
import { OL, drawItem, fillFloor, fillWall, heart, rrPath } from "./art.js"

const TAU = Math.PI * 2
const HOUSE = { x: 44, y: 262, w: 812, h: 470 }
const ROOF = { left: 20, right: 880, base: 268, apex: 18, cx: 450 }

// where an item is drawn right now (pets wander)
export const placeOf = (item, t) => {
  const off = petOffset(item, t)
  return { x: item.x + off.dx, y: item.y + off.dy, dir: off.dir, moving: off.moving }
}

// the topmost item under a point (house units), or null
export const itemAt = (house, x, y, t, pad = 2) => {
  const list = sorted(house)
  for (let i = list.length - 1; i >= 0; i--) {
    const item = list[i]
    const def = itemDef(item.k)
    const p = placeOf(item, t)
    // rugs are thin: a little extra room to grab them
    const extra = def.low ? 6 : pad
    if (x >= p.x - def.w / 2 - extra && x <= p.x + def.w / 2 + extra && y >= p.y - def.h - extra && y <= p.y + extra) return item
  }
  return null
}

const clipRoom = (c, room) => {
  c.beginPath()
  if (room.outdoor) c.rect(room.x - 30, -3000, room.w + 3000, room.y + room.h + 3004)
  else c.rect(room.x, room.y, room.w, room.h)
  c.clip()
}

const drawSky = (c, night, t) => {
  const g = c.createLinearGradient(0, 0, 0, WORLD.ground)
  if (night) {
    g.addColorStop(0, "#1b1a46")
    g.addColorStop(0.6, "#3d3474")
    g.addColorStop(1, "#6b4f8c")
  } else {
    g.addColorStop(0, "#9fd8ff")
    g.addColorStop(0.65, "#d8f0ff")
    g.addColorStop(1, "#ffe9f2")
  }
  c.fillStyle = g
  c.fillRect(-3000, -3000, WORLD.w + 6000, WORLD.ground + 3000)
  if (night) {
    for (let i = 0; i < 70; i++) {
      const x = (i * 173.7) % (WORLD.w + 200) - 100
      const y = (i * 97.3) % 420
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + (i % 5) * 0.4) + i)
      c.globalAlpha = 0.35 + tw * 0.65
      c.fillStyle = i % 7 ? "#fff6d8" : "#ffd1ec"
      c.beginPath()
      c.arc(x, y, i % 9 ? 1.4 : 2.4, 0, TAU)
      c.fill()
    }
    c.globalAlpha = 1
    // a smiling crescent moon
    c.save()
    c.translate(1040, 110)
    const glow = c.createRadialGradient(0, 0, 10, 0, 0, 110)
    glow.addColorStop(0, "rgba(255,244,190,0.45)")
    glow.addColorStop(1, "rgba(255,244,190,0)")
    c.fillStyle = glow
    c.fillRect(-110, -110, 220, 220)
    c.beginPath()
    c.arc(0, 0, 44, 0, TAU)
    c.arc(18, -12, 38, 0, TAU, true)
    c.fillStyle = "#fff2b0"
    c.fill("evenodd")
    c.fillStyle = "rgba(255,140,170,0.5)"
    c.beginPath()
    c.arc(-24, 16, 5, 0, TAU)
    c.fill()
    c.restore()
  } else {
    // sun
    c.save()
    c.translate(1060, 100)
    const glow = c.createRadialGradient(0, 0, 20, 0, 0, 130)
    glow.addColorStop(0, "rgba(255,240,170,0.8)")
    glow.addColorStop(1, "rgba(255,240,170,0)")
    c.fillStyle = glow
    c.fillRect(-130, -130, 260, 260)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + t * 0.1
      c.beginPath()
      c.moveTo(Math.cos(a) * 52, Math.sin(a) * 52)
      c.lineTo(Math.cos(a) * 66, Math.sin(a) * 66)
      c.strokeStyle = "rgba(255,200,90,0.8)"
      c.lineWidth = 5
      c.lineCap = "round"
      c.stroke()
    }
    c.beginPath()
    c.arc(0, 0, 42, 0, TAU)
    c.fillStyle = "#ffe17a"
    c.fill()
    c.lineWidth = 2
    c.strokeStyle = "#f2b84b"
    c.stroke()
    c.restore()
    // drifting clouds
    for (let i = 0; i < 5; i++) {
      const span = WORLD.w + 400
      const x = ((i * 290 + t * (6 + i * 2)) % span) - 200
      const y = 60 + ((i * 71) % 260)
      cloud(c, x, y, 0.8 + (i % 3) * 0.25)
    }
  }
  // soft hills far away
  c.fillStyle = night ? "#4c5a86" : "#bfe8c4"
  c.beginPath()
  c.moveTo(-400, WORLD.ground)
  c.quadraticCurveTo(150, WORLD.ground - 170, 600, WORLD.ground - 40)
  c.quadraticCurveTo(900, WORLD.ground - 160, WORLD.w + 400, WORLD.ground - 60)
  c.lineTo(WORLD.w + 400, WORLD.ground)
  c.closePath()
  c.fill()
}

const cloud = (c, x, y, s) => {
  c.save()
  c.translate(x, y)
  c.scale(s, s)
  c.fillStyle = "rgba(255,255,255,0.92)"
  c.beginPath()
  c.ellipse(0, 0, 40, 16, 0, 0, TAU)
  c.ellipse(-22, 2, 22, 12, 0, 0, TAU)
  c.ellipse(16, -10, 22, 18, 0, 0, TAU)
  c.ellipse(-6, -14, 18, 14, 0, 0, TAU)
  c.fill()
  c.restore()
}

const drawGround = (c, night) => {
  c.fillStyle = night ? "#3f6a55" : "#8fd18b"
  c.fillRect(-3000, WORLD.ground, WORLD.w + 6000, WORLD.h - WORLD.ground + 3000)
  c.fillStyle = night ? "#355c49" : "#7cc47f"
  c.fillRect(-3000, WORLD.ground, WORLD.w + 6000, 6)
  // a stepping-stone path from the door
  c.fillStyle = night ? "#8e8aa3" : "#efe9f5"
  for (let i = 0; i < 3; i++) {
    c.beginPath()
    c.ellipse(300 + i * 14, WORLD.ground + 20 + i * 24, 26 - i * 2, 7, 0, 0, TAU)
    c.fill()
  }
  // little flowers in the grass
  const cols = ["#ffb3cf", "#ffe17a", "#c9b3ff", "#ffffff"]
  for (let i = 0; i < 40; i++) {
    const x = (i * 131) % (WORLD.w + 100) - 50
    const y = WORLD.ground + 14 + ((i * 37) % 60)
    c.fillStyle = cols[i % 4]
    c.beginPath()
    c.arc(x, y, 2.4, 0, TAU)
    c.fill()
  }
}

const drawShell = (c, night) => {
  // chimney behind the roof
  c.fillStyle = "#e8a08a"
  rrPath(c, 690, 70, 44, 120, 3)
  c.fill()
  c.lineWidth = 3
  c.strokeStyle = OL
  c.stroke()
  rrPath(c, 684, 62, 56, 16, 4)
  c.fillStyle = "#f6e4da"
  c.fill()
  c.stroke()
  // the body of the house
  rrPath(c, HOUSE.x, HOUSE.y, HOUSE.w, HOUSE.h, 8)
  c.fillStyle = night ? "#e7c9cf" : "#ffe9e1"
  c.fill()
  c.lineWidth = 3
  c.stroke()
  // foundation
  rrPath(c, HOUSE.x - 6, HOUSE.y + HOUSE.h - 10, HOUSE.w + 12, 18, 5)
  c.fillStyle = "#d8cfe6"
  c.fill()
  c.stroke()
  // the roof with scalloped shingles
  const roof = () => {
    c.beginPath()
    c.moveTo(ROOF.left, ROOF.base)
    c.lineTo(ROOF.cx, ROOF.apex)
    c.lineTo(ROOF.right, ROOF.base)
    c.closePath()
  }
  roof()
  c.fillStyle = "#f59ab0"
  c.fill()
  c.save()
  roof()
  c.clip()
  c.fillStyle = "#e27d97"
  for (let row = 0, y = ROOF.apex + 10; y < ROOF.base + 10; y += 16, row++) {
    for (let x = ROOF.left - 20 + (row % 2) * 12; x < ROOF.right + 20; x += 24) {
      c.beginPath()
      c.arc(x, y, 12, 0, Math.PI)
      c.lineWidth = 1.5
      c.strokeStyle = "#d76a86"
      c.stroke()
    }
  }
  c.restore()
  roof()
  c.lineWidth = 6
  c.lineJoin = "round"
  c.strokeStyle = OL
  c.stroke()
  c.lineWidth = 3
  c.strokeStyle = "#ffd1dc"
  c.stroke()
  // a heart window in the gable, above the attic
  heart(c, ROOF.cx, 96, 30, night ? "#ffe9a8" : "#bfe7ff", 2.5)
  // door sign between the floors
  c.fillStyle = OL
}

const drawRoomBack = (c, room, style, night) => {
  const top = floorTop(room)
  c.save()
  clipRoom(c, room)
  fillWall(c, style.wall, room.x, room.y, room.w, top - room.y, { outdoor: room.outdoor, night })
  if (!room.outdoor) {
    fillFloor(c, style.floor, room.x, top, room.w, room.y + room.h - top)
    // a little depth: shade under the ceiling, along the walls and the back of the floor
    let g = c.createLinearGradient(0, room.y, 0, room.y + 22)
    g.addColorStop(0, "rgba(91,66,86,0.25)")
    g.addColorStop(1, "rgba(91,66,86,0)")
    c.fillStyle = g
    c.fillRect(room.x, room.y, room.w, 22)
    for (const [x0, x1] of [[room.x, room.x + 16], [room.x + room.w, room.x + room.w - 16]]) {
      g = c.createLinearGradient(x0, 0, x1, 0)
      g.addColorStop(0, "rgba(91,66,86,0.16)")
      g.addColorStop(1, "rgba(91,66,86,0)")
      c.fillStyle = g
      c.fillRect(Math.min(x0, x1), room.y, 16, room.h)
    }
    c.fillStyle = "rgba(91,66,86,0.18)"
    c.fillRect(room.x, top, room.w, 3)
    c.fillStyle = "rgba(255,255,255,0.65)"
    c.fillRect(room.x, top - 7, room.w, 5)
    c.fillStyle = "rgba(91,66,86,0.2)"
    c.fillRect(room.x, top - 2, room.w, 2)
  } else {
    fillFloor(c, style.floor, room.x - 30, top, room.w + 3000, room.y + room.h - top + 2)
  }
  c.restore()
}

const drawItemAt = (c, item, t, night, x, y, dir, moving, alpha = 1) => {
  const def = itemDef(item.k)
  c.save()
  if (alpha < 1) c.globalAlpha = alpha
  c.translate(x - def.w / 2, y - def.h)
  const flip = def.pet ? (moving ? dir < 0 : !!item.f) : !!item.f
  if (flip) {
    c.translate(def.w, 0)
    c.scale(-1, 1)
  }
  const seed = item.id.charCodeAt(0) + item.id.charCodeAt(item.id.length - 1)
  drawItem(c, item.k, { t, night, look: item.look, moving, seed, item })
  c.restore()
}

const nameTag = (c, text, x, y) => {
  c.save()
  c.font = "bold 11px 'Comic Sans MS', 'Chalkboard SE', 'Trebuchet MS', sans-serif"
  c.textAlign = "center"
  c.textBaseline = "middle"
  const w = c.measureText(text).width + 14
  rrPath(c, x - w / 2, y - 8, w, 16, 8)
  c.fillStyle = "rgba(255,255,255,0.92)"
  c.fill()
  c.lineWidth = 1.5
  c.strokeStyle = "#f27fa8"
  c.stroke()
  c.fillStyle = OL
  c.fillText(text, x, y + 0.5)
  c.restore()
}

// opts: { t, night, selected (id), room (selected room id), drag: { id, x, y }, photo }
export const drawScene = (c, house, opts = {}) => {
  const t = opts.t || 0
  const night = !!opts.night
  drawSky(c, night, t)
  drawGround(c, night)
  drawShell(c, night)
  for (const room of ROOMS) drawRoomBack(c, room, house.rooms[room.id] || {}, night)

  const items = sorted(house)
  const where = new Map()
  for (const item of items) {
    const dragging = opts.drag?.id === item.id
    const p = dragging ? { x: opts.drag.x, y: opts.drag.y, dir: 1, moving: false } : placeOf(item, t)
    where.set(item.id, p)
    if (dragging) continue
    const room = roomOf(item)
    c.save()
    clipRoom(c, room)
    drawItemAt(c, item, t, night, p.x, p.y, p.dir, p.moving)
    c.restore()
  }

  // room edges on top of everything in them
  c.lineWidth = 3
  c.strokeStyle = OL
  for (const room of ROOMS) {
    if (room.outdoor) continue
    c.strokeRect(room.x, room.y, room.w, room.h)
  }

  // night: everything dims, then every light glows
  if (night) {
    c.fillStyle = "rgba(24,20,70,0.42)"
    c.fillRect(-3000, -3000, WORLD.w + 6000, WORLD.h + 6000)
    c.save()
    c.globalCompositeOperation = "lighter"
    for (const item of items) {
      const def = itemDef(item.k)
      if (!def.glow) continue
      const p = where.get(item.id)
      const [fx, fy, r, color] = def.glow
      const gx = p.x - def.w / 2 + (item.f ? 1 - fx : fx) * def.w
      const gy = p.y - def.h + fy * def.h
      const room = roomOf(item)
      c.save()
      clipRoom(c, room)
      const g = c.createRadialGradient(gx, gy, 2, gx, gy, r)
      g.addColorStop(0, hexA(color, 0.55))
      g.addColorStop(0.45, hexA(color, 0.2))
      g.addColorStop(1, hexA(color, 0))
      c.fillStyle = g
      c.fillRect(gx - r, gy - r, r * 2, r * 2)
      c.restore()
    }
    c.restore()
  }

  // people: name tags, and hearts when two of them are close together
  const people = items.filter((i) => i.k === "avatar")
  for (const person of people) {
    if (!person.name) continue
    const p = where.get(person.id)
    nameTag(c, person.name, p.x, p.y - itemDef("avatar").h - 12)
  }
  for (let a = 0; a < people.length; a++) {
    for (let b = a + 1; b < people.length; b++) {
      const pa = where.get(people[a].id)
      const pb = where.get(people[b].id)
      if (Math.abs(pa.x - pb.x) > 110 || Math.abs(pa.y - pb.y) > 40 || roomOf(people[a]) !== roomOf(people[b])) continue
      const mx = (pa.x + pb.x) / 2
      for (let k = 0; k < 3; k++) {
        const phase = (t * 0.6 + k / 3) % 1
        c.globalAlpha = Math.sin(phase * Math.PI)
        heart(c, mx + Math.sin((t + k) * 2) * 6, pa.y - 70 - phase * 40, 9 + k * 2, "#ff8fb8", 1.2)
      }
      c.globalAlpha = 1
    }
  }

  if (opts.photo) return

  // the selected room: a soft dashed outline
  if (opts.room && ROOM[opts.room] && !opts.selected) {
    const r = ROOM[opts.room]
    c.save()
    c.setLineDash([8, 6])
    c.lineWidth = 3
    c.strokeStyle = "#ff5fa8"
    c.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6)
    c.restore()
  }

  // the thing being dragged floats above everything, with its shadow
  if (opts.drag) {
    const item = house.items[opts.drag.id]
    if (item && !item.del) {
      const def = itemDef(item.k)
      c.fillStyle = "rgba(91,66,86,0.18)"
      c.beginPath()
      c.ellipse(opts.drag.x, opts.drag.snapY ?? opts.drag.y, def.w / 2, 5, 0, 0, TAU)
      c.fill()
      drawItemAt(c, item, t, night, opts.drag.x, opts.drag.y - 4, 1, false, 0.92)
    }
  }

  // the selected thing: a dashed box with corner dots
  const selected = opts.selected && house.items[opts.selected]
  if (selected && !selected.del) {
    const def = itemDef(selected.k)
    const p = opts.drag?.id === selected.id ? { x: opts.drag.x, y: opts.drag.y - 4 } : where.get(selected.id)
    const x = p.x - def.w / 2 - 4
    const y = p.y - def.h - 4
    c.save()
    c.setLineDash([5, 4])
    c.lineDashOffset = -t * 12
    c.lineWidth = 2
    c.strokeStyle = "#ff5fa8"
    c.strokeRect(x, y, def.w + 8, def.h + 8)
    c.setLineDash([])
    for (const [cx, cy] of [[x, y], [x + def.w + 8, y], [x, y + def.h + 8], [x + def.w + 8, y + def.h + 8]]) {
      c.beginPath()
      c.arc(cx, cy, 4, 0, TAU)
      c.fillStyle = "#fff"
      c.fill()
      c.strokeStyle = "#ff5fa8"
      c.stroke()
    }
    c.restore()
  }
}

const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// A finished picture of the house (for "Take a Photo"): -> a canvas
export const renderPhoto = (house, { night = false, t = 0, scale = 0.85 } = {}) => {
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(WORLD.w * scale)
  canvas.height = Math.round(WORLD.h * scale)
  const c = canvas.getContext("2d")
  c.scale(scale, scale)
  drawScene(c, house, { t, night, photo: true })
  // a little signature in the corner
  c.font = "bold 16px 'Comic Sans MS', 'Chalkboard SE', cursive"
  c.textAlign = "right"
  c.fillStyle = "rgba(255,255,255,0.9)"
  c.fillText("♥ Dream House", WORLD.w - 16, WORLD.h - 14)
  return canvas
}
