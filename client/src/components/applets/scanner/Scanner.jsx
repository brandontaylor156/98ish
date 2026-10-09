import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import MoreOptions from "../../shared/MoreOptions"
import PrimaryBar from "../../shared/PrimaryBar"
import ContextMenu from "../../shared/ContextMenu"
import Dialog from "../../shared/Dialog"
import { summarize } from "../../../utils/disclosure"
import { helpItem } from "../../../utils/help"
import { openItem } from "../../../utils/openItem"
import { shareOut } from "../../../utils/share"
import { makePdf } from "../../../utils/pdfWriter"
import { cameraProblem, isAppleMobile } from "../camera/support"
import { FILTERS, MAX_PAGES, clampCorner, defaultCorners, movePage, scanName } from "./scanMath"
import { blobToDataUrl, decodePicture, findPage, grabFrame, keepPhoto, liveOutline, renderPage } from "./scanImage"
import "./Scanner.css"

// Scanner 98: a document scanner made from the phone's (or computer's) camera, all on the
// device. Baseline: the camera with the page outlined live and a big Scan button (or Pick a
// Photo...); then the four corners to drag into place and Keep Scan; then the pages with
// Color / Grayscale / Black & white, Save PDF (C:\Documents, opens in PDF Viewer) and Send to
// My Phone. Saving the pages as pictures, the file name and the camera switch are under
// More options; a page's own menu (tap it) moves, turns, re-crops or deletes it.
// The math is in scanMath.js (tested), the PDF in utils/pdfWriter.js (no library).

