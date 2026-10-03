// The show format for How Well Do You Know Me and This or That, shared by live games
// (server/quiz/live.js), pass-the-phone games and answer-later games: question packs (some
// unlock as you play), the rounds of a show (double points, a lightning round, a final big
// bet), scoring with streaks, the results' titles and Lulu the host's lines. Pure
// functions; packs come in as arguments (see packs.js).

import { pickSome } from "./logic.js"

// ---------- packs ----------

// unlock: shows you've finished before the pack opens up
export const KNOWME_PACKS = [
  { id: "firstdate", name: "First Date", blurb: "Favorite things, food and drink. The perfect warm-up.", cats: ["favorites", "food"], unlock: 0 },
  { id: "quirks", name: "Little Quirks", blurb: "Habits and personality: the stuff you learn up close.", cats: ["habits", "personality"], unlock: 0 },
  { id: "wayback", name: "Way Back When", blurb: "Growing up, and dreams for someday.", cats: ["past", "dreams"], unlock: 1 },
  { id: "ustwo", name: "Us Two", blurb: "Love, and the two of you together.", cats: ["love", "us"], unlock: 2 },
  { id: "flirty", name: "Flirt Mode", blurb: "A little cheeky, a lot cute. Blushing allowed.", cats: ["flirty"], unlock: 3 },
  { id: "mix", name: "Grab Bag", blurb: "A bit of everything (minus the flirting).", cats: null, unlock: 0 },
]
export const TOT_PACKS = [
  { id: "quick", name: "Quick Picks", blurb: "Coffee or tea? Beach or mountains? Snap decisions.", kinds: ["tot"], unlock: 0 },
  { id: "rather", name: "Would You Rather", blurb: "Tricky little dilemmas. No fence-sitting!", kinds: ["wyr"], unlock: 0 },
  { id: "datenight", name: "Date Night", blurb: "Sweet, romantic and a tiny bit flirty.", kinds: ["date"], unlock: 1 },
  { id: "mix", name: "Grab Bag", blurb: "Everything, shuffled.", kinds: null, unlock: 0 },
]
export const packsFor = (mode) => (mode === "tot" ? TOT_PACKS : KNOWME_PACKS)
export const defaultPack = (mode) => (mode === "tot" ? "quick" : "firstdate")
export const packById = (mode, id) => packsFor(mode).find((p) => p.id === id) || null
export const isUnlocked = (pack, shows = 0) => !!pack && shows >= pack.unlock

// The questions of a pack. content: { aboutMe, pairs }
export const packPool = (content, mode, packId) => {
  const pack = packById(mode, packId) || packById(mode, "mix")
  if (mode === "tot") return content.pairs.filter((p) => !pack.kinds || pack.kinds.includes(p.kind))
  return content.aboutMe.filter((q) => (pack.cats ? pack.cats.includes(q.cat) : q.cat !== "flirty"))
}

// ---------- the rounds of a show ----------

export const LENGTHS = {
  knowme: [
    { count: 3, name: "Quick", text: "about 5 minutes" },
    { count: 5, name: "Classic", text: "about 10 minutes" },
    { count: 7, name: "Marathon", text: "15 minutes or so" },
  ],
  tot: [
    { count: 6, name: "Quick", text: "about 3 minutes" },
    { count: 10, name: "Classic", text: "about 5 minutes" },
    { count: 14, name: "Marathon", text: "about 8 minutes" },
  ],
}
export const LIGHTNING = 4
export const TIMES = { normal: 20, lightning: 8, final: 25, totLightning: 6 }

// A show, step by step: [{ id, subject: 0 | 1 | null, round, mult, base, timer, bet }]
//   knowme: round "one" (all about player 0, the last question counts double), round
//   "two" (all about player 1), a lightning round taking turns, and a final question
//   about each of you with a big bet on it.
//   tot: a warm-up, "Double Trouble" (double points) and a lightning round.
// timer: true for a clock on every question (the lightning round always has one).
export const buildShow = (mode, { pool, fallback = [], count, timer = true, random = Math.random }) => {
  const need = mode === "tot" ? count + LIGHTNING : count * 2 + LIGHTNING + 2
  let picked = pickSome(pool, need, random)
  // a small pack is topped up from the rest
  if (picked.length < need) {
    const ids = new Set(picked.map((q) => q.id))
    picked = [...picked, ...pickSome(fallback.filter((q) => !ids.has(q.id)), need - picked.length, random)]
  }
  const t = (secs) => (timer ? secs : 0)
  const steps = []
  const add = (q, s) => q && steps.push({ id: q.id, subject: null, mult: 1, base: 100, timer: t(TIMES.normal), bet: false, ...s })
  if (mode === "tot") {
    const half = Math.ceil(count / 2)
    picked.slice(0, half).forEach((q) => add(q, { round: "warmup" }))
    picked.slice(half, count).forEach((q) => add(q, { round: "double", mult: 2 }))
    picked.slice(count, count + LIGHTNING).forEach((q) => add(q, { round: "lightning", base: 50, timer: TIMES.totLightning }))
    return steps
  }
  picked.slice(0, count).forEach((q, i) => add(q, { round: "one", subject: 0, mult: i === count - 1 ? 2 : 1 }))
  picked.slice(count, count * 2).forEach((q, i) => add(q, { round: "two", subject: 1, mult: i === count - 1 ? 2 : 1 }))
  picked.slice(count * 2, count * 2 + LIGHTNING).forEach((q, i) => add(q, { round: "lightning", subject: i % 2, base: 50, timer: TIMES.lightning }))
  picked.slice(count * 2 + LIGHTNING).forEach((q, i) => add(q, { round: "final", subject: i % 2, timer: t(TIMES.final), bet: true }))
  return steps
}

