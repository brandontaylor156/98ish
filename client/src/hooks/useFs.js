import { useEffect, useState } from "react"
import { onFsChange } from "../utils/fs"

// Re-render whenever the file system changes (another window, MS-DOS, the Recycle Bin)
export const useFsVersion = () => {
  const [version, setVersion] = useState(0)
  useEffect(() => onFsChange(() => setVersion((v) => v + 1)), [])
  return version
}
