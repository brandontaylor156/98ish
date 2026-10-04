import React, { useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import ScreenSaverTab from "./ScreenSaverTab"
import {
  CURSOR_TRAILS,
  SCHEMES,
  WALLPAPERS,
  getSettings,
  getWallpaperImage,
  loadWallpaperFile,
  saveWallpaperImage,
  schemeFor,
  setSettings,
  wallpaperStyle,
} from "../../../utils/settings"
import { shellAction } from "../../../utils/shell"
import { unlock } from "../../../utils/achievements"
import "./DisplayProperties.css"

const TABS = [
  { id: "background", label: "Background" },
  { id: "screensaver", label: "Screen Saver" },
  { id: "appearance", label: "Appearance" },
  { id: "startup", label: "Startup" },
]

// Display Properties: wallpaper (built-in, patterns, or your own picture), screen saver,
// color scheme, and the startup screen and sound. Changes preview in the little monitor;
// Apply or OK puts them on the desktop.
const DisplayProperties = ({ tab: initialTab = "background", onClose }) => {
  const [tab, setTab] = useState(initialTab)
  const [draft, setDraft] = useState(getSettings)
  const [image, setImage] = useState(getWallpaperImage)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const saved = getSettings()
  const changed = JSON.stringify(draft) !== JSON.stringify(saved) || image !== getWallpaperImage()
  const update = (patch) => setDraft((d) => ({ ...d, ...patch }))

  const apply = () => {
    if (image && image !== getWallpaperImage() && !saveWallpaperImage(image)) {
      setError("That picture is too big to keep in this browser. Try a smaller one.")
      return false
    }
    setSettings(draft)
    if (draft.wallpaper === "custom") unlock("wallpaper")
    return true
  }

  const pickFile = async (file) => {
    try {
      const data = await loadWallpaperFile(file)
      setImage(data)
      update({ wallpaper: "custom" })
    } catch (message) {
      setError(String(message))
    }
  }

  // the preview uses the draft settings, and the draft picture
  const preview = (() => {
    if (draft.wallpaper !== "custom" || !image) return wallpaperStyle(draft)
    const style = wallpaperStyle({ ...draft, wallpaper: "vaporwave" })
    return { ...style, backgroundImage: `url("${image}")` }
  })()
  const scheme = schemeFor(draft.scheme)
  const screenStyle = { ...preview, backgroundSize: draft.display === "tile" ? undefined : preview.backgroundSize === "auto" ? "40%" : preview.backgroundSize }

  return (
    <div className="dpRoot">
      <menu role="tablist" className="dpTabs">
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
      <div className="window dpPanel" role="tabpanel">
        {(tab === "background" || tab === "appearance") && (
          <div className="dpMonitor" aria-hidden="true">
            <div className="dpScreen" style={screenStyle}>
              <div className="dpMiniWindow">
                <div className="dpMiniTitle" style={{ background: `linear-gradient(90deg, ${scheme.title[0]}, ${scheme.title[1]})` }}>
                  Active Window
                </div>
                <div className="dpMiniBody">Window Text</div>
              </div>
            </div>
            <div className="dpStand" />
          </div>
        )}

        {tab === "background" && (
          <div className="dpRow">
            <fieldset className="dpField">
              <legend>Wallpaper</legend>
              <ul className="dpList" role="listbox" aria-label="Wallpaper">
                {WALLPAPERS.map((w) => (
                  <li key={w.id} role="option" aria-selected={draft.wallpaper === w.id}>
                    <button
                      type="button"
                      className={draft.wallpaper === w.id ? "is-selected" : ""}
                      onClick={() => (w.id === "custom" && !image ? fileRef.current?.click() : update({ wallpaper: w.id }))}
                    >
                      {w.label}
                    </button>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div className="dpSide">
              <button type="button" onClick={() => fileRef.current?.click()}>
                Browse...
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  pickFile(e.target.files[0])
                  e.target.value = ""
                }}
              />
              <label htmlFor="dp-display">Display:</label>
              <select id="dp-display" value={draft.display} onChange={(e) => update({ display: e.target.value })}>
                <option value="stretch">Stretch</option>
                <option value="center">Center</option>
                <option value="tile">Tile</option>
              </select>
              <button type="button" className="dpThemes" onClick={() => shellAction("themes")}>
                Themes...
              </button>
            </div>
          </div>
        )}

        {tab === "screensaver" && <ScreenSaverTab draft={draft} update={update} screenStyle={screenStyle} />}

        {tab === "appearance" && (
          <div className="dpStack">
            <label htmlFor="dp-scheme">Scheme:</label>
            <select id="dp-scheme" value={draft.scheme} onChange={(e) => update({ scheme: e.target.value })}>
              {SCHEMES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <p className="dpHint">The scheme colors the title bars and the desktop behind patterns.</p>
            <label htmlFor="dp-trail">Mouse trail:</label>
            <select id="dp-trail" value={draft.cursorTrail || "none"} onChange={(e) => update({ cursorTrail: e.target.value })}>
              {CURSOR_TRAILS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="dpHint">A little trail of sparkles or hearts follows the mouse (not on touch screens, or when your system asks for less motion).</p>
          </div>
        )}

        {tab === "startup" && (
          <div className="dpStack">
            <fieldset className="dpField">
              <legend>When 98ish starts</legend>
              <div className="field-row">
                <input id="dp-boot" type="checkbox" checked={draft.bootScreen} onChange={(e) => update({ bootScreen: e.target.checked })} />
                <label htmlFor="dp-boot">Show the startup screen</label>
              </div>
              <div className="field-row">
                <input id="dp-sound" type="checkbox" checked={draft.startupSound} onChange={(e) => update({ startupSound: e.target.checked })} />
                <label htmlFor="dp-sound">Play the startup sound</label>
              </div>
            </fieldset>
            <fieldset className="dpField">
              <legend>Sounds</legend>
              <div className="field-row">
                <input id="dp-system" type="checkbox" checked={draft.systemSounds} onChange={(e) => update({ systemSounds: e.target.checked })} />
                <label htmlFor="dp-system">Play system sounds (dings, minimize, Recycle Bin...)</label>
              </div>
            </fieldset>
            <fieldset className="dpField">
              <legend>Helper</legend>
              <div className="field-row">
                <input id="dp-helper" type="checkbox" checked={draft.helper} onChange={(e) => update({ helper: e.target.checked })} />
                <label htmlFor="dp-helper">Show Floppy, the helper, with tips</label>
              </div>
            </fieldset>
            <p className="dpHint">Browsers only allow sound after you click or tap, so the chime plays on your first click if it can't play sooner.</p>
          </div>
        )}
      </div>

      <div className="dpButtons">
        <button
          type="button"
          className="default"
          onClick={() => {
            if (apply()) onClose?.()
          }}
        >
          OK
        </button>
        <button type="button" onClick={() => onClose?.()}>
          Cancel
        </button>
        <button type="button" disabled={!changed} onClick={apply}>
          Apply
        </button>
      </div>

      {error && (
        <Dialog title="Display Properties" sound="ding" onOk={() => setError(null)}>
          <p className="dialogText">{error}</p>
        </Dialog>
      )}
    </div>
  )
}

export default DisplayProperties
