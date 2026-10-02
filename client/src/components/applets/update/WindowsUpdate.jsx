import React, { useEffect, useRef, useState } from "react"
import "./WindowsUpdate.css"
import { unlock } from "../../../utils/achievements"

// "98ish Update": scans for (made-up) critical updates, downloads them at authentic 56k
// speeds (sped up a little), installs them, and wants a restart. Installed updates are
// remembered in this browser.

const KEY = "98ish.updates"

export const UPDATES = [
  { id: "y2k", name: "Y2K Readiness Update", size: 412, about: "Makes sure your computer survives the year 2000. Again." },
  { id: "modem", name: "Dial-Up Modem Sound Enhancement", size: 1210, about: "Adds 30% more screech to the connection handshake." },
  { id: "ram", name: "Free RAM Upgrade (4 MB)", size: 4096, about: "Downloads more memory. Results may vary." },
  { id: "tetris", name: "Tetris Gravity Hotfix", size: 96, about: "Pieces now fall down instead of slightly diagonally." },
  { id: "pixels", name: "Pixel Polish 2.0", size: 640, about: "Buffs every pixel to a showroom shine." },
  { id: "bsod", name: "Blue Screen Prevention Pack (Beta)", size: 2048, about: "Reduces fatal exceptions by asking them nicely not to happen." },
  { id: "dst", name: "Daylight Saving Time Update", size: 64, about: "Moves one hour from spring into autumn, where it's needed more." },
  { id: "mouse", name: "Mouse Ball Cleaning Wizard", size: 300, about: "Step-by-step instructions for removing desk lint." },
]

