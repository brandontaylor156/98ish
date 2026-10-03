import React, { useState } from "react"
import Dialog from "../../shared/Dialog"

// Help > Rules Primer: the rules that matter, a page at a time, with little court diagrams.
// The court is drawn sideways: 44 ft across, 20 ft tall (4 px per foot), your side on the left.

const S = 4 // px per foot
const W = 44 * S
const H = 20 * S
const K = 7 * S // the kitchen, from the net
const PAD = 14

const Court = ({ children, label }) => (
  <svg className="pkDiagram" viewBox={`0 0 ${W + PAD * 2} ${H + PAD * 2 + 14}`} role="img" aria-label={label}>
    <g transform={`translate(${PAD} ${PAD})`}>
      <rect x={-6} y={-6} width={W + 12} height={H + 12} fill="#3c8a5a" />
      <rect width={W} height={H} fill="#2f62ad" />
      <rect x={W / 2 - K} width={K * 2} height={H} fill="#3b75c4" />
      <g stroke="#fff" strokeWidth="1.2" fill="none">
        <rect width={W} height={H} />
        <line x1={W / 2 - K} y1={0} x2={W / 2 - K} y2={H} />
        <line x1={W / 2 + K} y1={0} x2={W / 2 + K} y2={H} />
        <line x1={0} y1={H / 2} x2={W / 2 - K} y2={H / 2} />
        <line x1={W / 2 + K} y1={H / 2} x2={W} y2={H / 2} />
      </g>
      <line x1={W / 2} y1={-8} x2={W / 2} y2={H + 8} stroke="#111" strokeWidth="2.5" />
      <line x1={W / 2} y1={-8} x2={W / 2} y2={H + 8} stroke="#fff" strokeWidth="0.8" strokeDasharray="2 2" />
      {children}
    </g>
  </svg>
)

const Dot = ({ x, y, n, color = "#ffe14d" }) => (
  <g>
    <circle cx={x} cy={y} r={4.5} fill={color} stroke="#222" strokeWidth="0.8" />
    {n !== undefined && (
      <text x={x} y={y + 2.6} fontSize="6.5" textAnchor="middle" fill="#222" fontWeight="bold">
        {n}
      </text>
    )}
  </g>
)
const Person = ({ x, y, color }) => <circle cx={x} cy={y} r={5} fill={color} stroke="#fff" strokeWidth="1.2" />
const Arc = ({ from, to, lift = 18, color = "#ffe14d", dash }) => {
  const mx = (from[0] + to[0]) / 2
  const my = (from[1] + to[1]) / 2 - lift
  return <path d={`M${from[0]} ${from[1]} Q${mx} ${my} ${to[0]} ${to[1]}`} fill="none" stroke={color} strokeWidth="1.6" strokeDasharray={dash} markerEnd="url(#pkArrow)" />
}
const Defs = () => (
  <defs>
    <marker id="pkArrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0 0L6 3L0 6z" fill="#ffe14d" />
    </marker>
  </defs>
)

