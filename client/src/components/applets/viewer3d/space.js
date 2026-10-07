// Snap to 3D: a photo -> a 3D model, on free Hugging Face Spaces called straight from this
// browser (the photo goes to Hugging Face only when you tap Make 3D; Render never carries it).
//
//   makeFromPhoto: microsoft/TRELLIS.2 (MIT code + weights). Its own preprocessing cuts the
//     subject out of the photo, then image_to_3d, then extract_glb gives a textured .glb.
//   bringToLife:   VAST-AI/AniGen (MIT; its NC CUBVH extension runs only inside their Space):
//     one image -> a rigged .glb with a skeleton.
//
// Both run on ZeroGPU: each visitor gets a small free allowance a day (about 2 minutes
// signed out, about 5 with a free Hugging Face token). A request reserves 2-3 minutes, so a
// token is what makes it dependable; it's kept on this device (localStorage, per user) and
// sent only to Hugging Face.
import { spaceError } from "./core.js"

export const TRELLIS = "microsoft/TRELLIS.2"
export const ANIGEN = "VAST-AI/AniGen"
const TOKEN_KEY = "98ish.hfToken"

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
  } catch {}
}

class SpaceError extends Error {
  constructor(info) {
    super(info.text)
    this.quota = !!info.quota
  }
}
const fail = (e) => {
  throw new SpaceError(spaceError(e))
}

const connect = async (space, onStatus) => {
  const { Client } = await import("@gradio/client")
  onStatus?.("Waking up the free 3D service (it can take a minute)...")
  const token = getToken()
  try {
    return await Client.connect(space, token ? { hf_token: token } : undefined)
  } catch (e) {
    fail(e)
  }
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

// photo (Blob) -> { bytes: .glb, took } ; resolution "512" keeps the reserved GPU time low
export const makeFromPhoto = async (photo, { onStatus, resolution = "512", triangles = 30000, texture = 1024 } = {}) => {
  const t0 = Date.now()
  const { handle_file } = await import("@gradio/client")
  const app = await connect(TRELLIS, onStatus)
  try {
    await app.predict("/start_session", [])
  } catch {}
  let image = handle_file(photo)
  try {
    onStatus?.("Cutting out the subject...")
    const pre = await app.predict("/preprocess_image", { input: image })
    const url = fileUrl(pre.data)
    if (url) image = handle_file(url)
  } catch (e) {
    fail(e)
  }
  try {
    onStatus?.("Building the shape and colors (1-2 minutes)...")
    await app.predict("/image_to_3d", { image, seed: 0, resolution })
  } catch (e) {
    fail(e)
  }
  let glb
  try {
    onStatus?.("Packing the 3D model...")
    const out = await app.predict("/extract_glb", { decimation_target: triangles, texture_size: texture })
    glb = fileUrl(out.data)
  } catch (e) {
    fail(e)
  }
  if (!glb) throw new SpaceError({ text: "The free 3D service finished but sent no model back. Try another photo." })
  onStatus?.("Downloading the model...")
  const bytes = await fetchBytes(glb, getToken())
  return { bytes, took: Date.now() - t0, space: TRELLIS }
}

// photo (Blob) -> { bytes: rigged .glb, took }
export const bringToLife = async (photo, { onStatus } = {}) => {
  const t0 = Date.now()
  const { handle_file } = await import("@gradio/client")
  const app = await connect(ANIGEN, onStatus)
  try {
    await app.predict("/start_session", [])
  } catch {}
  try {
    onStatus?.("Getting the picture ready...")
    await app.predict("/prepare_input_for_generation", { image: handle_file(photo) })
    onStatus?.("Building a body with bones (2-3 minutes)...")
    await app.predict("/generate_preview", { seed: 42 })
    onStatus?.("Packing the rigged model...")
    const out = await app.predict("/extract_glb", { texture_size: 1024, simplify_ratio: 0.95, fill_holes: true })
    // [mesh, skeleton/final glb, status]: the second carries the bones
    const url = out.data?.[1]?.url || fileUrl(out.data)
    if (!url) throw new SpaceError({ text: "The free service finished but sent no rigged model back." })
    onStatus?.("Downloading the model...")
    return { bytes: await fetchBytes(url, getToken()), took: Date.now() - t0, space: ANIGEN }
  } catch (e) {
    if (e instanceof SpaceError) throw e
    fail(e)
  }
}
