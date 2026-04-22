/**
 * Loads a heightmap from either a raster image (PNG/JPG) or a GeoTIFF file.
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
      const nodataMask = new Uint8Array(w * h).fill(1) // Images have no NoData by default
      for (let i = 0; i < w * h; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
        pixels[i] = (r + g + b) / (3 * 255)
      }
      resolve({ pixels, nodataMask, width: w, height: h })
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

  let suggestedElevScale = null
  try {
    const resolution = image.getResolution()
    let pixelSizeM   = Math.abs(resolution[0])
    if (pixelSizeM > 0) {
      if (pixelSizeM < 1.0) pixelSizeM = pixelSizeM * 111_320
      suggestedElevScale = range / (pixelSizeM * 100)
      suggestedElevScale = Math.max(0.1, Math.min(50, +suggestedElevScale.toFixed(2)))
    }
  } catch (_) {}

  return { 
    pixels, nodataMask, width, height, 
    realElevMin: min, realElevMax: max, suggestedElevScale,
    dataWidth: hasValid ? (maxX - minX + 1) : width,
    dataHeight: hasValid ? (maxY - minY + 1) : height
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useHeightmap() {
  const setHeightmap    = useStore((s) => s.setHeightmap)
  const setGeoTiffMeta  = useStore((s) => s.setGeoTiffMeta)
  const clearGeoTiffMeta = useStore((s) => s.clearGeoTiffMeta)
  const [isLoading,  setIsLoading]  = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')

  const load = useCallback((source) => {
    setIsLoading(true); setLoadingMsg('Loading heightmap…')
    return loadImagePixels(source)
      .then(({ pixels, nodataMask, width, height }) => {
        const filename = typeof source === 'string' ? source.split('/').pop() : source.name
        clearGeoTiffMeta()
        setHeightmap(pixels, nodataMask, width, height, filename)
        setIsLoading(false); setLoadingMsg('')
        return { pixels, nodataMask, width, height, dataWidth: width, dataHeight: height }
      })
      .catch(err => { setIsLoading(false); setLoadingMsg(''); throw err })
  }, [setHeightmap, clearGeoTiffMeta])

  const loadFromPicker = useCallback((onLoaded) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' })
    input.onchange = (e) => { if (e.target.files[0]) load(e.target.files[0]).then(onLoaded) }
    input.click()
  }, [load])

  const loadGeoTiff = useCallback((file) => {
    setIsLoading(true); setLoadingMsg('Parsing GeoTIFF…')
    return loadGeoTiffPixels(file)
      .then(({ pixels, nodataMask, width, height, realElevMin, realElevMax, suggestedElevScale, dataWidth, dataHeight }) => {
        setGeoTiffMeta(realElevMin, realElevMax)
        setHeightmap(pixels, nodataMask, width, height, file.name)
        setIsLoading(false); setLoadingMsg('')
        return { pixels, width, height, realElevMin, realElevMax, suggestedElevScale, dataWidth, dataHeight }
      })
      .catch(err => { setIsLoading(false); setLoadingMsg(''); console.error(err); throw err })
  }, [setHeightmap, setGeoTiffMeta])

  const loadGeoTiffFromPicker = useCallback((onLoaded) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.tif,.tiff,.geotiff' })
    input.onchange = (e) => { if (e.target.files[0]) loadGeoTiff(e.target.files[0]).then(onLoaded) }
    input.click()
  }, [loadGeoTiff])

  return { load, loadFromPicker, loadGeoTiff, loadGeoTiffFromPicker, isLoading, loadingMsg }
}
