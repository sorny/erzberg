/**
 * Read an export's pixels back as the screen would show them.
 *
 * three.js tone-maps only what it draws to the screen. An export draws into a
 * render target, so every ink skipped the ACES curve the viewport puts it
 * through, and a PNG came out greener and deeper than the plate on screen.
 *
 * A target marked as an XR target is tone-mapped per material, as the screen
 * is, so Inks as picked still skips the curve where it should. It is kept in
 * linear 16-bit floats, which the multisampled buffer and its texture share
 * (an sRGB target cannot be resolved once marked), and this encodes sRGB on
 * the way out, through a table of all 65 536 half floats, a strip of rows at a
 * time so a 4K plate never needs a float copy of itself.
 */

/** A half float's bits as a number. */
export function halfToFloat(h) {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const m = h & 0x3ff
  if (e === 0) return s * 2 ** -14 * (m / 1024)
  if (e === 31) return m ? NaN : s * Infinity
  return s * 2 ** (e - 15) * (1 + m / 1024)
}

const encode = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

let colourLut = null, alphaLut = null
function tables() {
  if (!colourLut) {
    colourLut = new Uint8Array(65536)
    alphaLut = new Uint8Array(65536)
    for (let h = 0; h < 65536; h++) {
      const f = halfToFloat(h)
      const c = Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : (f > 0 ? 1 : 0)
      colourLut[h] = Math.round(encode(c) * 255)
      alphaLut[h] = Math.round(c * 255)
    }
  }
  return { colourLut, alphaLut }
}

/** Mark a render target to draw as the screen does. See the module comment. */
export function asScreenTarget(rt, THREE) {
  rt.isXRRenderTarget = true
  rt.texture.type = THREE.HalfFloatType
  rt.texture.colorSpace = THREE.LinearSRGBColorSpace
  return rt
}

/**
 * The target's pixels as sRGB bytes, rows bottom first like `readPixels`.
 * @param {(rt, x, y, w, h, buf) => void} read  `renderer.readRenderTargetPixels`
 */
export function readScreenBytes(read, rt, w, h) {
  const { colourLut: c, alphaLut: a } = tables()
  const out = new Uint8Array(w * h * 4)
  const rows = Math.max(1, Math.floor(1_000_000 / w))
  const buf = new Uint16Array(w * rows * 4)
  for (let y = 0; y < h; y += rows) {
    const n = Math.min(rows, h - y)
    const view = n === rows ? buf : buf.subarray(0, w * n * 4)
    read(rt, 0, y, w, n, view)
    const o = y * w * 4
    for (let i = 0; i < view.length; i += 4) {
      out[o + i] = c[view[i]]; out[o + i + 1] = c[view[i + 1]]; out[o + i + 2] = c[view[i + 2]]
      out[o + i + 3] = a[view[i + 3]]
    }
  }
  return out
}
