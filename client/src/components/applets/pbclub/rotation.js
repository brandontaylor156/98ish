// Fair doubles rotations for a play session (4 to 32 players, 1 to 8 courts). Pure; players
// are plain ids (strings). A round: { courts: [{ court, teams: [[a, b], [c, d]] }], sitting }.
//
//   nextRound(history, players, { mode, courts, seed, groups, results })
//     mode "mix"   (round robin): everyone sits out as evenly as possible; partners and
//                  opponents repeat as little as possible
//     mode "king"  (king of the court): winners move up a court, losers down, and split up;
//                  the court-1 winners stay; sitting players come in at the bottom court
//     mode "mixed" (two groups, e.g. mixed doubles): each team has one player from each group
//   rounds(players, n, opts) -> n "mix" or "mixed" rounds at once
//   tally(history) -> { sat, partners, opponents } how often each thing happened
//
// Deterministic for a given seed, so every phone at the session shows the same courts.

const rng = (seed) => {
  let s = (Number(seed) >>> 0) || 0x9e3779b9
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s / 4294967296
  }
}
const shuffle = (list, rand) => {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}
const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export const tally = (history = []) => {
  const sat = {}
  const played = {}
  const partners = {}
  const opponents = {}
  for (const round of history) {
    for (const p of round.sitting || []) sat[p] = (sat[p] || 0) + 1
    for (const c of round.courts || []) {
      const [t1, t2] = c.teams
      for (const p of [...t1, ...t2]) played[p] = (played[p] || 0) + 1
      for (const t of [t1, t2]) if (t.length === 2) partners[pair(t[0], t[1])] = (partners[pair(t[0], t[1])] || 0) + 1
      for (const a of t1) for (const b of t2) opponents[pair(a, b)] = (opponents[pair(a, b)] || 0) + 1
    }
  }
  return { sat, played, partners, opponents }
}

// who sits this round: those who've sat least (and played most), the order shuffled by seed
const chooseSitting = (players, playing, t, rand) => {
  const sitCount = players.length - playing
  if (sitCount <= 0) return []
  const order = shuffle(players, rand).sort((a, b) => (t.sat[a] || 0) - (t.sat[b] || 0) || (t.played[b] || 0) - (t.played[a] || 0))
  return order.slice(0, sitCount)
}

const costOf = (courts, t, groups) => {
  let cost = 0
  for (const [t1, t2] of courts) {
    for (const team of [t1, t2]) {
      cost += 10 * (t.partners[pair(team[0], team[1])] || 0) ** 2
      if (groups && groups[team[0]] === groups[team[1]]) cost += 1000
    }
    for (const a of t1) for (const b of t2) cost += 2 * (t.opponents[pair(a, b)] || 0)
  }
  return cost
}

// split players (a multiple of 4) into courts of [[a, b], [c, d]], trying shuffles for the
// lowest repeat cost
const bestCourts = (on, t, rand, { tries = 300, groups = null } = {}) => {
  let best = null
  let bestCost = Infinity
  for (let i = 0; i < tries; i++) {
    const s = shuffle(on, rand)
    const courts = []
    for (let c = 0; c + 3 < s.length; c += 4) courts.push([[s[c], s[c + 1]], [s[c + 2], s[c + 3]]])
    if (groups) {
      // make each team one from each group where possible
      for (const court of courts) {
        const four = [...court[0], ...court[1]]
        const a = four.filter((p) => groups[p] === "A")
        const b = four.filter((p) => groups[p] !== "A")
        if (a.length === 2 && b.length === 2) {
          court[0] = [a[0], b[0]]
          court[1] = [a[1], b[1]]
        }
      }
    }
    const cost = costOf(courts, t, groups)
    if (cost < bestCost) {
      best = courts
      bestCost = cost
      if (cost === 0) break
    }
  }
  return best || []
}

const asRound = (courts, sitting) => ({ courts: courts.map((teams, i) => ({ court: i + 1, teams })), sitting })

