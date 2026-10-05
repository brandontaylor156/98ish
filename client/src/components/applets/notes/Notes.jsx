import React, { useEffect, useMemo, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import { useLongPress } from "../../../hooks/useLongPress"
import { keyOf, useAim } from "../aim/AimContext"
import { useCouple } from "../../../utils/couple"
import { helpItem } from "../../../utils/help"
import { openTarget } from "../../../utils/notifications"
import {
  createNote,
  emptyTrash,
  getNote,
  leaveNote,
  pin,
  purgeNote,
  restoreNote,
  setNoteColor,
  setSort,
  shareLabel,
  shareNote,
  syncNow,
  trashNote,
  unpin,
  unshareNote,
  useNotes,
} from "../../../utils/notes"
import { COLORS, COLOR_NAMES, PAPER, SORTS, daysLeft, liveItems, matches, noteTitle, progress } from "./notesCore"
import NoteEditor from "./NoteEditor"
import "./Notes.css"

// Notes: sticky notes (Start > Programs > Accessories > Notes). It opens to the list and a
// big "New note"; a note opens beside the list (on a phone, instead of it). Right-click or
// hold a note for its menu (open, pin to desktop, color, share, delete). View has the sort,
// shared notes, Us and the Recycle Bin (30 days). Data: utils/notes.js; rules: notesCore.js.
// handoff: { id, note } opens a note; { id, filter: "us" } shows the notes shared with your
// partner; { id, newShared: "Name" } starts a note shared with them.

const preview = (note) => {
  const items = liveItems(note)
  const body = (note.body?.v || "").trim()
  return { lines: body.split("\n").filter(Boolean).slice(0, 4), items: items.slice(0, 5), more: Math.max(0, items.length - 5) }
}

const Card = ({ note, share, me, pinned, selected, onOpen, onMenu, trash }) => {
  const longPress = useLongPress((x, y) => onMenu(note, x, y))
  const color = note.color?.v || "yellow"
  const p = preview(note)
  const prog = progress(note)
  const title = (note.title?.v || "").trim()
  return (
    <li>
      <button
        type="button"
        className={`ntCard${selected ? " is-selected" : ""}`}
        style={{ background: PAPER[color].paper, borderColor: PAPER[color].edge }}
        data-note={note.id}
        onClick={() => onOpen(note.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          onMenu(note, e.clientX, e.clientY)
        }}
        onKeyDown={(e) => {
          if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
            e.preventDefault()
            const r = e.currentTarget.getBoundingClientRect()
            onMenu(note, r.left + 20, r.top + 20)
          }
        }}
        {...longPress}
      >
        <span className="ntCardTitle">{title || noteTitle(note)}</span>
        <span className="ntCardText" data-selectable="mouse">
          {(title ? p.lines : p.lines.slice(1)).map((l, i) => (
            <span key={i} className="ntCardLine">
              {l}
            </span>
          ))}
          {p.items.map((i) => (
            <span key={i.id} className={`ntCardItem${i.done ? " is-done" : ""}`}>
              <span className="ntCardBox" aria-hidden="true">
                {i.done ? "✓" : ""}
              </span>
              {i.text}
            </span>
          ))}
          {p.more > 0 && <span className="ntCardLine ntCardMore">+{p.more} more</span>}
        </span>
        <span className="ntCardFoot">
          {share && <span className="ntBadge">{shareLabel(share, me)}</span>}
          {pinned && !trash && <span className="ntBadge ntBadge--pin">Pinned</span>}
          {prog.total > 0 && (
            <span className="ntCardProg">
              {prog.done}/{prog.total}
            </span>
          )}
          {trash && <span className="ntCardProg">{daysLeft(note)} days left</span>}
        </span>
      </button>
    </li>
  )
}

