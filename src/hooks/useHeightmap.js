/**
 * Loads a heightmap from either a raster image (PNG/JPG) or a GeoTIFF file.
 *
 * Both paths produce the same output: a Float32Array of 0–1 brightness values
 * stored in the Zustand store, ready for the terrain pipeline.
 *
 * GeoTIFF path:
 *   - Reads band 1 (elevation in native units, e.g. metres)
 *   - Excludes nodata pixels (from metadata or common sentinel values)
 *   - Normalises the valid range to [0, 1] via min-max
 *   - Nodata pixels are clamped to 0 (lowest elevation)
 *   - Computes suggestedElevScale for real-world proportions:
 *       elevScale = elevRange_m / (pixelSize_m × 100)
 *     At elevScale=1.0 and this scale, 100 world-units of terrain height
 *     corresponds to the same real-world ratio as 1 world-unit per pixel.
 *
 * Returns { load, loadFromPicker, loadGeoTiff, loadGeoTiffFromPicker, isLoading, loadingMsg }.
 */
import { useCallback, useState } from 'react'
import { useStore } from '../store/useStore'

// ── Image (PNG / JPG) loader ─────────────────────────────────────────────────

function loadImagePixels(source) {
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
      for (let i = 0; i < w * h; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
        pixels[i] = (r + g + b) / (3 * 255)
      }
      resolve({ pixels, width: w, height: h })
    }

    img.onerror = reject
    img.src = typeof source === 'string' ? source : URL.createObjectURL(source)
  })
}

// ── GeoTIFF loader ───────────────────────────────────────────────────────────

// Common nodata sentinel values used by elevation datasets when metadata
// does not specify a nodata value.
const NODATA_SENTINELS = new Set([-9999, -9999.0, -32767, -32768, 3.4028234663852886e+38])

