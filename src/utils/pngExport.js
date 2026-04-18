/**
 * PNG export with automatic content-trim.
 *
 * Reads the WebGL canvas pixel data, finds the bounding box of pixels that
 * differ from the background color, and exports only that region — no excess
 * background or letterboxing.
 */

const MARGIN   = 16   // px padding around the trimmed content
const THRESHOLD = 12  // per-channel tolerance for "is this a bg pixel?"

export function exportPNG(glCanvas, bgHex) {
  // Force a synchronous render so the canvas is up to date
  // (the caller should already have done gl.render, but this is a safety net)

  // Copy the WebGL canvas into a 2D canvas so we can read pixels
  const tmp = document.createElement('canvas')
  tmp.width  = glCanvas.width
  tmp.height = glCanvas.height
  const ctx = tmp.getContext('2d')
  ctx.drawImage(glCanvas, 0, 0)

  const { data, width, height } = ctx.getImageData(0, 0, tmp.width, tmp.height)

  // Parse background color to 0-255 RGB
  const n  = parseInt((bgHex || '#ffffff').replace('#', ''), 16)
  const bgR = (n >> 16) & 0xff
  const bgG = (n >>  8) & 0xff
  const bgB =  n        & 0xff

  // Find bounding box of non-background pixels
  let minX = width, minY = height, maxX = 0, maxY = 0

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 10) continue  // transparent

      const dr = Math.abs(data[i]     - bgR)
      const dg = Math.abs(data[i + 1] - bgG)
      const db = Math.abs(data[i + 2] - bgB)

      if (dr + dg + db > THRESHOLD) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  // Nothing found — fall back to the full canvas
  if (minX >= maxX || minY >= maxY) {
    triggerDownload(glCanvas.toDataURL('image/png'), 'heightmap.png')
    return
  }

  // Add margin, clamped to canvas bounds
  minX = Math.max(0, minX - MARGIN)
  minY = Math.max(0, minY - MARGIN)
  maxX = Math.min(width  - 1, maxX + MARGIN)
  maxY = Math.min(height - 1, maxY + MARGIN)

  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1

  const out = document.createElement('canvas')
  out.width  = cropW
  out.height = cropH
  out.getContext('2d').drawImage(tmp, minX, minY, cropW, cropH, 0, 0, cropW, cropH)

  triggerDownload(out.toDataURL('image/png'), 'heightmap.png')
}

function triggerDownload(dataURL, filename) {
  Object.assign(document.createElement('a'), {
    href: dataURL, download: filename,
  }).click()
}
