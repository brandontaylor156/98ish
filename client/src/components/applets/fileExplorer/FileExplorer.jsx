import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { fs, uniqueName, validName } from "../../../utils/fs"
import { imageMapper } from "../../../utils/imageMapper"
import { openItem } from "../../../utils/openItem"
import { launch } from "../../../utils/programs"
import { useFsVersion } from "../../../hooks/useFs"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import { useLongPress } from "../../../hooks/useLongPress"
import "./FileExplorer.css"

// My Computer / Windows Explorer. Each window keeps its own folder and history; files
// can be opened, renamed, deleted (to the Recycle Bin), cut/copied/pasted between
// windows, and imported from your real computer (text files).

// one clipboard for every Explorer window: { mode: "cut" | "copy", items: [Item] }
let clipboard = null

const MAX_IMPORT_BYTES = 200 * 1024

export const iconFor = (item) => "/assets/" + (imageMapper[item.type] || (item.isDirectory ? imageMapper.folder : imageMapper.text))

export const typeName = (item) =>
  item.isDirectory
    ? { drive: "Local Disk", documents: "File Folder", bookmarks: "File Folder", programs: "File Folder" }[item.type] || "File Folder"
    : { text: "Text Document", note: "Text Document", internet: "Internet Shortcut" }[item.type] || "Application"

const sortItems = (items) =>
  [...items].sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })))

const sizeOf = (item) => {
  if (!item.isDirectory) return new Blob([item.textContent]).size
  return item.content.reduce((sum, child) => sum + sizeOf(child), 0)
}

export const formatSize = (bytes) => (bytes < 1024 ? `${bytes} bytes` : `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`)

