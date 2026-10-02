// Card artwork, drawn as SVG strings (original designs). Each face and back becomes a data:
// URL, made once and cached: the table shows them as <img>s and the win animation draws
// the same images on a canvas. Cards are 71 x 96, the size of the Windows 98 deck.

import { RANK_LABELS, isRed } from "./deck.js"

export const CARD_W = 71
export const CARD_H = 96

const RED = "#d40000"
const BLACK = "#000"
const GOLD = "#f2c200"
const BLUE = "#1d3fae"
const SKIN = "#fbe0b6"

// Suit shapes in a 100 x 100 box
const SUIT_PATHS = [
  // clubs
  "M50 4a21 21 0 0 1 19.5 28.6A21 21 0 1 1 57 66c1.5 14 6 23 15 30H28c9-7 13.5-16 15-30A21 21 0 1 1 30.5 32.6 21 21 0 0 1 50 4z",
  // diamonds
  "M50 2 86 50 50 98 14 50z",
  // hearts
  "M50 94C22 70 3 52 3 30 3 14 15 4 28 4c10 0 18 6 22 15C54 10 62 4 72 4c13 0 25 10 25 26 0 22-19 40-47 64z",
  // spades
  "M50 3c10 18 47 36 47 60 0 15-11 25-23 25-9 0-15-4-19-9 1 9 5 15 13 20H32c8-5 12-11 13-20-4 5-10 9-19 9C14 88 3 78 3 63 3 39 40 21 50 3z",
]

const colorOf = (suit) => (suit === 1 || suit === 2 ? RED : BLACK)

// A suit symbol centred on (x, y), `size` wide, optionally upside down
const pip = (suit, x, y, size, flip = false) => {
  const s = size / 100
  const rot = flip ? ` rotate(180 50 50)` : ""
  return `<path d="${SUIT_PATHS[suit]}" fill="${colorOf(suit)}" transform="translate(${x - size / 2} ${y - size / 2}) scale(${s})${rot}"/>`
}

// Pip positions (columns L C R, rows top to bottom) for 2-10
const L = 21.5
const C = 35.5
const R = 49.5
const PIPS = {
  2: [[C, 19], [C, 77]],
  3: [[C, 19], [C, 48], [C, 77]],
  4: [[L, 19], [R, 19], [L, 77], [R, 77]],
  5: [[L, 19], [R, 19], [C, 48], [L, 77], [R, 77]],
  6: [[L, 19], [R, 19], [L, 48], [R, 48], [L, 77], [R, 77]],
  7: [[L, 19], [R, 19], [C, 33.5], [L, 48], [R, 48], [L, 77], [R, 77]],
  8: [[L, 19], [R, 19], [C, 33.5], [L, 48], [R, 48], [C, 62.5], [L, 77], [R, 77]],
  9: [[L, 19], [R, 19], [L, 38.3], [R, 38.3], [C, 48], [L, 57.7], [R, 57.7], [L, 77], [R, 77]],
  10: [[L, 19], [R, 19], [C, 28.7], [L, 38.3], [R, 38.3], [L, 57.7], [R, 57.7], [C, 67.3], [L, 77], [R, 77]],
}

const FONT = "Arial, Helvetica, sans-serif"

// Rank and a small suit in the top-left corner, and again upside down bottom-right
const corner = (card) => {
  const label = RANK_LABELS[card.rank]
  const color = colorOf(card.suit)
  const wide = label === "10"
  const text = `<text x="7.5" y="13" font-family="${FONT}" font-weight="bold" font-size="12.5" fill="${color}" text-anchor="middle"${
    wide ? ` textLength="12" lengthAdjust="spacingAndGlyphs"` : ""
  }>${label}</text>`
  const one = `${text}${pip(card.suit, 7.5, 20, 8.5)}`
  return `<g>${one}</g><g transform="rotate(180 35.5 48)">${one}</g>`
}

// ---- court cards: an original two-headed royal, mirrored top and bottom ----

