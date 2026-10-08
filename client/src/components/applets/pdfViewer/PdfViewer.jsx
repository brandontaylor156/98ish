import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import MoreOptions from "../../shared/MoreOptions"
import { fs, mediaBlob } from "../../../utils/fs"
import { useFsVersion } from "../../../hooks/useFs"
import { helpItem } from "../../../utils/help"
import { itemPayload, sendToItems, shareOut, warmItem } from "../../../utils/share"
import { downloadItem } from "../../../utils/fileTransfer"
import { formatBytes } from "../../../utils/fileInfo"
import { DEVICE_ONLY_LINE } from "../../../utils/mediaRules"
import { clampZoom, pageScale, PDFJS_CDN } from "./pdfCore"
import "./PdfViewer.css"

// PDF Viewer: a PDF on drive C: (kept as it came: utils/mediaFiles.js), page by page.
// Pages are drawn with pdf.js (Mozilla, Apache-2.0) loaded from jsDelivr at a pinned
// version the first time a PDF opens; only the pages near the screen are kept drawn, so a
// long PDF doesn't fill a phone's memory. Without pdf.js (offline) it falls back to the
// browser's own viewer in a frame. Baseline: read, Send To; zoom and Open in Browser are
// under More options.

let loader = null
const loadPdfJs = () => {
  if (typeof window !== "undefined" && window.pdfjsLib) return Promise.resolve(window.pdfjsLib)
  loader ||= new Promise((resolve, reject) => {
    const el = document.createElement("script")
    el.src = `${PDFJS_CDN}pdf.min.js`
    el.async = true
    el.crossOrigin = "anonymous"
    el.onload = () => {
      const lib = window.pdfjsLib
      if (!lib) return reject(new Error("pdf.js didn't start"))
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}pdf.worker.min.js`
      resolve(lib)
    }
    el.onerror = () => {
      loader = null
      el.remove()
      reject(new Error("pdf.js couldn't be loaded"))
    }
    document.head.appendChild(el)
  })
  return loader
}

// one page: a box the right size; drawn while it's near the screen, emptied when it's far
const Page = ({ doc, number, size, width, zoom, onSeen }) => {
  const box = useRef(null)
  const canvas = useRef(null)
  const [near, setNear] = useState(false)
  const scale = pageScale(size.w, width, zoom)
  const cssW = Math.round(size.w * scale)
  const cssH = Math.round(size.h * scale)

  useEffect(() => {
    const el = box.current
    if (!el || typeof IntersectionObserver === "undefined") return setNear(true)
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        setNear(e.isIntersecting)
        if (e.isIntersecting && e.intersectionRatio > 0) onSeen(number)
      }
    }, { rootMargin: "900px 0px" })
    io.observe(el)
    return () => io.disconnect()
  }, [number])

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    if (!near) {
      // far away: give the memory back
      c.width = 0
      c.height = 0
      return
    }
    let task = null
    let live = true
    doc.getPage(number).then((page) => {
      if (!live) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const viewport = page.getViewport({ scale: scale * dpr })
      c.width = Math.floor(viewport.width)
      c.height = Math.floor(viewport.height)
      task = page.render({ canvasContext: c.getContext("2d"), viewport })
      task.promise.catch(() => {})
    })
    return () => {
      live = false
      task?.cancel?.()
    }
  }, [near, scale, doc, number])

  return (
    <div ref={box} className="pdfPage" data-page={number} style={{ width: cssW, height: cssH }}>
      <canvas ref={canvas} style={{ width: cssW, height: cssH }} aria-label={`Page ${number}`} />
    </div>
  )
}

const PdfViewer = ({ file: path = null, mobile, onTitle, onClose }) => {
  useFsVersion()
  const file = path ? fs.resolve(path) : null
  const [phase, setPhase] = useState("loading") // loading | ready | frame | missing | error
  const [url, setUrl] = useState(null)
  const [doc, setDoc] = useState(null)
  const [sizes, setSizes] = useState([])
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(360)
  const [page, setPage] = useState(1)
  const [note, setNote] = useState("")
  const scroller = useRef(null)

  useEffect(() => {
    if (file) onTitle?.(`${file.name} - PDF Viewer`)
  }, [file?.name])

  // the file -> a Blob URL -> pdf.js (or the browser's own viewer)
  useEffect(() => {
    if (!file) return setPhase("missing")
    let live = true
    let made = null
    let opened = null
    warmItem(file) // Send To needs it ready in the tap
    ;(async () => {
      const blob = await mediaBlob(file)
      if (!live) return
      if (!blob) return setPhase("missing")
      made = URL.createObjectURL(blob.type === "application/pdf" ? blob : blob.slice(0, blob.size, "application/pdf"))
      setUrl(made)
      try {
        const lib = await loadPdfJs()
        opened = await lib.getDocument({ url: made, isEvalSupported: false }).promise
        if (!live) return opened.destroy()
        const list = []
        for (let i = 1; i <= opened.numPages; i++) {
          const p = await opened.getPage(i)
          const v = p.getViewport({ scale: 1 })
          list.push({ w: v.width, h: v.height })
          if (i === 1 && live) {
            // show the first page at once; the sizes of the rest follow
            setDoc(opened)
            setSizes([...list, ...Array(Math.max(0, opened.numPages - 1)).fill({ w: v.width, h: v.height })])
            setPhase("ready")
          }
          if (!live) return
        }
        setSizes(list)
      } catch (error) {
        if (!live) return
        if (/password/i.test(error?.name || error?.message || "")) {
          setNote("This PDF has a password: open it with Send To > My Phone.")
          setPhase("error")
        } else if (/couldn't be loaded|didn't start/.test(error?.message || "")) {
          setPhase("frame") // offline: the browser's own viewer
        } else {
          setNote("This PDF couldn't be opened. It may be damaged.")
          setPhase("error")
        }
      }
    })()
    return () => {
      live = false
      opened?.destroy?.()
      if (made) setTimeout(() => URL.revokeObjectURL(made), 1000)
    }
  }, [file])

  // the page width follows the window
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setWidth(Math.max(200, el.clientWidth - (mobile ? 12 : 24)))
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [phase, mobile])

  const sendTo = sendToItems(() => itemPayload(file), { title: "PDF Viewer", disabled: !file })
  const openOutside = () => url && window.open(url, "_blank", "noopener")
  const save = () => file && downloadItem(file)
  const menus = [
    {
      label: "File",
      items: [{ label: "Send To", items: sendTo, disabled: !file }, { label: "Download", onClick: save, disabled: !file }, { label: "Open in Browser", onClick: openOutside, disabled: !url }, "-", { label: "Close", onClick: () => onClose?.() }],
    },
    {
      label: "View",
      items: [
        { label: "Zoom In", onClick: () => setZoom((z) => clampZoom(z * 1.25)), disabled: phase !== "ready" },
        { label: "Zoom Out", onClick: () => setZoom((z) => clampZoom(z / 1.25)), disabled: phase !== "ready" },
        { label: "Fit Width", onClick: () => setZoom(1), disabled: phase !== "ready" },
      ],
    },
    { label: "Help", items: [helpItem({ program: "PDF Viewer" })] },
  ]

  const deviceOnly = !!file?.deviceOnly
  return (
    <div className="pdfRoot" data-phase={phase}>
      <MenuBar menus={menus} />
      <div className="pdfBar">
        <span className="pdfPageNo" aria-live="polite">
          {phase === "ready" ? `Page ${page} of ${sizes.length}` : phase === "loading" ? "Opening..." : ""}
        </span>
        <button type="button" className="pdfShare" disabled={!file} onClick={() => shareOut(itemPayload(file), "phone", { title: "PDF Viewer" })}>
          Send to My Phone
        </button>
        <MoreOptions id="pdfviewer.more" inline className="pdfMore" label="More" lessLabel="Less" summary={zoom !== 1 ? `Zoom ${Math.round(zoom * 100)}%` : ""}>
          <button type="button" onClick={() => setZoom((z) => clampZoom(z / 1.25))} disabled={phase !== "ready"} aria-label="Zoom out">
            −
          </button>
          <button type="button" onClick={() => setZoom(1)} disabled={phase !== "ready"}>
            Fit
          </button>
          <button type="button" onClick={() => setZoom((z) => clampZoom(z * 1.25))} disabled={phase !== "ready"} aria-label="Zoom in">
            +
          </button>
          <button type="button" onClick={openOutside} disabled={!url}>
            Open in Browser
          </button>
          <button type="button" onClick={save} disabled={!file}>
            Download
          </button>
        </MoreOptions>
      </div>
      <div className="pdfScroll" ref={scroller} data-selectable>
        {phase === "ready" && doc && sizes.map((size, i) => <Page key={i} doc={doc} number={i + 1} size={size} width={width} zoom={zoom} onSeen={setPage} />)}
        {phase === "frame" && url && (
          <>
            <p className="pdfNote">Showing your browser's own viewer (the page viewer needs the internet the first time). If only one page shows, use Send to My Phone.</p>
            <iframe className="pdfFrame" src={url} title={file?.name || "PDF"} />
          </>
        )}
        {phase === "loading" && <p className="pdfNote">Opening {file?.name || "the PDF"}...</p>}
        {phase === "missing" && <p className="pdfNote">{file ? "This PDF's contents aren't on this device any more." : "There's no PDF here. Open one from My Computer."}</p>}
        {phase === "error" && <p className="pdfNote">{note}</p>}
      </div>
      <div className="status-bar pdfStatus">
        <p className="status-bar-field">{file?.name || ""}</p>
        <p className="status-bar-field">{file ? formatBytes(file.size) : ""}</p>
        {deviceOnly && <p className="status-bar-field pdfLocal">{DEVICE_ONLY_LINE}</p>}
      </div>
    </div>
  )
}

export default PdfViewer
