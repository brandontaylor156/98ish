import React, { useEffect, useRef, useState } from "react"
import MoreOptions from "../../../../shared/MoreOptions"
import { useNet } from "../../../network/NetContext"
import { unlock } from "../../../../../utils/achievements"
import { getBank, formatChips } from "../../../casino/bank.js"
import { costOf, itemById, itemName, menuFor, pay, sip as sipOnce, startHolding, verbFor } from "./menu.js"
import { fmtTime, lapLengths } from "./swimRun.js"
import { tubPair } from "./tubRun.js"
import "./leisure.css"

// My Park leisure (the owner: "Swimming wherever there are pools", "Hanging out at the hot tub",
// "Ordering food at the bar or drinks or at the clubhouse/restaurant", and the vending machine
// easter egg): the context button at a pool's edge, the hot tub, a counter or the drinks machine
// opens a small sheet here; a swim or a soak runs as an activity in the park (world.setActivity,
// swimRun.js / tubRun.js) with its own small screen; what you buy is in your hand (a chip above
// the context button: Sip / Bite). With your partner or a buddy near you: swim together or race,
// the hot tub side by side, a treat bought for them (Together's ask: server/park/together.js).
//
// useLeisure({ world, prefs, setPrefs, mobile, showPad, padSide, aim, onDrive })
//   -> { onEvent(ev) -> handled?, overlays, chip, running, sheetOpen }

export const SUNDOWNER = { name: "Sundowner GT", key: "roam.unlocks" }
const ROAM_UNLOCKS = "98ish.roam.unlocks"
// (the keys also unlock the car in Explore Valencia, which reads this per-user key through its
// host, roam/host98.js)
export const writeRoamUnlock = (id, at = Date.now()) => {
  try {
    const cur = JSON.parse(localStorage.getItem(ROAM_UNLOCKS) || "{}") || {}
    if (!cur[id]) {
      cur[id] = at
      localStorage.setItem(ROAM_UNLOCKS, JSON.stringify(cur))
    }
  } catch {
    // (storage blocked: the account's copy still has it)
  }
}

// a pool's best time key: venue + pool
const bestKey = (world, spot) => `${world?.venue || world?.layout?.id || "park"}:${spot.id}`

