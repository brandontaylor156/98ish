import React, { useEffect, useRef, useState } from "react"
import { setSettings, useSettings } from "../../utils/settings"
import "./Helper.css"

// Floppy, the 98ish helper: a floppy disk who pops up with tips when you open things.
// Click him for another tip. Hide him from his bubble or in Display Properties.

const WELCOME = "Hi, I'm Floppy! I hold 1.44 MB of helpful tips. Click me any time for one."

const TIPS = {
  Notepad: [
    "Writing something? Search > Replace swaps one word for another everywhere at once.",
    "Press F5 in Notepad to stamp the time and date.",
    "Start a file with .LOG and Notepad adds the time every time you open it. Instant diary!",
  ],
  "MS-DOS Prompt": [
    "Type HELP for every command. TREE /F draws your whole drive.",
    "Up arrow brings back your last command, and Tab finishes file names.",
    "Try ECHO hello > hi.txt, then TYPE hi.txt. Old-school file making!",
  ],
  "My Computer": [
    "Right-click a file and choose Send To > Desktop to make a shortcut.",
    "Drag files from here onto the desktop, or onto another My Computer window to move them.",
    "Deleted something by accident? It's waiting in the Recycle Bin.",
  ],
  Minesweeper: ["Click both mouse buttons on a number to clear around it, if you've flagged enough mines."],
  Tetris: ["Hold a piece for later with the Hold box. Saves lives."],
  "Internet Explorer": ["Change the date in the toolbar to see websites the way they looked back then."],
  "98 Messenger": ["Away messages are serious business. Choose yours wisely."],
  "Task Manager": ["Whatever you do, don't end explorer.exe. I'm serious. Mostly."],
  "Display Properties": ["Pick Browse... to use your own picture as the wallpaper."],
  SPECTRA: ["Fly through the rings to keep your combo going!"],
  "Windows Update": ["Updates arrive at authentic 56k speeds. Please don't pick up the phone."],
  Paint: ["Right-click a color to make it the background color. File > Set As Wallpaper shows off your art."],
  Solitaire: ["Double-click a card to send it home to the top row. Win, and watch the cards bounce!"],
  FreeCell: ["Game > Select Game picks any of 32,000 numbered deals. Almost all of them can be won."],
  Pinball: ["Spell D-I-V-E in the top lanes to raise your multiplier. The flippers move the lit lanes!"],
  Calculator: ["View > Scientific has sines, logs and binary. Very serious business."],
  "Media Player": ["Every song in My Music was made right here in your browser. No files, all synth!"],
  "Desktop Themes": ["Uncheck a box to keep that part of your current look. Click Pointers, Sounds, etc... to hear a theme first."],
  "System Properties": ["The Achievements tab has a hint for every secret you haven't found yet."],
  WordPad: ["Format > Paragraph indents a paragraph, and Insert > Object drops in a picture you made in Paint."],
  "Sound Recorder": ["Record yourself, then try Effects > Increase Speed. Instant chipmunk!"],
  Backup: ["Sign on to 98 Messenger and turn on sync, and your files follow you to any computer. Even your phone!"],
  "98ish Mail": ["Start typing a buddy's name in the To box and pick them from the list. Mail SmarterChild for a surprise!"],
  "HomePage Studio": ["Click any block in the preview to edit it. Publish, and your page shows up in the 98ish Web Ring!"],
  "Network Neighborhood": [
    "Double-click someone's computer to send them a file or challenge them to Checkers.",
    "Drag a picture from My Computer onto someone's computer to send it to them.",
  ],
  Reversi: ["Corners can never be flipped. Grab them, and stay off the squares next to them until you can."],
  Chess: ["Drag a piece or click it, then click where it goes. Level in the menu makes the computer tougher."],
  Battleship: ["Press R (or right-click) to turn a ship while you place it. Random does it all for you."],
  "Block Ten": [
    "Keep a 3x3 hole open somewhere. The big square always shows up when you have no room for it!",
    "Clear lines on moves in a row for a streak bonus. Pieces with no room left turn gray.",
  ],
  Downhill: ["Press Space in the air off a ramp to spin. Just land before the spin ends!", "Something lives up on that mountain. Keep moving after 2,000 m..."],
  "Sunny Acres": ["Swipe across a whole row of ripe fields to harvest them all at once!", "Your crops keep growing while Sunny Acres is closed. Come back later for a full Barn."],
}

const GENERAL = [
  "Right-click the desktop to make a new folder or text document right there.",
  "Start > Run... opens programs by name. Try WINMINE or COMMAND.",
  "Shut Down has a Restart in MS-DOS mode option. Type WIN to come back.",
  "Your files are saved in this browser, so they're still here next time.",
  "Arrange your icons from the desktop's right-click menu.",
  "Everything here is free, including me. Especially me.",
  "Keyboard shortcuts: hold Alt and tap Q to switch windows, Ctrl+Esc opens Start, Ctrl+Alt+E opens My Computer, Ctrl+Alt+D shows the desktop, Ctrl+Alt+R is Run. (On a Mac, Alt is Option.)",
  "Right-click the taskbar to tile your windows, or drag a desktop icon onto the little icons next to Start.",
  "There are secrets hidden all over 98ish. Right-click My Computer and choose Properties to see which ones you've found.",
]