// Share with a buddy: their screen name (buddies suggested), the people in it, stop sharing
const ShareDialog = ({ note, share, me, buddies, onClose }) => {
  const [to, setTo] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const owner = !share || share.owner === me
  const add = async () => {
    if (!to.trim() || busy) return
    setBusy(true)
    setError(null)
    const result = await shareNote(note.id, to.trim())
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setTo("")
  }
  return (
    <Dialog title={`Share "${noteTitle(note)}"`} okLabel="Done" onOk={onClose} onCancel={onClose}>
      <div className="ntShare">
        <p className="dialogText">Share this note with a 98 Messenger buddy. You both see it and can change it, and changes show up for both of you right away.</p>
        <div className="ntShareRow">
          <label htmlFor="ntShareTo">Screen name:</label>
          <input
            id="ntShareTo"
            type="text"
            list="ntShareBuddies"
            value={to}
            autoComplete="off"
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                add()
              }
            }}
          />
          <datalist id="ntShareBuddies">
            {buddies.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
          <button type="button" disabled={!to.trim() || busy} onClick={add}>
            {busy ? "Sharing..." : "Share"}
          </button>
        </div>
        {error && (
          <p className="ntError" role="alert">
            {error}
          </p>
        )}
        {share && (
          <>
            <p className="dialogText">People in this note:</p>
            <ul className="ntPeople">
              {share.members.map((m) => (
                <li key={m.key}>
                  <span>
                    {m.key === me ? `${m.name} (you)` : m.name}
                    {m.key === share.owner ? " · shared it" : ""}
                  </span>
                  {owner && m.key !== me && (
                    <button type="button" onClick={async () => setError((await unshareNote(note.id, m.key)).error || null)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="ntShareRow">
              {owner ? (
                <button type="button" onClick={async () => setError((await unshareNote(note.id)).error || null)}>
                  Stop sharing
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    leaveNote(note.id)
                    onClose()
                  }}
                >
                  Leave (keep my own copy)
                </button>
              )}
            </div>
            <p className="ntHint">People taken out of a note keep their own copy of it.</p>
          </>
        )}
      </div>
    </Dialog>
  )
}

const Notes = ({ mobile, handoff, onTitle }) => {
  const state = useNotes()
  const aim = useAim()
  const couple = useCouple()
  const online = aim?.status === "online"
  const me = state.account || (online ? keyOf(aim.me?.screenName) : null)
  const [openId, setOpenId] = useState(null)
  const [fresh, setFresh] = useState(null) // a note just made: its title gets the focus
  const [query, setQuery] = useState("")
  const [view, setView] = useState("notes") // notes | shared | us | trash
  const [menu, setMenu] = useState(null)
  const [dialog, setDialog] = useState(null)

  const partner = couple.status === "paired" ? couple.partner : null
  const partnerKey = partner ? keyOf(partner) : null

  // a note to open, Us, or a new shared note (from search, notifications, Us)
  useEffect(() => {
    if (!handoff?.id) return
    if (handoff.note && getNote(handoff.note)) {
      setView(state.trash.some((n) => n.id === handoff.note) ? "trash" : "notes")
      setOpenId(handoff.note)
    }
    if (handoff.filter === "us") setView("us")
    if (handoff.newShared) {
      const id = createNote({ color: "pink" })
      setOpenId(id)
      setFresh(id)
      shareNote(id, handoff.newShared).then((r) => !r.ok && setDialog({ kind: "alert", text: r.error }))
    }
  }, [handoff?.id])

  const open = state.notes.find((n) => n.id === openId) || state.trash.find((n) => n.id === openId) || null
  useEffect(() => {
    onTitle?.(open ? `${noteTitle(open)} - Notes` : "Notes")
  }, [open && noteTitle(open)])

  const list = useMemo(() => {
    let base = view === "trash" ? state.trash : state.notes
    if (view === "shared") base = base.filter((n) => state.share[n.id])
    if (view === "us") base = base.filter((n) => state.share[n.id]?.members.some((m) => m.key === partnerKey))
    return base.filter((n) => matches(n, query))
  }, [state.version, view, query, partnerKey])

  const newNote = (patch = {}) => {
    if (view === "trash") setView("notes")
    const id = createNote(patch)
    setOpenId(id)
    setFresh(id)
    setQuery("")
    if (view === "us" && partner) shareNote(id, partner).then((r) => !r.ok && setDialog({ kind: "alert", text: r.error }))
  }

  const buddies = useMemo(() => (aim?.me?.groups || []).flatMap((g) => g.buddies).filter((b, i, all) => all.indexOf(b) === i), [aim?.me?.groups])

  const act = (action, note) => {
    switch (action) {
      case "open":
        return setOpenId(note.id)
      case "pin":
        return pin(note.id)
      case "unpin":
        return unpin(note.id)
      case "share":
        if (!online) return setDialog({ kind: "signon" })
        return setDialog({ kind: "share", id: note.id })
      case "delete":
        if (state.share[note.id]) return setDialog({ kind: "leave", id: note.id })
        trashNote(note.id)
        if (openId === note.id) setOpenId(null)
        return
      case "restore":
        restoreNote(note.id)
        return setView("notes")
      case "purge":
        return setDialog({ kind: "purge", id: note.id })
      default:
        if (action.startsWith("color:")) setNoteColor(note.id, action.slice(6))
    }
  }

  const menuFor = (note) => {
    const trashed = view === "trash"
    if (trashed)
      return [
        { label: "Restore", bold: true, onClick: () => act("restore", note) },
        { label: "Delete Now", onClick: () => act("purge", note) },
      ]
    const pinned = state.pinned.has(note.id)
    return [
      { label: "Open", bold: true, onClick: () => act("open", note) },
      { label: pinned ? "Unpin from Desktop" : "Pin to Desktop", onClick: () => act(pinned ? "unpin" : "pin", note) },
      { label: "Color", items: COLORS.map((c) => ({ label: COLOR_NAMES[c], checked: note.color?.v === c, onClick: () => act(`color:${c}`, note) })) },
      { label: state.share[note.id] ? "Sharing..." : "Share...", onClick: () => act("share", note) },
      "-",
      { label: state.share[note.id] ? "Leave and Delete..." : "Delete", onClick: () => act("delete", note) },
    ]
  }

  const sortItems = Object.entries(SORTS).map(([id, label]) => ({ label, checked: state.sort === id, onClick: () => setSort(id) }))
  const viewItems = [
    { label: "All Notes", checked: view === "notes", onClick: () => setView("notes") },
    { label: "Shared Notes", checked: view === "shared", onClick: () => setView("shared") },
    ...(partner ? [{ label: `Us (with ${partner})`, checked: view === "us", onClick: () => setView("us") }] : []),
    { label: `Recycle Bin (${state.trash.length})`, checked: view === "trash", onClick: () => setView("trash") },
  ]
  const menus = [
    {
      label: "File",
      items: [
        { label: "New Note Ctrl+N", onClick: () => newNote() },
        { label: "New Checklist", onClick: () => newNote({ items: [""] }) },
        "-",
        { label: "Share...", disabled: !open || view === "trash", onClick: () => open && act("share", open) },
        { label: open && state.pinned.has(open.id) ? "Unpin from Desktop" : "Pin to Desktop", disabled: !open || view === "trash", onClick: () => open && act(state.pinned.has(open.id) ? "unpin" : "pin", open) },
        { label: "Delete Del", disabled: !open || view === "trash", onClick: () => open && act("delete", open) },
        "-",
        { label: "Empty Recycle Bin", disabled: !state.trash.length, onClick: () => setDialog({ kind: "empty" }) },
      ],
    },
    { label: "View", items: [...viewItems, "-", { label: "Sort By", items: sortItems }, "-", { label: "Sync Now", disabled: !state.signedOn, onClick: () => syncNow() }] },
    { label: "Help", items: [helpItem({ program: "Notes" }), { label: "About Notes", onClick: () => setDialog({ kind: "about" }) }] },
  ]

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault()
        newNote()
      }
    }
    const root = document.querySelector(".ntRoot")?.closest("[data-window-index]")
    root?.addEventListener("keydown", onKey)
    return () => root?.removeEventListener("keydown", onKey)
  })

  const status = !state.account && !state.signedOn ? "Only on this device" : state.signedOn ? { syncing: "Syncing...", synced: "Synced", error: state.error || "Not synced", local: "" }[state.sync] : "Syncs when you sign on"
  const heading = { notes: null, shared: "Shared notes", us: partner ? `Us: notes with ${partner}` : "Us", trash: "Recycle Bin" }[view]

  const listPane = (
    <div className="ntListPane">
      <div className="ntTop">
        <button type="button" className="ntNew" onClick={() => newNote()}>
          <span aria-hidden="true">+</span> New note
        </button>
        <input type="search" className="ntSearch" placeholder="Search notes" aria-label="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} />
        {mobile && (
          <button
            type="button"
            className="ntMoreBtn"
            aria-label="More"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: r.right, y: r.bottom, items: [...viewItems, "-", { label: "Sort By", items: sortItems }, { label: "New Checklist", onClick: () => newNote({ items: [""] }) }, ...(state.trash.length ? [{ label: "Empty Recycle Bin", onClick: () => setDialog({ kind: "empty" }) }] : []), { label: "Sync Now", disabled: !state.signedOn, onClick: () => syncNow() }, helpItem({ program: "Notes" }, { f1: false })] })
            }}
          >
            More...
          </button>
        )}
      </div>
      {heading && (
        <div className="ntHeading">
          <span>{heading}</span>
          <button type="button" className="ntLink" onClick={() => setView("notes")}>
            Show all
          </button>
        </div>
      )}
      {!state.account && !state.signedOn && view !== "trash" && (
        <div className="ntKeepSafe" role="note">
          <b>Only on this device.</b> Sign on to 98 Messenger to keep your notes safe online, see them on your other devices and share them.{" "}
          <button type="button" className="ntLink" onClick={() => openTarget({ kind: "program", name: "98 Messenger" })}>
            Sign On
          </button>
        </div>
      )}
      {state.full && (
        <p className="ntError" role="alert">
          This device's storage is full: new changes last until 98ish closes. Delete some long notes or other things in Control Panel &gt; Storage.
        </p>
      )}
      {list.length ? (
        <ul className="ntCards" aria-label={heading || "Notes"}>
          {list.map((n) => (
            <Card key={n.id} note={n} share={state.share[n.id]} me={me} pinned={state.pinned.has(n.id)} selected={n.id === openId} trash={view === "trash"} onOpen={setOpenId} onMenu={(note, x, y) => setMenu({ x, y, items: menuFor(note) })} />
          ))}
        </ul>
      ) : (
        <div className="ntEmpty">
          {query ? (
            <p>No notes match "{query}".</p>
          ) : view === "trash" ? (
            <p>The Recycle Bin is empty. Deleted notes wait here for 30 days.</p>
          ) : view === "us" || view === "shared" ? (
            <p>No shared notes yet. Open a note and choose Share... to make a list together (groceries, date ideas).</p>
          ) : (
            <>
              <img src="/assets/program_icons/notes.svg" alt="" width="48" height="48" />
              <p>No notes yet. Choose New note to write one.</p>
            </>
          )}
        </div>
      )}
      {view === "trash" && state.trash.length > 0 && (
        <button type="button" className="ntEmptyTrash" onClick={() => setDialog({ kind: "empty" })}>
          Empty Recycle Bin
        </button>
      )}
    </div>
  )

  const editor = open ? (
    <NoteEditor key={open.id} note={open} mobile={mobile} autoFocus={fresh === open.id} onBack={() => setOpenId(null)} onAction={act} />
  ) : (
    <div className="ntNoNote">
      <p>Pick a note, or choose New note.</p>
    </div>
  )

  const dialogNote = dialog?.id ? getNote(dialog.id) : null
  return (
    <div className={`ntRoot${mobile ? " is-phone" : ""}`}>
      {!mobile && <MenuBar menus={menus} />}
      {mobile ? (open ? editor : listPane) : (
        <div className="ntMain">
          {listPane}
          {editor}
        </div>
      )}
      {!mobile && (
        <div className="status-bar ntStatus">
          <p className="status-bar-field">
            {list.length} note{list.length === 1 ? "" : "s"}
          </p>
          {status && <p className="status-bar-field">{status}</p>}
        </div>
      )}
      {menu && <ContextMenu items={menu.items} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {dialog?.kind === "share" && dialogNote && <ShareDialog note={dialogNote} share={state.share[dialogNote.id]} me={me} buddies={buddies} onClose={() => setDialog(null)} />}
      {dialog?.kind === "leave" && dialogNote && (
        <Dialog
          title="Leave Shared Note"
          okLabel="Leave"
          onOk={() => {
            leaveNote(dialog.id, { trash: true })
            if (openId === dialog.id) setOpenId(null)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">
            "{noteTitle(dialogNote)}" is shared. Deleting it takes you out of it: the others keep it. Your own copy goes to the Recycle Bin for 30 days.
          </p>
        </Dialog>
      )}
      {dialog?.kind === "purge" && dialogNote && (
        <Dialog
          title="Delete Note"
          okLabel="Delete"
          sound="ding"
          onOk={() => {
            purgeNote(dialog.id)
            if (openId === dialog.id) setOpenId(null)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Delete "{noteTitle(dialogNote)}" for good? It can't be brought back.</p>
        </Dialog>
      )}
      {dialog?.kind === "empty" && (
        <Dialog
          title="Empty Recycle Bin"
          okLabel="Delete All"
          sound="ding"
          onOk={() => {
            emptyTrash()
            setOpenId(null)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">
            Delete all {state.trash.length} note{state.trash.length === 1 ? "" : "s"} in the Recycle Bin for good?
          </p>
        </Dialog>
      )}
      {dialog?.kind === "signon" && (
        <Dialog
          title="Share a Note"
          okLabel="Sign On"
          onOk={() => {
            setDialog(null)
            openTarget({ kind: "program", name: "98 Messenger" })
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Sign on to 98 Messenger to share notes with your buddies.</p>
        </Dialog>
      )}
      {dialog?.kind === "alert" && (
        <Dialog title="Notes" onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "about" && (
        <Dialog title="About Notes" onOk={() => setDialog(null)}>
          <p className="dialogText">98ish Notes: sticky notes with checklists. Pin them to the desktop, share them with a buddy, and find them from the Start menu's search box.</p>
        </Dialog>
      )}
    </div>
  )
}

export default Notes
