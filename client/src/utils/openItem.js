import { fs, readContent } from "./fs"
import { hyperlinks } from "./hyperlinks"
import { explorerWindow, ieWindow, launch, webWindow, mediaPlayerWindow, notepadWindow, photosWindow, programByType, recorderWindow, windowFor, wordpadWindow } from "./programs"
import { helpHandoff } from "./help"
import { latestPlayer } from "../components/applets/mediaPlayer/bus"
import { unlockAudio } from "../components/applets/mediaPlayer/audio"

// What opening a file-system item does, everywhere it can be opened (My Computer, search,
// the Start menu, MS-DOS `start`). Returns false if the item can't be opened.
export const openItem = (item, dispatch) => {
  if (!item) return false
  if (item.type === "shortcut") {
    const target = fs.resolve(item.textContent)
    return !!target && target.type !== "shortcut" && openItem(target, dispatch)
  }
  if (item.isDirectory) {
    dispatch({ type: "open_window", payload: explorerWindow(fs.partsOf(item)) })
    return true
  }
  if (item.type === "text" || item.type === "note") {
    dispatch({ type: "open_window", payload: notepadWindow(item) })
    return true
  }
  // pictures open in Photos (its Share > Open in Paint, or Edit in My Computer, for Paint)
  if (item.type === "image") {
    dispatch({ type: "open_window", payload: photosWindow(item) })
    return true
  }
  if (item.type === "richtext") {
    dispatch({ type: "open_window", payload: wordpadWindow(item) })
    return true
  }
  // a song file: Music 98 plays it (and the rest of its folder after it)
  if (item.type === "song") {
    dispatch({ type: "open_window", payload: launch("Music 98", { handoff: { id: Date.now(), play: item.path } }) })
    return true
  }
  if (item.type === "sound") {
    dispatch({ type: "open_window", payload: recorderWindow(item) })
    return true
  }
  if (item.type === "internet") {
    const url = hyperlinks[item.name] || item.textContent
    if (!url) return false
    // the authors' GitHub projects open in a real tab; 98ish's own pages in Internet
    // Explorer; the rest of the Web in Compass
    if (/github\.com/.test(url)) window.open(url, "_blank", "noopener")
    else dispatch({ type: "open_window", payload: webWindow(url) })
    return true
  }
  if (item.type === "music") {
    // an old built-in synth song (.MID; retired 2026-10-06): Media Player, which now plays your
    // own songs and recordings
    unlockAudio()
    const player = latestPlayer()
    if (player) dispatch({ type: "focus_window", payload: { index: player.index } })
    else dispatch({ type: "open_window", payload: mediaPlayerWindow() })
    return true
  }
  // a 3D model (C:\My 3D): 3D Viewer 98
  if (item.type === "model3d") {
    dispatch({ type: "open_window", payload: launch("3D Viewer 98", { handoff: { id: Date.now(), open: fs.partsOf(item).join("/") } }) })
    return true
  }
  // a Visual Basic 98 program (.vb98): run it
  if (item.type === "vbapp") {
    dispatch({ type: "open_window", payload: launch("Visual Basic 98", { name: item.name.replace(/\.vb98$/i, ""), handoff: { id: Date.now(), run: fs.partsOf(item).join("/") } }) })
    return true
  }
  // LAN Party 98: a bundled DOS game's program (DOOM.EXE), a Flash movie, a DOS saved game;
  // Virtual PC 98: its saved machine
  if (item.type === "dosgame") {
    dispatch({ type: "open_window", payload: launch("LAN Party 98", { handoff: { id: Date.now(), game: item.textContent } }) })
    return true
  }
  if (item.type === "swf") {
    readContent(item).then((src) => src && dispatch({ type: "open_window", payload: launch("LAN Party 98", { handoff: { id: Date.now(), flash: src, name: item.name } }) }))
    return true
  }
  if (item.type === "dossave") {
    if (/\.v86$/i.test(item.name)) dispatch({ type: "open_window", payload: launch("Virtual PC 98") })
    else dispatch({ type: "open_window", payload: launch("LAN Party 98", { handoff: { id: Date.now(), game: item.name.replace(/\.sav$/i, "").toLowerCase() } }) })
    return true
  }
  // a contact card (.vcf): the Address Book offers to import it
  if (item.type === "vcard") {
    dispatch({ type: "open_window", payload: launch("Address Book", { handoff: { id: Date.now(), importFile: item } }) })
    return true
  }
  const program = programByType(item.type)
  if (!program) return false
  dispatch({ type: "open_window", payload: windowFor(program) })
  return true
}

// Something the MS-DOS Prompt or Run... asked to open: { item } | { file } | { program } | { url }
export const openTarget = (target, dispatch) => {
  if (target.item) return openItem(target.item, dispatch)
  if (target.file) return dispatch({ type: "open_window", payload: notepadWindow(target.file) }), true
  if (target.url) return dispatch({ type: "open_window", payload: webWindow(target.url) }), true
  if (target.program) return dispatch({ type: "open_window", payload: launch(target.program) }), true
  // 98ish Help at a topic or a program's page (the DOS prompt's HELP TETRIS)
  if (target.help) return dispatch({ type: "open_window", payload: launch("98ish Help", helpHandoff(target.help)) }), true
  return false
}