const pick = (list) => list[Math.floor(Math.random() * list.length)]

const Helper = ({ windows, mobile }) => {
  const settings = useSettings()
  const [tip, setTip] = useState(null)
  const [mood, setMood] = useState("idle") // idle | talk | wave
  const seen = useRef(new Set())
  const lastShown = useRef(0)
  const known = useRef(0)

  const say = (text, wave = false) => {
    lastShown.current = Date.now()
    setTip(text)
    setMood(wave ? "wave" : "talk")
  }

  // hello, once per visit
  useEffect(() => {
    if (!settings.helper) return
    const t = setTimeout(() => say(WELCOME, true), 3500)
    return () => clearTimeout(t)
  }, [])

  // a tip for each program, the first time it's opened (not too chatty)
  useEffect(() => {
    const opened = windows.slice(known.current)
    known.current = windows.length
    if (!settings.helper) return
    const fresh = opened.reverse().find((w) => !w.closed && TIPS[w.program || w.name] && !seen.current.has(w.program || w.name))
    if (!fresh) return
    const name = fresh.program || fresh.name
    seen.current.add(name)
    if (Date.now() - lastShown.current < 45000) return
    const t = setTimeout(() => say(pick(TIPS[name])), 1200)
    return () => clearTimeout(t)
  }, [windows.length])

  useEffect(() => {
    if (mood === "idle") return
    const t = setTimeout(() => setMood("idle"), 2400)
    return () => clearTimeout(t)
  }, [mood, tip])

  if (!settings.helper) return null
  // on phones every window fills the screen: only appear on the bare desktop
  if (mobile && windows.some((w) => !w.closed && !w.minimized)) return null

  const nextTip = () => {
    const open = windows.filter((w) => !w.closed && !w.minimized && TIPS[w.program || w.name])
    const pool = [...GENERAL, ...open.flatMap((w) => TIPS[w.program || w.name])]
    let text = pick(pool)
    if (text === tip && pool.length > 1) text = pick(pool.filter((p) => p !== tip))
    say(text)
  }

  return (
    <div className="helper" data-mood={mood}>
      {tip && (
        <div className="helperBubble" role="status">
          <p>{tip}</p>
          <div className="helperButtons">
            <button type="button" onClick={() => setTip(null)}>
              Thanks!
            </button>
            <button type="button" onClick={nextTip}>
              Another tip
            </button>
            <button
              type="button"
              onClick={() => {
                setTip(null)
                setSettings({ helper: false })
              }}
              title="Bring him back from the floppy in the taskbar tray, or Display Properties > Startup"
            >
              Hide Floppy
            </button>
          </div>
        </div>
      )}
      <button type="button" className="helperFloppy" aria-label="Floppy, the helper: click for a tip" onClick={nextTip}>
        <svg viewBox="0 0 64 72" width="64" height="72" aria-hidden="true">
          <ellipse className="helperShadow" cx="32" cy="69" rx="20" ry="3" />
          <g className="helperBody">
            <path d="M6 6h46l8 8v46a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V8a2 2 0 0 1 2-2z" fill="#2d3e9c" stroke="#111a52" strokeWidth="2" />
            <rect x="17" y="6" width="28" height="18" rx="1" fill="#c9ced6" stroke="#6b7280" strokeWidth="1.5" />
            <rect x="35" y="9" width="6" height="12" fill="#2d3e9c" />
            <rect x="10" y="32" width="44" height="28" rx="2" fill="#f4f1e6" stroke="#111a52" strokeWidth="1.5" />
            <g className="helperEyes">
              <ellipse cx="23" cy="43" rx="5" ry="6" fill="#fff" stroke="#111" strokeWidth="1.2" />
              <ellipse cx="41" cy="43" rx="5" ry="6" fill="#fff" stroke="#111" strokeWidth="1.2" />
              <circle className="helperPupil" cx="24" cy="44" r="2.4" fill="#111" />
              <circle className="helperPupil" cx="42" cy="44" r="2.4" fill="#111" />
            </g>
            <path className="helperMouth" d="M26 53q6 5 12 0" fill="none" stroke="#111" strokeWidth="2" strokeLinecap="round" />
            <path className="helperBrow" d="M17 35l9 2M47 35l-9 2" stroke="#111" strokeWidth="1.6" strokeLinecap="round" />
            <path className="helperArm" d="M60 40q8-6 6-14" fill="none" stroke="#111a52" strokeWidth="3" strokeLinecap="round" />
          </g>
        </svg>
      </button>
    </div>
  )
}

export default Helper