const court = (card) => {
  const red = isRed(card)
  const robe = red ? RED : BLUE
  const trim = red ? BLUE : RED
  const { rank, suit } = card
  const cx = 35.5
  let hat = ""
  let hair = ""
  let held = ""
  if (rank === 13) {
    // king: pointed crown, beard, sword
    hat = `<path d="M28.6 21 28 12.5l3.6 3.4 3.9-5.4 3.9 5.4 3.6-3.4-.6 8.5z" fill="${GOLD}" stroke="#000" stroke-width=".6" stroke-linejoin="round"/>
      <circle cx="35.5" cy="10.6" r="1.1" fill="${trim}" stroke="#000" stroke-width=".4"/>
      <rect x="28.6" y="19" width="13.8" height="2.2" fill="${trim}" stroke="#000" stroke-width=".5"/>`
    hair = `<path d="M30 29c0 5 2.5 7.5 5.5 7.5S41 34 41 29c-1.5 1.2-3.2 1.8-5.5 1.8S31.5 30.2 30 29z" fill="#fff" stroke="#000" stroke-width=".55"/>`
    held = `<path d="M19 47V17" stroke="#000" stroke-width="1.6"/><path d="M19 47V17" stroke="#d8d8d8" stroke-width=".8"/>
      <path d="M15.5 37.5h7" stroke="#000" stroke-width="2.2" stroke-linecap="round"/><path d="M15.5 37.5h7" stroke="${GOLD}" stroke-width="1.2" stroke-linecap="round"/>`
  } else if (rank === 12) {
    // queen: rounded crown, long hair, a flower
    hat = `<path d="M29.4 20.5c-.4-3.5.6-6.5 1.6-7.6l1.9 2.7 2.6-4 2.6 4 1.9-2.7c1 1.1 2 4.1 1.6 7.6z" fill="${GOLD}" stroke="#000" stroke-width=".6" stroke-linejoin="round"/>
      <circle cx="35.5" cy="17" r="1.3" fill="${trim}" stroke="#000" stroke-width=".4"/>`
    hair = `<path d="M28.6 21.5c-1.6 4-1.4 9.5.4 13.5l2.2-2.5c-1-3-1-7 .2-10.5zM42.4 21.5c1.6 4 1.4 9.5-.4 13.5l-2.2-2.5c1-3 1-7-.2-10.5z" fill="${GOLD}" stroke="#000" stroke-width=".5"/>`
    held = `<path d="M50.5 46.5c-1-6-1.5-12-1-18" stroke="#2c7a2c" stroke-width="1.2" fill="none"/>
      <path d="M49.6 34c2.5-.5 4.4.6 5 2.4-2.4.6-4.2-.2-5-2.4z" fill="#2c7a2c"/>
      <circle cx="49.5" cy="26.5" r="3.4" fill="${red ? GOLD : RED}" stroke="#000" stroke-width=".5"/>
      <circle cx="49.5" cy="26.5" r="1.3" fill="${red ? RED : GOLD}"/>`
  } else {
    // jack: feathered cap, short hair, a halberd
    hat = `<path d="M28.4 20.4c.5-4.2 3.4-6.6 7.1-6.6s6.6 2.4 7.1 6.6z" fill="${trim}" stroke="#000" stroke-width=".6"/>
      <path d="M28 20.4h15" stroke="#000" stroke-width="2.4" stroke-linecap="round"/><path d="M28 20.4h15" stroke="${GOLD}" stroke-width="1.4" stroke-linecap="round"/>
      <path d="M41 15c3-4.5 7-6 9.5-5.5-1.5 2.8-5 5.3-9.5 5.5z" fill="${red ? GOLD : "#fff"}" stroke="#000" stroke-width=".5"/>`
    hair = `<path d="M29.4 22c-.9 2.4-.8 5 .5 7l1.6-1.2c-.6-1.8-.6-3.6 0-5.3zM41.6 22c.9 2.4.8 5-.5 7l-1.6-1.2c.6-1.8.6-3.6 0-5.3z" fill="#7a4a12" stroke="#000" stroke-width=".45"/>`
    held = `<path d="M51.5 47V13" stroke="#000" stroke-width="1.5"/><path d="M51.5 47V13" stroke="#b07a2a" stroke-width=".7"/>
      <path d="M51.5 12.5c-3.5 1-4.5 4.2-4 7.2l4-1.7 4 1.7c.5-3-.5-6.2-4-7.2z" fill="#d8d8d8" stroke="#000" stroke-width=".5"/>`
  }

  // One half: shoulders, robe, face, hat, the thing it holds, and a small suit
  const half = `
    <path d="M17 48.2c.5-6 2-10.5 5-12.5 3-1.8 8-3 13.5-3s10.5 1.2 13.5 3c3 2 4.5 6.5 5 12.5z" fill="${robe}" stroke="#000" stroke-width=".7"/>
    <path d="M31.5 33.4 35.5 48.2 39.5 33.4c-1.3-.3-2.6-.4-4-.4s-2.7.1-4 .4z" fill="${GOLD}" stroke="#000" stroke-width=".6"/>
    <path d="M33.6 37.5h3.8M34.2 41h2.6M34.7 44.5h1.6" stroke="${trim}" stroke-width="1"/>
    <path d="M22 36.5c2.5 3 2.5 8 1.5 11.7M49 36.5c-2.5 3-2.5 8-1.5 11.7" stroke="${GOLD}" stroke-width="1.6" fill="none"/>
    <path d="M22 36.5c2.5 3 2.5 8 1.5 11.7M49 36.5c-2.5 3-2.5 8-1.5 11.7" stroke="#000" stroke-width=".4" fill="none"/>
    ${hair}
    <ellipse cx="${cx}" cy="25.6" rx="5.6" ry="6.4" fill="${SKIN}" stroke="#000" stroke-width=".6"/>
    <circle cx="33.3" cy="24.6" r=".75"/><circle cx="37.7" cy="24.6" r=".75"/>
    <path d="M35.5 25.2v2.3h-.9" stroke="#000" stroke-width=".45" fill="none"/>
    <path d="M33.8 29.2c1 .6 2.4.6 3.4 0" stroke="${RED}" stroke-width=".7" fill="none" stroke-linecap="round"/>
    ${rank === 13 ? hair : ""}
    ${hat}
    ${held}
    ${pip(suit, 17.6, 16, 7)}
  `
  return `
    <rect x="13.5" y="11" width="44" height="74" fill="#fffbea" stroke="${robe}" stroke-width=".8"/>
    <clipPath id="frame"><rect x="13.5" y="11" width="44" height="74"/></clipPath>
    <g clip-path="url(#frame)">
      <g>${half}</g>
      <g transform="rotate(180 35.5 48)">${half}</g>
      <path d="M13.5 48h44" stroke="${robe}" stroke-width=".6"/>
    </g>
  `
}

