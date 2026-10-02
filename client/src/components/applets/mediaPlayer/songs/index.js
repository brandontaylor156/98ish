import startup from "./startup"
import highway from "./highway"
import fusion from "./fusion"
import neonpop from "./neonpop"
import ballad from "./ballad"
import chiptune from "./chiptune"
import ambient from "./ambient"
import funky from "./funky"

// Every song the Media Player knows, in playlist order. All original compositions.
export const SONGS = [startup, highway, fusion, neonpop, ballad, chiptune, ambient, funky]

export const songById = (id) => SONGS.find((s) => s.id === id) || null

// A song by id or by its file name (HIGHWAY.MID), so renamed copies still play
export const findSong = (key) => {
  const k = String(key ?? "").trim().toLowerCase()
  return SONGS.find((s) => s.id === k || s.file.toLowerCase() === k) || null
}