// Does a new round start at step i? (A round card shows first.)
export const startsRound = (steps, i) => i === 0 || steps[i]?.round !== steps[i - 1]?.round

// The round card: { kicker, title, text }. names: [player 0, player 1]
export const roundInfo = (mode, round, names = ["Player 1", "Player 2"]) => {
  const [a, b] = names
  if (mode === "tot") {
    return {
      warmup: { kicker: "Round 1", title: "Warm-up", text: "Pick your side. Same pick? You both score!" },
      double: { kicker: "Round 2", title: "Double Trouble", text: "Every match is worth double points!" },
      lightning: { kicker: "Final round", title: "Lightning Round", text: `${TIMES.totLightning} seconds a pick. Don't think, just tap!` },
    }[round]
  }
  return {
    one: { kicker: "Round 1", title: `All about ${a}`, text: `${a}, answer about yourself (secretly!). ${b}, guess what ${a} said.` },
    two: { kicker: "Round 2", title: `All about ${b}`, text: `Switch! ${b} answers, ${a} guesses.` },
    lightning: { kicker: "Round 3", title: "Lightning Round", text: `${TIMES.lightning} seconds a question, taking turns. Trust your gut!` },
    final: { kicker: "The finale", title: "The Big Bet", text: "One last question about each of you. Bet your points on your guess!" },
  }[round]
}

// ---------- scoring ----------

export const BETS = [
  { id: "safe", name: "Play it safe", text: "100 points" },
  { id: "bold", name: "Feeling bold", text: "250 points" },
  { id: "allin", name: "All in!", text: "Everything you've got (at least 300)" },
]
export const betAmount = (id, score) => (id === "allin" ? Math.max(300, score) : id === "bold" ? 250 : 100)
export const STREAK_BONUS = 50
export const STREAK_AT = 3

// players: how many (This or That can have up to 8; How Well Do You Know Me is for two)
export const newScore = (players = 2) => ({ points: Array(players).fill(0), streak: Array(players).fill(0), best: Array(players).fill(0), matches: 0, played: 0, teamStreak: 0, teamBest: 0 })

// One step played: answers [player 0's, player 1's, ...] (null: no answer in time); bets
// [id, id] for the final. -> { score, outcome: { match, truth, guess, guesser, gained, streak, onFire, bet } }
// This or That: a match is everyone picking the same side, and everyone scores it.
export const scoreStep = (mode, score, step, answers, bets = null) => {
  const s = { ...score, points: [...score.points], streak: [...score.streak], best: [...score.best] }
  const gained = s.points.map(() => 0)
  s.played++
  if (mode === "tot") {
    const match = answers.length > 1 && answers.every((a) => a !== null && a !== undefined && a === answers[0])
    if (match) {
      s.matches++
      s.teamStreak++
      s.teamBest = Math.max(s.teamBest, s.teamStreak)
      const pts = step.base * step.mult + (s.teamStreak >= STREAK_AT ? STREAK_BONUS : 0)
      s.points = s.points.map((p, i) => ((gained[i] = pts), p + pts))
    } else s.teamStreak = 0
    return { score: s, outcome: { match, gained, streak: s.teamStreak, onFire: match && s.teamStreak >= STREAK_AT } }
  }
  const guesser = 1 - step.subject
  const truth = answers[step.subject] ?? null
  const guess = answers[guesser] ?? null
  const match = truth !== null && guess === truth
  let bet = null
  if (match) {
    s.matches++
    s.streak[guesser]++
    s.best[guesser] = Math.max(s.best[guesser], s.streak[guesser])
  } else s.streak[guesser] = 0
  if (step.bet) {
    bet = betAmount(bets?.[guesser] || "safe", s.points[guesser])
    gained[guesser] = match ? bet : -Math.min(bet, s.points[guesser])
  } else if (match) gained[guesser] = step.base * step.mult + (s.streak[guesser] >= STREAK_AT ? STREAK_BONUS : 0)
  s.points[guesser] += gained[guesser]
  return { score: s, outcome: { match, truth, guess, guesser, gained, streak: s.streak[guesser], onFire: match && s.streak[guesser] >= STREAK_AT, bet } }
}

