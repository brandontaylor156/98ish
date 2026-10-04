import { useEffect, useState } from "react"
import { driveUsage, onFsChange, onFsContent } from "../utils/fs"

// Re-render whenever the file system changes (another window, MS-DOS, the Recycle Bin),
// and when a big file's contents or a picture's thumbnail finish loading
export const useFsVersion = () => {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    const offChange = onFsChange(bump)
    const offContent = onFsContent(bump)
    return () => {
      offChange()
      offContent()
    }
  }, [])
  return version
}

// How full drive C: is: { mode, used, free, capacity, persisted } (null until known),
// checked again a moment after the files change
export const useDriveUsage = () => {
  const [usage, setUsage] = useState(null)
  useEffect(() => {
    let live = true
    let timer = null
    const check = () => driveUsage().then((u) => live && setUsage(u))
    check()
    const off = onFsChange(() => {
      clearTimeout(timer)
      timer = setTimeout(check, 1000)
    })
    return () => {
      live = false
      clearTimeout(timer)
      off()
    }
  }, [])
  return usage
}
