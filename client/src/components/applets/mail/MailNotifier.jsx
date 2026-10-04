import React, { useEffect, useRef, useState } from "react"
import { useAim } from "../aim/AimContext"
import { SERVER_URL, openMail, playMailChime, setMailStatus } from "./mailStatus"
import { notify } from "../../../utils/notifications"
import "./MailNotifier.css"

// Always on the desktop while signed on to 98 Messenger: keeps the unread count fresh,
// and when mail arrives plays a chime and pops up "New mail has arrived!" by the clock.
const MailNotifier = ({ socket, windows, dispatch }) => {
  const { status, token } = useAim() || {}
  const [toast, setToast] = useState(null) // { from, subject }
  const windowsRef = useRef(windows)
  windowsRef.current = windows

  useEffect(() => {
    if (status !== "online" || !token) {
      setMailStatus({ unread: 0 })
      setToast(null)
      return
    }
    let live = true
    fetch(`${SERVER_URL}/api/mail/folders`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => live && d.ok && setMailStatus({ unread: d.folders.inbox.unread }))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [status, token])

  useEffect(() => {
    const onMail = (mail) => {
      setMailStatus({ unread: Number(mail?.unread) || 0, arrived: Date.now() })
      playMailChime()
      setToast({ from: String(mail?.from || ""), subject: String(mail?.subject || "") })
      notify({ app: "mail", key: mail?.id ? `mail:${mail.id}` : null, title: `New mail from ${mail?.from || "someone"}`, text: mail?.subject || "(no subject)", target: { kind: "mail" } })
    }
    socket.on("mail:new", onMail)
    return () => socket.off("mail:new", onMail)
  }, [socket])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 9000)
    return () => clearTimeout(id)
  }, [toast])

  if (!toast) return null
  return (
    <div className="window mailToast" role="status">
      <div className="title-bar">
        <div className="title-bar-text">98ish Mail</div>
        <div className="title-bar-controls">
          <button type="button" aria-label="Close" onClick={() => setToast(null)} />
        </div>
      </div>
      <div className="window-body mailToastBody">
        <img src="/assets/program_icons/mail.svg" alt="" width="32" height="32" />
        <div className="mailToastText">
          <b>New mail has arrived!</b>
          <div>From: {toast.from}</div>
          <div className="mailToastSubject">{toast.subject || "(no subject)"}</div>
        </div>
        <button
          type="button"
          onClick={() => {
            setToast(null)
            openMail(windowsRef.current, dispatch)
          }}
        >
          Read
        </button>
      </div>
    </div>
  )
}

export default MailNotifier