const loadInstalled = () => {
  try {
    const list = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

const BYTES_PER_TICK = 160 // KB per 100 ms: a very fast 56k modem

const WindowsUpdate = ({ onClose }) => {
  const [stage, setStage] = useState("welcome") // welcome | scanning | list | installing | done
  const [installed, setInstalled] = useState(loadInstalled)
  const [picked, setPicked] = useState([])
  const [progress, setProgress] = useState({ index: 0, done: 0 })
  const timer = useRef(null)

  const available = UPDATES.filter((u) => !installed.some((i) => i.id === u.id))

  useEffect(() => () => clearInterval(timer.current), [])

  const scan = () => {
    setStage("scanning")
    setProgress({ index: 0, done: 0 })
    let pct = 0
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      pct += 7 + Math.random() * 9
      setProgress({ index: 0, done: Math.min(100, pct) })
      if (pct >= 100) {
        clearInterval(timer.current)
        setPicked(available.map((u) => u.id))
        setStage("list")
      }
    }, 120)
  }

  const install = () => {
    const queue = available.filter((u) => picked.includes(u.id))
    if (!queue.length) return
    setStage("installing")
    let index = 0
    let done = 0
    clearInterval(timer.current)
    timer.current = setInterval(() => {
      done += BYTES_PER_TICK
      if (done >= queue[index].size) {
        index++
        done = 0
        if (index >= queue.length) {
          clearInterval(timer.current)
          const next = [...installed, ...queue.map((u) => ({ id: u.id, at: Date.now() }))]
          setInstalled(next)
          if (UPDATES.every((u) => next.some((i) => i.id === u.id))) unlock("updates")
          try {
            localStorage.setItem(KEY, JSON.stringify(next))
          } catch {
            // fine
          }
          setStage("done")
          return
        }
      }
      setProgress({ index, done })
    }, 100)
    setProgress({ index: 0, done: 0 })
  }

  const queue = available.filter((u) => picked.includes(u.id))
  const totalKb = queue.reduce((s, u) => s + u.size, 0)
  const current = queue[progress.index]
  const overall = stage === "installing" && totalKb ? (queue.slice(0, progress.index).reduce((s, u) => s + u.size, 0) + progress.done) / totalKb : 0
  const secondsLeft = Math.ceil(((totalKb * (1 - overall)) / 7) * 1) // "at 56k" (7 KB/s), for show

  return (
    <div className="wuRoot">
      <div className="wuBanner">
        <span className="wuGlobe" aria-hidden="true" />
        <div>
          <b>98ish Update</b>
          <span>Keeping your computer up to date since 1998</span>
        </div>
      </div>

      <div className="wuBody">
        {stage === "welcome" && (
          <>
            <p>98ish Update checks for the latest fixes and improvements for your computer.</p>
            <p>{installed.length ? `${installed.length} update${installed.length === 1 ? "" : "s"} installed so far.` : "No updates have been installed yet."}</p>
            <button type="button" className="wuBig" onClick={scan}>
              Scan for updates
            </button>
          </>
        )}

        {stage === "scanning" && (
          <>
            <p>Looking for available updates... (this may take a few minutes over a modem)</p>
            <div className="progress-indicator segmented wuBar">
              <span className="progress-indicator-bar" style={{ width: `${progress.done}%` }} />
            </div>
          </>
        )}

        {stage === "list" &&
          (available.length ? (
            <>
              <p>
                <b>{available.length} critical update{available.length === 1 ? "" : "s"}</b> {available.length === 1 ? "is" : "are"} available. Choose which to install:
              </p>
              <ul className="wuList">
                {available.map((u) => (
                  <li key={u.id}>
                    <input
                      id={`wu-${u.id}`}
                      type="checkbox"
                      checked={picked.includes(u.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, u.id] : picked.filter((p) => p !== u.id))}
                    />
                    <label htmlFor={`wu-${u.id}`}>
                      <b>{u.name}</b> <span className="wuSize">({u.size.toLocaleString()} KB)</span>
                      <br />
                      <span className="wuAbout">{u.about}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="wuButtons">
                <span>
                  Download size: {totalKb.toLocaleString()} KB, about {Math.max(1, Math.round(totalKb / 7 / 60))} min at 56 Kbps
                </span>
                <button type="button" className="wuBig" disabled={!queue.length} onClick={install}>
                  Install Now
                </button>
              </div>
            </>
          ) : (
            <>
              <p>
                <b>Your computer is up to date.</b> There are no new updates for you right now. Check back again in 1999.
              </p>
              <button type="button" className="wuBig" onClick={() => setStage("welcome")}>
                OK
              </button>
            </>
          ))}

        {stage === "installing" && current && (
          <>
            <p>
              Downloading and installing update {progress.index + 1} of {queue.length}:
              <br />
              <b>{current.name}</b>
            </p>
            <div className="progress-indicator wuBar">
              <span className="progress-indicator-bar" style={{ width: `${Math.min(100, (progress.done / current.size) * 100)}%` }} />
            </div>
            <p>Overall progress</p>
            <div className="progress-indicator segmented wuBar">
              <span className="progress-indicator-bar" style={{ width: `${overall * 100}%` }} />
            </div>
            <p className="wuAbout">Estimated time left: {Math.floor(secondsLeft / 60)} min {secondsLeft % 60} sec (at 56 Kbps). Please don't pick up the phone.</p>
          </>
        )}

        {stage === "done" && (
          <>
            <p>
              <b>Installation complete.</b> You must restart your computer for the new settings to take effect.
            </p>
            <p>Do you want to restart your computer now?</p>
            <div className="wuButtons">
              <span />
              <button type="button" className="wuBig" onClick={() => window.dispatchEvent(new CustomEvent("98ish:restart"))}>
                Restart Now
              </button>
              <button type="button" className="wuBig" onClick={() => onClose?.()}>
                Later
              </button>
            </div>
          </>
        )}
      </div>

      <div className="status-bar">
        <p className="status-bar-field">
          {stage === "installing" ? "Downloading..." : stage === "scanning" ? "Connecting to update.98ish.com..." : "Done"}
        </p>
        <p className="status-bar-field wuStatusRight">Internet zone</p>
      </div>
    </div>
  )
}

export default WindowsUpdate
