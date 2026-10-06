// Be Yourself: a selfie -> a LAM avatar (Alibaba's Large Avatar Model, Apache-2.0), made on a
// free Hugging Face Space and called straight from this device (@gradio/client), so the
// photo and the head never pass through 98ish's server.
//
// Honest state (2026-10-06): the official free LAM Space (3DAIGC/LAM) only returns a rendered
// video, not the avatar zip the live renderer needs, and it runs on free CPU hardware. So the
// selfie path calls an EXPORTER Space set with VITE_LAM_EXPORT_SPACE (an owner-duplicated
// copy of LAM with an endpoint "/export_head" that takes the image and returns the avatar
// zip: LAM's own `--h5_rendering` export). Until one is set, "Make from a selfie" explains
// that and offers importing a LAM zip (made with LAM's tools) or the sample head.

export const EXPORT_SPACE = (import.meta.env?.VITE_LAM_EXPORT_SPACE || "").trim()
export const selfieAvailable = () => !!EXPORT_SPACE

export const NOT_SET_UP =
  "Making a head from a selfie needs a free LAM service that sends the head file back. The public LAM page only makes a video, so this isn't switched on yet. For now: import a head made with LAM's tools (a .zip), or try the sample head."

// photo: a Blob (JPEG/PNG); returns Uint8Array (the avatar zip)
export const headFromSelfie = async (photo, { onStatus } = {}) => {
  if (!EXPORT_SPACE) throw new Error(NOT_SET_UP)
  const { Client, handle_file } = await import("@gradio/client")
  onStatus?.("Waking up the free 3D head service (it can take a minute)...")
  let app
  try {
    app = await Client.connect(EXPORT_SPACE)
  } catch (e) {
    throw new Error(`The 3D head service didn't answer (${e?.message || "offline"}). Try again later.`)
  }
  onStatus?.("Building your 3D head (about a minute)...")
  let result
  try {
    result = await app.predict("/export_head", [handle_file(new File([photo], "selfie.jpg", { type: photo.type || "image/jpeg" }))])
  } catch (e) {
    const msg = String(e?.message || e)
    if (/quota|GPU|exceeded|ZeroGPU/i.test(msg)) throw new Error("Hugging Face's free GPU time for today is used up on this device. It resets daily.")
    if (/face|detect/i.test(msg)) throw new Error("No face was found in that photo. Try a well-lit selfie, looking at the camera.")
    throw new Error(`The head couldn't be made (${msg.slice(0, 120)}).`)
  }
  const out = result?.data?.[0]
  const url = out?.url || out?.path
  if (!url) throw new Error("The 3D head service didn't send a head back.")
  onStatus?.("Downloading your head...")
  const res = await fetch(url)
  if (!res.ok) throw new Error("Your head couldn't be downloaded.")
  return new Uint8Array(await res.arrayBuffer())
}