const mixRound = (history, players, { courts = 1, seed = 1, groups = null } = {}) => {
  const rand = rng(seed + history.length * 7919)
  const t = tally(history)
  const playing = Math.min(courts * 4, Math.floor(players.length / 4) * 4)
  let sitting = chooseSitting(players, playing, t, rand)
  if (groups) {
    // keep the groups even on court: as many A's as B's playing
    const on = players.filter((p) => !sitting.includes(p))
    const a = on.filter((p) => groups[p] === "A").length
    const b = on.length - a
    if (a !== b) {
      const more = a > b ? "A" : "B"
      const fewer = more === "A" ? "B" : "A"
      let swaps = Math.floor(Math.abs(a - b) / 2)
      const benchFewer = sitting.filter((p) => (groups[p] === "A" ? "A" : "B") === fewer)
      const onMore = on.filter((p) => (groups[p] === "A" ? "A" : "B") === more).sort((x, y) => (t.sat[x] || 0) - (t.sat[y] || 0))
      while (swaps-- > 0 && benchFewer.length && onMore.length) {
        const inP = benchFewer.shift()
        const outP = onMore.pop()
        sitting = [...sitting.filter((p) => p !== inP), outP]
      }
    }
  }
  const on = players.filter((p) => !sitting.includes(p))
  return asRound(bestCourts(on, t, rand, { groups }), sitting)
}

// king of the court: results[i] = 0 | 1, the winning team on court i+1 of the last round
const kingRound = (history, players, { courts = 1, seed = 1, results = [] } = {}) => {
  const last = history[history.length - 1]
  if (!last) return mixRound(history, players, { courts, seed })
  const rand = rng(seed + history.length * 104729)
  const n = last.courts.length
  // each court gets two pairs (who came up, who came down); the top court's winners stay and
  // the bottom court's losers stay
  const slots = Array.from({ length: n }, () => [])
  last.courts.forEach((c, i) => {
    const w = results[i] === 1 ? 1 : 0
    slots[Math.max(0, i - 1)].push([...c.teams[w]])
    slots[Math.min(n - 1, i + 1)].push([...c.teams[1 - w]])
  })
  // people who sat (or just arrived) come in at the bottom court, replacing whoever has sat
  // least there; people who left are dropped
  const present = new Set(players)
  const sitting = shuffle(
    players.filter((p) => !last.courts.some((c) => c.teams.flat().includes(p))),
    rand
  )
  const t = tally(history)
  const bottom = slots[n - 1]
  const swapped = new Set()
  for (const p of sitting) {
    const candidates = bottom
      .flat()
      .filter((q) => !swapped.has(q) && present.has(q))
      .sort((a, b) => (t.sat[a] || 0) - (t.sat[b] || 0) || a.localeCompare(b))
    const leave = candidates[0]
    if (!leave) break
    swapped.add(p)
    for (const pr of bottom) {
      const i = pr.indexOf(leave)
      if (i >= 0) pr[i] = p
    }
  }
  const courtsOut = []
  for (const [a = [], b = []] of slots) {
    const pa = a.filter((p) => present.has(p))
    const pb = b.filter((p) => present.has(p))
    // split the pairs: one from each pair on each team
    if (pa.length === 2 && pb.length === 2) courtsOut.push([[pa[0], pb[0]], [pa[1], pb[1]]])
  }
  const placed = new Set(courtsOut.flat(2))
  return asRound(courtsOut, players.filter((p) => !placed.has(p)))
}

export const nextRound = (history, players, opts = {}) => {
  const list = [...new Set(players)].filter(Boolean)
  if (list.length < 4) return { courts: [], sitting: list }
  if (opts.mode === "king") return kingRound(history || [], list, opts)
  return mixRound(history || [], list, { ...opts, groups: opts.mode === "mixed" ? opts.groups || {} : null })
}

export const rounds = (players, n, opts = {}) => {
  const out = []
  for (let i = 0; i < n; i++) out.push(nextRound(out, players, opts))
  return out
}
