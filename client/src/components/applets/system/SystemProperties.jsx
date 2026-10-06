import React, { useEffect, useState } from "react"
import { VERSION } from "../dos/commands"
import { useAchievements } from "../../../utils/achievements"
import { Trophy } from "../../OS-specific/AchievementToast"
import { currentUserName } from "../../../utils/users"
import { deviceLater, deviceNow, formatBytes } from "../../../utils/deviceInfo"
import "./SystemProperties.css"

const TABS = [
  { id: "general", label: "General" },
  { id: "achievements", label: "Achievements" },
]

const userName = currentUserName

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

// My Computer > Properties: the version, who it's registered to, the real device it's
// running on (as far as the browser says: utils/deviceInfo.js), and the Achievements found so
// far (with hints for the rest).
const HIDDEN = "not reported by this browser"
const SystemProperties = ({ tab: initialTab = "general", onClose }) => {
  const [tab, setTab] = useState(initialTab)
  const { unlocked, list, count } = useAchievements()
  const [pid] = useState(productId)
  const [dev] = useState(deviceNow)
  const [later, setLater] = useState(null)
  useEffect(() => {
    let live = true
    deviceLater().then((v) => live && setLater(v))
    return () => {
      live = false
    }
  }, [])

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
              <p className="spIndent" data-selectable>
                {dev.cores ? `${dev.cores}-core processor` : `Processor: ${HIDDEN}`}
                <br />
                {dev.memoryGb ? `${dev.memoryGb >= 8 ? "8 GB or more" : `${dev.memoryGb} GB`} RAM (about)` : `RAM: ${HIDDEN}`}
                <br />
                {later ? later.gpu || `Graphics: ${HIDDEN}` : "Graphics: checking..."}
                <br />
                {dev.screen ? `${dev.screen.width} x ${dev.screen.height} screen${dev.screen.ratio !== 1 ? ` (${dev.screen.ratio}x)` : ""}` : `Screen: ${HIDDEN}`}
                <br />
                {dev.system}
                <br />
                {later ? (later.storage ? `98ish storage: ${formatBytes(later.storage.used)} used of ${formatBytes(later.storage.quota)}` : `Storage: ${HIDDEN}`) : "Storage: checking..."}
                <br />
                {dev.online ? `Online${dev.connection ? ` (${dev.connection})` : ""}` : "Offline"}
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
