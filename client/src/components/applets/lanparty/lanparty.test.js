import test from "node:test"
import assert from "node:assert/strict"
import { DOS_GAMES, KEY, diskOptions, dosboxConf, gameById, gameForExe, launchLine, routeFile } from "./catalog.js"
import { MAX_SAVE_BYTES, fromDataUrl, saveName, toDataUrl } from "./savesCore.js"

const doom = gameById("doom")

test("launch lines: alone, host and join run the same IPXSETUP line; nodes and skill are clamped", () => {
  assert.equal(launchLine(doom), "DOOM.EXE -skill 3")
  assert.equal(launchLine(doom, { mode: "host", nodes: 3, deathmatch: true }), "IPXSETUP.EXE -nodes 3 -deathmatch -skill 3")
  assert.equal(launchLine(doom, { mode: "join", nodes: 3, deathmatch: true }), launchLine(doom, { mode: "host", nodes: 3, deathmatch: true }))
  assert.equal(launchLine(doom, { mode: "host", nodes: 99, skill: 9 }), "IPXSETUP.EXE -nodes 4 -skill 5")
  assert.equal(launchLine(doom, { mode: "host", nodes: 1, skill: 0 }), "IPXSETUP.EXE -nodes 2 -skill 1")
  assert.throws(() => launchLine(null))
})

test("the DOSBox config: IPX on, the drive mounted, the launch line last", () => {
  const conf = dosboxConf(gameById("heretic"), { mode: "host", nodes: 2 })
  assert.match(conf, /\[ipx\]\nipx=true/)
  assert.match(conf, /\[autoexec\]\necho off\nmount c \.\nc:\ncls\nIPXSETUP\.EXE -nodes 2 -skill 3\n$/)
  for (const section of ["[sdl]", "[dosbox]", "[cpu]", "[sblaster]", "[dos]"]) assert.ok(conf.includes(section), section)
})

test("every bundled game: a bundle URL, an EXE, LAN support and controls that send real keys", () => {
  assert.ok(DOS_GAMES.length >= 2)
  for (const g of DOS_GAMES) {
    assert.match(g.url, /^\/emu\/games\/[a-z]+\.jsdos$/)
    assert.match(g.exe, /^[A-Z0-9]+\.EXE$/)
    assert.equal(g.lan.setup, "IPXSETUP.EXE")
    assert.match(g.terms, /distribute/i)
    for (const c of g.controls) {
      assert.ok(KEY[c.key], `${g.id} ${c.id}`)
      for (const k of c.cycle || []) assert.ok(KEY[k], k)
      assert.ok(c.default.portrait && c.default.landscape, c.id)
    }
  }
})

test("which program opens a file: Flash, disk images, bundled game EXEs", () => {
  assert.deepEqual(routeFile("cool game.SWF"), { program: "LAN Party 98", kind: "flash" })
  assert.deepEqual(routeFile("win98.iso"), { program: "Virtual PC 98", kind: "disk" })
  assert.deepEqual(routeFile("boot.img"), { program: "Virtual PC 98", kind: "disk" })
  assert.equal(routeFile("notes.txt"), null)
  assert.equal(gameForExe("C:\\Games\\DOOM\\DOOM.EXE").id, "doom")
  assert.equal(gameForExe("C:/Games/HERETIC/HERETIC.EXE").id, "heretic")
  assert.equal(gameForExe("C:/Games/QUAKE/QUAKE.EXE"), null)
})

test("Virtual PC boots FreeDOS by default; an image boots as CD, floppy or hard disk by its kind and size", () => {
  assert.deepEqual(diskOptions(null), { fda: { url: "/emu/vm/freedos722.img" } })
  const small = new ArrayBuffer(1474560)
  const big = new ArrayBuffer(10 * 1024 * 1024)
  assert.ok(diskOptions({ name: "a.img", buffer: small }).fda)
  assert.ok(diskOptions({ name: "c.img", buffer: big }).hda)
  assert.ok(diskOptions({ name: "win98.ISO", buffer: big }).cdrom)
})

test("saves: one file per game, bytes survive the trip through a data URL", () => {
  assert.equal(saveName("/emu/games/doom.jsdos.changes"), "DOOM.SAV")
  assert.equal(saveName("https://x/heretic.jsdos.changes"), "HERETIC.SAV")
  assert.equal(saveName("weird"), "GAME.SAV")
  const bytes = new Uint8Array(70000).map((_, i) => (i * 31) % 256)
  const url = toDataUrl(bytes)
  assert.match(url, /^data:application\/octet-stream;base64,/)
  assert.deepEqual(fromDataUrl(url), bytes)
  assert.equal(fromDataUrl("not a data url"), null)
  assert.equal(MAX_SAVE_BYTES, 4 * 1024 * 1024)
})
