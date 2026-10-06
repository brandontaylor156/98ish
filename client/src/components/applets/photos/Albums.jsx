import React, { useEffect, useMemo, useRef, useState } from "react"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import { useAim } from "../aim/AimContext"
import { launch } from "../../../utils/programs"
import { downloadBlob } from "../../../utils/fileTransfer"
import { previewOf } from "../../../utils/fs"
import {
  addToAlbum,
  commentOn,
  createAlbum,
  deleteAlbum,
  deleteComment,
  discardQueued,
  inviteToAlbum,
  leaveAlbum,
  likeItem,
  loadMedia,
  loadThumbs,
  markSeen,
  mediaBlob,
  mediaUrlFor,
  openAlbum,
  refreshAlbums,
  removeFromAlbum,
  removeItem,
  renameAlbum,
  retryQueued,
  thumbFor,
  useAlbums,
} from "../../../utils/albums"
import { ALBUM_NAME_MAX, COMMENT_MAX, activityText, canRemoveComment, canRemoveItem, countText, isUnseen, likeText, membersText, queueText } from "./albumsCore"
import { imagesIn, picturesFolder, savePicture } from "./library"
import Viewer from "./Viewer"
import Slideshow from "./Slideshow"
import "./Albums.css"

// Shared Albums inside Photos (utils/albums.js keeps them; server/albums serves them):
//   home    the albums I'm in, newest change first ("New" when a buddy changed one since I
//           looked), + New Album; uploads waiting or failed show as one line with Details
//   album   its photos and videos as a grid; Add, Slideshow; People/Rename/Leave/Delete under
//           More options
//   item    the photo (zoom, swipe) or video, who added it and when, Like, comments, Save to
//           My Pictures / Download, Remove (who added it, or the album's owner)
// AlbumPicker ("Add to Shared Album...") and AddPhotos (pick from My Pictures or the device)
// are used by Photos, Camera and Received Items too.

const when = (t) => {
  if (!t) return ""
  const d = new Date(t)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" })
}
const secondsText = (d) => (d ? `${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}` : "")

// toolbar pictures, drawn like Photos' own
const ICONS = {
  Albums: "M10 3L4 8l6 5M4 8h9",
  Pictures: "M10 3L4 8l6 5M4 8h9",
  Album: "M10 3L4 8l6 5M4 8h9",
  Back: "M10 3L5 8l5 5",
  Next: "M6 3l5 5-5 5",
  Add: "M8 3v10M3 8h10",
  "New Album": "M3 4h8v8H3zM5 2h8v8M7 6v4M5 8h4",
  Slideshow: "M2 3h12v8H2zM6 14h4M8 11v3M7 5.5v3l3-1.5z",
  People: "M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM2 13c0-3 2-4 4-4s4 1 4 4M11 7a1.6 1.6 0 1 0 0-3.2M12 9c1.5.3 2.5 1.4 2.5 4",
  Save: "M8 2v9M4.5 7.5L8 11l3.5-3.5M2 11v3h12v-3",
  Download: "M8 2v9M4.5 7.5L8 11l3.5-3.5M2 11v3h12v-3",
  Remove: "M4 4h8l-1 10H5zM3 4h10M6 2h4M7 6v6M9 6v6",
  Like: "M8 14S2 10 2 6a3 3 0 0 1 6-1 3 3 0 0 1 6 1c0 4-6 8-6 8z",
}
const Tool = ({ label, onClick, disabled, title, badge, icon }) => (
  <button type="button" className="phTool alTool" onClick={onClick} disabled={disabled} title={title || label}>
    {ICONS[icon || label] && (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="phIcon">
        <path d={ICONS[icon || label]} fill="none" stroke="#000" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )}
    <span className="phToolLabel">{label}</span>
    {badge ? <span className="alBadge">{badge}</span> : null}
  </button>
)

const Thumb = ({ albumId, item }) => {
  const src = thumbFor(item.id)
  return (
    <span className="phThumb alThumb">
      {src ? <img src={src} alt="" draggable={false} /> : <span className="alThumbWait" />}
      {item.kind === "video" && <span className="alVideoMark">▶ {secondsText(item.d)}</span>}
    </span>
  )
}

