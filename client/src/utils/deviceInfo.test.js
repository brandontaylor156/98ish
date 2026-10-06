import test from "node:test"
import assert from "node:assert/strict"
import { browserAndOs, cleanGpu, formatBytes } from "./deviceInfo.js"

test("browserAndOs names the browser and system", () => {
  assert.equal(browserAndOs("Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1"), "Safari on iOS 26.1")
  assert.equal(browserAndOs("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1"), "Chrome on iOS 18")
  assert.equal(browserAndOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"), "Chrome on Windows")
  assert.equal(browserAndOs("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"), "Safari on macOS")
  assert.equal(browserAndOs("Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36"), "Chrome on Android 15")
  assert.equal(browserAndOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"), "Firefox on Windows")
})

test("cleanGpu unwraps ANGLE and hides Safari's placeholder", () => {
  assert.equal(cleanGpu("ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)"), "Intel(R) UHD Graphics 620")
  assert.equal(cleanGpu("Apple GPU"), "Apple GPU")
  assert.equal(cleanGpu("WebKit WebGL"), null)
  assert.equal(cleanGpu(""), null)
})

test("formatBytes", () => {
  assert.equal(formatBytes(512), "512 bytes")
  assert.equal(formatBytes(1536), "1.5 KB")
  assert.equal(formatBytes(5 * 1024 ** 3), "5.0 GB")
  assert.equal(formatBytes(200 * 1024 ** 2), "200 MB")
  assert.equal(formatBytes(NaN), null)
})
