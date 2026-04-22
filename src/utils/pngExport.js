/**
 * PNG export utilities.
 * Supports high-resolution offscreen captures with clean alpha channels.
 */

const MARGIN = 16 // px padding around trimmed content

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Trims a canvas to its non-transparent content and triggers a download.
 */
function trimAndDownload(ctx, width, height, filename) {
  const { data } = ctx.getImageData(0, 0, width, height)
  let minX = width, minY = height, maxX = 0, maxY = 0
  let hasContent = false

  // Scan alpha channel for bounds
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > 5) { // Threshold for extremely faint pixels
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        hasContent = true
      }
    }
  }

  if (!hasContent) {
    triggerDownload(ctx.canvas.toDataURL('image/png'), filename)
    return
  }

  // Apply margin
  minX = Math.max(0, minX - MARGIN)
  minY = Math.max(0, minY - MARGIN)
  maxX = Math.min(width - 1, maxX + MARGIN)
  maxY = Math.min(height - 1, maxY + MARGIN)

  const outW = maxX - minX + 1
  const outH = maxY - minY + 1

  const out = document.createElement('canvas')
  out.width = outW
  out.height = outH
  const outCtx = out.getContext('2d')
  
  outCtx.drawImage(
    ctx.canvas,
    minX, minY, outW, outH,
    0, 0, outW, outH
  )

  triggerDownload(out.toDataURL('image/png'), filename)
}

function triggerDownload(dataURL, filename) {
  const a = Object.assign(document.createElement('a'), {
    href: dataURL,
    download: filename,
  })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * High-fidelity PNG export.
 * @param {HTMLCanvasElement} glCanvas  The captured WebGL canvas (rendered with alpha)
 * @param {string}            bgHex     Solid background color
 * @param {Array|null}        bgStops   Gradient stops or null
 * @param {boolean}           isAlpha   If true, background is ignored
 */
export function captureAndExportPNG(glCanvas, bgHex, bgStops, isAlpha) {
  const { width, height } = glCanvas
  const out = document.createElement('canvas')
  out.width = width
  out.height = height
  const ctx = out.getContext('2d')

  if (!isAlpha) {
    // 1. Draw background
    if (bgStops?.length > 1) {
      const grad = ctx.createLinearGradient(0, 0, 0, height)
      for (const s of bgStops) grad.addColorStop(s.pos, s.color)
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = bgHex || '#ffffff'
    }
    ctx.fillRect(0, 0, width, height)
  }

  // 2. Composite the WebGL content
  // Note: WebGL canvas must have been rendered with { preserveDrawingBuffer: true }
  // or captured immediately after a render call.
  ctx.drawImage(glCanvas, 0, 0)

  // 3. Trim based on the alpha pass
  // To trim a non-alpha image accurately, we'd need a separate alpha-only mask.
  // We'll assume the trimming happens based on the WebGL content bounds.
  // For standard PNG, we look at the content before background was added.
  if (!isAlpha) {
    // We create a temporary alpha-only version just for bounds detection
    const mask = document.createElement('canvas')
    mask.width = width; mask.height = height
    mask.getContext('2d').drawImage(glCanvas, 0, 0)
    
    // We'll pass the composite result but use the mask for bounds
    const maskData = mask.getContext('2d').getImageData(0, 0, width, height).data
    trimWithMaskAndDownload(ctx, maskData, width, height, 'heightmap.png')
  } else {
    trimAndDownload(ctx, width, height, 'heightmap-alpha.png')
  }
}

function trimWithMaskAndDownload(ctx, maskData, width, height, filename) {
  let minX = width, minY = height, maxX = 0, maxY = 0
  let hasContent = false

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = maskData[(y * width + x) * 4 + 3]
      if (alpha > 5) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        hasContent = true
      }
    }
  }

  if (!hasContent) {
    triggerDownload(ctx.canvas.toDataURL('image/png'), filename)
    return
  }

  minX = Math.max(0, minX - MARGIN); minY = Math.max(0, minY - MARGIN)
  maxX = Math.min(width - 1, maxX + MARGIN); maxY = Math.min(height - 1, maxY + MARGIN)

  const outW = maxX - minX + 1; const outH = maxY - minY + 1
  const out = document.createElement('canvas')
  out.width = outW; out.height = outH
  out.getContext('2d').drawImage(ctx.canvas, minX, minY, outW, outH, 0, 0, outW, outH)
  triggerDownload(out.toDataURL('image/png'), filename)
}
