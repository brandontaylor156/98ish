// My Park: who plays next on a court (pure; Node-tested). Paddle stacking, the way open play
// works at a public park: you put your paddle in the court's rack, and when the game on
// court ends the next four paddles go on. Visitors (real people) go ahead of the park's
// regulars, who are happy to wait.
//
// Rotation after a game, by how many are waiting:
//   4 or more: everyone off, the next four on (4 off, 4 on)
//   2 or 3:    the winners stay, the losers go off, two of the waiting come on
//   1:         the winners stay; the one waiting comes on with the loser who has sat
//              out least recently (the other loser sits out)
//   0:         the same four play again, partners switched
// An entry: { id, kind: "ai" | "human", ...anything }. A line-up is four entries, the first
// two one team (team 0), the last two the other.

export const MAX_STACK = 12

// the queue in order: people (kind "human") first, each group in the order they came
export const ordered = (queue) => [...queue.filter((e) => e.kind === "human"), ...queue.filter((e) => e.kind !== "human")]

// put a paddle in the rack: -> { queue, position (0 = next), added }
export const callNext = (queue, entry) => {
  const at = queue.findIndex((e) => e.id === entry.id)
  if (at >= 0) return { queue, position: ordered(queue).findIndex((e) => e.id === entry.id), added: false }
  if (queue.length >= MAX_STACK) return { queue, position: -1, added: false }
  const next = [...queue, { ...entry }]
  return { queue: next, position: ordered(next).findIndex((e) => e.id === entry.id), added: true }
}
export const leaveQueue = (queue, id) => queue.filter((e) => e.id !== id)
export const positionOf = (queue, id) => ordered(queue).findIndex((e) => e.id === id)

// games until someone's turn (0: they're on next), given the queue and who is on court
export const gamesUntil = (queue, id) => {
  const pos = positionOf(queue, id)
  if (pos < 0) return -1
  // four come on per game when four wait; fewer wait, two come on
  return Math.floor(pos / 4)
}

// mix two people onto opposite teams when there are two (the online room seats people on
// alternate sides), otherwise keep the order
const spread = (four) => {
  const humans = four.filter((e) => e.kind === "human")
  if (humans.length !== 2) return four
  const ai = four.filter((e) => e.kind !== "human")
  return [humans[0], ai[0], humans[1], ai[1]].filter(Boolean)
}

// -> { on: [4 entries: team 0 then team 1], off: [entries leaving], queue: what's left }
// onCourt: the four who just played (team 0 first); winner: 0 | 1 | null
export const nextLineup = (onCourt, queue, winner = null) => {
  const q = ordered(queue)
  const won = winner === null ? onCourt.slice(0, 2) : winner === 0 ? onCourt.slice(0, 2) : onCourt.slice(2, 4)
  const lost = winner === null ? onCourt.slice(2, 4) : winner === 0 ? onCourt.slice(2, 4) : onCourt.slice(0, 2)
  if (q.length >= 4) {
    const on = spread(q.slice(0, 4))
    return { on, off: [...onCourt], queue: q.slice(4) }
  }
  if (q.length >= 2) {
    const coming = q.slice(0, 2)
    // winners split up and take one of the new players each
    const on = spread([won[0], coming[0], won[1], coming[1]])
    return { on, off: [...lost], queue: q.slice(2) }
  }
  if (q.length === 1) {
    // the loser who came on most recently sits out (sat: when they last sat out; lower = longer ago)
    const keep = [...lost].sort((a, b) => (a.sat ?? -1) - (b.sat ?? -1))
    const stays = keep[0]
    const sits = keep[1]
    const on = spread([won[0], q[0], won[1], stays])
    return { on, off: [sits], queue: [] }
  }
  // nobody waiting: switch partners
  const all = [...won, ...lost]
  return { on: [all[0], all[2], all[1], all[3]], off: [], queue: [] }
}
