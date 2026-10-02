import { BLUR_SIGMA, GLOW_PAD, HALF, HUES, SQUARE, SQUARES, STRIDE, hueCss } from "./spirograph"

/*
 * Two renderers with the same interface:
 *   draw(squares: Float32Array, scale: number)   // canvas already sized in device px
 *   restore(): boolean                            // re-create GPU resources after context loss
 *
 * WebGL2: one instanced draw call per frame (104 quads). The fragment shader evaluates
 * the exact CSS box-shadow look analytically -- a 15px square convolved with a
 * gaussian (sigma 10) is separable into erf() terms -- and puts the crisp square on top.
 *
 * Canvas 2D fallback: 104 drawImage calls from a pre-rendered glow atlas plus one path
 * fill per arm. No per-frame shadowBlur or filters.
 */

const VERT = `#version 300 es
in vec2 a_corner;
in vec2 a_center;
in vec2 a_rot;
in float a_hue;
uniform vec2 u_res;
uniform float u_scale;
uniform float u_extent;
out vec2 v_local;
out vec3 v_color;

// CSS filter: hue-rotate() applied to #00efff
vec3 hueRotate(float deg) {
  float a = radians(deg);
  float c = cos(a), s = sin(a);
  vec3 base = vec3(0.0, 239.0 / 255.0, 1.0);
  mat3 m = mat3(
    0.213 + c * 0.787 - s * 0.213, 0.213 - c * 0.213 + s * 0.143, 0.213 - c * 0.213 - s * 0.787,
    0.715 - c * 0.715 - s * 0.715, 0.715 + c * 0.285 + s * 0.140, 0.715 - c * 0.715 + s * 0.715,
    0.072 - c * 0.072 + s * 0.928, 0.072 - c * 0.072 - s * 0.283, 0.072 + c * 0.928 + s * 0.072);
  return clamp(m * base, 0.0, 1.0);
}

void main() {
  vec2 l = a_corner * u_extent;
  v_local = l;
  v_color = hueRotate(a_hue);
  vec2 p = a_center + vec2(a_rot.x * l.x - a_rot.y * l.y, a_rot.y * l.x + a_rot.x * l.y) * u_scale;
  vec2 clip = p / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
in vec2 v_local;
in vec3 v_color;
uniform float u_scale;
out vec4 outColor;
const float H = ${HALF.toFixed(2)};
const float K = ${(1 / (Math.SQRT2 * BLUR_SIGMA)).toFixed(6)};

float erf_(float x) { // Abramowitz & Stegun 7.1.26
  float s = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}
float blurredBox(float x) { return 0.5 * (erf_((x + H) * K) - erf_((x - H) * K)); }

void main() {
  float glow = blurredBox(v_local.x) * blurredBox(v_local.y);
  vec2 edge = clamp((H - abs(v_local)) * u_scale + 0.5, 0.0, 1.0);
  float solid = edge.x * edge.y;
  float a = solid + (1.0 - solid) * glow;
  outColor = vec4(v_color * a, a);
}`

export function createGLRenderer(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  })
  if (!gl) return null

  let program, vao, instanceBuf, uRes, uScale, uExtent
  const instanceData = new Float32Array(SQUARES * STRIDE)

  const compile = (type, src) => {
    const s = gl.createShader(type)
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s)
      gl.deleteShader(s)
      throw new Error("Hover shader: " + log)
    }
    return s
  }

  const init = () => {
    const vs = compile(gl.VERTEX_SHADER, VERT)
    const fs = compile(gl.FRAGMENT_SHADER, FRAG)
    program = gl.createProgram()
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error("Hover shader link: " + gl.getProgramInfoLog(program))
    }
    gl.useProgram(program)
    uRes = gl.getUniformLocation(program, "u_res")
    uScale = gl.getUniformLocation(program, "u_scale")
    uExtent = gl.getUniformLocation(program, "u_extent")
    gl.uniform1f(uExtent, HALF + GLOW_PAD)

    vao = gl.createVertexArray()
    gl.bindVertexArray(vao)

    const quad = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const aCorner = gl.getAttribLocation(program, "a_corner")
    gl.enableVertexAttribArray(aCorner)
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0)

    instanceBuf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf)
    gl.bufferData(gl.ARRAY_BUFFER, instanceData.byteLength, gl.DYNAMIC_DRAW)
    const bytes = STRIDE * 4
    const attr = (name, size, offset) => {
      const loc = gl.getAttribLocation(program, name)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, bytes, offset * 4)
      gl.vertexAttribDivisor(loc, 1)
    }
    attr("a_center", 2, 0)
    attr("a_rot", 2, 2)
    attr("a_hue", 1, 4)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA) // premultiplied source-over
    gl.clearColor(0, 0, 0, 1)
  }

  init()

  return {
    kind: "webgl2",
    draw(squares, scale) {
      if (gl.isContextLost()) return
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      gl.uniform1f(uScale, scale)
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, squares)
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, SQUARES)
    },
    restore() {
      init()
      return true
    },
  }
}