export const useLeisure = ({ world, prefs, setPrefs, mobile = false, showPad = false, padSide = "left", aim = null, onDrive = null }) => {
  const net = useNet()
  const [sheet, setSheet] = useState(null) // { spot, pal }
  const [both, setBoth] = useState(false) // (buy one for the friend near you too)
  const [run, setRun] = useState(null)
  const [hud, setHud] = useState(null)
  const [held, setHeldState] = useState(null) // { id, left }
  const [note, setNote] = useState(null)
  const [keys, setKeys] = useState(null) // the found card
  const [bal, setBal] = useState(() => getBank().balance)
  const runRef = useRef(null)
  runRef.current = run
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs
  const pendingTreat = useRef(null) // { item, name }
  const musicWas = useRef(null)
  const say = (text, sec = 3.6) => setNote({ text, id: Date.now(), sec })
  useEffect(() => {
    if (!note) return
    const id = setTimeout(() => setNote((n) => (n?.id === note.id ? null : n)), note.sec * 1000)
    return () => clearTimeout(id)
  }, [note])
  useEffect(() => getBank().subscribe((d) => setBal(d.balance)), [])
  // (a new venue, or out of the park: nothing in your hand, nothing running)
  useEffect(() => {
    setSheet(null)
    setHeldState(null)
    if (!world) stopRun(false)
  }, [world])
  useEffect(() => () => stopRun(false), [])
  // what you've found, for Vince (he only hands over keys once), and from the account when
  // you're signed on (server/park/finds.js)
  useEffect(() => {
    world?.setFinds?.(prefs.parkFinds || {})
  }, [world, prefs.parkFinds])
  const signedOn = aim?.status === "online"
  useEffect(() => {
    if (!world || !signedOn || !net?.request) return
    let live = true
    net
      .request("park:finds", {})
      .then((r) => {
        if (!live || !r?.ok) return
        const mine = prefsRef.current.parkFinds || {}
        const merged = { ...r.finds, ...mine }
        if (JSON.stringify(merged) !== JSON.stringify(mine)) setPrefs({ parkFinds: merged })
        if (merged.keys) writeRoamUnlock("sundowner", merged.keys.at)
        // (found here before signing on: the account keeps it too)
        if (mine.keys && !r.finds?.keys) net.request("park:find", { id: "keys", venue: mine.keys.venue || null })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [world, signedOn])

  // ---- holding something ----
  const hold = (id) => {
    const h = startHolding(id)
    setHeldState(h)
    world?.leisure?.setHeld(h ? h.id : null)
  }
  const doSip = () => {
    if (!held || !world) return
    world.leisure.sip()
    const next = sipOnce(held)
    if (!next) {
      // (the last one: the sip shows, then it's gone)
      setTimeout(() => {
        world.leisure.setHeld(null)
        setHeldState((h) => (h?.id === held.id ? null : h))
      }, 1700)
      say(`${verbFor(held.id) === "Sip" ? "All gone" : "That was good"}. ${itemById(held.id)?.kind === "food" ? "Yum." : "Refreshing."}`, 2.6)
      setHeldState({ ...held, left: 0 })
    } else setHeldState(next)
  }

  // ---- buying ----
  const buy = async (item, spot, pal) => {
    const bank = getBank()
    const r = pay(bank, item, "me")
    if (!r.ok) return say(r.error)
    hold(item.id)
    setSheet(null)
    setPrefs({ leisure: { ...(prefsRef.current.leisure || {}), orders: ((prefsRef.current.leisure || {}).orders || 0) + 1 } })
    if (r.refilled) say("The house topped up your chips.", 2.6)
    if (both && pal && world) {
      const ask = await world.tgAsk("treat", pal.num, { item: item.id })
      if (ask?.ok) {
        pendingTreat.current = { item: item.id, name: pal.name }
        say(`One ${itemName(item.id).toLowerCase()} for you; asked ${pal.name} if they'd like one too (${item.price} chips if they say yes).`)
      } else say(ask?.error || `${pal.name} couldn't be asked just now.`)
    } else say(`${itemName(item.id)}: ${item.price} chips. ${verbFor(item.id)} it with the button.`, 3)
  }

  // ---- the runs ----
  const startRun = async (spot, opts = {}) => {
    if (!world || !spot) return
    setSheet(null)
    stopRun(false)
    // (you put down what you were holding to get in the water)
    if (held) {
      world.leisure.setHeld(null)
      setHeldState(null)
    }
    await world.leisure.waterReady
    let r = null
    try {
      const at = world.info?.me || null
      if (spot.kind === "swim") {
        const { createSwimRun } = await import("./swimRun.js")
        const k = bestKey(world, spot)
        r = createSwimRun({
          spot,
          side: world.leisure,
          from: at ? { x: at.x, z: at.z } : null,
          mode: opts.mode || "swim",
          pal: opts.pal || null,
          lane: opts.lane ?? null,
          best: prefsRef.current.leisure?.best?.[k] || null,
          onLap: (ms, race) => {
            const L = prefsRef.current.leisure || {}
            const bestNow = L.best?.[k]
            if (!bestNow || ms < bestNow) setPrefs({ leisure: { ...L, best: { ...(L.best || {}), [k]: ms } } })
            if (race) net?.request?.("park:fx", { lap: ms })
          },
          onSplash: () => {
            net?.request?.("park:fx", { emote: "splash" })
            unlock("park-cannonball")
          },
        })
      } else if (spot.kind === "tub") {
        const { createTubRun, pickTubSeat } = await import("./tubRun.js")
        const taken = (seat) => world.leisure.seatTaken?.(seat) || false
        const seat = pickTubSeat(spot, at || spot.at, taken, opts.seat || null)
        r = createTubRun({ spot, side: world.leisure, seat, pal: opts.pal || null, from: spot.at })
        // the hangout's lo-fi while you soak (back as it was after)
        if (musicWas.current === null) musicWas.current = !!prefsRef.current.parkMusic
        if (!prefsRef.current.parkMusic) setPrefs({ parkMusic: true })
      }
    } catch (e) {
      console.error(e)
      say("That didn't load. Please try again.")
      return
    }
    if (!r) return
    r.unsub = r.subscribe((h) => setHud(h))
    world.setActivity(r)
    setRun(r)
    const L = prefsRef.current.leisure || {}
    if (spot.kind === "swim") setPrefs({ leisure: { ...L, swims: (L.swims || 0) + 1 } })
    if (spot.kind === "tub") setPrefs({ leisure: { ...L, soaks: (L.soaks || 0) + 1 } })
  }
  function stopRun(save = true) {
    const r = runRef.current
    if (!r) return
    runRef.current = null
    void save
    r.unsub?.()
    if (world?.activity === r) world.setActivity(null)
    if (r.kind === "tub" && musicWas.current !== null) {
      if (!musicWas.current) setPrefs({ parkMusic: false })
      musicWas.current = null
    }
    setRun(null)
    setHud(null)
  }

  // ---- with a friend ----
  const askPal = async (kind, pal, data) => {
    setSheet(null)
    const r = await world?.tgAsk(kind, pal.num, data)
    if (r?.ok) say(`Asked ${pal.name}...`, 2.4)
    else say(r?.error || "That didn't work. Please try again.")
  }

  const choose = (item) => {
    const s = sheet
    if (!s) return
    const spot = s.spot
    if (item.id === "swim" || item.id === "cannonball" || item.id === "laps") return startRun(spot, { mode: item.id })
    if (item.id === "tub") return startRun(spot, {})
    if (item.id === "pal:swim" || item.id === "pal:race") return askPal("swim", s.pal, { spot: spot.id, mode: item.id === "pal:race" ? "race" : "together" })
    if (item.id === "pal:tub") {
      const pair = tubPair(spot, world.info?.me || spot.at, (seat) => world.leisure.seatTaken?.(seat) || false)
      if (!pair) return say("There aren't two seats free in the hot tub just now.")
      return askPal("tub", s.pal, { spot: spot.id, seats: pair })
    }
  }

  const onEvent = (ev) => {
    switch (ev.type) {
      case "leisure":
        if (runRef.current) return true
        setBoth(false)
        setSheet({ spot: ev.spot, pal: ev.pal || null })
        return true
      case "leisureGive":
        setHeldState(null)
        say(`You gave Vince your ${itemName(ev.item).toLowerCase()}.`, 2.4)
        return true
      case "leisureKeys": {
        const f = { ...(prefsRef.current.parkFinds || {}) }
        const fresh = !f.keys
        if (fresh) f.keys = { at: Date.now(), venue: ev.venue || null }
        setPrefs({ parkFinds: f })
        writeRoamUnlock("sundowner")
        unlock("park-keys")
        if (signedOn) net?.request?.("park:find", { id: "keys", venue: ev.venue || null })
        setKeys({ from: ev.from || "Vince", fresh })
        return true
      }
      case "leisureLap":
        if (runRef.current?.kind === "swim") {
          runRef.current.otherLap?.(ev.name, ev.ms)
          say(`${ev.name}: ${fmtTime(ev.ms)}`, 5)
        }
        return true
      case "tgStart": {
        if (!["swim", "tub", "treat"].includes(ev.kind)) return false
        const spots = world?.leisure?.spots || []
        if (ev.kind === "treat") {
          const it = itemById(ev.data?.item)
          if (!it) return true
          if (ev.asker) {
            // (they said yes: now it's paid for)
            const r = pay(getBank(), it, "me")
            pendingTreat.current = null
            say(r.ok ? `${ev.name} said yes: a ${itemName(it.id).toLowerCase()} for ${ev.name} (${costOf(it)} chips).` : `${ev.name} said yes, but ${r.error}`)
          } else {
            hold(it.id)
            say(`${ev.name} bought you a ${itemName(it.id).toLowerCase()}!`)
          }
          return true
        }
        const spot = spots.find((s) => s.id === ev.data?.spot)
        if (!spot) {
          say("That's not at this venue.")
          return true
        }
        const pal = { num: ev.num, name: ev.name }
        if (ev.kind === "swim") {
          // (a race: side by side, the asker's lane and the next one)
          const mode = ev.data?.mode === "race" && spot.laps ? "race" : "swim"
          startRun(spot, { mode, pal, lane: mode === "race" ? (ev.asker ? 0 : 1) : null })
        } else startRun(spot, { pal, seat: ev.data?.seats?.[ev.asker ? 0 : 1] || null })
        return true
      }
      case "tgAnswer":
        if (!ev.yes && pendingTreat.current) {
          say(`${pendingTreat.current.name} said not now: nothing paid for theirs.`)
          pendingTreat.current = null
          return true
        }
        return false
      default:
        return false
    }
  }

  // ---- what each sheet offers ----
  const bests = prefs.leisure?.best || {}
  const sh = sheet ? sheetFor(sheet.spot, { pal: sheet.pal, best: bests[bestKey(world, sheet.spot)] || null }) : null
  const menu = sheet && (sheet.spot.kind === "order" || sheet.spot.kind === "vending") ? menuFor(sheet.spot) : null
  const overlays = (
    <>
      {sheet && (
        <div className="pkCenter pkDim pkTgSheetWrap" onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className="pkPanel window pkTgSheet pkLsSheet" data-leisure="sheet" data-kind={sheet.spot.kind} role="dialog" aria-label={sheet.spot.name}>
            <div className="pkParkMenuHead">
              <b>{sheet.spot.name}</b>
              <button type="button" className="pkParkVenuesX" onClick={() => setSheet(null)} aria-label="Close" data-leisure="close">
                ×
              </button>
            </div>
            {sh && (
              <div className="pkTgGrid">
                {sh.items.map((it) => (
                  <button type="button" key={it.id} className="pkTgItem is-big" onClick={() => choose(it)} data-leisure={`do-${it.id}`}>
                    <span className="pkTgIcon" aria-hidden="true">
                      {it.icon}
                    </span>
                    <b>{it.label}</b>
                    {it.sub && <small>{it.sub}</small>}
                  </button>
                ))}
              </div>
            )}
            {menu && (
              <>
                <p className="pkLsChips" data-leisure="chips">
                  {`${sheet.spot.kind === "vending" ? "Cold drinks" : "Today's menu"} · you have ${formatChips(bal)} chips`}
                </p>
                <ul className="pkLsMenu">
                  {menu.map((it) => (
                    <li key={it.id}>
                      <button type="button" onClick={() => buy(it, sheet.spot, sheet.pal)} data-leisure={`buy-${it.id}`}>
                        <span className="pkLsIcon" aria-hidden="true">
                          {it.icon}
                        </span>
                        <span className="pkLsName">{it.name}</span>
                        <span className="pkLsPrice">{both && sheet.pal ? `${it.price} + ${it.price}` : it.price}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {sheet.pal && (
                  <label className="pkLsBoth">
                    <input type="checkbox" checked={both} onChange={(e) => setBoth(e.target.checked)} data-leisure="both" /> One for {sheet.pal.name} too
                  </label>
                )}
                <MoreOptions id="pickleball.leisure.menu" summary="About the prices">
                  <p className="pkTgHint">Prices are in Casino 98's play chips (the same bank as the casino games; no real money). Run low and the house tops you up.</p>
                </MoreOptions>
              </>
            )}
            {sh?.hint && <p className="pkTgHint">{sh.hint}</p>}
          </div>
        </div>
      )}
      {run && hud && (
        <LeisureHud
          run={run}
          hud={hud}
          showPad={showPad}
          padSide={padSide}
          onLeave={() => stopRun(true)}
          music={!!prefs.parkMusic}
          onMusic={() => setPrefs({ parkMusic: !prefs.parkMusic })}
        />
      )}
      {keys && <KeysCard keys={keys} onClose={() => setKeys(null)} onDrive={onDrive ? () => (setKeys(null), onDrive()) : null} />}
      {note && <div className="pkTgNote pkLsNote" role="status" data-leisure="note">{note.text}</div>}
    </>
  )
  // the chip above the context button while you hold something: Sip / Bite, or put it down
  const chip =
    held && !run ? (
      <div className="pkLsHeld" data-leisure="held">
        <span className="pkLsHeldName">
          <span aria-hidden="true">{itemById(held.id)?.icon}</span> {itemName(held.id)}
        </span>
        <button type="button" className="pkLsSip" onClick={doSip} disabled={held.left <= 0} data-leisure="sip">
          {verbFor(held.id)}
        </button>
        <button
          type="button"
          className="pkLsDrop"
          onClick={() => {
            world?.leisure?.setHeld(null)
            setHeldState(null)
          }}
          aria-label="Put it down"
          data-leisure="drop"
        >
          ×
        </button>
      </div>
    ) : null
  return { onEvent, overlays, chip, running: !!run, kind: run?.kind || null, sheetOpen: !!sheet, held, stop: () => stopRun(true) }
}

// what a pool's or the hot tub's sheet offers (pal: a friend near you, by name)
export const sheetFor = (spot, { pal = null, best = null } = {}) => {
  if (!spot) return null
  if (spot.kind === "swim")
    return {
      items: [
        { id: "swim", icon: "🏊", label: "Swim", sub: "Get in here" },
        { id: "cannonball", icon: "💥", label: "Cannonball!", sub: "Off the edge" },
        ...(spot.laps ? [{ id: "laps", icon: "⏱", label: lapLengths(spot) > 1 ? "Swim laps" : "Swim a length", sub: best ? `Your best: ${fmtTime(best)}` : `${Math.round(spot.len * lapLengths(spot))} m against the clock` }] : []),
        ...(pal ? [{ id: "pal:swim", icon: "💞", label: `Swim with ${pal.name}`, sub: "In the pool together" }] : []),
        ...(pal && spot.laps ? [{ id: "pal:race", icon: "🏁", label: `Race ${pal.name}`, sub: "Side by side, lane by lane" }] : []),
      ],
      hint: "Push the move pad to swim; let go to tread water. Get out with the button at the top.",
    }
  if (spot.kind === "tub")
    return {
      items: [{ id: "tub", icon: "♨", label: "Get in", sub: "Sit back and relax" }, ...(pal ? [{ id: "pal:tub", icon: "💞", label: `With ${pal.name}`, sub: "Side by side" }] : [])],
      hint: null,
    }
  return null
}

// the screen while you swim or soak: where you are and Get out up top, the move pad along the
// bottom (swimming), Float / Laps, the clock for laps, the music in the tub
const LeisureHud = ({ run, hud, showPad, padSide, onLeave, music, onMusic }) => {
  const swim = hud.kind === "swim"
  const L = hud.laps
  const big = swim ? (L ? (L.countdown ? String(L.countdown) : fmtTime(L.ms)) : hud.floating ? "🛟 Floating" : "🏊 Swimming") : "♨ Hot tub"
  const small = swim ? (L ? `${L.race ? `Race${hud.pal ? ` vs ${hud.pal}` : ""} · ` : ""}length ${Math.min(L.lengths, L.done + 1)} of ${L.lengths}${L.best ? ` · best ${fmtTime(L.best)}` : ""}` : hud.pal ? `With ${hud.pal}` : "Push the pad to swim") : hud.pal ? `With ${hud.pal}` : "Bubbles on"
  return (
    <div className={`pkAct pkAct--${hud.kind}${showPad ? " is-touch" : ""}`} data-leisure-kind={hud.kind}>
      <div className="pkActTop">
        <div className="pkActScore" data-leisure="score">
          <small className="pkActWhere">{hud.title}</small>
          <b>{big}</b>
          {small && <small>{small}</small>}
        </div>
        <button type="button" className="pkActLeave" onClick={onLeave} data-leisure="leave">
          Get out
        </button>
      </div>
      {swim && showPad && <div className={`pkActMove pkActMove--${padSide}`} data-control="move" data-touch-surface aria-label="Move pad" />}
      <div className="pkLsBtns">
        {swim && !L && hud.phase === "swim" && (
          <button type="button" onClick={() => run.toggleFloat()} data-leisure="float">
            {hud.floating ? "Swim" : "Float"}
          </button>
        )}
        {swim && !L && hud.canLaps && hud.phase === "swim" && (
          <button type="button" onClick={() => run.laps(false)} data-leisure="laps">
            {hud.lengths > 1 ? "Laps" : "A length"}
          </button>
        )}
        {!swim && (
          <button type="button" onClick={onMusic} data-leisure="music" aria-pressed={music}>
            ♪ {music ? "Music on" : "Music off"}
          </button>
        )}
      </div>
      {hud.note && <div className="pkActWord" data-leisure="word">{hud.note}</div>}
      {swim && L?.finished && (
        <div className="pkCenter pkDim pkActEndWrap">
          <div className="pkPanel window pkActEnd" data-leisure="end">
            <b className="pkWin">{fmtTime(L.ms)}</b>
            <p className="pkFinal2">{L.best === L.ms ? "Your best yet!" : `Your best: ${fmtTime(L.best)}`}</p>
            {L.race && <p className="pkFinal2" data-leisure="race">{L.other ? `${L.other.name}: ${fmtTime(L.other.ms)} · ${L.other.ms > L.ms ? "you won!" : L.other.ms < L.ms ? `${L.other.name} won` : "a dead heat"}` : `${hud.pal || "They"}: still swimming...`}</p>}
            <div className="pkActEndRow">
              <button type="button" className="pkPrimary" onClick={() => run.again()} data-leisure="again">
                Again
              </button>
              <button type="button" onClick={() => run.freeSwim()} data-leisure="free">
                Swim about
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Found: Vince's car keys
const KeysCard = ({ keys, onClose, onDrive }) => (
  <div className="pkCenter pkDim pkLsKeysWrap">
    <div className="pkPanel window pkLsKeys" data-leisure="keys" role="dialog" aria-label="Found: car keys">
      <div className="title-bar">
        <div className="title-bar-text">Found!</div>
      </div>
      <div className="pkLsKeysBody">
        <span className="pkLsKeysIcon" aria-hidden="true">
          🔑
        </span>
        <b>{keys.from}'s car keys</b>
        <p>{keys.fresh ? `${keys.from} handed you the keys to his car, the ${SUNDOWNER.name}. It's parked in the Paseo Club's lot in Explore Valencia: walk up to it and get in.` : `You already have the keys to the ${SUNDOWNER.name}: it's waiting in the Paseo Club's lot in Explore Valencia.`}</p>
      </div>
      <div className="pkActEndRow">
        {onDrive && (
          <button type="button" className="pkPrimary" onClick={onDrive} data-leisure="drive">
            Drive it now
          </button>
        )}
        <button type="button" onClick={onClose} data-leisure="keys-close">
          Later
        </button>
      </div>
    </div>
  </div>
)
