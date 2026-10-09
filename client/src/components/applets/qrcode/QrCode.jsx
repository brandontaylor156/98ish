import React, { useEffect, useMemo, useRef, useState } from "react"
import MoreOptions from "../../shared/MoreOptions"
import { encodeQr, drawQr } from "./qrEncode"
import { copyText } from "../../../utils/systemClipboard"
import { shareOut, filePayload } from "../../../utils/share"
import { webWindow } from "../../../utils/programs"
import { cameraProblem, isAppleMobile } from "../camera/support"
import "./QrCode.css"

// QR Code: Make one from text or a link (encoded on this device, qrEncode.js) and save or send
// it; Scan one with the camera or from a picture. Reading uses the browser's BarcodeDetector
// where it has one (Chrome on Android/Mac), otherwise jsQR (Apache-2.0), downloaded from
// jsDelivr the first time something is scanned. Nothing leaves the device either way.

export const JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm"
let jsqrLib = null
const loadJsQR = () =>
  (jsqrLib ||= import(/* @vite-ignore */ JSQR_URL)
    .then((m) => m.default || m)
    .catch((error) => {
      jsqrLib = null
      throw error
    }))

let detector = null
const barcodeDetector = async () => {
  if (detector !== null) return detector
  try {
    if (typeof window.BarcodeDetector === "function" && (await window.BarcodeDetector.getSupportedFormats?.())?.includes("qr_code")) detector = new window.BarcodeDetector({ formats: ["qr_code"] })
    else detector = false
  } catch {
    detector = false
  }
  return detector
}

