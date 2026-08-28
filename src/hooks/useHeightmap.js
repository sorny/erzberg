/**
 * Loads a heightmap from either a raster image (PNG/JPG) or a GeoTIFF file.
 */
import { useCallback, useState } from 'react'
import { useStore } from '../store/useStore'
import { groundPixelSize, squareGroundShape, suggestElevScale } from '../utils/geoCoords'
import { areaResample } from '../utils/terrain'

// ── Image (PNG / JPG) loader ─────────────────────────────────────────────────

function readU32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset+1] << 16) | (bytes[offset+2] << 8) | bytes[offset+3]) >>> 0
}

function paethPredictor(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

// Decodes a 16-bit PNG natively, bypassing the canvas 8-bit downgrade.
// Returns the same shape as loadImagePixels, or null if not a 16-bit PNG.
async function decodePNG16(file) {
  const buf = await file.arrayBuffer()
  const bytes = new Uint8Array(buf)

  // PNG signature
  if (bytes[0] !== 137 || bytes[1] !== 80 || bytes[2] !== 78 || bytes[3] !== 71 ||
      bytes[4] !== 13  || bytes[5] !== 10  || bytes[6] !== 26  || bytes[7] !== 10) return null

  // IHDR is always first chunk, data starts at byte 16
  const width     = readU32(bytes, 16)
  const height    = readU32(bytes, 20)
  const bitDepth  = bytes[24]
  const colorType = bytes[25]
  const interlace = bytes[28]

  if (bitDepth !== 16) return null  // 8-bit: let canvas handle it
  if (interlace !== 0) return null  // Adam7 not supported

  // channels: 0=gray(1), 2=RGB(3), 4=gray+alpha(2), 6=RGBA(4)
  const chans = colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : null
  if (chans === null) return null

  // Collect and concatenate all IDAT chunks
  const idatParts = []
  let pos = 8
  while (pos + 12 <= bytes.length) {
    const len  = readU32(bytes, pos)
    const type = String.fromCharCode(bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7])
    if (type === 'IDAT') idatParts.push(bytes.subarray(pos + 8, pos + 8 + len))
    else if (type === 'IEND') break
    pos += 12 + len
  }
  if (idatParts.length === 0) return null

  const totalLen = idatParts.reduce((s, p) => s + p.length, 0)
  const compressed = new Uint8Array(totalLen)
  let off = 0
  for (const p of idatParts) { compressed.set(p, off); off += p.length }

  // Decompress: PNG uses zlib (RFC 1950), which is 'deflate' in DecompressionStream
  const stream = new DecompressionStream('deflate')
  const writer = stream.writable.getWriter()
  const reader = stream.readable.getReader()
  writer.write(compressed)
  writer.close()
  const rawParts = []
  let rawLen = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    rawParts.push(value); rawLen += value.length
  }
  const raw = new Uint8Array(rawLen)
  let rawOff = 0
  for (const p of rawParts) { raw.set(p, rawOff); rawOff += p.length }

  // Apply PNG filter reconstruction row by row
  const bpp    = chans * 2          // bytes per pixel (2 bytes per sample)
  const stride = width * bpp        // bytes per row (without filter byte)
  const recon  = new Uint8Array(height * stride)

  for (let y = 0; y < height; y++) {
    const filter  = raw[y * (stride + 1)]
    const srcBase = y * (stride + 1) + 1
    const dst     = y * stride
    const prev    = dst - stride

    for (let x = 0; x < stride; x++) {
      const filt = raw[srcBase + x]
      const a = x >= bpp ? recon[dst + x - bpp] : 0
      const b = y > 0   ? recon[prev + x]       : 0
      const c = (x >= bpp && y > 0) ? recon[prev + x - bpp] : 0
      switch (filter) {
        case 0: recon[dst + x] = filt; break
        case 1: recon[dst + x] = (filt + a) & 0xff; break
        case 2: recon[dst + x] = (filt + b) & 0xff; break
        case 3: recon[dst + x] = (filt + ((a + b) >> 1)) & 0xff; break
        case 4: recon[dst + x] = (filt + paethPredictor(a, b, c)) & 0xff; break
        default: recon[dst + x] = filt
      }
    }
  }

  // Extract normalized float pixels
  const pixels    = new Float32Array(width * height)
  const nodataMask = new Uint8Array(width * height)
  let minX = width, minY = height, maxX = 0, maxY = 0, hasValid = false

  for (let i = 0; i < width * height; i++) {
    const base = i * bpp

    // Alpha channel (if present): use high byte for threshold
    const alpha = colorType === 4 ? recon[base + 2]        // gray+alpha
                : colorType === 6 ? recon[base + 6]        // RGBA
                : 255

    if (alpha < 128) {
      nodataMask[i] = 0
    } else {
      nodataMask[i] = 1
      const v0 = (recon[base] << 8 | recon[base + 1]) / 65535
      if (chans >= 3) {
        // RGB / RGBA: average the three colour channels
        const v1 = (recon[base + 2] << 8 | recon[base + 3]) / 65535
        const v2 = (recon[base + 4] << 8 | recon[base + 5]) / 65535
        pixels[i] = (v0 + v1 + v2) / 3
      } else {
        pixels[i] = v0  // grayscale or gray+alpha
      }
      const x = i % width, y = Math.floor(i / width)
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y
      hasValid = true
    }
  }

  return {
    pixels, nodataMask, width, height,
    dataWidth:  hasValid ? (maxX - minX + 1) : width,
    dataHeight: hasValid ? (maxY - minY + 1) : height,
  }
}

