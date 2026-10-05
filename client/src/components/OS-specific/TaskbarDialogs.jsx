import React, { useState } from "react"
import Dialog from "../shared/Dialog"
import { setSettings } from "../../utils/settings"
import { getWeatherPrefs, setWeatherPrefs } from "../../utils/weatherPrefs"

// The taskbar's dialogs, fetched the first time one opens: Taskbar Properties and
// Keyboard Shortcuts.

// what each shortcut does (TaskBar.jsx handles the keys)
export const SHORTCUTS = [
  ["Alt+Q (hold Alt)", "Switch between windows. Keep pressing Q to move along, let go of Alt to pick. Alt+` works too; add Shift to go backwards."],
  ["Ctrl+Esc, or the Windows/Command key alone", "Open the Start menu. Then the arrow keys move, Enter opens, Esc goes back."],
  ["Alt+F4", "Close the active window."],
  ["Shift+F10, or the Menu key", "The right-click menu of the selected icon or item."],
  ["Tab, then Enter", "Move between desktop icons, buttons and boxes; Enter opens."],
  ["Ctrl+Alt+E", "Open My Computer."],
  ["Ctrl+Alt+D", "Show the desktop (press again to bring the windows back)."],
  ["Ctrl+Alt+R", "Run..."],
  ["Ctrl+Alt+K", "This list of shortcuts."],
  ["Ctrl+Alt+L, or Windows/Command+L", "Lock 98ish (set a PIN or password in Passwords first)."],
]

const TaskbarProperties = ({ settings, mobile, onClose }) => {
  const [draft, setDraft] = useState({
    taskbarAutoHide: settings.taskbarAutoHide,
    taskbarClock: settings.taskbarClock,
    quickLaunch: settings.quickLaunch,
    weatherTray: getWeatherPrefs().tray,
  })
  // (the weather is Weather's own setting)
  const apply = () => {
    const { weatherTray, ...rest } = draft
    setSettings(rest)
    setWeatherPrefs({ tray: weatherTray })
  }
  const toggle = (key) => (e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))
  return (
    <Dialog
      title="Taskbar Properties"
      onOk={() => (apply(), onClose())}
      onNo={apply}
      noLabel="Apply"
      onCancel={onClose}
    >
      <div className="tbPreview" aria-hidden="true">
        <div className="tbPreviewWindow">
          <div className="tbPreviewTitle" />
        </div>
        <div className={draft.taskbarAutoHide ? "tbPreviewBar is-hidden" : "tbPreviewBar"}>
          <span className="tbPreviewStart">Start</span>
          {draft.quickLaunch && <span className="tbPreviewQuick" />}
          <span className="tbPreviewTab" />
          {draft.weatherTray && <span className="tbPreviewClock">72°</span>}
          {draft.taskbarClock && <span className="tbPreviewClock">12:45</span>}
        </div>
      </div>
      <div className="field-row">
        <input id="tb-autohide" type="checkbox" checked={draft.taskbarAutoHide} disabled={mobile} onChange={toggle("taskbarAutoHide")} />
        <label htmlFor="tb-autohide">Auto hide</label>
      </div>
      <div className="field-row">
        <input id="tb-clock" type="checkbox" checked={draft.taskbarClock} onChange={toggle("taskbarClock")} />
        <label htmlFor="tb-clock">Show clock</label>
      </div>
      <div className="field-row">
        <input id="tb-weather" type="checkbox" checked={draft.weatherTray} onChange={toggle("weatherTray")} />
        <label htmlFor="tb-weather">Show weather (choose the place in Weather)</label>
      </div>
      <div className="field-row">
        <input id="tb-quick" type="checkbox" checked={draft.quickLaunch} disabled={mobile} onChange={toggle("quickLaunch")} />
        <label htmlFor="tb-quick">Show Quick Launch</label>
      </div>
      {mobile && <p className="dialogText tbNote">Auto hide and Quick Launch are for bigger screens.</p>}
    </Dialog>
  )
}

const ShortcutsDialog = ({ onClose }) => (
  <Dialog title="Keyboard Shortcuts" onOk={onClose} onCancel={onClose}>
    <table className="shortcutTable">
      <tbody>
        {SHORTCUTS.map(([keys, what]) => (
          <tr key={keys}>
            <th scope="row">{keys}</th>
            <td>{what}</td>
          </tr>
        ))}
      </tbody>
    </table>
    <p className="dialogText tbNote">On a Mac, Alt is Option. Browsers keep some keys for themselves (like Alt+Tab), so these use others.</p>
  </Dialog>
)

const TaskbarDialog = ({ kind, ...props }) => (kind === "properties" ? <TaskbarProperties {...props} /> : <ShortcutsDialog {...props} />)

export default TaskbarDialog
