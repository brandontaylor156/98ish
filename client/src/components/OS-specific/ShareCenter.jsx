import React, { useEffect, useState } from "react"
import Dialog from "../shared/Dialog"
import { imageMapper } from "../../utils/imageMapper"
import { DESKTOP, DOCUMENTS, pathLabel, planReceived } from "../../utils/shareRules"
import { folderAt, receiveFiles, saveLink, saveNote } from "../../utils/receive"
import { launch, webWindow, notepadWindow, photosWindow } from "../../utils/programs"
import "./ShareCenter.css"

// Sharing between 98ish and the phone, the desktop-wide part:
//  - messages from Send To (utils/share.js): "downloaded instead", "copied instead"...
//  - Received Items: what the phone shared TO 98ish. The installed app on Android shows up
//    in the share sheet (manifest share_target); the service worker (public/sw.js) keeps
//    what arrives in the "share-inbox" cache and opens /?share-target=<id>. A GET share
//    (/share-target?title=&text=&url=) works too. iPhone Safari can't be a share target,
//    so there it's Upload from Phone and Paste instead.

const INBOX = "share-inbox"

// everything waiting in the inbox: [{ id, title, text, url, files: [File] }], oldest first
const readInbox = async () => {
  if (typeof caches === "undefined") return []
  if (!(await caches.has(INBOX))) return []
  const cache = await caches.open(INBOX)
  const out = []
  for (const request of await cache.keys()) {
    if (!new URL(request.url).pathname.endsWith("/meta")) continue
    try {
      const meta = await (await cache.match(request)).json()
      const files = []
      for (const f of meta.files || []) {
        const res = await cache.match(f.key)
        if (res) files.push(new File([await res.blob()], f.name, { type: f.type }))
      }
      out.push({ ...meta, files })
    } catch {
      // a damaged entry: dropped with the rest below
    }
  }
  return out.sort((a, b) => (a.at || 0) - (b.at || 0))
}

const clearInbox = async () => {
  if (typeof caches !== "undefined") await caches.delete(INBOX).catch(() => {})
}

// the share in the address (?share-target=..., or a GET share), then a clean address
const takeAddressShare = () => {
  const url = new URL(window.location.href)
  const marked = url.searchParams.has("share-target") || url.pathname === "/share-target"
  if (!marked) return { marked: false }
  const get = { title: url.searchParams.get("title") || "", text: url.searchParams.get("text") || "", url: url.searchParams.get("url") || "", files: [] }
  const failed = url.searchParams.get("share-target") === "failed"
  for (const key of ["share-target", "title", "text", "url"]) url.searchParams.delete(key)
  window.history.replaceState(window.history.state, "", (url.pathname === "/share-target" ? "/" : url.pathname) + url.search + url.hash)
  return { marked: true, failed, get: get.title || get.text || get.url ? get : null }
}

const ICONS = { image: imageMapper.image, text: imageMapper.text, richtext: imageMapper.richtext, sound: imageMapper.song, movie: imageMapper.movie, pdf: imageMapper.pdf, link: imageMapper.internet, note: imageMapper.note, unsupported: imageMapper.text }

const KIND_NAME = { image: "Picture", text: "Text document", richtext: "Web page / document", sound: "Song (kept whole)", movie: "Video (kept as it is)", pdf: "PDF", link: "Web link", note: "Text", unsupported: "File" }

// the choices for each row: [value, label]
const choicesFor = (entry) => {
  if (entry.kind === "link")
    return [
      ["shortcut", "Shortcut on the desktop"],
      ["ie", "Open in Compass"],
      ["both", "Shortcut and open it"],
      ["skip", "Don't save"],
    ]
  if (entry.kind === "note")
    return [
      ["notepad", "New Notepad document"],
      ["skip", "Don't save"],
    ]
  if (entry.kind === "unsupported") return []
  const home = pathLabel(entry.dest)
  return [
    ["dest", `Save in ${home}`],
    ...(entry.dest !== DESKTOP ? [["desktop", "Save on the desktop"]] : []),
    ["skip", "Don't save"],
  ]
}

const defaultChoice = (entry) => (entry.kind === "link" ? "shortcut" : entry.kind === "note" ? "notepad" : "dest")