async function loadImagePixels(source) {
  // For File/Blob inputs, attempt native 16-bit PNG decode before touching the canvas
  if (source instanceof Blob) {
    const result = await decodePNG16(source)
    if (result) return result
  }

  // 8-bit images (PNG, JPG, WebP, …) — canvas path
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    // Only set when we minted one below — a plain URL source must not be revoked.
    let objectUrl = null
    // The blob stays alive for the page's lifetime otherwise, and this is the
    // path every 8-bit PNG takes (the 16-bit fast path returns before it), so a
    // session of a few large heightmaps pins hundreds of MB for nothing.
    const release = () => { if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null } }

    img.onload = () => {
      release()
      const { naturalWidth: w, naturalHeight: h } = img
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, w, h)
      const pixels = new Float32Array(w * h)
      const nodataMask = new Uint8Array(w * h)

      let minX = w, minY = h, maxX = 0, maxY = 0
      let hasValid = false

      for (let i = 0; i < w * h; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3]
        pixels[i] = (r + g + b) / (3 * 255)
        if (a < 128) {
          nodataMask[i] = 0
        } else {
          nodataMask[i] = 1
          const x = i % w, y = Math.floor(i / w)
          if (x < minX) minX = x; if (x > maxX) maxX = x
          if (y < minY) minY = y; if (y > maxY) maxY = y
          hasValid = true
        }
      }
      resolve({
        pixels, nodataMask, width: w, height: h,
        dataWidth:  hasValid ? (maxX - minX + 1) : w,
        dataHeight: hasValid ? (maxY - minY + 1) : h,
      })
    }
    img.onerror = (e) => { release(); reject(e) }
    if (typeof source === 'string') {
      img.src = source
    } else {
      objectUrl = URL.createObjectURL(source)
      img.src = objectUrl
    }
  })
}

// ── GeoTIFF loader ───────────────────────────────────────────────────────────

const NODATA_SENTINELS = new Set([-9999, -32767, -32768])

/**
 * Magnitude at which a float value is a void marker rather than a height.
 *
 * Enumerating the float sentinels was the wrong shape. GDAL writes voids as
 * ±3.4028235e38, writers disagree in the last digits, and only the *positive*
 * one was listed — so a raster using the negative marker with no GDAL_NODATA tag
 * read it as real ground 3.4e38 metres down. That one cell then sets the
 * normalisation range and flattens the entire terrain to a plateau, which looks
 * like a broken file rather than a missed sentinel.
 *
 * No elevation in any unit comes within twenty-six orders of magnitude of this,
 * so testing the magnitude covers both signs and every writer's variant at once.
 */
const FLOAT_VOID = 1e30

// GeoTIFF's "this key is set, but to a value not in the EPSG registry" marker.
// Treating it as a code would produce a CRS string nothing can classify.
const USER_DEFINED = 32767

/**
 * Read one TIFF tag.
 *
 * `image.fileDirectory` is a lazy object in current geotiff.js — its own
 * enumerable keys are bookkeeping (`actualizedFields`, `deferredFields`, …) and
 * the tags are reachable only through `hasTag`/`getValue`. Plain property access
 * therefore returns `undefined` for every tag *without throwing*, which is the
 * quietest possible failure: georeferenced files read as unreferenced and files
 * declaring a NoData value read as having none. The fallback branch keeps the
 * older plain-object shape working.
 */
