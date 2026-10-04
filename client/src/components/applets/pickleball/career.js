// Pickleball 98: the World Tour, a ladder of eight matches against players with their own
// styles, from the park to the stadium. Winning moves you up and earns new kits (outfits).
// Pure data and functions; the page saves the state in localStorage.

export const TOUR = [
  { id: "r1", title: "Park Open, Round 1", opponent: "gus", level: "beginner", venue: "park", target: 7 },
  { id: "r2", title: "Park Open, Final", opponent: "abby", level: "beginner", venue: "park", target: 11 },
  { id: "r3", title: "Club Classic, Round 1", opponent: "sam", level: "intermediate", venue: "club", target: 11, reward: { outfit: "sunset", text: "The Sunset kit is yours." } },
  { id: "r4", title: "Club Classic, Semifinal", opponent: "priya", level: "intermediate", venue: "club", target: 11 },
  { id: "r5", title: "Club Classic, Final", opponent: "kenji", level: "intermediate", venue: "club", target: 11 },
  { id: "r6", title: "Center Court Masters, Quarterfinal", opponent: "dex", level: "pro", venue: "stadium", target: 11, reward: { outfit: "neon", text: "The Neon kit is yours." } },
  { id: "r7", title: "Center Court Masters, Semifinal", opponent: "rosa", level: "pro", venue: "stadium", target: 11 },
  { id: "r8", title: "Center Court Masters, Final", opponent: "lou", level: "legend", venue: "stadium", target: 11, reward: { outfit: "gold", text: "Tour Champion! The Champion's gold kit is yours, and Lou joins the players." } },
]

export const freshTour = () => ({ stage: 0, results: [], champion: false })

// a saved state, made safe (old or hand-edited saves can't break the game)
export const tourState = (saved) => {
  const s = saved && typeof saved === "object" ? saved : {}
  const stage = Number.isInteger(s.stage) ? Math.max(0, Math.min(TOUR.length, s.stage)) : 0
  const results = Array.isArray(s.results) ? s.results.filter((r) => r && typeof r.id === "string").slice(-40) : []
  return { stage, results, champion: !!s.champion || stage >= TOUR.length }
}

// the next match to play (or null once you're the champion)
export const nextMatch = (state) => (state.stage < TOUR.length ? { ...TOUR[state.stage], index: state.stage } : null)

// After a tour match: returns { state, reward } (a win moves you up; a loss lets you retry)
export const recordResult = (state, index, won, score = [0, 0]) => {
  const s = tourState(state)
  const results = [...s.results, { id: TOUR[index]?.id || "?", won: !!won, score: [...score] }]
  if (!won || index !== s.stage) return { state: { ...s, results }, reward: null }
  const stage = s.stage + 1
  const reward = TOUR[index].reward || null
  return { state: { stage, results, champion: stage >= TOUR.length }, reward }
}

// what the tour has opened up (every venue is always open)
export const unlocks = (state) => {
  const s = tourState(state)
  const venues = ["park", "club", "stadium", "beach", "winter"]
  const outfits = ["home", "away"]
  for (let i = 0; i < s.stage; i++) {
    const r = TOUR[i].reward
    if (r?.venue) venues.push(r.venue)
    if (r?.outfit) outfits.push(r.outfit)
  }
  return { venues, outfits, champion: s.champion }
}
