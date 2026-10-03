// Points, the multiplier and the star rating. Pure.

export const NOTE_POINTS = 50 // per gem (a two-note chord is 100)
export const SUSTAIN_POINTS = 25 // per beat held
export const STREAK_STEP = 10 // notes in a row for each step of the multiplier
export const MAX_MULTIPLIER = 4

// 1x, then 2x at 10 in a row, 3x at 20, 4x at 30
export const multiplierFor = (streak) => Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / STREAK_STEP))

// The best score possible without star power: every note hit, every sustain held
export const perfectScore = (notes, spb) => {
  let total = 0
  notes.forEach((n, i) => {
    const mult = multiplierFor(i + 1)
    total += n.lanes.length * NOTE_POINTS * mult
    if (n.sustainTime > 0) total += Math.round((n.sustainTime / spb) * SUSTAIN_POINTS * mult)
  })
  return total
}

// Stars, 1 to 5 (a finished song always gets at least one): how close you came to the
// perfect score. Star power can push you past it, which is the way to five stars on a song
// you nearly full-combo.
export const STAR_THRESHOLDS = [0, 0.3, 0.52, 0.72, 0.9]
export const starsFor = (score, perfect) => {
  if (!perfect) return 0
  const r = score / perfect
  let stars = 0
  for (const t of STAR_THRESHOLDS) if (r >= t) stars++
  return stars
}

export const accuracy = (hit, total) => (total ? Math.round((hit / total) * 1000) / 10 : 0)

// Callouts for streaks worth shouting about
export const streakMilestone = (streak) => (streak >= 50 && streak % 50 === 0 ? streak : 0)