// ---------- pickers (also used outside the Albums screens) ----------

export const AlbumPicker = ({ title = "Add to Shared Album", count = 1, defaultName = "", onPick, onCancel }) => {
  const s = useAlbums()
  const [choice, setChoice] = useState(defaultName ? "new" : s.albums[0]?.id || "new")
  const [name, setName] = useState(defaultName)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    refreshAlbums()
  }, [])
  useEffect(() => {
    if (choice === "new" && s.albums.length && !name) setChoice(s.albums[0].id)
  }, [s.albums.length])
  if (s.status === "off")
    return (
      <Dialog title={title} onOk={onCancel}>
        <p className="dialogText">Sign on to 98 Messenger to share albums with your buddies.</p>
      </Dialog>
    )
  const ok = async () => {
    if (choice !== "new") return onPick(choice)
    const clean = name.trim()
    if (!clean) return setError("Give the new album a name.")
    setBusy(true)
    const r = await createAlbum(clean)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onPick(r.album.id)
  }
  return (
    <Dialog title={title} onOk={ok} onCancel={onCancel} okLabel="Add" okDisabled={busy}>
      <div className="alPicker">
        <p className="dialogText">
          Add {count === 1 ? "it" : `these ${count}`} to:
        </p>
        <div className="alPickList" role="radiogroup" aria-label="Albums">
          {s.albums.map((a) => (
            <div key={a.id} className="alPickRow field-row">
              <input id={`al-pick-${a.id}`} type="radio" name="al-pick" checked={choice === a.id} onChange={() => setChoice(a.id)} />
              <label htmlFor={`al-pick-${a.id}`}>
                <span className="alPickName">{a.name}</span> <span className="alPickInfo">{membersText(a, s.me)}</span>
              </label>
            </div>
          ))}
          <div className="alPickRow field-row">
            <input id="al-pick-new" type="radio" name="al-pick" checked={choice === "new"} onChange={() => setChoice("new")} />
            <label htmlFor="al-pick-new" className="alPickName">
              A new album:
            </label>
            <input
              type="text"
              className="alPickNew"
              placeholder="Album name"
              maxLength={ALBUM_NAME_MAX}
              value={name}
              onChange={(e) => (setName(e.target.value), setChoice("new"), setError(null))}
              aria-label="New album name"
            />
          </div>
        </div>
        {error && <p className="dialogText phError">{error}</p>}
      </div>
    </Dialog>
  )
}

// pick pictures from C:\My Pictures and/or the device -> onAdd(sources)
export const AddPhotos = ({ onAdd, onCancel }) => {
  const pictures = useMemo(() => imagesIn(picturesFolder()).slice().reverse(), [])
  const [picked, setPicked] = useState([])
  const fileRef = useRef(null)
  const toggle = (f) => setPicked((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))
  return (
    <Dialog title="Add Photos and Videos" onOk={() => picked.length && onAdd(picked.map((file) => ({ file })))} onCancel={onCancel} okLabel={picked.length ? `Add ${picked.length}` : "Add"} okDisabled={!picked.length}>
      <div className="alAdd">
        <button type="button" onClick={() => fileRef.current?.click()}>
          From Your Device...
        </button>
        <p className="dialogText">Or pick from My Pictures:</p>
        <div className="alAddGrid" role="listbox" aria-multiselectable="true" aria-label="My Pictures">
          {pictures.map((f) => (
            <button key={f.name} type="button" role="option" aria-selected={picked.includes(f)} className={`alAddTile${picked.includes(f) ? " is-on" : ""}`} onClick={() => toggle(f)} title={f.name}>
              {previewOf(f) ? <img src={previewOf(f)} alt="" draggable={false} loading="lazy" /> : null}
              {picked.includes(f) && <span className="alAddCheck">✓</span>}
            </button>
          ))}
          {!pictures.length && <p className="dialogText">There are no pictures in My Pictures yet.</p>}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/mp4,video/quicktime,video/webm,.heic,.heif"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files || [])]
            e.target.value = ""
            if (files.length) onAdd(files.map((blob) => ({ blob, name: blob.name })))
          }}
        />
      </div>
    </Dialog>
  )
}

