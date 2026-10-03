import React, { useEffect, useState } from "react"
import ContextMenu from "../shared/ContextMenu"
import Dialog from "../shared/Dialog"
import { requestClose } from "../../utils/shell"

// 98ish's own right-click menu everywhere, instead of the browser's. Anything that has its
// own menu (the desktop, the taskbar, My Computer, games that use the right button...)
// handles the event first and calls preventDefault; this catches everything else:
//   a title bar      -> the window menu (Restore, Minimize, Maximize, Close)
//   a text box       -> Undo, Cut, Copy, Paste, Delete, Select All
//   a link / picture -> open it, copy its address
//   anything else    -> Copy (if text is selected), Select All, and the window menu
// On touch screens text boxes keep the phone's own menu (it's the only reliable paste).
// Pages inside frames (Internet Explorer, YouTube, project apps) keep theirs: a page from
// another site can't be reached.

const coarse = () => !!window.matchMedia?.("(pointer: coarse)").matches

const editableOf = (el) => {
  const field = el.closest?.("textarea, input, [contenteditable=''], [contenteditable='true']")
  if (!field) return null
  if (field.tagName === "INPUT" && !/^(text|search|email|url|tel|password|number|)$/i.test(field.type)) return null
  return field
}

const exec = (command, value) => {
  try {
    return document.execCommand(command, false, value)
  } catch {
    return false
  }
}

const GlobalMenu = ({ windows, dispatch }) => {
  const [menu, setMenu] = useState(null) // { x, y, items }
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    const onMenu = (e) => {
      if (e.defaultPrevented) return
      const target = e.target
      // inside our own menus and dialogs: nothing extra
      if (target.closest?.(".contextMenu, .menuBar .menu")) return e.preventDefault()
      const field = editableOf(target)
      if (field && coarse()) return // the phone's own copy/paste callout
      e.preventDefault()
      const at = { x: e.clientX, y: e.clientY }
      const winEl = target.closest?.("[data-window-index]")
      const index = winEl ? Number(winEl.dataset.windowIndex) : -1
      const win = index >= 0 ? windows[index] : null

      const windowItems = win
        ? [
            { label: "Restore", disabled: !win.maximized && !win.minimized, onClick: () => dispatch({ type: win.minimized ? "focus_window" : "toggle_maximize", payload: { index, name: win.name } }) },
            { label: "Minimize", onClick: () => dispatch({ type: "toggle_minimize", payload: { index, name: win.name, minimized: win.minimized, active: win.active } }) },
            { label: "Maximize", disabled: !!win.maximized, onClick: () => dispatch({ type: "toggle_maximize", payload: { index, name: win.name } }) },
            "-",
            { label: "Close", bold: true, onClick: () => requestClose(index) },
          ]
        : []

      // the title bar: just the window menu
      if (win && target.closest(".title-bar")) return setMenu({ ...at, items: windowItems })

      if (field) {
        field.focus({ preventScroll: true })
        const hasSel = field.isContentEditable
          ? !!window.getSelection()?.toString()
          : field.selectionStart !== field.selectionEnd
        const readOnly = field.readOnly || field.disabled
        return setMenu({
          ...at,
          items: [
            { label: "Undo", disabled: readOnly, onClick: () => (field.focus(), exec("undo")) },
            "-",
            { label: "Cut", disabled: readOnly || !hasSel, onClick: () => (field.focus(), exec("cut")) },
            { label: "Copy", disabled: !hasSel, onClick: () => (field.focus(), exec("copy")) },
            {
              label: "Paste",
              disabled: readOnly,
              onClick: async () => {
                try {
                  const text = await navigator.clipboard.readText()
                  field.focus()
                  if (!exec("insertText", text)) setNotice("Use Ctrl+V to paste here.")
                } catch {
                  setNotice("This browser only lets you paste with Ctrl+V (or Cmd+V).")
                }
              },
            },
            { label: "Delete", disabled: readOnly || !hasSel, onClick: () => (field.focus(), exec("delete")) },
            "-",
            { label: "Select All", onClick: () => (field.focus(), field.select ? field.select() : exec("selectAll")) },
          ],
        })
      }

      const selection = window.getSelection()?.toString() || ""
      const link = target.closest?.("a[href]")
      const img = target.closest?.("img")
      const items = []
      if (link) {
        items.push(
          { label: "Open Link in New Window", bold: true, onClick: () => window.open(link.href, "_blank", "noopener") },
          { label: "Copy Shortcut", onClick: () => navigator.clipboard?.writeText(link.href).catch(() => {}) },
          "-"
        )
      } else if (img && img.src && !img.src.startsWith("data:")) {
        items.push(
          { label: "Open Picture in New Window", onClick: () => window.open(img.src, "_blank", "noopener") },
          { label: "Copy Picture Address", onClick: () => navigator.clipboard?.writeText(img.src).catch(() => {}) },
          "-"
        )
      }
      items.push(
        { label: "Copy", disabled: !selection, onClick: () => navigator.clipboard?.writeText(selection).catch(() => exec("copy")) },
        {
          label: "Select All",
          disabled: !win,
          onClick: () => {
            const body = winEl?.querySelector(".window-body, [class*=Root], .title-bar ~ *") || winEl
            const range = document.createRange()
            range.selectNodeContents(body)
            const sel = window.getSelection()
            sel.removeAllRanges()
            sel.addRange(range)
          },
        }
      )
      if (win) items.push("-", ...windowItems)
      setMenu({ ...at, items })
    }
    window.addEventListener("contextmenu", onMenu)
    return () => window.removeEventListener("contextmenu", onMenu)
  }, [windows, dispatch])

  return (
    <>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      {notice && (
        <div className="globalMenuLayer">
          <Dialog title="Paste" sound="ding" onOk={() => setNotice(null)}>
            <p className="dialogText">{notice}</p>
          </Dialog>
        </div>
      )}
    </>
  )
}

export default GlobalMenu
