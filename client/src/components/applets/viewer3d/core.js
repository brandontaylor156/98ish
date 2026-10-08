// 3D Viewer 98 / Snap to 3D: the pure parts (no three.js, no DOM), so tests run in Node.
//
// A model is a binary glTF (.glb) or a JSON glTF (.gltf, embedded buffers only) kept on
// drive C: in C:\My 3D. Made from a photo by a free Hugging Face Space (TRELLIS.2, MIT,
// for objects; AniGen, MIT, for rigged creatures), or imported. Budgets keep it phone-sized.

export const FOLDER = "My 3D"
export const MAX_MODELS = 20 // per person (the oldest goes)
export const MAX_BYTES = 8 * 1024 * 1024 // a model on the drive
export const MAX_TRIS = 30_000 // what the viewer/park draws (bigger ones are simplified once)
export const SEND_BYTES = 2 * 1024 * 1024 // a model sent in 98 Messenger (server/aim/media.js "model")
export const SEND_TRIS = 15_000
export const PET_HEIGHT = 0.6 // a model placed in My Park is scaled to about this tall (m)

const GLB_MAGIC = 0x46546c67 // "glTF"

// what kind of file is this? -> "glb" | "gltf" | null
export const sniff = (bytes) => {
  if (!bytes || bytes.length < 12) return null
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (dv.getUint32(0, true) === GLB_MAGIC) return "glb"
  // JSON glTF: starts with "{" (after whitespace) and has an "asset" object
  let i = 0
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x0a || bytes[i] === 0x0d || bytes[i] === 0x09 || bytes[i] === 0xef || bytes[i] === 0xbb || bytes[i] === 0xbf)) i++
  if (bytes[i] !== 0x7b) return null
  const head = new TextDecoder().decode(bytes.subarray(i, Math.min(bytes.length, i + 4096)))
  return /"asset"\s*:/.test(head) ? "gltf" : null
}

// -> { ok, format } | { ok: false, error }
export const validateModel = (bytes, { maxBytes = MAX_BYTES } = {}) => {
  if (!bytes?.length) return { ok: false, error: "That file is empty." }
  if (bytes.length > maxBytes) return { ok: false, error: `That model is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is ${Math.round(maxBytes / 1048576)} MB.` }
  const format = sniff(bytes)
  if (!format) return { ok: false, error: "That isn't a 3D model 3D Viewer can open (use a .glb or .gltf file)." }
  if (format === "glb") {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const version = dv.getUint32(4, true)
    const length = dv.getUint32(8, true)
    if (version !== 2) return { ok: false, error: "That .glb is an old glTF version (only glTF 2.0 opens)." }
    if (length > bytes.length) return { ok: false, error: "That .glb is cut short (the download may not have finished)." }
  } else {
    // a .gltf must carry its buffers inside (data: URIs): there's nowhere to fetch others from
    const text = new TextDecoder().decode(bytes)
    let json
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, error: "That .gltf file isn't valid JSON." }
    }
    const external = [...(json.buffers || []), ...(json.images || [])].some((b) => b.uri && !String(b.uri).startsWith("data:"))
    if (external) return { ok: false, error: "That .gltf points to other files. Export it as a single .glb instead." }
  }
  return { ok: true, format }
}

// how much to keep when simplifying (0-1): 1 means leave it alone
export const keepRatio = (tris, max = MAX_TRIS) => (tris <= max ? 1 : Math.max(0.02, Math.min(1, max / tris)))

// texture size that fits a byte budget, roughly (JPEG ~ 0.25 byte/pixel at q0.8)
export const textureFor = (budgetBytes, current = 2048) => {
  let s = current
  while (s > 256 && s * s * 0.25 > budgetBytes * 0.7) s /= 2
  return s
}

// the drive list after adding one (newest first) and what to drop
export const nextModels = (list, add, max = MAX_MODELS) => {
  const others = list.filter((m) => m.name !== add.name).sort((a, b) => (b.at || 0) - (a.at || 0))
  return { keep: [add, ...others].slice(0, max), drop: others.slice(max - 1) }
}