function tiffTag(fd, name) {
  if (!fd) return undefined
  if (typeof fd.getValue === 'function' && typeof fd.hasTag === 'function')
    return fd.hasTag(name) ? fd.getValue(name) : undefined
  return fd[name]
}

// ProjLinearUnitsGeoKey → metres. Only the three that occur in practice.
const LINEAR_UNITS = { 9001: 1, 9002: 0.3048, 9003: 1200 / 3937 }

/**
 * The raster's CRS, as one of the strings `classifyCRS` understands.
 *
 * The geokeys are asked in order of how much they actually pin down: an EPSG
 * code is definitive, the model type at least separates degrees from a grid, and
 * only when a file records neither does the bbox magnitude get a vote —
 * coordinates outside ±360 / ±90 cannot be degrees, so they must be a grid.
 */
function detectCrsCode(gk, bbox) {
  const projCS = gk.ProjectedCSTypeGeoKey
  const geogCS = gk.GeographicTypeGeoKey

  if (projCS && projCS !== USER_DEFINED) return `EPSG:${projCS}`
  if (gk.GTModelTypeGeoKey === 1) return 'EPSG:projected-unknown'
  if (geogCS && geogCS !== USER_DEFINED) return `EPSG:${geogCS}`
  if (gk.GTModelTypeGeoKey === 2) return 'EPSG:geographic-unknown'
  if (bbox && (Math.abs(bbox[0]) > 360 || Math.abs(bbox[1]) > 90)) return 'EPSG:projected-unknown'
  return 'EPSG:4326'
}

/**
 * The CRS name the file states about itself, preferred over our own lookup so a
 * raster in an unsupported grid can still be named in the sidebar. GeoTIFF
 * citations conventionally end in '|' and are often NUL-padded.
 */
function citationName(gk) {
  const raw = gk.PCSCitationGeoKey || gk.GTCitationGeoKey || gk.GeogCitationGeoKey
  if (typeof raw !== 'string') return null
  const s = raw.replace(/[|\0\s]+$/, '').trim()
  if (!s) return null
  // Some writers put a whole WKT string in here. The sidebar line is one row of
  // a stats block, not a place to render a projection definition.
  return s.length > 64 ? s.slice(0, 63) + '…' : s
}

