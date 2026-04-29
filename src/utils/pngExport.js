/**
 * PNG export utilities.
 * Exports the full viewport at 4× resolution, trimmed to content bounds.
 */

const MARGIN = 16 // px padding around trimmed content

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerDownload(dataURL, filename) {
  const a = Object.assign(document.createElement('a'), {
    href: dataURL,
    download: filename,
  })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// Scans the alpha channel of maskData to find content bounds, then crops and
// downloads the composite canvas (which may have an opaque background).
function trimAndDownload(compositeCtx, maskData, width, height, filename) {
  let minX = width, minY = height, maxX = 0, maxY = 0
  let hasContent = false

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (maskData[(y * width + x) * 4 + 3] > 5) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        hasContent = true
      }
    }
  }

  if (!hasContent) {
    triggerDownload(compositeCtx.canvas.toDataURL('image/png'), filename)
    return
  }

  minX = Math.max(0, minX - MARGIN)
  minY = Math.max(0, minY - MARGIN)
  maxX = Math.min(width - 1, maxX + MARGIN)
  maxY = Math.min(height - 1, maxY + MARGIN)

  const outW = maxX - minX + 1
  const outH = maxY - minY + 1
  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  out.getContext('2d').drawImage(compositeCtx.canvas, minX, minY, outW, outH, 0, 0, outW, outH)
  triggerDownload(out.toDataURL('image/png'), filename)
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * High-fidelity PNG export.
 * @param {HTMLCanvasElement} glCanvas  The captured WebGL canvas (rendered with alpha)
 * @param {string}            bgHex     Solid background color
 * @param {Array|null}        bgStops   Gradient stops or null
 * @param {boolean}           isAlpha   If true, background is transparent
 */
export function captureAndExportPNG(glCanvas, bgHex, bgStops, isAlpha) {
  const { width, height } = glCanvas
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')

  if (!isAlpha) {
    if (bgStops?.length > 1) {
      const grad = ctx.createLinearGradient(0, 0, 0, height)
      for (const s of bgStops) grad.addColorStop(s.pos, s.color)
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = bgHex || '#ffffff'
    }
    ctx.fillRect(0, 0, width, height)
  }

  ctx.drawImage(glCanvas, 0, 0)

  // Use the WebGL alpha channel as the trim mask so the background fill
  // doesn't prevent detection of the content boundary.
  const mask = document.createElement('canvas')
  mask.width = width
  mask.height = height
  mask.getContext('2d').drawImage(glCanvas, 0, 0)
  const maskData = mask.getContext('2d').getImageData(0, 0, width, height).data

  trimAndDownload(ctx, maskData, width, height, isAlpha ? 'heightmap-alpha.png' : 'heightmap.png')
}
