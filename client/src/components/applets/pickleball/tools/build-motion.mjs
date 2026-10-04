// Builds Pickleball 98's motion-matching database (client/public/assets/pickleball/motion.json
// + motion.bin) from motion capture. Not part of the app; run by hand when the data changes.
// Node built-ins only.
//
//   node build-motion.mjs <sources dir> <out dir> [--dump file.json]
//
// <sources dir> holds the selected takes (see TAKES and ../CREDITS.md for where they come
// from): 100STYLE BVH files (Ian Mason et al., CC BY 4.0, Zenodo 10.5281/zenodo.8127870) and
// CMU Graphics Lab Motion Capture Database ASF/AMC files (mocap.cs.cmu.edu, free for all
// uses). Each take is retargeted to the canonical skeleton (mm/skeleton.js), resampled to
// 30 fps, its root extracted, its feet put on the court and its foot contacts labeled
// (mm/retarget-src.js), then written as quantized deltas, gzipped (mm/db.js).

import fs from "fs"
import path from "path"
import { parseBVH, parseASF, parseAMC } from "../mm/bvh.js"
import { MAPS, buildMap, sampleTake, extractRoot, groundTake, labelContacts } from "../mm/retarget-src.js"
import zlib from "zlib"
import { encodeDB, useZlib } from "../mm/db.js"
import { TAKES, EXTRA } from "./motion-takes.mjs"

const [srcDir, outDir] = process.argv.slice(2)
const dumpAt = process.argv.indexOf("--dump")
const dumpFile = dumpAt > 0 ? process.argv[dumpAt + 1] : null
const only = process.argv.indexOf("--only") > 0 ? new RegExp(process.argv[process.argv.indexOf("--only") + 1]) : null
if (!srcDir || !outDir) {
  console.log("usage: node build-motion.mjs <sources dir> <out dir> [--dump file.json] [--only regex]")
  process.exit(1)
}

useZlib(zlib)
const FPS = 30
const asfCache = {}
const clips = []
for (const t of process.argv.includes("--extra") ? EXTRA : TAKES) {
  if (only && !only.test(t.name)) continue
  let skel
  let names
  if (t.file.endsWith(".bvh")) {
    skel = parseBVH(fs.readFileSync(path.join(srcDir, t.file), "utf8"))
    names = MAPS.style100
  } else {
    const subj = t.file.split("_")[0]
    asfCache[subj] ||= parseASF(fs.readFileSync(path.join(srcDir, subj + ".asf"), "utf8"))
    skel = parseAMC(asfCache[subj], fs.readFileSync(path.join(srcDir, t.file), "utf8"), 120)
    names = MAPS.cmu
  }
  const m = buildMap(skel, names)
  for (const [from, to] of t.ranges) {
    const raw = sampleTake(skel, m, { from: Math.max(0, from), to: Math.min(skel.frames.length - 1, to), fps: FPS })
    const frames = extractRoot(raw)
    const floor = groundTake(frames)
    const contacts = labelContacts(frames, FPS)
    clips.push({ name: `${t.name}@${from}`, tags: t.tags, frames, contacts })
    console.log(t.name, from, to, "->", frames.length, "frames, floor", floor.toFixed(3))
  }
}
const total = clips.reduce((s, c) => s + c.frames.length, 0)
console.log("clips", clips.length, "frames", total, "(" + (total / FPS / 60).toFixed(1) + " min)")
fs.mkdirSync(outDir, { recursive: true })
const { json, bin } = encodeDB(clips, FPS)
fs.writeFileSync(path.join(outDir, "motion.json"), JSON.stringify(json))
fs.writeFileSync(path.join(outDir, "motion.bin"), bin)
console.log("motion.bin", bin.length, "bytes; motion.json", JSON.stringify(json).length)
if (dumpFile) {
  const r = (v) => Math.round(v * 1e4) / 1e4
  fs.writeFileSync(dumpFile, JSON.stringify(clips.map((c) => ({ name: c.name, tags: c.tags, contacts: c.contacts, frames: c.frames.map((f) => ({ root: [r(f.root.x), r(f.root.z), r(f.root.yaw)], hip: [r(f.hip.x), r(f.hip.y), r(f.hip.z)], D: f.D.map((q) => [r(q.x), r(q.y), r(q.z), r(q.w)]) })) }))))
}
