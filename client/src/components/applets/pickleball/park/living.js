// Living Park (pure; the server loads this very file): what a clone left in My Park may say,
// what the park's regulars remember about you, and their day.
//
// A clone only ever says lines from its owner's phrasebook (they edit or approve every line;
// nothing is made up in a friend's name). Lines are picked by context, by rule.
//
// The regulars' memory lives on the VISITOR's device (memoryKey per venue): who they've met
// and the last few results, so a regular can greet you by name and mention your last game.
// Everything they say comes from the templates here.

export const PHRASE_KINDS = ["greet", "win", "loss", "trash", "cheer"]
export const PHRASE_LABELS = { greet: "Saying hi", win: "When I win", loss: "When I lose", trash: "Trash talk", cheer: "Encouragement" }
export const LIMITS = { perKind: 6, total: 20, chars: 60, log: 50 }

export const DEFAULT_PHRASES = {
  greet: ["Hey! Want a game?", "You again? Let's go.", "Paddle up!", "I've been waiting all day."],
  win: ["Good game. Rematch any time.", "That's how it's done!", "Close one. Mostly."],
  loss: ["Nice game. You earned that.", "Okay, okay. Rematch?", "You got me this time."],
  trash: ["Hope you brought your A game.", "Stay out of my kitchen.", "I don't miss dinks."],
  cheer: ["Nice shot!", "Great get!", "Ooh, good one."],
}

const clean = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LIMITS.chars)

// a phrasebook from anywhere (the owner's edits, a stored record): known kinds only, at most
// perKind lines each and total overall, each line trimmed; an empty kind falls back to the
// defaults so the clone always has something polite to say
export const cleanPhrases = (p) => {
  const out = {}
  let total = 0
  for (const kind of PHRASE_KINDS) {
    const lines = []
    for (const raw of Array.isArray(p?.[kind]) ? p[kind] : []) {
      const line = clean(raw)
      if (!line || lines.includes(line) || lines.length >= LIMITS.perKind || total >= LIMITS.total) continue
      lines.push(line)
      total++
    }
    out[kind] = lines
  }
  for (const kind of PHRASE_KINDS) if (!out[kind].length) out[kind] = DEFAULT_PHRASES[kind].slice(0, 2)
  return out
}

// one approved line for a moment: "greet" (you walk up), "trash" (the game starts), "cheer"
// (you hit a winner), "win" / "loss" (the clone won or lost). Never the same line twice in a row.
export const pickLine = (phrases, kind, rand = Math.random, last = null) => {
  const list = (phrases?.[kind] || []).filter((l) => l && l !== last)
  const pool = list.length ? list : phrases?.[kind] || DEFAULT_PHRASES[kind] || []
  return pool.length ? pool[Math.floor(rand() * pool.length) % pool.length] : ""
}

// ---- the clone's memory log (server-side, capped) ----
// entry: { at, by, cloneWon, score: [clone, visitor], venue }
export const addToLog = (log, entry, max = LIMITS.log) => [entry, ...(Array.isArray(log) ? log : [])].slice(0, max)

// "while you were away": what happened since the owner last looked
export const awaySummary = (log = [], unseen = 0) => {
  const fresh = log.slice(0, Math.max(0, Math.min(unseen, log.length)))
  const won = fresh.filter((e) => e.cloneWon).length
  return {
    games: fresh.length,
    won,
    lost: fresh.length - won,
    entries: fresh,
    headline: fresh.length ? `Your clone played ${fresh.length} game${fresh.length === 1 ? "" : "s"} while you were away: ${won} won, ${fresh.length - won} lost.` : "",
  }
}

// the owner's push: "Your clone lost to Sam 7-11 at Los Cab"
export const resultText = ({ by, cloneWon, score, venueName }) => {
  const [c, v] = score
  const at = venueName ? ` at ${venueName}` : ""
  return cloneWon ? `Your clone beat ${by} ${c}-${v}${at}` : `Your clone lost to ${by} ${c}-${v}${at}`
}

// ---- the regulars' day (by the venue's local hour) ----
// keen: how much they want to play; drills: chance a "watch" becomes warming up by a court
export const scheduleFor = (hour) => {
  const h = ((Math.floor(Number(hour) || 0) % 24) + 24) % 24
  if (h >= 6 && h < 11) return { phase: "morning", keen: 0.8, drills: 0.5, line: "Morning drills. Gotta work on those resets." }
  if (h >= 11 && h < 16) return { phase: "midday", keen: 0.6, drills: 0.2, line: "Hot one today. Pace yourself." }
  if (h >= 16 && h < 21) return { phase: "evening", keen: 1.3, drills: 0.1, line: "Evening open play! Courts fill up fast." }
  return { phase: "night", keen: 0.4, drills: 0, line: "Late session? Lights are on." }
}

// ---- the regulars' memory of you (visitor's device) ----
// mem: { met: { regularName: { times, last } }, results: [{ at, won, score, vs }] }
export const emptyMemory = () => ({ met: {}, results: [] })
export const memoryKey = (venueId) => `98ish.pickleball.parkMemory.${String(venueId || "riverside").replace(/[^a-z0-9_-]/gi, "")}`

export const cleanMemory = (m) => {
  const met = {}
  for (const [k, v] of Object.entries(m?.met || {}).slice(0, 60)) if (v && Number.isFinite(v.times)) met[String(k).slice(0, 24)] = { times: Math.min(9999, v.times | 0), last: Number(v.last) || 0 }
  const results = (Array.isArray(m?.results) ? m.results : []).slice(0, 5).map((r) => ({ at: Number(r.at) || 0, won: !!r.won, score: Array.isArray(r.score) ? r.score.slice(0, 2).map((n) => n | 0) : [0, 0], vs: clean(r.vs).slice(0, 30) }))
  return { met, results }
}

// you walked up to a regular: remember it, and what they say
// -> { mem (new), line }
export const meetRegular = (mem, regular, you, now) => {
  const m = cleanMemory(mem)
  const seen = m.met[regular]
  const name = clean(you) || "friend"
  let line
  const last = m.results[0]
  if (!seen) line = `Hi, I'm ${regular}. First time here?`
  else if (last && now - last.at < 3 * 86_400_000) line = last.won ? `${name}! Saw you win ${last.score[0]}-${last.score[1]}${last.vs ? ` against ${last.vs}` : ""}. Nice.` : `${name}! Tough one ${last.score[0]}-${last.score[1]} last time. Rematch?`
  else if (now - seen.last > 7 * 86_400_000) line = `${name}! Haven't seen you in a while.`
  else line = seen.times > 4 ? `${name}, my favorite regular!` : `Hey ${name}, back for more?`
  m.met[regular] = { times: (seen?.times || 0) + 1, last: now }
  return { mem: m, line }
}

// a result to remember (newest first, five kept)
export const rememberResult = (mem, { won, score, vs }, now) => {
  const m = cleanMemory(mem)
  m.results = [{ at: now, won: !!won, score: [score?.[0] | 0, score?.[1] | 0], vs: clean(vs).slice(0, 30) }, ...m.results].slice(0, 5)
  return m
}
