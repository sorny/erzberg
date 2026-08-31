/**
 * PNG export utilities.
 * Exports the full viewport at 4× resolution, trimmed to content bounds.
 */

const MARGIN = 16 // px padding around trimmed content

// ── Metadata ──────────────────────────────────────────────────────────────────

/**
 * CRC-32 over a byte range, as PNG defines it — the standard reflected
 * polynomial 0xEDB88320, seeded and finalised with ones.
 *
 * Needed because a PNG chunk carries its own checksum and a decoder is entitled
 * to reject one that does not match. Table built once on first use; a plate
 * export writes exactly one chunk, so this is not a hot path, but building the
 * table per call to compute 30 bytes would be silly.
 */
let _crcTable = null
function crc32(bytes) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      _crcTable[n] = c >>> 0
    }
  }
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * A `tEXt` chunk: 4-byte length, the type, `keyword\0text`, 4-byte CRC.
 *
 * `tEXt` takes Latin-1, which is enough for `© OpenStreetMap contributors` (the
 * © is 0xA9) and is what every reader understands without negotiation. Anything
 * outside Latin-1 would need `iTXt` instead, so a caller passing one is refused
 * rather than silently truncated into mojibake.
 */
function textChunk(keyword, text) {
  const latin1 = (str) => {
    const out = new Uint8Array(str.length)
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i)
      if (c > 0xFF) return null
      out[i] = c
    }
    return out
  }
  const k = latin1(keyword), t = latin1(text)
  if (!k || !t || k.length < 1 || k.length > 79) return null

  const data = new Uint8Array(k.length + 1 + t.length)
  data.set(k, 0); data[k.length] = 0; data.set(t, k.length + 1)

  const chunk = new Uint8Array(12 + data.length)
  const dv = new DataView(chunk.buffer)
  dv.setUint32(0, data.length)
  chunk.set([0x74, 0x45, 0x58, 0x74], 4)                 // "tEXt"
  chunk.set(data, 8)
  dv.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)))
  return chunk
}

/**
 * Splice metadata chunks into an encoded PNG, immediately after `IHDR`.
 *
 * The canvas gives back a finished file and no way to influence what went into
 * it, so the credit has to be written into the bytes afterwards. After IHDR is
 * both legal and conventional — the spec allows `tEXt` anywhere between IHDR
 * and IEND, and putting it before the image data means a reader sees it without
 * decoding megabytes of pixels first.
 *
 * Anything unexpected returns the original buffer untouched. A plate that
 * exports without its credit is a compliance problem; a plate that fails to
 * export at all is a broken feature, and this is not worth the second one.
 *
 * Exported for the unit suite: it is pure byte arithmetic over a buffer, which
 * is exactly the kind of thing worth asserting in Node rather than inferring
 * from a downloaded file eleven seconds into a Playwright spec.
 */
export function withTextChunks(png, entries) {
  const bytes = new Uint8Array(png)
  const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
  if (bytes.length < 8 + 25 || SIG.some((b, i) => bytes[i] !== b)) return bytes

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ihdrLen = dv.getUint32(8)
  const insertAt = 8 + 12 + ihdrLen              // past signature and the IHDR chunk
  if (insertAt > bytes.length) return bytes

  const chunks = entries.map(([k, v]) => textChunk(k, v)).filter(Boolean)
  if (!chunks.length) return bytes

  const extra = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(bytes.length + extra)
  out.set(bytes.subarray(0, insertAt), 0)
  let off = insertAt
  for (const c of chunks) { out.set(c, off); off += c.length }
  out.set(bytes.subarray(insertAt), off)
  return out
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function triggerDownload(url, filename, revoke = false) {
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  if (revoke) URL.revokeObjectURL(url)
}

/**
 * Encode a canvas and download it, carrying `meta` as PNG text chunks.
 *
 * `toBlob` rather than `toDataURL`: a 4× plate is tens of megabytes, and base64
 * would inflate it by a third only to be parsed straight back down again.
 * Asynchronous, which is why every caller returns the promise.
 */
function downloadCanvas(canvas, filename, meta) {
  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      if (!blob) { resolve(false); return }
      const entries = Object.entries(meta || {}).filter(([, v]) => v)
      let out = blob
      if (entries.length) {
        try {
          out = new Blob([withTextChunks(await blob.arrayBuffer(), entries)], { type: 'image/png' })
        } catch { out = blob }
      }
      const url = URL.createObjectURL(out)
      triggerDownload(url, filename, true)
      resolve(true)
    }, 'image/png')
  })
}

// Scans the alpha channel of maskData to find content bounds, then crops and
// downloads the composite canvas (which may have an opaque background).
function trimAndDownload(compositeCtx, maskData, width, height, filename, meta) {
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

  if (!hasContent) return downloadCanvas(compositeCtx.canvas, filename, meta)

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
  return downloadCanvas(out, filename, meta)
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * High-fidelity PNG export.
 * @param {HTMLCanvasElement} glCanvas  The captured WebGL canvas (rendered with alpha)
 * @param {string}            bgHex     Solid background color
 * @param {Array|null}        bgStops   Gradient stops or null
 * @param {boolean}           isAlpha   If true, background is transparent
 * @param {string}            baseName  Download filename stem
 * @param {string|null}       attribution  ODbL credit, when OSM data is in the picture
 */
export function captureAndExportPNG(glCanvas, bgHex, bgStops, isAlpha, baseName, attribution = null) {
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

  const base = baseName ?? 'heightmap'
  // ODbL: the credit travels with the picture, not with the app that drew it.
  // `Copyright` is the keyword every reader already looks for, and unlike the
  // SVG's XML comment it survives the file being re-encoded by an image tool.
  return trimAndDownload(ctx, maskData, width, height,
    isAlpha ? `${base}-alpha.png` : `${base}.png`,
    attribution ? { Copyright: attribution } : null)
}
