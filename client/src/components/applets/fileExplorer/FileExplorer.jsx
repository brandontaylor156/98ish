import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { fs, uniqueName, validName } from "../../../utils/fs"
import { imageMapper } from "../../../utils/imageMapper"
import { formatSize, iconFor, typeName } from "../../../utils/fileInfo"
import { DRAG_TYPE, createShortcut, desktopFolder, getClipboard, moveInto, pasteInto, setClipboard } from "../../../utils/fsActions"
import { openItem } from "../../../utils/openItem"
import { launch, paintWindow } from "../../../utils/programs"
import { useFsVersion } from "../../../hooks/useFs"
import { useOpenGesture } from "../../../hooks/useMediaQuery"
import { useLongPress } from "../../../hooks/useLongPress"
import { UPLOAD_ACCEPT, canDownload, downloadItem, uploadInto } from "../../../utils/fileTransfer"
import { isSyncEnabled, setSyncEnabled, statusText, useDriveSync } from "../../../utils/driveSync"
import "./FileExplorer.css"

export { formatSize, iconFor, typeName }

// My Computer / Windows Explorer. Each window keeps its own folder and history; files
// can be opened, renamed, deleted (to the Recycle Bin), cut/copied/pasted between
// windows, uploaded from your real computer (text, pictures, sounds, web pages) and
// downloaded back to it (a folder comes down as a .zip).

const sortItems = (items) =>
  [...items].sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })))

// Large Icons show a picture's own image
const thumbnailFor = (item) => (item.type === "image" && item.textContent.startsWith("data:image/") ? item.textContent : null)

const sizeOf = (item) => {
  // a picture is kept as base64 text: count the bytes of the PNG itself
  if (item.type === "image") return Math.floor((item.textContent.length - item.textContent.indexOf(",") - 1) * 0.75)
  if (!item.isDirectory) return new Blob([item.textContent]).size
  return item.content.reduce((sum, child) => sum + sizeOf(child), 0)
}


