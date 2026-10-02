// Local bests per solo mode. Marathon keeps the old high score key, so earlier scores stay.
import { beats, resultValue } from "./modes.js"

const HIGH_SCORE_KEY = "98ish.tetris.highScore"
const BEST_KEY = "98ish.tetris.best"

const read = () => {
  try {
    const bests = JSON.parse(localStorage.getItem(BEST_KEY)) || {}
    const marathon = Number(localStorage.getItem(HIGH_SCORE_KEY)) || 0
    return { ...bests, marathon: marathon || null }
  } catch {
    return {}
  }
}

export const readBests = read

// Save the result if it's a new best; returns { value, isBest }
export const recordResult = (mode, game) => {
  const value = resultValue(mode, game)
  const bests = read()
  const isBest = beats(mode, value, bests[mode]) && !(mode !== "sprint" && !value)
  if (isBest) {
    try {
      if (mode === "marathon") localStorage.setItem(HIGH_SCORE_KEY, String(value))
      else {
        const { marathon, ...rest } = bests
        localStorage.setItem(BEST_KEY, JSON.stringify({ ...rest, [mode]: value }))
      }
    } catch {
      // storage unavailable (private mode etc.): this session only
    }
  }
  return { value, isBest }
}
