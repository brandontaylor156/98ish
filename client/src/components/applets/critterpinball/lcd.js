// What Critter Catch Pinball's display says: a green handheld-style LCD drawn by Blue
// Screen's dot-matrix code (../pinball/dmd.js createDmd with green colors), 128 x 32 on a
// computer's side panel and 128 x 16 on a phone's top bar. Pure, so it's tested.

import { FONTS, textWidth } from "../pinball/pixel.js"
import { BY_ID, areaName } from "./critters.js"
import { BALL_LEVELS, LETTERS } from "./game.js"

export const LCD_COLORS = { back: "gb3", off: "gb3", on: "gb0", hot: "gb1" }
const COLS = 128
const fmt = (n) => n.toLocaleString("en-US")
const blink = (now, hz = 3) => Math.floor(now * hz * 2) % 2 === 0
const line = (t, y, o = {}) => ({ t: String(t).toUpperCase(), y, font: "big", scale: 1, align: "center", x: COLS / 2, ...o })
const fit = (t, y, maxScale = 2) => {
  const s = String(t)
  if (maxScale >= 2 && textWidth(s, FONTS.big, 2) <= COLS - 2) return line(s, y, { scale: 2 })
  if (textWidth(s, FONTS.big) <= COLS - 2) return line(s, y + (maxScale >= 2 ? 4 : 0))
  return line(s, y + (maxScale >= 2 ? 5 : 1), { font: "small" })
}
const small = (t, y, o = {}) => line(t, y, { font: textWidth(String(t), FONTS.big) <= COLS - 2 ? "big" : "small", ...o })

// the one-line status: what's running, or what to do next
export const statusLine = (g) => {
  const a = g.active
  if (g.stage === "bonus" && g.bonus) return `${g.bonus.stage.name} ${Math.max(0, Math.ceil(g.bonus.until - g.time))}`
  if (a?.kind === "catch") {
    const left = Math.max(0, Math.ceil(a.until - g.time))
    return a.phase === "reveal" ? `REVEAL ${a.tiles.filter(Boolean).length}/6 ${left}` : `${BY_ID[a.id].name} ${a.hits}/${a.need} ${left}`
  }
  if (a?.kind === "evolve") {
    if (a.phase === "choose") return `PICK: ${BY_ID[a.options[a.pick]].name}`
    return a.phase === "ready" ? "EVOLVE: SINK THE DEN" : `ITEMS ${a.got}/3 ${Math.max(0, Math.ceil(a.until - g.time))}`
  }
  if (g.catchLit) return "CATCH: SINK THE DEN"
  if (g.evoLit) return "EVOLVE: SINK THE DEN"
  if (g.bonusLit) return "BONUS: SINK THE CAVE"
  if (g.mapLit) return "MAP MOVE: THE CAVE"
  return `${g.letters ? `${LETTERS.slice(0, g.letters)} - ` : ""}${areaName(g.table, g.area)}`
}

export const lcdContent = (g, now, { rows = 32, scores = [], prompt = "PRESS F2", caught = 0, total = 0 } = {}) => {
  const tall = rows >= 32
  if (g.dmd && g.mode !== "attract") {
    const { big, small: sub, flash, t } = g.dmd
    const age = now - (t ?? now)
    const hide = flash && age < 1.2 && !blink(now, 5)
    if (tall) return [hide ? null : fit(big, 3), sub ? small(sub, 23) : null].filter(Boolean)
    if (sub && Math.floor(age / 1.1) % 2 === 1) return [small(sub, 4)]
    return hide ? [] : [fit(big, 1)]
  }
  if (g.mode === "attract" || g.mode === "over") {
    const pages = [
      () => [fit("CRITTER CATCH", tall ? 3 : 1), tall ? line(g.T.name, 23, { font: "small" }) : null],
      () =>
        tall
          ? [line("HIGH SCORES", 1, { font: "small" }), ...scores.slice(0, 3).map((s, i) => line(`${i + 1} ${s.name} ${fmt(s.score)}`, 9 + i * 8))]
          : [line(scores[0] ? `1 ${scores[0].name} ${fmt(scores[0].score)}` : "NO SCORES YET", 4)],
      () => [fit(`DEX ${caught}/${total}`, tall ? 3 : 1), tall ? line("CATCH THEM ALL", 23, { font: "small" }) : null],
      () => [fit(prompt, tall ? 3 : 1), tall ? line("CATCH - EVOLVE - EXPLORE", 23, { font: "small" }) : null],
    ]
    if (g.mode === "over") pages.unshift(() => [fit("GAME OVER", tall ? 3 : 1), tall ? line(fmt(g.score), 23) : null])
    return pages[Math.floor(now / 3) % pages.length]().filter(Boolean)
  }
  const score = fmt(g.score)
  const status = statusLine(g)
  if (tall) {
    return [
      line(`BALL ${g.ballNumber}`, 1, { font: "small", align: "left", x: 2 }),
      line(`${BALL_LEVELS[g.ballLevel].short} ${BALL_LEVELS[g.ballLevel].x}X`, 1, { font: "small", align: "right", x: COLS - 2 }),
      fit(score, 8),
      small(status, 25, textWidth(status.toUpperCase(), FONTS.big) <= COLS - 2 ? {} : { y: 26 }),
    ]
  }
  return [line(score, 0, { align: "left", x: 1 }), line(`B${g.ballNumber}`, 0, { align: "right", x: COLS - 1 }), small(status, 9, textWidth(status.toUpperCase(), FONTS.big) <= COLS - 2 ? {} : { y: 10 })]
}
