import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import ContextMenu from "../../shared/ContextMenu"
import FileDialog from "../notepad/FileDialog"
import { BOT_NAME, BUDDY_LIST, keyOf, useAim } from "../aim/AimContext"
import { placeCall } from "../aim/call/CallButtons"
import { useLongPress } from "../../../hooks/useLongPress"
import { addGroup, deleteContact, importContacts, saveContact, syncNow, toggleFavorite, useContacts } from "../../../utils/contacts"
import { displayName, mailAddressOf, matchesContact, normalizeContact, screenKey } from "../../../utils/contactsCore"
import { fs, uniqueName, writeAndSave } from "../../../utils/fs"
import { launch } from "../../../utils/programs"
import { VIEW_EVENT } from "../../../utils/couple"
import { currentUserName } from "../../../utils/users"
import { invite as inviteToCalendar, useCalendar } from "../calendar/store"
import { parseVCards, toVCards } from "./vcard"
import { contactPickerSupported, isIos, pickPhoneContacts, readFile, shrinkPicture } from "./picture"
import ContactEditor from "./ContactEditor"
import { Avatar, ContactCard, StatusDot, presenceOf } from "./ContactCard"
import Panel from "./Panel"
import "./AddressBook.css"

// The Address Book, after Windows 98's: everyone you know, with their 98 Messenger screen
// name (and whether they're on), 98ish Mail address, phones, birthday and anniversary (they
// go on Calendar's Birthdays calendar), address, notes, picture, groups and favorites.
// Your Buddy List's buddies show up too, ready to add. Contacts stay on this device and, while
// signed on to 98 Messenger, sync with your account (utils/contacts.js). vCard (.vcf) files
// come in and go out, and on Android the phone's own contacts can be picked.

const EMPTY = normalizeContact({ id: "buddy000" })
const buddyRow = (screenName) => ({ ...EMPTY, id: `buddy-${keyOf(screenName)}`, screenName, buddy: true })

