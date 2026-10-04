import { fs } from "./fs"
import { hyperlinks } from "./hyperlinks"
import { explorerWindow, ieWindow, launch, mediaPlayerWindow, notepadWindow, photosWindow, programByType, recorderWindow, windowFor, wordpadWindow } from "./programs"
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
  if (item.type === "sound") {
    dispatch({ type: "open_window", payload: recorderWindow(item) })
    return true
  }
  if (item.type === "internet") {
    const url = hyperlinks[item.name] || item.textContent
    if (!url) return false
    // the authors' GitHub projects open in a real tab; the rest in Internet Explorer
    if (/github\.com/.test(url)) window.open(url, "_blank", "noopener")
    else dispatch({ type: "open_window", payload: ieWindow(url) })
    return true
  }
  if (item.type === "music") {
    // start the sound card now, inside the click/tap (iOS needs a gesture)
    unlockAudio()
    const song = item.textContent || item.name
    const player = latestPlayer()
    if (player) {
      player.play(song)
      dispatch({ type: "focus_window", payload: { index: player.index } })
    } else dispatch({ type: "open_window", payload: mediaPlayerWindow(song) })
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
  if (target.url) return dispatch({ type: "open_window", payload: ieWindow(target.url) }), true
  if (target.program) return dispatch({ type: "open_window", payload: launch(target.program) }), true
  return false
}
