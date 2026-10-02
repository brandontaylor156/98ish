import React from "react"
import { openMail, useMailStatus } from "./mailStatus"

// The taskbar tray's envelope: shown while there's unread mail
const MailTray = ({ windows, dispatch }) => {
  const { unread } = useMailStatus()
  if (!unread) return null
  const label = `${unread} unread ${unread === 1 ? "message" : "messages"}`
  return (
    <button type="button" className="mailTray" title={`98ish Mail: ${label}`} aria-label={`98ish Mail, ${label}`} onClick={() => openMail(windows, dispatch)}>
      <img src="/assets/program_icons/mail.svg" alt="" draggable="false" />
      <span className="mailTrayCount">{unread > 99 ? "99+" : unread}</span>
    </button>
  )
}

export default MailTray
