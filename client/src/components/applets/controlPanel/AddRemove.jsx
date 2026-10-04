import React, { useEffect, useMemo, useState } from "react"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { summarize } from "../../../utils/disclosure"
import { programs } from "../../../utils/programs"
import { Check, PropSheet, bytesText, sheetButtons, useDraft } from "./Sheet"

// Each program's download size comes from program-sizes.json, which the build writes (the
// size of the program's own code and styles, by chunk name; vite.config.js). Most chunks
// are named after the program; these aren't.
const CHUNKS = {
  "Internet Explorer": "InternetExplorer",
  "98 Messenger": "Messenger",
  "MS-DOS Prompt": "MsDos",
  "Task Manager": "TaskManager",
  "YouTube '98": "VideoPlayer",
  "Media Player": "MediaPlayer",
  "Sound Recorder": "SoundRecorder",
  "Character Map": "CharMap",
  "Network Neighborhood": "NetWindow",
  Hearts: "NetWindow",
  WinPopup: "NetWindow",
  Reversi: "NetWindow",
  Chess: "NetWindow",
  Checkers: "NetWindow",
  Battleship: "NetWindow",
  "98ish Mail": "Mail",
  "HomePage Studio": "HomePageStudio",
  "Pickleball 98": "Pickleball",
  "Shred 98": "Shred",
  Downhill: "Ski",
  "Speed Typist 98": "SpeedType",
  "Sunny Acres": "Town",
  "Photo Puzzle": "Puzzle",
  "Doodle Together": "Doodle",
  "Lovebirds Quiz Show": "Quiz",
  "Dream House": "Dollhouse",
  "Our Pet": "Pet",
  "Appward 98": "Appward",
  "Welcome to 98ish": "Welcome",
  "Love Letters": "LoveLetters",
  "Our Story": "OurStory",
  "Block Ten": "BlockTen",
  "Word Duel": "WordDuel",
  "Last Card": "LastCard",
  "Monster Duel": "MonsterDuel",
}
const chunkOf = (p) => (p.app === "webapp" ? "WebApp" : CHUNKS[p.name] || p.name.replace(/[^a-z0-9]/gi, ""))

let sizesCache = null
const loadSizes = () =>
  (sizesCache ||= fetch("/program-sizes.json")
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({})))

// the programs you can take off: everything in a Start menu folder
const LISTED = programs.filter((p) => p.group).sort((a, b) => a.name.localeCompare(b.name))