// uploads waiting or failed
const QueueLine = ({ queue, albumId = null }) => {
  const [open, setOpen] = useState(false)
  const mine = albumId ? queue.filter((q) => q.albumId === albumId) : queue
  if (!mine.length) return null
  return (
    <>
      <div className="alQueue" role="status">
        <span>{queueText(mine)}</span>
        <button type="button" onClick={() => setOpen(true)}>
          Details...
        </button>
      </div>
      {open && (
        <Dialog title="Waiting to Upload" onOk={() => setOpen(false)}>
          <ul className="alQueueList">
            {mine.map((q) => (
              <li key={q.id}>
                {q.thumb && <img src={q.thumb} alt="" />}
                <span className="alQueueText">
                  <b>{q.name}</b> to {q.albumName}
                  <br />
                  {q.error || (q.tries ? `Will try again soon. ${q.lastError || ""}` : "Uploading...")}
                </span>
                {q.error && (
                  <button type="button" onClick={() => retryQueued(q.id)}>
                    Retry
                  </button>
                )}
                <button type="button" onClick={() => discardQueued(q.id)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  )
}

// ---------- the album's people ----------

const People = ({ album, me, onClose }) => {
  const aim = useAim()
  const [to, setTo] = useState("")
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const buddies = useMemo(() => {
    const all = (aim?.me?.groups || []).flatMap((g) => g.buddies || [])
    const keys = new Set(album.members.map((m) => m.key))
    return [...new Set(all)].filter((b) => {
      const k = String(b).replace(/\s+/g, "").toLowerCase()
      return !keys.has(k) && k !== "smarterchild"
    })
  }, [aim?.me, album.members])
  const owner = album.owner === me
  const invite = async (name) => {
    const who = String(name || to).trim()
    if (!who) return
    setBusy(true)
    const r = await inviteToAlbum(album.id, who)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    setTo("")
    setError(null)
  }
  return (
    <Dialog title={`People in ${album.name}`} onOk={onClose}>
      <div className="alPeople">
        <ul className="alPeopleList">
          {album.members.map((m) => (
            <li key={m.key}>
              <span>
                {m.name}
                {m.key === album.owner ? " (started it)" : ""}
                {m.key === me ? " (you)" : ""}
              </span>
              {owner && m.key !== me && (
                <button type="button" onClick={async () => setError((await removeFromAlbum(album.id, m.key)).error || null)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        <label className="dialogText" htmlFor="al-invite">
          Share with a buddy (screen name):
        </label>
        <div className="alInviteRow">
          <input id="al-invite" type="text" list="al-buddies" value={to} maxLength={32} onChange={(e) => (setTo(e.target.value), setError(null))} onKeyDown={(e) => e.key === "Enter" && invite()} />
          <button type="button" onClick={() => invite()} disabled={busy || !to.trim()}>
            Invite
          </button>
        </div>
        <datalist id="al-buddies">
          {buddies.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        {buddies.length > 0 && (
          <div className="alBuddyChips">
            {buddies.slice(0, 8).map((b) => (
              <button key={b} type="button" onClick={() => invite(b)} disabled={busy}>
                + {b}
              </button>
            ))}
          </div>
        )}
        {error && <p className="dialogText phError">{error}</p>}
      </div>
    </Dialog>
  )
}

// ---------- one photo or video ----------

const ItemView = ({ album, items, index, me, mobile, onIndex, onClose, onError }) => {
  const item = items[index]
  const [comment, setComment] = useState("")
  const [, setTick] = useState(0)
  const [problem, setProblem] = useState(null)
  const controls = useRef(null)
  const names = useMemo(() => Object.fromEntries(album.members.map((m) => [m.key, m.name])), [album.members])
  useEffect(() => {
    if (!item) return
    setProblem(null)
    let alive = true
    loadMedia(album.id, item).then((r) => alive && (r.ok ? setTick((n) => n + 1) : setProblem(r.error)))
    // the next one too
    const next = items[index + 1]
    if (next?.kind === "image") loadMedia(album.id, next)
    return () => {
      alive = false
    }
  }, [item?.id])
  if (!item) return null
  const full = mediaUrlFor(item.id)
  const liked = item.likes.includes(me)
  const step = (d) => onIndex((index + d + items.length) % items.length)
  const send = async () => {
    const text = comment.trim()
    if (!text) return
    const r = await commentOn(album.id, item.id, text)
    if (r.ok) setComment("")
    else onError(r.error)
  }
  const saveToPictures = async () => {
    const blob = await mediaBlob(album.id, item)
    if (!blob) return onError("That one couldn't be downloaded.")
    if (item.kind === "video") return downloadBlob(blob, `Video ${item.id.slice(0, 6)}${item.mime === "video/quicktime" ? ".mov" : item.mime === "video/webm" ? ".webm" : ".mp4"}`, item.mime)
    const data = await new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
    const result = data ? await savePicture(picturesFolder(), `${album.name} ${item.byName}.jpg`.replace(/[\\/:*?"<>|]/g, " "), data, { taken: item.taken || item.at }) : { ok: false, error: "That one couldn't be saved." }
    onError(result.ok ? `Saved to My Pictures as ${result.file.name}.` : result.error)
  }
  return (
    <div className="alItem">
      <div className="phTools" role="toolbar" aria-label="Photo">
        <Tool label="Album" onClick={onClose} title="Back to the album (Esc)" />
        <Tool label="Back" onClick={() => step(-1)} disabled={items.length < 2} />
        <Tool label="Next" onClick={() => step(1)} disabled={items.length < 2} />
        <span className="phSep" />
        <Tool icon="Like" label={liked ? "Liked" : "Like"} onClick={() => likeItem(album.id, item.id, !liked)} title={liked ? "Unlike" : "Like"} />
        <Tool label={item.kind === "video" ? "Download" : "Save"} onClick={saveToPictures} title={item.kind === "video" ? "Download to your device" : "Save to My Pictures"} />
        {canRemoveItem(album, item, me) && <Tool label="Remove" onClick={() => onError({ confirmRemove: item })} />}
      </div>
      <div className="alItemBody">
        <div className="alItemMedia">
          {item.kind === "video" ? (
            full ? (
              <video key={item.id} src={full} controls playsInline className="alVideo" />
            ) : (
              <div className="alItemWait">{thumbFor(item.id) && <img src={thumbFor(item.id)} alt="" />}<span>{problem || "Loading the video..."}</span></div>
            )
          ) : full || thumbFor(item.id) ? (
            <Viewer key={item.id} src={full || thumbFor(item.id)} width={item.w || 1} height={item.h || 1} alt={`Photo from ${item.byName}`} controls={controls} onZoom={() => {}} onSwipe={(d) => step(d)} />
          ) : (
            <div className="alItemWait">{problem || "Loading..."}</div>
          )}
        </div>
        <div className="alItemSide">
          <p className="alItemBy">
            <b>{item.by === me ? "You" : item.byName}</b> added this {when(item.at)}
            {item.taken ? ` · taken ${new Date(item.taken).toLocaleDateString()}` : ""}
          </p>
          {item.caption && <p className="alItemCaption">{item.caption}</p>}
          {item.likes.length > 0 && <p className="alLikes">♥ {likeText(item, me, names)}</p>}
          <ul className="alComments" aria-label="Comments">
            {item.comments.map((c) => (
              <li key={c.id}>
                <b>{c.by === me ? "You" : c.byName}:</b> <span data-selectable>{c.text}</span> <span className="alWhen">{when(c.at)}</span>
                {canRemoveComment(album, c, me) && (
                  <button type="button" className="alX" aria-label="Delete comment" onClick={() => deleteComment(album.id, item.id, c.id)}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="alCommentRow">
            <input type="text" value={comment} maxLength={COMMENT_MAX} placeholder="Add a comment..." aria-label="Add a comment" onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <button type="button" onClick={send} disabled={!comment.trim()}>
              Post
            </button>
          </div>
        </div>
      </div>
      <div className="status-bar phStatus">
        <p className="status-bar-field">
          {index + 1} of {items.length}
        </p>
        {!mobile && <p className="status-bar-field">{item.w && item.h ? `${item.w} x ${item.h}` : item.kind === "video" ? `Video ${secondsText(item.d)}` : ""}</p>}
      </div>
    </div>
  )
}

// ---------- one album ----------

const AlbumView = ({ id, me, mobile, showPrefs, onShowPrefs, onBack, dispatch }) => {
  const s = useAlbums()
  const detail = s.details[id]
  const album = detail?.album || s.albums.find((a) => a.id === id)
  const items = detail?.items || []
  const [viewing, setViewing] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [slideshow, setSlideshow] = useState(false)
  useEffect(() => {
    openAlbum(id).then((r) => {
      if (!r.ok && r.status === 404) onBack()
    })
    markSeen(id)
  }, [id, album?.changedAt])
  useEffect(() => {
    if (items.length) loadThumbs(id, items.map((i) => i.id))
  }, [id, items.length])
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape" || dialog || slideshow) return
      if (viewing !== null) setViewing(null)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [viewing, dialog, slideshow])
  if (!album) return <div className="alEmpty">Opening...</div>
  const owner = album.owner === me
  const images = items.filter((i) => i.kind === "image")
  const add = async (sources) => {
    setDialog({ kind: "busy", text: `Getting ${sources.length === 1 ? "it" : `${sources.length} items`} ready...` })
    const r = await addToAlbum(id, sources)
    setDialog(r.problems?.length ? { kind: "alert", text: r.problems.join(" ") } : null)
  }
  const showError = (e) => setDialog(e?.confirmRemove ? { kind: "remove", item: e.confirmRemove } : { kind: "alert", text: e })

  if (viewing !== null && items[viewing])
    return (
      <>
        <ItemView album={album} items={items} index={viewing} me={me} mobile={mobile} onIndex={setViewing} onClose={() => setViewing(null)} onError={showError} />
        {dialog?.kind === "alert" && (
          <Dialog title={album.name} onOk={() => setDialog(null)}>
            <p className="dialogText">{dialog.text}</p>
          </Dialog>
        )}
        {dialog?.kind === "remove" && (
          <Dialog
            title="Remove"
            sound="ding"
            okLabel="Remove"
            onOk={async () => {
              const r = await removeItem(id, dialog.item.id)
              setDialog(r.ok ? null : { kind: "alert", text: r.error })
              if (r.ok) setViewing(items.length > 1 ? Math.min(viewing, items.length - 2) : null)
            }}
            onCancel={() => setDialog(null)}
          >
            <p className="dialogText">Remove this {dialog.item.kind === "video" ? "video" : "photo"} from {album.name} for everyone?</p>
          </Dialog>
        )}
      </>
    )

  return (
    <div className="alAlbum">
      <div className="phTools" role="toolbar" aria-label="Album">
        <Tool label="Albums" onClick={onBack} title="All shared albums" />
        <Tool label="Add" onClick={() => setDialog({ kind: "add" })} title="Add photos and videos" />
        <Tool label="Slideshow" onClick={() => setSlideshow(true)} disabled={!images.length} />
        <Tool label="People" onClick={() => setDialog({ kind: "people" })} title="Who's in this album" />
      </div>
      <div className="alHead">
        <div className="alHeadName">{album.name}</div>
        <div className="alHeadInfo">
          {countText(album)} · {membersText(album, me)}
        </div>
        {album.lastWhat && <div className="alHeadInfo">{activityText(album, me)}</div>}
        <MoreOptions id="photos.album" summary={owner ? "Rename, delete" : "Leave the album"}>
          <div className="alMoreRow">
            {owner && <button type="button" onClick={() => setDialog({ kind: "rename", value: album.name })}>Rename...</button>}
            <button type="button" onClick={() => setDialog({ kind: "leave" })}>Leave Album...</button>
            {owner && <button type="button" onClick={() => setDialog({ kind: "delete" })}>Delete Album...</button>}
          </div>
        </MoreOptions>
      </div>
      <QueueLine queue={s.queue} albumId={id} />
      <div className="phGrid alGrid" role="listbox" aria-label={`Photos in ${album.name}`}>
        {items
          .map((item, i) => ({ item, i }))
          .reverse()
          .map(({ item, i }) => (
            <button key={item.id} type="button" role="option" aria-selected={false} className="phTile alTile" onClick={() => setViewing(i)} title={`From ${item.byName}`}>
              <Thumb albumId={id} item={item} />
              <span className="phTileName alTileInfo">
                {item.by === me ? "You" : item.byName}
                {item.likes.length ? ` · ♥${item.likes.length}` : ""}
                {item.comments.length ? ` · 💬${item.comments.length}` : ""}
              </span>
            </button>
          ))}
        {!items.length && (
          <div className="phEmpty">
            <p>Nothing in {album.name} yet.</p>
            <div className="phEmptyButtons">
              <button type="button" onClick={() => setDialog({ kind: "add" })}>
                Add Photos...
              </button>
              <button type="button" onClick={() => setDialog({ kind: "people" })}>
                Invite Buddies...
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="status-bar phStatus">
        <p className="status-bar-field">{countText(album)}</p>
        <p className="status-bar-field">{album.members.length} {album.members.length === 1 ? "person" : "people"}</p>
      </div>

      {slideshow && images.length > 0 && (
        <Slideshow
          items={images}
          start={0}
          prefs={showPrefs}
          onPrefs={onShowPrefs}
          getSrc={(it) => mediaUrlFor(it.id) || thumbFor(it.id)}
          prefetch={(it) => loadMedia(id, it)}
          title={album.name}
          subtitle={membersText(album, me)}
          onExit={() => setSlideshow(false)}
        />
      )}
      {dialog?.kind === "add" && <AddPhotos onAdd={add} onCancel={() => setDialog(null)} />}
      {dialog?.kind === "people" && <People album={album} me={me} onClose={() => setDialog(null)} />}
      {dialog?.kind === "busy" && (
        <Dialog title={album.name}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "alert" && (
        <Dialog title={album.name} onOk={() => setDialog(null)}>
          <p className="dialogText">{dialog.text}</p>
        </Dialog>
      )}
      {dialog?.kind === "rename" && (
        <Dialog
          title="Rename Album"
          onOk={async () => {
            const r = await renameAlbum(id, dialog.value)
            setDialog(r.ok ? null : { ...dialog, error: r.error })
          }}
          onCancel={() => setDialog(null)}
        >
          <label className="dialogText" htmlFor="al-rename">
            New name:
          </label>
          <input id="al-rename" type="text" value={dialog.value} maxLength={ALBUM_NAME_MAX} onChange={(e) => setDialog({ ...dialog, value: e.target.value, error: null })} style={{ width: "100%" }} />
          {dialog.error && <p className="dialogText phError">{dialog.error}</p>}
        </Dialog>
      )}
      {dialog?.kind === "leave" && (
        <Dialog
          title="Leave Album"
          sound="ding"
          okLabel="Leave"
          onOk={async () => {
            const r = await leaveAlbum(id)
            if (r.ok) onBack()
            else setDialog({ kind: "alert", text: r.error })
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">
            Leave {album.name}? {album.members.length > 1 ? `What you added stays for the others${owner ? ", and the album passes to the next person" : ""}.` : "You're the only one in it, so it will be deleted."}
          </p>
        </Dialog>
      )}
      {dialog?.kind === "delete" && (
        <Dialog
          title="Delete Album"
          sound="ding"
          okLabel="Delete"
          onOk={async () => {
            const r = await deleteAlbum(id)
            if (r.ok) onBack()
            else setDialog({ kind: "alert", text: r.error })
          }}
          onCancel={() => setDialog(null)}
        >
          <p className="dialogText">Delete {album.name} and every photo and video in it, for everyone? This can't be undone.</p>
        </Dialog>
      )}
    </div>
  )
}

// ---------- all albums ----------

const Albums = ({ mobile, dispatch, startAlbum = null, onBack, showPrefs, onShowPrefs }) => {
  const s = useAlbums()
  const [open, setOpen] = useState(startAlbum)
  const [dialog, setDialog] = useState(null)
  useEffect(() => {
    refreshAlbums()
  }, [])
  useEffect(() => {
    if (startAlbum) setOpen(startAlbum)
  }, [startAlbum])
  useEffect(() => {
    for (const a of s.albums) if (a.cover && !thumbFor(a.cover)) loadThumbs(a.id, [a.cover])
  }, [s.albums])

  if (s.status === "off")
    return (
      <div className="alRoot">
        <div className="phTools" role="toolbar" aria-label="Shared Albums">
          <Tool label="Pictures" onClick={onBack} />
        </div>
        <div className="alSignOn">
          <p>
            <b>Shared Albums</b> let you and your buddies put photos and videos in one place. Everyone in an album can add to it, like and comment.
          </p>
          <p>Sign on to 98 Messenger to start one.</p>
          <button type="button" onClick={() => dispatch?.({ type: "open_window", payload: launch("98 Messenger") })}>
            Open 98 Messenger
          </button>
        </div>
      </div>
    )

  if (open) return <div className="alRoot"><AlbumView id={open} me={s.me} mobile={mobile} showPrefs={showPrefs} onShowPrefs={onShowPrefs} dispatch={dispatch} onBack={() => (setOpen(null), refreshAlbums())} /></div>

  return (
    <div className="alRoot">
      <div className="phTools" role="toolbar" aria-label="Shared Albums">
        <Tool label="Pictures" onClick={onBack} title="Back to your pictures" />
        <Tool label="New Album" onClick={() => setDialog({ kind: "new", value: "" })} />
      </div>
      <QueueLine queue={s.queue} />
      <div className="alList" role="list" aria-label="Shared albums">
        {s.albums.map((a) => (
          <button key={a.id} type="button" role="listitem" className={`alCard${isUnseen(a, s.seen, s.me) ? " is-new" : ""}`} onClick={() => setOpen(a.id)}>
            <span className="alCardCover">{a.cover && thumbFor(a.cover) ? <img src={thumbFor(a.cover)} alt="" draggable={false} /> : <span className="alCardBlank">📷</span>}</span>
            <span className="alCardText">
              <span className="alCardName">
                {a.name}
                {isUnseen(a, s.seen, s.me) && <span className="alNew">New</span>}
              </span>
              <span className="alCardInfo">
                {countText(a)} · {membersText(a, s.me)}
              </span>
              <span className="alCardInfo">{activityText(a, s.me)}</span>
            </span>
          </button>
        ))}
        {s.status === "loading" && !s.albums.length && <p className="alEmpty">Looking for your albums...</p>}
        {s.status === "error" && !s.albums.length && <p className="alEmpty">{s.error}</p>}
        {s.status === "ready" && !s.albums.length && (
          <div className="phEmpty">
            <p>No shared albums yet.</p>
            <p>Start one, then invite a buddy: you can both add photos and videos, like and comment.</p>
            <div className="phEmptyButtons">
              <button type="button" onClick={() => setDialog({ kind: "new", value: "" })}>
                New Album...
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="status-bar phStatus">
        <p className="status-bar-field">
          {s.albums.length} shared album{s.albums.length === 1 ? "" : "s"}
        </p>
      </div>
      {dialog?.kind === "new" && (
        <Dialog
          title="New Album"
          onOk={async () => {
            const r = await createAlbum(dialog.value.trim())
            if (r.ok) {
              setDialog(null)
              setOpen(r.album.id)
            } else setDialog({ ...dialog, error: r.error })
          }}
          onCancel={() => setDialog(null)}
          okDisabled={!dialog.value.trim()}
        >
          <label className="dialogText" htmlFor="al-new">
            Album name:
          </label>
          <input id="al-new" type="text" value={dialog.value} maxLength={ALBUM_NAME_MAX} placeholder="Beach Day" onChange={(e) => setDialog({ ...dialog, value: e.target.value, error: null })} style={{ width: "100%" }} />
          {dialog.error && <p className="dialogText phError">{dialog.error}</p>}
        </Dialog>
      )}
    </div>
  )
}

export default Albums
