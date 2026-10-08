// Snap to 3D: a photo -> a 3D model, on free Hugging Face Spaces called straight from this
// browser (the photo goes to Hugging Face only when you tap Make 3D; Render never carries it).
//
//   makeFromPhoto: a chain of free image-to-3D Spaces (core.js PHOTO_SPACES), best first:
//     TRELLIS.2 (textured), Hunyuan3D-2 and 2.1 (shape; colored from the photo here), the
//     community TRELLIS (textured), TripoSG (shape). A Space that's out of free time, busy,
//     asleep or broken hands over to the next, and the person sees which one is working,
//     their place in its line, and how much free time is left today.
//   bringToLife:   VAST-AI/AniGen (MIT; its NC CUBVH extension runs only inside their Space):
//     one image -> a rigged .glb with a skeleton.
//
// They all run on ZeroGPU: each visitor gets one small free allowance a day shared by every
// Space (a few minutes signed out, more with a free Hugging Face token). A request reserves
// its GPU time up front, so a cheaper Space can run when a bigger one is refused. The token is
// kept on this device per 98ish user (localStorage through utils/userStorage.js), sent only to
// Hugging Face, and forgotten by Delete My Account (utils/account.js).
import { PHOTO_SPACES, minutesText, planSpaces, spaceError } from "./core.js"

export const TRELLIS = "microsoft/TRELLIS.2"
export const ANIGEN = "VAST-AI/AniGen"
const TOKEN_KEY = "98ish.hfToken"
const QUOTA_KEY = "98ish.hfQuota" // { left, at, token: bool }: the last free time Hugging Face told us about

export const getToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY) || ""
  } catch {
    return ""
  }
}
export const setToken = (t) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, String(t).trim())
    else localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(QUOTA_KEY) // a new token, a new allowance
  } catch {}
}

// What's known about today's free time: { left (s), at, token } or null. Hugging Face says how
// much is left only when it refuses a request; a success uses about the Space's estimate.
export const getQuota = () => {
  try {
    const q = JSON.parse(localStorage.getItem(QUOTA_KEY) || "null")
    // the allowance refills over a day: forget a guess older than that
    if (!q || Date.now() - q.at > 24 * 3600_000 || q.token !== !!getToken()) return null
    return q
  } catch {
    return null
  }
}
const noteQuota = (left) => {
  try {
    if (left == null) return
    localStorage.setItem(QUOTA_KEY, JSON.stringify({ left: Math.max(0, Math.round(left)), at: Date.now(), token: !!getToken() }))
  } catch {}
}
export const quotaLine = (q = getQuota()) =>
  !q ? "" : q.left <= 0 ? "Today's free time for the bigger 3D services is used up; the quicker ones may still work." : `About ${minutesText(q.left)} of free 3D time left today${q.token ? " (with your token)" : ""}.`

// Checks a token with Hugging Face itself (the only place it's sent): -> { ok, name } | { ok: false, error }
export const checkToken = async (token) => {
  try {
    const res = await fetch("https://huggingface.co/api/whoami-v2", { headers: { Authorization: `Bearer ${String(token).trim()}` } })
    if (res.status === 401) return { ok: false, error: "Hugging Face doesn't know that token. Copy it again from huggingface.co (Settings > Access Tokens)." }
    if (!res.ok) return { ok: false, error: `Hugging Face didn't answer (${res.status}). Try again later.` }
    const me = await res.json()
    return { ok: true, name: me?.name || me?.fullname || "you" }
  } catch {
    return { ok: false, error: "Couldn't reach Hugging Face to check it." }
  }
}

class SpaceError extends Error {
  constructor(info) {
    super(info.text)
    this.quota = !!info.quota
    this.left = info.left ?? null
  }
}
const fail = (e) => {
  if (e instanceof SpaceError) throw e
  const info = spaceError(e)
  if (info.quota) noteQuota(info.left ?? 0) // (no number given: treat it as none left, so cheaper Spaces go first next time)
  throw new SpaceError(info)
}

const connect = async (space, onStatus, label) => {
  const { Client } = await import("@gradio/client")
  onStatus?.(`Waking up ${label} (it can take a minute)...`)
  const token = getToken()
  try {
    return await Client.connect(space, token ? { hf_token: token } : undefined)
  } catch (e) {
    fail(e)
  }
}

