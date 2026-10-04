import React, { useMemo, useRef, useState } from "react"
import Panel from "./Panel"
import { fs } from "../../../utils/fs"
import { readFile, shrinkPicture } from "./picture"

// Pick a contact's picture: one from C:\My Pictures (Camera's photos), or upload one from
// this computer or phone. It's made into a small square.
const PictureChooser = ({ mobile, onPick, onCancel }) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const input = useRef(null)
  const pictures = useMemo(() => {
    const dir = fs.resolve("C:/My Pictures")
    return dir?.isDirectory ? dir.content.filter((i) => !i.isDirectory && i.type === "image").slice(0, 60) : []
  }, [])

  const use = async (src) => {
    setBusy(true)
    setError(null)
    const small = await shrinkPicture(src)
    setBusy(false)
    if (small) onPick(small)
    else setError("That picture couldn't be opened. Try a JPEG or PNG (iPhone HEIC pictures: share them as JPEG).")
  }

  return (
    <Panel
      title="Choose a Picture"
      mobile={mobile}
      onClose={onCancel}
      className="abPictures"
      footer={
        <>
          <button type="button" onClick={() => input.current?.click()} disabled={busy}>
            Upload a Picture...
          </button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </>
      }
    >
      <p>{pictures.length ? "From My Pictures:" : "There are no pictures in C:\\My Pictures yet. Take one with Camera, or upload one."}</p>
      <div className="abPictureGrid">
        {pictures.map((p) => (
          <button key={p.name} type="button" className="abPictureChoice" title={p.name} disabled={busy} onClick={() => use(p.textContent)}>
            <img src={p.textContent} alt={p.name} draggable="false" />
          </button>
        ))}
      </div>
      {busy && <p>Making it fit...</p>}
      {error && <p className="abError">{error}</p>}
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0]
          e.target.value = ""
          if (!file) return
          try {
            use(await readFile(file, "dataURL"))
          } catch {
            setError("That file couldn't be read.")
          }
        }}
      />
    </Panel>
  )
}

export default PictureChooser
