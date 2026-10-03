import React from "react"

// The race track: one lane per racer, a little retro race car (drawn here, chunky 98-style
// pixels) moving from the start line to the checkered flag as they type.

export const COLORS = ["#d01818", "#1858d0", "#18a038", "#e0a000", "#9028c0"]

export const Car = ({ color = COLORS[0], ghost = false, out = false, size = 44 }) => (
  <svg className={`stCar${ghost ? " is-ghost" : ""}${out ? " is-out" : ""}`} viewBox="0 0 44 22" width={size} height={size / 2} aria-hidden="true" shapeRendering="crispEdges">
    {/* exhaust puffs */}
    <g className="stPuff" fill="#c8c8c8">
      <rect x="0" y="13" width="3" height="3" />
      <rect x="3" y="11" width="2" height="2" />
    </g>
    {/* spoiler */}
    <rect x="5" y="4" width="3" height="7" fill="#202020" />
    <rect x="4" y="3" width="7" height="2" fill={color} stroke="#000" strokeWidth=".5" />
    {/* body */}
    <path d="M6 11h10l4-5h9l5 5h6l2 2v4H6z" fill={color} stroke="#000" strokeWidth="1" />
    <rect x="8" y="12" width="30" height="1" fill="#fff" opacity=".45" />
    {/* racing number plate */}
    <rect x="12" y="13" width="7" height="3" fill="#fff" stroke="#000" strokeWidth=".5" />
    {/* cockpit and helmet */}
    <path d="M21 7h7l4 4H21z" fill="#a8d8ff" stroke="#000" strokeWidth=".6" />
    <rect x="23" y="7" width="4" height="4" fill="#f8f8f8" stroke="#000" strokeWidth=".5" />
    <rect x="25" y="8" width="2" height="2" fill="#303030" />
    {/* wheels */}
    <g className="stWheel">
      <circle cx="12" cy="17" r="4" fill="#181818" />
      <circle cx="12" cy="17" r="1.6" fill="#b0b0b0" />
    </g>
    <g className="stWheel">
      <circle cx="35" cy="17" r="4" fill="#181818" />
      <circle cx="35" cy="17" r="1.6" fill="#b0b0b0" />
    </g>
    {/* headlight */}
    <rect x="40" y="12" width="2" height="2" fill="#ffe860" />
  </svg>
)

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`
export { ordinal }

// racers: [{ name, pos, wpm, finished, place, out, left, bot, ghost, you }]; length: the prompt's characters
const Track = ({ racers, length, compact = false }) => (
  <div className={`stTrack${compact ? " is-compact" : ""}`} role="list" aria-label="Race track">
    {racers.map((r, i) => {
      const pct = length ? Math.min(1, r.pos / length) : 0
      return (
        <div key={i} className={`stLane${r.you ? " is-you" : ""}${r.out ? " is-out" : ""}`} role="listitem" data-seat={i} data-pos={r.pos}>
          <div className="stLaneName" title={r.name}>
            <span className="stLaneDot" style={{ background: r.ghost ? "#8090a8" : COLORS[i % COLORS.length] }} />
            <span className="stLaneText">
              {r.name}
            </span>
          </div>
          <div className="stRoad">
            <div className="stFinish" aria-hidden="true" />
            <div className="stCarWrap" style={{ left: `calc(${pct} * (100% - var(--st-car)))` }}>
              <Car color={COLORS[i % COLORS.length]} ghost={r.ghost} out={r.out} size={compact ? 36 : 56} />
            </div>
          </div>
          <div className="stLaneStat">
            {r.place ? <b className={`stPlace is-${r.place}`}>{ordinal(r.place)}</b> : r.out ? <b className="stPlace is-out">{r.left ? "left" : "out"}</b> : null}
            <span className="stWpm" data-wpm={Math.round(r.wpm)}>
              {Math.round(r.wpm)} <small>wpm</small>
            </span>
          </div>
        </div>
      )
    })}
  </div>
)

export default Track
