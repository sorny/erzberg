/**
 * Loads a heightmap from either a raster image (PNG/JPG) or a GeoTIFF file.
 */
import { useCallback, useState } from 'react'
import { useStore } from '../store/useStore'

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
    img.onload = () => {
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
    img.onerror = reject
    img.src = typeof source === 'string' ? source : URL.createObjectURL(source)
  })
}

// ── GeoTIFF loader ───────────────────────────────────────────────────────────

const NODATA_SENTINELS = new Set([-9999, -9999.0, -32767, -32768, 3.4028234663852886e+38])

async function loadGeoTiffPixels(file) {
  const { fromArrayBuffer } = await import('geotiff')
  const arrayBuffer = await file.arrayBuffer()
  const tiff   = await fromArrayBuffer(arrayBuffer)
  const image  = await tiff.getImage()
  const width  = image.getWidth()
  const height = image.getHeight()
  const rasters = await image.readRasters()
  const band    = rasters[0]
  const fileDir    = image.fileDirectory
  let nodataValue  = null
  if (fileDir.GDAL_NODATA != null) nodataValue = parseFloat(fileDir.GDAL_NODATA)

  const isNodata = (v) => !isFinite(v) || (nodataValue !== null && v === nodataValue) || NODATA_SENTINELS.has(v)

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

  for (let i = 0; i < band.length; i++) {
    const v = band[i]
    const x = i % width
    const y = Math.floor(i / width)

    if (isNodata(v)) {
      pixels[i] = 0; nodataMask[i] = 0
    } else {
      pixels[i] = (v - min) / range; nodataMask[i] = 1
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      hasValid = true
    }
  }

  // Extract geographic extent for GPX coordinate projection.
  // CRS detection strategy: read ProjectedCSTypeGeoKey first (reliable when present),
  // fall back to GTModelTypeGeoKey, then fall back to a bbox-value heuristic —
  // coordinates outside ±360° / ±90° cannot be geographic degrees, so they must be
  // projected meters (e.g. UTM). Default assumption is EPSG:4326 (geographic).
  let bbox = null, crs = 'EPSG:4326', isGeographic = true
  try {
    bbox = image.getBoundingBox()
    const gk = (image.getGeoKeys ? image.getGeoKeys() : image.geoKeys) ?? {}
    const projCS = gk.ProjectedCSTypeGeoKey

    if (projCS) {
      crs = projCS === 3857 ? 'EPSG:3857' : `EPSG:${projCS}`
      isGeographic = false
    } else if (gk.GTModelTypeGeoKey === 1) {
      crs = 'EPSG:projected-unknown'
      isGeographic = false
    } else if (bbox && (Math.abs(bbox[0]) > 360 || Math.abs(bbox[1]) > 90)) {
      crs = 'EPSG:projected-unknown'
      isGeographic = false
    } else if (gk.GTModelTypeGeoKey === 2 || gk.GeographicTypeGeoKey) {
      isGeographic = true
    }
  } catch (_) {}

  // Suggest a vertical exaggeration from the real-world pixel size. A projected
  // CRS (UTM, Web Mercator, …) already reports pixel size in metres — never scale
  // it. Only a geographic CRS reports degrees, which must be converted to metres.
  // Classify by CRS, NOT by magnitude: sub-metre lidar pixels are legitimately
  // < 1 in metres, so a "< 1 ⇒ degrees" test mis-scales them ~111320× and flattens
  // the terrain to the clamp floor.
  let suggestedElevScale = null
  try {
    const resolution = image.getResolution()
    let pixelSizeM   = Math.abs(resolution[0])
    if (pixelSizeM > 0) {
      if (isGeographic) pixelSizeM = pixelSizeM * 111_320  // degrees → metres
      suggestedElevScale = range / (pixelSizeM * 100)
      suggestedElevScale = Math.max(0.1, Math.min(50, +suggestedElevScale.toFixed(2)))
    }
  } catch (_) {}

  return {
    pixels, nodataMask, width, height,
    realElevMin: min, realElevMax: max, suggestedElevScale,
    dataWidth: hasValid ? (maxX - minX + 1) : width,
    dataHeight: hasValid ? (maxY - minY + 1) : height,
    bbox, crs,
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
      })
  }, [setHeightmap, clearGeoTiffMeta])

  const loadFromPicker = useCallback((onLoaded) => {
    // PNG only — this path decodes a greyscale heightmap (incl. 16-bit, which is
    // PNG-specific). 'image/*' let users pick GeoTIFFs/JPEGs that then fail here.
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/png,.png' })
    input.onchange = (e) => { if (e.target.files[0]) load(e.target.files[0]).then(onLoaded) }
    input.click()
  }, [load])

  const loadGeoTiff = useCallback((file) => {
    console.log('[Benchmark] GeoTIFF Upload Started: ' + Date.now())
    setIsLoading(true); setLoadingMsg('Parsing GeoTIFF…'); setLoadError(null)
    return loadGeoTiffPixels(file)
      .then(({ pixels, nodataMask, width, height, realElevMin, realElevMax, suggestedElevScale, dataWidth, dataHeight, bbox, crs }) => {
        console.log('[Benchmark] GeoTIFF Parsed: ' + Date.now())
        setGeoTiffMeta(realElevMin, realElevMax, bbox, crs)
        setHeightmap(pixels, nodataMask, width, height, file.name)
        setIsLoading(false); setLoadingMsg('')
        return { pixels, width, height, realElevMin, realElevMax, suggestedElevScale, dataWidth, dataHeight }
      })
      .catch(err => {
        setIsLoading(false); setLoadingMsg('')
        setLoadError('Failed to load GeoTIFF: ' + friendlyError(err))
        console.error(err)
      })
  }, [setHeightmap, setGeoTiffMeta])

  const loadGeoTiffFromPicker = useCallback((onLoaded) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.tif,.tiff,.geotiff,image/tiff' })
    input.onchange = (e) => { if (e.target.files[0]) loadGeoTiff(e.target.files[0]).then(onLoaded) }
    input.click()
  }, [loadGeoTiff])

  return { load, loadFromPicker, loadGeoTiff, loadGeoTiffFromPicker, isLoading, loadingMsg, loadError, clearError }
}
