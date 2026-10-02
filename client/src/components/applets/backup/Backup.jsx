import React, { useEffect, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { useAim } from "../aim/AimContext"
import { useFsVersion } from "../../../hooks/useFs"
import { launch } from "../../../utils/programs"
import { downloadBlob } from "../../../utils/fileTransfer"
import { MAX_BACKUP_BYTES, MAX_ONLINE_BYTES, backupFileName, countDrive, createBackup, formatBytes, readBackup, restoreBackup } from "../../../utils/driveSnapshot"
import { exportDrive } from "../../../utils/fs"
import { deleteOnlineCopy, fetchOnlineInfo, isSyncEnabled, onlineSize, setSyncEnabled, statusText, syncNow, useDriveSync } from "../../../utils/driveSync"
import "./Backup.css"

// Backup: save the whole C: drive (plus settings and achievements) to a file on your real
// computer and restore it later, and keep an online copy with your 98 Messenger account.

const LAST_KEY = "98ish.backup.last"

const readLast = () => {
  try {
    return Number(localStorage.getItem(LAST_KEY)) || null
  } catch {
    return null
  }
}

const when = (date) =>
  date ? new Date(date).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : ""

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`

const describe = (c) => `${plural(c.files, "file")} in ${plural(c.folders, "folder")}`

const Backup = ({ dispatch, mobile }) => {
  useFsVersion()
  const aim = useAim()
  const sync = useDriveSync()
  const [enabled, setEnabled] = useState(isSyncEnabled)
  const [last, setLast] = useState(readLast)
  const [dialog, setDialog] = useState(null)
  const [online, setOnline] = useState(null) // { revision, savedAt, size } | { error }
  const fileRef = useRef(null)

  const signedOn = aim?.status === "online"
  const screenName = aim?.me?.screenName
  const here = countDrive(exportDrive())

  // what's in the online copy (refreshed after each sync)
  useEffect(() => {
    if (!signedOn) return setOnline(null)
    let live = true
    fetchOnlineInfo().then((info) => live && setOnline(info))
    return () => {
      live = false
    }
  }, [signedOn, sync.info?.revision, sync.phase === "synced"])

  const backUp = () => {
    try {
      const backup = createBackup()
      const name = backupFileName()
      downloadBlob(JSON.stringify(backup), name, "application/json")
      const now = Date.now()
      try {
        localStorage.setItem(LAST_KEY, String(now))
      } catch {
        // fine
      }
      setLast(now)
      setDialog({ kind: "alert", title: "Backup", text: `Saved ${name} to your computer's Downloads: ${describe(countDrive(backup.drive))}.` })
    } catch (error) {
      setDialog({ kind: "alert", title: "Backup", text: `The backup couldn't be made: ${error.message}` })
    }
  }

  const pickBackup = async (file) => {
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) return setDialog({ kind: "alert", title: "Restore", text: `${file.name} is too big to be a 98ish backup.` })
    let text = ""
    try {
      text = await file.text()
    } catch {
      return setDialog({ kind: "alert", title: "Restore", text: `${file.name} couldn't be read.` })
    }
    const result = readBackup(text)
    if (!result.ok) return setDialog({ kind: "alert", title: "Restore", text: result.error })
    setDialog({ kind: "restore", name: file.name, ...result })
  }

  const restore = () => {
    const result = restoreBackup(dialog.backup)
    if (!result.ok) return setDialog({ kind: "alert", title: "Restore", text: result.error })
    setDialog({ kind: "restored", warning: result.warning })
  }

  const toggleSync = (on) => {
    setEnabled(on)
    setSyncEnabled(on)
  }

  const removeOnline = async () => {
    setDialog(null)
    const result = await deleteOnlineCopy()
    if (!result.ok) return setDialog({ kind: "alert", title: "Online Copy", text: result.error })
    setEnabled(false)
    setOnline({ revision: 0, savedAt: null, size: 0 })
  }

  const size = onlineSize()
  const phaseClass = { synced: "is-ok", error: "is-bad", conflict: "is-bad", syncing: "is-busy", pending: "is-busy" }[sync.phase] || ""

  return (
    <div className={mobile ? "bkRoot is-mobile" : "bkRoot"}>
      <div className="bkBody">
        <div className="bkIntro">
          <img src="/assets/program_icons/backup.svg" alt="" />
          <p>
            Keep a copy of everything on drive C: ({describe(here)}), plus your settings and achievements.
          </p>
        </div>

        <fieldset className="bkGroup">
          <legend>Back up to your computer</legend>
          <p>Saves one .98ish file to your real computer's Downloads folder.</p>
          <div className="bkRow">
            <button type="button" className="bkBackUp" onClick={backUp}>
              Back Up Now
            </button>
            <span className="bkNote">{last ? `Last backup: ${when(last)}` : "No backups yet."}</span>
          </div>
        </fieldset>

        <fieldset className="bkGroup">
          <legend>Restore from a backup</legend>
          <p>Puts back everything from a backup file. This replaces everything on C:.</p>
          <div className="bkRow">
            <button type="button" className="bkRestore" onClick={() => fileRef.current?.click()}>
              Restore...
            </button>
          </div>
        </fieldset>

        <fieldset className="bkGroup">
          <legend>Online copy with 98 Messenger</legend>
          <div className="field-row bkCheck">
            <input type="checkbox" id="bk-sync" checked={enabled} onChange={(e) => toggleSync(e.target.checked)} />
            <label htmlFor="bk-sync">Sync my files with my 98 Messenger account</label>
          </div>
          <p className="bkSmall">Your files and achievements follow you to any computer you sign on from. Settings stay with each computer.</p>
          {signedOn ? (
            <p className="bkSmall">
              Signed on as <b>{screenName}</b>.{" "}
              {online?.error
                ? online.error
                : online?.revision
                  ? `Online copy saved ${when(online.savedAt)} (${formatBytes(online.size)} of ${formatBytes(MAX_ONLINE_BYTES)}).`
                  : online
                    ? "No online copy yet."
                    : "Checking the online copy..."}
            </p>
          ) : (
            <p className="bkSmall">Sign on to 98 Messenger to use your online copy.</p>
          )}
          {size > MAX_ONLINE_BYTES && (
            <p className="bkSmall bkWarn">
              Your drive takes {formatBytes(size)}; an online copy holds {formatBytes(MAX_ONLINE_BYTES)}. Delete some pictures or sounds to sync.
            </p>
          )}
          <div className="bkRow">
            {signedOn ? (
              <>
                <button type="button" className="bkSyncNow" disabled={!enabled || sync.busy} onClick={() => syncNow()}>
                  {sync.phase === "conflict" ? "Choose..." : "Sync Now"}
                </button>
                <button type="button" disabled={!online?.revision || sync.busy} onClick={() => setDialog({ kind: "delete" })}>
                  Delete Online Copy
                </button>
              </>
            ) : (
              <button type="button" onClick={() => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })}>
                Sign On...
              </button>
            )}
          </div>
        </fieldset>
      </div>

      <div className="status-bar bkStatus">
        <p className={`status-bar-field bkStatusText ${phaseClass}`}>
          <span className="bkLight" aria-hidden="true" />
          {statusText(sync)}
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".98ish,application/json"
        className="d-none"
        onChange={(e) => {
          pickBackup(e.target.files[0])
          e.target.value = ""
        }}
      />

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} sound="ding" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}

      {dialog?.kind === "restore" && (
        <Dialog title="Restore" okLabel="Restore" onOk={restore} onCancel={() => setDialog(null)} sound="chord">
          <div className="bkConfirm">
            <img src="/assets/program_icons/backup.svg" alt="" />
            <div>
              <p className="dialogText">
                <b>{dialog.name}</b>
                {dialog.summary.createdAt ? `, made ${when(dialog.summary.createdAt)}` : ""}
              </p>
              <ul className="bkList">
                <li>{describe(dialog.summary)}</li>
                {dialog.summary.recycled > 0 && <li>{plural(dialog.summary.recycled, "item")} in the Recycle Bin</li>}
                <li>{plural(dialog.summary.achievements, "achievement")}</li>
                {dialog.summary.settings && <li>Desktop settings{dialog.summary.wallpaper ? " and wallpaper" : ""}</li>}
              </ul>
              <p className="dialogText">
                <b>This replaces everything on C:.</b> 98ish will restart afterwards. Continue?
              </p>
            </div>
          </div>
        </Dialog>
      )}

      {dialog?.kind === "restored" && (
        <Dialog title="Restore" onOk={() => window.location.reload()}>
          <p className="dialogText">Your backup is restored.{dialog.warning ? ` ${dialog.warning}` : ""} 98ish will restart now.</p>
        </Dialog>
      )}

      {dialog?.kind === "delete" && (
        <Dialog title="Delete Online Copy" okLabel="Yes" cancelLabel="No" onOk={removeOnline} onCancel={() => setDialog(null)} sound="chord">
          <p className="dialogText">
            Delete the online copy saved with {screenName}? The files on this computer stay, and sync turns off.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Backup
