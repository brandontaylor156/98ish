// Craps: the bets and what each roll of two dice does to them. Pure functions of a table
// state { point, bets }; roll() returns the new state plus what was won and lost.
//
// Bets (each { kind, amount, number? }):
//   pass / dontpass       the line bets, made on a come-out roll (no point)
//   passodds / dontodds   behind the line once there's a point: true odds, no house edge
//   come / dontcome       like the line bets, made while there's a point; they travel to the
//                         next number rolled (and then have number set), where they can take
//                         odds (comeodds / dontcomeodds with that number)
//   field                 one roll: 3, 4, 9, 10, 11 pay even money, 2 pays double, 12 triple
//   place                 number 4, 5, 6, 8, 9 or 10 before a 7 (9:5, 7:5, 7:6); they're "off"
//                         (neither win nor lose) on come-out rolls
// Odds are capped at 3x on 4/10, 4x on 5/9 and 5x on 6/8 of the line or come bet.

export const POINTS = [4, 5, 6, 8, 9, 10]
// true odds: payout per unit
export const ODDS = { 4: [2, 1], 10: [2, 1], 5: [3, 2], 9: [3, 2], 6: [6, 5], 8: [6, 5] }
export const PLACE = { 4: [9, 5], 10: [9, 5], 5: [7, 5], 9: [7, 5], 6: [7, 6], 8: [7, 6] }
export const MAX_ODDS = { 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 }
export const FIELD = { 2: 2, 3: 1, 4: 1, 9: 1, 10: 1, 11: 1, 12: 3 }

export const newTable = () => ({ point: null, bets: [], history: [] })

const win = (amount, [num, den]) => Math.floor((amount * num) / den)
const same = (a, b) => a.kind === b.kind && (a.number ?? null) === (b.number ?? null)

// the most odds a line or come bet allows
export const maxOdds = (state, kind, number = null) => {
  if (kind === "passodds" || kind === "dontodds") {
    if (!state.point) return 0
    const line = state.bets.find((b) => b.kind === (kind === "passodds" ? "pass" : "dontpass"))
    if (!line) return 0
    // don't odds are laid: the cap is on the win, so the stake can be bigger
    const cap = line.amount * MAX_ODDS[state.point]
    return kind === "dontodds" ? Math.floor((cap * ODDS[state.point][0]) / ODDS[state.point][1]) : cap
  }
  if (kind === "comeodds" || kind === "dontcomeodds") {
    const base = state.bets.find((b) => b.kind === (kind === "comeodds" ? "come" : "dontcome") && b.number === number)
    if (!base) return 0
    const cap = base.amount * MAX_ODDS[number]
    return kind === "dontcomeodds" ? Math.floor((cap * ODDS[number][0]) / ODDS[number][1]) : cap
  }
  return Infinity
}

// put chips on a bet (adds to one already there) -> new state, or { error }
export const placeBet = (state, bet) => {
  const { kind, amount } = bet
  const number = bet.number ?? null
  if (!(amount > 0) || !Number.isInteger(amount)) return { error: "Pick a chip first." }
  const on = !!state.point
  if ((kind === "pass" || kind === "dontpass") && on) return { error: "Line bets go down before the come-out roll." }
  if ((kind === "come" || kind === "dontcome") && !on) return { error: "Come bets are for after the point is set. Bet the Pass Line now." }
  if (kind === "place" && !POINTS.includes(number)) return { error: "Place bets go on 4, 5, 6, 8, 9 or 10." }
  if (kind.endsWith("odds")) {
    const have = state.bets.find((b) => same(b, { kind, number }))?.amount || 0
    const max = maxOdds(state, kind, number)
    if (max === 0) return { error: kind.startsWith("dont") ? "Odds go behind a Don't bet once it has a point." : "Odds go behind a Pass or Come bet once it has a point." }
    if (have + amount > max) return { error: `The most odds here is ${max}.` }
  }
  if (!["pass", "dontpass", "passodds", "dontodds", "come", "dontcome", "comeodds", "dontcomeodds", "field", "place"].includes(kind)) return { error: "That isn't a bet." }
  const bets = state.bets.map((b) => ({ ...b }))
  const existing = bets.find((b) => same(b, { kind, number }) && !(kind === "come" || kind === "dontcome"))
  if (existing) existing.amount += amount
  else bets.push({ kind, amount, number: number ?? (kind === "come" || kind === "dontcome" ? null : undefined) })
  return { ...state, bets: bets.map(tidy) }
}

const tidy = (b) => {
  const out = { kind: b.kind, amount: b.amount }
  if (b.number != null) out.number = b.number
  return out
}

// take chips back (only the bets you may take down: not a pass/come bet with a point)
export const canRemove = (state, bet) => {
  if ((bet.kind === "pass" || bet.kind === "come") && (bet.kind === "pass" ? state.point : bet.number)) return false
  return true
}
export const removeBet = (state, index) => {
  const bet = state.bets[index]
  if (!bet) return { error: "No bet there." }
  if (!canRemove(state, bet)) return { error: "Contract bets stay up until they win or lose." }
  // the odds go with a don't bet you take down
  const linked = (b) => (bet.kind === "dontpass" && b.kind === "dontodds") || (bet.kind === "dontcome" && b.kind === "dontcomeodds" && b.number === bet.number)
  const removed = state.bets.filter((b, i) => i === index || linked(b))
  return { state: { ...state, bets: state.bets.filter((b, i) => i !== index && !linked(b)) }, refund: removed.reduce((s, b) => s + b.amount, 0) }
}

