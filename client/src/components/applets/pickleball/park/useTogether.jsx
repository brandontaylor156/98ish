import React, { useEffect, useMemo, useRef, useState } from "react"
import MoreOptions from "../../../shared/MoreOptions"
import { coupleApi, useCouple } from "../../../../utils/couple.js"
import { addToAlbum, getAlbumsState } from "../../../../utils/albums.js"
import { STOP_LABEL, TOGETHER, dateTime, memoryFor, nameKey, pickAlbum, togetherById } from "./together.js"
import "./together.css"

// My Park > Together (the owner: "Me and my girlfriend. Add some other fun stuff at the venues
// that me and her can do together."): one Together button when your partner or a buddy is
// near, a small sheet of things to do, the ask card ("Ava wants to hold hands · Yes / Not now"),
// chips to stop what's going on, the selfie's countdown and its keepsake, and the memories
// that go to Lovebirds' Our Story (server/couples POST /api/couples/park) when it's your partner.
//
// useTogether({ world, hud (the park HUD's tg), venueName, nightOk, prefs, setPrefs, aim,
// active }) -> { button, overlays, onEvent(ev) -> handled?, rallyDone(best) }

const lc = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s)

export const useTogether = ({ world, hud, venueName = "My Park", nightOk = false, prefs, setPrefs, aim, active = true }) => {
  const couple = useCouple()
  const partner = couple.status === "paired" ? couple.partner : null
  const partnerKey = partner ? nameKey(partner) : null
  // your partner and your buddies count as friends here (the Together button shows near them)
  const friends = useMemo(() => {
    const out = new Set()
    for (const g of aim?.me?.groups || []) for (const b of g.buddies || []) out.add(nameKey(b))
    if (partnerKey) out.add(partnerKey)
    out.delete("smarterchild")
    return [...out]
  }, [aim?.me?.groups, partnerKey])
  useEffect(() => {
    world?.setFriends?.(friends)
  }, [world, friends])

  const tg = hud?.tg || null
  const [sheet, setSheet] = useState(false)
  const [asks, setAsks] = useState([]) // asks to you: [{ id, from, name, kind, at }]
  const [pending, setPending] = useState(null) // your ask: { id, kind, name }
  const [note, setNote] = useState(null) // { text, id }
  const [photo, setPhoto] = useState(null) // the selfie's card: { url, lines: [] }
  const [best, setBest] = useState(null) // the couple's best rally
  const dateRef = useRef(null) // the time of day and music before date night
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  const say = (text) => setNote({ text, id: Date.now() + Math.random() })
  useEffect(() => {
    if (!note) return
    const id = setTimeout(() => setNote((n) => (n?.id === note.id ? null : n)), 3800)
    return () => clearTimeout(id)
  }, [note])
  // asks go after 30 s (the server forgets them then too)
  useEffect(() => {
    if (!asks.length) return
    const id = setTimeout(() => setAsks((list) => list.filter((a) => Date.now() - a.at < 30_000)), 1000)
    return () => clearTimeout(id)
  }, [asks])
  useEffect(() => {
    if (!pending) return
    const id = setTimeout(() => setPending((p) => (p === pending ? null : p)), 31_000)
    return () => clearTimeout(id)
  }, [pending])
  // left the park: nothing's waiting any more; date night's look goes back
  useEffect(() => {
    if (active) return
    setSheet(false)
    setAsks([])
    setPending(null)
    endDate()
  }, [active])

  const isPartner = (name) => !!partnerKey && nameKey(name) === partnerKey
  const remember = async (kind, extra = {}) => {
    try {
      return await coupleApi("POST", "/park", { memory: memoryFor(kind, { venue: venueName, ...extra }) })
    } catch {
      return { ok: false }
    }
  }
  const startDate = (name, night) => {
    const p = prefsRef.current
    if (!dateRef.current) dateRef.current = { tod: p.tod, parkMusic: !!p.parkMusic }
    setPrefs({ tod: dateTime(night && nightOk), parkMusic: true })
    say(`Date night with ${name} ♥`)
    if (isPartner(name)) remember("datenight")
  }
  function endDate(name = "") {
    const was = dateRef.current
    if (!was) return
    dateRef.current = null
    setPrefs({ tod: was.tod, parkMusic: was.parkMusic })
    if (name) say(`${name} ended date night.`)
  }

  // the selfie: made into a keepsake, saved to your Photos, and (the one who asked) to your shared
  // album and Our Story
  const keepSelfie = async ({ url, golden, with: name, asker }) => {
    if (!url) return say("The picture didn't come out. Try again?")
    const { composeSelfie } = await import("./selfie.js")
    const now = new Date()
    const me = aim?.me?.screenName || "Me"
    const when = now.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    let shot
    try {
      shot = await composeSelfie(url, { title: `${me} & ${name}`, line: `${venueName} · ${when}${golden ? " · golden hour" : ""}`, golden })
    } catch {
      return say("The picture didn't come out. Try again?")
    }
    const lines = []
    try {
      const lib = await import("../../photos/library.js")
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}.${String(now.getMinutes()).padStart(2, "0")}`
      const r = await lib.savePicture(lib.picturesFolder(), `Selfie with ${name} at ${venueName} ${stamp}.jpg`.replace(/[\\/:*?"<>|]/g, ""), shot.full)
      lines.push(r.ok ? "Saved to My Pictures (Photos)" : r.error || "Couldn't save it to My Pictures")
    } catch {
      lines.push("Couldn't save it to My Pictures")
    }
    if (asker) {
      const album = pickAlbum(getAlbumsState().albums, nameKey(me), nameKey(name))
      if (album && shot.blob) {
        const r = await addToAlbum(album.id, [{ blob: shot.blob, name: `Selfie at ${venueName}.jpg` }], { caption: `At ${venueName}` })
        lines.push(r.ok ? `Added to "${album.name}"` : `Couldn't add it to "${album.name}"`)
      }
      if (isPartner(name)) {
        const r = await remember("selfie", { photo: shot.thumb, golden })
        lines.push(r.ok ? "In Our Story" : r.error ? `Our Story: ${r.error}` : "Our Story didn't get it")
      }
    } else lines.push(`${name} keeps it in your shared album`)
    setPhoto({ url: shot.full, lines, golden })
  }

  // ---- the world's together news (world.js onEvent) ----
  const onEvent = (ev) => {
    switch (ev.type) {
      case "tgAsk":
        setAsks((list) => [...list.filter((a) => a.from !== ev.from), { ...ev, at: Date.now() }])
        return true
      case "tgAnswer":
        setPending((p) => (p && p.id === ev.id ? null : p))
        if (!ev.yes) say(ev.error || `${ev.name || "They"} said not now.`)
        return true
      case "tgLink":
        if (ev.kind === "hand") say(ev.lead ? `Holding hands with ${ev.name}. Walk anywhere.` : `Holding hands with ${ev.name}. Your own stick lets go.`)
        else say(ev.lead ? `${ev.name} is following you.` : `Following ${ev.name}. Your own stick stops it.`)
        return true
      case "tgNote":
        if (ev.text) say(ev.text)
        return true
      case "tgStart":
        if (ev.kind === "date") startDate(ev.name, !!ev.data?.night)
        else if (ev.kind === "sunset") {
          say(`Watching the sunset with ${ev.name}. Stand up to leave.`)
          if (isPartner(ev.name)) remember("sunset")
        } else if (ev.kind === "sit") say(`Sitting with ${ev.name}.`)
        return true
      case "tgEnd":
        if (ev.kind === "date") endDate(ev.mine ? "" : ev.name || "They")
        else if (ev.kind === "sunset" && ev.name) say(`${ev.name} stood up.`)
        else if (ev.kind === "selfie" && ev.name) say(`${ev.name} canceled the picture.`)
        return true
      case "selfie":
        keepSelfie(ev)
        return true
      default:
        return false
    }
  }

  // a co-op rally game ended (Pickleball.jsx): the couple's best
  const rallyDone = async (streak) => {
    if (!(streak > 0)) return
    const r = partner ? await remember("rally", { streak }) : null
    if (r?.ok && r.record) {
      setBest(r.best)
      say(`New record together: ${streak} in a row! It's in Our Story.`)
    } else if (r?.ok) say(`Best this time: ${streak}. Your record: ${r.best}.`)
    else say(`Best rally this time: ${streak} in a row.`)
  }

  const pal = tg?.pal || null
  const palIsPartner = pal && isPartner(pal.name)
  useEffect(() => {
    if (!sheet || !palIsPartner) return
    coupleApi("GET", "/park").then((r) => r?.ok && setBest(r.best || 0), () => {})
  }, [sheet, palIsPartner])

  const ask = async (kind) => {
    const who = pal || (tg?.link ? { num: tg.link.num, name: tg.link.name } : null)
    if (!world || !who) return
    if (kind === "date" && tg?.date) {
      world.tgStop("date")
      setSheet(false)
      return
    }
    setSheet(false)
    const r = await world.tgAsk(kind, who.num, kind === "date" ? { night: !!nightOk } : null)
    if (r?.ok) {
      setPending({ id: r.id, kind, name: who.name })
      say(`Asked ${who.name}...`)
    } else say(r?.error || "That didn't work. Please try again.")
  }
  const answer = async (a, yes) => {
    setAsks((list) => list.filter((x) => x.id !== a.id))
    const r = await world?.tgAnswer(a.id, yes)
    if (yes && r && !r.ok) say(r.error || "That didn't work.")
  }

  // ---- what's on screen ----
  const stops = []
  if (tg?.link) stops.push({ kind: tg.link.kind, label: `${tg.link.kind === "hand" ? "🤝" : "👣"} ${tg.link.kind === "follow" && tg.link.lead ? "Stop" : STOP_LABEL[tg.link.kind]}`, sub: tg.link.kind === "follow" && tg.link.lead ? `${tg.link.name} follows you` : tg.link.name })
  if (tg?.date) stops.push({ kind: "date", label: `🌙 ${STOP_LABEL.date}`, sub: tg.date.name })
  // (the sunset ends with the park's own Stand up button)
  if (tg?.emote === "dance") stops.push({ kind: "dance", label: `🕺 ${STOP_LABEL.dance}` })
  if (tg?.selfie && !tg.selfie.flash) stops.push({ kind: "selfie", label: STOP_LABEL.selfie })
  const canOpen = !!(pal || tg?.link || tg?.date)
  const button =
    tg && (canOpen || stops.length) ? (
      <div className="pkTgCol" data-together="col">
        {stops.map((s) => (
          <button type="button" key={s.kind} className="pkTgStop" onClick={() => world?.tgStop(s.kind)} data-together={`stop-${s.kind}`}>
            <b>{s.label}</b>
            {s.sub && <small>{s.sub}</small>}
          </button>
        ))}
        {canOpen && (
          <button type="button" className="pkTgBtn" onClick={() => setSheet(true)} data-together="open" aria-label={`Together with ${pal?.name || tg?.link?.name || tg?.date?.name}`}>
            <span aria-hidden="true">💞</span>
            <b>Together</b>
            <small>{pal?.name || tg?.link?.name || tg?.date?.name}</small>
          </button>
        )}
      </div>
    ) : null

  const who = pal?.name || tg?.link?.name || tg?.date?.name || ""
  const item = (t, big) => (
    <button type="button" key={t.id} className={`pkTgItem${big ? " is-big" : ""}${t.id === "date" && tg?.date ? " is-on" : ""}`} onClick={() => ask(t.id)} disabled={!!pending} data-together={`do-${t.id}`}>
      <span className="pkTgIcon" aria-hidden="true">
        {t.icon}
      </span>
      <b>{t.id === "date" && tg?.date ? "End date night" : t.id === "follow" ? `Follow ${who}` : t.label}</b>
      {big && t.sub && <small>{t.id === "rally" && best ? `Your best: ${best}` : t.sub}</small>}
    </button>
  )
  const overlays = (
    <>
      {sheet && (
        <div className="pkCenter pkDim pkTgSheetWrap" onClick={(e) => e.target === e.currentTarget && setSheet(false)}>
          <div className="pkPanel window pkTgSheet" data-together="sheet" role="dialog" aria-label={`Together with ${who}`}>
            <div className="pkParkMenuHead">
              <b>Together with {who}</b>
              <button type="button" className="pkParkVenuesX" onClick={() => setSheet(false)} aria-label="Close" data-together="close">
                ×
              </button>
            </div>
            <div className="pkTgGrid">{TOGETHER.filter((t) => t.base).map((t) => item(t, true))}</div>
            <MoreOptions id="pickleball.together" summary="Rally, sit, sunset, follow, high five, hug, twirl, dance">
              <div className="pkTgGrid is-small">
                {TOGETHER.filter((t) => !t.base).map((t) => item(t, t.id === "rally"))}
              </div>
            </MoreOptions>
            <p className="pkTgHint">{who} gets asked first. Either of you can stop any time.</p>
          </div>
        </div>
      )}
      {asks[0] && !sheet && (
        <div className="pkPanel pkTgAsk" role="alertdialog" aria-label="An ask" data-together="ask" data-kind={asks[0].kind}>
          <p>
            <span aria-hidden="true">{togetherById(asks[0].kind)?.icon || "💞"} </span>
            {togetherById(asks[0].kind)?.ask(asks[0].name) || `${asks[0].name} asks you`}
          </p>
          <div className="pkTgAskRow">
            <button type="button" className="pkPrimary" onClick={() => answer(asks[0], true)} data-together="yes">
              Yes
            </button>
            <button type="button" onClick={() => answer(asks[0], false)} data-together="no">
              Not now
            </button>
          </div>
        </div>
      )}
      {tg?.selfie && (
        <div className={`pkTgSelfie${tg.selfie.flash ? " is-flash" : ""}`} aria-live="polite" data-together="selfie-count">
          {!tg.selfie.flash && (
            <>
              <b>{tg.selfie.left || "📸"}</b>
              <small>Say cheese!</small>
            </>
          )}
        </div>
      )}
      {note && !asks[0] && <div className="pkTgNote" role="status" data-together="note">{note.text}</div>}
      {photo && (
        <div className="pkCenter pkDim" onClick={(e) => e.target === e.currentTarget && setPhoto(null)}>
          <div className="pkPanel window pkTgPhoto" data-together="photo">
            <img src={photo.url} alt="Your selfie together" />
            <ul>
              {photo.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <button type="button" className="pkPrimary" onClick={() => setPhoto(null)} data-together="photo-close">
              Nice!
            </button>
          </div>
        </div>
      )}
    </>
  )
  return { button, overlays, onEvent, rallyDone, pending: pending ? lc(togetherById(pending.kind)?.label || "") : null }
}
