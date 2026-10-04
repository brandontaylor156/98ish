import { useEffect } from "react"
import { useA11yRoot } from "../../hooks/useA11y"
import { installKeyboardAccess } from "../../utils/keyboardAccess"
import { installMouseOptions } from "../../utils/mouseOptions"
import { watchWakeLock } from "../../utils/wakeLock"
import "../../a11y.css"

// Accessibility Options, Mouse and Power Management for the whole page (mounted once in
// App.jsx): the classes and variables on <html>, Shift+F10 / the Menu key, swapped mouse
// buttons and keeping the screen on.
const A11yHost = ({ settings, mobile }) => {
  useA11yRoot(settings, mobile)
  useEffect(() => installKeyboardAccess(), [])
  useEffect(() => installMouseOptions(), [])
  useEffect(() => watchWakeLock(), [])
  return null
}

export default A11yHost
