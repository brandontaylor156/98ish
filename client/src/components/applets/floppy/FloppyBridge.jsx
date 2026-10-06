import { useEffect } from "react"
import { useAim } from "../aim/AimContext"
import { setFloppyAim } from "./floppyTools"

// Lives inside 98 Messenger's provider (Desktop.jsx) and hands Floppy the signed-on Messenger,
// so "message Sam saying hi" can send (after the person confirms) and buddies are known.
const FloppyBridge = () => {
  const aim = useAim()
  useEffect(() => {
    setFloppyAim(aim)
  }, [aim])
  useEffect(() => () => setFloppyAim(null), [])
  return null
}

export default FloppyBridge
