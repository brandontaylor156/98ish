// Locker Room data tests: every look that comes in (old saves, the World Tour's players,
// another browser's hello) comes out complete and valid; themes dress a look; computer
// players get sensible kits; the server checks online looks with the same lists.
// Run: node --test client/src/components/applets/pickleball/locker.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { CHARACTERS, OUTFITS, SKIN } from "./looks.js"
import { DEFAULT_LOOK, LOOK_IDS, LOOK_STYLES, LOOK_COLORS, LOOK_FLAGS, HEIGHT, THEMES, VENUE_THEMES, applyTheme, characterLook, isColor, lookForPlayer, lookPayload, randomLook, validateLook, validateLooks, defaultStyleFor } from "./locker.js"
import { seeded } from "./match.js"

const require = createRequire(import.meta.url)
const server = require("../../../../../server/arcade/games/pickleballLooks.js")

// a look is complete and valid: every field there, ids known, colors #rrggbb
const assertValid = (look, msg = "") => {
  for (const k of Object.keys(DEFAULT_LOOK)) assert.ok(k in look, `${msg} has ${k}`)
  for (const [k, list] of Object.entries(LOOK_IDS)) assert.ok(list.includes(look[k]), `${msg} ${k}=${look[k]}`)
  for (const k of LOOK_COLORS) assert.ok(isColor(look[k]), `${msg} ${k}=${look[k]} is a color`)
  for (const k of LOOK_FLAGS) assert.equal(typeof look[k], "boolean", `${msg} ${k}`)
  assert.ok(look.height >= HEIGHT.min && look.height <= HEIGHT.max, `${msg} height`)
  if (look.theme !== "custom") assert.ok(LOOK_STYLES[look.theme].includes(look.style), `${msg} style ${look.style}`)
}

test("the World Tour's players (old looks) come out as complete looks", () => {
  for (const c of CHARACTERS)
    for (const o of OUTFITS) {
      const look = characterLook(c.id, o.id)
      assertValid(look, `${c.id}/${o.id}`)
      assert.equal(look.body, c.look.body)
      assert.equal(look.skin, SKIN[c.look.skin]) // index -> the same tone
    }
  // old field forms
  const old = validateLook({ body: "m", skin: 5, hair: "spiky", glasses: true, build: 1.08, beard: true })
  assert.equal(old.skin, SKIN[5])
  assert.equal(old.hair, "buzz")
  assert.equal(old.glasses, "shades")
  assert.equal(old.build, "strong")
  assert.equal(old.beard, true)
  assert.equal(validateLook({ body: "f", hair: "spiky" }).hair, "pixie")
  assert.equal(validateLook({ body: "f", hair: "ponytail", glasses: false }).glasses, "none")
})

test("junk in, a valid look out (bad values take the defaults)", () => {
  const junk = [null, undefined, 7, "x", [], { body: "q", skin: "red", hair: 3, height: 9, build: "huge", shirt: "#12345", trim: "#GGGGGG", hat: "crown", glasses: "x", wristbands: "yes", paddleDesign: "<b>", theme: "space", style: 4 }, { height: -Infinity }, { height: NaN }, { skin: 99 }]
  for (const j of junk) assertValid(validateLook(j), JSON.stringify(j))
  const v = validateLook({ height: 0.5, shirt: "#ABCDEF", beard: true })
  assert.equal(v.height, HEIGHT.min)
  assert.equal(v.shirt, "#abcdef")
  assert.equal(v.beard, false, "only Body A has a beard")
  // a one-piece is its own bottom
  assert.equal(validateLook({ shirtStyle: "onepiece", bottom: "pants" }).bottom, "swim")
  // unknown fields are dropped
  assert.equal(validateLook({ evil: "<script>" }).evil, undefined)
  // a look checks out the same twice
  const once = validateLook({ body: "m", theme: "winter" })
  assert.deepEqual(validateLook(once), once)
})

test("themes: every style dresses any look into a valid kit", () => {
  for (const base of [DEFAULT_LOOK, characterLook("dex"), characterLook("lena"), characterLook("gus", "away")])
    for (const t of THEMES)
      for (const s of t.styles) {
        const look = applyTheme(base, t.id, s.id, ["#1d3557", "#ffd166"])
        assertValid(look, `${t.id}/${s.id}`)
        assert.equal(look.theme, t.id)
        assert.equal(look.style, s.id)
        // the person stays themselves
        for (const k of ["body", "skin", "hair", "hairColor", "height", "build"]) assert.equal(look[k], validateLook(base)[k])
      }
  // the themes' signature pieces
  const beach = applyTheme(DEFAULT_LOOK, "beach", "board")
  assert.equal(beach.bottom, "board")
  assert.equal(beach.glasses, "shades")
  const one = applyTheme(DEFAULT_LOOK, "beach", "onepiece")
  assert.equal(one.shirtStyle, "onepiece")
  const winter = applyTheme(DEFAULT_LOOK, "winter", "jacket")
  assert.equal(winter.shirtStyle, "jacket")
  assert.equal(winter.bottom, "pants")
  assert.equal(winter.hat, "beanie")
  assert.equal(winter.gloves, true)
  const retro = applyTheme(DEFAULT_LOOK, "retro", "80s")
  assert.equal(retro.sockStyle, "knee")
  assert.equal(retro.hat, "headband")
  assert.equal(retro.wristbands, true)
  const classic = applyTheme({ ...DEFAULT_LOOK, shirt: "#ffffff", trim: "#ffffff" }, "classic", "polo")
  assert.equal(classic.shirt, "#ffffff")
  assert.notEqual(classic.trim, "#ffffff", "classic whites keep a color that shows")
  // unknown theme: custom
  assert.equal(applyTheme(DEFAULT_LOOK, "space").theme, "custom")
  for (const t of THEMES) for (const body of ["m", "f"]) assert.ok(t.styles.some((s) => s.id === defaultStyleFor(t.id, body)))
})

