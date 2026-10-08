// Open Maps 98 from anywhere in 98ish (small and eager: it only sends an event; Maps 98 itself
// loads when its window opens).
//
//   import { openMaps } from "../../../utils/maps"
//   openMaps({ name: "Los Cab Sports Village", lat: 33.7173, lon: -117.9861, directions: true })
//
// - name (optional): what the place is called, shown on the card
// - lat, lon (required): where it is (WGS84 degrees)
// - address / detail (optional): a second line on the card
// - directions (optional): true opens straight into directions from where you are (it asks for
//   your location once, from the tap that opened it; without a location it asks where from)
// - mode (optional): "drive" (default), "walk" or "bike"
// Returns false (and opens nothing) when lat/lon aren't a real place.
// An open Maps 98 window comes forward and moves to the new place (a handoff), so calling it
// twice never makes two windows.

export const MAPS_PROGRAM = "Maps 98"
const OPEN_EVENT = "98ish:couple-open" // utils/couple.js OPEN_EVENT: CoupleBridge opens programs by name

export const openMaps = ({ name = "", lat, lon, address = "", detail = "", directions = false, mode } = {}) => {
  const la = Number(lat)
  const lo = Number(lon)
  if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return false
  const handoff = { id: Date.now(), dest: { name: String(name || ""), lat: la, lon: lo, detail: String(detail || address || "") }, directions: !!directions, ...(mode ? { mode } : {}) }
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { program: MAPS_PROGRAM, extra: { handoff } } }))
  return true
}
