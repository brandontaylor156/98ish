import React, { useState } from "react"
import Dialog from "../../shared/Dialog"
import { fs, validName } from "../../../utils/fs"
import { imageMapper } from "../../../utils/imageMapper"
import { useFsVersion } from "../../../hooks/useFs"
import "./Notepad.css"

// What each kind of document is called in messages
const NOUNS = { text: "text document", image: "picture" }
const isTextFile = (item) => item.isText

// Windows 98-style Open / Save As dialog over the 98ish drive. Shows folders and the files
// `accept` takes (text documents unless told otherwise; `fileType` is their kind, for
// icons and messages). onPick(dir, name) for Save As (after confirming an overwrite),
// onPick(file) for Open.
const FileDialog = ({ mode, startDir, initialName = "", onPick, onCancel, accept = isTextFile, typeLabel = "Text Documents", fileType = "text" }) => {
  useFsVersion()
  const [dirPath, setDirPath] = useState(() => fs.partsOf(startDir?.isDirectory ? startDir : fs.resolve("C:/Documents") || fs.resolve("C:")))
  const [name, setName] = useState(initialName)
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(null)

  const noun = NOUNS[fileType] || "document"
  const dir = fs.resolve(dirPath) || fs.resolve("C:")
  const entries = [...dir.content]
    .filter((item) => item.isDirectory || accept(item))
    .sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)))
  const chain = dirPath.map((_, i) => dirPath.slice(0, i + 1))

  const submit = () => {
    const value = name.trim()
    if (!value) return
    // a folder name: go into it
    const target = dir.getItem(value)
    if (target?.isDirectory) {
      setDirPath(fs.partsOf(target))
      setName("")
      return
    }
    if (mode === "open") {
      if (!target || !accept(target)) return setError(`Cannot find the file '${value}'. Check the file name.`)
      return onPick(target)
    }
    const problem = validName(value)
    if (problem) return setError(problem)
    if (target && !accept(target)) return setError(`'${value}' is ${target.isText ? "a text document" : target.isImage ? "a picture" : "a program"}, not a ${noun}. Choose another name.`)
    if (target) return setConfirm(value)
    onPick(dir, value)
  }

  return (
    <>
      <Dialog title={mode === "open" ? "Open" : "Save As"} okLabel={mode === "open" ? "Open" : "Save"} okDisabled={!name.trim()} onOk={submit} onCancel={onCancel}>
        <div className="npFdRow">
          <label htmlFor="np-look">{mode === "open" ? "Look in:" : "Save in:"}</label>
          <select id="np-look" value={dirPath.join("/")} onChange={(e) => setDirPath(e.target.value.split("/"))}>
            {chain.map((parts) => (
              <option key={parts.join("/")} value={parts.join("/")}>
                {"\u00a0".repeat((parts.length - 1) * 2)}
                {parts.length === 1 ? `(${parts[0]})` : parts.at(-1)}
              </option>
            ))}
          </select>
          <button type="button" disabled={dirPath.length <= 1} onClick={() => setDirPath(dirPath.slice(0, -1))} aria-label="Up One Level" title="Up One Level">
            <img src={"/assets/" + imageMapper.small_folder_up} alt="" />
          </button>
        </div>
        <ul className="npFdList" role="listbox" aria-label="Files">
          {entries.length === 0 && <li className="npFdEmpty">No {noun}s here.</li>}
          {entries.map((item) => (
            <li key={item.name} role="option" aria-selected={item.name === name}>
              <button
                type="button"
                className={item.name === name ? "is-selected" : ""}
                onClick={() => {
                  setError(null)
                  if (item.isDirectory) {
                    setDirPath(fs.partsOf(item))
                    return
                  }
                  setName(item.name)
                }}
                onDoubleClick={() => accept(item) && (mode === "open" ? onPick(item) : setConfirm(item.name))}
              >
                <img src={"/assets/" + (item.isDirectory ? imageMapper.folder : imageMapper[fileType] || imageMapper.text)} alt="" />
                {item.name}
              </button>
            </li>
          ))}
        </ul>
        <div className="npFdRow">
          <label htmlFor="np-name">File name:</label>
          <input id="np-name" value={name} maxLength={64} onChange={(e) => (setName(e.target.value), setError(null))} />
        </div>
        <div className="npFdRow">
          <label>{mode === "open" ? "Files of type:" : "Save as type:"}</label>
          <select disabled>
            <option>{typeLabel}</option>
          </select>
        </div>
        {error && <p className="dialogText npFdError">{error}</p>}
      </Dialog>
      {confirm && (
        <Dialog
          title="Save As"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            const value = confirm
            setConfirm(null)
            onPick(dir, value)
          }}
          onCancel={() => setConfirm(null)}
        >
          <p className="dialogText">{fs.displayPath(dir).replace(/\\$/, "")}\{confirm} already exists. Do you want to replace it?</p>
        </Dialog>
      )}
    </>
  )
}

export default FileDialog
