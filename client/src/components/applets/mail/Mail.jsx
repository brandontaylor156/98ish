import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import FileDialog from "../notepad/FileDialog"
import { useAim } from "../aim/AimContext"
import { launch } from "../../../utils/programs"
import { openItem } from "../../../utils/openItem"
import { formatSize } from "../../../utils/fileInfo"
import { ATTACHABLE, ATTACHMENTS_FOLDER, MAX_MESSAGE_BYTES, byteSize, mailApi, saveAttachment } from "./api"
import { setMailStatus, useMailStatus } from "./mailStatus"
import "./Mail.css"

// 98ish Mail, in the style of a late-90s mail program: folders, a sortable message list,
// a preview pane, and a New Message form with attachments from the 98ish drive. Your
// 98 Messenger screen name is your address. Mail is plain text only.

const FOLDERS = [
  { id: "inbox", label: "Inbox" },
  { id: "outbox", label: "Outbox" },
  { id: "sent", label: "Sent Items" },
  { id: "deleted", label: "Deleted Items" },
  { id: "drafts", label: "Drafts" },
]
const folderLabel = (id) => FOLDERS.find((f) => f.id === id)?.label || id

const when = (time, long = false) => {
  const d = new Date(time)
  if (long) return d.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
  const today = new Date().toDateString() === d.toDateString()
  return today ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

const names = (list) => (list || []).join(", ")
const EMPTY = { to: "", cc: "", subject: "", body: "", attachments: [], draftId: null }

const FolderIcon = ({ id }) => {
  const paths = {
    inbox: <path d="M2 9h3l1 2h4l1-2h3v5H2zM3 3h10l1 6h-3l-1 2H6L5 9H2z" fill="#ffd34d" stroke="#000" strokeWidth=".8" />,
    outbox: <path d="M2 6h12v8H2zM8 1l3 3H9v3H7V4H5z" fill="#9fd0ff" stroke="#000" strokeWidth=".8" />,
    sent: <path d="M1 8l14-6-4 12-3-4-4 3 1-4z" fill="#fff" stroke="#000" strokeWidth=".8" />,
    deleted: <path d="M4 4h8l-1 10H5zM3 3h10M6 2h4" fill="#c0c0c0" stroke="#000" strokeWidth=".8" />,
    drafts: <path d="M3 1h7l3 3v11H3zM5 7h6M5 9h6M5 11h4" fill="#fff" stroke="#000" strokeWidth=".8" />,
  }
  return (
    <svg className="mlFolderIcon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {paths[id]}
    </svg>
  )
}

const ToolButton = ({ label, onClick, disabled, icon }) => (
  <button type="button" className="mlTool" onClick={onClick} disabled={disabled} title={label}>
    <span className={`mlToolIcon mlToolIcon--${icon}`} aria-hidden="true" />
    <span className="mlToolLabel">{label}</span>
  </button>
)

// To/Cc box that suggests buddies from the Buddy List for the name being typed
const AddressField = ({ id, label, value, onChange, buddies }) => {
  const [focus, setFocus] = useState(false)
  const [active, setActive] = useState(0)
  const parts = value.split(",")
  const typing = parts.at(-1).trim().toLowerCase()
  const already = new Set(parts.slice(0, -1).map((p) => p.trim().toLowerCase().replace(/\s+/g, "")))
  const suggestions = typing ? buddies.filter((b) => b.toLowerCase().replace(/\s+/g, "").includes(typing.replace(/\s+/g, "")) && !already.has(b.toLowerCase().replace(/\s+/g, ""))).slice(0, 6) : []
  const choose = (name) => {
    onChange([...parts.slice(0, -1).map((p) => p.trim()).filter(Boolean), name].join(", ") + ", ")
    setActive(0)
  }
  return (
    <div className="mlField">
      <label htmlFor={id}>{label}</label>
      <div className="mlAddress">
        <input
          id={id}
          value={value}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck="false"
          onChange={(e) => {
            onChange(e.target.value)
            setActive(0)
          }}
          onFocus={() => setFocus(true)}
          onBlur={() => setTimeout(() => setFocus(false), 150)}
          onKeyDown={(e) => {
            if (!focus || !suggestions.length) return
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setActive((active + 1) % suggestions.length)
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((active - 1 + suggestions.length) % suggestions.length)
            } else if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              choose(suggestions[active] || suggestions[0])
            }
          }}
        />
        {focus && suggestions.length > 0 && (
          <ul className="mlSuggest" role="listbox">
            {suggestions.map((name, i) => (
              <li key={name} role="option" aria-selected={i === active} className={i === active ? "is-active" : undefined} onPointerDown={(e) => (e.preventDefault(), choose(name))}>
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

const Compose = ({ draft, buddies, onSend, onSaveDraft, onCancel, onAttach, onRemoveAttachment, onChange }) => {
  const size = byteSize(draft.subject) + byteSize(draft.body) + draft.attachments.reduce((n, a) => n + a.size, 0)
  return (
    <div className="mlCompose">
      <div className="mlComposeBar">
        <ToolButton label="Send" icon="send" onClick={onSend} disabled={!draft.to.trim()} />
        <ToolButton label="Save" icon="save" onClick={onSaveDraft} />
        <ToolButton label="Attach" icon="attach" onClick={onAttach} />
        <ToolButton label="Cancel" icon="cancel" onClick={onCancel} />
        <span className="mlComposeTitle">{draft.subject || "New Message"}</span>
      </div>
      <div className="mlComposeHead">
        <div className="mlField">
          <label>From:</label>
          <span className="mlFrom">{draft.from}</span>
        </div>
        <AddressField id="ml-to" label="To:" value={draft.to} onChange={(to) => onChange({ to })} buddies={buddies} />
        <AddressField id="ml-cc" label="Cc:" value={draft.cc} onChange={(cc) => onChange({ cc })} buddies={buddies} />
        <div className="mlField">
          <label htmlFor="ml-subject">Subject:</label>
          <input id="ml-subject" value={draft.subject} maxLength={120} onChange={(e) => onChange({ subject: e.target.value })} />
        </div>
        {draft.attachments.length > 0 && (
          <div className="mlField">
            <label>Attach:</label>
            <ul className="mlAttachList">
              {draft.attachments.map((a, i) => (
                <li key={`${a.name}${i}`}>
                  <span className={`mlFileIcon mlFileIcon--${a.type}`} aria-hidden="true" />
                  {a.name} ({formatSize(a.size)})
                  <button type="button" className="mlRemove" aria-label={`Remove ${a.name}`} onClick={() => onRemoveAttachment(i)}>
                    x
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <textarea className="mlBody" aria-label="Message" value={draft.body} onChange={(e) => onChange({ body: e.target.value })} spellCheck="true" />
      <div className="mlComposeFoot">
        Plain text only. {formatSize(size)} of {formatSize(MAX_MESSAGE_BYTES)}.
      </div>
    </div>
  )
}

const Preview = ({ message, loading, onAttachment, mobile, onBack }) => {
  if (loading) return <div className="mlPreviewEmpty">Opening message...</div>
  if (!message) return <div className="mlPreviewEmpty">{mobile ? "" : "Select a message to read it here."}</div>
  return (
    <div className="mlPreview">
      <div className="mlPreviewHead">
        {mobile && (
          <button type="button" className="mlBack" onClick={onBack}>
            &lt; Back
          </button>
        )}
        <div>
          <b>From:</b> {message.from}
        </div>
        <div>
          <b>To:</b> {names(message.to) || message.draftTo || "(nobody yet)"}
        </div>
        {(message.cc?.length > 0 || message.draftCc) && (
          <div>
            <b>Cc:</b> {names(message.cc) || message.draftCc}
          </div>
        )}
        <div>
          <b>Subject:</b> {message.subject || "(no subject)"}
        </div>
        <div className="mlDate">{when(message.time, true)}</div>
      </div>
      {message.attachments?.length > 0 && (
        <div className="mlAttachBar">
          {message.attachments.map((a, i) => (
            <span key={`${a.name}${i}`} className="mlAttachment">
              <span className={`mlFileIcon mlFileIcon--${a.type}`} aria-hidden="true" />
              <span className="mlAttachName">
                {a.name} ({formatSize(a.size)})
              </span>
              <button type="button" onClick={() => onAttachment(a, "open")}>
                Open
              </button>
              <button type="button" onClick={() => onAttachment(a, "save")}>
                Save
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mlText">{message.body}</div>
    </div>
  )
}

const Mail = ({ dispatch, onTitle, mobile }) => {
  const aim = useAim()
  const { status, token, me } = aim || {}
  const online = status === "online" && !!token
  const api = useMemo(() => (token ? mailApi(token) : null), [token])
  const { arrived } = useMailStatus()

  const [folder, setFolder] = useState("inbox")
  const [counts, setCounts] = useState(null)
  const [usage, setUsage] = useState(null)
  const [lists, setLists] = useState({}) // folder -> headers
  const [outbox, setOutbox] = useState([]) // messages being sent (or that failed)
  const [sort, setSort] = useState({ by: "time", dir: -1 })
  const [selected, setSelected] = useState(null)
  const [current, setCurrent] = useState(null)
  const [loadingMessage, setLoadingMessage] = useState(false)
  const [compose, setCompose] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [statusText, setStatusText] = useState("")
  const [mobileView, setMobileView] = useState("list") // list | message (phones)
  const folderRef = useRef(folder)
  folderRef.current = folder

  const buddies = useMemo(() => {
    const all = (me?.groups || []).flatMap((g) => g.buddies)
    return [...new Map(["SmarterChild", ...all].map((b) => [b.toLowerCase().replace(/\s+/g, ""), b])).values()]
  }, [me])

  const unread = counts?.inbox.unread ?? 0
  useEffect(() => {
    onTitle?.(`${unread ? `(${unread}) ` : ""}${folderLabel(folder)} - 98ish Mail`)
  }, [unread, folder])

  const refreshCounts = async () => {
    if (!api) return
    const r = await api.folders()
    if (!r.ok) return
    setCounts(r.folders)
    setUsage({ used: r.usage, cap: r.cap })
    setMailStatus({ unread: r.folders.inbox.unread })
  }

  const loadFolder = async (id = folderRef.current) => {
    if (!api || id === "outbox") return
    const CHECKING = "Checking for mail..."
    setStatusText((t) => t || CHECKING)
    const r = await api.list(id)
    if (r.ok) {
      setLists((l) => ({ ...l, [id]: r.messages }))
      setStatusText((t) => (t === CHECKING ? "" : t))
    } else setStatusText(r.error)
  }

  const refresh = () => {
    refreshCounts()
    loadFolder()
  }

  useEffect(() => {
    if (!online) {
      setLists({})
      setCounts(null)
      setCurrent(null)
      setSelected(null)
      return
    }
    refresh()
  }, [online, api])

  useEffect(() => {
    if (online) loadFolder(folder)
    setSelected(null)
    setCurrent(null)
    setMobileView("list")
  }, [folder])

  // New mail arrived (pushed by the server)
  useEffect(() => {
    if (online && arrived) refresh()
  }, [arrived])

  const messages = useMemo(() => {
    const list = folder === "outbox" ? outbox : lists[folder] || []
    const key = (m) => (sort.by === "from" ? (folder === "inbox" || folder === "deleted" ? m.from : names(m.to) || m.draftTo || "") : sort.by === "subject" ? m.subject || "" : m.time)
    return [...list].sort((a, b) => {
      const x = key(a)
      const y = key(b)
      return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), undefined, { sensitivity: "base" })) * sort.dir
    })
  }, [lists, outbox, folder, sort])

  const sortBy = (by) => setSort((s) => (s.by === by ? { by, dir: -s.dir } : { by, dir: by === "time" ? -1 : 1 }))

  const select = async (header) => {
    setSelected(header.id)
    if (mobile) setMobileView("message")
    if (folder === "outbox") return setCurrent(header)
    setLoadingMessage(true)
    const r = await api.get(header.id)
    setLoadingMessage(false)
    if (!r.ok) return setStatusText(r.error)
    setCurrent(r.message)
    if (!r.message.read) {
      await api.markRead(header.id, true)
      setLists((l) => ({ ...l, [folder]: (l[folder] || []).map((m) => (m.id === header.id ? { ...m, read: true } : m)) }))
      refreshCounts()
    }
  }

  const setRead = async (read) => {
    if (!selected || folder === "outbox") return
    const r = await api.markRead(selected, read)
    if (!r.ok) return setDialog({ kind: "error", text: r.error })
    setLists((l) => ({ ...l, [folder]: (l[folder] || []).map((m) => (m.id === selected ? { ...m, read } : m)) }))
    refreshCounts()
  }

  const afterRemoval = () => {
    setSelected(null)
    setCurrent(null)
    setMobileView("list")
    refresh()
  }

  const remove = async (confirmed = false) => {
    if (!selected) return
    if (folder === "outbox") {
      setOutbox((o) => o.filter((m) => m.id !== selected))
      return afterRemoval()
    }
    if (folder === "deleted" && !confirmed) return setDialog({ kind: "confirmDelete" })
    const r = await api.remove(selected)
    if (!r.ok) return setDialog({ kind: "error", text: r.error })
    setStatusText(folder === "deleted" ? "Message deleted." : "Message moved to Deleted Items.")
    afterRemoval()
  }

  const restore = async () => {
    if (!selected || folder !== "deleted") return
    const r = await api.restore(selected)
    if (!r.ok) return setDialog({ kind: "error", text: r.error })
    setStatusText(`Message restored to ${folderLabel(r.message.folder)}.`)
    afterRemoval()
  }

  const emptyDeleted = async () => {
    const r = await api.emptyDeleted()
    if (!r.ok) return setDialog({ kind: "error", text: r.error })
    setStatusText(`Deleted ${r.removed} ${r.removed === 1 ? "message" : "messages"} for good.`)
    afterRemoval()
  }

  // ---- composing ----

  const startCompose = (draft = {}) => {
    setCompose({ ...EMPTY, from: me?.screenName || "", ...draft })
    if (mobile) setMobileView("list")
  }

  const quoted = (m) =>
    `\n\n----- Original Message -----\nFrom: ${m.from}\nTo: ${names(m.to)}${m.cc?.length ? `\nCc: ${names(m.cc)}` : ""}\nSent: ${when(m.time, true)}\nSubject: ${m.subject || "(no subject)"}\n\n${String(m.body || "")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}`

  const reply = (all) => {
    if (!current || folder === "outbox") return
    // Reply All: everyone else who got it, but not me (or the sender twice)
    const mine = (name) => name.toLowerCase().replace(/\s+/g, "") === (me?.screenName || "").toLowerCase().replace(/\s+/g, "")
    const others = (list) => (all ? (list || []).filter((n) => !mine(n) && n !== current.from) : [])
    startCompose({
      to: [current.from, ...others(current.to)].join(", "),
      cc: others(current.cc).join(", "),
      subject: /^re:/i.test(current.subject) ? current.subject : `Re: ${current.subject}`.slice(0, 120),
      body: quoted(current),
    })
  }

  const forward = () => {
    if (!current || folder === "outbox") return
    startCompose({
      subject: /^fw:/i.test(current.subject) ? current.subject : `Fw: ${current.subject}`.slice(0, 120),
      body: quoted(current),
      attachments: (current.attachments || []).map((a) => ({ ...a })),
    })
  }

  const openDraft = () => {
    if (!current) return
    if (folder === "drafts") {
      startCompose({ to: current.draftTo || "", cc: current.draftCc || "", subject: current.subject, body: current.body, attachments: current.attachments || [], draftId: current.id })
    } else if (folder === "outbox") {
      startCompose({ ...current.draft })
      setOutbox((o) => o.filter((m) => m.id !== current.id))
      setCurrent(null)
    }
  }

  const composeSize = (d) => byteSize(d.subject) + byteSize(d.body) + d.attachments.reduce((n, a) => n + a.size, 0)

  const send = async () => {
    const draft = compose
    if (composeSize(draft) > MAX_MESSAGE_BYTES) return setDialog({ kind: "error", text: `This message is too big to send. Messages can be at most ${formatSize(MAX_MESSAGE_BYTES)} with attachments.` })
    const id = `out${Date.now()}`
    const toList = draft.to.split(/[,;]/).map((n) => n.trim()).filter(Boolean)
    setOutbox((o) => [...o, { id, from: me.screenName, to: toList, cc: [], subject: draft.subject, body: draft.body, time: Date.now(), read: true, attachments: draft.attachments, sending: true, draft }])
    setCompose(null)
    setStatusText("Sending 1 message...")
    const r = await api.send({ to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body, attachments: draft.attachments.map(({ name, type, content }) => ({ name, type, content })), draftId: draft.draftId })
    if (!r.ok) {
      setOutbox((o) => o.map((m) => (m.id === id ? { ...m, sending: false, error: r.error } : m)))
      setStatusText("A message couldn't be sent. It's waiting in the Outbox.")
      setDialog({ kind: "error", text: `${r.error}\n\nThe message is in your Outbox: open it to fix it and send it again.` })
      return
    }
    setOutbox((o) => o.filter((m) => m.id !== id))
    setStatusText("Message sent.")
    if (r.failed?.length) setDialog({ kind: "error", text: `Your message was sent, but couldn't be delivered to:\n${r.failed.map((f) => f.error).join("\n")}` })
    refresh()
    if (folder === "sent" || folder === "drafts") loadFolder(folder)
  }

  const saveDraft = async () => {
    const draft = compose
    const r = await api.saveDraft({ id: draft.draftId, to: draft.to, cc: draft.cc, subject: draft.subject, body: draft.body, attachments: draft.attachments.map(({ name, type, content }) => ({ name, type, content })) })
    if (!r.ok) return setDialog({ kind: "error", text: r.error })
    setCompose({ ...draft, draftId: r.message.id })
    setStatusText("Message saved in the Drafts folder.")
    refreshCounts()
    if (folder === "drafts") loadFolder("drafts")
  }

  const attach = (file) => {
    setDialog(null)
    const attachment = { name: file.name, type: file.type, content: file.textContent, size: byteSize(file.textContent) }
    if (composeSize(compose) + attachment.size > MAX_MESSAGE_BYTES) {
      return setDialog({ kind: "error", text: `"${file.name}" is too big to attach. A message and its attachments can be at most ${formatSize(MAX_MESSAGE_BYTES)}.` })
    }
    if (compose.attachments.length >= 5) return setDialog({ kind: "error", text: "A message can have at most 5 attachments." })
    setCompose((c) => ({ ...c, attachments: [...c.attachments, attachment] }))
  }

  const onAttachment = (attachment, action) => {
    try {
      const file = saveAttachment(attachment)
      if (action === "open") {
        if (!openItem(file, dispatch)) setDialog({ kind: "error", text: `Saved "${file.name}" in ${ATTACHMENTS_FOLDER}, but 98ish doesn't know how to open it.` })
      } else setDialog({ kind: "saved", text: `"${attachment.name}" was saved as "${file.name}" in ${ATTACHMENTS_FOLDER}.` })
    } catch (error) {
      setDialog({ kind: "error", text: error.message })
    }
  }

  // ---- signed off ----

  if (!online) {
    const openMessenger = () => dispatch({ type: "open_window", payload: launch("98 Messenger") })
    return (
      <div className="mlRoot">
        <div className="mlSignIn">
          <img src="/assets/program_icons/mail.svg" alt="" width="48" height="48" />
          <h2>Welcome to 98ish Mail</h2>
          <p>Your 98 Messenger screen name is your mail address. Sign on to 98 Messenger to read and send mail.</p>
          <button type="button" onClick={openMessenger} disabled={status === "signingOn"}>
            {status === "signingOn" ? "Signing on..." : "Sign On to 98 Messenger..."}
          </button>
        </div>
      </div>
    )
  }

  const isSentLike = folder === "sent" || folder === "drafts" || folder === "outbox"
  const menus = [
    {
      label: "File",
      items: [
        { label: "New Message", onClick: () => startCompose() },
        "-",
        { label: "Empty Deleted Items", onClick: emptyDeleted, disabled: !counts?.deleted.total },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: folder === "deleted" ? "Delete for Good" : "Delete", onClick: () => remove(), disabled: !selected },
        { label: "Restore", onClick: restore, disabled: !selected || folder !== "deleted" },
        "-",
        { label: "Mark as Read", onClick: () => setRead(true), disabled: !selected || folder === "outbox" },
        { label: "Mark as Unread", onClick: () => setRead(false), disabled: !selected || folder === "outbox" },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Sort by Received", checked: sort.by === "time", onClick: () => setSort({ by: "time", dir: -1 }) },
        { label: isSentLike ? "Sort by To" : "Sort by From", checked: sort.by === "from", onClick: () => setSort({ by: "from", dir: 1 }) },
        { label: "Sort by Subject", checked: sort.by === "subject", onClick: () => setSort({ by: "subject", dir: 1 }) },
        "-",
        { label: "Refresh", onClick: refresh },
      ],
    },
    {
      label: "Message",
      items: [
        { label: "New Message", onClick: () => startCompose() },
        { label: "Reply to Sender", onClick: () => reply(false), disabled: !current || folder === "outbox" },
        { label: "Reply to All", onClick: () => reply(true), disabled: !current || folder === "outbox" },
        { label: "Forward", onClick: forward, disabled: !current || folder === "outbox" },
      ],
    },
    { label: "Help", items: [{ label: "About 98ish Mail", onClick: () => setDialog({ kind: "about" }) }] },
  ]

  const headerFor = (by, label) => (
    <button type="button" className="mlColHead" onClick={() => sortBy(by)}>
      {label}
      {sort.by === by && <span className="mlSortArrow">{sort.dir > 0 ? "▲" : "▼"}</span>}
    </button>
  )

  const showList = !mobile || mobileView === "list"
  const showPreview = !mobile || mobileView === "message"

  return (
    <div className={`mlRoot${mobile ? " is-mobile" : ""}`}>
      <MenuBar menus={menus} />
      <div className="mlToolbar">
        <ToolButton label="New Mail" icon="new" onClick={() => startCompose()} />
        <ToolButton label="Reply" icon="reply" onClick={() => reply(false)} disabled={!current || folder === "outbox"} />
        <ToolButton label="Reply All" icon="replyall" onClick={() => reply(true)} disabled={!current || folder === "outbox"} />
        <ToolButton label="Forward" icon="forward" onClick={forward} disabled={!current || folder === "outbox"} />
        <ToolButton label="Delete" icon="delete" onClick={() => remove()} disabled={!selected} />
        {folder === "deleted" && <ToolButton label="Restore" icon="restore" onClick={restore} disabled={!selected} />}
        {(folder === "drafts" || folder === "outbox") && <ToolButton label="Open" icon="open" onClick={openDraft} disabled={!current} />}
        <ToolButton label="Send/Recv" icon="sendrecv" onClick={refresh} />
      </div>
      <div className="mlMain">
        {!mobile ? (
          <nav className="mlFolders" aria-label="Folders">
            <div className="mlFoldersHead">Folders</div>
            <ul>
              {FOLDERS.map((f) => {
                const n = f.id === "outbox" ? outbox.length : f.id === "inbox" ? counts?.inbox.unread : f.id === "drafts" ? counts?.drafts.total : 0
                return (
                  <li key={f.id}>
                    <button type="button" className={folder === f.id ? "is-active" : undefined} onClick={() => setFolder(f.id)} data-folder={f.id}>
                      <FolderIcon id={f.id} />
                      <span className={n ? "mlFolderName is-bold" : "mlFolderName"}>{f.label}</span>
                      {n > 0 && <span className="mlFolderCount">({n})</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
          </nav>
        ) : (
          showList && (
            <div className="mlFolderPick">
              <select aria-label="Folder" value={folder} onChange={(e) => setFolder(e.target.value)}>
                {FOLDERS.map((f) => {
                  const n = f.id === "outbox" ? outbox.length : f.id === "inbox" ? counts?.inbox.unread : 0
                  return (
                    <option key={f.id} value={f.id}>
                      {f.label}
                      {n ? ` (${n})` : ""}
                    </option>
                  )
                })}
              </select>
            </div>
          )
        )}
        <div className="mlRight">
          {showList && (
            <div className="mlList" role="table" aria-label={folderLabel(folder)}>
              <div className="mlRow mlRow--head" role="row">
                <span className="mlClip" aria-label="Attachment">
                  @
                </span>
                {headerFor("from", isSentLike ? "To" : "From")}
                {headerFor("subject", "Subject")}
                {headerFor("time", folder === "inbox" || folder === "deleted" ? "Received" : "Date")}
              </div>
              <div className="mlRows">
                {messages.length === 0 && <div className="mlNone">There are no items in this view.</div>}
                {messages.map((m) => (
                  <div
                    key={m.id}
                    role="row"
                    tabIndex={0}
                    className={`mlRow${m.read ? "" : " is-unread"}${selected === m.id ? " is-selected" : ""}${m.error ? " is-failed" : ""}`}
                    onClick={() => select(m)}
                    onDoubleClick={() => (folder === "drafts" || folder === "outbox") && openDraft()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") select(m)
                      if (e.key === "Delete") remove()
                    }}
                  >
                    <span className="mlClip">{m.attachments?.length ? <span className="mlClipIcon" aria-label="Has attachments" /> : ""}</span>
                    <span className="mlCell mlCell--from">{isSentLike ? names(m.to) || m.draftTo || "(nobody yet)" : m.from}</span>
                    <span className="mlCell mlCell--subject">
                      {m.sending ? "[Sending] " : m.error ? "[Not sent] " : ""}
                      {m.subject || "(no subject)"}
                    </span>
                    <span className="mlCell mlCell--time">{when(m.time)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {showPreview && <Preview message={current} loading={loadingMessage} onAttachment={onAttachment} mobile={mobile} onBack={() => setMobileView("list")} />}
        </div>
      </div>
      <div className="status-bar mlStatus">
        <p className="status-bar-field">
          {messages.length} message{messages.length === 1 ? "" : "s"}
          {folder === "inbox" && counts ? `, ${counts.inbox.unread} unread` : ""}
        </p>
        <p className="status-bar-field">{statusText || `Signed on as ${me.screenName}`}</p>
        {usage && !mobile && (
          <p className="status-bar-field">
            {formatSize(usage.used)} of {formatSize(usage.cap)} used
          </p>
        )}
      </div>

      {compose && (
        <Compose
          draft={compose}
          buddies={buddies}
          onChange={(patch) => setCompose((c) => ({ ...c, ...patch }))}
          onSend={send}
          onSaveDraft={saveDraft}
          onCancel={() => setCompose(null)}
          onAttach={() => setDialog({ kind: "attach" })}
          onRemoveAttachment={(i) => setCompose((c) => ({ ...c, attachments: c.attachments.filter((_, j) => j !== i) }))}
        />
      )}

      {dialog?.kind === "attach" && (
        <FileDialog mode="open" accept={(item) => !item.isDirectory && ATTACHABLE.includes(item.type)} typeLabel="All Documents" fileType="document" onPick={attach} onCancel={() => setDialog(null)} />
      )}
      {dialog?.kind === "error" && (
        <Dialog title="98ish Mail" sound="chord" onOk={() => setDialog(null)}>
          <p className="dialogText mlDialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "saved" && (
        <Dialog title="Save Attachment" sound="ding" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "confirmDelete" && (
        <Dialog
          title="Confirm Delete"
          sound="chord"
          okLabel="Yes"
          cancelLabel="No"
          onOk={() => {
            setDialog(null)
            remove(true)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Are you sure you want to permanently delete this message?</p>
        </Dialog>
      )}
      {dialog?.kind === "about" && (
        <Dialog title="About 98ish Mail" onOk={() => setDialog(null)}>
          <p className="dialogText">
            98ish Mail
            <br />
            Mail between 98 Messenger screen names. Plain text, attachments up to 1 MB per message, 5 MB of mail each.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default Mail
