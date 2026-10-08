import React, { Suspense, lazy, useEffect, useRef, useState } from "react"
import { keyOf, useAim } from "../aim/AimContext"
import { launch, programByName, retiredExtra } from "../../../utils/programs"
import {
  OPEN_EVENT,
  VIEW_EVENT,
  emitCouple,
  getCouple,
  refreshCouple,
  refreshCoupleThings,
  resetCouple,
  setCouple,
  setCoupleToken,
  useCouple,
} from "../../../utils/couple"

// Lives inside 98 Messenger's provider on the desktop: keeps utils/couple.js in step with
// the Messenger session (who you're paired with, your partner's presence, live couple:*
// notices) and opens the couple apps when asked. Everything with pictures (the pair
// request, toasts, the photo wallpaper) loads only for couples.

const Overlays = lazy(() => import("./CoupleOverlays"))
const FlowerWidget = lazy(() => import("./FlowerWidget"))

const THINGS = ["couple:letter", "couple:letter-opened", "couple:flowers", "couple:watered"]

const CoupleBridge = ({ socket, windows, dispatch, mobile }) => {
  const aim = useAim()
  const couple = useCouple()
  const [overlays, setOverlays] = useState(false)
  const windowsRef = useRef(windows)
  windowsRef.current = windows

  // signing on and off
  useEffect(() => {
    if (aim?.status !== "online" || !aim.token) {
      resetCouple()
      return
    }
    setCoupleToken(aim.token)
    refreshCouple().then(() => refreshCoupleThings())
  }, [aim?.status, aim?.token])

  // coming back to 98ish (another tab, a phone waking up): catch up
  useEffect(() => {
    let last = 0
    const back = () => {
      if (document.visibilityState === "hidden" || getCouple().status !== "paired" || Date.now() - last < 5000) return
      last = Date.now()
      refreshCoupleThings()
    }
    window.addEventListener("focus", back)
    document.addEventListener("visibilitychange", back)
    return () => {
      window.removeEventListener("focus", back)
      document.removeEventListener("visibilitychange", back)
    }
  }, [])

  // your partner's 98 Messenger presence
  const presence = couple.partner ? aim?.presence?.[keyOf(couple.partner)] : null
  const online = !!presence?.online
  const away = online && (!!presence?.away || !!presence?.idleSince)
  useEffect(() => {
    const now = getCouple()
    if (now.partnerOnline !== online || now.partnerAway !== away) setCouple({ partnerOnline: online, partnerAway: away })
  }, [online, away])

  // live notices
  useEffect(() => {
    const onAny = (event, payload) => {
      if (typeof event !== "string" || !event.startsWith("couple:")) return
      if (event === "couple:update") refreshCouple().then(() => refreshCoupleThings())
      else if (THINGS.includes(event)) refreshCoupleThings()
      emitCouple(event, payload || {})
    }
    socket.onAny(onAny)
    return () => socket.offAny(onAny)
  }, [socket])

  // openCouples("Love Letters", { view }) from anywhere (the Buddy List, the tray, toasts)
  useEffect(() => {
    const open = (e) => {
      const program = programByName(e.detail?.program)
      if (!program) return
      const extra = e.detail?.extra || {}
      // a retired program's name ("Chess Puzzles"): its new home, in the right mode (an open
      // window gets it as a handoff when it's brought forward)
      const retired = retiredExtra(e.detail?.program)
      if (Object.keys(retired).length) return dispatch({ type: "open_window", payload: launch(program.name, { ...extra, ...retired, handoff: { id: Date.now(), ...retired } }) })
      const index = program.single ? windowsRef.current.findIndex((w) => !w.closed && w.program === program.name) : -1
      if (index >= 0) {
        dispatch({ type: "focus_window", payload: { index } })
        window.dispatchEvent(new CustomEvent(VIEW_EVENT, { detail: { program: program.name, ...extra } }))
      } else dispatch({ type: "open_window", payload: launch(program.name, extra) })
    }
    window.addEventListener(OPEN_EVENT, open)
    return () => window.removeEventListener(OPEN_EVENT, open)
  }, [])

  useEffect(() => {
    if (["paired", "pending-in", "pending-out"].includes(couple.status)) setOverlays(true)
    if (couple.status === "signed-out") setOverlays(false)
  }, [couple.status])

  if (!overlays) return null
  return (
    <Suspense fallback={null}>
      <Overlays windows={windows} dispatch={dispatch} mobile={mobile} />
    </Suspense>
  )
}

// The flowers your partner sent, sitting on the desktop (under every window)
export const FlowerSpot = ({ mobile }) => {
  const { status, bouquets } = useCouple()
  const bouquet = status === "paired" ? bouquets?.find((b) => !b.dismissed) : null
  if (!bouquet) return null
  return (
    <Suspense fallback={null}>
      <FlowerWidget bouquet={bouquet} mobile={mobile} />
    </Suspense>
  )
}

export default CoupleBridge