test("computer players: random kits are valid, varied, keep the person, and suit the venue", () => {
  const rand = seeded(42)
  const seen = new Set()
  let venueFits = 0
  const N = 300
  for (let i = 0; i < N; i++) {
    const c = CHARACTERS[i % CHARACTERS.length]
    const base = characterLook(c.id)
    const look = randomLook(rand, base, { venue: "beach" })
    assertValid(look, `random ${i}`)
    for (const k of ["body", "skin", "hair", "hairColor"]) assert.equal(look[k], base[k])
    assert.notEqual(look.paddle, look.paddleEdge)
    seen.add(`${look.theme}/${look.style}/${look.shirt}`)
    if (look.theme === "beach") venueFits++
  }
  assert.ok(seen.size > 40, `varied: ${seen.size} different kits`)
  assert.ok(venueFits > N * 0.6 && venueFits < N, `mostly beach kits at the beach (${venueFits}/${N})`)
  // the same seed, the same kits (every browser in an online game would agree)
  const a = randomLook(seeded(7), characterLook("maya"), { venue: "winter" })
  const b = randomLook(seeded(7), characterLook("maya"), { venue: "winter" })
  assert.deepEqual(a, b)
})

test("what a player wears: saved looks, computer players' kits, outfits by venue", () => {
  const mine = applyTheme(characterLook("maya"), "pro", "tech", ["#ff7a1a", "#111111"])
  const prefs = { looks: { maya: mine }, aiLooks: "own", autoVenue: false }
  assert.deepEqual(lookForPlayer(prefs, { character: "maya" }), mine)
  // no saved look: their own kit in the outfit
  assert.deepEqual(lookForPlayer(prefs, { character: "dex", outfit: "away" }), characterLook("dex", "away"))
  // computer players in random kits (but a saved look wins)
  const r = lookForPlayer({ ...prefs, aiLooks: "random" }, { character: "dex", ai: true }, "park", seeded(3))
  assertValid(r)
  assert.deepEqual(lookForPlayer({ ...prefs, aiLooks: "random" }, { character: "maya", ai: true }, "park", seeded(3)), mine)
  // by venue: the venue's theme, the person's colors
  for (const [venue, theme] of Object.entries(VENUE_THEMES)) {
    const look = lookForPlayer({ ...prefs, autoVenue: true }, { character: "maya" }, venue)
    assert.equal(look.theme, theme)
    assertValid(look, venue)
  }
  // saved looks: a bad entry is checked, unknown characters dropped
  const looks = validateLooks({ maya: { shirt: "nope" }, nobody: {}, dex: 5 })
  assert.deepEqual(Object.keys(looks), ["maya"])
  assertValid(looks.maya)
  assert.deepEqual(validateLooks("x"), {})
})

test("online: a look is small, and the server's checks use the same lists as the Locker Room", () => {
  // same ids, styles, colors, flags, height range
  assert.deepEqual(server.LOOK_IDS, LOOK_IDS)
  assert.deepEqual(server.LOOK_STYLES, LOOK_STYLES)
  assert.deepEqual(server.LOOK_COLORS, LOOK_COLORS)
  assert.deepEqual(server.LOOK_FLAGS, LOOK_FLAGS)
  assert.deepEqual(server.HEIGHT, HEIGHT)
  // every valid look passes the server unchanged
  const rand = seeded(9)
  for (let i = 0; i < 60; i++) {
    const look = lookPayload(randomLook(rand, characterLook(CHARACTERS[i % 10].id), { venue: ["park", "beach", "winter"][i % 3] }))
    assert.ok(JSON.stringify(look).length < 900, "small enough to send")
    assert.deepEqual(validateLook(server.sanitizeLook(look)), look)
  }
  // and what the server lets through, the client completes into a valid look
  const hostile = { body: "f", hat: "crown", shirt: "#fff", height: "1.0", style: "onepiece" }
  assertValid(validateLook(server.sanitizeLook(hostile)))
})