// A whole show, played back: answers [[a0, a1], ...] -> { score, outcomes }
export const replayShow = (mode, steps, answers, bets = null) => {
  let score = newScore(2)
  const outcomes = steps.map((step, i) => {
    const r = scoreStep(mode, score, step, answers[i] || [null, null], bets)
    score = r.score
    return r.outcome
  })
  return { score, outcomes }
}

// ---------- results ----------

export const TIERS = [
  { min: 90, name: "Soulmates", line: "Practically telepathic. Get a room! (You have one. It's this window.)" },
  { min: 75, name: "Lovebirds", line: "You two have clearly been paying attention." },
  { min: 55, name: "Sweethearts", line: "Lots in common, plus a few lovely surprises." },
  { min: 35, name: "Still Discovering", line: "So many mysteries left to unwrap. That's the fun part!" },
  { min: 0, name: "Beautiful Mysteries", line: "Time for a long talk over dessert. Then a rematch!" },
]
export const tierFor = (percent) => TIERS.find((t) => percent >= t.min)

// -> { matches, total, percent, tier, headline, winner: 0 | 1 | null (knowme), best }
export const summarize = (mode, score, names = ["Player 1", "Player 2"]) => {
  const total = score.played
  const percent = total ? Math.round((score.matches / total) * 100) : 0
  const tier = tierFor(percent)
  const [p0, p1] = score.points
  const winner = mode === "tot" || p0 === p1 ? null : p0 > p1 ? 0 : 1
  return {
    matches: score.matches,
    total,
    percent,
    tier,
    headline: `You two matched on ${score.matches}/${total}: ${tier.name}!`,
    winner,
    winnerName: winner === null ? null : names[winner],
    best: mode === "tot" ? score.teamBest : Math.max(...score.best),
  }
}

// ---------- Lulu, the host ----------

export const HOST_NAME = "Lulu"
const LINES = {
  welcome: [
    "Welcome to the Lovebirds Quiz Show! I'm your host, Lulu. Pick a game!",
    "Lights, camera, romance! Who's ready to play?",
    "Back again, lovebirds? The studio missed you.",
    "Tonight's big question: how well do you REALLY know each other?",
  ],
  start: ["Contestants, take your marks!", "Let's get this show on the road!", "Hearts ready? Here we go!", "No peeking, no cheating, lots of giggling. Go!"],
  waiting: ["The spotlight's warming up...", "Somebody fluff the pillows, we have contestants!", "Hair and makeup, please. We're almost live!"],
  double: ["Double points! No pressure. (So much pressure.)", "This one counts twice. Make it count!", "Double points on the board! Somebody hold my feathers."],
  lightning: ["Lightning round! No time to think, only time to love.", "Fast fingers, full hearts. Go go go!", "Quick! The clock is tapping its little foot."],
  final: ["It all comes down to this. How sure are you?", "Big bets, big hearts. Place your wagers!", "The finale! Fortune favors the lovebirds."],
  match: ["Nailed it!", "Mind meld!", "Same brain!", "Telepathy confirmed!", "Bullseye!", "Somebody's been listening!", "Aww, perfect match!", "Spot on!"],
  miss: ["Plot twist!", "Ooh, now you know!", "Noted for next time!", "Surprise!", "The mystery deepens...", "New fact unlocked!", "Awkward... but adorable!", "So close! (Not really.)"],
  fire: ["{name} is on fire! {n} in a row!", "{n} in a row! Somebody's been taking notes.", "Streak bonus! {name} can't miss!"],
  timeout: ["Time's up! The clock waits for no lovebird.", "Too slow! Next time, trust your gut."],
  totMatch: ["Same pick! Great minds think alike.", "In sync!", "Twinning!", "Two hearts, one answer!"],
  totMiss: ["Split decision!", "Opposites attract!", "Agree to disagree!", "Ooh, a debate for dinner!"],
  betWin: ["The bet pays off! Cha-ching!", "Bold move, big reward!"],
  betLose: ["Oof! The house wins this one.", "Bold move... wrong answer!"],
  results: {
    Soulmates: ["I'm not crying, you're crying. Soulmates!"],
    Lovebirds: ["Look at you two! Certified lovebirds."],
    Sweethearts: ["Sweet, sweet, sweet. I ship it."],
    "Still Discovering": ["Plenty left to learn. Lucky you, more dates!"],
    "Beautiful Mysteries": ["A mystery wrapped in a romance! Rematch?"],
  },
}

// A line for a moment of the show. n picks which one (the step number, so both screens of a
// live game say the same thing); vars fill in {name} and {n}.
export const hostLine = (kind, n = 0, vars = {}) => {
  const list = kind.startsWith("results:") ? LINES.results[kind.slice(8)] || LINES.results.Sweethearts : LINES[kind] || LINES.welcome
  return list[Math.abs(n) % list.length].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "")
}
