import React, { useEffect, useState } from "react"
import Dialog from "../../shared/Dialog"
import { fs } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { playSystemSound } from "../../../utils/systemSounds"
import { launch } from "../../../utils/programs"
import { currentUserId, keysOf, rawGet } from "../../../utils/users"
import { PropSheet, bytesText } from "./Sheet"
import KeepSafe, { useKeepSafe } from "../../shared/KeepSafe"
import MoreOptions from "../../shared/MoreOptions"
import { getSyncFolders, statusText, useDriveSync } from "../../../utils/driveSync"
import { isIos, isStandalone } from "../../../utils/push"
import { brainBytes, deleteBrain } from "../floppy/brain"

// What the space in this browser holds, for the breakdown: localStorage keys by what uses
// them (after the per-person prefix 98ish.u.<id>. is taken off)
const GROUPS = [
  [/^fs\b/, "My files (C:) and the Recycle Bin"],
  [/^wallpaper/, "Wallpaper picture"],
  [/^ie\./, "Internet Explorer"],
  [/^(cal|calendar|clock)\b/, "Calendar and Clock"],
  [/^notifications/, "Notifications"],
  [/^(aim|messenger|buddy|im)\b/, "98 Messenger"],
  [/^mail/, "98ish Mail"],
  [/^(settings|desktopIcons|desktopView|mobileIcons|quickLaunch|cpl|run)\b/, "Desktop and settings"],
  [/^achievements/, "Achievements"],
  [/^(couple|us|letters|story|pet)\b/, "Us"],
  [/^(drive|sync|backup)/, "Online drive sync"],
]
const groupOf = (key) => {
  const rest = key.replace(/^98ish\.(u\.[^.]+\.)?/, "")
  for (const [re, label] of GROUPS) if (re.test(rest)) return label
  return "Games and other programs"
}

const breakdown = () => {
  const all = []
  try {
    for (let i = 0; i < localStorage.length; i++) all.push(localStorage.key(i))
  } catch {
    return { mine: [], others: 0, total: 0 }
  }
  const sizeOf = (key) => (key.length + (rawGet(key) || "").length) * 2 // UTF-16
  const mineKeys = new Set(keysOf(currentUserId(), all))
  const groups = new Map()
  let others = 0
  let total = 0
  for (const key of all) {
    const size = sizeOf(key)
    total += size
    if (mineKeys.has(key)) groups.set(groupOf(key), (groups.get(groupOf(key)) || 0) + size)
    else if (key.startsWith("98ish.")) others += size
  }
  return { mine: [...groups].sort((a, b) => b[1] - a[1]), others, total }
}

// the Windows 98 disk pie: blue for used, magenta for free
const Pie = ({ used, total }) => {
  const share = total > 0 ? Math.min(1, used / total) : 0
  const angle = share * 2 * Math.PI
  const x = 40 + 34 * Math.sin(angle)
  const y = 30 - 22 * Math.cos(angle)
  return (
    <svg width="84" height="70" viewBox="0 0 84 70" role="img" aria-label={`${Math.round(share * 100)}% used`}>
      <ellipse cx="40" cy="40" rx="34" ry="22" fill="#800080" stroke="#000" />
      <path d="M6 30v10M74 30v10" stroke="#000" />
      <ellipse cx="40" cy="30" rx="34" ry="22" fill="#ff00ff" stroke="#000" />
      {share >= 0.999 ? <ellipse cx="40" cy="30" rx="34" ry="22" fill="#0000ff" stroke="#000" /> : share > 0.002 && <path d={`M40 30L40 8A34 22 0 ${share > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`} fill="#0000ff" stroke="#000" />}
    </svg>
  )
}

// Storage: how much this browser lets 98ish keep and how much it uses (the Storage API's
// estimate, which covers everything 98ish keeps here), whether the browser may clear it,
// what uses it, and the Recycle Bin.
// Floppy's brain (applets/floppy): the on-device AI model's files, if downloaded
const FloppyBrainRow = () => {
  const [bytes, setBytes] = useState(0)
  const look = () => brainBytes().then(setBytes)
  useEffect(() => {
    look()
  }, [])
  if (!bytes) return null
  return (
    <fieldset>
      <legend>Floppy's brain</legend>
      <div className="cplRow">
        <span data-storage="floppy">On-device AI model for Ask Floppy: {bytesText(bytes)}</span>
        <button type="button" className="cplEnd" onClick={() => deleteBrain().then(look)} data-action="delete-floppy-brain">
          Delete
        </button>
      </div>
    </fieldset>
  )
}

