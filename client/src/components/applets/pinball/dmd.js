// The dot-matrix display (DMD): orange dots on black, 128 x 32 (or 128 x 16 on a phone's
// top bar). dmdContent() decides what it says from the game (pure, tested); createDmd()
// draws it: every dot is 2 x 2 pixels with a 1 pixel gap, unlit dots glow faintly, and the
// canvas is scaled up with nearest-neighbour pixels like the table.

import { MISSIONS, currentMission, missionGoal, rankName } from "./game.js"
import { C, FONTS, PAL32, textDots, textWidth } from "./pixel.js"

export const DMD_COLS = 128
const PITCH = 3

const fmt = (n) => n.toLocaleString("en-US")
const blink = (now, hz = 3) => Math.floor(now * hz * 2) % 2 === 0

// a line of text: { t, y, font: "big" | "small", scale, align, x, dim }
const line = (t, y, o = {}) => ({ t: String(t).toUpperCase(), y, font: "big", scale: 1, align: "center", x: DMD_COLS / 2, ...o })

// the widest a string can be drawn at: 2x big, else 1x big, else small
const fitBig = (t, y, maxScale = 2) => {
  const s = String(t)
  if (maxScale >= 2 && textWidth(s, FONTS.big, 2) <= DMD_COLS - 2) return line(s, y, { scale: 2 })
  if (textWidth(s, FONTS.big) <= DMD_COLS - 2) return line(s, y + (maxScale >= 2 ? 4 : 0))
  return line(s, y + (maxScale >= 2 ? 5 : 1), { font: "small" })
}

// What the display shows. info: { rows (32 | 16), scores: [{ name, score }], prompt }
export const dmdContent = (g, now, { rows = 32, scores = [], prompt = "PRESS F2" } = {}) => {
  const tall = rows >= 32
  // an event takes over the display for a moment
  if (g.dmd && g.mode !== "attract") {
    const { big, small, flash, t } = g.dmd
    const age = now - (t ?? now)
    const hide = flash && age < 1.2 && !blink(now, 5)
    if (tall) {
      return [hide ? null : fitBig(big, 3), small ? line(small, 23) : null].filter(Boolean)
    }
    // short display: the big line, then the small one
    if (small && Math.floor(age / 1.1) % 2 === 1) return [line(small, 4)]
    return hide ? [] : [fitBig(big, 1)]
  }
  if (g.mode === "attract" || g.mode === "over") {
    const pages = [
      () => [fitBig("BLUE SCREEN", tall ? 3 : 1), tall ? line("98ISH PINBALL", 23, { font: "small" }) : null],
      () =>
        tall
          ? [line("HIGH SCORES", 1, { font: "small" }), ...scores.slice(0, 3).map((s, i) => line(`${i + 1} ${s.name} ${fmt(s.score)}`, 9 + i * 8, { font: "big" }))]
          : [line(scores[0] ? `1 ${scores[0].name} ${fmt(scores[0].score)}` : "NO SCORES YET", 4)],
      () => [fitBig(prompt, tall ? 3 : 1), tall ? line("MISSIONS: INTERN TO SYSADMIN", 23, { font: "small" }) : null],
    ]
    if (g.mode === "over") pages.unshift(() => [fitBig("GAME OVER", tall ? 3 : 1), tall ? line(fmt(g.score), 23) : null])
    const page = pages[Math.floor(now / 3) % pages.length]()
    return page.filter(Boolean)
  }
  const m = currentMission(g)
  const goal = missionGoal(g)
  const mission = `${m.name} ${Math.min(g.missionProgress, goal)}/${goal}`
  const score = fmt(g.score)
  if (tall) {
    return [
      line(`BALL ${g.ballNumber}`, 1, { font: "small", align: "left", x: 2 }),
      line(rankName(g.rank), 1, { font: "small", align: "right", x: DMD_COLS - 2 }),
      fitBig(score, 8),
      line(g.multiball ? `JACKPOT ${fmt(g.jackpot)}` : mission, 25, { font: textWidth(mission, FONTS.big) <= DMD_COLS - 2 && !g.multiball ? "big" : "small", ...(textWidth(mission, FONTS.big) <= DMD_COLS - 2 && !g.multiball ? {} : { y: 26 }) }),
    ]
  }
  return [
    line(score, 0, { align: "left", x: 1 }),
    line(`B${g.ballNumber}`, 0, { align: "right", x: DMD_COLS - 1 }),
    line(g.multiball ? `JACKPOT ${fmt(g.jackpot)}` : mission, 9, { font: textWidth(mission, FONTS.big) <= DMD_COLS - 2 ? "big" : "small", ...(textWidth(mission, FONTS.big) <= DMD_COLS - 2 ? {} : { y: 10 }) }),
  ]
}

// pitch: device pixels per dot (1 = solid LCD pixels, 2 = 2x2 dots, 3+ = dots with a gap);
// colors: palette names { back, off, on, hot } (default orange plasma; Critter Catch uses
// a green handheld LCD)
export const createDmd = (canvas, rows = 32, pitch = PITCH, colors = {}) => {
  const w = DMD_COLS * pitch
  const h = rows * pitch
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d", { alpha: false })
  const img = ctx.createImageData(w, h)
  const buf = new Uint32Array(img.data.buffer)
  const dots = new Uint8Array(DMD_COLS * rows)
  const lit = pitch >= 3 ? pitch - 1 : pitch
  const off = PAL32[C[colors.off || "dmd1"]]
  const on = PAL32[C[colors.on || "dmd"]]
  const hot = PAL32[C[colors.hot || "dmd4"]]
  const back = PAL32[C[colors.back || "dmd0"]]
  let lastKey = ""

  const render = (lines) => {
    const key = JSON.stringify(lines)
    if (key === lastKey) return false
    lastKey = key
    dots.fill(0)
    for (const l of lines) {
      const font = FONTS[l.font] || FONTS.big
      const width = textWidth(l.t, font, l.scale)
      const x = Math.round(l.align === "center" ? l.x - width / 2 : l.align === "right" ? l.x - width : l.x)
      textDots(l.t, font, x, l.y, l.scale, (dx, dy) => {
        if (dx >= 0 && dy >= 0 && dx < DMD_COLS && dy < rows) dots[dy * DMD_COLS + dx] = l.dim ? 1 : 2
      })
    }
    buf.fill(back)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < DMD_COLS; x++) {
        const d = dots[y * DMD_COLS + x]
        const v = d === 2 ? on : d === 1 ? hot : off
        const o = y * pitch * w + x * pitch
        for (let j = 0; j < lit; j++) for (let i = 0; i < lit; i++) buf[o + j * w + i] = v
        if (lit > 1 && v === on) buf[o] = hot
      }
    }
    ctx.putImageData(img, 0, 0)
    return true
  }
  return { render, rows }
}

export { MISSIONS }
