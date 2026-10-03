// Pickleball 98: the rules (USA Pickleball Official Rulebook): line calls, the serve, the
// two-bounce rule, the non-volley zone ("kitchen"), faults, and scoring (side-out for
// singles and doubles, rally scoring as an option). Pure JavaScript, no three.js.
//
// Teams: 0 plays the z > 0 half (you), 1 plays z < 0. A team's "right" court is on its
// own right as it faces the net: x > 0 for team 0, x < 0 for team 1.

import { BALL_R, HALF_L, HALF_W, KITCHEN, LINE_W } from "./physics.js"

export const sideOf = (team) => (team === 0 ? 1 : -1) // which half (sign of z) a team plays
export const teamOnSide = (z) => (z > 0 ? 0 : 1)
export const other = (team) => 1 - team
// x sign of a team's right-hand court
export const rightSign = (team) => (team === 0 ? 1 : -1)

// ---- line calls ----

// A ball is in if it touches any part of a line (lines belong to the court). `x, z` is
// where the ball touched down; the ball's contact patch on a hard court is a few mm, so the
// call is made on the touch point.
export const inCourt = (x, z) => Math.abs(x) <= HALF_W && Math.abs(z) <= HALF_L

// Which half of the court a point is on, and whether it's in the bounds of that half
export const inHalf = (x, z, team) => inCourt(x, z) && Math.sign(z) === sideOf(team)

// The service court a serve must land in: diagonally across, the receiving team's court on
// the same named side ("right" or "left") as the server's. The non-volley zone line is
// part of the kitchen, so a serve touching it is short (a fault); the centerline,
// sideline and baseline count as in.
export const inServiceCourt = (x, z, receivingTeam, court) => {
  if (!inHalf(x, z, receivingTeam)) return false
  if (Math.abs(z) <= KITCHEN) return false // in the kitchen or on its line
  const right = rightSign(receivingTeam)
  const want = court === "right" ? right : -right
  // the 2 in centerline is centered on x = 0 and belongs to both service courts
  return x * want >= -LINE_W / 2
}

// A player is in the kitchen if a foot is in it or on its line (the area between the net
// and the far edge of the NVZ line, sideline to sideline)
export const FOOT_R = 0.13 // a shoe, measured from the player's center point
export const inKitchen = (x, z) => Math.abs(z) - FOOT_R <= KITCHEN && Math.abs(x) - FOOT_R <= HALF_W

// The serve: an underhand stroke. The rulebook's volley-serve requirements, checked from
// the contact: the arm moves in an upward arc, the paddle contacts the ball below the
// server's waist (navel), and the paddle head is not above the highest part of the wrist.
// Feet: at least one behind the baseline, none touching it or the court, and within the
// imaginary extensions of the centerline and sideline.
export const serveFaults = ({ contactY, waistY, paddleVy, headBelowWrist = true, x, z, team, court }) => {
  const faults = []
  if (contactY > waistY) faults.push("Serve contact above the waist")
  if (paddleVy <= 0) faults.push("Serve must swing upward")
  if (!headBelowWrist) faults.push("Paddle head above the wrist")
  if (z !== undefined && Math.abs(z) - FOOT_R < HALF_L) faults.push("Foot fault")
  if (x !== undefined && court) {
    const right = rightSign(team)
    const want = court === "right" ? right : -right
    if (x * want < 0 || Math.abs(x) > HALF_W) faults.push("Served from the wrong court")
  }
  return faults
}

// ---- scoring ----
// players: [[a, b], [c, d]] (doubles) or [[a], [c]] (singles): ids, in the order of the
// court they start in (right first)

export const createGame = ({ doubles = true, scoring = "sideout", target = 11, firstServer = 0, players } = {}) => {
  const teams = players || (doubles ? [["A1", "A2"], ["B1", "B2"]] : [["A1"], ["B1"]])
  const g = {
    doubles,
    scoring,
    target,
    score: [0, 0],
    serving: firstServer,
    // side-out doubles: the first serve of the game is "0-0-2" (that team only gets one server)
    serverNumber: doubles && scoring === "sideout" ? 2 : 1,
    // court[team] = { right: id, left: id }
    court: teams.map((t) => (t.length > 1 ? { right: t[0], left: t[1] } : { right: t[0], left: t[0] })),
    server: teams[firstServer][0],
    winner: null,
    rallies: 0,
  }
  if (!doubles || scoring === "rally") g.server = serverByParity(g, firstServer)
  return g
}

