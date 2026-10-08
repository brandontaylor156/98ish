import React, { useEffect, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import { useAim } from "../aim/AimContext"
import { useDriveUsage, useFsVersion } from "../../../hooks/useFs"
import { launch } from "../../../utils/programs"
import { downloadBlob } from "../../../utils/fileTransfer"
import { MAX_BACKUP_BYTES, backupFileName, createBackupBlob, formatBytes, readBackup, restoreBackup } from "../../../utils/driveSnapshot"
import { driveSummary } from "../../../utils/fs"
import { deleteOnlineFiles, fetchSyncInfo, getSyncFolders, isSyncEnabled, setSyncEnabled, setSyncFolders, statusText, syncNow, syncableFolders, useDriveSync } from "../../../utils/driveSync"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import "./Backup.css"

// Backup: save the whole C: drive (plus settings and achievements) to a file on your real
// computer and restore it later, and sync your folders with your 98 Messenger account.

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

// "Documents" is shown the way My Computer names it
const folderLabel = (name) => (name === "Documents" ? "My Documents" : name)

const Backup = ({ dispatch, mobile }) => {
  useFsVersion()
  const aim = useAim()
  const sync = useDriveSync()
  const usage = useDriveUsage()
  const [enabled, setEnabled] = useState(isSyncEnabled)
  const [folders, setFolders] = useState(getSyncFolders)
  const [last, setLast] = useState(readLast)
  const [dialog, setDialog] = useState(null)
  const [busy, setBusy] = useState(null)
  const fileRef = useRef(null)

  const signedOn = aim?.status === "online"
  const screenName = aim?.me?.screenName || sync.screenName
  const here = driveSummary()
  const canReach = signedOn || (enabled && sync.phase !== "signedOut")

  // what's online (refreshed after each sync)
  useEffect(() => {
    if (canReach) fetchSyncInfo()
  }, [canReach, sync.lastSync])

  const backUp = async () => {
    setBusy("Making the backup...")
    try {
      const blob = await createBackupBlob()
      const name = backupFileName()
      downloadBlob(blob, name, "application/json")
      const now = Date.now()
      try {
        localStorage.setItem(LAST_KEY, String(now))
      } catch {
        // fine
      }
      setLast(now)
      // big songs/videos/PDFs kept on this device only: just their names are in a backup
      const local = here.deviceOnly ? ` ${here.deviceOnly} big song${here.deviceOnly === 1 ? ", video or PDF is" : "s, videos or PDFs are"} kept on this device only and ${here.deviceOnly === 1 ? "isn't" : "aren't"} in it: keep your own copies of those.` : ""
      setDialog({ kind: "alert", title: "Backup", text: `Saved ${name} (${formatBytes(blob.size)}) to your computer's Downloads: ${describe(here)}.${local}` })
    } catch (error) {
      setDialog({ kind: "alert", title: "Backup", text: `The backup couldn't be made: ${error.message}` })
    } finally {
      setBusy(null)
    }
  }

  const pickBackup = async (file) => {
    if (!file) return
    if (file.size > MAX_BACKUP_BYTES) return setDialog({ kind: "alert", title: "Restore", text: `${file.name} is too big to be a 98ish backup.` })
    setBusy("Reading the backup...")
    let text = ""
    try {
      text = await file.text()
    } catch {
      setBusy(null)
      return setDialog({ kind: "alert", title: "Restore", text: `${file.name} couldn't be read.` })
    }
    const result = readBackup(text)
    setBusy(null)
    if (!result.ok) return setDialog({ kind: "alert", title: "Restore", text: result.error })
    setDialog({ kind: "restore", name: file.name, ...result })
  }

  const restore = async () => {
    const backup = dialog.backup
    setDialog(null)
    setBusy("Restoring...")
    const result = await restoreBackup(backup)
    setBusy(null)
    if (!result.ok) return setDialog({ kind: "alert", title: "Restore", text: result.error })
    setDialog({ kind: "restored", warning: result.warning })
  }

  const toggleSync = (on) => {
    setEnabled(on)
    setSyncEnabled(on)
  }

  const toggleFolder = (name, on) => {
    const next = on ? [...folders, name] : folders.filter((f) => f !== name)
    setFolders(next)
    setSyncFolders(next)
  }

  const removeOnline = async () => {
    setDialog(null)
    setBusy("Deleting the online files...")
    const result = await deleteOnlineFiles()
    setBusy(null)
    if (!result.ok) return setDialog({ kind: "alert", title: "Online Files", text: result.error })
    setEnabled(false)
  }

  const phaseClass = { idle: "is-ok", error: "is-bad", offline: "is-bad", syncing: "is-busy", pending: "is-busy" }[sync.phase] || ""

  return (
    <div className={mobile ? "bkRoot is-mobile" : "bkRoot"}>
      <div className="bkBody">
        <div className="bkIntro">
          <img src="/assets/program_icons/backup.svg" alt="" />
          <p>
            Keep a copy of everything on drive C: ({describe(here)}, {formatBytes(here.bytes)}), plus your settings and achievements.
            {usage?.free != null ? ` ${formatBytes(usage.free)} free.` : ""}
          </p>
        </div>

        {/* the baseline (docs/simplicity.md): sync on or off with Sync Now / Sign On, and
            Back Up Now. Which folders sync, online space, Delete Online Files and Restore
            are under More options, summarized */}
        <fieldset className="bkGroup">
          <legend>Sync with 98 Messenger</legend>
          <div className="field-row bkCheck">
            <input type="checkbox" id="bk-sync" checked={enabled} onChange={(e) => toggleSync(e.target.checked)} />
            <label htmlFor="bk-sync">Sync my files with my 98 Messenger account</label>
          </div>
          {screenName && (signedOn || enabled) ? (
            <p className="bkSmall">
              {signedOn ? "Signed on as" : "Syncing as"} <b>{screenName}</b>.
            </p>
          ) : (
            <p className="bkSmall">Sign on to 98 Messenger to sync your files.</p>
          )}
          <div className="bkRow">
            {signedOn || (enabled && sync.phase !== "signedOut") ? (
              <button type="button" className="bkSyncNow" disabled={!enabled || sync.busy} onClick={() => syncNow()}>
                Sync Now
              </button>
            ) : (
              <button type="button" onClick={() => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })}>
                Sign On...
              </button>
            )}
          </div>
          <MoreOptions
            id="backup.sync"
            label="Sync options"
            lessLabel="Hide sync options"
            className="bkMore"
            summary={summarize(folders.length ? folders.map(folderLabel) : "No folders", sync.quota ? `${formatBytes(sync.usage || 0)} of ${formatBytes(sync.quota)} online` : null)}
          >
            <p className="bkSmall">These folders stay the same on every computer and phone you sign on from. A file changed in two places is kept twice.</p>
            <div className="bkFolders" role="group" aria-label="Folders to sync">
              {syncableFolders().map((name) => (
                <div className="field-row" key={name}>
                  <input type="checkbox" id={`bk-f-${name}`} checked={folders.includes(name)} disabled={!enabled} onChange={(e) => toggleFolder(name, e.target.checked)} />
                  <label htmlFor={`bk-f-${name}`}>{folderLabel(name)}</label>
                </div>
              ))}
            </div>
            {sync.quota ? <p className="bkSmall">Online: {formatBytes(sync.usage || 0)} of {formatBytes(sync.quota)}{sync.files != null ? ` (${plural(sync.files, "file")})` : ""}.</p> : null}
            {sync.quota > 0 && <div className="bkMeter" role="meter" aria-label="Online space used" aria-valuenow={Math.round(((sync.usage || 0) / sync.quota) * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${Math.min(100, ((sync.usage || 0) / sync.quota) * 100)}%` }} /></div>}
            {(signedOn || (enabled && sync.phase !== "signedOut")) && (
              <div className="bkRow">
                <button type="button" disabled={sync.busy || !!busy} onClick={() => setDialog({ kind: "delete" })}>
                  Delete Online Files
                </button>
              </div>
            )}
          </MoreOptions>
        </fieldset>

        <fieldset className="bkGroup">
          <legend>Back up to your computer</legend>
          <p>Saves one .98ish file to your real computer's Downloads folder.</p>
          <div className="bkRow">
            <button type="button" className="bkBackUp" onClick={backUp} disabled={!!busy}>
              Back Up Now
            </button>
            <span className="bkNote">{last ? `Last backup: ${when(last)}` : "No backups yet."}</span>
          </div>
          <MoreOptions id="backup.restore" label="Restore from a backup" lessLabel="Hide Restore" className="bkMore" summary="Puts back everything from a backup file">
            <p>Puts back everything from a backup file. This replaces everything on C:.</p>
            <div className="bkRow">
              <button type="button" className="bkRestore" onClick={() => fileRef.current?.click()} disabled={!!busy}>
                Restore...
              </button>
            </div>
          </MoreOptions>
        </fieldset>
      </div>

      <div className="status-bar bkStatus">
        <p className={`status-bar-field bkStatusText ${busy ? "is-busy" : phaseClass}`}>
          <span className="bkLight" aria-hidden="true" />
          {busy || statusText(sync)}
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
        <Dialog title="Delete Online Files" okLabel="Yes" cancelLabel="No" onOk={removeOnline} onCancel={() => setDialog(null)} sound="chord">
          <p className="dialogText">
            Delete the files synced with {screenName || "your account"}? The files on this {mobile ? "phone" : "computer"} stay, other devices keep theirs, and sync turns off.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Backup