const ace = (card) => {
  if (card.suit !== 3) return pip(card.suit, 35.5, 48, 22)
  // the ace of spades gets the big ornate one
  return `${pip(3, 35.5, 47, 40)}
    <path d="M35.5 33c3 5.5 11.5 9.5 11.5 16 0 4-3 6.5-6 6.5-2.6 0-4.4-1.3-5.5-3-1.1 1.7-2.9 3-5.5 3-3 0-6-2.5-6-6.5 0-6.5 8.5-10.5 11.5-16z" fill="none" stroke="#fff" stroke-width="1"/>
    <text x="35.5" y="74" font-family="${FONT}" font-size="5" font-weight="bold" fill="#000" text-anchor="middle" letter-spacing=".5">98ish</text>`
}

const svgDoc = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W * 2}" height="${CARD_H * 2}">${body}</svg>`

const toUrl = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/\s+/g, " "))

const OUTLINE = `<rect x=".5" y=".5" width="70" height="95" rx="3.5" fill="#fff" stroke="#000"/>`

export const faceSvg = (card) => {
  let middle
  if (card.rank === 1) middle = ace(card)
  else if (card.rank > 10) middle = court(card)
  else middle = PIPS[card.rank].map(([x, y]) => pip(card.suit, x, y, card.rank === 10 || card.rank === 9 ? 12.5 : 13.5, y > 48)).join("")
  return svgDoc(OUTLINE + middle + corner(card))
}

// ---- backs ----

const frameBack = (id, inner) =>
  svgDoc(`${OUTLINE}
    <clipPath id="in"><rect x="4" y="4" width="63" height="88" rx="1.5"/></clipPath>
    <g clip-path="url(#in)">${inner}</g>
    <rect x="4" y="4" width="63" height="88" rx="1.5" fill="none" stroke="#000" stroke-width=".6"/>`)

