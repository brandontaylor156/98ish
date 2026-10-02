import React, { useState } from "react"
import { VERSION } from "../dos/commands"
import { useAchievements } from "../../../utils/achievements"
import { Trophy } from "../../OS-specific/AchievementToast"
import "./SystemProperties.css"

const TABS = [
  { id: "general", label: "General" },
  { id: "achievements", label: "Achievements" },
]

const userName = () => {
  try {
    return localStorage.getItem("98ish.user") || "Guest"
  } catch {
    return "Guest"
  }
}

// a made-up but plausible product ID, the same every time for this browser
const productId = () => {
  let id
  try {
    id = localStorage.getItem("98ish.productId")
    if (!id) {
      const n = (k) => String(Math.floor(Math.random() * 10 ** k)).padStart(k, "0")
      id = `${n(5)}-OEM-${n(7)}-${n(5)}`
      localStorage.setItem("98ish.productId", id)
    }
  } catch {
    id = "19980-OEM-0098198-00042"
  }
  return id
}

const formatDate = (t) => new Date(t).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })

// My Computer > Properties: the version, who it's registered to, some very impressive
// hardware, and the Achievements found so far (with hints for the rest).
const SystemProperties = ({ tab: initialTab = "general", onClose }) => {
  const [tab, setTab] = useState(initialTab)
  const { unlocked, list, count } = useAchievements()
  const [pid] = useState(productId)

  return (
    <div className="spRoot">
      <menu role="tablist" className="spTabs">
        {TABS.map((t) => (
          <li key={t.id} role="tab" aria-selected={tab === t.id}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setTab(t.id)
              }}
            >
              {t.label}
            </a>
          </li>
        ))}
      </menu>
      <div className="window spPanel" role="tabpanel">
        {tab === "general" && (
          <div className="spGeneral">
            <div className="spLogo" aria-hidden="true">
              <img src="/assets/program_icons/computer_explorer.png" alt="" />
            </div>
            <div className="spFacts">
              <p className="spHead">System:</p>
              <p className="spIndent">
                {VERSION.replace(/\s*\[.*\]/, "")}
                <br />
                Second Edition
                <br />
                {VERSION.match(/Version ([\d.]+)/)?.[1] || "4.10.1998"} A
              </p>
              <p className="spHead">Registered to:</p>
              <p className="spIndent">
                {userName()}
                <br />
                The 98ish Desktop Club
                <br />
                {pid}
              </p>
              <p className="spHead">Computer:</p>
              <p className="spIndent">
                98ish Turbo 400 MHz processor
                <br />
                64.0MB RAM
                <br />
                3D accelerator with a whole 8MB
                <br />
                {count} of {list.length} achievements found
              </p>
            </div>
          </div>
        )}

        {tab === "achievements" && (
          <div className="spAch">
            <div className="spAchHead">
              <span>
                Found <b>{count}</b> of {list.length}
              </span>
              <div className="progress-indicator segmented spProgress">
                <span className="progress-indicator-bar" style={{ width: `${(count / list.length) * 100}%` }} />
              </div>
            </div>
            <ul className="spAchList">
              {[...list.filter((a) => unlocked[a.id]), ...list.filter((a) => !unlocked[a.id])].map((a) => {
                const got = unlocked[a.id]
                return (
                  <li key={a.id} className={got ? "is-unlocked" : "is-locked"} data-achievement={a.id}>
                    <Trophy size={24} locked={!got} />
                    <div>
                      <b>{got ? a.title : "???"}</b>
                      <span>{got ? a.text : `Hint: ${a.hint}`}</span>
                    </div>
                    {got && <time>{formatDate(got)}</time>}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </div>
      <div className="spButtons">
        <button type="button" className="default" onClick={() => onClose?.()}>
          OK
        </button>
        <button type="button" onClick={() => onClose?.()}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export default SystemProperties
