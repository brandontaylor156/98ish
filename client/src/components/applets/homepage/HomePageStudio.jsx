import React, { useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import FileDialog from "../notepad/FileDialog"
import { useAim } from "../aim/AimContext"
import { ieWindow, launch } from "../../../utils/programs"
import { formatSize } from "../../../utils/fileInfo"
import MemberPage from "../internetExplorer/local/member/MemberPage"
import ClipArt from "../internetExplorer/local/member/ClipArt"
import { BACKGROUNDS, BLOCK_TYPES, CLIPART, DEFAULT_SETTINGS, FONTS, MAX_PAGE_BYTES, SONGS, blockLabel, newBlock, toServer, withIds } from "../internetExplorer/local/member/schema"
import { shrinkPicture } from "./pictures"
import "./HomePageStudio.css"

// HomePage Studio 98ish: build a homepage out of blocks (headings, marquees, blinking
// text, clip art, hit counters...) with a live preview, keep a draft on this computer,
// and publish it at http://www.98ish.com/~yourname for everyone to visit in Internet
// Explorer. The page is a list of blocks, never HTML.

const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"
const DRAFT_KEY = "98ish.homepage.draft"
const keyOf = (name) => String(name || "").replace(/\s+/g, "").toLowerCase()

const starterPage = (screenName) => ({
  ...DEFAULT_SETTINGS,
  title: screenName ? `${screenName}'s Home Page` : "My Home Page",
  sparkle: true,
  blocks: withIds([
    { type: "marquee", text: "*~*~* Welcome to my corner of the Web!! *~*~* Sign my guestbook before you leave! *~*~*", color: "", bgColor: "", speed: "normal", direction: "left" },
    { type: "heading", text: screenName ? `Welcome to ${screenName}'s Home Page!` : "Welcome to My Home Page!", size: "h1", align: "center", color: "", effect: "rainbow" },
    { type: "image", art: "dancer", alt: "", align: "center" },
    { type: "paragraph", text: "Hi! Thanks for stopping by. This page is all about *me*, my hobbies and my favorite things on the Information Superhighway.\nCome back soon, I update it all the time!", align: "center", color: "", size: "normal", bold: false, italic: false, underline: false },
    { type: "divider", style: "rainbow" },
    { type: "links", title: "My Favorite Links", items: [{ label: "The 98ish Guestbook", url: "http://www.98ish.com/guestbook" }, { label: "Cool Links of the Web", url: "http://www.98ish.com/links" }, { label: "Yahoo!", url: "http://www.yahoo.com/" }] },
    { type: "counter", label: "" },
    { type: "guestbook", style: "button", text: "" },
    { type: "image", art: "construction", alt: "", align: "center" },
    { type: "webring" },
  ]),
})

const readDraft = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY))
    return saved?.doc && Array.isArray(saved.doc.blocks) ? { ...saved, doc: { ...DEFAULT_SETTINGS, ...saved.doc, blocks: withIds(saved.doc.blocks) } } : null
  } catch {
    return null
  }
}

const writeDraft = (owner, doc) => {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ owner, doc, savedAt: Date.now() }))
    return true
  } catch {
    return false
  }
}

const sizeOf = (doc) => new Blob([JSON.stringify(toServer(doc))]).size

const summary = (block) => {
  switch (block.type) {
    case "image":
      return block.art ? CLIPART.find((c) => c.id === block.art)?.label : block.alt || "Your picture"
    case "links":
      return `${block.items?.length || 0} link${block.items?.length === 1 ? "" : "s"}`
    case "divider":
      return block.style
    case "counter":
    case "webring":
      return ""
    case "guestbook":
      return block.text || "Sign My Guestbook!"
    default:
      return block.text
  }
}

// ---------- small form pieces ----------

const Row = ({ label, children, htmlFor }) => (
  <div className="hsRow">
    <label htmlFor={htmlFor}>{label}</label>
    <div className="hsRowField">{children}</div>
  </div>
)

const Select = ({ id, value, onChange, options }) => (
  <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
    {options.map(([v, label]) => (
      <option key={v} value={v}>
        {label}
      </option>
    ))}
  </select>
)

