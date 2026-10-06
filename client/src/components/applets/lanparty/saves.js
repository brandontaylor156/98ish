// Saved games for LAN Party 98's DOS games, kept on drive C: (C:\Games\Saves\DOOM.SAV), so
// they're per user, show in My Computer, go into Backup and sync like any file.
//
// js-dos calls our fsChanges hooks with its "changes" bundle (a zip of the files the game
// wrote: its savegames, its config) when you save or quit, and asks for it back at start.

import { fs, readContent, saveNow, writeAndSave, FILE_TYPE } from "../../../utils/fs"
import { MAX_SAVE_BYTES, fromDataUrl, saveName, toDataUrl } from "./savesCore"

export const SAVE_FOLDER = ["Games", "Saves"]

const folder = (create) => {
  let dir = fs.root
  for (const part of SAVE_FOLDER) {
    let next = dir.getItem(part)
    if (!next) {
      if (!create) return null
      next = fs.createDirectoryIn(dir, part)
    }
    if (!next.isDirectory) return null
    dir = next
  }
  return dir
}

// The fsChanges hooks js-dos takes (see the Dos() options)
export const driveSaves = ({ onError = () => {} } = {}) => ({
  local: false,
  urlToKey: (url) => `${url}.changes`,
  pull: async (key) => {
    const file = folder(false)?.getItem(saveName(key))
    if (!file || file.isDirectory) return null
    return fromDataUrl(await readContent(file))
  },
  push: async (key, data) => {
    if (!data || data.length > MAX_SAVE_BYTES) return onError(`This save is too big for drive C: (over ${MAX_SAVE_BYTES / 1024 / 1024} MB).`)
    const dir = folder(true)
    const name = saveName(key)
    let file = dir.getItem(name)
    const created = !file
    if (!file) file = fs.createFileIn(dir, name, FILE_TYPE.dossave, "")
    if (!(await writeAndSave(file, toDataUrl(data), { created }))) onError("Drive C: is full, so the game couldn't be saved.")
  },
  delete: async (key) => {
    const dir = folder(false)
    const name = saveName(key)
    if (dir?.getItem(name)) {
      dir.removeItem(name)
      await saveNow({ quiet: true })
    }
  },
})