// ---------------------------------------------------------------- Canvas 2D fallback

const HUE_BUCKETS = 60
const ROT_STEPS = 6 // a square repeats every 90deg, so 6 steps of 15deg
const SPRITE_PX = 64
const ATLAS_COLS = 24
let atlas = null

function getGlowAtlas() {
  if (atlas) return atlas
  const span = SQUARE + GLOW_PAD * 2
  const k = SPRITE_PX / span
  const count = HUE_BUCKETS * ROT_STEPS
  const c = document.createElement("canvas")
  c.width = SPRITE_PX * ATLAS_COLS
  c.height = SPRITE_PX * Math.ceil(count / ATLAS_COLS)
  const g = c.getContext("2d")
  for (let i = 0; i < count; i++) {
    const hue = Math.floor(i / ROT_STEPS) * (HUES / HUE_BUCKETS)
    const rot = ((i % ROT_STEPS) / ROT_STEPS) * (Math.PI / 2)
    const x = (i % ATLAS_COLS) * SPRITE_PX
    const y = Math.floor(i / ATLAS_COLS) * SPRITE_PX
    const color = hueCss(hue)
    g.save()
    g.beginPath()
    g.rect(x, y, SPRITE_PX, SPRITE_PX)
    g.clip()
    g.translate(x + SPRITE_PX / 2, y + SPRITE_PX / 2)
    g.rotate(rot)
    // Draw the square far away and keep only its shadow (= the blurred copy). Shadow
    // offsets are in device space, so place the square at the rotated inverse offset.
    g.shadowColor = color
    g.shadowBlur = 2 * BLUR_SIGMA * k
    g.shadowOffsetX = 10000
    g.fillStyle = color
    g.fillRect(-10000 * Math.cos(rot) - HALF * k, 10000 * Math.sin(rot) - HALF * k, SQUARE * k, SQUARE * k)
    g.restore()
  }
  atlas = { image: c }
  if (typeof createImageBitmap === "function") {
    // an ImageBitmap avoids a canvas snapshot on every drawImage
    createImageBitmap(c).then((bmp) => { atlas.image = bmp }, () => {})
  }
  return atlas
}

const SOLID_CSS = Array.from({ length: HUES }, (_, d) => hueCss(d))

export function create2DRenderer(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false })
  if (!ctx) return null
  const glow = getGlowAtlas()
  const quarter = Math.PI / 2
  return {
    kind: "2d",
    draw(sq, scale) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.fillStyle = "#000"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      const img = glow.image
      const g = (SQUARE + GLOW_PAD * 2) * scale
      const h = HALF * scale
      for (let arm = 0; arm < SQUARES / 4; arm++) {
        const base = arm * 4 * STRIDE
        const rc = sq[base + 2], rs = sq[base + 3], hue = sq[base + 4]
        let rot = Math.atan2(rs, rc) % quarter
        if (rot < 0) rot += quarter
        const sprite = Math.floor(hue / (HUES / HUE_BUCKETS)) * ROT_STEPS + (Math.round((rot / quarter) * ROT_STEPS) % ROT_STEPS)
        const sx = (sprite % ATLAS_COLS) * SPRITE_PX
        const sy = Math.floor(sprite / ATLAS_COLS) * SPRITE_PX
        const ux = rc * h, uy = rs * h, wx = -rs * h, wy = rc * h
        // glow then solid per square (CSS paint order). Solids of one arm share a colour,
        // so they are batched into one path, drawn after that arm's glows.
        for (let k = 0; k < 4; k++) {
          const o = base + k * STRIDE
          ctx.drawImage(img, sx, sy, SPRITE_PX, SPRITE_PX, sq[o] - g / 2, sq[o + 1] - g / 2, g, g)
        }
        ctx.beginPath()
        for (let k = 0; k < 4; k++) {
          const o = base + k * STRIDE
          const x = sq[o], y = sq[o + 1]
          ctx.moveTo(x - ux - wx, y - uy - wy)
          ctx.lineTo(x + ux - wx, y + uy - wy)
          ctx.lineTo(x + ux + wx, y + uy + wy)
          ctx.lineTo(x - ux + wx, y - uy + wy)
          ctx.closePath()
        }
        ctx.fillStyle = SOLID_CSS[hue]
        ctx.fill()
      }
    },
    restore() {
      return true
    },
  }
}