const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`

// One Space call, with its queue reported as it moves ("in line: 3rd, about 40 s")
const call = async (app, endpoint, data, { onStatus, doing }) => {
  onStatus?.(doing)
  let job
  try {
    // (the 5th argument asks for every status event too, as the client's own predict() does:
    // without it, a refusal like "out of free GPU time" never shows up here)
    job = app.submit(endpoint, data, null, null, true)
  } catch {
    job = null
  }
  if (!job || typeof job[Symbol.asyncIterator] !== "function") {
    try {
      return await app.predict(endpoint, data)
    } catch (e) {
      fail(e)
    }
  }
  let result = null
  let complete = false
  try {
    for await (const ev of job) {
      if (ev.type === "status") {
        if (ev.stage === "error") fail(ev)
        if (ev.stage === "complete") {
          complete = true
          if (result) return result
        }
        if (ev.queue && ev.position != null && ev.position > 0) onStatus?.(`${doing} You're ${ordinal(ev.position + 1)} in line${ev.eta ? `, about ${Math.round(ev.eta)} s` : ""}.`)
      }
      if (ev.type === "data") {
        result = ev
        if (complete) return result
      }
    }
  } catch (e) {
    fail(e)
  }
  if (result) return result
  fail(new Error("no answer"))
}

const fetchBytes = async (url, token) => {
  const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
  if (!res.ok) throw new SpaceError({ text: `The model couldn't be downloaded from Hugging Face (${res.status}).` })
  return new Uint8Array(await res.arrayBuffer())
}

// the first file URL in a Gradio result's data
const fileUrl = (data) => {
  for (const d of data || []) {
    if (d?.url) return d.url
    if (d?.value?.url) return d.value.url
  }
  return null
}
const fileOf = (d) => d?.value || d

// ---- one adapter per Space: (app, photo, opts) -> url of a .glb ----
const RUNNERS = {
  // TRELLIS.2: cut out, image_to_3d, extract_glb (textured)
  trellis2: async (app, photo, { onStatus, handle_file, resolution = "512", triangles = 30000, texture = 1024 }) => {
    try {
      await app.predict("/start_session", [])
    } catch {}
    let image = handle_file(photo)
    const pre = await call(app, "/preprocess_image", { input: image }, { onStatus, doing: "Cutting out the subject..." })
    const url = fileUrl(pre.data)
    if (url) image = handle_file(url)
    await call(app, "/image_to_3d", { image, seed: 0, resolution }, { onStatus, doing: "Building the shape and colors (1-2 minutes)..." })
    const out = await call(app, "/extract_glb", { decimation_target: triangles, texture_size: texture }, { onStatus, doing: "Packing the 3D model..." })
    return fileUrl(out.data)
  },
  // Hunyuan3D-2 / 2.1: the shape (its own background removal), then its exporter cuts it to 30k faces
  hunyuan2: async (app, photo, opts) => hunyuan(app, photo, { ...opts, caption: true }),
  hunyuan21: async (app, photo, opts) => hunyuan(app, photo, { ...opts, caption: false }),
  // the community TRELLIS: one call does it all (textured)
  trellis: async (app, photo, { onStatus, handle_file }) => {
    try {
      await app.predict("/start_session", [])
    } catch {}
    const out = await call(
      app,
      "/generate_and_extract_glb",
      { image: handle_file(photo), multiimages: [], seed: 0, ss_guidance_strength: 7.5, ss_sampling_steps: 12, slat_guidance_strength: 3, slat_sampling_steps: 12, multiimage_algo: "stochastic", mesh_simplify: 0.95, texture_size: 1024 },
      { onStatus, doing: "Building the shape and colors (1-2 minutes)..." }
    )
    return out.data?.[1]?.url || out.data?.[2]?.url || fileUrl(out.data?.slice?.(1))
  },
  // TripoSG: cut out, then the shape
  triposg: async (app, photo, { onStatus, handle_file }) => {
    try {
      await app.predict("/start_session", [])
    } catch {}
    const seg = await call(app, "/run_segmentation", { image: handle_file(photo) }, { onStatus, doing: "Cutting out the subject..." })
    const cut = fileUrl(seg.data)
    const out = await call(app, "/image_to_3d", { image: cut ? handle_file(cut) : handle_file(photo), seed: 0, num_inference_steps: 50, guidance_scale: 7, simplify: true, target_face_num: 30000 }, { onStatus, doing: "Building the shape (about a minute)..." })
    return fileUrl(out.data)
  },
}
const hunyuan = async (app, photo, { onStatus, handle_file, caption }) => {
  const args = { image: handle_file(photo), mv_image_front: null, mv_image_back: null, mv_image_left: null, mv_image_right: null, steps: 30, guidance_scale: 5, seed: 1234, octree_resolution: 256, check_box_rembg: true, num_chunks: 8000, randomize_seed: true }
  const out = await call(app, "/shape_generation", caption ? { caption: "", ...args } : args, { onStatus, doing: "Building the shape (about 30 seconds)..." })
  const mesh = fileOf(out.data?.[0])
  if (!mesh?.url) return null
  // the raw shape is huge (500k faces, ~15 MB): the Space's own exporter brings it to 30k
  try {
    const exp = await call(app, "/on_export_click", { file_out: mesh, file_out2: null, file_type: "glb", reduce_face: true, export_texture: false, target_face_num: 30000 }, { onStatus, doing: "Making it phone-sized..." })
    return fileUrl(exp.data?.slice?.(1)) || fileUrl(exp.data) || mesh.url
  } catch {
    return mesh.url
  }
}