// a file name from a title: "Red Mug" -> "Red Mug.glb" (safe characters only)
export const modelName = (title, format = "glb") => {
  const base = String(title || "Model").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "Model"
  return `${base}.${format}`
}

// scale so the model's tallest side is `height` meters (bounding box size {x, y, z})
export const fitScale = (size, height = PET_HEIGHT) => {
  const m = Math.max(size?.x || 0, size?.y || 0, size?.z || 0)
  return m > 1e-6 ? height / m : 1
}

// ---- a model in My Park: it trots after you (it never moves you) ----
// The pet aims for a spot beside and behind you; inside `rest` meters it stops and looks
// around; farther than `leash` it hurries; past `teleport` (you went through a door, up the
// stairs) it pops back next to you. Returns the new { x, z, yaw, speed, moving }.
export const PET = { side: 0.7, back: 0.9, rest: 0.45, walk: 1.6, run: 4.2, leash: 3.5, teleport: 14 }

export const petTarget = (you) => {
  const yaw = you.yaw || 0
  // (yaw 0 faces +z: behind is -z, the right side is -x)
  return { x: you.x - Math.sin(yaw) * PET.back - Math.cos(yaw) * PET.side, z: you.z - Math.cos(yaw) * PET.back + Math.sin(yaw) * PET.side }
}

export const stepPet = (pet, you, dt) => {
  const t = petTarget(you)
  const dx = t.x - pet.x
  const dz = t.z - pet.z
  const d = Math.hypot(dx, dz)
  if (d > PET.teleport) return { x: t.x, z: t.z, yaw: you.yaw || 0, speed: 0, moving: false }
  if (d < PET.rest) {
    // settle: slow to a stop, turn to face the way you face
    const speed = Math.max(0, (pet.speed || 0) - 6 * dt)
    let dy = (you.yaw || 0) - (pet.yaw || 0)
    dy = Math.atan2(Math.sin(dy), Math.cos(dy))
    return { x: pet.x, z: pet.z, yaw: (pet.yaw || 0) + dy * Math.min(1, dt * 3), speed, moving: speed > 0.05 }
  }
  const want = d > PET.leash ? PET.run : PET.walk
  const speed = (pet.speed || 0) + (want - (pet.speed || 0)) * Math.min(1, dt * 4)
  const stepLen = Math.min(d, speed * dt)
  const yaw = Math.atan2(dx, dz)
  return { x: pet.x + (dx / d) * stepLen, z: pet.z + (dz / d) * stepLen, yaw, speed, moving: true }
}

// "Try again in 22:25:24." -> "in about 22 hours"; for the honest quota message
export const quotaWait = (message) => {
  const m = /Try again in (\d+):(\d{2}):(\d{2})/.exec(String(message || ""))
  if (!m) return ""
  const h = Number(m[1])
  const min = Number(m[2])
  return h >= 1 ? `in about ${h} hour${h === 1 ? "" : "s"}` : `in about ${Math.max(1, min)} minute${min === 1 ? "" : "s"}`
}

// "(120s requested vs. 149s left)" -> { requested: 120, left: 149 } (or nulls)
export const quotaNumbers = (message) => {
  const m = /\((\d+)s requested vs\.? (\d+)s left\)/.exec(String(message || ""))
  return m ? { requested: Number(m[1]), left: Number(m[2]) } : { requested: null, left: null }
}

// seconds -> "2 min 29 s" / "45 s"
export const minutesText = (s) => {
  const n = Math.max(0, Math.round(s || 0))
  return n >= 60 ? `${Math.floor(n / 60)} min${n % 60 ? ` ${n % 60} s` : ""}` : `${n} s`
}

// The free image-to-3D Spaces, best first. All run on Hugging Face's ZeroGPU, where your free
// GPU time is one daily allowance shared by every Space (more with a free token), and each
// request reserves its `gpu` seconds up front: a Space that asks for less can still run when
// a bigger one is refused. `textured`: false ones come back as plain shapes, which 3D Viewer
// colors from your photo (paint.js).
export const PHOTO_SPACES = [
  { id: "trellis2", space: "microsoft/TRELLIS.2", name: "TRELLIS.2", textured: true, gpu: 150 },
  { id: "hunyuan2", space: "tencent/Hunyuan3D-2", name: "Hunyuan3D-2", textured: false, gpu: 30 },
  { id: "hunyuan21", space: "tencent/Hunyuan3D-2.1", name: "Hunyuan3D-2.1", textured: false, gpu: 40 },
  { id: "trellis", space: "trellis-community/TRELLIS", name: "TRELLIS", textured: true, gpu: 120 },
  { id: "triposg", space: "VAST-AI/TripoSG", name: "TripoSG", textured: false, gpu: 60 },
]

