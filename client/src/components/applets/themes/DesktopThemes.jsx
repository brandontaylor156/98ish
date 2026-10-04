import React, { useState } from "react"
import Dialog from "../../shared/Dialog"
import { Screensaver, optionsFor, saverById } from "../../screensavers"
import { CURSORS, ICON_STYLES, getSettings, schemeFor, setSettings, useSettings, wallpaperStyle } from "../../../utils/settings"
import { SOUND_EVENTS, previewSound } from "../../../utils/systemSounds"
import { unlock } from "../../../utils/achievements"
import { PARTS, THEMES, matchesTheme, themeById, themePatch } from "./themes"
import "./DesktopThemes.css"

const CURRENT = "current"
const ALL_PARTS = Object.fromEntries(PARTS.map((p) => [p.id, true]))
const PREVIEW_ICONS = [
  ["My Computer", "/assets/program_icons/computer_explorer.png"],
  ["Recycle Bin", "/assets/recycle_bin_empty.png"],
  ["Network Neighborhood", "/assets/program_icons/network.svg"],
]
const cursorUrl = (id) => CURSORS[id]?.match(/url\("([^"]+)"\)/)?.[1]

// Desktop Themes, as in Windows 98: pick a theme, see it in the preview, choose which
// parts of it to use, and Apply. "Current Windows settings" is whatever's on now.
const DesktopThemes = ({ onClose }) => {
  const settings = useSettings()
  const [choice, setChoice] = useState(() => {
    const t = themeById(getSettings().theme)
    return t && matchesTheme(t, getSettings()) ? t.id : CURRENT
  })
  const [parts, setParts] = useState(ALL_PARTS)
  const [extra, setExtra] = useState(null) // "sounds" | "saver"

  const theme = themeById(choice)
  // what the preview shows: the current settings with the theme's checked parts on top
  const look = theme ? { ...settings, ...themePatch(theme, parts, settings) } : settings
  const scheme = schemeFor(look.scheme)
  const changed = !!theme && Object.entries(themePatch(theme, parts, settings)).some(([k, v]) => JSON.stringify(settings[k]) !== JSON.stringify(v))

  const apply = () => {
    if (!theme) return
    setSettings(themePatch(theme, parts, getSettings()))
    unlock("theme")
  }

  const saverId = saverById(look.screensaver) ? look.screensaver : null

  return (
    <div className="dtRoot">
      <div className="dtTop">
        <label htmlFor="dt-theme">Theme:</label>
        <select id="dt-theme" value={choice} onChange={(e) => setChoice(e.target.value)}>
          <option value={CURRENT}>Current Windows settings</option>
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="dtMain">
        <div className="dtPreview" aria-label="Preview" style={{ ...wallpaperStyle({ ...look, display: "stretch" }) }}>
          <div className="dtIcons" style={{ "--icon-filter": ICON_STYLES[look.iconStyle] || "none" }}>
            {PREVIEW_ICONS.map(([label, src]) => (
              <div key={label} className="dtIcon">
                <img src={src} alt="" draggable="false" />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="dtWin dtWin--inactive">
            <div className="dtWinTitle" style={{ background: `linear-gradient(90deg, ${scheme.inactive[0]}, ${scheme.inactive[1]})` }}>
              Inactive Window
            </div>
          </div>
          <div className="dtWin">
            <div className="dtWinTitle" style={{ background: `linear-gradient(90deg, ${scheme.title[0]}, ${scheme.title[1]})` }}>
              Active Window
            </div>
            <div className="dtWinBody">
              Window Text
              {cursorUrl(look.cursor) && <img className="dtCursor" src={cursorUrl(look.cursor)} alt="" />}
            </div>
          </div>
        </div>

        <div className="dtSide">
          <fieldset className="dtField">
            <legend>Previews</legend>
            <button type="button" disabled={!saverId} onClick={() => setExtra("saver")}>
              Screen Saver
            </button>
            <button type="button" onClick={() => setExtra("sounds")}>
              Pointers, Sounds, etc...
            </button>
          </fieldset>
          <fieldset className="dtField">
            <legend>Settings</legend>
            {PARTS.map((p) => (
              <div className="field-row" key={p.id}>
                <input
                  id={`dt-${p.id}`}
                  type="checkbox"
                  checked={parts[p.id]}
                  disabled={!theme}
                  onChange={(e) => setParts((s) => ({ ...s, [p.id]: e.target.checked }))}
                />
                <label htmlFor={`dt-${p.id}`}>{p.label}</label>
              </div>
            ))}
          </fieldset>
        </div>
      </div>

      <p className="dtBlurb">{theme ? theme.blurb : "These are the settings you're using now. Pick a theme above to try a new look."}</p>

      <div className="dtButtons">
        <button
          type="button"
          className="default"
          onClick={() => {
            if (changed) apply()
            onClose?.()
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

      {extra === "saver" && saverId && (
        <Screensaver id={saverId} settings={optionsFor(saverId, look.screensaverOptions)} onExit={() => setExtra(null)} />
      )}
      {extra === "sounds" && (
        <Dialog title={`${theme ? theme.label : "Current"} - Pointers and Sounds`} onOk={() => setExtra(null)} onCancel={() => setExtra(null)}>
          <p className="dialogText">Click a sound to hear it:</p>
          <ul className="dtSounds">
            {SOUND_EVENTS.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => previewSound(s.id, look.soundScheme)}>
                  {"▶︎"} {s.label}
                </button>
              </li>
            ))}
          </ul>
          <p className="dialogText">
            Pointer:{" "}
            {cursorUrl(look.cursor) ? <img className="dtPointer" src={cursorUrl(look.cursor)} alt={look.cursor} /> : "Standard"}
          </p>
          {look.cursorTrail && look.cursorTrail !== "none" && (
            <p className="dialogText">Mouse trail: {look.cursorTrail === "hearts" ? "Hearts" : "Sparkles"}</p>
          )}
        </Dialog>
      )}
    </div>
  )
}

export default DesktopThemes