// read a QR code from a video frame or picture -> text | null
const readFrom = async (source, width, height, scratch) => {
  const d = await barcodeDetector()
  if (d) {
    try {
      const found = await d.detect(source)
      if (found?.length) return found[0].rawValue
      return null
    } catch {
      // fall through to jsQR
    }
  }
  const jsQR = await loadJsQR()
  const scale = Math.min(1, 800 / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  scratch.width = w
  scratch.height = h
  const ctx = scratch.getContext("2d", { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, w, h)
  const img = ctx.getImageData(0, 0, w, h)
  const hit = jsQR(img.data, w, h, { inversionAttempts: "attemptBoth" })
  return hit ? hit.data : null
}

const isLink = (text) => /^https?:\/\/\S+$/i.test(String(text || "").trim())
// "WIFI:T:WPA;S:name;P:secret;;" -> { ssid, password, type }
export const parseWifi = (text) => {
  const m = /^WIFI:(.*);;?$/i.exec(String(text || "").trim())
  if (!m) return null
  const out = {}
  for (const part of m[1].match(/(?:\\.|[^;])+/g) || []) {
    const i = part.indexOf(":")
    if (i > 0) out[part.slice(0, i).toUpperCase()] = part.slice(i + 1).replace(/\\(.)/g, "$1")
  }
  return out.S ? { ssid: out.S, password: out.P || "", type: out.T || "" } : null
}
const wifiEscape = (s) => String(s).replace(/([\\;,:"])/g, "\\$1")

const QrCode = ({ dispatch, paused = false, mobile = false }) => {
  const [tab, setTab] = useState("make")
  return (
    <div className="qrRoot">
      <menu role="tablist" className="qrTabs">
        <li role="tab" aria-selected={tab === "make"}>
          <button type="button" onClick={() => setTab("make")}>
            Make
          </button>
        </li>
        <li role="tab" aria-selected={tab === "scan"}>
          <button type="button" onClick={() => setTab("scan")}>
            Scan
          </button>
        </li>
      </menu>
      <div className="window qrPanel" role="tabpanel">
        <div className="window-body">{tab === "make" ? <Make mobile={mobile} /> : <Scan dispatch={dispatch} paused={paused} />}</div>
      </div>
    </div>
  )
}

const Make = ({ mobile }) => {
  const [text, setText] = useState("https://98ish.vercel.app")
  const [ecc, setEcc] = useState("M")
  const [wifi, setWifi] = useState({ ssid: "", password: "", type: "WPA" })
  const [status, setStatus] = useState(null)
  const canvasRef = useRef(null)
  const blobRef = useRef(null)
  const content = text
  const qr = useMemo(() => {
    try {
      return { qr: encodeQr(content, { ecc }) }
    } catch (error) {
      return { error: error.message }
    }
  }, [content, ecc])

  useEffect(() => {
    const canvas = canvasRef.current
    blobRef.current = null
    if (!canvas || !qr.qr) return
    drawQr(canvas.getContext("2d"), qr.qr, 8)
    // ready before a tap on Send (sharing must start inside the tap)
    canvas.toBlob((blob) => (blobRef.current = blob), "image/png")
  }, [qr])

  const fileName = () => `QR ${content.replace(/^https?:\/\//i, "").replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 30) || "code"}.png`

  const save = async () => {
    if (!qr.qr) return
    const lib = await import("../photos/library")
    const result = await lib.savePicture(lib.picturesFolder(), fileName(), canvasRef.current.toDataURL("image/png"))
    setStatus(result?.ok ? `Saved as ${result.file.name} in My Pictures.` : result?.error || "It couldn't be saved.")
  }
  const send = () => {
    if (!blobRef.current) return
    shareOut(filePayload("QR Code", { name: fileName(), data: blobRef.current, mime: "image/png" }), "phone", { title: "QR Code" })
  }
  const useWifi = () => {
    if (!wifi.ssid) return
    setText(`WIFI:T:${wifi.type === "none" ? "nopass" : wifi.type};S:${wifiEscape(wifi.ssid)};${wifi.type === "none" ? "" : `P:${wifiEscape(wifi.password)};`};`)
  }

  return (
    <div className="qrMake">
      <label className="qrLabel" htmlFor="qr-text">
        Text or link:
      </label>
      <textarea id="qr-text" className="qrText" value={text} onChange={(e) => setText(e.target.value)} rows={mobile ? 2 : 3} maxLength={2000} spellCheck="false" autoCapitalize="off" data-qr-text="" />
      <div className="qrCodeBox">
        {qr.qr ? <canvas ref={canvasRef} className="qrCanvas" aria-label={`QR code for ${content}`} data-qr-canvas="" /> : <div className="qrError">{content ? qr.error : "Type something to make a code."}</div>}
      </div>
      <div className="qrButtons">
        <button type="button" onClick={save} disabled={!qr.qr}>
          Save to My Pictures
        </button>
        <button type="button" onClick={send} disabled={!qr.qr}>
          Send...
        </button>
      </div>
      {status && <div className="qrStatus">{status}</div>}
      <MoreOptions id="qrcode.make" summary={`Error correction ${ecc}${qr.qr ? ` · version ${qr.qr.version}` : ""}`}>
        <div className="qrOptions">
          <label>
            Error correction:{" "}
            <select value={ecc} onChange={(e) => setEcc(e.target.value)}>
              <option value="L">Low (7%): smallest code</option>
              <option value="M">Medium (15%)</option>
              <option value="Q">Quartile (25%)</option>
              <option value="H">High (30%): survives smudges</option>
            </select>
          </label>
          <fieldset>
            <legend>Wi-Fi network</legend>
            <div className="qrWifi">
              <input placeholder="Network name" value={wifi.ssid} onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} autoCapitalize="off" autoCorrect="off" />
              <input placeholder="Password" value={wifi.password} onChange={(e) => setWifi({ ...wifi, password: e.target.value })} autoCapitalize="off" autoCorrect="off" disabled={wifi.type === "none"} />
              <select value={wifi.type} onChange={(e) => setWifi({ ...wifi, type: e.target.value })}>
                <option value="WPA">WPA/WPA2/WPA3</option>
                <option value="WEP">WEP</option>
                <option value="none">No password</option>
              </select>
              <button type="button" onClick={useWifi} disabled={!wifi.ssid}>
                Make Wi-Fi Code
              </button>
            </div>
            <p className="qrHint">Friends point their phone camera at it to join the network.</p>
          </fieldset>
          {qr.qr && (
            <p className="qrHint">
              Version {qr.qr.version} ({qr.qr.size} x {qr.qr.size}), {qr.qr.mode === "byte" ? "text" : qr.qr.mode} mode, mask {qr.qr.mask}.
            </p>
          )}
        </div>
      </MoreOptions>
    </div>
  )
}

const Scan = ({ dispatch, paused }) => {
  const [on, setOn] = useState(false)
  const [problem, setProblem] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const videoRef = useRef(null)
  const scratch = useRef(null)
  const fileRef = useRef(null)
  const iphone = typeof navigator !== "undefined" && isAppleMobile(navigator.userAgent, navigator.maxTouchPoints)

  // the camera, while Scan is showing and the window is
  useEffect(() => {
    if (!on || paused) return
    let gone = false
    let stream = null
    let timer = 0
    const env = { secure: window.isSecureContext !== false, hasMedia: !!navigator.mediaDevices?.getUserMedia, iphone }
    if (!env.secure || !env.hasMedia) {
      setProblem(cameraProblem(env))
      setOn(false)
      return
    }
    const tick = async () => {
      if (gone) return
      const v = videoRef.current
      if (v && v.readyState >= 2 && v.videoWidth) {
        try {
          const text = await readFrom(v, v.videoWidth, v.videoHeight, (scratch.current ||= document.createElement("canvas")))
          if (text && !gone) {
            setResult(text)
            setOn(false)
            navigator.vibrate?.(40)
            return
          }
        } catch {
          if (!gone) setProblem("The QR reader couldn't be downloaded. Check the internet connection and try again.")
          setOn(false)
          return
        }
      }
      timer = setTimeout(tick, 250)
    }
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        if (gone) return stream.getTracks().forEach((t) => t.stop())
        const v = videoRef.current
        v.srcObject = stream
        v.muted = true
        v.setAttribute("playsinline", "")
        await v.play().catch(() => {})
        setProblem(null)
        tick()
      } catch (error) {
        if (!gone) {
          setProblem(cameraProblem(env, error))
          setOn(false)
        }
      }
    })()
    return () => {
      gone = true
      clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [on, paused])

  const fromPicture = async (file) => {
    if (!file) return
    setBusy(true)
    setProblem(null)
    try {
      const bitmap = await createImageBitmap(file)
      const text = await readFrom(bitmap, bitmap.width, bitmap.height, (scratch.current ||= document.createElement("canvas")))
      if (text) setResult(text)
      else setProblem("No QR code was found in that picture. Try one where the code is bigger and sharp.")
    } catch {
      setProblem("That picture couldn't be read, or the QR reader couldn't be downloaded.")
    }
    setBusy(false)
  }

  const wifi = result ? parseWifi(result) : null
  return (
    <div className="qrScan">
      {result ? (
        <div className="qrResult" data-qr-result="">
          <div className="qrLabel">Found:</div>
          {wifi ? (
            <div className="qrWifiFound">
              Wi-Fi network <b>{wifi.ssid}</b>
              {wifi.password ? (
                <>
                  , password <b data-selectable="">{wifi.password}</b>
                </>
              ) : (
                " (no password)"
              )}
            </div>
          ) : (
            <div className="qrFound" data-selectable="">
              {result}
            </div>
          )}
          <div className="qrButtons">
            <button
              type="button"
              onClick={() => {
                copyText(wifi ? wifi.password || wifi.ssid : result)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? "Copied" : wifi ? "Copy Password" : "Copy"}
            </button>
            {isLink(result) && (
              <button type="button" onClick={() => dispatch?.({ type: "open_window", payload: webWindow(result.trim()) })}>
                Open Link
              </button>
            )}
            <button type="button" onClick={() => (setResult(null), setOn(true))}>
              Scan Another
            </button>
          </div>
          {isLink(result) && <p className="qrHint">Check the address before you open it: anyone can print a QR code.</p>}
        </div>
      ) : (
        <>
          <div className="qrViewer">
            <video ref={videoRef} className="qrVideo" playsInline muted hidden={!on} />
            {!on && <div className="qrIdle">{busy ? "Reading the picture..." : "Point the camera at a QR code."}</div>}
            {on && <div className="qrAim" aria-hidden="true" />}
          </div>
          {problem && (
            <div className="qrError" role="alert">
              {problem}
            </div>
          )}
          <div className="qrButtons">
            <button type="button" className="qrPrimary" onClick={() => setOn(!on)} data-qr-camera="">
              {on ? "Stop Camera" : "Start Camera"}
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}>
              Scan a Picture...
            </button>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (fromPicture(e.target.files?.[0]), (e.target.value = ""))} />
          </div>
        </>
      )}
    </div>
  )
}

export default QrCode
