// Floppy's brain, the worker: runs a small language model (and a tiny embedding model for
// help questions) with transformers.js, on the GPU (WebGPU) when the browser has one and on
// the CPU (WebAssembly) otherwise. Model files come from the Hugging Face CDN once and are
// kept in the browser's Cache Storage ("transformers-cache"); nothing typed leaves the device.
//
// in:  { type: "probe" } | { type: "load", model } | { type: "generate", id, messages, max, template }
//      | { type: "embed", id, texts } | { type: "unload" }
// out: { type: "probe", webgpu } | { type: "progress", loaded, total, file } | { type: "ready", device, ms }
//      | { type: "token", id, text } | { type: "done", id, text, tokens, ms, firstMs } | { type: "embedded", id, vectors }
//      | { type: "error", id?, error }

import { AutoModelForCausalLM, AutoTokenizer, TextStreamer, env, pipeline } from "@huggingface/transformers"

env.allowLocalModels = false
env.useBrowserCache = true

let tokenizer = null
let model = null
let embedder = null
let loaded = null // the model spec in memory

const files = new Map() // file -> { loaded, total }
const onProgress = (p) => {
  if (p.status !== "progress" || !p.file) return
  files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 })
  let loadedBytes = 0
  let total = 0
  for (const f of files.values()) {
    loadedBytes += f.loaded
    total += f.total
  }
  self.postMessage({ type: "progress", loaded: loadedBytes, total, file: p.file })
}

const hasWebGpu = async () => {
  try {
    if (!self.navigator?.gpu) return false
    const adapter = await self.navigator.gpu.requestAdapter()
    return !!adapter
  } catch {
    return false
  }
}

const load = async (spec) => {
  if (loaded?.id === spec.id && model) return { device: loaded.device, ms: 0 }
  await unload()
  const t0 = performance.now()
  files.clear()
  tokenizer = await AutoTokenizer.from_pretrained(spec.id, { progress_callback: onProgress })
  model = await AutoModelForCausalLM.from_pretrained(spec.id, { dtype: spec.dtype, device: spec.device, progress_callback: onProgress })
  loaded = spec
  return { device: spec.device, ms: Math.round(performance.now() - t0) }
}

const unload = async () => {
  try {
    await model?.dispose?.()
  } catch {
    // already gone
  }
  model = null
  tokenizer = null
  loaded = null
}

// Qwen3 can think out loud: keep only the answer
const stripThinking = (text) => text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trim()

const generate = async ({ id, messages, max = 160, template = {} }) => {
  if (!model || !tokenizer) throw new Error("The brain isn't loaded.")
  const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true, ...template })
  const t0 = performance.now()
  let firstMs = null
  let text = ""
  let tokens = 0
  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (piece) => {
      if (firstMs === null) firstMs = Math.round(performance.now() - t0)
      text += piece
      self.postMessage({ type: "token", id, text: piece })
    },
    token_callback_function: () => {
      tokens++
    },
  })
  const out = await model.generate({ ...inputs, max_new_tokens: max, do_sample: false, repetition_penalty: 1.05, streamer })
  // the token count from the output when the streamer didn't count
  if (!tokens) tokens = Math.max(0, (out?.dims?.[1] || 0) - (inputs.input_ids?.dims?.[1] || 0))
  self.postMessage({ type: "done", id, text: stripThinking(text), tokens, ms: Math.round(performance.now() - t0), firstMs })
}

const embed = async ({ id, texts, spec }) => {
  if (!embedder) embedder = await pipeline("feature-extraction", spec.id, { dtype: spec.dtype, device: "wasm", progress_callback: onProgress })
  const out = await embedder(texts, { pooling: "mean", normalize: true })
  const dim = out.dims[out.dims.length - 1]
  const vectors = []
  for (let i = 0; i < texts.length; i++) vectors.push(Array.from(out.data.slice(i * dim, (i + 1) * dim)))
  self.postMessage({ type: "embedded", id, vectors })
}

self.onmessage = async (e) => {
  const m = e.data || {}
  try {
    if (m.type === "probe") self.postMessage({ type: "probe", webgpu: await hasWebGpu() })
    else if (m.type === "load") self.postMessage({ type: "ready", ...(await load(m.model)) })
    else if (m.type === "generate") await generate(m)
    else if (m.type === "embed") await embed(m)
    else if (m.type === "unload") {
      await unload()
      embedder = null
      self.postMessage({ type: "unloaded" })
    }
  } catch (error) {
    self.postMessage({ type: "error", id: m.id, error: String(error?.message || error).slice(0, 300) })
  }
}
