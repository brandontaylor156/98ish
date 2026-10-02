import React, { useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { fs } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { playSystemSound } from "../../../utils/systemSounds"
import { useLongPress } from "../../../hooks/useLongPress"
import { formatSize, iconFor, typeName } from "../../../utils/fileInfo"
import "./FileExplorer.css"

const sizeOf = (item) => (item.isDirectory ? item.content.reduce((s, c) => s + sizeOf(c), 0) : new Blob([item.textContent]).size)

// The Recycle Bin: things deleted from My Computer, with where they came from. Restore
// puts them back; Delete or Empty Recycle Bin removes them for good.
const RecycleBin = () => {
  useFsVersion()
  const [selected, setSelected] = useState(null)
  const [menu, setMenu] = useState(null)
  const [dialog, setDialog] = useState(null)

  const items = [...fs.recycleBin.content].sort((a, b) => (b.meta.deletedAt || 0) - (a.meta.deletedAt || 0))
  const selectedItem = selected && items.includes(selected) ? selected : null
  const label = (item) => item.meta.originalName || item.name

  const restore = (item) => {
    if (!item) return
    fs.restoreItem(item)
    setSelected(null)
  }

  const itemMenu = (item) => [
    { label: "Restore", bold: true, onClick: () => restore(item) },
    "-",
    { label: "Delete", onClick: () => setDialog({ kind: "delete", item }) },
    "-",
    { label: "Properties", onClick: () => setDialog({ kind: "properties", item }) },
  ]

  const menus = [
    {
      label: "File",
      items: [
        { label: "Restore", disabled: !selectedItem, onClick: () => restore(selectedItem) },
        { label: "Delete", disabled: !selectedItem, onClick: () => setDialog({ kind: "delete", item: selectedItem }) },
        "-",
        { label: "Empty Recycle Bin", disabled: !items.length, onClick: () => setDialog({ kind: "empty" }) },
        "-",
        { label: "Properties", disabled: !selectedItem, onClick: () => setDialog({ kind: "properties", item: selectedItem }) },
      ],
    },
  ]

  const longPress = useLongPress((x, y, { target }) => {
    const row = target.closest?.("[data-item]")
    const item = row ? items[Number(row.dataset.item)] : null
    if (item) {
      setSelected(item)
      setMenu({ x, y, item })
    }
  })

  return (
    <div className="fxRoot" tabIndex={-1} onKeyDown={(e) => e.key === "Delete" && selectedItem && setDialog({ kind: "delete", item: selectedItem })}>
      <MenuBar menus={menus} />
      <div className="fxToolbar">
        <button type="button" disabled={!selectedItem} onClick={() => restore(selectedItem)}>
          Restore
        </button>
        <button type="button" disabled={!selectedItem} onClick={() => setDialog({ kind: "delete", item: selectedItem })}>
          Delete
        </button>
        <span className="fxSep" />
        <button type="button" disabled={!items.length} onClick={() => setDialog({ kind: "empty" })}>
          Empty Recycle Bin
        </button>
      </div>

      <div className="rbList" {...longPress} onContextMenu={(e) => {
        e.preventDefault()
        const row = e.target.closest("[data-item]")
        const item = row ? items[Number(row.dataset.item)] : null
        if (item) {
          setSelected(item)
          setMenu({ x: e.clientX, y: e.clientY, item })
        }
      }}>
        {items.length === 0 ? (
          <p className="fxEmpty" style={{ padding: 8 }}>The Recycle Bin is empty.</p>
        ) : (
          <table className="rbTable">
            <thead>
              <tr>
                <th>Name</th>
                <th>Original Location</th>
                <th>Date Deleted</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr
                  key={item.name}
                  data-item={i}
                  className={item === selectedItem ? "is-selected" : ""}
                  onClick={() => setSelected(item)}
                  onDoubleClick={() => setDialog({ kind: "properties", item })}
                >
                  <td>
                    <img src={iconFor(item)} alt="" />
                    {label(item)}
                  </td>
                  <td>{item.meta.deletedFrom || "C:\\"}</td>
                  <td>{item.meta.deletedAt ? new Date(item.meta.deletedAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : ""}</td>
                  <td>{item.isDirectory ? "" : formatSize(sizeOf(item))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="status-bar fxStatus">
        <p className="status-bar-field">
          {items.length} object{items.length === 1 ? "" : "s"}
        </p>
        <p className="status-bar-field fxStatusRight">{formatSize(items.reduce((s, i) => s + sizeOf(i), 0))}</p>
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={itemMenu(menu.item)} onClose={() => setMenu(null)} />}

      {dialog?.kind === "delete" && (
        <Dialog
          title="Confirm File Delete"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            fs.deleteForever(dialog.item)
            setSelected(null)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Are you sure you want to delete '{label(dialog.item)}'? This can't be undone.</p>
        </Dialog>
      )}

      {dialog?.kind === "empty" && (
        <Dialog
          title="Confirm Multiple File Delete"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            fs.emptyRecycleBin()
            playSystemSound("recycle")
            setSelected(null)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Are you sure you want to delete all of these {items.length} items? This can't be undone.</p>
        </Dialog>
      )}

      {dialog?.kind === "properties" && (
        <Dialog title={`${label(dialog.item)} Properties`} onOk={() => setDialog(null)}>
          <div className="fxProps">
            <img src={iconFor(dialog.item)} alt="" />
            <b>{label(dialog.item)}</b>
          </div>
          <table className="fxPropsTable">
            <tbody>
              <tr>
                <th>Type:</th>
                <td>{typeName(dialog.item)}</td>
              </tr>
              <tr>
                <th>Origin:</th>
                <td>{dialog.item.meta.deletedFrom || "C:\\"}</td>
              </tr>
              <tr>
                <th>Deleted:</th>
                <td>{dialog.item.meta.deletedAt ? new Date(dialog.item.meta.deletedAt).toLocaleString() : ""}</td>
              </tr>
              <tr>
                <th>Size:</th>
                <td>{formatSize(sizeOf(dialog.item))}</td>
              </tr>
            </tbody>
          </table>
        </Dialog>
      )}
    </div>
  )
}

export default RecycleBin
