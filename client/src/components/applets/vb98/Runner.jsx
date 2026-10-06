import React, { useEffect, useMemo, useRef, useState } from "react"
import { compile } from "./vblang"
import { buildSrcdoc, SANDBOX_ATTR } from "./srcdoc"
import { checkSandboxMessage } from "./bridge"
import { playVbSound } from "./vbsounds"
import { onVbUpdate, vbClose, vbSet } from "../../../utils/vbapps"

// Runs one Visual Basic 98 program in its sandbox. The program can't touch 98ish: it draws
// inside an iframe with no same-origin and no network, and only the messages bridge.js
// allows come out (Shared values, sounds, errors, End).
//   shared: null (a program run on its own: Shared values live in this window) or
//           { id, state, people, me } (a program sent in a message: Shared values go through
//           98 Messenger to everyone it was sent to)
const PING_MS = 1000
const STALL_MS = 6000

const Runner = ({ project, shared = null, me = "", onEnd, onError, onEdit, mobile = false }) => {
  const frameRef = useRef(null)
  const wrapRef = useRef(null)
  const stateRef = useRef({ ...(shared?.state || {}) })
  const lastPong = useRef(Date.now())
  const [scale, setScale] = useState(1)
  const [stalled, setStalled] = useState(false)
  const [killed, setKilled] = useState(false)
  const [notice, setNotice] = useState("")
  const srcdoc = useMemo(() => buildSrcdoc(), [])
  const compiled = useMemo(() => compile(project.code, { controls: project.controls.map((c) => c.name) }), [project])
  const w = project.form.width
  const h = project.form.height

  // fit the form to the window (phones): scale the iframe, never the program's own layout
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => {
      const avail = el.clientWidth - 8
      const availH = mobile ? el.clientHeight - 8 : Infinity
      setScale(Math.max(0.3, Math.min(mobile ? 2 : 1, avail / w, availH / h)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [w, h, mobile])

  const send = (msg) => frameRef.current?.contentWindow?.postMessage(msg, "*")

  // the sandbox's messages (checked against the allow-list)
  useEffect(() => {
    if (!compiled.ok) return
    const onMessage = (e) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return
      const msg = checkSandboxMessage(e.data)
      if (!msg) return
      switch (msg.t) {
        case "boot":
          lastPong.current = Date.now()
          send({ t: "init", project, js: compiled.js, me: { name: me || "You", host: true }, friends: shared?.people || [me || "You"], shared: stateRef.current })
          break
        case "pong":
          lastPong.current = Date.now()
          setStalled(false)
          break
        case "set":
          stateRef.current = { ...stateRef.current, [msg.k]: msg.v }
          if (msg.v === "") delete stateRef.current[msg.k]
          if (shared?.id)
            vbSet(shared.id, msg.k, msg.v).then((r) => {
              if (!r?.ok) setNotice(r?.error || "A Shared change didn't go through.")
            })
          break
        case "sound":
          playVbSound(msg.name)
          break
        case "error":
          onError?.(msg)
          break
        case "end":
          onEnd?.()
          break
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [compiled, project, shared?.id])

  // friends' Shared changes come in from 98 Messenger
  useEffect(() => {
    if (!shared?.id) return
    const off = onVbUpdate(shared.id, ({ k, v }) => {
      stateRef.current = { ...stateRef.current, [k]: v }
      if (v === "") delete stateRef.current[k]
      send({ t: "shared", k, v })
    })
    return () => {
      off()
      vbClose(shared.id)
    }
  }, [shared?.id])

  // still answering? (an endless loop the watchdog didn't catch would stop the pongs)
  useEffect(() => {
    if (!compiled.ok || killed) return
    let n = 0
    const id = setInterval(() => {
      send({ t: "ping", n: ++n })
      if (Date.now() - lastPong.current > STALL_MS) setStalled(true)
    }, PING_MS)
    return () => clearInterval(id)
  }, [compiled.ok, killed])

  // closing the window stops the program's timers at once
  useEffect(() => () => send({ t: "stop" }), [])

  if (!compiled.ok)
    return (
      <div className="vbRunError" data-run-error>
        <p>
          <b>Compile error</b> on line {compiled.error.line}:
        </p>
        <p data-selectable>{compiled.error.message}</p>
        {onEdit && (
          <button type="button" onClick={() => onEdit(compiled.error.line)}>
            Edit the Program
          </button>
        )}
      </div>
    )

  return (
    <div className="vbRunWrap" ref={wrapRef} data-touch-surface>
      {notice && (
        <div className="vbRunNotice" role="status">
          {notice}
          <button type="button" onClick={() => setNotice("")} aria-label="Close">
            ×
          </button>
        </div>
      )}
      <div className="vbRunBox" style={{ width: w * scale, height: h * scale }}>
        {!killed && <iframe ref={frameRef} title={project.form.caption || "Program"} className="vbRunFrame" sandbox={SANDBOX_ATTR} srcDoc={srcdoc} style={{ width: w, height: h, transform: `scale(${scale})` }} data-vb-frame />}
        {killed && <div className="vbRunEnded">This program was ended.</div>}
      </div>
      {stalled && !killed && (
        <div className="vbRunStalled" role="alertdialog">
          <p>
            <b>{project.form.caption || "This program"}</b> is not responding.
          </p>
          <button type="button" onClick={() => setKilled(true)}>
            End Program
          </button>
        </div>
      )}
    </div>
  )
}

export default Runner
