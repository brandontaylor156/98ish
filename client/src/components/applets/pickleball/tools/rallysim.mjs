// Pickleball 98: AI-vs-AI rally statistics, for comparing the game against real pro numbers
// (docs/pickleball-physics.md). Pure Node, deterministic per seed.
//
//   node client/src/components/applets/pickleball/tools/rallysim.mjs [level] [games] [singles]
//   (level: beginner | intermediate | pro | legend | all; games per level, default 6)
//
// What it measures, per level: shots per rally (the PPA stats wraps count every shot,
// serve included), the shot mix, launch speeds by shot (mph), third shots (drop vs drive)
// and what follows a third-shot drive, serve and return depth, how high balls bounce,
// and how rallies end (into the net, long, wide, kitchen, winners...).
import { createMatch, step } from "../match.js"
import { HALF_L, HALF_W, BALL_R, netHeightAt } from "../physics.js"

const MPH = 2.23694

// A shot's kind as a camera sees it (docs/ppa-reference.md): the same rule classifies the PPA
// footage's measured flights and the game's own shots, so the two compare like for like.
// idx: 0 serve, 1 return, 2 third; mph; hitterZ: the hitter's distance from the net (m);
// y: contact height (m); apex: the flight's highest point (m); landZ: where it first lands,
// distance from the net (m), null if it was played out of the air.
export const observedKind = ({ idx, mph, hitterZ, y, apex, landZ }) => {
  if (idx === 0) return "serve"
  if (idx === 1) return "return"
  if (apex > 3.4) return "lob"
  if (y > 1.75 && mph > 33) return "overhead"
  if (idx === 2) return (landZ !== null && landZ < 3.4) || mph < 31 ? "third drop" : "third drive"
  if (hitterZ < 3.3) return mph < 21 ? "dink" : mph >= 33 ? "fast at net" : "firm at net"
  return mph < 29 ? "soft from back" : "drive"
}

const pct =(a, q) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]
}
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10)
const r2 = (v) => (v === null || v === undefined ? null : Math.round(v * 100) / 100)

