import { fs } from "./fs"
import { hyperlinks } from "./hyperlinks"
import { explorerWindow, ieWindow, launch, notepadWindow, programByType, windowFor } from "./programs"

// What opening a file-system item does, everywhere it can be opened (My Computer, search,
// the Start menu, MS-DOS `start`). Returns false if the item can't be opened.
export const openItem = (item, dispatch) => {
  if (!item) return false
  if (item.isDirectory) {
    dispatch({ type: "open_window", payload: explorerWindow(fs.partsOf(item)) })
    return true
  }
  if (item.type === "text" || item.type === "note") {
    dispatch({ type: "open_window", payload: notepadWindow(item) })
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