const PAGES = [
  {
    title: "The court",
    body: (
      <>
        <Court label="Court diagram">
          <Defs />
          <text x={W / 2} y={H / 2 + 3} fontSize="8" textAnchor="middle" fill="#fff" fontWeight="bold" transform={`rotate(-90 ${W / 2} ${H / 2})`}>
            NET
          </text>
          <text x={W / 2 - K / 2} y={H + 13} fontSize="7" textAnchor="middle" fill="#222">
            kitchen
          </text>
          <text x={W / 2 + K / 2} y={H + 13} fontSize="7" textAnchor="middle" fill="#222">
            kitchen
          </text>
          <text x={W / 4 - 6} y={H / 4 + 3} fontSize="7" textAnchor="middle" fill="#fff">
            left
          </text>
          <text x={W / 4 - 6} y={(H * 3) / 4 + 3} fontSize="7" textAnchor="middle" fill="#fff">
            right
          </text>
          <text x={W + 4} y={H / 2} fontSize="6.5" fill="#222" transform={`rotate(90 ${W + 4} ${H / 2})`} textAnchor="middle">
            20 ft
          </text>
        </Court>
        <p className="dialogText">
          The court is 20 x 44 ft, the same as a doubles badminton court. The net is 36 in high at the sidelines and
          sags to 34 in in the middle. The 7 ft zone on each side of the net is the <b>non-volley zone</b>, the
          &quot;kitchen&quot;. Lines are part of the area they mark: a ball touching a line is in.
        </p>
      </>
    ),
  },
  {
    title: "The serve",
    body: (
      <>
        <Court label="The serve goes diagonally">
          <Defs />
          <Person x={-2} y={H * 0.75} color="#1a9fb0" />
          <Arc from={[2, H * 0.75]} to={[W - 30, H * 0.25]} lift={22} />
          <Dot x={W - 30} y={H * 0.25} />
          <text x={W / 2 + K + 2} y={H * 0.75 + 3} fontSize="6.5" fill="#fff">
            short = fault
          </text>
          <line x1={W / 2 + K - 6} y1={H * 0.6} x2={W / 2 + K + 2} y2={H * 0.68} stroke="#ff4d4d" strokeWidth="2" />
          <line x1={W / 2 + K + 2} y1={H * 0.6} x2={W / 2 + K - 6} y2={H * 0.68} stroke="#ff4d4d" strokeWidth="2" />
        </Court>
        <p className="dialogText">
          Serve <b>underhand</b>: hit the ball below your waist with an upward swing, both feet behind the baseline.
          The serve goes <b>diagonally</b> into the service court across from you and must clear the kitchen: a serve
          that lands in the kitchen or on its line is short, a fault. (A serve that clips the net and lands in is
          played.) In Pickleball 98, tap for a soft serve or hold Space for a hard one.
        </p>
      </>
    ),
  },
  {
    title: "The two-bounce rule",
    body: (
      <>
        <Court label="The serve and the return must each bounce">
          <Defs />
          <Person x={-2} y={H * 0.75} color="#1a9fb0" />
          <Person x={W + 2} y={H * 0.25} color="#e8604c" />
          <Arc from={[2, H * 0.75]} to={[W - 34, H * 0.28]} lift={20} />
          <Dot x={W - 34} y={H * 0.28} n={1} />
          <Arc from={[W - 2, H * 0.25]} to={[30, H * 0.6]} lift={20} />
          <Dot x={30} y={H * 0.6} n={2} />
        </Court>
        <p className="dialogText">
          The receiving side must let the serve bounce (1), and the serving side must let the return bounce (2).
          After those two bounces, anyone may volley (hit the ball out of the air). Volley the serve or the return
          and it's a fault. That's why the serving team stays back, and why a soft <b>third-shot drop</b> into the
          kitchen is the classic way to get to the net.
        </p>
      </>
    ),
  },
  {
    title: "The kitchen",
    body: (
      <>
        <svg className="pkDiagram" viewBox="0 0 240 92" role="img" aria-label="No volleys from the kitchen">
          <Defs />
          <rect x="0" y="70" width="240" height="22" fill="#2f62ad" />
          <rect x="120" y="70" width="60" height="22" fill="#3b75c4" />
          <rect x="178" y="70" width="3" height="22" fill="#fff" />
          <rect x="118" y="40" width="3" height="30" fill="#222" />
          <rect x="116" y="38" width="7" height="3" fill="#fff" />
          {/* a player at the line, toes behind it: volley OK */}
          <g transform="translate(200 18)">
            <circle cx="0" cy="0" r="6" fill="#f1c27d" />
            <rect x="-5" y="6" width="10" height="22" fill="#1a9fb0" />
            <rect x="-5" y="28" width="4" height="24" fill="#f1c27d" />
            <rect x="1" y="28" width="4" height="24" fill="#f1c27d" />
            <rect x="-14" y="10" width="10" height="4" fill="#ffd23f" />
          </g>
          <text x="200" y="88" fontSize="8" textAnchor="middle" fill="#fff">
            volley OK
          </text>
          {/* a player in the kitchen: volley is a fault */}
          <g transform="translate(150 18)">
            <circle cx="0" cy="0" r="6" fill="#c68642" />
            <rect x="-5" y="6" width="10" height="22" fill="#e8604c" />
            <rect x="-5" y="28" width="4" height="24" fill="#c68642" />
            <rect x="1" y="28" width="4" height="24" fill="#c68642" />
          </g>
          <text x="150" y="88" fontSize="8" textAnchor="middle" fill="#ffd9d0">
            fault!
          </text>
          <text x="60" y="88" fontSize="8" textAnchor="middle" fill="#fff">
            your side
          </text>
        </svg>
        <p className="dialogText">
          You may not <b>volley</b> while touching the kitchen or its line, and if the momentum of a volley carries you
          into it afterwards (even after the ball is dead), that's a fault too. You can step into the kitchen any time
          to play a ball that has bounced: just get back out before you volley. Soft shots into the kitchen
          (<b>dinks</b>) are the heart of the game.
        </p>
      </>
    ),
  },
  {
    title: "Scoring",
    body: (
      <>
        <div className="pkCallDiagram" aria-hidden="true">
          <div>
            <b>4</b>
            <span>serving team</span>
          </div>
          <div className="pkDash">-</div>
          <div>
            <b>2</b>
            <span>receiving team</span>
          </div>
          <div className="pkDash">-</div>
          <div>
            <b>1</b>
            <span>server 1 or 2</span>
          </div>
        </div>
        <p className="dialogText">
          <b>Side-out scoring</b> (the classic): only the serving side scores. In doubles, both partners serve before
          the serve passes over (a &quot;side out&quot;), so the call has three numbers: &quot;4-2-1&quot;. The game
          starts at &quot;0-0-2&quot;: the first team gets only one server. When you win a point you switch sides with
          your partner and serve again. Singles calls two numbers; serve from the right on an even score.
          <br />
          <br />
          <b>Rally scoring</b> (an option): every rally scores a point for whoever wins it. Games go to 11 (or 15 or
          21) and must be won by 2.
        </p>
      </>
    ),
  },
]