// photo (Blob) -> { bytes: .glb, took, space (name), textured, tried: [{ name, why }] }
// onStatus(text) reports progress; onSpace({ name, n, of }) which Space is working
export const makeFromPhoto = async (photo, { onStatus, onSpace, spaces = PHOTO_SPACES, ...opts } = {}) => {
  const t0 = Date.now()
  const { handle_file } = await import("@gradio/client")
  const plan = planSpaces(spaces, { left: getQuota()?.left ?? null })
  const tried = []
  for (let i = 0; i < plan.length; i++) {
    const s = plan[i]
    onSpace?.({ name: s.name, n: i + 1, of: plan.length })
    const say = (text) => onStatus?.(`${s.name}: ${text}`)
    try {
      const app = await connect(s.space, onStatus, s.name)
      const url = await RUNNERS[s.id](app, photo, { onStatus: say, handle_file, ...opts })
      if (!url) throw new SpaceError({ text: `${s.name} finished but sent no model back.` })
      say("Downloading the model...")
      const bytes = await fetchBytes(url, getToken())
      const q = getQuota()
      if (q) noteQuota(q.left - s.gpu)
      return { bytes, took: Date.now() - t0, space: s.name, textured: s.textured, tried }
    } catch (e) {
      const info = e instanceof SpaceError ? e : new SpaceError(spaceError(e))
      tried.push({ name: s.name, why: info.message, quota: info.quota })
      // out of free time for a bigger Space: try the cheaper ones that still fit
      if (info.quota && info.left != null) {
        const next = plan.slice(i + 1).filter((x) => x.gpu <= info.left)
        if (next.length) onStatus?.(`${s.name} needs more free time than you have left today (${minutesText(info.left)}). Trying ${next[0].name}...`)
      } else if (i + 1 < plan.length) onStatus?.(`${s.name} ${info.quota ? "is out of free time for you today" : "isn't working right now"}. Trying ${plan[i + 1].name}...`)
    }
  }
  // every one said no: the most useful reason (out of time beats "busy")
  const quota = tried.find((t) => t.quota)
  throw new SpaceError({
    text: quota
      ? quota.why
      : `None of the free 3D services could make it right now (${tried.map((t) => t.name).join(", ")} tried). Try again in a few minutes, or import a .glb file.`,
    quota: !!quota,
  })
}

// photo (Blob) -> { bytes: rigged .glb, took }
export const bringToLife = async (photo, { onStatus } = {}) => {
  const t0 = Date.now()
  const { handle_file } = await import("@gradio/client")
  const app = await connect(ANIGEN, onStatus, "AniGen")
  try {
    await app.predict("/start_session", [])
  } catch {}
  try {
    await call(app, "/prepare_input_for_generation", { image: handle_file(photo) }, { onStatus, doing: "Getting the picture ready..." })
    await call(app, "/generate_preview", { seed: 42 }, { onStatus, doing: "Building a body with bones (2-3 minutes)..." })
    const out = await call(app, "/extract_glb", { texture_size: 1024, simplify_ratio: 0.95, fill_holes: true }, { onStatus, doing: "Packing the rigged model..." })
    // [mesh, skeleton/final glb, status]: the second carries the bones
    const url = out.data?.[1]?.url || fileUrl(out.data)
    if (!url) throw new SpaceError({ text: "The free service finished but sent no rigged model back." })
    onStatus?.("Downloading the model...")
    return { bytes: await fetchBytes(url, getToken()), took: Date.now() - t0, space: "AniGen" }
  } catch (e) {
    fail(e)
  }
}