const download = (name, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/vcard" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
const fileNameFor = (c) => (displayName(c).replace(/[\\/:"<>|*?]+/g, "").trim().slice(0, 40) || "Contact") + ".vcf"

const Row = ({ c, selected, presence, mobile, onSelect, onOpen, onMenu }) => {
  const longPress = useLongPress((x, y) => onMenu(c, x, y))
  return (
    <li
      role="option"
      aria-selected={selected}
      data-id={c.id}
      className={`abRow${selected ? " is-selected" : ""}${c.buddy ? " is-buddy" : ""}`}
      onClick={() => onSelect(c)}
      onDoubleClick={() => !mobile && onOpen(c)}
      onContextMenu={(e) => {
        e.preventDefault()
        onSelect(c)
        onMenu(c, e.clientX, e.clientY)
      }}
      {...longPress}
    >
      <span className="abCell abCellName">
        <Avatar contact={c} size={mobile ? 36 : 18} />
        <span className="abRowText">
          <span className="abRowName">
            {displayName(c)}
            {c.favorite && <span className="abStar">{"\u2605\uFE0E"}</span>}
            {c.buddy && <span className="abTag">Buddy</span>}
          </span>
          {mobile && <span className="abRowSub">{[c.screenName, c.phones[0]?.value].filter(Boolean).join(" · ")}</span>}
        </span>
        <StatusDot presence={presence} />
      </span>
      {!mobile && (
        <>
          <span className="abCell">{c.screenName}</span>
          <span className="abCell">{c.phones[0]?.value || ""}</span>
          <span className="abCell">{c.emails[0]?.value || (c.mail && c.mail !== c.screenName ? c.mail : "")}</span>
        </>
      )}
    </li>
  )
}

const AddressBook = ({ mobile, dispatch, handoff, onTitle, onClose }) => {
  const book = useContacts()
  const aim = useAim()
  const cal = useCalendar()
  const online = aim?.status === "online"
  const [folder, setFolder] = useState("all")
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState(null)
  const [editor, setEditor] = useState(null) // { initial, isNew }
  const [dialog, setDialog] = useState(null)
  const [menu, setMenu] = useState(null) // { contact, x, y }
  const [mobileView, setMobileView] = useState("list") // list | card
  const [busy, setBusy] = useState(false)
  const fileInput = useRef(null)
  const findRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => onTitle?.(`Address Book - ${currentUserName()}`), [])

  // ---- what's listed ----
  const buddyNames = useMemo(() => {
    if (!online || !aim.me) return []
    const seen = new Map()
    for (const g of aim.me.groups) for (const b of g.buddies) if (keyOf(b) !== keyOf(BOT_NAME)) seen.set(keyOf(b), aim.presence[keyOf(b)]?.screenName || b)
    return [...seen.values()]
  }, [online, aim?.me, aim?.presence])

  const folders = useMemo(
    () => [
      { id: "all", label: "All Contacts" },
      { id: "favorites", label: "Favorites" },
      ...book.groups.map((g) => ({ id: `group:${g}`, label: g, group: g })),
      ...(online ? [{ id: "buddies", label: "98 Messenger Buddies" }] : []),
    ],
    [book.groups, online]
  )
  const folderOk = folders.some((f) => f.id === folder) ? folder : "all"

  const rows = useMemo(() => {
    const linked = new Map(book.contacts.filter((c) => c.screenName).map((c) => [screenKey(c.screenName), c]))
    const loose = buddyNames.filter((b) => !linked.has(keyOf(b))).map(buddyRow)
    let list
    if (folderOk === "favorites") list = book.contacts.filter((c) => c.favorite)
    else if (folderOk.startsWith("group:")) list = book.contacts.filter((c) => c.groups.includes(folderOk.slice(6)))
    else if (folderOk === "buddies") list = buddyNames.map((b) => linked.get(keyOf(b)) || buddyRow(b)).sort((a, b) => displayName(a).localeCompare(displayName(b)))
    else list = [...book.contacts, ...loose]
    return query.trim() ? list.filter((c) => matchesContact(c, query)) : list
  }, [book.contacts, buddyNames, folderOk, query])

  const selected = rows.find((c) => c.id === selectedId) || book.contacts.find((c) => c.id === selectedId) || null
  const counts = useMemo(() => {
    const n = { all: book.contacts.length, favorites: book.contacts.filter((c) => c.favorite).length, buddies: buddyNames.length }
    for (const g of book.groups) n[`group:${g}`] = book.contacts.filter((c) => c.groups.includes(g)).length
    return n
  }, [book.contacts, book.groups, buddyNames])

  // ---- asked from outside (a calendar birthday, search, a .vcf file, the Buddy List) ----
  const handle = (h) => {
    if (!h) return
    if (h.contactId) {
      setFolder("all")
      setQuery("")
      setSelectedId(h.contactId)
      if (mobile) setMobileView("card")
      setTimeout(() => listRef.current?.querySelector(`[data-id="${h.contactId}"]`)?.scrollIntoView({ block: "nearest" }), 50)
    }
    if (h.importFile) importText(h.importFile.textContent || "", h.importFile.name)
    if (h.find) setTimeout(() => findRef.current?.focus(), 80)
    if (h.newContact) setEditor({ initial: normalizeContact(h.newContact), isNew: true })
  }
  const handleRef = useRef(handle)
  handleRef.current = handle
  useEffect(() => handleRef.current(handoff), [handoff?.id])
  useEffect(() => {
    const onView = (e) => e.detail?.program === "Address Book" && handleRef.current(e.detail.handoff)
    window.addEventListener(VIEW_EVENT, onView)
    return () => window.removeEventListener(VIEW_EVENT, onView)
  }, [])

  // ---- acting on contacts ----
  const alert = (title, text) => setDialog({ kind: "alert", title, text })
  const select = (c) => {
    setSelectedId(c.id)
    if (mobile) setMobileView("card")
  }
  const newContact = (patch = {}) => {
    const group = folderOk.startsWith("group:") ? folderOk.slice(6) : null
    setEditor({ initial: normalizeContact({ groups: group ? [group] : [], favorite: folderOk === "favorites", ...patch }), isNew: true })
  }
  const edit = (c) => (c.buddy ? newContact({ screenName: c.screenName }) : setEditor({ initial: c, isNew: false }))
  const save = (draft) => {
    const result = saveContact(draft)
    setEditor(null)
    setSelectedId(result.contact.id)
    if (mobile) setMobileView("card")
    if (!result.ok) alert("Address Book", result.error)
  }
  const needSignOn = (what) =>
    setDialog({ kind: "signOn", text: `Sign on to 98 Messenger to ${what}.` })
  const im = (c) => (online ? aim.openIm(c.screenName) : needSignOn(`send ${c.screenName} an Instant Message`))
  const call = (c, video) => (online ? placeCall(c.screenName, video, (text) => alert("Call", text)) : needSignOn(`call ${c.screenName}`))
  const mail = (c) => dispatch({ type: "open_window", payload: launch("98ish Mail", { handoff: { id: Date.now(), compose: { to: mailAddressOf(c) } } }) })
  const remove = (c) => setDialog({ kind: "delete", contact: c })
  const actionsFor = (c) =>
    c.buddy
      ? { add: () => newContact({ screenName: c.screenName }), im: () => im(c), call: () => call(c, false), video: () => call(c, true), mail: () => mail(c) }
      : { im: () => im(c), call: () => call(c, false), video: () => call(c, true), mail: () => mail(c), invite: () => setDialog({ kind: "invite", contact: c, calendarId: "" }), favorite: () => toggleFavorite(c.id), edit: () => edit(c), remove: () => remove(c) }

  // ---- vCards in and out ----
  const importText = (text, from = "that file") => {
    const cards = parseVCards(text)
    if (!cards.length) return alert("Import", `There are no contacts in ${from}. Pick a vCard (.vcf) file.`)
    setDialog({ kind: "importConfirm", cards })
  }
  const finishImport = async (cards) => {
    setDialog(null)
    setBusy(true)
    // pictures from phones are big: make them contact-sized first
    const ready = []
    for (const c of cards) ready.push(c.picture && c.picture.length > 60_000 ? { ...c, picture: await shrinkPicture(c.picture) } : c)
    const r = importContacts(ready)
    setBusy(false)
    alert("Import", `${r.added} new contact${r.added === 1 ? "" : "s"} added${r.updated ? `, ${r.updated} updated` : ""}${r.skipped ? `, ${r.skipped} already here` : ""}.`)
  }
  const fromPhone = async () => {
    if (!contactPickerSupported()) return setDialog({ kind: "phoneHelp" })
    try {
      const cards = await pickPhoneContacts()
      if (cards.length) setDialog({ kind: "importConfirm", cards })
    } catch (error) {
      alert("Import from Phone", `Your phone didn't share its contacts${error?.message ? ` (${error.message})` : ""}. You can also import a vCard (.vcf) file.`)
    }
  }
  const exportList = (which) => (which === "selected" && selected && !selected.buddy ? [selected] : book.contacts)
  const exportDownload = (which) => {
    const list = exportList(which)
    if (!list.length) return alert("Export", "There's nobody to export yet.")
    download(list.length === 1 ? fileNameFor(list[0]) : "Address Book.vcf", toVCards(list))
  }
  const exportDrive = (which) => {
    const list = exportList(which)
    if (!list.length) return alert("Export", "There's nobody to export yet.")
    const dir = fs.resolve("C:/Documents") || fs.resolve("C:")
    try {
      const file = fs.createFileIn(dir, uniqueName(dir, list.length === 1 ? fileNameFor(list[0]) : "Address Book.vcf"), "vcard", "")
      if (!writeAndSave(file, toVCards(list), { created: true })) return alert("Export", "There isn't enough room on the drive. Try Export > Download instead.")
      alert("Export", `Saved ${list.length} contact${list.length === 1 ? "" : "s"} as ${fs.displayPath(file)}.`)
    } catch (error) {
      alert("Export", error.message)
    }
  }

  // ---- keys in the list ----
  const onListKey = (e) => {
    if (!rows.length) return
    const i = rows.findIndex((c) => c.id === selectedId)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]
      setSelectedId(next.id)
      listRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" })
    } else if (e.key === "Enter" && selected) {
      e.preventDefault()
      edit(selected)
    } else if (e.key === "Delete" && selected && !selected.buddy) {
      e.preventDefault()
      remove(selected)
    }
  }

  // ---- menus ----
  const sel = selected && !selected.buddy ? selected : null
  const menus = [
    {
      label: "File",
      items: [
        { label: "New Contact...", onClick: () => newContact() },
        { label: "New Group...", onClick: () => setDialog({ kind: "newGroup", name: "" }) },
        "-",
        { label: "Properties", onClick: () => selected && edit(selected), disabled: !selected },
        { label: "Delete", onClick: () => sel && remove(sel), disabled: !sel },
        "-",
        { label: "Import vCard from this Device...", onClick: () => fileInput.current?.click() },
        { label: "Import vCard from 98ish Drive...", onClick: () => setDialog({ kind: "openDrive" }) },
        { label: "Import from Phone Contacts...", onClick: fromPhone },
        "-",
        { label: "Export All (Download .vcf)", onClick: () => exportDownload("all") },
        { label: "Export All to C:\\Documents", onClick: () => exportDrive("all") },
        { label: "Export Selected (Download .vcf)", onClick: () => exportDownload("selected"), disabled: !sel },
        "-",
        { label: "Close", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Find People...", onClick: () => findRef.current?.focus() },
        { label: sel?.favorite ? "Remove from Favorites" : "Add to Favorites", onClick: () => sel && toggleFavorite(sel.id), disabled: !sel },
      ],
    },
    {
      label: "View",
      items: [...folders.map((f) => ({ label: f.label, checked: folderOk === f.id, onClick: () => setFolder(f.id) })), "-", { label: "Sync Now", onClick: () => syncNow(), disabled: !online }],
    },
    {
      label: "Tools",
      items: [
        { label: "Birthdays Calendar", onClick: () => dispatch({ type: "open_window", payload: launch("Calendar") }) },
        { label: "98 Messenger", onClick: () => dispatch({ type: "open_window", payload: launch(BUDDY_LIST) }) },
        { label: "98ish Mail", onClick: () => dispatch({ type: "open_window", payload: launch("98ish Mail") }) },
      ],
    },
    { label: "Help", items: [{ label: "About Address Book", onClick: () => setDialog({ kind: "about" }) }] },
  ]

  const contextItems = (c) => {
    const a = actionsFor(c)
    return [
      ...(c.buddy ? [{ label: "Add to Address Book...", bold: true, onClick: a.add }, "-"] : [{ label: "Properties", bold: true, onClick: a.edit }, "-"]),
      { label: "Send Instant Message", onClick: a.im, disabled: !c.screenName },
      { label: "Call", onClick: a.call, disabled: !c.screenName },
      { label: "Video Call", onClick: a.video, disabled: !c.screenName },
      { label: "Send Mail", onClick: a.mail, disabled: !mailAddressOf(c) },
      ...(c.buddy
        ? []
        : [
            { label: "Invite to Calendar...", onClick: a.invite, disabled: !c.screenName },
            "-",
            { label: c.favorite ? "Remove from Favorites" : "Add to Favorites", onClick: a.favorite },
            { label: "Export vCard...", onClick: () => download(fileNameFor(c), toVCards([c])) },
            { label: "Delete", onClick: a.remove },
          ]),
    ]
  }

  const syncText =
    book.sync === "syncing" ? "Syncing..." : book.sync === "error" ? book.error : book.sync === "synced" && online ? `Synced with ${aim.me.screenName}` : online ? "" : "Not signed on: kept on this device"

  // ---- the parts ----
  const list = (
    <div className="abListPane">
      {!mobile && (
        <div className="abListHead" aria-hidden="true">
          <span className="abCell abCellName">Name</span>
          <span className="abCell">Screen Name</span>
          <span className="abCell">Phone</span>
          <span className="abCell">E-Mail Address</span>
        </div>
      )}
      <ul className="abRows" role="listbox" aria-label="Contacts" tabIndex={0} ref={listRef} onKeyDown={onListKey}>
        {rows.map((c) => (
          <Row key={c.id} c={c} selected={c.id === selectedId} presence={presenceOf(aim, c.screenName)} mobile={mobile} onSelect={select} onOpen={edit} onMenu={(contact, x, y) => setMenu({ contact, x, y })} />
        ))}
        {!rows.length && (
          <li className="abEmpty">
            {query.trim() ? (
              <>Nobody matches "{query}".</>
            ) : folderOk === "all" ? (
              <>
                Your Address Book is empty. Click <b>New Contact</b>, or import a vCard (.vcf) file{online ? "" : ". Sign on to 98 Messenger to see your buddies here"}.
              </>
            ) : (
              "Nobody here yet."
            )}
          </li>
        )}
      </ul>
    </div>
  )

  const findBox = (
    <div className="abFind">
      <label htmlFor="ab-find">{mobile ? "" : "Type name or select from list:"}</label>
      <input id="ab-find" ref={findRef} type="search" value={query} placeholder={mobile ? "Search contacts" : ""} autoComplete="off" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => (e.key === "ArrowDown" ? (e.preventDefault(), listRef.current?.focus(), rows[0] && setSelectedId(rows[0].id)) : null)} />
    </div>
  )

  const card = selected ? (
    <ContactCard contact={selected} presence={presenceOf(aim, selected.screenName)} signedOn={online} actions={actionsFor(selected)} mobile={mobile} onBack={() => setMobileView("list")} />
  ) : (
    <div className="abCard abCardEmpty">
      <img src="/assets/program_icons/addressbook.svg" alt="" width="48" height="48" />
      <p>Select someone to see their card.</p>
    </div>
  )

  return (
    <div className={`abRoot${mobile ? " abPhone" : ""}`}>
      {!mobile && <MenuBar menus={menus} />}
      {!mobile && (
        <div className="abToolbar">
          <button type="button" onClick={() => newContact()}>
            New Contact
          </button>
          <button type="button" disabled={!selected} onClick={() => selected && edit(selected)}>
            Properties
          </button>
          <button type="button" disabled={!sel} onClick={() => sel && remove(sel)}>
            Delete
          </button>
          <span className="abToolSep" />
          <button type="button" disabled={!selected?.screenName} onClick={() => im(selected)}>
            Send IM
          </button>
          <button type="button" disabled={!selected || !mailAddressOf(selected)} onClick={() => mail(selected)}>
            Send Mail
          </button>
          <span className="abToolSep" />
          <button type="button" onClick={() => setDialog({ kind: "import" })}>
            Import
          </button>
          <button type="button" onClick={() => exportDownload(sel ? "selected" : "all")} title={sel ? "Export the selected contact" : "Export everyone"}>
            Export
          </button>
        </div>
      )}
      {mobile ? (
        mobileView === "card" && selected ? (
          <div className="abPhoneCard">{card}</div>
        ) : (
          <>
            <div className="abPhoneBar">
              <select aria-label="Show" value={folderOk} onChange={(e) => setFolder(e.target.value)}>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label} ({counts[f.id] ?? 0})
                  </option>
                ))}
              </select>
              <button type="button" className="abDefault" onClick={() => newContact()}>
                + New
              </button>
              <button type="button" aria-label="More" onClick={(e) => setMenu({ more: true, x: e.currentTarget.getBoundingClientRect().right, y: e.currentTarget.getBoundingClientRect().bottom })}>
                More...
              </button>
            </div>
            {findBox}
            {list}
          </>
        )
      ) : (
        <div className="abMain">
          <nav className="abFolders" aria-label="Folders">
            <ul>
              {folders.map((f) => (
                <li key={f.id}>
                  <button type="button" className={folderOk === f.id ? "is-selected" : ""} onClick={() => setFolder(f.id)}>
                    <span className={`abFolderIcon abFolderIcon--${f.id.split(":")[0]}`} aria-hidden="true" />
                    <span className="abFolderName">{f.label}</span>
                    <span className="abFolderCount">{counts[f.id] ?? 0}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="abCenter">
            {findBox}
            {list}
          </div>
          <aside className="abSide" aria-label="Contact">
            {card}
          </aside>
        </div>
      )}
      <div className="status-bar abStatus">
        <p className="status-bar-field">
          {busy ? "Importing..." : `${rows.length} item${rows.length === 1 ? "" : "s"}`}
        </p>
        {syncText && <p className="status-bar-field abSyncText">{syncText}</p>}
      </div>

      <input
        ref={fileInput}
        type="file"
        accept=".vcf,.vcard,text/vcard,text/x-vcard,text/directory"
        multiple
        hidden
        onChange={async (e) => {
          const files = [...(e.target.files || [])]
          e.target.value = ""
          if (!files.length) return
          try {
            const texts = await Promise.all(files.map((f) => readFile(f, "text")))
            importText(texts.join("\r\n"), files.length === 1 ? `"${files[0].name}"` : "those files")
          } catch {
            alert("Import", "That file couldn't be read.")
          }
        }}
      />

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={
            menu.more
              ? [
                  { label: "Import vCard from this Device...", onClick: () => fileInput.current?.click() },
                  { label: "Import vCard from 98ish Drive...", onClick: () => setDialog({ kind: "openDrive" }) },
                  { label: "Import from Phone Contacts...", onClick: fromPhone },
                  "-",
                  { label: "Export All (.vcf)", onClick: () => exportDownload("all") },
                  { label: "Export All to C:\\Documents", onClick: () => exportDrive("all") },
                  "-",
                  { label: "New Group...", onClick: () => setDialog({ kind: "newGroup", name: "" }) },
                  { label: "Sync Now", onClick: () => syncNow(), disabled: !online },
                  { label: "About Address Book", onClick: () => setDialog({ kind: "about" }) },
                ]
              : contextItems(menu.contact)
          }
        />
      )}

      {editor && (
        <ContactEditor initial={editor.initial} isNew={editor.isNew} groups={book.groups} buddies={buddyNames} mobile={mobile} onSave={save} onCancel={() => setEditor(null)} />
      )}

      {dialog?.kind === "alert" && (
        <Dialog title={dialog.title} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "signOn" && (
        <Dialog title="Address Book" okLabel="Sign On..." onOk={() => (setDialog(null), dispatch({ type: "open_window", payload: launch(BUDDY_LIST) }))} onCancel={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "delete" && (
        <Dialog
          title="Address Book"
          okLabel="Yes"
          cancelLabel="No"
          sound="ding"
          onOk={() => {
            deleteContact(dialog.contact.id)
            setDialog(null)
            setSelectedId(null)
            setMobileView("list")
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Are you sure you want to delete "{displayName(dialog.contact)}" from your Address Book?</p>
        </Dialog>
      )}
      {dialog?.kind === "newGroup" && (
        <Dialog
          title="New Group"
          okDisabled={!dialog.name.trim()}
          onOk={() => {
            const name = dialog.name.trim()
            if (!addGroup(name)) return alert("New Group", `There's already a group called "${name}".`)
            setDialog(null)
            setFolder(`group:${name}`)
          }}
          onCancel={() => setDialog(null)}
        >
          <label className="dialogText" htmlFor="ab-group-name">
            Group name:
          </label>
          <input id="ab-group-name" value={dialog.name} maxLength={30} onChange={(e) => setDialog({ ...dialog, name: e.target.value })} />
        </Dialog>
      )}
      {dialog?.kind === "import" && (
        <Panel
          title="Import"
          mobile={mobile}
          onClose={() => setDialog(null)}
          footer={
            <button type="button" onClick={() => setDialog(null)}>
              Cancel
            </button>
          }
        >
          <p>Bring people in from a vCard (.vcf) file, which phones and mail programs can all make, or straight from your phone.</p>
          <div className="abChoices">
            <button type="button" onClick={() => (setDialog(null), fileInput.current?.click())}>
              vCard file on this device...
            </button>
            <button type="button" onClick={() => setDialog({ kind: "openDrive" })}>
              vCard file on the 98ish drive...
            </button>
            <button type="button" onClick={() => (setDialog(null), fromPhone())}>
              My phone's contacts...
            </button>
          </div>
        </Panel>
      )}
      {dialog?.kind === "openDrive" && (
        <FileDialog
          mode="open"
          accept={(item) => !item.isDirectory && (item.type === "vcard" || (item.isText && /\.vcf$/i.test(item.name)))}
          typeLabel="vCard Files (*.vcf)"
          fileType="vcard"
          onPick={(file) => {
            setDialog(null)
            importText(file.textContent, `"${file.name}"`)
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "importConfirm" && (
        <Panel
          title="Import"
          mobile={mobile}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="abDefault" onClick={() => finishImport(dialog.cards)}>
                Import {dialog.cards.length}
              </button>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
            </>
          }
        >
          <p>
            Import {dialog.cards.length} contact{dialog.cards.length === 1 ? "" : "s"}? People already in your Address Book get the new details filled in.
          </p>
          <ul className="abImportList">
            {dialog.cards.slice(0, 50).map((c, i) => (
              <li key={i}>
                <Avatar contact={{ ...EMPTY, ...c, id: `imp${i}xxxxx` }} size={20} />
                <span>{displayName({ ...EMPTY, ...c })}</span>
                <span className="abRowSub">{[c.phones[0]?.value, c.emails[0]?.value].filter(Boolean).join(" · ")}</span>
              </li>
            ))}
            {dialog.cards.length > 50 && <li>...and {dialog.cards.length - 50} more</li>}
          </ul>
        </Panel>
      )}
      {dialog?.kind === "phoneHelp" && (
        <Panel
          title="Import from Phone"
          mobile={mobile}
          onClose={() => setDialog(null)}
          footer={
            <>
              <button type="button" className="abDefault" onClick={() => (setDialog(null), fileInput.current?.click())}>
                Choose a .vcf File...
              </button>
              <button type="button" onClick={() => setDialog(null)}>
                Close
              </button>
            </>
          }
        >
          {isIos() ? (
            <>
              <p>
                <b>iPhone and iPad don't let web pages read your contacts.</b> You can still bring them in as a vCard file:
              </p>
              <ol className="abSteps">
                <li>Open the Contacts app and tap someone.</li>
                <li>
                  Tap <b>Share Contact</b>, then <b>Save to Files</b>.
                </li>
                <li>
                  Come back here and tap <b>Choose a .vcf File...</b>, then pick it.
                </li>
              </ol>
              <p className="abNote">Lots of people at once: in Contacts tap Lists, touch and hold a list, and choose Export (iOS 16 and later).</p>
            </>
          ) : (
            <>
              <p>This browser can't open your phone's contact list (Chrome on Android can).</p>
              <p>Instead, export your contacts as a vCard (.vcf) file from your phone or mail program, then choose it here.</p>
            </>
          )}
        </Panel>
      )}
      {dialog?.kind === "invite" && (
        <InviteDialog contact={dialog.contact} cal={cal} online={online} mobile={mobile} dispatch={dispatch} onClose={() => setDialog(null)} onDone={(text) => alert("Invite to Calendar", text)} />
      )}
      {dialog?.kind === "about" && (
        <Dialog title="About Address Book" onOk={() => setDialog(null)}>
          <p className="dialogText">
            <b>98ish Address Book</b>
          </p>
          <p className="dialogText">Everyone you know, in one place. Sign on to 98 Messenger and your contacts follow you to every device. Birthdays and anniversaries show on Calendar's Birthdays calendar.</p>
        </Dialog>
      )}
    </div>
  )
}

// Invite a contact to one of your shared calendars (by their screen name)
const InviteDialog = ({ contact, cal, online, mobile, dispatch, onClose, onDone }) => {
  const shared = cal.calendars.filter((c) => c.kind === "group")
  const [calendarId, setCalendarId] = useState(shared[0]?.id || "")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const send = async () => {
    setBusy(true)
    const r = await inviteToCalendar(calendarId, contact.screenName)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onClose()
    onDone(`${contact.screenName} is invited to ${shared.find((c) => c.id === calendarId)?.name}. They'll see it in Calendar.`)
  }
  return (
    <Panel
      title="Invite to Calendar"
      mobile={mobile}
      onClose={onClose}
      footer={
        <>
          {online && shared.length > 0 && (
            <button type="button" className="abDefault" disabled={busy || !calendarId} onClick={send}>
              Invite
            </button>
          )}
          {(!shared.length || !online) && (
            <button type="button" onClick={() => (onClose(), dispatch({ type: "open_window", payload: launch(online ? "Calendar" : BUDDY_LIST) }))}>
              {online ? "Open Calendar" : "Sign On..."}
            </button>
          )}
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      {!online ? (
        <p>Sign on to 98 Messenger to share calendars.</p>
      ) : !shared.length ? (
        <p>You don't have a shared calendar yet. In Calendar choose File &gt; New Calendar, then invite {contact.screenName} from here.</p>
      ) : (
        <>
          <p>
            Invite <b>{contact.screenName}</b> to:
          </p>
          <select aria-label="Calendar" value={calendarId} onChange={(e) => setCalendarId(e.target.value)}>
            {shared.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      )}
      {error && <p className="abError">{error}</p>}
    </Panel>
  )
}

export default AddressBook