const PREFS = "98ish.scanner"
const readPrefs = () => {
  try {
    return { filter: "color", facing: "environment", ...JSON.parse(localStorage.getItem(PREFS) || "{}") }
  } catch {
    return { filter: "color", facing: "environment" }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pageIds = 0

// ---- the live camera ----

const LiveCamera = ({ facing, paused, onShot, onPick, onProblem, pageCount, onPages, busy }) => {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const scratch = useRef(null)
  const [state, setState] = useState({ phase: "starting", problem: null })
  const [outline, setOutline] = useState(null)
  const [dims, setDims] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const iphone = typeof navigator !== "undefined" && isAppleMobile(navigator.userAgent, navigator.maxTouchPoints)

  useEffect(() => {
    if (paused) return
    let gone = false
    const env = { secure: window.isSecureContext !== false, hasMedia: !!navigator.mediaDevices?.getUserMedia, iphone }
    if (!env.secure || !env.hasMedia) {
      setState({ phase: "error", problem: cameraProblem(env) })
      return
    }
    setState({ phase: "starting", problem: null })
    const start = async () => {
      let stream
      try {
        // documents want detail: ask for a big picture, take what the camera gives
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 2560 }, height: { ideal: 1920 } }, audio: false })
      } catch (error) {
        if (!["OverconstrainedError", "NotReadableError", "AbortError"].includes(error?.name)) throw error
        await sleep(600)
        if (gone) return
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      }
      if (gone) return stream.getTracks().forEach((t) => t.stop())
      streamRef.current = stream
      const el = videoRef.current
      el.srcObject = stream
      el.muted = true
      el.setAttribute("playsinline", "")
      await el.play().catch(() => {})
      if (gone) return
      setState({ phase: "live", problem: null })
    }
    start().catch((error) => !gone && setState({ phase: "error", problem: cameraProblem(env, error) }))
    return () => {
      gone = true
      for (const t of streamRef.current?.getTracks() || []) t.stop()
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      setOutline(null)
    }
  }, [facing, paused, attempt])

  // the page outlined live, a few times a second (a 160-pixel look: a few milliseconds)
  useEffect(() => {
    if (state.phase !== "live" || paused) return
    scratch.current ||= document.createElement("canvas")
    const timer = setInterval(() => {
      const v = videoRef.current
      if (!v || v.readyState < 2) return
      if (!dims || dims.w !== v.videoWidth) setDims({ w: v.videoWidth, h: v.videoHeight })
      try {
        setOutline(liveOutline(v, scratch.current))
      } catch {
        setOutline(null)
      }
    }, 350)
    return () => clearInterval(timer)
  }, [state.phase, paused, dims])

  useEffect(() => onProblem?.(state.problem), [state.problem])

  const shoot = () => {
    const v = videoRef.current
    const frame = v && grabFrame(v)
    if (frame) onShot(frame)
  }

  return (
    <div className="scanCam">
      <div className="scanLive" data-state={state.phase}>
        <video ref={videoRef} className="scanVideo" playsInline muted autoPlay aria-hidden="true" />
        {dims && outline && (
          <svg className="scanOutline" viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            <polygon points={outline.map((p) => `${p.x},${p.y}`).join(" ")} />
          </svg>
        )}
        {state.phase === "starting" && <p className="scanNote">Starting the camera...</p>}
        {state.phase === "live" && <p className="scanHint">{outline ? "Page found. Hold still and press Scan." : "Lay the page on something darker and fit it in view."}</p>}
        {state.phase === "error" && state.problem && (
          <div className="scanProblem window" role="alert">
            <div className="title-bar">
              <div className="title-bar-text">Scanner 98</div>
            </div>
            <div className="window-body">
              <p>
                <b>{state.problem.title}</b>
              </p>
              <p>{state.problem.text}</p>
              <div className="scanProblemButtons">
                {state.problem.retry && (
                  <button type="button" onClick={() => setAttempt((n) => n + 1)}>
                    Try Again
                  </button>
                )}
                <button type="button" onClick={onPick}>
                  Pick a Photo...
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="scanCamBar">
        <button type="button" className="scanSide" onClick={onPick} disabled={busy}>
          Pick a Photo...
        </button>
        <button type="button" className="scanShutter" onClick={shoot} disabled={state.phase !== "live" || busy || pageCount >= MAX_PAGES} aria-label="Scan this page">
          <svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true">
            <path d="M7 3h13l6 6v20H7z" fill="#fff" stroke="#000" />
            <path d="M20 3v6h6" fill="#dfdfdf" stroke="#000" />
            <path d="M10 14h12M10 18h12M10 22h8" stroke="#000080" strokeWidth="1.5" />
            <path d="M3 12h26" stroke="#e00000" strokeWidth="2" />
          </svg>
          {busy ? "Working..." : "Scan"}
        </button>
        <button type="button" className="scanSide scanPagesBtn" onClick={onPages} disabled={!pageCount}>
          {pageCount ? `${pageCount} page${pageCount === 1 ? "" : "s"} »` : "No pages yet"}
        </button>
      </div>
    </div>
  )
}

// ---- dragging the four corners ----

const LOUPE = 104 // px
const ZOOM = 2.5

const CornerEditor = ({ photo, corners, onChange }) => {
  const svgRef = useRef(null)
  const imgRef = useRef(null)
  const loupeRef = useRef(null)
  const [url, setUrl] = useState(null)
  const [unit, setUnit] = useState(1) // photo pixels per screen pixel
  const [drag, setDrag] = useState(null) // { i, id, at: { x, y } screen px in the stage }

  useEffect(() => {
    const u = URL.createObjectURL(photo.blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [photo.blob])

  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const measure = () => {
      const m = svg.getScreenCTM?.()
      if (m && m.a) setUnit(1 / m.a)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(svg)
    return () => ro.disconnect()
  }, [url])

  const toPhoto = (e) => {
    const svg = svgRef.current
    const m = svg.getScreenCTM()
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
    return clampCorner(pt, photo.w, photo.h)
  }

  const drawLoupe = (p) => {
    const c = loupeRef.current
    const img = imgRef.current
    if (!c || !img?.complete) return
    const ctx = c.getContext("2d")
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (c.width !== LOUPE * dpr) c.width = c.height = LOUPE * dpr
    const span = (LOUPE * unit) / ZOOM // photo px shown across
    ctx.fillStyle = "#808080"
    ctx.fillRect(0, 0, c.width, c.height)
    const sx = img.naturalWidth / photo.w
    ctx.drawImage(img, (p.x - span / 2) * sx, (p.y - span / 2) * sx, span * sx, span * sx, 0, 0, c.width, c.height)
    ctx.strokeStyle = "#ff0000"
    ctx.lineWidth = dpr
    ctx.beginPath()
    ctx.moveTo(c.width / 2, c.height / 2 - 10 * dpr)
    ctx.lineTo(c.width / 2, c.height / 2 + 10 * dpr)
    ctx.moveTo(c.width / 2 - 10 * dpr, c.height / 2)
    ctx.lineTo(c.width / 2 + 10 * dpr, c.height / 2)
    ctx.stroke()
  }

  const down = (e, i) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    // the finger's offset from the corner is kept, so the corner doesn't jump under it
    const p = toPhoto(e)
    setDrag({ i, id: e.pointerId, dx: corners[i].x - p.x, dy: corners[i].y - p.y })
    requestAnimationFrame(() => drawLoupe(corners[i]))
  }
  const move = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const p = toPhoto(e)
    const next = clampCorner({ x: p.x + drag.dx, y: p.y + drag.dy }, photo.w, photo.h)
    const list = corners.map((c, k) => (k === drag.i ? next : c))
    onChange(list)
    drawLoupe(next)
  }
  const up = (e) => {
    if (drag && e.pointerId === drag.id) setDrag(null)
  }

  const r = 11 * unit
  const hit = 24 * unit
  // the loupe sits in the corner away from the finger
  const loupeLeft = drag ? corners[drag.i].x > photo.w / 2 : false

  return (
    <div className="scanAdjust" data-touch-surface onContextMenu={(e) => e.preventDefault()}>
      <div className="scanFrame">
        {url && <img ref={imgRef} src={url} alt="" className="scanPhoto" draggable="false" />}
        <svg ref={svgRef} className="scanCorners" viewBox={`0 0 ${photo.w} ${photo.h}`} preserveAspectRatio="xMidYMid meet" onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="group" aria-label="Page corners">
          <polygon className="scanQuad" points={corners.map((p) => `${p.x},${p.y}`).join(" ")} />
          {corners.map((p, i) => (
            <g key={i} className={drag?.i === i ? "scanHandle is-drag" : "scanHandle"} onPointerDown={(e) => down(e, i)} data-corner={i}>
              <circle cx={p.x} cy={p.y} r={hit} className="scanHit" />
              <circle cx={p.x} cy={p.y} r={r} className="scanDot" />
            </g>
          ))}
        </svg>
        {drag && <canvas ref={loupeRef} className={`scanLoupe${loupeLeft ? " is-left" : ""}`} style={{ width: LOUPE, height: LOUPE }} aria-hidden="true" />}
      </div>
    </div>
  )
}