async function loadGeoTiffPixels(file) {
  const { fromArrayBuffer } = await import('geotiff')
  const arrayBuffer = await file.arrayBuffer()
  const tiff   = await fromArrayBuffer(arrayBuffer)
  const image  = await tiff.getImage()
  let width  = image.getWidth()
  let height = image.getHeight()
  // Band 0 only. Without `samples`, geotiff decodes and allocates every band in
  // the file — free on the single-band DEMs this is aimed at, and three times the
  // peak allocation on an RGB-packed raster, none of which is ever read.
  const rasters = await image.readRasters({ samples: [0] })
  let band      = rasters[0]
  // The file's declared NoData value, which the sentinel list cannot stand in
  // for: GDAL writes float DEMs with -3.4028235e+38, and only the *positive*
  // float max is a sentinel, so a void in such a raster would otherwise be read
  // as real ground 3.4e38 metres down — flattening the whole terrain to a
  // plateau once it sets the normalisation range.
  const rawNodata  = tiffTag(image.fileDirectory, 'GDAL_NODATA')
  const parsed     = rawNodata != null ? parseFloat(rawNodata) : NaN   // trailing NUL and all
  const nodataValue = Number.isFinite(parsed) ? parsed : null

  const isNodata = (v) => !isFinite(v) || Math.abs(v) >= FLOAT_VOID
    || (nodataValue !== null && v === nodataValue) || NODATA_SENTINELS.has(v)

  // Extent and CRS, read before anything measures the raster: what shape the
  // pixels are is a question about the projection, and the answer decides the
  // grid everything below is built on.
  let bbox = null, crs = 'EPSG:none', crsName = null, geoKeys = {}
  try {
    geoKeys = (image.getGeoKeys ? image.getGeoKeys() : image.geoKeys) ?? {}
    // A plain TIFF carries none of the three placement tags, and its "bounding
    // box" is then just the pixel grid. The old default of EPSG:4326 turned that
    // grid into a claim about lon/lat, so every GPX point landed off the raster.
    const fd = image.fileDirectory
    if (tiffTag(fd, 'ModelTiepoint') || tiffTag(fd, 'ModelPixelScale') || tiffTag(fd, 'ModelTransformation')) {
      bbox = image.getBoundingBox()
      crs  = detectCrsCode(geoKeys, bbox)
      crsName = citationName(geoKeys)
    }
  } catch (_) { bbox = null; crs = 'EPSG:none'; crsName = null }

  const metresPerUnit = LINEAR_UNITS[geoKeys.ProjLinearUnitsGeoKey] ?? 1   // feet → metres
  let resolution
  try { resolution = image.getResolution() } catch (_) { resolution = null }

  // Square the pixel up on the ground before it becomes a grid. Everything
  // downstream — the mesh, the surface normals hillshade reads, the contour
  // chains, the STL — assumes one world unit per pixel on both axes, and a
  // square-degree raster in the Alps breaks that assumption by half its width.
  // Resampling here is what makes the assumption true rather than threading a
  // second axis step through every consumer of it.
  let squared = null
  if (resolution) {
    const ground = groundPixelSize(resolution[0], resolution[1], crs, bbox, metresPerUnit)
    const shape  = squareGroundShape(width, height, ground)
    if (shape) {
      band = areaResample(band, width, height, shape.width, shape.height, isNodata)
      squared = { from: [width, height], to: [shape.width, shape.height], ground }
      width = shape.width; height = shape.height
      console.log(`[GeoTIFF] ground pixel ${ground.x.toFixed(1)} × ${ground.y.toFixed(1)} m — ` +
                  `resampled ${squared.from.join('×')} → ${squared.to.join('×')} to square it`)
    }
  }

  let min = Infinity, max = -Infinity
  for (let i = 0; i < band.length; i++) {
    const v = band[i]
    if (isNodata(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!isFinite(min) || !isFinite(max) || max === min) throw new Error('GeoTIFF: invalid elevation range.')

  const range = max - min
  const pixels = new Float32Array(band.length)
  const nodataMask = new Uint8Array(band.length)
  
  let minX = width, minY = height, maxX = 0, maxY = 0
  let hasValid = false

  // Walked as rows and columns rather than one flat index, so x and y are
  // induction variables instead of a modulo and a division per pixel. They were
  // computed *before* the NoData branch that is their only consumer, which on an
  // 8k raster is 128 M integer divisions to maintain a bounding box — and every
  // one of them on a cell that may be a void. Same output, one pass.
  const invRange = 1 / range
  for (let y = 0, i = 0; y < height; y++) {
    let rowMinX = width, rowMaxX = -1
    for (let x = 0; x < width; x++, i++) {
      const v = band[i]
      if (isNodata(v)) { pixels[i] = 0; nodataMask[i] = 0; continue }
      pixels[i] = (v - min) * invRange
      nodataMask[i] = 1
      if (x < rowMinX) rowMinX = x
      rowMaxX = x
    }
    // A row holding nothing valid moves no bound — including the y bounds, which
    // is what keeps minY/maxY on rows that actually carry data.
    if (rowMaxX < 0) continue
    hasValid = true
    if (rowMinX < minX) minX = rowMinX
    if (rowMaxX > maxX) maxX = rowMaxX
    if (y < minY) minY = y
    maxY = y
  }

  // Suggest a vertical exaggeration from the real-world pixel size. Classify by
  // CRS, NOT by magnitude: sub-metre lidar pixels are legitimately < 1 in metres,
  // so a "< 1 ⇒ degrees" test mis-scales them ~111320× and flattens the terrain
  // to the clamp floor. `suggestElevScale` owns the rest of the reasoning.
  let suggestedElevScale = null
  try {
    // The *resampled* column size, not the file's: squaring the pixel above
    // changed how much ground one column covers, and this is the figure the
    // whole suggestion turns on.
    suggestedElevScale = suggestElevScale(
      range, Math.abs(resolution[0]) * (squared ? squared.from[0] / squared.to[0] : 1),
      crs, bbox, metresPerUnit,
    )
  } catch (_) {
    // Deliberately silent: the suggestion is a convenience, and a raster whose
    // resolution or unit keys cannot be read is still perfectly loadable. Left
    // null, the caller keeps the user's current exaggeration.
  }

  return {
    pixels, nodataMask, width, height,
    realElevMin: min, realElevMax: max, suggestedElevScale,
    dataWidth: hasValid ? (maxX - minX + 1) : width,
    dataHeight: hasValid ? (maxY - minY + 1) : height,
    bbox, crs, crsName,
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

function friendlyError(err) {
  if (err instanceof RangeError || err?.message?.includes('Array buffer allocation failed') || err?.message?.includes('allocation failed'))
    return 'File is too large to load in the browser. Try a smaller or lower-resolution GeoTIFF.'
  if (err?.message?.includes('invalid elevation range'))
    return 'GeoTIFF contains no valid elevation data.'
  return err?.message || 'Unknown error.'
}

export function useHeightmap() {
  const setHeightmap    = useStore((s) => s.setHeightmap)
  const setGeoTiffMeta  = useStore((s) => s.setGeoTiffMeta)
  const clearGeoTiffMeta = useStore((s) => s.clearGeoTiffMeta)
  const [isLoading,  setIsLoading]  = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [loadError,  setLoadError]  = useState(null)

  const clearError = useCallback(() => setLoadError(null), [])
  // The banner is the app's one place for "that didn't work". Exposed so callers
  // outside this hook — the preset loader, for one — can use it instead of
  // reaching for alert().
  const showError = useCallback((msg) => setLoadError(msg), [])

  const load = useCallback((source) => {
    setIsLoading(true); setLoadingMsg('Loading heightmap…'); setLoadError(null)
    return loadImagePixels(source)
      .then(({ pixels, nodataMask, width, height, dataWidth, dataHeight }) => {
        const filename = typeof source === 'string' ? source.split('/').pop() : source.name
        clearGeoTiffMeta()
        setHeightmap(pixels, nodataMask, width, height, filename)
        setIsLoading(false); setLoadingMsg('')
        return { pixels, nodataMask, width, height, dataWidth, dataHeight }
      })
      .catch(err => {
        setIsLoading(false); setLoadingMsg('')
        setLoadError('Failed to load image: ' + friendlyError(err))
        return null   // signals failure to callers; see loadFromPicker
      })
  }, [setHeightmap, clearGeoTiffMeta])

  const loadFromPicker = useCallback((onLoaded) => {
    // PNG only — this path decodes a greyscale heightmap (incl. 16-bit, which is
    // PNG-specific). 'image/*' let users pick GeoTIFFs/JPEGs that then fail here.
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,.png' })
    // The catch above resolves to null rather than rejecting, so onLoaded must be
    // gated on it — the callbacks destructure their argument and would otherwise
    // throw a TypeError on top of the error the user is already being shown.
    input.onchange = (e) => { if (e.target.files[0]) load(e.target.files[0]).then(r => { if (r) onLoaded(r) }) }
    input.click()
  }, [load])

  // The two [Benchmark] lines below are load telemetry parsed by
  // tests/benchmark.spec.js, which times upload → parse → first render. They
  // read as debug leftovers and are not; deleting them silently guts that spec.
  const loadGeoTiff = useCallback((file) => {
    console.log('[Benchmark] GeoTIFF Upload Started: ' + Date.now())
    setIsLoading(true); setLoadingMsg('Parsing GeoTIFF…'); setLoadError(null)
    return loadGeoTiffPixels(file)
      .then(({ pixels, nodataMask, width, height, realElevMin, realElevMax, suggestedElevScale, dataWidth, dataHeight, bbox, crs, crsName }) => {
        console.log('[Benchmark] GeoTIFF Parsed: ' + Date.now())
        setGeoTiffMeta(realElevMin, realElevMax, bbox, crs, crsName)
        setHeightmap(pixels, nodataMask, width, height, file.name)
        setIsLoading(false); setLoadingMsg('')
        return { pixels, width, height, realElevMin, realElevMax, suggestedElevScale, dataWidth, dataHeight }
      })
      .catch(err => {
        setIsLoading(false); setLoadingMsg('')
        setLoadError('Failed to load GeoTIFF: ' + friendlyError(err))
        console.error(err)
        return null   // signals failure to callers; see loadGeoTiffFromPicker
      })
  }, [setHeightmap, setGeoTiffMeta])

  const loadGeoTiffFromPicker = useCallback((onLoaded) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.tif,.tiff,.geotiff,image/tiff' })
    input.onchange = (e) => { if (e.target.files[0]) loadGeoTiff(e.target.files[0]).then(r => { if (r) onLoaded(r) }) }
    input.click()
  }, [loadGeoTiff])

  return { load, loadFromPicker, loadGeoTiff, loadGeoTiffFromPicker, isLoading, loadingMsg, loadError, clearError, showError }
}