// In singles (and rally-scoring doubles) the server stands in the right court on an even
// score and the left court on an odd score
const serverByParity = (g, team) => {
  const even = g.score[team] % 2 === 0
  return even ? g.court[team].right : g.court[team].left
}

export const courtOf = (g, id) => {
  for (const team of [0, 1]) {
    if (g.court[team].right === id && g.court[team].left === id) {
      // singles: one player covers both courts; their score says where they stand
      return g.score[team] % 2 === 0 ? "right" : "left"
    }
    if (g.court[team].right === id) return "right"
    if (g.court[team].left === id) return "left"
  }
  return null
}
export const teamOf = (g, id) => (g.court[0].right === id || g.court[0].left === id ? 0 : 1)

// The court the server serves from, and who must receive (diagonally across)
export const serverCourt = (g) => {
  if (!g.doubles) return g.score[g.serving] % 2 === 0 ? "right" : "left"
  return courtOf(g, g.server)
}
export const receiver = (g) => g.court[other(g.serving)][serverCourt(g)]

// The official score call. Side-out doubles: "serving score - receiving score - server
// number" (the first serve of a game is "0-0-2"). Singles and rally scoring: two numbers.
export const scoreCall = (g) => {
  const s = g.score[g.serving]
  const r = g.score[other(g.serving)]
  if (g.winner !== null) return `Game: ${g.score[g.winner]}-${g.score[other(g.winner)]}`
  if (g.doubles && g.scoring === "sideout") return `${s}-${r}-${g.serverNumber}`
  return `${s}-${r}`
}

const checkWinner = (g) => {
  for (const team of [0, 1]) {
    if (g.score[team] >= g.target && g.score[team] - g.score[other(team)] >= 2) g.winner = team
  }
}

const swapCourts = (g, team) => {
  const c = g.court[team]
  g.court[team] = { right: c.left, left: c.right }
}

// Who won the rally: updates the score, the server and the players' courts. Returns what
// happened: "point", "second-server" or "side-out".
export const rallyWon = (g, team) => {
  if (g.winner !== null) return null
  g.rallies++
  if (g.scoring === "rally") {
    // every rally scores. The serving team's server switches courts and serves again;
    // a side out gives the serve to the other team's player standing in the court that
    // matches their score (right on even).
    g.score[team]++
    checkWinner(g)
    if (team === g.serving) {
      if (g.doubles) swapCourts(g, team)
      g.server = g.doubles ? g.court[team][g.score[team] % 2 === 0 ? "right" : "left"] : g.court[team].right
      return "point"
    }
    g.serving = team
    g.serverNumber = 1
    // the player standing in the court that matches their score (right on even) serves
    g.server = g.doubles ? g.court[team][g.score[team] % 2 === 0 ? "right" : "left"] : g.court[team].right
    return "side-out"
  }
  // side-out scoring: only the serving team scores
  if (team === g.serving) {
    g.score[team]++
    checkWinner(g)
    if (g.doubles) swapCourts(g, team) // the server and partner switch courts; same server
    return "point"
  }
  if (g.doubles && g.serverNumber === 1) {
    g.serverNumber = 2
    const partner = g.court[g.serving].right === g.server ? g.court[g.serving].left : g.court[g.serving].right
    g.server = partner // serves from wherever the partner is standing
    return "second-server"
  }
  // side out: the other team's player in the right court starts serving, as server 1
  g.serving = team
  g.serverNumber = 1
  g.server = g.court[team].right
  return "side-out"
}

// ---- the referee for one rally ----
// Feed it what happens (hits, bounces, net, players' feet) and it calls the fault.
// A result: { fault: team that lost the rally, reason, call (short on-screen call) }.

export const MOMENTUM_S = 1.2 // after a volley, a player has this long to regain balance

export const createRally = (g) => ({
  serving: g.serving,
  server: g.server,
  court: serverCourt(g),
  receiver: receiver(g),
  hits: 0, // shots so far (1 = the serve)
  lastTeam: null,
  lastPlayer: null,
  bounces: 0, // bounces since the last hit
  bounceSide: 0, // the side (sign of z) of those bounces
  over: null, // the result once the rally is decided
  pending: null, // a decided rally that a player's momentum could still change
  watch: new Map(), // player id -> seconds left in their volley momentum
  t: 0,
})

const end = (rally, faultTeam, reason, call) => {
  const result = { fault: faultTeam, winner: other(faultTeam), reason, call: call || reason }
  // a volleying player still carried by their momentum can turn this rally around:
  // hold the result until every watch on the winning team runs out
  rally.pending = result
  return result
}