const Storage = ({ dispatch, onClose }) => {
  useFsVersion()
  const [estimate, setEstimate] = useState(null) // { usage, quota, usageDetails } | "none"
  const [persisted, setPersisted] = useState(null) // true | false | "none"
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [parts] = useState(breakdown)
  const bin = fs.recycleBin.content.length
  const sync = useDriveSync()
  const keepSafe = useKeepSafe()

  const refresh = async () => {
    const api = navigator.storage
    try {
      setEstimate(api?.estimate ? await api.estimate() : "none")
    } catch {
      setEstimate("none")
    }
    try {
      setPersisted(api?.persisted ? await api.persisted() : "none")
    } catch {
      setPersisted("none")
    }
  }
  useEffect(() => {
    refresh()
  }, [])

  const keep = async () => {
    setAsking(true)
    try {
      const ok = await navigator.storage.persist()
      setNote(ok ? "Done: this browser won't clear 98ish's files to make room." : "The browser said no for now. Browsers usually allow it once a site is installed (Add to Home Screen) or used often.")
    } catch {
      setNote("The browser couldn't be asked.")
    }
    setAsking(false)
    refresh()
  }

  const known = estimate && estimate !== "none"
  const details = known && estimate.usageDetails ? Object.entries(estimate.usageDetails).filter(([, v]) => v > 0) : []
  const NAMES = { indexedDB: "Databases (IndexedDB)", caches: "Offline copy (caches)", serviceWorkerRegistrations: "Service worker", fileSystem: "File system" }

  return (
    <PropSheet name="Storage Properties" tabs={[{ id: "general", label: "General" }]} tab="general" onTab={() => {}} onOk={onClose}>
      <div className="cplHead">
        <img src="/assets/program_icons/cpl/storage.svg" alt="" />
        <p>98ish keeps your files, settings and scores in this browser, on this device.</p>
      </div>
      <fieldset>
        <legend>This device</legend>
        {!estimate && <p>Checking...</p>}
        {estimate === "none" && <p>This browser doesn't say how much space it gives 98ish.</p>}
        {known && (
          <div className="cplPie">
            <Pie used={estimate.usage || 0} total={estimate.quota || 0} />
            <table className="cplTable">
              <tbody>
                <tr>
                  <th scope="row">
                    <span className="cplSwatch hc-keep" style={{ background: "#0000ff" }} />
                    Used space:
                  </th>
                  <td className="cplNum" data-storage="used">{bytesText(estimate.usage || 0)}</td>
                </tr>
                <tr>
                  <th scope="row">
                    <span className="cplSwatch hc-keep" style={{ background: "#ff00ff" }} />
                    Free space:
                  </th>
                  <td className="cplNum">{bytesText(Math.max(0, (estimate.quota || 0) - (estimate.usage || 0)))}</td>
                </tr>
                <tr>
                  <th scope="row">Capacity:</th>
                  <td className="cplNum" data-storage="quota">{bytesText(estimate.quota || 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p data-storage="persist">
          {persisted === true && "Kept: the browser won't clear 98ish's files when the device runs low on space."}
          {persisted === false && "Not kept yet: if the device runs low on space, the browser may clear 98ish's files."}
          {persisted === "none" && "This browser doesn't say whether it may clear 98ish's files."}
        </p>
        {persisted === false && (
          <div className="cplRow">
            <button type="button" disabled={asking} onClick={keep}>
              Keep my files on this device
            </button>
          </div>
        )}
        {persisted !== true && isIos() && !isStandalone() && (
          <p className="cplHint" data-storage="ios">
            On iPhone and iPad, Safari clears a website's files after about 7 days without a visit. Add 98ish to your Home Screen (Share, then Add to Home Screen) and open it from there to stop that.
          </p>
        )}
        {note && <p className="cplHint">{note}</p>}
      </fieldset>
      <fieldset>
        <legend>Keep your files safe</legend>
        {keepSafe ? (
          <KeepSafe place="storage" closable={false} />
        ) : (
          <p data-storage="online">
            A copy is kept online too: file sync with 98 Messenger{sync.screenName ? ` (${sync.screenName})` : ""} keeps {getSyncFolders().join(", ")} on every device you sign on from. {statusText(sync)}
          </p>
        )}
      </fieldset>
      {/* the breakdown: one tap further (docs/simplicity.md) */}
      <MoreOptions id="storage.details" label="What uses it" lessLabel="Hide details" summary={details.length ? details.map(([k, v]) => `${NAMES[k] || k}: ${bytesText(v)}`).join(" · ") : "Desktop, settings, programs"}>
        {details.length > 0 && (
          <p className="cplHint">
            {details.map(([k, v]) => `${NAMES[k] || k}: ${bytesText(v)}`).join(" · ")}
          </p>
        )}
        <fieldset>
          <legend>What uses it (local storage)</legend>
          <table className="cplTable">
            <tbody>
              {parts.mine.map(([label, size]) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td className="cplNum">{bytesText(size)}</td>
                </tr>
              ))}
              {parts.others > 0 && (
                <tr>
                  <td>Other people on this computer</td>
                  <td className="cplNum">{bytesText(parts.others)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </fieldset>
      </MoreOptions>
      <FloppyBrainRow />
      <fieldset>
        <legend>Recycle Bin</legend>
        <div className="cplRow">
          <img src={bin ? "/assets/recycle_bin_full.png" : "/assets/recycle_bin_empty.png"} alt="" width="32" height="32" />
          <span data-storage="bin">{bin ? `${bin} item${bin === 1 ? "" : "s"} in the Recycle Bin` : "The Recycle Bin is empty."}</span>
          <button type="button" className="cplEnd" disabled={!bin} onClick={() => setConfirm(true)}>
            Empty Recycle Bin
          </button>
        </div>
      </fieldset>
      <div className="cplRow">
        <button type="button" onClick={() => dispatch({ type: "open_window", payload: launch("System Properties") })}>
          My Computer Properties...
        </button>
        <button type="button" onClick={() => dispatch({ type: "open_window", payload: launch("Backup") })}>
          Backup...
        </button>
      </div>
      {confirm && (
        <Dialog
          title="Confirm Multiple File Delete"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            fs.emptyRecycleBin()
            playSystemSound("recycle")
            setConfirm(false)
            setTimeout(refresh, 400)
          }}
          onCancel={() => setConfirm(false)}
        >
          <p className="dialogText">Are you sure you want to delete all of the items in the Recycle Bin? This can't be undone.</p>
        </Dialog>
      )}
    </PropSheet>
  )
}

export default Storage
