// Pickleball 98 > Explore: life in the town (docs/open-world.md "Home, work, the stores and your
// Bag"): waving and doing things together, your private Home and Work and going inside (the
// office, your home), the warehouse club and the mall (a cart, samples, the register), your Bag
// (eat and drink, put things down, ride your own bike, paddles/balls/clothes into the Locker Room,
// gifts). The open world's own pieces are in client/src/roam/life/ and roam/ui/; this hook is the
// page's glue (it knows 98 Messenger, the couple, the chip bank, Pickleball's prefs).
//
// useExploreLife({ engineRef, roamWorld, labelsEl, mobile, aim, partner, flash, setPrefs, prefsRef,
//   hopTo }) -> { inside, insideHud, hudProps, phoneLife, overlays, onTownEvent }

import React, { useEffect, useMemo, useRef, useState } from "react"
import { createSocial } from "../../../roam/life/social.js"
import { createEat } from "../../../roam/life/eat.js"
import { createTownLife } from "../../../roam/life/town.js"
import { createInterior } from "../../../roam/life/interior.js"
import { layoutFor, seedOf } from "../../../roam/life/layouts.js"
import { AISLES, MALL_SHOPS, STORES, applyCart, checkoutSplit, itemOf } from "../../../roam/life/catalog.js"
import { CheckoutSheet, DeskGame, GiftSheet, InviteSheet, ShopSheet, SocialButtons, SocialLayer } from "../../../roam/ui/LifeHud.jsx"
import { characterLook, validateLook } from "./locker.js"

const nameKey = (n) => String(n || "").replace(/\s+/g, "").toLowerCase()
const MALL_COLORS = { threads: "#ef476f", court: "#2a9d8f", kicks: "#111111", sweets: "#ff9ec7", sparkle: "#9d4edd", arcade: "#5c2a9d" }
let uidN = 0
const uid = () => `${Date.now().toString(36)}${(++uidN).toString(36)}`.slice(-12)

