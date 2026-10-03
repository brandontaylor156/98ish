import React, { useMemo, useState } from "react"
import BoardView from "./BoardView.jsx"
import { makeBoard, geometry } from "./board.js"
import { COSTS, DEV, DEV_TYPES, PIPS, RES_INFO, TERRAIN_RES, legalRoads, legalSettlements, vertexTiles } from "./logic.js"
import { Tile, NumberToken, Bandit, BoardDefs, DevArt, ResSvg, Die, Harbor } from "./art.jsx"
import { Cost } from "./Panels.jsx"

// How to Play, one step at a time, with a little island to try things on: place a
// settlement and a road, roll the dice and collect. The last step starts a coached game.

const TERRAINS = [
  ["forest", "Forest"],
  ["hills", "Hills"],
  ["pasture", "Pasture"],
  ["fields", "Fields"],
  ["mountains", "Mountains"],
]

const practiceView = (board, verts, edges, extra = {}) => ({
  geo: "std",
  tiles: board.tiles,
  harbors: board.harbors,
  bandit: board.bandit,
  verts,
  edges,
  you: 0,
  players: [
    { color: "red", name: "You" },
    { color: "blue", name: "Blue" },
  ],
  ...extra,
})

const Tutorial = ({ onClose, onCoachGame }) => {
  const board = useMemo(() => makeBoard({ layout: "beginner" }), [])
  const g = geometry("std")
  const [step, setStep] = useState(0)
  const [vertex, setVertex] = useState(null)
  const [edge, setEdge] = useState(null)
  const [dice, setDice] = useState(null)
  const [rolls, setRolls] = useState(0)

  const verts = Array(g.vertices.length).fill(null)
  const edges = Array(g.edges.length).fill(null)
  // a neighbor already settled, so you can see the distance rule
  const theirs = 31
  verts[theirs] = { p: 1, k: "s" }
  if (vertex != null) verts[vertex] = { p: 0, k: "s" }
  if (edge != null) edges[edge] = 0
  const view = practiceView(board, verts, edges)
  const sum = dice ? dice[0] + dice[1] : null
  const touching = vertex != null ? vertexTiles(view, vertex) : []
  const got = sum && sum !== 7 ? touching.filter((t) => t.number === sum && t.tile !== board.bandit) : []
  const roll = () => {
    const d = [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]
    // the first practice roll pays you, so you see how it works
    const paying = touching.filter((t) => t.number && t.tile !== board.bandit)
    if (rolls === 0 && paying.length) {
      const n = paying[0].number
      const lo = Math.max(1, n - 6)
      const hi = Math.min(6, n - 1)
      d[0] = lo + Math.floor(Math.random() * (hi - lo + 1))
      d[1] = n - d[0]
    }
    setRolls(rolls + 1)
    setDice(d)
  }

  const steps = [
    {
      title: "Welcome to Hexlands",
      body: (
        <>
          <p>
            You and your rivals settle a wild island. Collect resources, build roads, settlements and cities, and trade. <b>The first to 10 victory points wins.</b>
          </p>
          <ul className="hxTutList">
            <li>Each settlement is worth 1 point, each city 2.</li>
            <li>Special cards and some development cards are worth points too.</li>
            <li>A game takes about 45 minutes against the computer (or less: they're quick).</li>
          </ul>
        </>
      ),
      art: <BoardView view={view} compact />,
    },
    {
      title: "Land makes resources",
      body: (
        <>
          <p>Every land tile makes one resource. The desert makes nothing (the Bandit lives there).</p>
          <div className="hxTutTerrains">
            {TERRAINS.map(([t, label]) => (
              <div key={t} className="hxTutTerrain">
                <svg viewBox="-105 -105 210 210" width="64" height="64" aria-hidden="true">
                  <BoardDefs />
                  <Tile t={t} x={0} y={0} seed={t.length * 3} />
                </svg>
                <b>{label}</b>
                <span>
                  <ResSvg r={TERRAIN_RES[t]} size={18} /> {RES_INFO[TERRAIN_RES[t]].label}
                </span>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      title: "Numbers and the dice",
      body: (
        <>
          <p>
            Each turn starts with a roll of two dice. <b>Every tile showing that number pays</b> the settlements and cities on its corners.
          </p>
          <p>The dots under a number show how likely it is: 6 and 8 (in red) come up most, 2 and 12 least. 7 isn't on any tile: it brings the Bandit.</p>
          <svg className="hxTutTokens" viewBox="0 0 660 70" aria-hidden="true">
            <BoardDefs />
            {[2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map((n, i) => (
              <NumberToken key={n} n={n} x={36 + i * 65} y={35} />
            ))}
          </svg>
          <p className="hxMuted">
            Odds per roll: 6 or 8 is {Math.round((PIPS[6] / 36) * 100)}%, 2 or 12 just {Math.round((1 / 36) * 100)}%.
          </p>
        </>
      ),
    },
    {
      title: "Try it: place a settlement",
      body: (
        <>
          <p>
            Settlements go on the <b>corners</b> where tiles meet. Each one collects from up to three tiles. <b>Tap a glowing corner.</b>
          </p>
          <p className="hxMuted">The distance rule: no two buildings on neighboring corners. That's why the corners next to Blue's settlement don't glow.</p>
          {vertex != null && (
            <p className="hxTutGood" data-tut-placed>
              Nice! It collects{" "}
              {touching
                .filter((t) => t.res)
                .map((t) => `${RES_INFO[t.res].label.toLowerCase()} on ${t.number}`)
                .join(", ") || "nothing (that's the desert!)"}
              .
            </p>
          )}
        </>
      ),
      art: <BoardView view={view} compact pick={{ kind: "settlement", spots: legalSettlements(view, 0, true), selected: vertex }} onPick={(v) => (setVertex(v), setEdge(null), setDice(null), setRolls(0))} />,
      ready: vertex != null,
    },
    {
      title: "Try it: build a road",
      body: (
        <>
          <p>
            Roads go on the <b>edges</b> between corners. New settlements must touch one of your roads, so roads are how you spread out. <b>Tap a glowing edge</b> next to your settlement.
          </p>
          <div className="hxTutCosts">
            {[
              ["road", "Road"],
              ["settlement", "Settlement (1 point)"],
              ["city", "City (2 points)"],
              ["dev", "Development card"],
            ].map(([k, label]) => (
              <div key={k}>
                <b>{label}</b>
                <Cost cost={COSTS[k]} />
              </div>
            ))}
          </div>
        </>
      ),
      art: <BoardView view={view} compact pick={vertex != null ? { kind: "road", spots: legalRoads(view, 0, vertex), selected: edge } : null} onPick={setEdge} />,
      ready: edge != null,
    },
    {
      title: "Try it: roll and collect",
      body: (
        <>
          <p>Roll the dice. If a tile next to your settlement shows the number, you collect its resource. Cities collect 2.</p>
          <div className="hxTutRoll">
            <button type="button" className="hxGo" onClick={roll} data-tut-roll>
              Roll the dice
            </button>
            {dice && (
              <span className="hxTutDice">
                <Die n={dice[0]} />
                <Die n={dice[1]} red />
                <b>= {sum}</b>
              </span>
            )}
          </div>
          {dice && (
            <p className={got.length ? "hxTutGood" : "hxMuted"} data-tut-result>
              {sum === 7 ? "A 7! Nobody collects. The Bandit moves (next step)." : got.length ? `You collect ${got.map((t) => RES_INFO[t.res].label.toLowerCase()).join(" and ")}!` : `No ${sum} next to your settlement this time. Everyone else with a ${sum} collects.`}
            </p>
          )}
        </>
      ),
      art: <BoardView view={view} compact hot={sum && sum !== 7 ? sum : null} />,
      ready: dice != null,
    },
    {
      title: "Sevens and the Bandit",
      body: (
        <>
          <p>When someone rolls a 7:</p>
          <ul className="hxTutList">
            <li>
              Everyone holding <b>more than 7 cards</b> discards half of them.
            </li>
            <li>
              The roller moves <b>the Bandit</b> to any other tile. That tile pays nobody while the Bandit sits on it.
            </li>
            <li>The roller then takes a random card from someone with a building on that tile.</li>
          </ul>
          <p className="hxMuted">So don't hoard cards: spend them!</p>
        </>
      ),
      art: (
        <svg className="hxTutBandit" viewBox="-110 -110 220 220" aria-hidden="true">
          <BoardDefs />
          <Tile t="fields" x={0} y={0} seed={4} />
          <NumberToken n={8} x={22} y={14} dim />
          <Bandit x={-24} y={-10} />
        </svg>
      ),
    },
    {
      title: "Trading",
      body: (
        <>
          <p>Missing something? On your turn, after rolling:</p>
          <ul className="hxTutList">
            <li>
              <b>Trade with players.</b> Offer some cards for others. They can accept, decline or counter with their own deal.
            </li>
            <li>
              <b>Trade with the bank.</b> 4 of one resource for 1 of any other.
            </li>
            <li>
              <b>Harbors</b> do better: settle on a harbor's corner to trade 3:1 (any resource) or 2:1 (the resource shown).
            </li>
          </ul>
        </>
      ),
      art: (
        <svg className="hxTutBandit" viewBox="-120 -80 240 160" aria-hidden="true">
          <BoardDefs />
          <Harbor a={{ x: -100, y: 0 }} b={{ x: -40, y: 0 }} out={[0, 1]} type="any" />
          <Harbor a={{ x: 40, y: 0 }} b={{ x: 100, y: 0 }} out={[0, 1]} type="wool" />
          <text x="-70" y="-20" textAnchor="middle" fontSize="16" fill="#fff">
            any 3:1
          </text>
          <text x="70" y="-20" textAnchor="middle" fontSize="16" fill="#fff">
            wool 2:1
          </text>
        </svg>
      ),
    },
    {
      title: "Development cards",
      body: (
        <>
          <p>Buy them for wool, grain and ore. Play one per turn, but not on the turn you bought it.</p>
          <div className="hxTutDevs">
            {DEV_TYPES.map((t) => (
              <div key={t}>
                <DevArt t={t} size={40} />
                <span>
                  <b>{DEV[t].label}</b> {DEV[t].text}
                </span>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      title: "Special cards: 2 points each",
      body: (
        <>
          <ul className="hxTutList">
            <li>
              <b>Longest Road</b>: the first with an unbroken road of 5 or more. Someone else takes it by building a longer one. A settlement in the middle of a road breaks it!
            </li>
            <li>
              <b>Largest Patrol</b>: the first to play 3 Rangers. Someone else takes it by playing more.
            </li>
          </ul>
          <p>
            And that's it! Reach <b>10 points on your turn</b> to win.
          </p>
        </>
      ),
    },
  ]
  const s = steps[step]
  const last = step === steps.length - 1
  return (
    <div className="hxTut" data-tut-step={step}>
      <div className="hxTutProgress">
        {steps.map((_, i) => (
          <i key={i} className={i <= step ? "is-on" : ""} />
        ))}
      </div>
      <div className="hxTutMain">
        <div className="hxTutText">
          <h2>{s.title}</h2>
          {s.body}
        </div>
        {s.art && <div className="hxTutArt">{s.art}</div>}
      </div>
      <div className="hxTutNav">
        <button type="button" onClick={onClose} data-tut-close>
          Close
        </button>
        <span className="hxTutCount">
          {step + 1} of {steps.length}
        </span>
        <button type="button" disabled={step === 0} onClick={() => setStep(step - 1)} data-tut-back>
          Back
        </button>
        {last ? (
          <button type="button" className="hxGo" onClick={onCoachGame} data-tut-play>
            Play a coached game
          </button>
        ) : (
          <button type="button" className="hxGo" onClick={() => setStep(step + 1)} data-tut-next disabled={s.ready === false}>
            {s.ready === false ? "Try it first" : "Next"}
          </button>
        )}
      </div>
    </div>
  )
}

export default Tutorial
