/**
 * PNG export utilities.
 *
 * exportPNG      — trimmed export; composites gradient under canvas when bgGradient is active.
 * exportPNGAlpha — transparent background: replaces solid bg pixels with alpha=0, then trims.
 */

const MARGIN    = 16   // px padding around trimmed content
const THRESHOLD = 12   // per-channel tolerance for bg-pixel detection

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseBgRGB(bgHex) {
  const n = parseInt((bgHex || '#ffffff').replace('#', ''), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

function trimAndDownload(ctx, width, height, isBg, filename) {
  const { data } = ctx.getImageData(0, 0, width, height)
  let minX = width, minY = height, maxX = 0, maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (!isBg(data, i)) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (minX >= maxX || minY >= maxY) {
    triggerDownload(ctx.canvas.toDataURL('image/png'), filename)
    return
  }

  minX = Math.max(0, minX - MARGIN)
  minY = Math.max(0, minY - MARGIN)
  maxX = Math.min(width  - 1, maxX + MARGIN)
  maxY = Math.min(height - 1, maxY + MARGIN)

  const out = document.createElement('canvas')
  out.width  = maxX - minX + 1
  out.height = maxY - minY + 1
  out.getContext('2d').drawImage(
    ctx.canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height
  )
  triggerDownload(out.toDataURL('image/png'), filename)
}

function triggerDownload(dataURL, filename) {
  Object.assign(document.createElement('a'), { href: dataURL, download: filename }).click()
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Regular PNG export — solid bg or composited gradient.
 * @param {HTMLCanvasElement} glCanvas
 * @param {string}            bgHex          solid background hex
 * @param {Array|null}        bgGradientStops gradient stops or null for solid
 */
export function exportPNG(glCanvas, bgHex, bgGradientStops) {
  const { width, height } = glCanvas
  const out = document.createElement('canvas')
  out.width = width; out.height = height
  const ctx = out.getContext('2d')

  if (bgGradientStops?.length > 1) {
    // Gradient mode: canvas is transparent; composite gradient underneath
    const grad = ctx.createLinearGradient(0, 0, 0, height)
    for (const s of bgGradientStops) grad.addColorStop(s.pos, s.color)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(glCanvas, 0, 0)

    // Trim: non-transparent pixels that aren't pure gradient corners
    // Use the simpler transparent-pixel check since the canvas had alpha=0 in empty areas
    trimAndDownload(ctx, width, height,
      (data, i) => data[i + 3] < 10,   // "is background" = was transparent before composite
      'heightmap.png'
    )
  } else {
    // Solid mode: canvas has bg baked in
    ctx.drawImage(glCanvas, 0, 0)
    const [bgR, bgG, bgB] = parseBgRGB(bgHex)
    trimAndDownload(ctx, width, height,
      (data, i) => data[i + 3] < 10 ||
        (Math.abs(data[i]   - bgR) + Math.abs(data[i+1] - bgG) + Math.abs(data[i+2] - bgB)) <= THRESHOLD,
      'heightmap.png'
    )
  }
}

/**
 * Transparent PNG export.
 * - When gradient is active: canvas is already transparent → trim non-transparent pixels.
 * - When solid: replace bg-coloured pixels with alpha=0, then trim.
 */
export function exportPNGAlpha(glCanvas, bgHex, bgGradientActive) {
  const { width, height } = glCanvas
  const tmp = document.createElement('canvas')
  tmp.width = width; tmp.height = height
  const ctx = tmp.getContext('2d')
  ctx.drawImage(glCanvas, 0, 0)

  if (!bgGradientActive) {
    // Replace solid bg pixels with transparent
    const [bgR, bgG, bgB] = parseBgRGB(bgHex)
    const img = ctx.getImageData(0, 0, width, height)
    const { data } = img
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - bgR) + Math.abs(data[i+1] - bgG) + Math.abs(data[i+2] - bgB) <= THRESHOLD) {
        data[i + 3] = 0
      }
    }
    ctx.putImageData(img, 0, 0)
  }

  trimAndDownload(ctx, width, height, (data, i) => data[i + 3] < 10, 'heightmap-alpha.png')
}
