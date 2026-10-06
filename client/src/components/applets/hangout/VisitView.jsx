import React from "react"

// A friend's desktop as they see it (Come Over > Visit): their wallpaper, icons and open
// windows, kept up to date, with their pointer. Private windows show as a closed grey box.
// If they let friends touch their desktop, tapping an icon opens it there and tapping a
// window brings it to the front (on their screen).
const VisitView = ({ person, snap, cursor, canTouch, onAct }) => {
  if (!snap) return <p className="hgNote">Waiting for {person.name}'s desktop...</p>
  const wall = snap.wallpaper || {}
  const style = { backgroundColor: wall.color || "#008080", backgroundImage: wall.image ? `url("${wall.image}")` : "none", backgroundSize: wall.mode === "tile" ? "auto" : "cover", backgroundRepeat: wall.mode === "tile" ? "repeat" : "no-repeat", backgroundPosition: "center" }
  const open = snap.windows.map((w, index) => ({ w, index }))
  return (
    <div className="hgVisit">
      <p className="hgSmallNote">
        {person.name}'s desktop{snap.mobile ? " (on a phone)" : ""}. {canTouch ? "They let you touch it: tap an icon to open it on their screen." : "Look only: they haven't let friends touch it."}
      </p>
      <div className={`hgVisitScreen${snap.mobile ? " is-phone" : ""}`} style={style} data-visit-screen={person.key}>
        <div className="hgVisitIcons">
          {snap.icons.map((i, n) => (
            <button key={n} type="button" className="hgVisitIcon" disabled={!canTouch} onClick={() => onAct({ type: "open", program: i.program || i.name })} title={canTouch ? `Open ${i.name} on ${person.name}'s desktop` : i.name}>
              {i.icon ? <img src={i.icon} alt="" width="20" height="20" /> : <span className="hgVisitNoIcon" />}
              <span>{i.name}</span>
            </button>
          ))}
        </div>
        {open
          .filter(({ w }) => !w.min)
          .map(({ w, index }) => (
            <button
              key={index}
              type="button"
              className={`hgVisitWin${w.active ? " is-active" : ""}${w.app === "private" ? " is-private" : ""}`}
              style={{ left: `${w.x * 100}%`, top: `${w.y * 100}%`, width: `${Math.max(8, w.w * 100)}%`, height: `${Math.max(6, w.h * 100)}%` }}
              disabled={!canTouch || w.app === "private"}
              onClick={() => onAct({ type: "focus", index })}
              data-visit-window={w.app}
            >
              <span className="hgVisitTitle">
                {w.icon && <img src={w.icon} alt="" width="10" height="10" />}
                {w.title}
              </span>
            </button>
          ))}
        {cursor && (
          <svg className="hgVisitCursor" style={{ left: `${cursor.x * 100}%`, top: `${cursor.y * 100}%` }} width="10" height="14" viewBox="0 0 14 19" aria-hidden="true">
            <path d="M1 1 L1 15 L5 11 L8 17 L10 16 L7 10 L12 10 Z" fill={person.color} stroke="#000" strokeWidth="1" />
          </svg>
        )}
      </div>
      {open.some(({ w }) => w.min) && (
        <p className="hgSmallNote">
          Minimized: {open.filter(({ w }) => w.min).map(({ w }) => w.title).join(", ")}
        </p>
      )}
    </div>
  )
}

export default VisitView
