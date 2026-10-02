import React, { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { SERVER_URL, VIEW_EVENT, coupleApi, openCouples, useCouple } from "../../../utils/couple"
import { unlock } from "../../../utils/achievements"
import Dialog from "../../shared/Dialog"
import { MOODS, Sticker, TwoHearts, moodOf } from "./art"
import { AddPhoto, NotPaired, PhotoThumb, TogetherLine, dayLabel, loadPhoto, rememberPhoto, togetherFor, useCoupleEvent, useNow, usePhoto } from "./shared"
import { shrinkPicture } from "../homepage/pictures"
import "./OurStory.css"

// Our Story: the couple's timeline, written together. Moments have a date, a title, a
// place, a few words, a mood sticker and up to four photos. See it as a timeline, a
// wall of photos or a slideshow; and if you like, publish it as your homepage (only
// photos not marked private, and only when you say so).

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

// ---- editing a moment ----

const MomentEditor = ({ moment, onSaved, onCancel }) => {
  const [date, setDate] = useState(moment?.date || today())
  const [title, setTitle] = useState(moment?.title || "")
  const [location, setLocation] = useState(moment?.location || "")
  const [text, setText] = useState(moment?.text || "")
  const [mood, setMood] = useState(moment?.mood || "love")
  const [photos, setPhotos] = useState(moment?.photos || [])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const addPhoto = async (data) => {
    setUploading(true)
    setError(null)
    const r = await coupleApi("POST", "/photos", { data, private: false })
    setUploading(false)
    if (!r.ok) return setError(r.error)
    rememberPhoto(r.photo.id, data)
    setPhotos((list) => [...list, { id: r.photo.id, private: false }])
  }

  const togglePrivate = async (photo) => {
    const r = await coupleApi("PATCH", `/photos/${photo.id}`, { private: !photo.private })
    if (r.ok) setPhotos((list) => list.map((p) => (p.id === photo.id ? { ...p, private: r.photo.private } : p)))
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    const body = { moment: { date, title, location, text, mood, photos: photos.map((p) => p.id) } }
    const r = moment ? await coupleApi("PUT", `/moments/${moment.id}`, body) : await coupleApi("POST", "/moments", body)
    setBusy(false)
    if (!r.ok) return setError(r.error)
    unlock("first-moment")
    onSaved(r.moment)
  }

  return (
    <div className="osSheetLayer" role="dialog" aria-label={moment ? "Edit moment" : "New moment"}>
      <div className="window osSheet">
        <div className="title-bar">
          <div className="title-bar-text">{moment ? "Edit Moment" : "New Moment"}</div>
          <div className="title-bar-controls">
            <button type="button" aria-label="Close" onClick={onCancel} />
          </div>
        </div>
        <div className="window-body osSheetBody">
          <div className="osRow">
            <label className="osField">
              <span>Date</span>
              <input type="date" value={date} max="2100-12-31" onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="osField osGrow">
              <span>Where</span>
              <input value={location} maxLength={80} placeholder="Our favorite café" onChange={(e) => setLocation(e.target.value)} />
            </label>
          </div>
          <label className="osField">
            <span>Title</span>
            <input value={title} maxLength={80} placeholder="Our first date" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <div className="osField">
            <span>Sticker</span>
            <div className="osMoods" role="radiogroup" aria-label="Sticker">
              {MOODS.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={mood === m.id} className={mood === m.id ? "osMood is-on" : "osMood"} title={m.label} onClick={() => setMood(m.id)}>
                  <Sticker mood={m.id} size={30} />
                </button>
              ))}
            </div>
          </div>
          <label className="osField">
            <span>What happened</span>
            <textarea rows={4} value={text} maxLength={2000} placeholder="Tell the story..." onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="osField">
            <span>Photos ({photos.length}/4)</span>
            <div className="osEditPhotos">
              {photos.map((p) => (
                <div key={p.id} className="osEditPhoto">
                  <PhotoThumb id={p.id} className="osEditThumb" />
                  <button type="button" className={p.private ? "osPrivate is-on" : "osPrivate"} aria-pressed={p.private} title="Private photos never go on a homepage" onClick={() => togglePrivate(p)}>
                    {p.private ? "🔒 Private" : "🔓 Public ok"}
                  </button>
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            {photos.length < 4 && <AddPhoto disabled={uploading} label={uploading ? "Uploading" : "Add photo"} onPhoto={addPhoto} onError={setError} />}
          </div>
          {error && <p className="usError">{error}</p>}
          <div className="osSheetButtons">
            <button type="button" className="usPrimary" disabled={busy || uploading || !title.trim() || !date} onClick={save}>
              {busy ? "Saving..." : "Save moment ♥"}
            </button>
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const HeaderEditor = ({ story, onSaved, onCancel }) => {
  const [title, setTitle] = useState(story.title)
  const [togetherSince, setTogetherSince] = useState(story.togetherSince)
  const [metOn, setMetOn] = useState(story.metOn)
  const [howWeMet, setHowWeMet] = useState(story.howWeMet)
  const [error, setError] = useState(null)
  return (
    <Dialog
      title="Our Story"
      okLabel="Save"
      onOk={async () => {
        const r = await coupleApi("PUT", "/story", { title, togetherSince, metOn, howWeMet })
        if (!r.ok) return setError(r.error)
        onSaved(r.story)
      }}
      onCancel={onCancel}
    >
      <div className="osHeaderForm">
        <label className="osField">
          <span>Title</span>
          <input value={title} maxLength={60} placeholder="Our Story" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <div className="osRow">
          <label className="osField">
            <span>Together since</span>
            <input type="date" value={togetherSince} onChange={(e) => setTogetherSince(e.target.value)} />
          </label>
          <label className="osField">
            <span>We met on</span>
            <input type="date" value={metOn} onChange={(e) => setMetOn(e.target.value)} />
          </label>
        </div>
        <label className="osField">
          <span>How we met</span>
          <textarea rows={4} value={howWeMet} maxLength={2000} placeholder="It all started when..." onChange={(e) => setHowWeMet(e.target.value)} />
        </label>
        {error && <p className="usError">{error}</p>}
      </div>
    </Dialog>
  )
}

// ---- the timeline ----

const MomentCard = ({ moment, index, focused, onEdit, onDelete, onPhoto }) => {
  const ref = useRef(null)
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [focused])
  const m = moodOf(moment.mood)
  return (
    <li ref={ref} className={`osMoment${index % 2 ? " is-right" : ""}${focused ? " is-focused" : ""}`} style={{ "--tint": m.bg }}>
      <span className="osDot">
        <Sticker mood={moment.mood} size={30} />
      </span>
      <div className="osCard">
        <div className="osDate">{dayLabel(moment.date)}</div>
        <h3 className="osTitle">{moment.title}</h3>
        {moment.location && <div className="osPlace">📍 {moment.location}</div>}
        {moment.text && <p className="osText">{moment.text}</p>}
        {moment.photos.length > 0 && (
          <div className={`osPhotos osPhotos-${moment.photos.length}`}>
            {moment.photos.map((p) => (
              <button key={p.id} type="button" className="osPhotoBtn" onClick={() => onPhoto(p.id)} aria-label="View photo">
                <PhotoThumb id={p.id} className="osPhoto" />
                {p.private && <span className="osLock" title="Private">🔒</span>}
              </button>
            ))}
          </div>
        )}
        <div className="osCardFoot">
          <span>
            by {moment.by}
            {moment.updatedBy && moment.updatedBy !== moment.by ? ` · edited by ${moment.updatedBy}` : ""}
          </span>
          <span className="osCardButtons">
            <button type="button" onClick={onEdit}>
              Edit
            </button>
            <button type="button" onClick={onDelete}>
              Delete
            </button>
          </span>
        </div>
      </div>
    </li>
  )
}

// ---- the slideshow ----

const Slide = ({ slide, active }) => {
  const data = usePhoto(slide.photo)
  return (
    <div className={`osSlide${active ? " is-on" : ""}`} aria-hidden={!active}>
      {slide.photo ? (
        data && <img src={data} alt="" className="osSlideImg" />
      ) : (
        <div className="osSlideCard" style={{ background: moodOf(slide.moment.mood).bg }}>
          <Sticker mood={slide.moment.mood} size={64} />
          <p>{slide.moment.text || slide.moment.title}</p>
        </div>
      )}
    </div>
  )
}

const Slideshow = ({ slides, start = 0, onClose }) => {
  const [index, setIndex] = useState(start)
  const [paused, setPaused] = useState(false)
  const touch = useRef(null)
  const go = (n) => setIndex((i) => (i + n + slides.length) % slides.length)

  useEffect(() => {
    if (paused || slides.length < 2) return
    const t = setTimeout(() => go(1), 5000)
    return () => clearTimeout(t)
  }, [index, paused])

  useEffect(() => {
    // fetch the next picture early so it fades in ready
    const next = slides[(index + 1) % slides.length]
    if (next?.photo) loadPhoto(next.photo)
    const key = (e) => {
      if (e.key === "Escape") onClose()
      if (e.key === "ArrowRight") go(1)
      if (e.key === "ArrowLeft") go(-1)
      if (e.key === " ") setPaused((p) => !p)
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [index])

  const slide = slides[index]
  // over the whole screen, not just this window
  return createPortal(
    <div
      className="osShow"
      role="dialog"
      aria-label="Slideshow"
      onPointerDown={(e) => (touch.current = e.clientX)}
      onPointerUp={(e) => {
        const dx = e.clientX - (touch.current ?? e.clientX)
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1)
        touch.current = null
      }}
    >
      {slides.map((s, i) => (Math.abs(i - index) <= 1 || (index === 0 && i === slides.length - 1) || (index === slides.length - 1 && i === 0) ? <Slide key={s.key} slide={s} active={i === index} /> : null))}
      <div className="osCaption" key={slide.key}>
        <div className="osCaptionTitle">{slide.moment.title}</div>
        <div className="osCaptionMeta">
          {dayLabel(slide.moment.date)}
          {slide.moment.location ? ` · ${slide.moment.location}` : ""}
        </div>
      </div>
      <div className="osShowBar" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Previous" onClick={() => go(-1)}>
          ‹
        </button>
        <button type="button" aria-label={paused ? "Play" : "Pause"} onClick={() => setPaused(!paused)}>
          {paused ? "▶" : "❚❚"}
        </button>
        <button type="button" aria-label="Next" onClick={() => go(1)}>
          ›
        </button>
        <span className="osShowCount">
          {index + 1} / {slides.length}
        </span>
        <button type="button" aria-label="Close slideshow" onClick={onClose}>
          ✕
        </button>
      </div>
    </div>,
    document.body
  )
}

// ---- publishing as a homepage ----

const buildPage = async (story, moments, couple) => {
  const blocks = [
    { type: "heading", text: (story.title || `${couple.me} & ${couple.partner}`).slice(0, 80), size: "h1", align: "center", color: "#c0306a", effect: "shadow" },
    { type: "divider", style: "stars" },
  ]
  if (story.togetherSince) blocks.push({ type: "paragraph", text: `Together since ${dayLabel(story.togetherSince)} ♥`, align: "center", size: "big", bold: true })
  if (story.howWeMet) blocks.push({ type: "heading", text: "How we met", size: "h2", align: "center" }, { type: "paragraph", text: story.howWeMet, align: "center" })
  const shareable = moments.flatMap((m) => m.photos.filter((p) => !p.private).map((p) => ({ moment: m.id, id: p.id }))).slice(0, 8)
  const budget = Math.min(140 * 1024, Math.floor((380 * 1024) / Math.max(1, shareable.length)))
  const pictures = new Map()
  for (const p of shareable) {
    const data = await loadPhoto(p.id)
    if (!data) continue
    pictures.set(p.id, (await shrinkPicture(data, { max: 480, budget })).src)
  }
  for (const m of moments) {
    if (blocks.length > 54) break
    blocks.push({ type: "heading", text: m.title, size: "h3", align: "left" })
    const words = [dayLabel(m.date) + (m.location ? ` · ${m.location}` : ""), m.text].filter(Boolean).join("\n\n")
    blocks.push({ type: "paragraph", text: words.slice(0, 2000), align: "left" })
    for (const p of m.photos) if (pictures.has(p.id) && blocks.length < 58) blocks.push({ type: "image", src: pictures.get(p.id), alt: m.title.slice(0, 100), align: "center" })
  }
  blocks.push({ type: "divider", style: "rainbow" }, { type: "counter", label: "Visitors to our little corner:" })
  return { title: (story.title || "Our Story").slice(0, 60), bg: "hearts", bgColor: "#ffe6ee", text: "#5a1030", link: "#c0306a", font: "comic", sparkle: true, badge: false, blocks }
}

const Publish = ({ story, moments, couple, onClose }) => {
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const privateCount = moments.reduce((n, m) => n + m.photos.filter((p) => p.private).length, 0)
  const publish = async () => {
    setBusy(true)
    setResult(null)
    try {
      const page = await buildPage(story, moments, couple)
      const response = await fetch(`${SERVER_URL}/api/homepage`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${couple.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ page }),
      })
      const r = await response.json()
      setResult(r.ok ? { url: r.url } : { error: r.error })
    } catch (error) {
      setResult({ error: error.message || "Couldn't reach the 98ish web server." })
    }
    setBusy(false)
  }
  if (result?.url)
    return (
      <Dialog title="Published" okLabel="Visit" onOk={() => (openCouples("Internet Explorer", { url: result.url }), onClose())} onCancel={onClose} cancelLabel="Close">
        <p className="dialogText">Our Story is live at {result.url} ♥</p>
      </Dialog>
    )
  return (
    <Dialog title="Publish as Homepage" okLabel={busy ? "Publishing..." : "Publish"} okDisabled={!agree || busy} onOk={publish} onCancel={onClose}>
      <div className="osPublish">
        <p className="dialogText">
          <b>This makes your story public.</b> Anyone on 98ish can visit it at www.98ish.com/~{couple.me.replace(/\s+/g, "").toLowerCase()}, and it replaces your current homepage.
        </p>
        <p className="dialogText">Up to 8 photos go on the page. {privateCount ? `${privateCount} photo${privateCount === 1 ? " is" : "s are"} marked private and will never be published.` : "Mark photos private (🔒) to keep them off it."}</p>
        <div className="field-row">
          <input id="os-agree" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <label htmlFor="os-agree">I understand: make it public</label>
        </div>
        {result?.error && <p className="usError">{result.error}</p>}
      </div>
    </Dialog>
  )
}

// ---- the program ----

const OurStory = ({ focus, mobile }) => {
  const couple = useCouple()
  const now = useNow(60_000)
  const [data, setData] = useState(null)
  const [view, setView] = useState("timeline")
  const [editing, setEditing] = useState(null) // { moment } | { moment: null }
  const [header, setHeader] = useState(false)
  const [show, setShow] = useState(null) // start index
  const [publish, setPublish] = useState(false)
  const [deleting, setDeleting] = useState(null)
  const [focused, setFocused] = useState(focus || null)
  const [error, setError] = useState(null)

  const load = async () => {
    const r = await coupleApi("GET", "/story")
    if (r.ok) setData(r)
    else setError(r.error)
  }
  useEffect(() => {
    if (couple.status === "paired") load()
  }, [couple.status, couple.coupleId])
  useCoupleEvent("couple:story", load)
  useEffect(() => {
    const onView = (e) => e.detail?.program === "Our Story" && e.detail.focus && (setView("timeline"), setFocused(e.detail.focus))
    window.addEventListener(VIEW_EVENT, onView)
    return () => window.removeEventListener(VIEW_EVENT, onView)
  }, [])

  const moments = data?.moments || []
  const slides = useMemo(
    () => moments.flatMap((m) => (m.photos.length ? m.photos.map((p) => ({ key: p.id, photo: p.id, moment: m })) : [{ key: m.id, photo: null, moment: m }])),
    [data]
  )
  const photoSlides = slides.filter((s) => s.photo)

  if (couple.status !== "paired")
    return (
      <div className="osRoot">
        <NotPaired status={couple.status} what="Our Story" />
      </div>
    )
  if (!data)
    return (
      <div className="osRoot">
        <div className="osEmpty">{error || "Opening your story..."}</div>
      </div>
    )

  const story = data.story
  const together = togetherFor(story.togetherSince || data.since, now)

  return (
    <div className={mobile ? "osRoot is-mobile" : "osRoot"}>
      <div className="osToolbar">
        <button type="button" className="usPrimary" onClick={() => setEditing({ moment: null })}>
          + Add moment
        </button>
        <span className="osViews" role="tablist">
          <button type="button" role="tab" aria-selected={view === "timeline"} className={view === "timeline" ? "is-on" : ""} onClick={() => setView("timeline")}>
            Timeline
          </button>
          <button type="button" role="tab" aria-selected={view === "photos"} className={view === "photos" ? "is-on" : ""} onClick={() => setView("photos")}>
            Photos
          </button>
        </span>
        <button type="button" disabled={!slides.length} onClick={() => setShow(0)}>
          ▶ Slideshow
        </button>
        <button type="button" onClick={() => setPublish(true)} disabled={!moments.length}>
          Publish...
        </button>
      </div>

      <div className="osScroll">
        <header className="osHero">
          <TwoHearts size={46} />
          <h1>{story.title || "Our Story"}</h1>
          <div className="osNames">
            {couple.me} &amp; {couple.partner}
          </div>
          {together && (
            <div className="osCounter">
              <TogetherLine together={together} />
            </div>
          )}
          <div className="osMet">
            <div className="osMetLabel">How we met{story.metOn ? ` · ${dayLabel(story.metOn)}` : ""}</div>
            <p>{story.howWeMet || "Tap Edit to write how it all began."}</p>
            <button type="button" onClick={() => setHeader(true)}>
              Edit
            </button>
          </div>
        </header>

        {view === "timeline" &&
          (moments.length ? (
            <ol className="osLine">
              {moments.map((m, i) => (
                <MomentCard
                  key={m.id}
                  moment={m}
                  index={i}
                  focused={focused === m.id}
                  onEdit={() => setEditing({ moment: m })}
                  onDelete={() => setDeleting(m)}
                  onPhoto={(id) => setShow(Math.max(0, slides.findIndex((s) => s.photo === id)))}
                />
              ))}
            </ol>
          ) : (
            <div className="osEmpty">
              <p>Your story starts here. Add your first moment: a first date, a trip, a silly Tuesday.</p>
            </div>
          ))}

        {view === "photos" &&
          (photoSlides.length ? (
            <div className="osGrid">
              {photoSlides.map((s) => (
                <button key={s.key} type="button" className="osGridItem" onClick={() => setShow(slides.indexOf(s))} title={s.moment.title}>
                  <PhotoThumb id={s.photo} className="osGridImg" />
                  {s.moment.photos.find((p) => p.id === s.photo)?.private && <span className="osLock">🔒</span>}
                </button>
              ))}
            </div>
          ) : (
            <div className="osEmpty">No photos yet. Add some to your moments!</div>
          ))}
      </div>

      {editing && (
        <MomentEditor
          moment={editing.moment}
          onCancel={() => setEditing(null)}
          onSaved={(m) => {
            setEditing(null)
            setFocused(m.id)
            load()
          }}
        />
      )}
      {header && (
        <HeaderEditor
          story={story}
          onCancel={() => setHeader(false)}
          onSaved={() => {
            setHeader(false)
            load()
          }}
        />
      )}
      {deleting && (
        <Dialog
          title="Delete Moment"
          okLabel="Delete"
          onOk={async () => {
            const r = await coupleApi("DELETE", `/moments/${deleting.id}`)
            setDeleting(null)
            if (!r.ok) setError(r.error)
            load()
          }}
          onCancel={() => setDeleting(null)}
        >
          <p className="dialogText">Delete "{deleting.title}" and its photos for both of you?</p>
        </Dialog>
      )}
      {publish && <Publish story={story} moments={moments} couple={couple} onClose={() => setPublish(false)} />}
      {show !== null && slides.length > 0 && <Slideshow slides={slides} start={Math.min(show, slides.length - 1)} onClose={() => setShow(null)} />}
    </div>
  )
}

export default OurStory
