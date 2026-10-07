// Pickleball 98's game-feel extras (pure, tested in gamefeel.test.js): what a phone buzz says
// for each moment, and the streaks the crowd and the callouts react to.
//
// Phones that can't buzz (an iPhone: Safari has no navigator.vibrate) get the same moments
// as a short glow at the screen's edges instead (Pickleball.jsx `feelIt`), so every hit you
// time well is felt either way.

// A vibration pattern (ms, or [on, off, on...]) for an engine event, or null for none.
// Only your own moments buzz: your hits, your rallies won, your game.
export const hapticFor = (e) => {
  if (!e) return null
  if (e.type === "hit") {
    if (!e.mine) return null
    if (e.kind === "smash") return 28
    if (e.grade === "perfect") return 18
    return 8
  }
  if (e.type === "whiff") return [6, 50, 6]
  if (e.type === "rally") return e.yours ? [12, 60, 24] : null
  if (e.type === "gameover") return e.youWon ? [20, 70, 20, 70, 50] : null
  return null
}

// How strong the screen-edge glow is for the same moments (0..1, 0: none)
export const pulseFor = (e) => {
  const h = hapticFor(e)
  if (!h) return 0
  const ms = Array.isArray(h) ? Math.max(...h) : h
  return Math.min(1, ms / 28)
}

// Streaks: perfect contacts in a row (yours), rallies won in a row (either side), and how
// far behind you've been this game (for the comeback). `team` is your team.
export const createStreaks = (team = 0) => ({ team, perfect: 0, run: 0, runTeam: null, worst: 0, cameBack: false })

// Your hit: returns a callout { text, tone } at 3, 5 and 8 perfect contacts in a row
export const streakHit = (s, e) => {
  if (!e.mine) return null
  if (e.grade !== "perfect") {
    s.perfect = 0
    return null
  }
  s.perfect++
  if (s.perfect === 3) return { text: "3 perfect in a row!", tone: "good" }
  if (s.perfect === 5) return { text: "ON FIRE! 5 perfect", tone: "good" }
  if (s.perfect === 8) return { text: "UNTOUCHABLE! 8 perfect", tone: "good" }
  return null
}

// A rally won: returns a callout at a run of 3 and 5 for you ("3 in a row!", "ON A
// ROLL!") and at 4 for them ("Stop the run!"). `level` 0..1 is how loud the crowd gets.
export const streakRally = (s, e) => {
  if (s.runTeam === e.winner) s.run++
  else {
    s.runTeam = e.winner
    s.run = 1
  }
  const yours = e.winner === s.team
  if (yours && s.run === 3) return { text: "3 in a row!", tone: "good", level: 0.55 }
  if (yours && s.run === 5) return { text: "ON A ROLL!", tone: "good", level: 0.8 }
  if (!yours && s.run === 4) return { text: "Stop the run!", tone: "bad", level: 0 }
  return null
}

// The score after a point: down by 3 or more this game and now level or ahead is a
// comeback (once a game)
export const streakScore = (s, score) => {
  const mine = score[s.team]
  const theirs = score[1 - s.team]
  s.worst = Math.max(s.worst, theirs - mine)
  if (!s.cameBack && s.worst >= 3 && mine >= theirs) {
    s.cameBack = true
    return { text: mine > theirs ? "COMPLETE COMEBACK!" : "ALL SQUARE! Comeback on", tone: "good", level: 0.9 }
  }
  return null
}