const ColorField = ({ id, value, onChange, fallback, optional = true }) => (
  <span className="hsColor">
    <input id={id} type="color" value={value || fallback} onChange={(e) => onChange(e.target.value)} />
    {optional && (
      <button type="button" disabled={!value} onClick={() => onChange("")}>
        Default
      </button>
    )}
  </span>
)

const ALIGN = [
  ["left", "Left"],
  ["center", "Center"],
  ["right", "Right"],
]

// ---------- block properties ----------

const BlockEditor = ({ block, onChange, onPickPicture, defaultText }) => {
  const set = (patch) => onChange({ ...block, ...patch })
  const id = (name) => `hs-${block.id}-${name}`
  const text = (max, multi = false) => (
    <Row label="Text:" htmlFor={id("text")}>
      {multi ? (
        <textarea id={id("text")} rows={5} maxLength={max} value={block.text} onChange={(e) => set({ text: e.target.value })} />
      ) : (
        <input id={id("text")} maxLength={max} value={block.text} onChange={(e) => set({ text: e.target.value })} />
      )}
    </Row>
  )
  const align = (
    <Row label="Align:" htmlFor={id("align")}>
      <Select id={id("align")} value={block.align || "center"} onChange={(v) => set({ align: v })} options={ALIGN} />
    </Row>
  )
  const color = (key = "color", label = "Color:") => (
    <Row label={label} htmlFor={id(key)}>
      <ColorField id={id(key)} value={block[key]} fallback={key === "bgColor" ? "#000080" : defaultText} onChange={(v) => set({ [key]: v })} />
    </Row>
  )

  switch (block.type) {
    case "heading":
      return (
        <>
          {text(80)}
          <Row label="Size:" htmlFor={id("size")}>
            <Select id={id("size")} value={block.size} onChange={(v) => set({ size: v })} options={[["h1", "Huge"], ["h2", "Big"], ["h3", "Medium"]]} />
          </Row>
          <Row label="Effect:" htmlFor={id("effect")}>
            <Select id={id("effect")} value={block.effect} onChange={(v) => set({ effect: v })} options={[["none", "None"], ["rainbow", "Rainbow"], ["shadow", "Drop Shadow"]]} />
          </Row>
          {align}
          {color()}
        </>
      )
    case "paragraph":
      return (
        <>
          {text(2000, true)}
          <p className="hsHint">Tip: *stars* make text bold and _underscores_ make it italic.</p>
          <Row label="Style:">
            <span className="hsToggles">
              {[
                ["bold", "B"],
                ["italic", "I"],
                ["underline", "U"],
              ].map(([key, label]) => (
                <button key={key} type="button" className={`hsToggle hsToggle--${key}${block[key] ? " is-on" : ""}`} aria-pressed={!!block[key]} onClick={() => set({ [key]: !block[key] })}>
                  {label}
                </button>
              ))}
            </span>
          </Row>
          <Row label="Size:" htmlFor={id("size")}>
            <Select id={id("size")} value={block.size} onChange={(v) => set({ size: v })} options={[["small", "Small"], ["normal", "Normal"], ["big", "Big"], ["huge", "Huge"]]} />
          </Row>
          {align}
          {color()}
        </>
      )
    case "marquee":
      return (
        <>
          {text(200)}
          <Row label="Speed:" htmlFor={id("speed")}>
            <Select id={id("speed")} value={block.speed} onChange={(v) => set({ speed: v })} options={[["slow", "Slow"], ["normal", "Normal"], ["fast", "Fast"]]} />
          </Row>
          <Row label="Scroll:" htmlFor={id("direction")}>
            <Select id={id("direction")} value={block.direction} onChange={(v) => set({ direction: v })} options={[["left", "Right to left"], ["right", "Left to right"]]} />
          </Row>
          {color("color", "Text color:")}
          {color("bgColor", "Background:")}
        </>
      )
    case "blink":
      return (
        <>
          {text(100)}
          {align}
          {color()}
        </>
      )
    case "image":
      return (
        <>
          <div className="hsArtGrid" role="radiogroup" aria-label="Clip art">
            {CLIPART.map((art) => (
              <button key={art.id} type="button" role="radio" aria-checked={block.art === art.id} className={block.art === art.id ? "is-on" : undefined} title={art.label} onClick={() => set({ art: art.id, src: undefined })}>
                <ClipArt id={art.id} label={art.label} />
                <span>{art.label}</span>
              </button>
            ))}
          </div>
          <Row label="Picture:">
            <span className="hsPicture">
              {!block.art && block.src ? <img src={block.src} alt="" /> : null}
              <button type="button" onClick={onPickPicture}>
                {block.art ? "Use My Picture..." : "Change Picture..."}
              </button>
            </span>
          </Row>
          <Row label="Caption:" htmlFor={id("alt")}>
            <input id={id("alt")} maxLength={100} value={block.alt || ""} placeholder="Describe it for everyone" onChange={(e) => set({ alt: e.target.value })} />
          </Row>
          {align}
        </>
      )
    case "divider":
      return (
        <Row label="Style:" htmlFor={id("style")}>
          <Select id={id("style")} value={block.style} onChange={(v) => set({ style: v })} options={[["rainbow", "Rainbow Bar"], ["line", "Groove Line"], ["dots", "Dots"], ["stars", "Gold Stars"]]} />
        </Row>
      )
    case "links":
      return (
        <>
          <Row label="Title:" htmlFor={id("title")}>
            <input id={id("title")} maxLength={60} value={block.title || ""} onChange={(e) => set({ title: e.target.value })} />
          </Row>
          <div className="hsLinks">
            {block.items.map((item, i) => (
              <div key={i} className="hsLinkRow">
                <input aria-label={`Link ${i + 1} name`} placeholder="Name" maxLength={60} value={item.label} onChange={(e) => set({ items: block.items.map((it, j) => (j === i ? { ...it, label: e.target.value } : it)) })} />
                <input aria-label={`Link ${i + 1} address`} placeholder="http://" maxLength={200} value={item.url} inputMode="url" autoCapitalize="off" spellCheck="false" onChange={(e) => set({ items: block.items.map((it, j) => (j === i ? { ...it, url: e.target.value } : it)) })} />
                <button type="button" aria-label={`Remove link ${i + 1}`} disabled={block.items.length <= 1} onClick={() => set({ items: block.items.filter((_, j) => j !== i) })}>
                  x
                </button>
              </div>
            ))}
            <button type="button" disabled={block.items.length >= 20} onClick={() => set({ items: [...block.items, { label: "", url: "http://" }] })}>
              Add Link
            </button>
            <p className="hsHint">Links to other web sites open in Internet Explorer's time machine. 98ish pages (http://www.98ish.com/...) open right away.</p>
          </div>
        </>
      )
    case "counter":
      return (
        <Row label="Label:" htmlFor={id("label")}>
          <input id={id("label")} maxLength={60} placeholder="You are visitor number" value={block.label || ""} onChange={(e) => set({ label: e.target.value })} />
        </Row>
      )
    case "guestbook":
      return (
        <>
          <Row label="Look:" htmlFor={id("style")}>
            <Select id={id("style")} value={block.style} onChange={(v) => set({ style: v })} options={[["button", "Big Button"], ["link", "Plain Link"]]} />
          </Row>
          <Row label="Text:" htmlFor={id("gtext")}>
            <input id={id("gtext")} maxLength={60} placeholder="Sign My Guestbook!" value={block.text || ""} onChange={(e) => set({ text: e.target.value })} />
          </Row>
        </>
      )
    case "webring":
      return <p className="hsHint">Prev, Random and Next buttons for the 98ish Web Ring. Every published homepage is in the ring.</p>
    default:
      return null
  }
}