// Add/Remove Programs: the programs, their sizes, and whether each shows on the desktop and
// in the Start menu. "Removing" one hides it from both; it can come back from here, and
// Start > Run still opens it.
const AddRemove = ({ onClose }) => {
  const d = useDraft(["hiddenDesktop", "hiddenStart"])
  const { draft, update } = d
  const [sizes, setSizes] = useState({})
  const [selected, setSelected] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [find, setFind] = useState("")
  useEffect(() => {
    let live = true
    loadSizes().then((s) => live && setSizes(s || {}))
    return () => {
      live = false
    }
  }, [])

  const sizeOf = (p) => sizes[chunkOf(p)] || 0
  const total = useMemo(() => [...new Set(LISTED.map(chunkOf))].reduce((sum, c) => sum + (sizes[c] || 0), 0), [sizes])
  const onDesktop = (p) => p.desktop !== false && p.desktop !== "paired"
  const removed = (p) => (!onDesktop(p) || draft.hiddenDesktop.includes(p.name)) && draft.hiddenStart.includes(p.name)
  const program = LISTED.find((p) => p.name === selected) || null
  const words = find.trim().toLowerCase()
  const shown = words ? LISTED.filter((p) => `${p.name} ${p.group}`.toLowerCase().includes(words)) : LISTED

  const toggle = (key, name, show) => update({ [key]: show ? draft[key].filter((n) => n !== name) : [...draft[key], name] })
  const setRemoved = (p, remove) =>
    update({
      hiddenStart: remove ? [...new Set([...draft.hiddenStart, p.name])] : draft.hiddenStart.filter((n) => n !== p.name),
      hiddenDesktop: remove ? (onDesktop(p) ? [...new Set([...draft.hiddenDesktop, p.name])] : draft.hiddenDesktop) : draft.hiddenDesktop.filter((n) => n !== p.name),
    })

  const onKeyDown = (e) => {
    const at = shown.findIndex((p) => p.name === selected)
    const step = { ArrowDown: 1, ArrowUp: -1, Home: -999, End: 999 }[e.key]
    if (step === undefined) return
    e.preventDefault()
    if (!shown.length) return
    const next = shown[Math.max(0, Math.min(shown.length - 1, (at < 0 ? -1 : at) + step))]
    setSelected(next.name)
    e.currentTarget.querySelector(`[data-name="${CSS.escape(next.name)}"]`)?.scrollIntoView({ block: "nearest" })
  }

  return (
    <PropSheet name="Add/Remove Programs" tabs={[{ id: "install", label: "Install/Uninstall" }]} tab="install" onTab={() => {}} {...sheetButtons(d, onClose)}>
      <div className="cplHead">
        <img src="/assets/program_icons/cpl/programs.svg" alt="" />
        <p>Select a program, then Add/Remove takes it off the desktop and out of the Start menu (or brings it back). Start &gt; Run opens any program either way.</p>
      </div>
      <input type="search" className="cplFind" value={find} placeholder="Find a program" aria-label="Find a program" onChange={(e) => setFind(e.target.value)} />
      <ul className="cplList cplSunken" role="listbox" aria-label="Programs" tabIndex={0} style={{ height: 190 }} onKeyDown={onKeyDown}>
        {shown.map((p) => (
          <li
            key={p.name}
            data-name={p.name}
            role="option"
            aria-selected={selected === p.name}
            className={(selected === p.name ? "is-selected" : "") + (removed(p) ? " is-removed" : "")}
            onClick={() => setSelected(p.name)}
          >
            <img src={p.icon} alt="" />
            <span className="cplListName">
              {p.name}
              {removed(p) ? " (removed)" : ""}
            </span>
            <span className="cplListSize">{sizeOf(p) ? bytesText(sizeOf(p)) : ""}</span>
          </li>
        ))}
        {!shown.length && <li className="cplEmpty">No program called "{find.trim()}".</li>}
      </ul>
      <p className="cplHint" style={{ margin: "4px 0 8px" }}>
        {LISTED.length} programs{total ? `, ${bytesText(total)} in all` : ""}
      </p>
      {program ? (
        <fieldset>
          <legend>{program.name}</legend>
          <p>
            {sizeOf(program) ? `Size: ${bytesText(sizeOf(program))}. ` : ""}Start menu: Programs &gt; {program.group}
          </p>
          <div className="cplRow">
            <button type="button" className="cplEnd" onClick={() => (removed(program) ? setRemoved(program, false) : setConfirm(program))}>
              Add/Remove...
            </button>
          </div>
          {/* only the desktop, or only the Start menu: More options */}
          <MoreOptions
            id="addremove.where"
            summary={summarize(onDesktop(program) && (draft.hiddenDesktop.includes(program.name) ? "Not on the desktop" : "On the desktop"), draft.hiddenStart.includes(program.name) ? "Not in the Start menu" : "In the Start menu")}
          >
            {onDesktop(program) && <Check label="Show on the desktop" checked={!draft.hiddenDesktop.includes(program.name)} onChange={(show) => toggle("hiddenDesktop", program.name, show)} />}
            <Check label="Show in the Start menu" checked={!draft.hiddenStart.includes(program.name)} onChange={(show) => toggle("hiddenStart", program.name, show)} />
          </MoreOptions>
        </fieldset>
      ) : (
        <p className="cplHint">Select a program to see its size and where it shows.</p>
      )}
      {confirm && (
        <Dialog
          title="Confirm Program Removal"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            setRemoved(confirm, true)
            setConfirm(null)
          }}
          onCancel={() => setConfirm(null)}
        >
          <p className="dialogText">Are you sure you want to remove '{confirm.name}' from the desktop and the Start menu? Its files and scores stay, and you can bring it back here.</p>
        </Dialog>
      )}
    </PropSheet>
  )
}

export default AddRemove