export const simulate = ({ level = "pro", games = 6, seed0 = 1, doubles = true, scoring = "rally", target = 11, ball, maxSteps = 240 * 60 * 40 } = {}) => {
  const rallies = []
  const dinkCounts = []
  const contactAfter = {}
  let attackRallies = 0
  let attackWins = 0
  let attacks = 0
  const kinds = {}
  const speeds = {}
  const bounceH = {}
  const ends = {}
  const third = {}
  const fifthAfterDrive = {}
  const serveDepth = []
  const returnDepth = []
  const serveSpeed = []
  const driveFlight = []
  let serves = 0
  let serveFaults = 0
  let steps = 0
  // timing and movement (docs/ppa-reference.md compares these with PPA Tour footage)
  const gaps = {} // seconds from one hit to the next, by the shot hit first ("serve" = serve -> return)
  const gapAll = []
  const rallySec = [] // first hit -> rally decided
  const betweenSec = [] // rally decided -> next serve struck
  const flight = {} // seconds from the hit to its first bounce, by shot
  const apexH = {} // the highest point of each shot's flight (m)
  const netClear = {} // height over the net tape where it crossed (m)
  const kitchenRet = [] // returning team's returner: seconds from their return to being at the line
  const kitchenSrv = [] // serving team: seconds from the serve to the first of them at the line
  const peakSpeed = [] // each player's fastest moment in a rally (m/s)
  const peakAcc = [] // and hardest acceleration (m/s^2, 0.1 s smoothing)
  const reaction = [] // after an opponent's hit: seconds until a player first moves > 1.1 m/s
  const depthAt = {} // distance from the net of the serving / returning team at shots 1..6
  const LINE = 2.13 + 0.6
  const observed = {} // by observedKind: mph, clear, apex, flight (to the first bounce), gap (to the next hit), y, land
  let lastDecided = null
  let flightWatch = null // { kind, t0, apex, crossed }
  for (let g = 0; g < games; g++) {
    const roster = doubles
      ? [0, 1].flatMap((team) => [1, 2].map((k) => ({ id: `t${team}p${k}`, team, ctrl: "cpu", level, name: `P${team}${k}` })))
      : [0, 1].map((team) => ({ id: `t${team}`, team, ctrl: "cpu", level, name: `P${team}` }))
    const m = createMatch({ doubles, level, scoring, target, seed: seed0 + g * 7919, roster, ...(ball ? { ball } : {}) })
    let shots = []
    let bounceWatch = null // { kind, apex }
    let n = 0
    // per player: speed samples every 0.1 s for acceleration, the reaction watch
    const mv = Object.fromEntries(m.players.map((p) => [p.id, { lastV: null, lastT: 0, peakV: 0, peakA: 0, react: null }]))
    let kitchenWatch = null // { tRet, retId, tServe, servingTeam, retDone, srvDone }
    while (m.phase !== "over" && n < maxSteps) {
      const prevZ = m.ball.p.z
      step(m)
      n++
      if (bounceWatch && m.ball.v.y >= 0) bounceWatch.apex = Math.max(bounceWatch.apex, m.ball.p.y + BALL_R)
      if (flightWatch && !m.ball.held) {
        flightWatch.apex = Math.max(flightWatch.apex, m.ball.p.y)
        if (!flightWatch.crossed && Math.sign(prevZ) !== Math.sign(m.ball.p.z) && prevZ !== 0) {
          flightWatch.crossed = true
          const clear = m.ball.p.y - BALL_R - netHeightAt(m.ball.p.x)
          ;(netClear[flightWatch.kind] ||= []).push(clear)
          if (flightWatch.shot) flightWatch.shot.clear = clear
        }
      }
      if (m.phase === "rally" && shots.length) {
        for (const p of m.players) {
          const s = mv[p.id]
          const v = Math.hypot(p.vx, p.vz)
          if (v > s.peakV) s.peakV = v
          if (m.t - s.lastT >= 0.1) {
            if (s.lastV !== null) s.peakA = Math.max(s.peakA, Math.abs(v - s.lastV) / (m.t - s.lastT))
            s.lastV = v
            s.lastT = m.t
          }
          if (s.react && v > 1.1) {
            if (m.t - s.react <= 1) reaction.push(m.t - s.react)
            s.react = null
          } else if (s.react && m.t - s.react > 1) s.react = null
        }
        if (kitchenWatch) {
          const k = kitchenWatch
          if (k.tRet !== null && !k.retDone) {
            const p = m.players.find((q) => q.id === k.retId)
            if (p && Math.abs(p.z) < LINE) {
              kitchenRet.push(m.t - k.tRet)
              k.retDone = true
            }
          }
          if (!k.srvDone && m.players.some((q) => q.team === k.servingTeam && Math.abs(q.z) < LINE)) {
            kitchenSrv.push(m.t - k.tServe)
            k.srvDone = true
          }
        }
      }
      for (const e of m.events) {
        if (e.type === "hit") {
          if (flightWatch) {
            ;(apexH[flightWatch.kind] ||= []).push(flightWatch.apex)
            if (flightWatch.shot) flightWatch.shot.apex = flightWatch.apex
            flightWatch = null
          }
          flightWatch = { kind: e.kind, t0: e.t, apex: m.ball.p.y, crossed: false }
          const prevShot = shots.at(-1)
          if (prevShot) {
            const g = e.t - prevShot.t
            ;(gaps[prevShot.kind] ||= []).push(g)
            gapAll.push(g)
          }
          // reactions: the other team's players, from this hit (only those standing still)
          for (const p of m.players) if (p.team !== e.team) mv[p.id].react = Math.hypot(p.vx, p.vz) < 0.6 ? e.t : null
          const shotNo = shots.length + 1
          if (shotNo <= 6) {
            for (const team of [0, 1]) {
              const role = team === m.rally.serving ? "serving" : "returning"
              const zs = m.players.filter((q) => q.team === team).map((q) => Math.abs(q.z))
              ;(depthAt[`${role}@${shotNo}`] ||= []).push(zs.reduce((a, b) => a + b, 0) / zs.length)
            }
          }
          if (e.kind === "serve") kitchenWatch = { tRet: null, retId: null, tServe: e.t, servingTeam: e.team, retDone: false, srvDone: false }
          else if (shotNo === 2 && kitchenWatch) {
            kitchenWatch.tRet = e.t
            kitchenWatch.retId = e.player
          }
          if (e.kind === "serve" && lastDecided !== null) {
            betweenSec.push(e.t - lastDecided)
            lastDecided = null
          }
          if (bounceWatch) {
            ;(bounceH[bounceWatch.kind] ||= []).push(bounceWatch.apex)
            bounceWatch = null
          }
          const k = e.kind
          const prev = shots.at(-1)
          if (prev) (contactAfter[prev.kind] ||= []).push(e.y)
          shots.push({ kind: k, team: e.team, t: e.t, speed: e.speed, y: e.y, z: e.z, tag: e.tag })
          flightWatch.shot = shots.at(-1)
          kinds[k] = (kinds[k] || 0) + 1
          ;(speeds[k] ||= []).push(e.speed * MPH)
          if (k === "serve") {
            serves++
            serveSpeed.push(e.speed * MPH)
          }
          const no = shots.length
          if (no === 3) third[k] = (third[k] || 0) + 1
          if (no === 5 && shots[2].kind === "drive") fifthAfterDrive[k] = (fifthAfterDrive[k] || 0) + 1
        } else if (e.type === "bounce") {
          const last = shots.at(-1)
          if (last && e.live) {
            if (bounceWatch) {
              ;(bounceH[bounceWatch.kind] ||= []).push(bounceWatch.apex)
              bounceWatch = null
            }
            // the first bounce after a hit only
            if (!last.bounced) {
              last.bounced = true
              last.landZ = Math.abs(e.z)
              last.landT = e.t
              ;(flight[last.kind] ||= []).push(e.t - last.t)
              bounceWatch = { kind: last.kind, apex: 0 }
              const depth = HALF_L - Math.abs(e.z)
              if (shots.length === 1) serveDepth.push(depth)
              if (shots.length === 2) returnDepth.push(depth)
              if (last.kind === "drive" && shots.length >= 3) driveFlight.push(e.t - last.t)
            }
          }
        } else if (e.type === "rally") {
          const last = shots.at(-1)
          if (shots.length) rallySec.push(e.t - shots[0].t)
          lastDecided = e.t
          if (flightWatch) {
            ;(apexH[flightWatch.kind] ||= []).push(flightWatch.apex)
            if (flightWatch.shot) flightWatch.shot.apex = flightWatch.apex
            flightWatch = null
          }
          kitchenWatch = null
          // the same shots as a camera would class them (observedKind)
          shots.forEach((s, i) => {
            const next = shots[i + 1]
            const ok = observedKind({ idx: i, mph: s.speed * MPH, hitterZ: Math.abs(s.z), y: s.y, apex: s.apex ?? s.y, landZ: s.landZ ?? null })
            const o = (observed[ok] ||= { mph: [], clear: [], apex: [], flight: [], gap: [], y: [], land: [] })
            o.mph.push(s.speed * MPH)
            if (s.clear !== undefined) o.clear.push(s.clear)
            if (s.apex !== undefined) o.apex.push(s.apex)
            if (s.landT !== undefined && (!next || s.landT < next.t)) o.flight.push(s.landT - s.t)
            if (s.landZ !== undefined && (!next || s.landT < next.t)) o.land.push(s.landZ)
            if (next) o.gap.push(next.t - s.t)
            o.y.push(s.y)
          })
          for (const p of m.players) {
            const s = mv[p.id]
            if (shots.length >= 3) {
              peakSpeed.push(s.peakV)
              peakAcc.push(s.peakA)
            }
            Object.assign(s, { lastV: null, lastT: 0, peakV: 0, peakA: 0, react: null })
          }
          // the dink phase and the first speed-up of the rally (as the PPA stats count them)
          const dinks = shots.filter((s) => s.kind === "dink").length
          if (dinks) dinkCounts.push(dinks)
          const ATT = new Set(["speedup"])
          const first = shots.findIndex((s, i) => i > 2 && ATT.has(s.kind))
          attacks += shots.filter((s, i) => i > 2 && ATT.has(s.kind)).length
          if (first >= 0) {
            attackRallies++
            if (shots[first].team === e.winner) attackWins++
          }
          let why
          if (e.kind === "ace") why = "ace"
          else if (e.kind === "winner") why = `winner (${e.last?.kind || "?"})`
          else if (e.reason === "Didn't clear the net") why = `net: ${e.last?.kind}`
          else if (e.reason === "Out") {
            const b = m.landing
            const wide = b && Math.abs(b.x) > HALF_W && Math.abs(b.z) <= HALF_L
            why = `${wide ? "wide" : "long"}: ${e.last?.kind}`
          } else if (e.reason === "Serve out" || e.reason === "Serve in the kitchen") why = `serve fault: ${e.reason}`
          else why = e.reason
          if (shots.length === 1 && e.kind !== "ace") serveFaults++
          ends[why] = (ends[why] || 0) + 1
          rallies.push(shots.length)
          if (last && bounceWatch) bounceWatch = null
          shots = []
        }
      }
      m.events.length = 0
    }
    steps += n
  }
  const total = Object.values(kinds).reduce((s, v) => s + v, 0)
  const sorted = Object.entries(ends).sort((a, b) => b[1] - a[1])
  const nR = rallies.length
  return {
    level,
    games,
    points: nR,
    simSeconds: Math.round(steps / 240),
    rally: {
      mean: r1(mean(rallies)),
      median: pct(rallies, 0.5),
      p90: pct(rallies, 0.9),
      max: pct(rallies, 1),
      upTo4: r1((100 * rallies.filter((v) => v <= 4).length) / nR),
      upTo9: r1((100 * rallies.filter((v) => v <= 9).length) / nR),
      tenPlus: r1((100 * rallies.filter((v) => v >= 10).length) / nR),
      twentyPlus: r1((100 * rallies.filter((v) => v >= 20).length) / nR),
      thirtyPlus: r1((100 * rallies.filter((v) => v >= 30).length) / nR),
    },
    mix: Object.fromEntries(Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r1((100 * v) / total)])),
    mph: Object.fromEntries(Object.entries(speeds).map(([k, a]) => [k, { p10: r1(pct(a, 0.1)), median: r1(pct(a, 0.5)), p90: r1(pct(a, 0.9)), max: r1(pct(a, 1)), n: a.length }])),
    third,
    fifthAfterDrive,
    serve: { mph: r1(pct(serveSpeed, 0.5)), faultPct: r1((100 * serveFaults) / Math.max(1, serves)), depthFromBaseline: { median: r2(pct(serveDepth, 0.5)), p90: r2(pct(serveDepth, 0.9)) } },
    returnDepthFromBaseline: { median: r2(pct(returnDepth, 0.5)), p90: r2(pct(returnDepth, 0.9)), within2m: r1((100 * returnDepth.filter((d) => d <= 2).length) / Math.max(1, returnDepth.length)) },
    bounceApexM: Object.fromEntries(Object.entries(bounceH).map(([k, a]) => [k, { median: r2(pct(a, 0.5)), p90: r2(pct(a, 0.9)), n: a.length }])),
    driveFlightS: { median: r2(pct(driveFlight, 0.5)) },
    contactHeightAfter: Object.fromEntries(Object.entries(contactAfter).map(([k, a]) => [k, { p10: r2(pct(a, 0.1)), median: r2(pct(a, 0.5)), p90: r2(pct(a, 0.9)) }])),
    dinkPhase: { ralliesWithDinks: r1((100 * dinkCounts.length) / nR), dinksMean: r1(mean(dinkCounts)), attacksPerRally: r2(attacks / nR), firstAttackWins: r1((100 * attackWins) / Math.max(1, attackRallies)) },
    ends: Object.fromEntries(sorted.map(([k, v]) => [k, r1((100 * v) / nR)])),
    // timing and movement
    timing: {
      gap: { p10: r2(pct(gapAll, 0.1)), median: r2(pct(gapAll, 0.5)), p90: r2(pct(gapAll, 0.9)), n: gapAll.length },
      gapAfter: q3(gaps),
      rallySec: { median: r1(pct(rallySec, 0.5)), p90: r1(pct(rallySec, 0.9)), mean: r1(mean(rallySec)) },
      betweenSec: { median: r1(pct(betweenSec, 0.5)), p10: r1(pct(betweenSec, 0.1)), p90: r1(pct(betweenSec, 0.9)), n: betweenSec.length },
      flightS: q3(flight),
    },
    ballFlight: { apexM: q3(apexH), netClearM: q3(netClear) },
    observed: Object.fromEntries(Object.entries(observed).map(([k, o]) => [k, { n: o.mph.length, mph: q3v(o.mph, 1), clear: q3v(o.clear), apex: q3v(o.apex), flight: q3v(o.flight), gap: q3v(o.gap), y: q3v(o.y), land: q3v(o.land) }])),
    movement: {
      kitchenReturner: { median: r2(pct(kitchenRet, 0.5)), p90: r2(pct(kitchenRet, 0.9)), n: kitchenRet.length },
      kitchenServingTeam: { median: r2(pct(kitchenSrv, 0.5)), p90: r2(pct(kitchenSrv, 0.9)), n: kitchenSrv.length },
      peakSpeed: { median: r2(pct(peakSpeed, 0.5)), p90: r2(pct(peakSpeed, 0.9)), max: r2(pct(peakSpeed, 1)) },
      peakAcc: { median: r1(pct(peakAcc, 0.5)), p90: r1(pct(peakAcc, 0.9)) },
      reaction: { p10: r2(pct(reaction, 0.1)), median: r2(pct(reaction, 0.5)), p90: r2(pct(reaction, 0.9)), n: reaction.length },
      depthAt: Object.fromEntries(Object.entries(depthAt).sort().map(([k, a]) => [k, r2(pct(a, 0.5))])),
    },
  }
}
const q3v = (a, d = 2) => (a.length ? [pct(a, 0.1), pct(a, 0.5), pct(a, 0.9)].map((v) => (d === 1 ? r1(v) : r2(v))) : null)
const q3 = (o) => Object.fromEntries(Object.entries(o).map(([k, a]) => [k, { p10: r2(pct(a, 0.1)), median: r2(pct(a, 0.5)), p90: r2(pct(a, 0.9)), n: a.length }]))

