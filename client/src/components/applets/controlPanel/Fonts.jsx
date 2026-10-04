import React, { useState } from "react"
import Dialog from "../../shared/Dialog"
import { useOpenGesture } from "../../../hooks/useMediaQuery"

// The fonts 98ish uses. The pixel font comes with 98ish (98.css); the rest are the
// device's own, with the next one in line standing in where a device doesn't have it.
export const FONTS = [
  { name: "Pixelated MS Sans Serif", family: '"Pixelated MS Sans Serif", Arial, sans-serif', file: "MS_SANS_SERIF.WOFF2", from: "Comes with 98ish", use: "Nearly everything: windows, menus, buttons and the taskbar." },
  { name: "Pixelated MS Sans Serif Bold", family: '"Pixelated MS Sans Serif", Arial, sans-serif', weight: 700, file: "MS_SANS_SERIF_BOLD.WOFF2", from: "Comes with 98ish", use: "Title bars and bold labels." },
  { name: "Arial", family: "Arial, Helvetica, sans-serif", file: "ARIAL.TTF", from: "This device", use: "Text in the games, Calendar and Mail." },
  { name: "Arial Black", family: '"Arial Black", Impact, Arial, sans-serif', file: "ARIBLK.TTF", from: "This device", use: "Big titles in the games." },
  { name: "Courier New", family: '"Courier New", Courier, monospace', file: "COUR.TTF", from: "This device", use: "MS-DOS Prompt and fixed-width text." },
  { name: "Lucida Console", family: '"Lucida Console", "Courier New", monospace', file: "LUCON.TTF", from: "This device", use: "Code and terminal screens." },
  { name: "Times New Roman", family: '"Times New Roman", Times, serif', file: "TIMES.TTF", from: "This device", use: "WordPad documents and old web pages." },
  { name: "Georgia", family: "Georgia, serif", file: "GEORGIA.TTF", from: "This device", use: "Love Letters and Our Story." },
  { name: "Tahoma", family: "Tahoma, Verdana, sans-serif", file: "TAHOMA.TTF", from: "This device", use: "Small print in some programs." },
  { name: "Verdana", family: "Verdana, Arial, sans-serif", file: "VERDANA.TTF", from: "This device", use: "Headings in Control Panel and web pages." },
  { name: "Trebuchet MS", family: '"Trebuchet MS", Verdana, sans-serif', file: "TREBUC.TTF", from: "This device", use: "Pickleball 98 and other games." },
  { name: "Comic Sans MS", family: '"Comic Sans MS", "Comic Sans", "Chalkboard SE", cursive', file: "COMIC.TTF", from: "This device", use: "Floppy's tips and playful labels." },
  { name: "Handwriting", family: '"Segoe Script", "Bradley Hand", "Snell Roundhand", cursive', file: "SCRIPT.TTF", from: "This device", use: "Handwritten notes in Us." },
]

const SIZES = [12, 18, 24, 36, 48]

// Fonts: a folder of the fonts above; opening one shows it at several sizes, as Windows
// 98's font viewer did
const Fonts = ({ onClose }) => {
  const [selected, setSelected] = useState(null)
  const [viewing, setViewing] = useState(null)
  const openGesture = useOpenGesture()
  const font = FONTS.find((f) => f.name === selected)

  return (
    <div className="cplSheet" data-applet="Fonts">
      <div className="window cplPanel cplSunken" style={{ background: "#fff" }}>
        <div
          className="cplFonts"
          role="listbox"
          aria-label="Fonts"
          onKeyDown={(e) => {
            const at = FONTS.findIndex((f) => f.name === selected)
            const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
            if (step) {
              e.preventDefault()
              const next = FONTS[Math.max(0, Math.min(FONTS.length - 1, at + step))]
              setSelected(next.name)
              e.currentTarget.querySelector(`[data-font="${CSS.escape(next.name)}"]`)?.focus()
            } else if (e.key === "Enter" && font) setViewing(font)
          }}
        >
          {FONTS.map((f, i) => (
            <div
              key={f.name}
              data-font={f.name}
              role="option"
              tabIndex={selected === f.name || (!selected && i === 0) ? 0 : -1}
              aria-selected={selected === f.name}
              className={selected === f.name ? "cplFont is-selected" : "cplFont"}
              title={f.use}
              onClick={() => setSelected(f.name)}
              onFocus={() => setSelected(f.name)}
              {...openGesture(() => setViewing(f))}
            >
              <img src="/assets/program_icons/cpl/fontfile.svg" alt="" draggable="false" />
              <span>{f.name}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="status-bar cplStatus" style={{ margin: "4px 0 0" }}>
        <p className="status-bar-field">{font ? `${font.file} — ${font.use}` : `${FONTS.length} font(s)`}</p>
      </div>
      <div className="cplButtons">
        <button type="button" disabled={!font} onClick={() => setViewing(font)}>
          Open
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      {viewing && (
        <Dialog title={viewing.name} onOk={() => setViewing(null)} okLabel="Done">
          <div className="cplFontView hc-keep" style={{ fontFamily: viewing.family, fontWeight: viewing.weight || 400 }}>
            <p style={{ fontFamily: '"Pixelated MS Sans Serif", Arial, sans-serif', fontWeight: 400 }}>
              <b>{viewing.name}</b> ({viewing.from}, {viewing.file})
              <br />
              Used for: {viewing.use}
            </p>
            <hr />
            <p style={{ fontSize: 14 }}>abcdefghijklmnopqrstuvwxyz</p>
            <p style={{ fontSize: 14 }}>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
            <p style={{ fontSize: 14 }}>1234567890.:,;&apos;&quot;(!?)+-*/=</p>
            <hr />
            {SIZES.map((size) => (
              <p key={size} style={{ fontSize: size }}>
                <span style={{ fontFamily: '"Pixelated MS Sans Serif", Arial, sans-serif', fontSize: 11, fontWeight: 400, marginRight: 8 }}>{size}</span>
                The quick brown fox jumps over the lazy dog.
              </p>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default Fonts