const ShareCenter = ({ dispatch }) => {
  const [notices, setNotices] = useState([])
  const [received, setReceived] = useState(null) // { entries, choices }
  const [busy, setBusy] = useState(null)
  const [report, setReport] = useState(null)

  // Send To's messages
  useEffect(() => {
    const onNotice = (e) => setNotices((list) => [...list, e.detail])
    window.addEventListener("98ish:notice", onNotice)
    return () => window.removeEventListener("98ish:notice", onNotice)
  }, [])

  // anything shared to 98ish
  useEffect(() => {
    let live = true
    const look = async () => {
      const address = takeAddressShare()
      const batches = await readInbox().catch(() => [])
      if (address.get) batches.push(address.get)
      if (!live) return
      if (address.failed && !batches.length) {
        setNotices((list) => [...list, { title: "Received Items", text: "Something was shared to 98ish, but it couldn't be read. Try sharing it again, or use Upload from Phone in My Computer." }])
        return
      }
      const entries = batches.flatMap((b) => planReceived(b))
      if (!entries.length) {
        if (batches.length) await clearInbox()
        return
      }
      setReceived({ entries, choices: entries.map(defaultChoice) })
    }
    look()
    // the app was already open when something was shared (it's opened at a new address)
    const onShow = () => window.location.search.includes("share-target") && look()
    window.addEventListener("pageshow", onShow)
    return () => {
      live = false
      window.removeEventListener("pageshow", onShow)
    }
  }, [])

  const cancel = async () => {
    setReceived(null)
    await clearInbox()
  }

  const save = async () => {
    const { entries, choices } = received
    setReceived(null)
    const lines = []
    const problems = []
    const opens = []
    let lastPicture = null
    const pictures = []
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]
      const choice = choices[i]
      if (choice === "skip" || entry.kind === "unsupported") continue
      setBusy(`Saving ${i + 1} of ${entries.length}...`)
      try {
        if (entry.kind === "link") {
          if (choice === "shortcut" || choice === "both") {
            const made = await saveLink(folderAt(DESKTOP), entry.name, entry.url)
            lines.push(`${made.name}: shortcut on the desktop`)
          }
          if (choice === "ie" || choice === "both") opens.push(webWindow(entry.url))
          continue
        }
        if (entry.kind === "note") {
          const made = await saveNote(folderAt(DOCUMENTS), entry.name, entry.text)
          lines.push(`${made.name}: ${pathLabel(DOCUMENTS)}`)
          opens.push(notepadWindow(made))
          continue
        }
        const where = choice === "desktop" ? DESKTOP : entry.dest
        const result = await receiveFiles(folderAt(where), [entry.file])
        problems.push(...result.problems, ...result.notes)
        for (const made of result.added) {
          lines.push(`${made.name}: ${pathLabel(where)}`)
          if (made.isImage) {
            lastPicture = made
            pictures.push(made)
          }
        }
      } catch (error) {
        problems.push(error.message || `${entry.name} couldn't be saved.`)
      }
    }
    setBusy(null)
    await clearInbox()
    for (const win of opens) dispatch?.({ type: "open_window", payload: win })
    if (lines.length || problems.length) setReport({ lines, problems, picture: lastPicture, pictures })
  }

  const notice = notices[0]
  const anything = notice || received || busy || report
  if (!anything) return null

  return (
    <div className="globalMenuLayer shareLayer">
      {received && (
        <Dialog title="Received Items" okLabel="Save" onOk={save} onCancel={cancel} sound="ding">
          <div className="shareReceived" data-testid="received-items">
            <p className="dialogText">
              {received.entries.length === 1 ? "This was" : "These were"} shared to 98ish from another app. Choose where {received.entries.length === 1 ? "it goes" : "each one goes"}, then click Save.
            </p>
            <ul className="shareList">
              {received.entries.map((entry, i) => {
                const choices = choicesFor(entry)
                return (
                  <li key={i} className="shareRow">
                    <img src={"/assets/" + ICONS[entry.kind]} alt="" />
                    <div className="shareRowMain">
                      <b className="shareName" title={entry.url || entry.name}>
                        {entry.name}
                      </b>
                      <span className="shareKind">{entry.kind === "link" ? entry.url : KIND_NAME[entry.kind]}</span>
                      {choices.length ? (
                        <select
                          aria-label={`What to do with ${entry.name}`}
                          value={received.choices[i]}
                          onChange={(e) => {
                            const value = e.target.value
                            setReceived((r) => ({ ...r, choices: r.choices.map((c, j) => (j === i ? value : c)) }))
                          }}
                        >
                          {choices.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="shareNo">98ish can't keep this kind of file (pictures, songs, videos, PDFs, text and web pages can come in).</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        </Dialog>
      )}

      {busy && (
        <Dialog title="Received Items">
          <p className="dialogText">{busy}</p>
        </Dialog>
      )}

      {report && !busy && (
        <Dialog
          title="Received Items"
          sound={report.problems.length ? "ding" : undefined}
          okLabel="OK"
          onOk={() => setReport(null)}
          onNo={report.picture ? () => (dispatch?.({ type: "open_window", payload: photosWindow(report.picture) }), setReport(null)) : undefined}
          noLabel="View Picture"
        >
          <div data-testid="received-report">
            {report.lines.length > 0 && (
              <>
                <p className="dialogText">Saved:</p>
                <ul className="shareSaved">
                  {report.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </>
            )}
            {report.problems.map((text, i) => (
              <p key={i} className="dialogText">
                {text}
              </p>
            ))}
            {report.pictures?.length > 0 && (
              <button
                type="button"
                className="shareAlbum"
                onClick={() => {
                  dispatch?.({ type: "open_window", payload: launch("Photos", { handoff: { id: Date.now(), addToAlbum: report.pictures.map((file) => ({ file })) } }) })
                  setReport(null)
                }}
              >
                Add to a Shared Album...
              </button>
            )}
          </div>
        </Dialog>
      )}

      {notice && !received && !busy && !report && (
        <Dialog title={notice.title || "98ish"} sound="ding" onOk={() => setNotices((list) => list.slice(1))}>
          <p className="dialogText" data-testid="share-notice">
            {notice.text}
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default ShareCenter