// one level's numbers in a few lines
export const summary = (L) =>
  [
    `${L.level} (${L.points} points): rally ${JSON.stringify(L.rally)}`,
    ` mix ${JSON.stringify(L.mix)}`,
    ` mph ${Object.entries(L.mph).map(([k, v]) => `${k}:${v.median}(${v.p10}-${v.p90},max ${v.max})`).join(" ")}`,
    ` third ${JSON.stringify(L.third)} fifth-after-drive ${JSON.stringify(L.fifthAfterDrive)}`,
    ` serve ${JSON.stringify(L.serve)} return ${JSON.stringify(L.returnDepthFromBaseline)}`,
    ` bounce apex ${Object.entries(L.bounceApexM).map(([k, v]) => `${k}:${v.median}`).join(" ")}; drive flight ${L.driveFlightS.median} s`,
    ` dink phase ${JSON.stringify(L.dinkPhase)}`,
    ` contact height after ${Object.entries(L.contactHeightAfter).map(([k, v]) => `${k}:${v.median}(${v.p10}-${v.p90})`).join(" ")}`,
    ` ends ${JSON.stringify(L.ends)}`,
    ` timing gap ${JSON.stringify(L.timing.gap)} rally s ${JSON.stringify(L.timing.rallySec)} between ${JSON.stringify(L.timing.betweenSec)}`,
    ` gap after ${Object.entries(L.timing.gapAfter).map(([k, v]) => `${k}:${v.median}`).join(" ")}`,
    ` flight to bounce ${Object.entries(L.timing.flightS).map(([k, v]) => `${k}:${v.median}`).join(" ")}`,
    ` apex ${Object.entries(L.ballFlight.apexM).map(([k, v]) => `${k}:${v.median}`).join(" ")}; net clearance ${Object.entries(L.ballFlight.netClearM).map(([k, v]) => `${k}:${v.median}(${v.p10}-${v.p90})`).join(" ")}`,
    ` movement ${JSON.stringify(L.movement)}`,
    ...Object.entries(L.observed).map(([k, o]) => ` [${k}] n${o.n} mph ${o.mph} clear ${o.clear} apex ${o.apex} flight ${o.flight} gap ${o.gap} y ${o.y} land ${o.land}`),
  ].join("\n")

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())
if (isMain) {
  // args: level games [singles] [--json=path] [--ball=indoor]
  const args = process.argv.slice(2)
  const flag = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split("=")[1]
  const pos = args.filter((a) => !a.startsWith("--"))
  const level = pos[0] || "all"
  const games = Number(pos[1] || 6)
  const doubles = pos[2] !== "singles"
  const levels = level === "all" ? ["beginner", "intermediate", "pro", "legend"] : level.split(",")
  const out = levels.map((lv) => simulate({ level: lv, games, doubles, ball: flag("ball") }))
  if (flag("json")) (await import("node:fs")).writeFileSync(flag("json"), JSON.stringify(out, null, 1))
  console.log(out.map(summary).join("\n"))
}
