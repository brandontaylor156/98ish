// Screensavers: the list, the full-screen overlay, the small preview, and the idle timer.
//
//   <Screensaver id="pipes" settings={options} onExit={...} />   full screen until input
//   <ScreensaverPreview id="pipes" settings={options} />          fills its parent box
//   useIdle(minutes, onIdle)                                       fires once per idle spell
//
// settings are that screensaver's options; optionsFor(id, saved) fills in its defaults.

export { SCREENSAVERS, saverById, optionsFor } from "./savers"
export { default as Screensaver, ScreensaverPreview, isScreensaverActive } from "./Screensaver"
export { useIdle } from "./useIdle"