// ---- the program ----

const Scanner = ({ mobile, dispatch, onClose, paused }) => {
  const [prefs, setPrefsState] = useState(readPrefs)
  const setPrefs = (patch) =>
    setPrefsState((p) => {
      const next = { ...p, ...patch }
      try {
        localStorage.setItem(PREFS, JSON.stringify(next))
      } catch {
        // this visit only
      }
      return next
    })
  const [phase, setPhase] = useState("camera") // camera | adjust | pages
  const [pages, setPages] = useState([]) // { id, photo, corners, turns, out: { jpeg, blob, w, h, thumb } | null }
  const [draft, setDraft] = useState(null) // { photo, corners, found, editing: page id | null }
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [saved, setSaved] = useState(null) // the saved PDF file
  const [menu, setMenu] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [name, setName] = useState(() => scanName())
  const fileRef = useRef(null)
  const pagesRef = useRef(pages)
  pagesRef.current = pages

  // page pictures are object URLs: let them go with the pages
  useEffect(() => () => pagesRef.current.forEach((p) => p.out?.thumb && URL.revokeObjectURL(p.out.thumb)), [])

  // ---- photo in ----
  const takePhoto = async (source, w, h) => {
    setBusy(true)
    setStatus("Finding the page...")
    try {
      const photo = await keepPhoto(source, w, h)
      setDraft({ photo: { blob: photo.blob, w: photo.w, h: photo.h }, corners: photo.corners, found: photo.found, editing: null })
      setStatus(photo.found ? "Drag a corner to fix it, then press Keep Scan." : "No page edges found: drag the corners onto the page's corners.")
      setPhase("adjust")
    } catch (error) {
      setStatus(error?.message || "That photo couldn't be used.")
    } finally {
      setBusy(false)
    }
  }
  const fromCamera = (frame) => takePhoto(frame, frame.width, frame.height)
  const fromFile = async (file) => {
    if (!file) return
    if (pages.length >= MAX_PAGES) return setStatus(`A scan holds up to ${MAX_PAGES} pages. Save this one first.`)
    setBusy(true)
    try {
      const pic = await decodePicture(file)
      try {
        await takePhoto(pic.source, pic.w, pic.h)
      } finally {
        pic.close()
      }
    } catch (error) {
      setStatus(error?.message || "That picture couldn't be opened.")
      setBusy(false)
    }
  }
  const pick = () => fileRef.current?.click()

  // ---- corners -> a page ----
  const keep = async () => {
    if (!draft) return
    setBusy(true)
    setStatus("Straightening the page...")
    try {
      const editing = draft.editing && pages.find((p) => p.id === draft.editing)
      const page = editing ? { ...editing, corners: draft.corners } : { id: ++pageIds, photo: draft.photo, corners: draft.corners, turns: 0 }
      const out = await renderPage(page, prefs.filter)
      if (editing?.out?.thumb) URL.revokeObjectURL(editing.out.thumb)
      const done = { ...page, out }
      setPages((list) => (editing ? list.map((p) => (p.id === done.id ? done : p)) : [...list, done]))
      setDraft(null)
      setSaved(null)
      setStatus(editing ? "Page updated." : `Page ${pages.length + 1} kept. Scan the next page, or press the pages button to save.`)
      setPhase(editing ? "pages" : "camera")
    } catch (error) {
      setStatus(error?.message || "The page couldn't be made.")
    } finally {
      setBusy(false)
    }
  }
  const retake = () => {
    const editing = draft?.editing
    setDraft(null)
    setStatus("")
    setPhase(editing ? "pages" : "camera")
  }
  const findAgain = async () => {
    if (!draft) return
    const pic = await decodePicture(draft.photo.blob)
    try {
      const found = findPage(pic.source, draft.photo.w, draft.photo.h)
      setDraft({ ...draft, corners: found.corners, found: found.found })
      setStatus(found.found ? "Page found again." : "No page edges found: drag the corners onto the page's corners.")
    } finally {
      pic.close()
    }
  }

  // ---- the pages ----
  const rerender = async (list, filter) => {
    setBusy(true)
    const next = []
    for (let i = 0; i < list.length; i++) {
      setStatus(`Making page ${i + 1} of ${list.length}...`)
      const out = await renderPage(list[i], filter)
      if (list[i].out?.thumb) URL.revokeObjectURL(list[i].out.thumb)
      next.push({ ...list[i], out })
      await sleep(0)
    }
    setPages(next)
    setBusy(false)
    setStatus("")
    setSaved(null)
    return next
  }
  const setFilter = (filter) => {
    if (filter === prefs.filter || busy) return
    setPrefs({ filter })
    if (pages.length) rerender(pages, filter)
  }
  const turnPage = async (id) => {
    const list = pages.map((p) => (p.id === id ? { ...p, turns: (p.turns + 1) % 4 } : p))
    setBusy(true)
    const page = list.find((p) => p.id === id)
    const out = await renderPage(page, prefs.filter)
    if (page.out?.thumb) URL.revokeObjectURL(page.out.thumb)
    setPages(list.map((p) => (p.id === id ? { ...page, out } : p)))
    setBusy(false)
    setSaved(null)
  }
  const deletePage = (id) => {
    const page = pages.find((p) => p.id === id)
    if (page?.out?.thumb) URL.revokeObjectURL(page.out.thumb)
    const rest = pages.filter((p) => p.id !== id)
    setPages(rest)
    setSaved(null)
    if (!rest.length) setPhase("camera")
  }
  const editCorners = (id) => {
    const page = pages.find((p) => p.id === id)
    if (!page) return
    setDraft({ photo: page.photo, corners: page.corners, found: true, editing: id })
    setStatus("Drag a corner to fix it, then press Keep Scan.")
    setPhase("adjust")
  }
  const pageMenu = (page, index, x, y) =>
    setMenu({
      x,
      y,
      items: [
        { label: "Adjust Corners...", bold: true, onClick: () => editCorners(page.id) },
        { label: "Turn Right", onClick: () => turnPage(page.id) },
        "-",
        { label: "Move Earlier", disabled: index === 0, onClick: () => (setPages(movePage(pages, index, -1)), setSaved(null)) },
        { label: "Move Later", disabled: index === pages.length - 1, onClick: () => (setPages(movePage(pages, index, 1)), setSaved(null)) },
        "-",
        { label: "Delete Page", onClick: () => deletePage(page.id) },
      ],
    })

  // the finished PDF, made ahead after every change, so Send to My Phone can share it straight
  // from the tap (iPhones only share inside the tap)
  const fileName = `${(name.trim() || scanName()).replace(/[\\/:"<>|*?]/g, "_").replace(/\.pdf$/i, "")}.pdf`
  const pdf = useMemo(() => {
    if (!pages.length || pages.some((p) => !p.out)) return null
    try {
      const bytes = makePdf(pages.map((p) => ({ jpeg: p.out.jpeg })), { title: fileName.replace(/\.pdf$/i, "") })
      return new Blob([bytes], { type: "application/pdf" })
    } catch {
      return null
    }
  }, [pages, fileName])

  const savePdf = async () => {
    if (!pdf || busy) return
    setBusy(true)
    setStatus("Saving...")
    try {
      const { keepMediaFile } = await import("../../../utils/mediaFiles")
      const result = await keepMediaFile(null, new File([pdf], fileName, { type: "application/pdf" }), { kind: "pdf", name: fileName })
      if (!result.ok) return setStatus(result.error)
      setSaved(result.file)
      setStatus(`Saved ${result.file.name} in My Documents (${Math.max(1, Math.round(pdf.size / 1024))} KB).${result.note ? ` ${result.note}` : ""}`)
    } finally {
      setBusy(false)
    }
  }
  const savePictures = async () => {
    if (!pages.length || busy) return
    setBusy(true)
    try {
      const lib = await import("../photos/library")
      const dir = lib.picturesFolder()
      const base = fileName.replace(/\.pdf$/i, "")
      let n = 0
      for (let i = 0; i < pages.length; i++) {
        setStatus(`Saving picture ${i + 1} of ${pages.length}...`)
        const result = await lib.savePicture(dir, `${base}${pages.length > 1 ? ` page ${i + 1}` : ""}.jpg`, await blobToDataUrl(pages[i].out.blob))
        if (!result.ok) return setStatus(result.error)
        n++
      }
      setStatus(`Saved ${n} picture${n === 1 ? "" : "s"} in My Pictures.`)
    } finally {
      setBusy(false)
    }
  }
  const send = () => pdf && shareOut({ title: fileName, files: [{ name: fileName, data: pdf, mime: "application/pdf" }] }, "phone", { title: "Scanner 98" })
  const openSaved = () => saved && openItem(saved, dispatch)
  const startOver = (force = false) => {
    if (!force && pages.length && !saved) return setDialog({ kind: "new" })
    pages.forEach((p) => p.out?.thumb && URL.revokeObjectURL(p.out.thumb))
    setPages([])
    setDraft(null)
    setSaved(null)
    setStatus("")
    setName(scanName())
    setPhase("camera")
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Scan", onClick: () => startOver() },
        { label: "Pick a Photo...", onClick: pick },
        "-",
        { label: "Save PDF to My Documents", disabled: !pdf, onClick: savePdf },
        { label: "Save Pages as Pictures", disabled: !pdf, onClick: savePictures },
        { label: "Send To", disabled: !pdf, items: [{ label: "My Phone", onClick: send }] },
        "-",
        { label: "Close", onClick: () => onClose?.() },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Camera", checked: phase === "camera", onClick: () => (setDraft(null), setPhase("camera")) },
        { label: "Pages", checked: phase === "pages", disabled: !pages.length, onClick: () => setPhase("pages") },
        "-",
        ...FILTERS.map((f) => ({ label: f.label, checked: prefs.filter === f.id, onClick: () => setFilter(f.id) })),
        "-",
        { label: "Switch Camera", onClick: () => setPrefs({ facing: prefs.facing === "user" ? "environment" : "user" }) },
      ],
    },
    { label: "Help", items: [helpItem({ program: "Scanner 98" }), "-", { label: "About Scanner 98", onClick: () => setDialog({ kind: "about" }) }] },
  ]

  const filterBar = (
    <div className="scanFilters" role="radiogroup" aria-label="Look">
      {FILTERS.map((f) => (
        <button key={f.id} type="button" role="radio" aria-checked={prefs.filter === f.id} className={prefs.filter === f.id ? "is-on" : ""} disabled={busy} onClick={() => setFilter(f.id)}>
          <span className={`scanSwatch scanSwatch--${f.id}`} aria-hidden="true" />
          {f.label}
        </button>
      ))}
    </div>
  )

  return (
    <div className={`scanRoot${mobile ? " is-phone" : ""}`} data-phase={phase}>
      <MenuBar menus={menus} />
      {phase === "camera" && (
        <LiveCamera
          facing={prefs.facing}
          paused={paused}
          busy={busy}
          pageCount={pages.length}
          onShot={fromCamera}
          onPick={pick}
          onPages={() => setPhase("pages")}
        />
      )}
      {phase === "adjust" && draft && (
        <>
          <CornerEditor photo={draft.photo} corners={draft.corners} onChange={(corners) => setDraft((d) => ({ ...d, corners }))} />
          <MoreOptions id="scanner.corners" inline className="scanMore" summary="Whole photo · Find the page again">
            <button type="button" onClick={() => setDraft({ ...draft, corners: defaultCorners(draft.photo.w, draft.photo.h, 0) })}>
              Use the Whole Photo
            </button>
            <button type="button" onClick={findAgain}>
              Find the Page Again
            </button>
          </MoreOptions>
          <PrimaryBar align="stretch" className="scanActions">
            <button type="button" onClick={retake} disabled={busy}>
              {draft.editing ? "Cancel" : "Retake"}
            </button>
            <button type="button" className="scanPrimary" onClick={keep} disabled={busy}>
              {busy ? "Working..." : "Keep Scan"}
            </button>
          </PrimaryBar>
        </>
      )}
      {phase === "pages" && (
        <div className="scanPagesView">
          {filterBar}
          <ol className="scanPages" aria-label="Pages">
            {pages.map((p, i) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="scanPage"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    pageMenu(p, i, r.left + r.width / 2, r.top + r.height / 2)
                  }}
                  onContextMenu={(e) => (e.preventDefault(), pageMenu(p, i, e.clientX, e.clientY))}
                  aria-label={`Page ${i + 1}: tap for its menu`}
                >
                  {p.out ? <img src={p.out.thumb} alt="" draggable="false" /> : <span className="scanPageBusy">...</span>}
                  <span className="scanPageNo">{i + 1}</span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" className="scanPage scanAdd" onClick={() => setPhase("camera")} disabled={pages.length >= MAX_PAGES}>
                <span aria-hidden="true">+</span>
                Scan More
              </button>
            </li>
          </ol>
          <MoreOptions id="scanner.save" className="scanMore" summary={summarize(fileName, "PDF in My Documents")}>
            <div className="field-row-stacked scanName">
              <label htmlFor="scan-name">File name:</label>
              <input id="scan-name" value={name} maxLength={60} onChange={(e) => (setName(e.target.value), setSaved(null))} enterKeyHint="done" />
            </div>
            <button type="button" onClick={savePictures} disabled={!pdf || busy}>
              Save Pages as Pictures (My Pictures)
            </button>
            <button type="button" onClick={() => startOver()}>
              New Scan
            </button>
          </MoreOptions>
          <PrimaryBar align="stretch" className="scanActions">
            <button type="button" className="scanPrimary" onClick={savePdf} disabled={!pdf || busy}>
              Save PDF
            </button>
            <button type="button" onClick={send} disabled={!pdf || busy}>
              Send to My Phone
            </button>
          </PrimaryBar>
        </div>
      )}
      {status && (
        <p className="scanStatus" role="status">
          {status}
          {saved && phase === "pages" && (
            <button type="button" className="scanLink" onClick={openSaved}>
              Open
            </button>
          )}
        </p>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (fromFile(e.target.files?.[0]), (e.target.value = ""))} />
      {menu && <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {dialog?.kind === "new" && (
        <Dialog
          title="Scanner 98"
          sound="chord"
          okLabel="Start Over"
          onOk={() => (setDialog(null), startOver(true))}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">
            The {pages.length} page{pages.length === 1 ? "" : "s"} you scanned aren't saved. Start a new scan anyway?
          </p>
        </Dialog>
      )}
      {dialog?.kind === "about" && (
        <Dialog title="About Scanner 98" onOk={() => setDialog(null)}>
          <p className="dialogText">Scanner 98 turns photos of pages into straight, clean PDFs. Everything happens on this device: your pages are never uploaded.</p>
        </Dialog>
      )}
    </div>
  )
}

export default Scanner