// roll the dice: [d1, d2] -> { state, results: [{ bet, outcome: "win"|"lose"|"push"|"move", returned }], returned }
export const resolve = (state, dice) => {
  const total = dice[0] + dice[1]
  const comeOut = !state.point
  const results = []
  const keep = []
  const settle = (bet, outcome, returned) => results.push({ bet, outcome, returned })
  // come / don't come bets travel first, then the rest
  for (const bet of state.bets) {
    const b = { ...bet }
    switch (b.kind) {
      case "pass":
        if (comeOut) {
          if (total === 7 || total === 11) settle(b, "win", b.amount * 2)
          else if ([2, 3, 12].includes(total)) settle(b, "lose", 0)
          else keep.push(b)
        } else if (total === state.point) settle(b, "win", b.amount * 2)
        else if (total === 7) settle(b, "lose", 0)
        else keep.push(b)
        break
      case "dontpass":
        if (comeOut) {
          if (total === 2 || total === 3) settle(b, "win", b.amount * 2)
          else if (total === 12) keep.push(b) // bar 12: a push, the bet stays
          else if (total === 7 || total === 11) settle(b, "lose", 0)
          else keep.push(b)
        } else if (total === 7) settle(b, "win", b.amount * 2)
        else if (total === state.point) settle(b, "lose", 0)
        else keep.push(b)
        break
      case "passodds":
        if (total === state.point) settle(b, "win", b.amount + win(b.amount, ODDS[state.point]))
        else if (total === 7) settle(b, "lose", 0)
        else keep.push(b)
        break
      case "dontodds":
        if (total === 7) settle(b, "win", b.amount + win(b.amount, [ODDS[state.point][1], ODDS[state.point][0]]))
        else if (total === state.point) settle(b, "lose", 0)
        else keep.push(b)
        break
      case "come":
        if (b.number == null) {
          if (total === 7 || total === 11) settle(b, "win", b.amount * 2)
          else if ([2, 3, 12].includes(total)) settle(b, "lose", 0)
          else {
            b.number = total
            results.push({ bet: { ...b }, outcome: "move", returned: 0 })
            keep.push(b)
          }
        } else if (total === b.number) settle(b, "win", b.amount * 2)
        else if (total === 7) settle(b, "lose", 0)
        else keep.push(b)
        break
      case "dontcome":
        if (b.number == null) {
          if (total === 2 || total === 3) settle(b, "win", b.amount * 2)
          else if (total === 12) keep.push(b)
          else if (total === 7 || total === 11) settle(b, "lose", 0)
          else {
            b.number = total
            results.push({ bet: { ...b }, outcome: "move", returned: 0 })
            keep.push(b)
          }
        } else if (total === 7) settle(b, "win", b.amount * 2)
        else if (total === b.number) settle(b, "lose", 0)
        else keep.push(b)
        break
      case "comeodds":
        // off on the come-out roll: a 7 then returns them, the number still wins
        if (total === b.number) settle(b, comeOut ? "push" : "win", comeOut ? b.amount : b.amount + win(b.amount, ODDS[b.number]))
        else if (total === 7) settle(b, comeOut ? "push" : "lose", comeOut ? b.amount : 0)
        else keep.push(b)
        break
      case "dontcomeodds":
        if (total === 7) settle(b, "win", b.amount + win(b.amount, [ODDS[b.number][1], ODDS[b.number][0]]))
        else if (total === b.number) settle(b, "lose", 0)
        else keep.push(b)
        break
      case "field":
        if (FIELD[total]) settle(b, "win", b.amount + b.amount * FIELD[total])
        else settle(b, "lose", 0)
        break
      case "place":
        if (comeOut) keep.push(b) // off
        else if (total === b.number) {
          // a place bet that wins pays and stays up
          settle(b, "win", win(b.amount, PLACE[b.number]))
          keep.push(b)
        } else if (total === 7) settle(b, "lose", 0)
        else keep.push(b)
        break
      default:
        keep.push(b)
    }
  }
  let point = state.point
  if (comeOut && POINTS.includes(total)) point = total
  else if (!comeOut && (total === 7 || total === state.point)) point = null
  const returned = results.reduce((s, r) => s + r.returned, 0)
  const history = [...(state.history || []), dice].slice(-12)
  return { state: { point, bets: keep.map(tidy), history }, results, returned, total }
}

export const rollDice = (random = Math.random) => [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)]

export const LABELS = { pass: "Pass Line", dontpass: "Don't Pass", passodds: "Pass Odds", dontodds: "Don't Pass Odds", come: "Come", dontcome: "Don't Come", comeodds: "Come Odds", dontcomeodds: "Don't Come Odds", field: "Field", place: "Place" }
export const describeBet = (b) => `${LABELS[b.kind]}${b.number ? ` ${b.number}` : ""}`
export const onTable = (state) => state.bets.reduce((s, b) => s + b.amount, 0)
