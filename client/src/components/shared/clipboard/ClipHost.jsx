import React, { useEffect, useState } from "react"
import { CLIP_EVENT } from "../../../utils/clipHistory"

// Mounted once (App.jsx). Small and eager: the clipboard history panel itself loads the
// first time it's asked for (Ctrl+Shift+V, the 98ish keyboard's clipboard button,
// openClipHistory()).
const ClipHistory = React.lazy(() => import("./ClipHistory"))

const ClipHost = ({ mobile }) => {
  const [open, setOpen] = useState(null) // { target, id }
  useEffect(() => {
    // { toggle: true } (the keyboard's button) closes it when it's already open
    const onOpen = (e) => setOpen((cur) => (cur && e.detail?.toggle ? null : { target: e.detail?.target || null, id: Date.now() }))
    window.addEventListener(CLIP_EVENT, onOpen)
    return () => window.removeEventListener(CLIP_EVENT, onOpen)
  }, [])
  if (!open) return null
  return (
    <React.Suspense fallback={null}>
      <ClipHistory key={open.id} target={open.target} mobile={mobile} onClose={() => setOpen(null)} />
    </React.Suspense>
  )
}

export default ClipHost