const FileExplorer = ({ path: initialPath = ["C:"], dispatch, onTitle }) => {
  useFsVersion() // repaint when anything changes the files
  const [nav, setNav] = useState({ stack: [initialPath], index: 0 })
  const [selected, setSelected] = useState(null)
  const [view, setView] = useState("icons") // icons | list
  const [menu, setMenu] = useState(null) // { x, y, item }
  const [dialog, setDialog] = useState(null)
  const [address, setAddress] = useState("")
  const rootRef = useRef(null)
  const importRef = useRef(null)
  const openGesture = useOpenGesture()

  const path = nav.stack[nav.index]
  const dir = path.length ? fs.resolve(path) : fs.root
  const missing = !dir || !dir.isDirectory
  const items = missing ? [] : sortItems(dir.content)
  const selectedItem = selected && items.includes(selected) ? selected : null
  const folderName = path.length ? path.at(-1) : "My Computer"
  const canEdit = !missing && path.length > 0 // the My Computer view (drives) can't be edited

  useEffect(() => {
    setAddress(path.length ? fs.displayPath(dir) || path.join("\\") : "My Computer")
    onTitle?.(folderName)
  }, [path.join("/"), dir?.name])

  // the folder was deleted (here or in another window): go to its nearest surviving parent
  useEffect(() => {
    if (!missing) return
    let parts = path
    while (parts.length && !(fs.resolve(parts)?.isDirectory)) parts = parts.slice(0, -1)
    replacePath(parts)
  })

  const go = (parts) => {
    setSelected(null)
    setNav(({ stack, index }) => ({ stack: [...stack.slice(0, index + 1), parts], index: index + 1 }))
  }
  const replacePath = (parts) => setNav(({ stack, index }) => ({ stack: [...stack.slice(0, index), parts], index }))
  const step = (delta) => {
    setSelected(null)
    setNav(({ stack, index }) => ({ stack, index: Math.min(stack.length - 1, Math.max(0, index + delta)) }))
  }
  const up = () => path.length && go(path.slice(0, -1))

  const open = (item) => {
    if (!item) return
    if (item.isDirectory) return go(fs.partsOf(item))
    if (!openItem(item, dispatch)) setDialog({ kind: "alert", title: item.name, text: "There's no program associated with this file." })
  }

  const fail = (title, error) => setDialog({ kind: "alert", title, text: error.message || String(error) })

  // ---- file operations ----

  const newItem = (kind) => {
    if (!canEdit) return
    const base = kind === "folder" ? "New Folder" : "New Text Document"
    setDialog({ kind: "name", title: kind === "folder" ? "New Folder" : "New Text Document", text: uniqueName(dir, base), create: kind })
  }

  const finishName = () => {
    const name = dialog.text.trim()
    const problem = validName(name)
    if (problem) return setDialog({ ...dialog, error: problem })
    try {
      if (dialog.create === "folder") setSelected(fs.createDirectoryIn(dir, name))
      else if (dialog.create === "file") setSelected(fs.createFileIn(dir, name, "text", ""))
      else dialog.item.name = name // rename
      setDialog(null)
    } catch (error) {
      setDialog({ ...dialog, error: error.message })
    }
  }

  const askDelete = (item) => {
    if (!item || !canEdit) return
    setDialog({ kind: "delete", item })
  }

  const doDelete = (item) => {
    try {
      fs.deleteItem(item)
      setSelected(null)
      setDialog(null)
    } catch (error) {
      fail("Delete", error)
    }
  }

  const rename = (item) => item && canEdit && setDialog({ kind: "name", title: "Rename", text: item.name, item })

  const cut = (item) => item && canEdit && (clipboard = { mode: "cut", items: [item] })
  const copy = (item) => item && canEdit && (clipboard = { mode: "copy", items: [item] })

  const paste = () => {
    if (!clipboard || !canEdit) return
    try {
      for (const item of clipboard.items) {
        if (clipboard.mode === "copy") {
          const dupe = item.copy
          dupe.name = uniqueName(dir, item.name)
          dir.insertItem(dupe)
          setSelected(dupe)
        } else {
          if (item.parent === dir) continue
          for (let p = dir; p; p = p.parent) if (p === item) throw new Error("The destination folder is inside the folder you're moving.")
          item.parent.removeItem(item.name)
          item.name = uniqueName(dir, item.name)
          dir.insertItem(item)
          setSelected(item)
        }
      }
      if (clipboard.mode === "cut") clipboard = null
    } catch (error) {
      fail("Paste", error)
    }
  }

  const properties = (item) => setDialog({ kind: "properties", item: item || dir })

  const importFiles = async (fileList) => {
    if (!canEdit) return
    const skipped = []
    for (const file of fileList) {
      if (file.size > MAX_IMPORT_BYTES) {
        skipped.push(`${file.name} (bigger than 200 KB)`)
        continue
      }
      if (!/^text\//.test(file.type) && !/\.(txt|md|log|csv|json|js|html|css|ini)$/i.test(file.name)) {
        skipped.push(`${file.name} (not a text file)`)
        continue
      }
      const text = await file.text()
      const name = uniqueName(dir, file.name.replace(/\.txt$/i, "").replace(/[\\/:"<>|]/g, "_").slice(0, 64) || "Imported")
      setSelected(fs.createFileIn(dir, name, "text", text))
    }
    if (skipped.length) setDialog({ kind: "alert", title: "Import", text: `These weren't imported: ${skipped.join(", ")}. Only text files up to 200 KB can be imported.` })
  }

  const submitAddress = () => {
    const text = address.trim().replace(/[\\/]+$/, "")
    if (!text || /^my computer$/i.test(text)) return go([])
    const target = fs.resolve(text)
    if (!target) return setDialog({ kind: "alert", title: "Address", text: `Cannot find '${address}'. Make sure the path is correct.` })
    if (target.isDirectory) go(fs.partsOf(target))
    else open(target)
  }

  // ---- menus ----

  const itemMenu = (item) => [
    { label: item.isDirectory ? "Open" : "Open", bold: true, onClick: () => open(item) },
    ...(item.isDirectory ? [{ label: "Explore", onClick: () => dispatch({ type: "open_window", payload: launch("My Computer", { path: fs.partsOf(item) }) }) }] : []),
    "-",
    { label: "Cut", disabled: !canEdit, onClick: () => cut(item) },
    { label: "Copy", disabled: !canEdit, onClick: () => copy(item) },
    "-",
    { label: "Delete", disabled: !canEdit || item.type === "drive", onClick: () => askDelete(item) },
    { label: "Rename", disabled: !canEdit || item.type === "drive", onClick: () => rename(item) },
    "-",
    { label: "Properties", onClick: () => properties(item) },
  ]

  const folderMenu = () => [
    {
      label: "View",
      items: [
        { label: "Large Icons", checked: view === "icons", onClick: () => setView("icons") },
        { label: "List", checked: view === "list", onClick: () => setView("list") },
      ],
    },
    "-",
    { label: "Paste", disabled: !clipboard || !canEdit, onClick: paste },
    "-",
    {
      label: "New",
      items: [
        { label: "Folder", disabled: !canEdit, onClick: () => newItem("folder") },
        { label: "Text Document", disabled: !canEdit, onClick: () => newItem("file") },
      ],
    },
    "-",
    { label: "Properties", disabled: !path.length, onClick: () => properties(null) },
  ]

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Folder", disabled: !canEdit, onClick: () => newItem("folder") },
        { label: "New Text Document", disabled: !canEdit, onClick: () => newItem("file") },
        { label: "Import Text File...", disabled: !canEdit, onClick: () => importRef.current?.click() },
        "-",
        { label: "Open", disabled: !selectedItem, onClick: () => open(selectedItem) },
        { label: "Delete", disabled: !selectedItem || !canEdit, onClick: () => askDelete(selectedItem) },
        { label: "Rename", disabled: !selectedItem || !canEdit, onClick: () => rename(selectedItem) },
        { label: "Properties", onClick: () => properties(selectedItem) },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Cut", disabled: !selectedItem || !canEdit, onClick: () => cut(selectedItem) },
        { label: "Copy", disabled: !selectedItem || !canEdit, onClick: () => copy(selectedItem) },
        { label: "Paste", disabled: !clipboard || !canEdit, onClick: paste },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Large Icons", checked: view === "icons", onClick: () => setView("icons") },
        { label: "List", checked: view === "list", onClick: () => setView("list") },
      ],
    },
    {
      label: "Go",
      items: [
        { label: "Back", disabled: nav.index === 0, onClick: () => step(-1) },
        { label: "Forward", disabled: nav.index === nav.stack.length - 1, onClick: () => step(1) },
        { label: "Up One Level", disabled: !path.length, onClick: up },
        "-",
        { label: "My Computer", onClick: () => go([]) },
        { label: "C:\\", onClick: () => go(["C:"]) },
        { label: "My Documents", onClick: () => go(["C:", "Documents"]) },
        { label: "Recycle Bin", onClick: () => dispatch({ type: "open_window", payload: launch("Recycle Bin") }) },
      ],
    },
  ]

  const longPressBackground = useLongPress((x, y, { target }) => {
    const el = target.closest?.("[data-item]")
    const item = el ? items[Number(el.dataset.item)] : null
    if (item) setSelected(item)
    setMenu({ x, y, item })
  })

  const onKeyDown = (e) => {
    if (dialog || e.target.closest("input, textarea")) return
    const ctrl = e.ctrlKey || e.metaKey
    if (e.key === "Delete" && selectedItem) askDelete(selectedItem)
    else if (e.key === "F2" && selectedItem) rename(selectedItem)
    else if (e.key === "Enter" && selectedItem) open(selectedItem)
    else if (e.key === "Backspace") up()
    else if (ctrl && e.key.toLowerCase() === "x") cut(selectedItem)
    else if (ctrl && e.key.toLowerCase() === "c") copy(selectedItem)
    else if (ctrl && e.key.toLowerCase() === "v") paste()
    else return
    e.preventDefault()
  }

  const objectCount = `${items.length} object${items.length === 1 ? "" : "s"}`
  const status = selectedItem ? `${selectedItem.name} \u2014 ${typeName(selectedItem)}${selectedItem.isDirectory ? "" : `, ${formatSize(sizeOf(selectedItem))}`}` : objectCount

  return (
    <div className="fxRoot" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />

      <div className="fxToolbar">
        <button type="button" disabled={nav.index === 0} onClick={() => step(-1)} title="Back">
          &#9664; Back
        </button>
        <button type="button" disabled={nav.index === nav.stack.length - 1} onClick={() => step(1)} title="Forward">
          &#9654;
        </button>
        <button type="button" disabled={!path.length} onClick={up} title="Up One Level" aria-label="Up One Level">
          <img src={"/assets/" + imageMapper.small_folder_up} alt="" /> Up
        </button>
        <span className="fxSep" />
        <button type="button" disabled={!selectedItem || !canEdit} onClick={() => cut(selectedItem)}>
          Cut
        </button>
        <button type="button" disabled={!selectedItem || !canEdit} onClick={() => copy(selectedItem)}>
          Copy
        </button>
        <button type="button" disabled={!clipboard || !canEdit} onClick={paste}>
          Paste
        </button>
        <span className="fxSep" />
        <button type="button" disabled={!selectedItem || !canEdit} onClick={() => askDelete(selectedItem)}>
          Delete
        </button>
        <button type="button" onClick={() => properties(selectedItem)}>
          Properties
        </button>
      </div>

      <form
        className="fxAddress"
        onSubmit={(e) => {
          e.preventDefault()
          submitAddress()
        }}
      >
        <label htmlFor="fx-address">Address</label>
        <input id="fx-address" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck="false" autoCapitalize="off" />
        <button type="submit">Go</button>
      </form>

      <div
        className={`fxView fxView--${view}`}
        onClick={(e) => {
          if (!e.target.closest("[data-item]")) setSelected(null)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          const el = e.target.closest("[data-item]")
          const item = el ? items[Number(el.dataset.item)] : null
          if (item) setSelected(item)
          setMenu({ x: e.clientX, y: e.clientY, item })
        }}
        onDragOver={(e) => canEdit && e.dataTransfer.types.includes("Files") && e.preventDefault()}
        onDrop={(e) => {
          if (!canEdit || !e.dataTransfer.files.length) return
          e.preventDefault()
          importFiles([...e.dataTransfer.files])
        }}
        {...longPressBackground}
      >
        {items.length === 0 && <p className="fxEmpty">This folder is empty.</p>}
        {items.map((item, i) => (
          <div
            key={`${item.name}-${i}`}
            data-item={i}
            className={item === selectedItem ? "fxItem is-selected" : clipboard?.mode === "cut" && clipboard.items.includes(item) ? "fxItem is-cut" : "fxItem"}
            onClick={() => setSelected(item)}
            {...openGesture(() => open(item))}
            title={typeName(item)}
          >
            <img src={iconFor(item)} alt="" draggable="false" />
            <span className="fxName">{item.name}</span>
          </div>
        ))}
      </div>

      <div className="status-bar fxStatus">
        <p className="status-bar-field">{status}</p>
        <p className="status-bar-field fxStatusRight">{path.length ? "Local Disk (C:)" : "My Computer"}</p>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".txt,.md,.log,.csv,.json,.ini,text/*"
        multiple
        className="d-none"
        onChange={(e) => {
          importFiles([...e.target.files])
          e.target.value = ""
        }}
      />

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.item ? itemMenu(menu.item) : folderMenu()} onClose={() => setMenu(null)} />}

      {dialog?.kind === "name" && (
        <Dialog title={dialog.title} onOk={finishName} onCancel={() => setDialog(null)}>
          <label className="dialogLabel" htmlFor="fx-name">
            Name:
          </label>
          <input id="fx-name" value={dialog.text} maxLength={64} onChange={(e) => setDialog({ ...dialog, text: e.target.value, error: null })} />
          {dialog.error && <p className="dialogText fxError">{dialog.error}</p>}
        </Dialog>
      )}

      {dialog?.kind === "delete" && (
        <Dialog title="Confirm File Delete" okLabel="Yes" cancelLabel="No" onOk={() => doDelete(dialog.item)} onCancel={() => setDialog(null)}>
          <div className="fxConfirm">
            <img src="/assets/recycle_bin_full.png" alt="" />
            <p className="dialogText">
              Are you sure you want to send '{dialog.item.name}'{dialog.item.isDirectory ? " and all its contents" : ""} to the Recycle Bin?
            </p>
          </div>
        </Dialog>
      )}

      {dialog?.kind === "properties" && (
        <Dialog title={`${dialog.item.name} Properties`} onOk={() => setDialog(null)}>
          <div className="fxProps">
            <img src={iconFor(dialog.item)} alt="" />
            <b>{dialog.item.name}</b>
          </div>
          <table className="fxPropsTable">
            <tbody>
              <tr>
                <th>Type:</th>
                <td>{typeName(dialog.item)}</td>
              </tr>
              <tr>
                <th>Location:</th>
                <td>{dialog.item.parent ? fs.displayPath(dialog.item.parent) || "My Computer" : "My Computer"}</td>
              </tr>
              <tr>
                <th>Size:</th>
                <td>{formatSize(sizeOf(dialog.item))}</td>
              </tr>
              {dialog.item.isDirectory && (
                <tr>
                  <th>Contains:</th>
                  <td>
                    {dialog.item.content.filter((c) => !c.isDirectory).length} files, {dialog.item.content.filter((c) => c.isDirectory).length} folders
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Dialog>
      )}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default FileExplorer