export const RulesPrimer = ({ onClose }) => {
  const [page, setPage] = useState(0)
  const p = PAGES[page]
  return (
    <Dialog title={`Rules Primer: ${p.title} (${page + 1}/${PAGES.length})`} onOk={onClose} okLabel="Close">
      <div className="pkPrimer">
        {p.body}
        <div className="pkPrimerNav">
          <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
            &lt; Back
          </button>
          <button type="button" disabled={page === PAGES.length - 1} onClick={() => setPage(page + 1)}>
            Next &gt;
          </button>
        </div>
      </div>
    </Dialog>
  )
}

export const ControlsHelp = ({ touch }) => (
  <div className="dialogText pkHelp">
    {touch ? (
      <>
        <p>
          <b>Move:</b> drag anywhere in the lower-left area (a joystick appears under your thumb).
        </p>
        <p>
          <b>Shots:</b> Dink, Drive, Drop and Lob buttons. Press a little early: with Movement Assist on, you play
          the shot when the ball arrives. Or <b>swipe up</b> on the court to swing: a faster swipe hits harder,
          swiping to the side aims; a tap is a soft swing.
        </p>
        <p>The gear button (or Options) lets you move and resize the buttons.</p>
      </>
    ) : (
      <>
        <p>
          <b>Move:</b> W A S D or the arrow keys.
        </p>
        <p>
          <b>Swing:</b> Space or the left mouse button. A tap is soft (a dink at the kitchen line, a drop from the
          back), holding it longer (or flicking the mouse up) swings hard. Hold Shift for a hard swing.
        </p>
        <p>
          <b>Pick the shot:</b> J dink, K drive, L lob, I drop (or 1-4); right-click lobs.
        </p>
        <p>
          <b>Aim:</b> the mouse position across the court, or hold Left/Right as you swing.
        </p>
        <p>P pauses; F2 starts a new match.</p>
      </>
    )}
    <p>
      Movement Assist (Options) walks you to the ball and waits for the bounce when the rules say so; turn it off
      to do it all yourself.
    </p>
  </div>
)