// The order to try them in, given what's known about today's allowance (`left` seconds, or
// null when unknown): ones that fit come first, best first; ones known not to fit go last
// (the guess may be stale), and ones that just failed for another reason are skipped.
export const planSpaces = (spaces, { left = null, skip = [] } = {}) => {
  const list = spaces.filter((s) => !skip.includes(s.id))
  if (left == null) return list
  return [...list.filter((s) => s.gpu <= left), ...list.filter((s) => s.gpu > left)]
}

// Coloring a plain shape from the photo (paint.js): where the subject is in the photo, and
// which photo pixel a point of the model gets when the photo is projected onto its front.
// rgba: Uint8ClampedArray (w*h*4) -> { x0, y0, x1, y1 } of what differs from the corners'
// background (or the whole photo when nothing stands out)
export const subjectBox = (rgba, w, h, { tolerance = 48 } = {}) => {
  const at = (x, y) => (y * w + x) * 4
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)]
  const bg = [0, 1, 2].map((c) => corners.reduce((s, i) => s + rgba[i + c], 0) / 4)
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  const step = Math.max(1, Math.floor(Math.min(w, h) / 256))
  for (let y = 0; y < h; y += step)
    for (let x = 0; x < w; x += step) {
      const i = at(x, y)
      if (rgba[i + 3] < 128) continue
      const d = Math.abs(rgba[i] - bg[0]) + Math.abs(rgba[i + 1] - bg[1]) + Math.abs(rgba[i + 2] - bg[2])
      if (d < tolerance) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  if (x1 < x0 || y1 < y0 || (x1 - x0) * (y1 - y0) < w * h * 0.01) return { x0: 0, y0: 0, x1: w - 1, y1: h - 1 }
  return { x0, y0, x1, y1 }
}
// a model point (x, y) inside its bounding box (min/max of x and y) -> the photo pixel over it,
// the model's front matched to the subject's box in the photo
export const photoPixel = (x, y, box3, box2) => {
  const u = (x - box3.minX) / Math.max(1e-6, box3.maxX - box3.minX)
  const v = (box3.maxY - y) / Math.max(1e-6, box3.maxY - box3.minY)
  return [Math.round(box2.x0 + Math.min(1, Math.max(0, u)) * (box2.x1 - box2.x0)), Math.round(box2.y0 + Math.min(1, Math.max(0, v)) * (box2.y1 - box2.y0))]
}

// a Space error -> words a person can act on
export const spaceError = (e) => {
  const msg = String(e?.message || e?.title || e || "")
  if (/ZeroGPU quota|exceeded your .*quota/i.test(msg)) {
    const wait = quotaWait(msg)
    const { left, requested } = quotaNumbers(msg)
    return {
      quota: true,
      left,
      requested,
      text: `Today's free 3D time on Hugging Face is used up${left != null ? ` (${minutesText(left)} left, and this needs ${minutesText(requested)})` : ""}${wait ? `; it comes back ${wait}` : ""}. A free Hugging Face token (More options) gives you more each day.`,
    }
  }
  if (/ZeroGPU worker error|GPU task aborted|CUDA|RuntimeError/i.test(msg)) return { text: "The free 3D service had a hiccup on its graphics card. Try again in a minute." }
  if (/queue|too many|busy|capacity/i.test(msg)) return { text: "The free 3D service is busy right now. Try again in a few minutes." }
  if (/sleep|paused|building|not running|503|502/i.test(msg)) return { text: "The free 3D service is asleep or restarting. Try again in a minute." }
  return { text: `The free 3D service couldn't make a model${msg ? ` (${msg.slice(0, 120)})` : ""}. You can still import a .glb file.` }
}
