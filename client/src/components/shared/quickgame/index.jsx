import React, { useEffect, useRef } from "react"
import Dialog from "../Dialog"
import { createFrameClock } from "../../../utils/frameClock"
import { fmtNum } from "../../../utils/gameKit"
import "./QuickGame.css"

// Shared pieces for the quick games (Boom Frenzy, Color Match, Echo Pads, Zap It!, Tetherball):
//   useGameLoop(fn(dtSeconds, now), running)  a requestAnimationFrame loop on the frame clock
//                                             (utils/frameClock.js: real time, reset on resume)
//   useAutoPause(paused, onPause)             calls onPause when the window loses focus, is
//                                             minimized, or the page is hidden
//   <PausedPanel onResume onQuit />           the "Paused" card
//   <ScoresDialog title tables />             High Scores: [{ label, rows: [{ score, date, note }] }]
//   <HowToDialog title onClose>...</HowToDialog>

export const useGameLoop = (fn, running) => {
  const fnRef = useRef(fn)
  fnRef.current = fn
  useEffect(() => {
    if (!running) return
    const clock = createFrameClock()
    let id = 0
    const frame = (now) => {
      const ms = clock.tick(now)
      fnRef.current(ms / 1000, now)
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    // the tab coming back: start the clock again rather than count the time away
    const onVis = () => !document.hidden && clock.reset()
    document.addEventListener("visibilitychange", onVis)
    return () => {
      cancelAnimationFrame(id)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [running])
}

export const useAutoPause = (paused, onPause) => {
  const cb = useRef(onPause)
  cb.current = onPause
  useEffect(() => {
    if (paused) cb.current()
  }, [paused])
  useEffect(() => {
    const onVis = () => document.hidden && cb.current()
    const onBlur = () => cb.current()
    document.addEventListener("visibilitychange", onVis)
    window.addEventListener("blur", onBlur)
    return () => {
      document.removeEventListener("visibilitychange", onVis)
      window.removeEventListener("blur", onBlur)
    }
  }, [])
}

export const PausedPanel = ({ onResume, onQuit, children }) => (
  <div className="qgOverlay" data-paused>
    <div className="qgPanel window">
      <div className="title-bar">
        <div className="title-bar-text">Paused</div>
      </div>
      <div className="window-body qgPanelBody">
        {children}
        <div className="qgPanelButtons">
          <button type="button" className="qgBig" onClick={onResume} autoFocus>
            Resume
          </button>
          {onQuit && (
            <button type="button" onClick={onQuit}>
              Quit to Title
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
)

export const ScoresDialog = ({ title, tables, onClose, unit = "" }) => (
  <Dialog title={title} onOk={onClose}>
    <div className="qgScores">
      {tables.map((t) => (
        <div key={t.label}>
          <b>{t.label}</b>
          {t.rows?.length ? (
            <table>
              <tbody>
                {t.rows.slice(0, 5).map((s, i) => (
                  <tr key={i}>
                    <td>{i + 1}.</td>
                    <td className="qgScoreCol">
                      {fmtNum(s.score)}
                      {unit}
                    </td>
                    <td>{s.note || ""}</td>
                    <td>{new Date(s.date).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No games yet.</p>
          )}
        </div>
      ))}
    </div>
  </Dialog>
)

export const HowToDialog = ({ title, onClose, children }) => (
  <Dialog title={title} onOk={onClose} onCancel={onClose}>
    <div className="qgHow">{children}</div>
  </Dialog>
)

// The window's chrome for a quick game: the menu bar and a stage that fills the rest
export const QuickGameRoot = React.forwardRef(({ className = "", mobile, children, ...rest }, ref) => (
  <div ref={ref} className={`qgRoot ${className}${mobile ? " is-mobile" : ""}`} tabIndex={0} onContextMenu={(e) => e.preventDefault()} {...rest}>
    {children}
  </div>
))
QuickGameRoot.displayName = "QuickGameRoot"

// a 98-style checkbox (98.css draws it from the input + label pair)
export const Check = ({ id, checked, onChange, disabled, children }) => (
  <span className="qgOptionRow">
    <input id={id} type="checkbox" checked={!!checked} disabled={disabled} onChange={onChange} />
    <label htmlFor={id}>{children}</label>
  </span>
)

// the title screen's scroll area
export const TitleScreen = ({ className = "", children }) => <div className={`qgTitle ${className}`}>{children}</div>
