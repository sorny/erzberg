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
 *
 * Returns { load, loadFromPicker, loadGeoTiffFromPicker, isLoading, loadingMsg }.
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

  // Read all bands so we can pick the best one
  const rasters = await image.readRasters()

  // Prefer a single-band file; for multi-band take band 0 (elevation convention)
  const band = rasters[0]

  // Determine the nodata value from TIFF metadata (GDAL stores it in the
  // TIFFTAG_GDAL_METADATA XML or as a per-sample value in the file directory).
  let nodataValue = null
  const fileDir = image.fileDirectory
  if (fileDir.GDAL_NODATA != null) {
    nodataValue = parseFloat(fileDir.GDAL_NODATA)
  }

  // Pass 1: find valid min/max (exclude nodata and common sentinel values)
  let min = Infinity, max = -Infinity
  for (let i = 0; i < band.length; i++) {
    const v = band[i]
    if (!isFinite(v)) continue
    if (nodataValue !== null && v === nodataValue) continue
    if (NODATA_SENTINELS.has(v)) continue
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
    const v = band[i]
    const isNodata = !isFinite(v)
      || (nodataValue !== null && v === nodataValue)
      || NODATA_SENTINELS.has(v)
    pixels[i] = isNodata ? 0 : (v - min) / range
  }

  return { pixels, width, height }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useHeightmap() {
  const setHeightmap = useStore((s) => s.setHeightmap)
  const [isLoading,  setIsLoading]  = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')

  const finalize = useCallback((pixels, width, height, filename) => {
    setHeightmap(pixels, width, height, filename)
    setIsLoading(false)
    setLoadingMsg('')
  }, [setHeightmap])

  // ── Load image (File object or URL string) ──────────────────────────────
  const load = useCallback((source) => {
    setIsLoading(true)
    setLoadingMsg('Loading heightmap…')
    return loadImagePixels(source)
      .then(({ pixels, width, height }) => {
        const filename = typeof source === 'string'
          ? source.split('/').pop()
          : source.name
        finalize(pixels, width, height, filename)
        return { pixels, width, height }
      })
      .catch(err => {
        setIsLoading(false)
        setLoadingMsg('')
        throw err
      })
  }, [finalize])

  const loadFromPicker = useCallback(() => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      accept: 'image/*',
    })
    input.onchange = (e) => { if (e.target.files[0]) load(e.target.files[0]) }
    input.click()
  }, [load])

  // ── Load GeoTIFF ─────────────────────────────────────────────────────────
  const loadGeoTiff = useCallback((file) => {
    setIsLoading(true)
    setLoadingMsg('Parsing GeoTIFF…')
    return loadGeoTiffPixels(file)
      .then(({ pixels, width, height }) => {
        finalize(pixels, width, height, file.name)
        return { pixels, width, height }
      })
      .catch(err => {
        setIsLoading(false)
        setLoadingMsg('')
        console.error('[GeoTIFF] Load failed:', err)
        alert(`GeoTIFF load failed: ${err.message}`)
        throw err
      })
  }, [finalize])

  const loadGeoTiffFromPicker = useCallback(() => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      accept: '.tif,.tiff,.geotiff',
    })
    input.onchange = (e) => { if (e.target.files[0]) loadGeoTiff(e.target.files[0]) }
    input.click()
  }, [loadGeoTiff])

  return { load, loadFromPicker, loadGeoTiff, loadGeoTiffFromPicker, isLoading, loadingMsg }
}