export const useExploreLife = ({ engineRef, roamWorld, labelsRef, mobile, aim, partner = null, flash, setPrefs, prefsRef, hopTo }) => {
  const [socialState, setSocialState] = useState(null)
  const [open, setOpen] = useState(null) // "emotes" | "together"
  const [inside, setInside] = useState(null) // the interior world
  const [insideHud, setInsideHud] = useState(null)
  const [sheet, setSheet] = useState(null) // { kind: shop|checkout|desk|gift|invite|insideMenu|invited, ... }
  const [cart, setCart] = useState([])
  const [msg, setMsg] = useState("")
  const activeRef = useRef(null) // { world, social, eat, offs }
  const townLifeRef = useRef(null)
  const insideRef = useRef(null)
  const cartRef = useRef([])
  cartRef.current = cart
  const aimRef = useRef(aim)
  aimRef.current = aim
  const partnerRef = useRef(partner)
  partnerRef.current = partner
  const friends = () => {
    const out = new Set()
    for (const g of aimRef.current?.me?.groups || []) for (const b of g.buddies || []) out.add(nameKey(b))
    if (partnerRef.current) out.add(nameKey(partnerRef.current))
    out.delete("smarterchild")
    return out
  }
  const meName = () => aimRef.current?.me?.screenName || roamWorld?.host?.me?.name || "You"

  // ---- social + eating ride with whichever world is showing ----
  const attachTo = (world) => {
    detach()
    if (!world) return
    const host = world.host || roamWorld?.host
    const social = createSocial({ world, rules: host.together, friends, onState: setSocialState })
    const eat = createEat({ items: host.heldItems || {}, onDone: () => flash?.("All gone. Tasty!") })
    world.setSocial?.(social)
    const offs = [world.use(social.plugin), world.use(eat.plugin)]
    activeRef.current = { world, social, eat, offs }
  }
  const detach = () => {
    const a = activeRef.current
    if (!a) return
    for (const off of a.offs) off()
    activeRef.current = null
    setSocialState(null)
    setOpen(null)
  }
  // a stand-in for town.js (sitting by a grill): whichever social is active
  const socialProxy = {
    get state() {
      return activeRef.current?.social?.state
    },
    sitAt: (s) => activeRef.current?.social?.sitAt(s),
  }

  // the town: its doors, stores and things put down; and the page hears what the town's net says
  useEffect(() => {
    if (!roamWorld) return undefined
    const tl = createTownLife({ world: roamWorld, host: roamWorld.host, social: socialProxy, onEvent: (ev) => townEvent(ev) })
    townLifeRef.current = tl
    const offNet = roamWorld.use({
      netEvent(type, d) {
        if (type === "roam:invite" && d) setSheet({ kind: "invited", ...d })
        else if (type === "roamlife:gift" && d) {
          const it = itemOf(d.item)
          flash?.(`🎁 ${d.from} gave you ${it?.name ? it.name.toLowerCase() : "a gift"}! Open your phone's Bag.`)
          roamWorld.host?.life?.refresh()
        } else if (type === "roamlife:shared" && d) {
          flash?.(d.gone ? `${d.from} stopped sharing their ${d.kind}.` : `${d.from} shared their ${d.kind} with you: it's on your map.`)
          roamWorld.host?.life?.refresh()
        } else if (type === "roamlife:changed") roamWorld.host?.life?.refresh()
      },
    })
    attachTo(roamWorld)
    return () => {
      offNet()
      tl.dispose()
      townLifeRef.current = null
      detach()
      leaveInside({ quiet: true })
    }
  }, [roamWorld])

  // ---- going inside ----
  const enter = async ({ kind, place = null, store = null, room = null }) => {
    const town = roamWorld
    const e = engineRef.current
    if (!town || !e || insideRef.current) return
    const net = town.net
    const label = place ? place.label : store ? (kind === "club" ? STORES.club.name : "The mall") : ""
    const seed = room ? undefined : seedOf(place ? place.id : store ? store.key : kind)
    let r = null
    if (net?.request) {
      r = await net.request("roam:enter", room ? { room } : { kind, key: store?.key?.replace(/[^a-z0-9:._-]/gi, "").toLowerCase(), label, seed }).catch(() => null)
      if (r && !r.ok) return flash?.(r.error)
    }
    if (!r) r = { room: `local:${kind}`, kind, slot: 0, origin: { x: 25000, z: 25000 }, label, seed }
    const shops = MALL_SHOPS.filter((s) => s !== "food").map((id) => ({ id, name: STORES[id].name, bg: MALL_COLORS[id] || "#23395d" }))
    const L = layoutFor(r.kind, r.seed, { aisles: AISLES, shops })
    if (!L) return
    const from = town.meNow?.() || null
    const doorBack = place?.door || store?.door || null
    detach()
    // (the town's name tags stay put while it isn't drawn: hide them)
    labelsRef?.current?.querySelectorAll?.(".roamLabel").forEach((el) => (el.style.display = "none"))
    const w = createInterior({ town, host: town.host, room: { ...r, label: r.label || L.name }, layout: L, phone: !!mobile, labelsEl: labelsRef?.current || null, onHud: setInsideHud, onEvent: (ev) => insideEvent(ev) })
    w.__back = { from, door: doorBack, kind: r.kind, owner: !room && (r.kind === "home" || r.kind === "office") }
    insideRef.current = w
    // (the shared cart and the TV in here)
    w.use({
      netEvent(type, d) {
        if (type === "roam:say" && d?.kind === "cart" && d.data?.op) setCart((c) => applyCart(c, d.data.op))
      },
    })
    setInside(w)
    attachTo(w)
    e.setWorld(w)
    if (import.meta.env?.DEV) window.__inside = w
    flash?.(r.kind === "office" ? `At work${label ? `: ${label}` : ""}. Clock in by the door.` : r.kind === "home" ? `Home${room ? "" : " sweet home"}.` : `Welcome to ${L.name}!`)
  }
  const leaveInside = ({ quiet = false } = {}) => {
    const w = insideRef.current
    if (!w) return
    insideRef.current = null
    const secs = w.clockOut?.() || 0
    if (secs > 0) roamWorld?.host?.life?.work(secs)
    roamWorld?.net?.request?.("roam:exit", {}).catch?.(() => {})
    detach()
    w.dispose()
    setInside(null)
    setInsideHud(null)
    setSheet(null)
    setCart([])
    if (quiet) return
    const town = roamWorld
    if (!town) return
    // (out the door you came in by, facing the street)
    const back = w.__back
    if (back?.door) town.teleport?.(back.door.x - Math.sin(back.door.yaw) * 0.6, back.door.z - Math.cos(back.door.yaw) * 0.6, back.door.yaw + Math.PI)
    engineRef.current?.setWorld(town)
    attachTo(town)
    if (secs > 0) flash?.(`Clocked out: ${Math.max(1, Math.round(secs / 60))} min worked.`)
  }

  // ---- what the town says (doors, things picked up) ----
  const townEvent = (ev) => {
    if (ev.type === "enter") enter({ kind: ev.kind, place: ev.place, store: ev.store })
    else if (ev.type === "knock") {
      const m = roamWorld?.host?.messages
      if (!m) return flash?.("Sign on to 98 Messenger to knock.")
      m.send(ev.place.ownerName, "Knock knock! 🏠 I'm at your door in Explore. Invite me in?").then((r) => flash?.(r.ok ? `You knocked. ${ev.place.ownerName} can invite you in.` : r.error))
    } else if (ev.type === "pickedUp") {
      const id = Object.entries({ grill: "grill", cooler: "cooler", umbrella: "umbrella", chairs: "chairs", float: "floatie", blanket: "blanket" }).find(([k]) => k === ev.kind)?.[1]
      if (id) roamWorld?.host?.life?._grant(id, 1)
      flash?.("Back in your Bag.")
    }
  }

  // ---- what happens inside ----
  const insideEvent = (ev) => {
    const life = roamWorld?.host?.life
    const w = insideRef.current
    if (ev.type === "exit") return leaveInside()
    if (ev.type === "chat") return flash?.(`${ev.name}: "${ev.line}"`)
    if (ev.type === "hold") {
      activeRef.current?.eat.hold(ev.item)
      return flash?.(ev.sample ? "A free sample. Mmm!" : ev.item === "coffee" ? "A fresh coffee ☕" : "Something cold from the fridge.")
    }
    if (ev.type === "clock") return flash?.(ev.on ? `Clocked in at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Have a good shift!` : (life?.work(ev.secs), `Clocked out: ${Math.max(1, Math.round(ev.secs / 60))} min worked.`))
    if (ev.type === "desk") return setSheet({ kind: "desk" })
    if (ev.type === "tv") {
      if (w?.layout?.kind === "home" && ev.on) {
        const with_ = partnerRef.current || null
        aimRef.current?.openTogether?.(with_ ? { with: with_ } : {})
        return flash?.("Watch Together is open: pick something to watch on the couch.")
      }
      return flash?.(ev.on ? "The TV's on: this week's slides." : "TV off.")
    }
    if (ev.type === "shop") return setSheet({ kind: "shop", store: ev.store, aisle: ev.aisle ? AISLES.find((a) => a.id === ev.aisle)?.name : null, aisleId: ev.aisle || null })
    if (ev.type === "checkout") return setSheet({ kind: "checkout" })
    if (ev.type === "claw") return claw()
    if (ev.type === "cart") return
  }

  const balance = () => roamWorld?.host?.life?.bank?.balance ?? 0
  const sayCart = (op) => {
    setCart((c) => {
      const next = applyCart(c, op)
      insideRef.current?.cartGoods?.(next.length)
      return next
    })
    roamWorld?.net?.request?.("roam:say", { kind: "cart", data: { op } }).catch?.(() => {})
  }
  const addToCart = (id) => {
    const w = insideRef.current
    if (w && !w.info.cart) w.setCart(true)
    sayCart({ op: "add", uid: uid(), id, by: meName() })
    flash?.(`${itemOf(id)?.name} is in the cart.`)
  }
  const buyNow = async (id) => {
    const it = itemOf(id)
    const life = roamWorld?.host?.life
    if (!it || !life) return
    const r = await life.buy({ [id]: 1 }, it.price)
    if (!r.ok) return flash?.(r.error)
    // (from the food court: straight into your hand)
    if (it.use.eat && (sheet?.store === "food" || it.stores.includes("food"))) {
      await life.use(id, 1)
      activeRef.current?.eat.hold(it.use.eat)
      setSheet(null)
      return flash?.(id === "hotdogcombo" ? "One hot dog combo. Still 2 chips. Some things never change." : `${it.name}: enjoy!`)
    }
    flash?.(`Bought: ${it.name}. It's in your Bag.`)
  }
  const pay = async () => {
    const life = roamWorld?.host?.life
    if (!life) return
    const me = meName()
    const split = checkoutSplit(cartRef.current, me)
    const all = {}
    for (const x of cartRef.current) all[x.id] = (all[x.id] || 0) + 1
    setMsg("Paying...")
    const r = await life.buy(all, split.cost)
    if (!r.ok) return setMsg(r.error)
    const notes = [`Paid ${split.cost} chips.`]
    for (const [name, items] of Object.entries(split.gifts))
      for (const [id, n] of Object.entries(items)) {
        // (their picks go to them as one gift each, the whole pack)
        const g = await life.gift(name, id, "From our shopping trip ♥", n * (itemOf(id)?.pack || 1))
        notes.push(g.ok ? `${itemOf(id)?.name} went to ${name}.` : `${itemOf(id)?.name} stays with you (${g.error})`)
      }
    sayCart({ op: "clear" })
    insideRef.current?.setCart(false)
    setMsg("")
    setSheet(null)
    flash?.(`${notes.join(" ")} Everything's in your Bag.`)
  }
  const claw = async () => {
    const life = roamWorld?.host?.life
    if (!life) return
    const b = life.bank
    if (b.balance < 5 && b.needsRefill()) b.refill()
    if (!b.take(5)) return flash?.("The claw costs 5 chips.")
    if (Math.random() < 0.42) {
      await life._grant("plushcat", 1)
      flash?.("🐱 Got one! A plush cat is in your Bag.")
    } else flash?.("So close! The claw dropped it.")
  }

  // ---- the phone's Bag and Places (RoamPhone life prop) ----
  const phoneLife = useMemo(
    () => ({
      eat: async (id) => {
        const it = itemOf(id)
        const life = roamWorld?.host?.life
        if (!it?.use.eat || !life) return { ok: false }
        const r = await life.use(id, 1)
        if (!r.ok) return r
        activeRef.current?.eat.hold(it.use.eat)
        return { ok: true, text: `${it.icon} In your hand: tap ${host98Verb(roamWorld, it.use.eat)} to enjoy it.` }
      },
      put: async (id) => {
        const it = itemOf(id)
        if (insideRef.current) return { ok: false, error: "Put things down outside: at a park, the beach, a pool." }
        const tl = townLifeRef.current
        if (!tl || !it?.use.place) return { ok: false }
        const r = await tl.put(it.use.place)
        if (!r.ok) return r
        await roamWorld.host.life.use(id, 1)
        return { ok: true, text: `${it.name} is set up in front of you. Walk up to it to sit.` }
      },
      ride: async (id) => {
        const it = itemOf(id)
        if (insideRef.current) return { ok: false, error: "Ride it outside." }
        const ok = roamWorld?.rideOwn?.(it.use.ride, it.color ?? 0x7fe0bf)
        return ok ? { ok: true, text: `On your ${it.use.ride}. Get off anywhere; it's still yours in your Bag.` } : { ok: false, error: "Get out of the car first." }
      },
      equip: async (id) => roamWorld?.host?.life?.equip(id) || { ok: false },
      gift: (id) => setSheet({ kind: "gift", item: id }),
      travel: (p) => {
        const town = roamWorld
        if (!town || !p?.door) return
        leaveInside({ quiet: true })
        engineRef.current?.setWorld(town)
        attachTo(town)
        const at = { x: p.door.x - Math.sin(p.door.yaw) * 1.2, z: p.door.z - Math.cos(p.door.yaw) * 1.2, yaw: p.door.yaw }
        if (p.town !== town.town.id) return hopTo?.(p.town, { at })
        town.goToStart?.(at)
        flash?.(`At ${p.ownerName ? `${p.ownerName}'s ${p.kind}` : p.label}. Walk up to the door.`)
      },
    }),
    [roamWorld]
  )

  // ---- what's on screen ----
  const active = activeRef.current
  const hudProps = active
    ? {
        extra: <SocialButtons state={socialState} onEmotes={() => setOpen((o) => (o === "emotes" ? null : "emotes"))} onTogether={() => setOpen("together")} />,
      }
    : {}
  const rules = roamWorld?.host?.together
  const insideOwner = inside?.__back?.owner
  const overlays = (
    <>
      {active && <SocialLayer social={active.social} state={socialState} rules={rules} open={open} setOpen={setOpen} />}
      {sheet?.kind === "shop" && <ShopSheet store={sheet.store} aisle={sheet.aisle} balance={balance()} cartCount={cart.length} onAdd={addToCart} onBuy={buyNow} onClose={() => setSheet(null)} />}
      {sheet?.kind === "checkout" && <CheckoutSheet cart={cart} me={meName()} balance={balance()} msg={msg} onRemove={(u) => sayCart({ op: "remove", uid: u })} onPay={pay} onClose={() => (setSheet(null), setMsg(""))} />}
      {sheet?.kind === "desk" && <DeskGame worked={insideHud?.worked || 0} onClose={() => setSheet(null)} onDone={(r) => flash?.(`Inbox zero: ${r.right} of ${r.of} right. Nice work!`)} />}
      {sheet?.kind === "gift" && (
        <GiftSheet
          item={sheet.item}
          buddies={roamWorld?.host?.messages?.buddies?.() || []}
          msg={msg}
          onClose={() => (setSheet(null), setMsg(""))}
          onGive={async (to, note) => {
            setMsg("Wrapping it up...")
            const r = await roamWorld.host.life.gift(to, sheet.item, note)
            setMsg("")
            if (!r.ok) return setMsg(r.error)
            setSheet(null)
            flash?.(`🎁 Sent to ${r.to || to}. It's waiting in their Bag.`)
          }}
        />
      )}
      {sheet?.kind === "invite" && (
        <InviteSheet
          place={inside?.room?.label || "your place"}
          people={(roamWorld?.remotesAll?.() || []).filter((p) => p.inside !== inside?.room?.room)}
          onClose={() => setSheet(null)}
          onInvite={async (p) => {
            const r = await roamWorld.net?.request?.("roam:invite", { num: p.num }).catch(() => null)
            flash?.(r?.ok ? `Invited ${p.name}. They'll get a card to come in.` : r?.error || "That didn't work.")
            setSheet(null)
          }}
        />
      )}
      {sheet?.kind === "insideMenu" && (
        <div className="roamSheet" onPointerDown={(e) => e.target === e.currentTarget && setSheet(null)} data-life="inside-menu">
          <div className="roamPanel">
            <div className="roamPanelHead">
              <b>{inside?.room?.label || "Inside"}</b>
              <button type="button" className="roamBtn" onClick={() => setSheet(null)} aria-label="Close">
                ×
              </button>
            </div>
            <div className="roamPanelBody">
              {insideOwner && (
                <button type="button" className="roamBtn roamWide" onClick={() => setSheet({ kind: "invite" })} data-life="invite-open">
                  Invite someone in...
                </button>
              )}
              {inside?.layout?.kind === "club" && (
                <button type="button" className="roamBtn roamWide" onClick={() => setSheet({ kind: "checkout" })} data-life="cart-open">
                  Your cart ({cart.length})
                </button>
              )}
              <button type="button" className="roamBtn roamWide" onClick={() => leaveInside()} data-life="go-outside">
                Go outside
              </button>
            </div>
          </div>
        </div>
      )}
      {sheet?.kind === "invited" && (
        <div className="roamPanel rlfAsk" role="alertdialog" data-life="invited">
          <p>
            🏠 {sheet.name} invites you into {sheet.kind === "office" ? "their office" : "their home"}
            {sheet.label ? ` (${sheet.label})` : ""}.
          </p>
          <div className="rlfRow">
            <button type="button" className="roamBtn rlfYes" onClick={() => (setSheet(null), enter({ room: sheet.room }))} data-life="invited-yes">
              Go in
            </button>
            <button type="button" className="roamBtn" onClick={() => setSheet(null)}>
              Not now
            </button>
          </div>
        </div>
      )}
    </>
  )
  return { inside, insideHud, hudProps, phoneLife, overlays, insideMenu: () => setSheet({ kind: "insideMenu" }), leaveInside, enter, cart }
}

const host98Verb = (world, heldId) => (world?.host?.heldItems?.[heldId]?.kind === "food" ? "Bite" : "Sip")

// Pickleball 98's side of "use it": a paddle, balls or clothes into your look and matches
export const equipFor = (prefsRef, setPrefs) => (it) => {
  const p = prefsRef.current
  const id = p.character
  if (it.use.balls) {
    setPrefs({ ballColor: it.use.balls })
    return { ok: true, text: `${it.name}: your matches play with them now.` }
  }
  const cur = p.looks?.[id] ? validateLook(p.looks[id], characterLook(id)) : characterLook(id, p.outfit)
  const patch = it.use.paddle ? { ...it.use.paddle } : it.use.wear ? { ...it.use.wear, theme: "custom", style: "" } : null
  if (!patch) return { ok: false, error: "That isn't something to wear or play with." }
  setPrefs({ looks: { ...(p.looks || {}), [id]: validateLook({ ...cur, ...patch }, cur) } })
  return { ok: true, text: `${it.name}: it's on your player now (Locker Room > Bag to switch).` }
}