// The final word: once no momentum is in play, the pending result stands
export const settle = (rally) => {
  if (rally.over) return rally.over
  if (!rally.pending) return null
  for (const [, w] of rally.watch) if (w.team === rally.pending.winner && w.left > 0) return null
  rally.over = rally.pending
  return rally.over
}

export const isLive = (rally) => !rally.pending && !rally.over

// A player hits the ball. hit: { player, team, x, z (feet), volley (no bounce since the
// other team's hit), serve: { contactY, waistY, paddleVy, headBelowWrist } (on the serve) }
export const refHit = (rally, hit) => {
  if (!isLive(rally)) return null
  const { player, team } = hit
  if (rally.hits === 0) {
    if (player !== rally.server) return end(rally, team, "Wrong server", "Fault: wrong server")
    if (hit.serve) {
      const faults = serveFaults({ ...hit.serve, x: hit.x, z: hit.z, team, court: rally.court })
      if (faults.length) return end(rally, team, faults[0], `Fault: ${faults[0].toLowerCase()}`)
    }
  } else {
    if (rally.lastTeam === team) {
      return end(rally, team, rally.lastPlayer === player ? "Double hit" : "Both partners hit it", "Fault")
    }
    // in doubles, only the player diagonally across may return the serve
    if (rally.hits === 1 && player !== rally.receiver) return end(rally, team, "Wrong receiver", "Fault: wrong receiver")
    const volley = rally.bounces === 0
    // the two-bounce rule: the serve must bounce before the return, and the return must
    // bounce before the serving team's third shot. Volleys are allowed after that.
    if (volley && rally.hits < 3) {
      return end(rally, team, "Two-bounce rule", "Fault: let it bounce!")
    }
    if (volley && inKitchen(hit.x, hit.z)) {
      return end(rally, team, "Volley in the kitchen", "Fault: kitchen!")
    }
    if (volley) rally.watch.set(player, { team, left: MOMENTUM_S })
  }
  rally.hits++
  rally.lastTeam = team
  rally.lastPlayer = player
  rally.bounces = 0
  rally.bounceSide = 0
  return null
}

// The ball touched the court at (x, z)
export const refBounce = (rally, x, z) => {
  if (!isLive(rally)) return null
  const side = Math.sign(z) || 1
  const hitter = rally.lastTeam
  if (hitter === null) return null
  const hitterSide = sideOf(hitter)
  if (rally.bounces === 0) {
    rally.bounces = 1
    rally.bounceSide = side
    if (side === hitterSide) return end(rally, hitter, "Didn't clear the net", "Net")
    if (rally.hits === 1) {
      // the serve
      if (!inServiceCourt(x, z, other(hitter), rally.court)) {
        const short = Math.abs(z) <= KITCHEN && inCourt(x, z)
        return end(rally, hitter, short ? "Serve in the kitchen" : "Serve out", short ? "Short!" : "Out!")
      }
      return null
    }
    if (!inCourt(x, z)) return end(rally, hitter, "Out", "Out!")
    return null
  }
  // a second bounce: the team it first bounced in front of didn't get it back
  rally.bounces++
  return end(rally, teamOnSide(rally.bounceSide), "Double bounce", "Two bounces")
}

// The ball went somewhere it can't come back from (into the fence, under the net...)
export const refDead = (rally, faultTeam, reason) => (isLive(rally) ? end(rally, faultTeam, reason) : null)

// Players' feet, every step: volley momentum into the kitchen is a fault (even after the
// ball is dead), and a watch ends early once the player has stopped
export const refFeet = (rally, player, team, x, z, speed, dt) => {
  const w = rally.watch.get(player)
  if (!w || w.left <= 0 || rally.over) return null
  if (inKitchen(x, z)) {
    w.left = 0
    if (rally.pending && rally.pending.winner !== team) return null // they'd lost anyway
    // the volley stands as a fault, whatever happened to the ball since
    rally.pending = { fault: team, winner: other(team), reason: "Momentum into the kitchen", call: "Fault: kitchen!" }
    return rally.pending
  }
  w.left -= dt
  if (speed < 0.35) w.left = Math.min(w.left, 0.15) // balanced again
  return null
}

// Short line call for close bounces ("IN" when it clipped a line)
export const lineCall = (x, z) => {
  const nearSide = Math.abs(Math.abs(x) - HALF_W) < LINE_W + BALL_R
  const nearBase = Math.abs(Math.abs(z) - HALF_L) < LINE_W + BALL_R
  if (!nearSide && !nearBase) return null
  return inCourt(x, z) ? "In" : "Out"
}
