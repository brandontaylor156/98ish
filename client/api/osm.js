// Vercel serverless function for Venue Finder: one venue's OpenStreetMap surroundings from the
// public Overpass API, asked with the app's own User-Agent. Needed because overpass-api.de now
// answers 406 to any browser User-Agent (a phone can't ask it directly), and turns away the chat
// server's shared address on Render (every build there failed in production, 2026-10-08).
// Answers are cached by Vercel's CDN for 30 days (map data, ODbL), so a venue is asked once.
// Also mounted by vite.config.js during `npm run dev`.
//
//   ?lat=34.43050&lon=-118.52770&r=140   -> { osm_base, elements } (compactElements form)

import { venueQuery, compactElements } from "../src/components/applets/pickleball/park/live/osmspec.js"

export const config = { maxDuration: 60 }

const UA = "98ish-venue-finder/1.0 (Pickleball 98; https://98ish.vercel.app)"
const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://z.overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"]
const TIMEOUT_MS = 25000

const ask = async (endpoint, query) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(endpoint, { method: "POST", signal: controller.signal, headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) })
    if (!response.ok) return { status: response.status }
    const json = await response.json()
    return Array.isArray(json?.elements) ? { json } : { status: 502 }
  } catch (error) {
    return { status: error.name === "AbortError" ? 504 : 502 }
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req, res) {
  const params = Object.fromEntries(new URL(req.url, "http://localhost").searchParams)
  res.setHeader("Content-Type", "application/json")
  const send = (status, body) => {
    res.statusCode = status
    res.setHeader("Cache-Control", status === 200 ? "public, s-maxage=2592000, stale-while-revalidate=2592000" : "no-store")
    res.end(JSON.stringify(body))
  }
  const lat = Number(params.lat)
  const lon = Number(params.lon)
  const r = Math.round(Number(params.r))
  if (!(Math.abs(lat) <= 85 && Math.abs(lon) <= 180 && r >= 30 && r <= 400)) return send(400, { error: "Bad venue position" })

  const query = venueQuery(Number(lat.toFixed(5)), Number(lon.toFixed(5)), r)
  const seen = []
  for (const endpoint of ENDPOINTS) {
    const out = await ask(endpoint, query)
    if (out.json) return send(200, { osm_base: out.json.osm3s?.timestamp_osm_base || null, elements: compactElements(out.json.elements) })
    seen.push(out.status)
  }
  console.warn("[osm] every Overpass server refused:", seen.join(","))
  send(503, { error: "The map servers are busy. Try this venue again in a minute." })
}