const stars = (list, fill = "#fff") => list.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`).join("")

const fish = (x, y, s, body, flip = false) =>
  `<g transform="translate(${x} ${y}) scale(${flip ? -s : s} ${s})">
    <path d="M-9 0c4-6 12-6 16 0-4 6-12 6-16 0z" fill="${body}" stroke="#000" stroke-width=".6"/>
    <path d="M-9 0l-6-5v10z" fill="${body}" stroke="#000" stroke-width=".6"/>
    <path d="M-2-4.2c1 2.6 1 5.8 0 8.4" stroke="#000" stroke-width=".5" fill="none"/>
    <circle cx="3.5" cy="-1" r="1.1" fill="#fff"/><circle cx="3.8" cy="-1" r=".55"/>
  </g>`

const shell = (x, y, s, fill) =>
  `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M0 8-10-2C-10-8-5-11 0-11S10-8 10-2z" fill="${fill}" stroke="#7a4a2a" stroke-width=".8"/>
    <path d="M0 8 0-11M0 8-5-10M0 8 5-10M0 8-8.5-6M0 8 8.5-6" stroke="#7a4a2a" stroke-width=".7"/>
    <path d="M-3 8h6l-1 2.5h-4z" fill="${fill}" stroke="#7a4a2a" stroke-width=".7"/>
  </g>`

const flower = (x, y, s, petal) =>
  `<g transform="translate(${x} ${y}) scale(${s})">
    ${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="0" cy="-4" rx="2.6" ry="4" fill="${petal}" transform="rotate(${a})"/>`).join("")}
    <circle r="2.2" fill="#f7c600" stroke="#a06a00" stroke-width=".4"/>
  </g>`

export const BACKS = [
  {
    id: "lattice",
    name: "Lattice",
    svg: () =>
      frameBack("lattice", `
      <defs><pattern id="p" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#1438a8"/>
        <path d="M0 0l6 6M6 0 0 6" stroke="#8fb0ff" stroke-width=".8"/>
        <circle cx="3" cy="3" r=".9" fill="#fff"/>
      </pattern></defs>
      <rect width="71" height="96" fill="url(#p)"/>
      <rect x="9" y="9" width="53" height="78" fill="none" stroke="#fff" stroke-width="1.2"/>
      <rect x="11" y="11" width="49" height="74" fill="none" stroke="#8fb0ff" stroke-width=".6"/>`),
  },
  {
    id: "plaid",
    name: "Plaid",
    svg: () =>
      frameBack("plaid", `
      <rect width="71" height="96" fill="#a8121a"/>
      ${[8, 26, 44, 62].map((x) => `<rect x="${x}" y="0" width="7" height="96" fill="#1a1a40" opacity=".55"/><rect x="${x + 3}" y="0" width="1" height="96" fill="#f2c200" opacity=".8"/>`).join("")}
      ${[10, 30, 50, 70, 90].map((y) => `<rect x="0" y="${y}" width="71" height="7" fill="#1a1a40" opacity=".55"/><rect x="0" y="${y + 3}" width="71" height="1" fill="#f2c200" opacity=".8"/>`).join("")}
      ${[17, 35, 53].map((x) => `<rect x="${x}" y="0" width="1" height="96" fill="#fff" opacity=".35"/>`).join("")}`),
  },
  {
    id: "fish",
    name: "Fish",
    svg: () =>
      frameBack("fish", `
      <defs><linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fb6e8"/><stop offset="1" stop-color="#0b4f8a"/></linearGradient></defs>
      <rect width="71" height="96" fill="url(#w)"/>
      <path d="M0 86c6-3 10 3 16 0s10 3 16 0 10 3 16 0 10 3 16 0 6 2 7 1v14H0z" fill="#e3c77a"/>
      <path d="M12 88c-3-8 3-12 0-20s3-10 1-16" stroke="#1f8a3a" stroke-width="2.2" fill="none" stroke-linecap="round"/>
      <path d="M58 89c3-6-2-10 1-17" stroke="#1f8a3a" stroke-width="2" fill="none" stroke-linecap="round"/>
      ${fish(26, 24, 1.15, "#ff8a1e")}
      ${fish(48, 46, 1, "#ffd21e", true)}
      ${fish(30, 66, 0.85, "#ff4f7a")}
      ${stars([[40, 16, 1.4], [42, 11, 1], [44, 7, 0.7], [20, 52, 1.2], [18, 47, 0.8]], "rgba(255,255,255,.75)")}`),
  },
  {
    id: "castle",
    name: "Castle",
    svg: () =>
      frameBack("castle", `
      <defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a0a3a"/><stop offset="1" stop-color="#3a2a7a"/></linearGradient></defs>
      <rect width="71" height="96" fill="url(#n)"/>
      <circle cx="52" cy="18" r="7" fill="#fff6c8"/><circle cx="55" cy="16" r="6" fill="#0d0d42"/>
      ${stars([[14, 12, 0.7], [24, 20, 0.5], [36, 9, 0.6], [62, 34, 0.5], [9, 30, 0.5], [30, 30, 0.4]])}
      <path d="M0 96V80c10-4 22-6 35-6s25 2 36 6v16z" fill="#1c4a1c"/>
      <g fill="#8a8a9a" stroke="#000" stroke-width=".6">
        <path d="M14 80V46h-2v-5h3v2h2v-2h3v2h2v-2h3v5h-2v34z"/>
        <path d="M49 80V46h-2v-5h3v2h2v-2h3v2h2v-2h3v5h-2v34z"/>
        <path d="M22 80V56h27v24z"/>
        <path d="M22 56v-4h3v2h3v-2h3v2h3v-2h3v2h3v-2h3v2h3v-2h3v4z"/>
        <path d="M30 56V38h-2v-5h3v2h2.5v-2h3v2H39v-2h3v5h-2v18z"/>
      </g>
      <path d="M29 33l6-10 6 10z" fill="#c02020" stroke="#000" stroke-width=".6"/>
      <path d="M35 23v-6l5 2-5 2" fill="#f2c200" stroke="#000" stroke-width=".4"/>
      <path d="M31 80v-9c0-3 2-5 4.5-5s4.5 2 4.5 5v9z" fill="#3a2010" stroke="#000" stroke-width=".6"/>
      ${[[17, 52], [52, 52], [17, 64], [52, 64], [33.5, 44]].map(([x, y]) => `<rect x="${x}" y="${y}" width="3" height="5" rx="1.5" fill="#ffd84a"/>`).join("")}`),
  },
  {
    id: "robot",
    name: "Robot",
    svg: () =>
      frameBack("robot", `
      <rect width="71" height="96" fill="#2a7a7a"/>
      ${Array.from({ length: 12 }, (_, i) => `<path d="M0 ${i * 8 + 4}h71" stroke="#3a8f8f" stroke-width="1"/>`).join("")}
      <path d="M35.5 18V10" stroke="#000" stroke-width="1.2"/><circle cx="35.5" cy="9" r="2.6" fill="#ff3030" stroke="#000" stroke-width=".6"/>
      <rect x="20" y="18" width="31" height="22" rx="3" fill="#c8ccd4" stroke="#000" stroke-width=".8"/>
      <rect x="24" y="23" width="9" height="8" rx="1" fill="#1a1a1a"/><rect x="38" y="23" width="9" height="8" rx="1" fill="#1a1a1a"/>
      <circle cx="28.5" cy="27" r="2.2" fill="#5fff7a"/><circle cx="42.5" cy="27" r="2.2" fill="#5fff7a"/>
      <path d="M27 35h17" stroke="#000" stroke-width="1.6"/><path d="M29 35v-1.4M32 35v-1.4M35 35v-1.4M38 35v-1.4M41 35v-1.4" stroke="#c8ccd4" stroke-width=".7"/>
      <rect x="31" y="40" width="9" height="4" fill="#8a8e96" stroke="#000" stroke-width=".6"/>
      <rect x="16" y="44" width="39" height="28" rx="2" fill="#c8ccd4" stroke="#000" stroke-width=".8"/>
      <rect x="21" y="49" width="18" height="10" fill="#1a1a1a"/>
      <path d="M22 55l3-3 3 4 3-5 3 6 4-3" stroke="#5fff7a" stroke-width=".9" fill="none"/>
      <circle cx="47" cy="51" r="2.5" fill="#f2c200" stroke="#000" stroke-width=".5"/><circle cx="47" cy="58" r="2.5" fill="#3a7aff" stroke="#000" stroke-width=".5"/>
      <rect x="21" y="63" width="29" height="4" fill="#8a8e96" stroke="#000" stroke-width=".5"/>
      <path d="M16 48c-5 2-7 8-6 14M55 48c5 2 7 8 6 14" stroke="#c8ccd4" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M16 48c-5 2-7 8-6 14M55 48c5 2 7 8 6 14" stroke="#000" stroke-width=".5" fill="none"/>
      <rect x="22" y="72" width="8" height="12" fill="#8a8e96" stroke="#000" stroke-width=".7"/><rect x="41" y="72" width="8" height="12" fill="#8a8e96" stroke="#000" stroke-width=".7"/>
      <rect x="19" y="84" width="13" height="4" rx="1" fill="#555" stroke="#000" stroke-width=".6"/><rect x="39" y="84" width="13" height="4" rx="1" fill="#555" stroke="#000" stroke-width=".6"/>`),
  },
  {
    id: "shells",
    name: "Shells",
    svg: () =>
      frameBack("shells", `
      <rect width="71" height="96" fill="#f0dca8"/>
      ${Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 37) % 71}" cy="${(i * 53) % 96}" r=".6" fill="#c8a868"/>`).join("")}
      ${shell(22, 22, 1.1, "#ffb6a0")}
      ${shell(50, 44, 0.95, "#fff0e0")}
      ${shell(24, 70, 1, "#ffd27a")}
      <path d="M52 66l2.2 5.6 6-.6-4.6 3.9 2.6 5.5-5.2-3.2-4.5 4 1.4-5.9-5.2-3.1 6-.4z" fill="#ff7a3a" stroke="#a03a10" stroke-width=".6" stroke-linejoin="round"/>
      <path d="M10 44c3-2 5 2 8 0M44 18c3-2 5 2 8 0M40 88c3-2 5 2 8 0" stroke="#5aa0d8" stroke-width="1" fill="none"/>`),
  },
  {
    id: "palm",
    name: "Palm",
    svg: () =>
      frameBack("palm", `
      <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5f8a"/><stop offset=".55" stop-color="#ffb347"/><stop offset="1" stop-color="#ffe08a"/></linearGradient></defs>
      <rect width="71" height="96" fill="url(#s)"/>
      <circle cx="44" cy="58" r="13" fill="#fff2a8"/>
      <rect y="62" width="71" height="34" fill="#1e7ab8"/>
      ${[66, 71, 77, 84].map((y, i) => `<path d="M${30 + i * 2} ${y}h${28 - i * 4}" stroke="#fff2a8" stroke-width="1" opacity=".7"/>`).join("")}
      <path d="M2 80c6-6 22-7 34-2v18H2z" fill="#e8c878"/>
      <path d="M20 79c1-15 4-28 10-40" stroke="#6a3a10" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M20 79c1-15 4-28 10-40" stroke="#9a6020" stroke-width="1.4" fill="none" stroke-dasharray="2 2"/>
      <g fill="#1f7a2a" stroke="#0a4a10" stroke-width=".6">
        <path d="M30 39c-6-6-15-6-21 0 7-3 14-2 21 0z"/>
        <path d="M30 39c-3-8-10-12-17-11 7 2 12 6 17 11z"/>
        <path d="M30 39c3-8 11-11 18-9-7 1-13 4-18 9z"/>
        <path d="M30 39c7-3 15-1 20 5-7-3-14-4-20-5z"/>
        <path d="M30 39c1-7 5-12 10-14-3 4-6 9-10 14z"/>
      </g>
      <circle cx="29" cy="41" r="1.6" fill="#5a3a10"/><circle cx="31.5" cy="41.5" r="1.6" fill="#5a3a10"/>
      <path d="M50 26l3-2 3 2M58 32l2-1.5 2 1.5" stroke="#000" stroke-width=".6" fill="none"/>`),
  },
  {
    id: "logo",
    name: "98ish",
    svg: () =>
      frameBack("logo", `
      <rect width="71" height="96" fill="#008080"/>
      ${Array.from({ length: 9 }, (_, i) => `<path d="M${-30 + i * 14} 96l40-96" stroke="#0a9090" stroke-width="5"/>`).join("")}
      <rect x="11" y="24" width="49" height="44" fill="#c0c0c0" stroke="#000" stroke-width=".7"/>
      <path d="M11.4 67.6V24.4h48.2" stroke="#fff" stroke-width=".9" fill="none"/>
      <rect x="13" y="26" width="45" height="7" fill="#000080"/>
      <rect x="51" y="27.2" width="5" height="4.6" fill="#c0c0c0" stroke="#000" stroke-width=".4"/>
      <path d="M52.4 28.6l2.2 2M54.6 28.6l-2.2 2" stroke="#000" stroke-width=".6"/>
      <text x="15" y="31.6" font-family="${FONT}" font-size="4.2" font-weight="bold" fill="#fff">98ish</text>
      <rect x="14" y="36" width="43" height="29" fill="#fff" stroke="#808080" stroke-width=".6"/>
      <text x="35.5" y="58" font-family="Georgia, 'Times New Roman', serif" font-size="21" font-weight="bold" font-style="italic" fill="#000080" text-anchor="middle">98</text>
      <path d="M22 61.5h27" stroke="#ff2f8a" stroke-width="1.2"/>
      <rect x="13" y="76" width="45" height="8" fill="#c0c0c0" stroke="#000" stroke-width=".5"/>
      <rect x="14.5" y="77.5" width="12" height="5" fill="#c0c0c0" stroke="#fff" stroke-width=".5"/>
      <text x="20.5" y="81.6" font-family="${FONT}" font-size="3.6" font-weight="bold" text-anchor="middle">Start</text>
      ${stars([[8, 10, 0.8], [62, 14, 1], [64, 88, 0.7], [7, 90, 0.9]], "#7fe0e0")}`),
  },
  {
    id: "flowers",
    name: "Flowers",
    svg: () =>
      frameBack("flowers", `
      <rect width="71" height="96" fill="#2f8a3a"/>
      ${Array.from({ length: 30 }, (_, i) => `<path d="M${(i * 23) % 71} ${(i * 41) % 96}l2-4" stroke="#4fae5a" stroke-width="1"/>`).join("")}
      ${[[14, 14, "#fff"], [38, 12, "#ff7aa8"], [60, 20, "#fff"], [24, 34, "#b07aff"], [50, 40, "#fff"], [12, 56, "#ff7aa8"], [36, 58, "#fff"], [60, 64, "#b07aff"], [20, 80, "#fff"], [46, 84, "#ff7aa8"]]
        .map(([x, y, c]) => flower(x, y, 1, c)).join("")}`),
  },
  {
    id: "space",
    name: "Space",
    svg: () =>
      frameBack("space", `
      <rect width="71" height="96" fill="#06061e"/>
      ${stars(Array.from({ length: 26 }, (_, i) => [(i * 29 + 7) % 71, (i * 47 + 3) % 96, i % 4 === 0 ? 0.9 : 0.45]))}
      <circle cx="22" cy="26" r="11" fill="#e07a3a"/>
      <path d="M12 22c6 2 14 2 20-1M11.5 28c7 2 15 2 21-1" stroke="#b04a1a" stroke-width="1.6" fill="none"/>
      <ellipse cx="22" cy="26" rx="18" ry="4" fill="none" stroke="#f2d27a" stroke-width="1.4" transform="rotate(-18 22 26)"/>
      <path d="M11.5 22.5a11 11 0 0 1 21 0" fill="#e07a3a" transform="rotate(-18 22 26)" opacity="0"/>
      <g transform="rotate(30 48 64)">
        <path d="M48 44c5 5 6 14 5 24h-10c-1-10 0-19 5-24z" fill="#e8e8f0" stroke="#000" stroke-width=".7"/>
        <circle cx="48" cy="56" r="2.6" fill="#3ab0ff" stroke="#000" stroke-width=".6"/>
        <path d="M43 62l-5 8h5zM53 62l5 8h-5z" fill="#d02020" stroke="#000" stroke-width=".6"/>
        <path d="M44.5 68h7l-1.5 4h-4z" fill="#888" stroke="#000" stroke-width=".5"/>
        <path d="M46 72c-1 5 1 9 2 12 1-3 3-7 2-12z" fill="#ffb020"/>
        <path d="M47 72c-.5 3 .5 5 1 7 .5-2 1.5-4 1-7z" fill="#fff6a0"/>
      </g>`),
  },
]

export const DEFAULT_BACK = "lattice"

// ---- caches ----

const faceCache = new Map()
const backCache = new Map()

export const faceUrl = (card) => {
  let url = faceCache.get(card.id)
  if (!url) {
    url = toUrl(faceSvg(card))
    faceCache.set(card.id, url)
  }
  return url
}

export const backUrl = (id) => {
  let url = backCache.get(id)
  if (!url) {
    const back = BACKS.find((b) => b.id === id) || BACKS[0]
    url = toUrl(back.svg())
    backCache.set(id, url)
  }
  return url
}
