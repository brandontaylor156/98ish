// Pickleball 98, players v2 (docs/players-v2.md): which modeled kit pieces a look wears.
// The MakeHuman bodies carry fitted, modeled garments (tools/players/build-kit.mjs: a tee, a
// tank cut from it, shorts, briefs, trainers and two heights of socks, each its own skinned
// mesh); what a look asks for that they don't cover (polo collars aside: a polo is the tee
// with a bound collar; rash guards, jackets, crop tops, one-pieces, board/short/swim shorts,
// track pants, knee socks, gloves, wristbands, the pleated skirt over its briefs, hats and
// glasses) is still grown from the body (outfit.js) or modeled in athlete.js. Pure (tested in
// Node: kit.test.js).

// look field -> piece
const TOPS = { tee: "tee", polo: "tee", tank: "tank" }
const BOTTOMS = { shorts: "shorts", skirt: "briefs" }
const SOCKS = { crew: "socks", ankle: "anklesocks" }
// the grown garment (outfit.js / athlete.js garmentKinds) each piece stands in for
export const REPLACES = { tee: ["tee", "polo"], tank: ["tank"], shorts: ["shorts"], briefs: ["briefs"], shoes: ["shoes"], socks: ["socks"], anklesocks: ["anklesocks"] }
// the colors each piece takes (athlete.js kitMaterial): 0 the top, 1 the bottoms, 2 the shoes,
// 3 the socks, 4 a tank (the top's colors, its own binding)
export const PIECE_PART = { tee: 0, tank: 4, shorts: 1, briefs: 1, shoes: 2, socks: 3, anklesocks: 3 }

// look -> { pieces: [names], replaced: Set of grown garment kinds they stand in for }.
// have: the piece names the body file has (an older file without kits: none)
export const kitPiecesFor = (look = {}, have = []) => {
  const ok = new Set(have)
  const pieces = []
  const add = (p) => {
    if (p && ok.has(p) && !pieces.includes(p)) pieces.push(p)
  }
  const style = look.shirtStyle || "tee"
  const top = Object.hasOwn(TOPS, style) ? TOPS[style] : null
  if (top) add(top)
  // (a one-piece has no separate bottoms)
  if (style !== "onepiece") add(Object.hasOwn(BOTTOMS, look.bottom || "shorts") ? BOTTOMS[look.bottom || "shorts"] : null)
  add(Object.hasOwn(SOCKS, look.sockStyle || "crew") ? SOCKS[look.sockStyle || "crew"] : null)
  add("shoes")
  const replaced = new Set(pieces.flatMap((p) => REPLACES[p]))
  return { pieces, replaced }
}