const FileExplorer = ({ path: initialPath = ["C:"], dispatch, onTitle }) => {
  useFsVersion() // repaint when anything changes the files
  const [nav, setNav] = useState({ stack: [initialPath], index: 0 })
  const [selected, setSelected] = useState(null)
  const [view, setView] = useState("icons") // icons | list
  const [menu, setMenu] = useState(null) // { x, y, item }
  const [dialog, setDialog] = useState(null)
  const [address, setAddress] = useState("")
  const [uploading, setUploading] = useState(false)
  const sync = useDriveSync()
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

  const clipboard = getClipboard()
  const cut = (item) => item && canEdit && setClipboard({ mode: "cut", items: [item] })
  const copy = (item) => item && canEdit && setClipboard({ mode: "copy", items: [item] })

  const paste = () => {
    if (!clipboard || !canEdit) return
    try {
      const last = pasteInto(dir)
      if (last) setSelected(last)
    } catch (error) {
      fail("Paste", error)
    }
  }

  const shortcut = (item, where = dir) => {
    try {
      const made = createShortcut(item, where)
      if (where === dir) setSelected(made)
    } catch (error) {
      fail("Create Shortcut", error)
    }
  }

  const properties = (item) => setDialog({ kind: "properties", item: item || dir })

  // real files from your computer (the file picker, or dropped on the window)
  const upload = async (fileList) => {
    if (!canEdit || !fileList.length) return
    const into = dir
    setUploading(true)
    try {
      const { added, problems, notes } = await uploadInto(into, fileList)
      if (added.length) setSelected(added.at(-1))
      const text = [...problems, ...notes].join(" ")
      if (problems.length) setDialog({ kind: "alert", title: "Upload", text: `${problems.length === fileList.length ? "Nothing was uploaded. " : ""}${text}` })
      else if (notes.length) setDialog({ kind: "alert", title: "Upload", text })
    } finally {
      setUploading(false)
    }
  }

  // a copy on your real computer: files as .txt / .png / .wav / .html, folders as a .zip
  const download = (item) => {
    if (!item) return
    const result = downloadItem(item)
    if (!result.ok) return setDialog({ kind: "alert", title: "Download", text: result.error })
    if (result.skipped.length) {
      const list = result.skipped.slice(0, 8).join(", ") + (result.skipped.length > 8 ? ` and ${result.skipped.length - 8} more` : "")
      setDialog({ kind: "alert", title: "Download", text: `Downloaded ${result.name}. Left out (programs, shortcuts and songs only work inside 98ish): ${list}.` })
    }
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
    // pictures open in Photos; Edit opens them in Paint
    ...(item.type === "image" ? [{ label: "Edit", onClick: () => dispatch({ type: "open_window", payload: paintWindow(item) }) }] : []),
    ...(item.isDirectory ? [{ label: "Explore", onClick: () => dispatch({ type: "open_window", payload: launch("My Computer", { path: fs.partsOf(item) }) }) }] : []),
    {
      label: "Send To",
      items: [{ label: "Desktop (create shortcut)", onClick: () => shortcut(item, desktopFolder()) }],
    },
    { label: "Download to your computer", disabled: !canDownload(item), onClick: () => download(item) },
    "-",
    { label: "Cut", disabled: !canEdit, onClick: () => cut(item) },
    { label: "Copy", disabled: !canEdit, onClick: () => copy(item) },
    "-",
    { label: "Create Shortcut", disabled: !canEdit, onClick: () => shortcut(item) },
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
    { label: "Upload from your computer...", disabled: !canEdit, onClick: () => importRef.current?.click() },
    "-",
    { label: "Properties", disabled: !path.length, onClick: () => properties(null) },
  ]

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Folder", disabled: !canEdit, onClick: () => newItem("folder") },
        { label: "New Text Document", disabled: !canEdit, onClick: () => newItem("file") },
        "-",
        { label: "Upload from your computer...", disabled: !canEdit, onClick: () => importRef.current?.click() },
        { label: "Download to your computer", disabled: !canDownload(selectedItem || (canEdit ? dir : null)), onClick: () => download(selectedItem || dir) },
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
    {
      label: "Tools",
      items: [
        { label: "Sync my files with my 98 Messenger account", checked: isSyncEnabled(), onClick: () => setSyncEnabled(!isSyncEnabled()) },
        { label: "Backup...", onClick: () => dispatch({ type: "open_window", payload: launch("Backup") }) },
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
  const status = uploading ? "Uploading..." : selectedItem ? `${selectedItem.name} \u2014 ${typeName(selectedItem)}${selectedItem.isDirectory ? "" : `, ${formatSize(sizeOf(selectedItem))}`}` : objectCount

  return (
    <div className="fxRoot" ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <MenuBar menus={menus} />

      <div className="fxToolbar">
        <button type="button" disabled={nav.index === 0} onClick={() => step(-1)} title="Back">
          &#9664;&#xFE0E; Back
        </button>
        <button type="button" disabled={nav.index === nav.stack.length - 1} onClick={() => step(1)} title="Forward">
          &#9654;&#xFE0E;
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
        data-folder={canEdit ? fs.displayPath(dir) : undefined}
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
        onDragOver={(e) => canEdit && (e.dataTransfer.types.includes("Files") || e.dataTransfer.types.includes(DRAG_TYPE)) && e.preventDefault()}
        onDrop={(e) => {
          if (!canEdit) return
          // an item dragged from another window (or the desktop) moves here
          const from = e.dataTransfer.getData(DRAG_TYPE)
          if (from) {
            e.preventDefault()
            const item = fs.resolve(from)
            if (!item) return
            try {
              setSelected(moveInto(item, dir))
            } catch (error) {
              fail("Move", error)
            }
            return
          }
          if (!e.dataTransfer.files.length) return
          e.preventDefault()
          upload([...e.dataTransfer.files])
        }}
        {...longPressBackground}
      >
        {items.length === 0 && <p className="fxEmpty">This folder is empty.</p>}
        {items.map((item, i) => (
          <div
            key={`${item.name}-${i}`}
            data-item={i}
            className={(item === selectedItem ? "fxItem is-selected" : clipboard?.mode === "cut" && clipboard.items.includes(item) ? "fxItem is-cut" : "fxItem") + (item.type === "shortcut" ? " isShortcut" : "")}
            onClick={() => setSelected(item)}
            draggable={canEdit && item.type !== "drive"}
            onDragStart={(e) => {
              e.dataTransfer.setData(DRAG_TYPE, fs.displayPath(item))
              e.dataTransfer.effectAllowed = "move"
            }}
            {...openGesture(() => open(item))}
            title={typeName(item)}
          >
            {view === "icons" && thumbnailFor(item) ? (
              <img className="fxThumb" src={thumbnailFor(item)} alt="" draggable="false" />
            ) : (
              <img src={iconFor(item)} alt="" draggable="false" />
            )}
            <span className="fxName">{item.name}</span>
          </div>
        ))}
      </div>

      <div className="status-bar fxStatus">
        <p className="status-bar-field">{status}</p>
        {sync.phase !== "off" && (
          <p className={`status-bar-field fxSync is-${sync.phase}`} title={statusText(sync)}>
            <span className="fxSyncLight" aria-hidden="true" />
            {{ synced: "Synced", syncing: "Syncing...", pending: "Syncing...", signedOut: "Sync: signed off", conflict: "Sync: choose" }[sync.phase] || "Sync: error"}
          </p>
        )}
        <p className="status-bar-field fxStatusRight">{path.length ? "Local Disk (C:)" : "My Computer"}</p>
      </div>

      <input
        ref={importRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        className="d-none"
        onChange={(e) => {
          upload([...e.target.files])
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
        <Dialog title={dialog.title} sound="ding" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
    </div>
  )
}

export default FileExplorer