const PageEditor = ({ doc, onChange }) => {
  const set = (patch) => onChange({ ...doc, ...patch })
  return (
    <div className="hsProps">
      <Row label="Title:" htmlFor="hs-title">
        <input id="hs-title" maxLength={60} value={doc.title} onChange={(e) => set({ title: e.target.value })} />
      </Row>
      <Row label="Background:">
        <div className="hsSwatches" role="radiogroup" aria-label="Background">
          {BACKGROUNDS.map((bg) => (
            <button key={bg.id} type="button" role="radio" aria-checked={doc.bg === bg.id} title={bg.label} className={`hsSwatch mpBg--${bg.id}${doc.bg === bg.id ? " is-on" : ""}`} style={{ backgroundColor: bg.colors.bgColor }} onClick={() => set({ bg: bg.id, ...bg.colors })}>
              <span>{bg.label}</span>
            </button>
          ))}
        </div>
      </Row>
      <Row label="Back color:" htmlFor="hs-bgcolor">
        <ColorField id="hs-bgcolor" value={doc.bgColor} fallback="#000033" optional={false} onChange={(v) => set({ bgColor: v })} />
      </Row>
      <Row label="Text color:" htmlFor="hs-text">
        <ColorField id="hs-text" value={doc.text} fallback="#ffff66" optional={false} onChange={(v) => set({ text: v })} />
      </Row>
      <Row label="Link color:" htmlFor="hs-link">
        <ColorField id="hs-link" value={doc.link} fallback="#66ffff" optional={false} onChange={(v) => set({ link: v })} />
      </Row>
      <Row label="Font:" htmlFor="hs-font">
        <Select id="hs-font" value={doc.font} onChange={(v) => set({ font: v })} options={FONTS.map((f) => [f.id, f.label])} />
      </Row>
      <Row label="Music:" htmlFor="hs-music">
        <Select id="hs-music" value={doc.music || ""} onChange={(v) => set({ music: v })} options={[["", "(none)"], ...SONGS.map((s) => [s.id, `${s.title} (${s.file})`])]} />
      </Row>
      <p className="hsHint">Background music starts when a visitor clicks on your page (web browsers don't allow sound before that).</p>
      <div className="hsCheck">
        <input id="hs-sparkle" type="checkbox" checked={!!doc.sparkle} onChange={(e) => set({ sparkle: e.target.checked })} />
        <label htmlFor="hs-sparkle">Sparkle trail behind the mouse</label>
      </div>
      <div className="hsCheck">
        <input id="hs-badge" type="checkbox" checked={!!doc.badge} onChange={(e) => set({ badge: e.target.checked })} />
        <label htmlFor="hs-badge">"Best viewed in 800 x 600" badge</label>
      </div>
    </div>
  )
}

// ---------- the program ----------

const HomePageStudio = ({ dispatch, onTitle, onClose, mobile }) => {
  const aim = useAim()
  const online = aim?.status === "online" && !!aim?.token
  const me = online ? aim.me.screenName : null
  const token = aim?.token

  const [doc, setDoc] = useState(() => readDraft()?.doc || starterPage(null))
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState("blocks") // blocks | page | preview (phones)
  const [published, setPublished] = useState(null) // { updatedAt, hits } | false
  const [savedAt, setSavedAt] = useState(() => readDraft()?.savedAt || null)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState(null)
  const loadedFor = useRef(null)

  const pageUrl = me ? `http://www.98ish.com/~${keyOf(me)}` : null
  const size = useMemo(() => sizeOf(doc), [doc])
  const block = doc.blocks.find((b) => b.id === selected) || null

  useEffect(() => {
    // phones have room for the program's name only
    onTitle?.(mobile ? "HomePage Studio" : `${doc.title || "Untitled"} - HomePage Studio 98ish`)
  }, [doc.title, mobile])

  const api = async (method, body) => {
    try {
      const r = await fetch(`${SERVER_URL}/api/homepage`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      return await r.json().catch(() => ({ ok: false, error: `The 98ish web server had a problem (${r.status}).` }))
    } catch {
      return { ok: false, error: "Couldn't reach the 98ish web server. It may be waking up; try again in a minute." }
    }
  }

  // Signing on: find out whether this screen name has a published page. If this computer
  // has no draft of it, start from the published page (or a fresh starter page).
  useEffect(() => {
    if (!online) {
      setPublished(null)
      return
    }
    if (loadedFor.current === me) return
    loadedFor.current = me
    api("GET").then((r) => {
      if (!r.ok) return
      setPublished(r.published ? { updatedAt: r.published.updatedAt, hits: r.published.hits } : false)
      const draft = readDraft()
      if (draft && (draft.owner === keyOf(me) || !draft.owner)) return
      setDoc(r.published ? { ...DEFAULT_SETTINGS, ...r.published.page, blocks: withIds(r.published.page.blocks) } : starterPage(me))
      setSelected(null)
      setDirty(false)
    })
  }, [online, me])

  // Keep a draft on this computer as you work
  useEffect(() => {
    if (!dirty) return
    const id = setTimeout(() => {
      if (writeDraft(me ? keyOf(me) : null, doc)) setSavedAt(Date.now())
    }, 800)
    return () => clearTimeout(id)
  }, [doc, dirty])

  const change = (next) => {
    setDoc(next)
    setDirty(true)
  }

  const updateBlock = (next) => change({ ...doc, blocks: doc.blocks.map((b) => (b.id === next.id ? next : b)) })

  const insert = (type) => {
    const fresh = newBlock(type)
    const at = selected ? doc.blocks.findIndex((b) => b.id === selected) + 1 : doc.blocks.length
    const blocks = [...doc.blocks]
    blocks.splice(at || blocks.length, 0, fresh)
    change({ ...doc, blocks })
    setSelected(fresh.id)
    setTab("blocks")
  }

  const move = (id, step) => {
    const i = doc.blocks.findIndex((b) => b.id === id)
    const j = i + step
    if (i < 0 || j < 0 || j >= doc.blocks.length) return
    const blocks = [...doc.blocks]
    ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
    change({ ...doc, blocks })
  }

  const remove = (id) => {
    const i = doc.blocks.findIndex((b) => b.id === id)
    const blocks = doc.blocks.filter((b) => b.id !== id)
    change({ ...doc, blocks })
    setSelected(blocks[Math.min(i, blocks.length - 1)]?.id || null)
  }

  const duplicate = (id) => {
    const i = doc.blocks.findIndex((b) => b.id === id)
    if (i < 0) return
    const copy = withIds([{ ...doc.blocks[i], id: undefined }])[0]
    const blocks = [...doc.blocks]
    blocks.splice(i + 1, 0, copy)
    change({ ...doc, blocks })
    setSelected(copy.id)
  }

  const saveDraft = () => {
    if (writeDraft(me ? keyOf(me) : null, doc)) {
      setSavedAt(Date.now())
      setDialog({ kind: "info", title: "Save Draft", text: "Your draft is saved on this computer. Publish it when you're ready for the world to see it!" })
    } else setDialog({ kind: "info", title: "Save Draft", text: "This computer's storage is full, so the draft couldn't be saved. Try smaller pictures." })
  }

  const needSignOn = () => setDialog({ kind: "signon" })

  const publish = async () => {
    if (!online) return needSignOn()
    if (size > MAX_PAGE_BYTES) return setDialog({ kind: "info", title: "Publish", text: `Your page is ${formatSize(size)}, but pages can be at most ${formatSize(MAX_PAGE_BYTES)}. Use fewer or smaller pictures.` })
    setBusy(true)
    const r = await api("PUT", { page: toServer(doc) })
    setBusy(false)
    if (!r.ok) return setDialog({ kind: "info", title: "Publish", sound: "chord", text: r.error })
    setPublished({ updatedAt: r.published.updatedAt, hits: r.published.hits })
    writeDraft(keyOf(me), doc)
    setSavedAt(Date.now())
    setDialog({ kind: "published", url: r.url })
  }

  const unpublish = async () => {
    setDialog(null)
    if (!online) return needSignOn()
    setBusy(true)
    const r = await api("DELETE")
    setBusy(false)
    if (!r.ok) return setDialog({ kind: "info", title: "Unpublish", sound: "chord", text: r.error })
    setPublished(false)
    setDialog({ kind: "info", title: "Unpublish", text: "Your homepage is no longer on the Web. Your draft is still here." })
  }

  const viewPublished = () => pageUrl && dispatch({ type: "open_window", payload: ieWindow(pageUrl) })

  const pickPicture = async (file) => {
    setDialog(null)
    try {
      const { src } = await shrinkPicture(file.textContent)
      const target = block?.type === "image" ? block : null
      if (target) updateBlock({ ...target, art: undefined, src, alt: target.alt || file.name.replace(/\.[a-z0-9]+$/i, "") })
      else {
        const fresh = { ...newBlock("image"), art: undefined, src, alt: file.name.replace(/\.[a-z0-9]+$/i, "") }
        const at = selected ? doc.blocks.findIndex((b) => b.id === selected) + 1 : doc.blocks.length
        const blocks = [...doc.blocks]
        blocks.splice(at, 0, fresh)
        change({ ...doc, blocks })
        setSelected(fresh.id)
      }
    } catch (error) {
      setDialog({ kind: "info", title: "Insert Picture", sound: "chord", text: error.message })
    }
  }

  const menus = [
    {
      label: "File",
      items: [
        { label: "New Page", onClick: () => setDialog({ kind: "new" }) },
        { label: "Save Draft", onClick: saveDraft },
        "-",
        { label: "Publish to the Web", onClick: publish, disabled: busy },
        { label: "Unpublish...", onClick: () => (online ? setDialog({ kind: "unpublish" }) : needSignOn()), disabled: busy || !published },
        { label: "View Published Page", onClick: viewPublished, disabled: !published },
        "-",
        { label: "Exit", onClick: () => onClose?.() },
      ],
    },
    {
      label: "Insert",
      items: [
        ...BLOCK_TYPES.map((t) => ({ label: t.label, onClick: () => insert(t.type) })),
        "-",
        { label: "Picture from My Computer...", onClick: () => setDialog({ kind: "picture" }) },
      ],
    },
    {
      label: "Format",
      items: [
        { label: "Page Properties...", onClick: () => setTab("page") },
        { label: "Move Block Up", onClick: () => move(selected, -1), disabled: !selected },
        { label: "Move Block Down", onClick: () => move(selected, 1), disabled: !selected },
        { label: "Delete Block", onClick: () => remove(selected), disabled: !selected },
      ],
    },
    { label: "Help", items: [{ label: "About HomePage Studio", onClick: () => setDialog({ kind: "about" }) }] },
  ]

  const preview = (
    <div className="hsPreviewFrame">
      <div className="hsPreviewBar">
        <span className="hsPreviewLabel">Address</span>
        <span className="hsPreviewUrl">{pageUrl || "http://www.98ish.com/~yourname"}</span>
      </div>
      <div className="hsPreview">
        <MemberPage
          doc={doc}
          owner={{ screenName: me || "You" }}
          hits={published?.hits ?? 0}
          ring={{ prev: "#", next: "#", random: "#" }}
          preview
          selected={selected}
          onSelect={(id) => {
            setSelected(id)
            if (!mobile) setTab("blocks")
          }}
        />
      </div>
    </div>
  )

  const blocksPane = (
    <div className="hsBlocksPane">
      <ol className="hsBlockList" aria-label="Blocks">
        {doc.blocks.map((b, i) => (
          <li key={b.id} className={b.id === selected ? "is-selected" : undefined}>
            <button type="button" className="hsBlockName" onClick={() => setSelected(b.id === selected ? null : b.id)}>
              <span className={`hsBlockIcon hsBlockIcon--${b.type}`} aria-hidden="true" />
              <b>{blockLabel(b.type)}</b>
              <span className="hsBlockSummary">{summary(b)}</span>
            </button>
            <span className="hsBlockTools">
              <button type="button" aria-label="Move up" title="Move up" disabled={i === 0} onClick={() => move(b.id, -1)}>
                ▲
              </button>
              <button type="button" aria-label="Move down" title="Move down" disabled={i === doc.blocks.length - 1} onClick={() => move(b.id, 1)}>
                ▼
              </button>
              <button type="button" aria-label="Delete block" title="Delete" onClick={() => remove(b.id)}>
                ✕
              </button>
            </span>
          </li>
        ))}
        {doc.blocks.length === 0 && <li className="hsNone">No blocks yet. Insert one!</li>}
      </ol>
      {block && (
        <fieldset className="hsProps">
          <legend>
            {blockLabel(block.type)} Properties
            <button type="button" className="hsDuplicate" onClick={() => duplicate(block.id)}>
              Duplicate
            </button>
          </legend>
          <BlockEditor key={block.id} block={block} onChange={updateBlock} onPickPicture={() => setDialog({ kind: "picture" })} defaultText={doc.text} />
        </fieldset>
      )}
    </div>
  )

  return (
    <div className={`hsRoot${mobile ? " is-mobile" : ""}`}>
      <MenuBar menus={menus} />
      <div className="hsToolbar">
        {mobile ? (
          <select aria-label="Insert a block" value="" onChange={(e) => e.target.value && (e.target.value === "picture" ? setDialog({ kind: "picture" }) : insert(e.target.value))}>
            <option value="">Insert...</option>
            {BLOCK_TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
            <option value="picture">Picture from My Computer</option>
          </select>
        ) : (
          <>
            {BLOCK_TYPES.map((t) => (
              <button key={t.type} type="button" className="hsInsert" title={`Insert ${t.label}`} onClick={() => insert(t.type)}>
                <span className={`hsBlockIcon hsBlockIcon--${t.type}`} aria-hidden="true" />
                {t.short}
              </button>
            ))}
            <button type="button" className="hsInsert" onClick={() => setDialog({ kind: "picture" })}>
              <span className="hsBlockIcon hsBlockIcon--photo" aria-hidden="true" />
              Picture...
            </button>
          </>
        )}
        <span className="hsToolbarGap" />
        <button type="button" className="hsSave" onClick={saveDraft}>
          Save Draft
        </button>
        <button type="button" className="hsPublish" onClick={publish} disabled={busy}>
          {busy ? "Publishing..." : "Publish"}
        </button>
      </div>

      {mobile && (
        <div className="hsTabs" role="tablist">
          {[
            ["blocks", "Blocks"],
            ["page", "Page"],
            ["preview", "Preview"],
          ].map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : undefined} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="hsMain">
        {(!mobile || tab !== "preview") && (
          <div className="hsSide">
            {!mobile && (
              <div className="hsTabs" role="tablist">
                {[
                  ["blocks", "Blocks"],
                  ["page", "Page Properties"],
                ].map(([id, label]) => (
                  <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : undefined} onClick={() => setTab(id)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="hsSideBody">{tab === "page" ? <PageEditor doc={doc} onChange={change} /> : blocksPane}</div>
          </div>
        )}
        {(!mobile || tab === "preview") && preview}
      </div>

      <div className="status-bar hsStatus">
        <p className="status-bar-field">{savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Not saved yet"}</p>
        <p className={`status-bar-field${size > MAX_PAGE_BYTES ? " hsOver" : ""}`}>
          {formatSize(size)} of {formatSize(MAX_PAGE_BYTES)}
        </p>
        <p className="status-bar-field hsStatusUrl">{!online ? "Sign on to 98 Messenger to publish" : published ? `Published: ${pageUrl}` : "Not published yet"}</p>
      </div>

      {dialog?.kind === "picture" && (
        <FileDialog mode="open" accept={(item) => item.isImage} typeLabel="Pictures" fileType="image" onPick={pickPicture} onCancel={() => setDialog(null)} />
      )}
      {dialog?.kind === "info" && (
        <Dialog title={dialog.title} sound={dialog.sound || "ding"} onOk={() => setDialog(null)}>
          <p className="dialogText hsDialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "published" && (
        <Dialog
          title="Published!"
          sound="ding"
          okLabel="View Page"
          cancelLabel="Close"
          onOk={() => {
            setDialog(null)
            viewPublished()
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText hsDialogText">
            Your homepage is on the Web! Anyone can visit it in Internet Explorer at:
            <br />
            <b className="hsUrl">{dialog.url}</b>
          </p>
        </Dialog>
      )}
      {dialog?.kind === "signon" && (
        <Dialog
          title="HomePage Studio"
          sound="chord"
          okLabel="Sign On..."
          onOk={() => {
            setDialog(null)
            dispatch({ type: "open_window", payload: launch("98 Messenger") })
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText hsDialogText">Your homepage lives at your 98 Messenger screen name. Sign on to 98 Messenger to publish it.</p>
        </Dialog>
      )}
      {dialog?.kind === "unpublish" && (
        <Dialog title="Unpublish" sound="chord" okLabel="Yes" cancelLabel="No" onOk={unpublish} onCancel={() => setDialog(null)}>
          <p className="dialogText hsDialogText">Take your homepage off the Web? Its hit counter starts over if you publish it again.</p>
        </Dialog>
      )}
      {dialog?.kind === "new" && (
        <Dialog
          title="New Page"
          sound="chord"
          okLabel="Start Over"
          onOk={() => {
            setDialog(null)
            change(starterPage(me))
            setSelected(null)
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText hsDialogText">Start a fresh page? Your draft will be replaced (your published page stays until you publish again).</p>
        </Dialog>
      )}
      {dialog?.kind === "about" && (
        <Dialog title="About HomePage Studio" onOk={() => setDialog(null)}>
          <p className="dialogText hsDialogText">
            HomePage Studio 98ish
            <br />
            Build your own homepage, no HTML required. Free hosting at http://www.98ish.com/~yourname.
          </p>
        </Dialog>
      )}
    </div>
  )
}

export default HomePageStudio
