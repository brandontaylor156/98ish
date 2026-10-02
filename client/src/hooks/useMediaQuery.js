import { useSyncExternalStore } from "react"

export const useMediaQuery = (query) =>
  useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    },
    () => window.matchMedia(query).matches
  )

// Phones: narrow screens, plus touch screens too short for floating windows (landscape phones).
// Mobile mode shows every window full screen; CSS keys off the .os-mobile class App sets from this.
export const useIsMobile = () =>
  useMediaQuery("(max-width: 640px), (pointer: coarse) and (max-height: 500px)")

// Touch is the main input (phones, tablets): there's no double-click and no right-click
export const useIsTouch = () => useMediaQuery("(pointer: coarse)")

// Props that open an item: a single tap on touch screens, a double-click with a mouse
export const useOpenGesture = () => {
  const touch = useIsTouch()
  return (open) => (touch ? { onClick: open } : { onDoubleClick: open })
}
