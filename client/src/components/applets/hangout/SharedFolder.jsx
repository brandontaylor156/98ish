import React, { useEffect, useState } from "react"
import { openShared } from "../../../utils/ydoc"
import { meKey } from "../../../utils/hangout"
import { fs, readContent } from "../../../utils/fs"
import { DRAG_TYPE } from "../../../utils/fsActions"
import { openItem } from "../../../utils/openItem"
import FileDialog from "../notepad/FileDialog"

// The Shared with Friends folder (Come Over): a Yjs document whose "files" map holds each
// file (name -> { name, type, data, by, size, at }). Anyone in it adds files (from the
// drive, by dragging from My Computer, or from the phone's files), opens them (a copy goes
// to My Documents) or removes them. Everyone sees changes at once; up to 1 MB a file and
// 6 MB in all (the shared-document caps keep the 98ish server's free storage safe).
const MAX_FILE = 1024 * 1024

const typeForUpload = (f) => (f.type.startsWith("image/") ? "image" : "text")
const readAsData = (f, asText) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    if (asText) r.readAsText(f)
    else r.readAsDataURL(f)
  })

const SharedFolder = ({ meta, dispatch }) => {
  const [handle, setHandle] = useState(null)
  const [files, setFiles] = useState([])
  const [msg, setMsg] = useState(null)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    const h = openShared(meta.id)
    setHandle(h)
    const map = h.doc.getMap("files")
    const sync = () => setFiles([...map.values()].sort((a, b) => b.at - a.at))
    map.observe(sync)
    h.ready.then(sync)
    return () => {
      map.unobserve(sync)
      h.close()
    }
  }, [meta.id])

  const put = (name, type, data) => {
    if (!handle) return
    if (data.length > MAX_FILE * 1.4) return setMsg(`${name} is too big for the shared folder (1 MB at most).`)
    const map = handle.doc.getMap("files")
    let n = name
    for (let i = 2; map.has(n) && map.get(n).by !== meKey(); i++) n = name.replace(/(\.[^.]*)?$/, ` (${i})$1`)
    map.set(n, { name: n, type, data, by: meKey(), size: data.length, at: Date.now() })
    setMsg(`Added ${n}.`)
  }
  const addFromDrive = async (file) => {
    setPicking(false)
    if (file.deviceOnly) return setMsg(`${file.name} is kept on this device only (over 8 MB), so it can't be sent from here. Use Send To > My Phone instead.`)
    await readContent(file)
    put(file.name, file.type, file.textContent || "")
  }
  const onUpload = async (e) => {
    for (const f of [...(e.target.files || [])]) {
      if (f.size > MAX_FILE) {
        setMsg(`${f.name} is too big for the shared folder (1 MB at most).`)
        continue
      }
      const isText = /^text\//.test(f.type) || /\.(txt|md|csv|json)$/i.test(f.name)
      put(f.name, typeForUpload(f) === "image" ? "image" : "text", await readAsData(f, isText))
    }
    e.target.value = ""
  }
  const onDrop = async (e) => {
    const path = e.dataTransfer.getData(DRAG_TYPE)
    if (!path) return
    e.preventDefault()
    const item = fs.resolve(path)
    if (item && !item.isDirectory) await addFromDrive(item)
  }
  const openCopy = (f) => {
    try {
      const docs = fs.resolve("C:/Documents") || fs.resolve("C:/Desktop")
      const copy = fs.createFileIn(docs, f.name, f.type || "text", f.data)
      if (dispatch) openItem(copy, dispatch)
      setMsg(`Put a copy in My Documents${dispatch ? " and opened it" : ""}.`)
    } catch (error) {
      setMsg(error?.message || "Couldn't open it.")
    }
  }
  const remove = (f) => handle?.doc.getMap("files").delete(f.name)
  const used = files.reduce((n, f) => n + (f.size || 0), 0)

  return (
    <div className="hgFolder" onDragOver={(e) => e.dataTransfer.types.includes(DRAG_TYPE) && e.preventDefault()} onDrop={onDrop} data-shared-folder={meta.id}>
      {files.length ? (
        <ul className="hgList">
          {files.map((f) => (
            <li key={f.name} data-folder-file={f.name}>
              <button type="button" className="hgLink" onClick={() => openCopy(f)}>
                {f.type === "image" ? "🖼" : "📄"} {f.name}
              </button>
              <small> {Math.max(1, Math.round((f.size || 0) / 1024))} KB</small>
              <button type="button" className="hgSmall" onClick={() => remove(f)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hgNote">Empty. Drag a file here from My Computer, or add one below.</p>
      )}
      <div className="hgRow">
        <button type="button" onClick={() => setPicking(true)} data-add-from-drive>
          Add from Drive C:...
        </button>
        <label className="hgUpload">
          <input type="file" multiple onChange={onUpload} />
          <span className="button">From this device...</span>
        </label>
      </div>
      <p className="hgSmallNote">
        {Math.round(used / 1024)} KB of 6 MB used{handle?.status === "offline" ? " · offline: changes join when you're back" : ""}
      </p>
      {msg && <p className="hgMsg">{msg}</p>}
      {picking && <FileDialog mode="open" accept={() => true} typeLabel="All Files" onPick={addFromDrive} onCancel={() => setPicking(false)} />}
    </div>
  )
}

export default SharedFolder
