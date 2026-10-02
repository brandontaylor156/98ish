import { useEffect } from "react"
import { unlock } from "../../../../utils/achievements"

// T-spin triple (any mode), and Sprint 40L in under two minutes
export const useTetrisAchievements = (game, mode) => {
  useEffect(() => {
    if (game.lastClear?.tSpin === "full3") unlock("tetris-tst")
  }, [game.lastClear?.id])

  useEffect(() => {
    if ((mode === "sprint" || mode === "race") && game.status === "over" && game.endReason === "goal" && game.time < 120_000) unlock("tetris-sprint")
  }, [game.status])
}