async function loadGeoTiffPixels(file) {
  // Dynamic import keeps geotiff out of the main bundle until needed
  const { fromArrayBuffer } = await import('geotiff')

  const arrayBuffer = await file.arrayBuffer()
  const tiff   = await fromArrayBuffer(arrayBuffer)
  const image  = await tiff.getImage()

  const width  = image.getWidth()
  const height = image.getHeight()

  // Read all bands; use band 0 (elevation convention for single-band DEMs)
  const rasters = await image.readRasters()
  const band    = rasters[0]

  // Determine the nodata value from TIFF metadata
  const fileDir    = image.fileDirectory
  let nodataValue  = null
  if (fileDir.GDAL_NODATA != null) {
    nodataValue = parseFloat(fileDir.GDAL_NODATA)
  }

  const isNodata = (v) =>
    !isFinite(v)
    || (nodataValue !== null && v === nodataValue)
    || NODATA_SENTINELS.has(v)

  // Pass 1: find valid min/max (exclude nodata and sentinels)
  let min = Infinity, max = -Infinity
  for (let i = 0; i < band.length; i++) {
    const v = band[i]
    if (isNodata(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }

  if (!isFinite(min) || !isFinite(max) || max === min) {
    throw new Error('GeoTIFF: could not determine a valid elevation range.')
  }

  const range = max - min

  // Pass 2: normalise to [0, 1]; clamp nodata to 0
  const pixels = new Float32Array(band.length)
  for (let i = 0; i < band.length; i++) {
    pixels[i] = isNodata(band[i]) ? 0 : (band[i] - min) / range
  }

  // ── Compute suggested elevScale for real-world proportions ────────────────
  //
  // The terrain pipeline maps brightness to elevation as:
  //   elev = (brightness − 0.5) × 100 × elevScale   (world units)
  // so the full elevation range in world units = 100 × elevScale.
  //
  // The horizontal extent in world units ≈ imageWidth  (1 world unit per pixel).
  //
  // For 1:1 real-world proportions:
  //   elevRange_worldUnits / width_worldUnits = elevRange_m / width_m
  //   (100 × elevScale) / width = range_m / (width × pixelSize_m)
  //   elevScale = range_m / (pixelSize_m × 100)
  //
  // If pixelSize is in degrees (geographic CRS, typically < 1), convert to
  // metres using 1° ≈ 111 320 m (good enough for visualisation purposes).

  let suggestedElevScale = null
  try {
    const resolution = image.getResolution()   // [xRes, yRes] in CRS units/pixel
    let pixelSizeM   = Math.abs(resolution[0])
    if (pixelSizeM > 0) {
      if (pixelSizeM < 1.0) {
        // Likely geographic CRS (degrees) — convert to approximate metres
        pixelSizeM = pixelSizeM * 111_320
      }
      suggestedElevScale = range / (pixelSizeM * 100)
      // Clamp to a sensible UI range
      suggestedElevScale = Math.max(0.1, Math.min(50, +suggestedElevScale.toFixed(2)))
    }
  } catch (_) { /* resolution not available — leave null */ }

  return { pixels, width, height, realElevMin: min, realElevMax: max, suggestedElevScale }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useHeightmap() {
  const setHeightmap    = useStore((s) => s.setHeightmap)
  const setGeoTiffMeta  = useStore((s) => s.setGeoTiffMeta)
  const clearGeoTiffMeta = useStore((s) => s.clearGeoTiffMeta)
  const [isLoading,  setIsLoading]  = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')

  // ── Load image (File object or URL string) ──────────────────────────────
  const load = useCallback((source) => {
    setIsLoading(true)
    setLoadingMsg('Loading heightmap…')
    return loadImagePixels(source)
      .then(({ pixels, width, height }) => {
        const filename = typeof source === 'string'
          ? source.split('/').pop()
          : source.name
        clearGeoTiffMeta()   // clear any previous GeoTIFF metadata
        setHeightmap(pixels, width, height, filename)
        setIsLoading(false)
        setLoadingMsg('')
        return { pixels, width, height }
      })
      .catch(err => {
        setIsLoading(false)
        setLoadingMsg('')
        throw err
      })
  }, [setHeightmap, clearGeoTiffMeta])

  const loadFromPicker = useCallback((onLoaded) => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      accept: 'image/*',
    })
    input.onchange = (e) => {
      if (e.target.files[0]) load(e.target.files[0]).then(onLoaded).catch(() => {})
    }
    input.click()
  }, [load])

  // ── Load GeoTIFF ─────────────────────────────────────────────────────────
  //
  // Resolves with { pixels, width, height, realElevMin, realElevMax, suggestedElevScale }
  // so the caller (App.jsx) can auto-apply the suggested elevScale.
  const loadGeoTiff = useCallback((file) => {
    setIsLoading(true)
    setLoadingMsg('Parsing GeoTIFF…')
    return loadGeoTiffPixels(file)
      .then(({ pixels, width, height, realElevMin, realElevMax, suggestedElevScale }) => {
        setGeoTiffMeta(realElevMin, realElevMax)
        setHeightmap(pixels, width, height, file.name)
        setIsLoading(false)
        setLoadingMsg('')
        return { pixels, width, height, realElevMin, realElevMax, suggestedElevScale }
      })
      .catch(err => {
        setIsLoading(false)
        setLoadingMsg('')
        console.error('[GeoTIFF] Load failed:', err)
        alert(`GeoTIFF load failed: ${err.message}`)
        throw err
      })
  }, [setHeightmap, setGeoTiffMeta])

  const loadGeoTiffFromPicker = useCallback((onLoaded) => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      accept: '.tif,.tiff,.geotiff',
    })
    input.onchange = (e) => {
      if (e.target.files[0]) {
        loadGeoTiff(e.target.files[0]).then(onLoaded).catch(() => {})
      }
    }
    input.click()
  }, [loadGeoTiff])

  return { load, loadFromPicker, loadGeoTiff, loadGeoTiffFromPicker, isLoading, loadingMsg }
}
