// The real device 98ish runs on, as far as the browser will say (System Properties, Task
// Manager's Performance tab, MS-DOS `mem`). Anything the browser hides comes back null and
// the screens say "not reported by this browser" rather than making a number up.

const nav = () => (typeof navigator !== "undefined" ? navigator : {})

// "Safari on iOS 26.1", "Chrome on Windows", ...
export const browserAndOs = (ua = nav().userAgent || "", platform = nav().userAgentData?.platform || "") => {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "a web browser"
  const ios = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)?/)
  const mac = /Mac OS X/.test(ua) && !ios
  const os = ios
    ? `${/iPad/.test(ua) ? "iPadOS" : "iOS"} ${ios[1]}${ios[2] && ios[2] !== "0" ? `.${ios[2]}` : ""}`
    : /Android (\d+)/.test(ua)
      ? `Android ${ua.match(/Android (\d+)/)[1]}`
      : /Windows/.test(ua) || platform === "Windows"
        ? "Windows"
        : mac || platform === "macOS"
          ? "macOS"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Linux/.test(ua)
              ? "Linux"
              : platform || "an unknown system"
  return `${browser} on ${os}`
}

// the GPU's name: WebGL's unmasked renderer (most browsers), cleaned of ANGLE's wrapping
export const gpuName = () => {
  try {
    const canvas = document.createElement("canvas")
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl")
    if (!gl) return null
    const ext = gl.getExtension("WEBGL_debug_renderer_info")
    const raw = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    gl.getExtension("WEBGL_lose_context")?.loseContext()
    return cleanGpu(raw)
  } catch {
    return null
  }
}
export const cleanGpu = (raw) => {
  const s = String(raw || "").trim()
  if (!s || /^WebKit WebGL$/i.test(s)) return null // Safari hides it
  // "ANGLE (Vendor, Device (0x1234) Direct3D11 vs_5_0 ps_5_0, D3D11)" -> "Device"
  if (/^ANGLE \(/.test(s)) {
    const parts = s.replace(/^ANGLE \(|\)$/g, "").split(/,\s*/)
    const device = (parts[1] || parts[0])
      .replace(/^ANGLE Metal Renderer:\s*/i, "")
      .replace(/\s*\(0x[0-9a-f]+\)/i, "")
      .replace(/\s+(Direct3D|OpenGL|Vulkan|Metal).*$/i, "")
    return device.replace(/\s+/g, " ").trim() || null
  }
  return s.replace(/\s+/g, " ")
}

// bytes -> "1.2 MB" / "4.5 GB"
export const formatBytes = (n) => {
  if (!Number.isFinite(n) || n < 0) return null
  const units = ["bytes", "KB", "MB", "GB", "TB"]
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) (v /= 1024), i++
  return i === 0 ? `${Math.round(v)} bytes` : `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

// everything that can be known at once (sync)
export const deviceNow = () => {
  const n = nav()
  const screenInfo = typeof screen !== "undefined" ? screen : null
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1
  const conn = n.connection || null
  const heap = typeof performance !== "undefined" && performance.memory ? performance.memory : null
  return {
    cores: Number.isFinite(n.hardwareConcurrency) ? n.hardwareConcurrency : null,
    memoryGb: Number.isFinite(n.deviceMemory) ? n.deviceMemory : null,
    screen: screenInfo ? { width: Math.round(screenInfo.width * dpr), height: Math.round(screenInfo.height * dpr), ratio: Math.round(dpr * 100) / 100 } : null,
    system: browserAndOs(),
    online: n.onLine !== false,
    connection: conn?.effectiveType || null,
    heap: heap ? { used: heap.usedJSHeapSize, total: heap.totalJSHeapSize, limit: heap.jsHeapSizeLimit } : null,
  }
}

// the slow parts: storage use and quota (navigator.storage), the GPU name
export const deviceLater = async () => {
  let storage = null
  try {
    const est = await nav().storage?.estimate?.()
    if (est && Number.isFinite(est.quota)) storage = { used: est.usage || 0, quota: est.quota }
  } catch {
    storage = null
  }
  return { storage, gpu: gpuName() }
}
