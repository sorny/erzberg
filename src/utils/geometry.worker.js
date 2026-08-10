/**
 * Web Worker — all heavy geometry computation runs here to keep the UI thread free.
 *
 * Pipeline per message:
 *   buildTerrain()       → terrain grid, slopes, elevation bounds
 *   buildLineGeometry()  → array of lineGeo layers (the 14 draw modes + mirroring)
 *   buildGpxGeometry()   → optional GPX track layer appended to lineGeo
 *   buildSurfaceGeometry()→ triangulated surface mesh for fill / SVG depth buffer
 *
 * The source heightmap is CACHED here across messages. It is by far the largest
 * thing in the payload (an 8k GeoTIFF is a 256 MB Float32Array) and it does not
 * change when a style slider moves, so re-sending it per rebuild meant a full
 * structured-clone copy on every drag tick. The main thread now sends the pixels
 * once per loaded file; subsequent builds carry only the params object.
 *
 * All Float32Array / Uint32Array buffers are transferred (zero-copy) back to the
 * main thread via the Transferables list. After transfer the originals are detached.
 */
import { boxBlur, buildTerrain } from './terrain'
import { buildLineGeometry, buildSurfaceGeometry, buildGpxGeometry } from './geometryBuilders'
import { isTrackProjectable } from './geoCoords'

// Cached source raster — replaced only by a message carrying `heightmapPixels`.
let src = null

// Cached blur of that raster. The blur is a function of the raster and the
// radius alone, but buildTerrain re-ran it on every message — so dragging an
// unrelated style slider re-blurred the full-resolution image each tick, which
// at 8k is the single most expensive thing in the pipeline. Keyed on identity of
// the pixels plus the radius; anything else invalidates it.
//
// It costs one extra full-size buffer held for as long as the raster is loaded,
// but only when blur is actually on: at radius 0 boxBlur returns its input, so
// the cache holds the same array `src` already does.
let blurCache = { pixels: null, radius: -1, result: null }

function blurredSource(p) {
  const radius = p.blurRadius ?? 0
  if (blurCache.pixels === src.heightmapPixels && blurCache.radius === radius) {
    return blurCache.result
  }
  const result = boxBlur(src.heightmapPixels, src.heightmapWidth, src.heightmapHeight, radius)
  blurCache = { pixels: src.heightmapPixels, radius, result }
  return result
}

self.onmessage = (e) => {
  const { heightmapPixels, nodataMask, heightmapWidth, heightmapHeight, p, _gen } = e.data

  // A message with pixels refreshes the cache; one without reuses it.
  if (heightmapPixels) src = { heightmapPixels, nodataMask, heightmapWidth, heightmapHeight }
  if (!src) {
    self.postMessage({ error: 'No heightmap loaded in worker.', _gen })
    return
  }

  try {
    const terrain = buildTerrain(
      src.heightmapPixels, src.nodataMask, src.heightmapWidth, src.heightmapHeight, p,
      blurredSource(p)
    )
    const lineGeo = buildLineGeometry(terrain, p)
    const surfaceGeo = buildSurfaceGeometry(terrain, p)

    if (p.gpxPoints?.length > 0 && isTrackProjectable(p.geoTiffCRS, p.geoTiffBbox)) {
      const gpxLayer = buildGpxGeometry(terrain, p, src.heightmapWidth, src.heightmapHeight)
      if (gpxLayer) lineGeo.push(gpxLayer)
    }

    // Collect all buffers for zero-copy Transferables. A Set guards against
    // pushing the same ArrayBuffer twice (postMessage throws on duplicates).
    const seen = new Set()
    const transferables = []
    const xfer = (arr) => {
      const buf = arr?.buffer
      if (buf && !seen.has(buf)) { seen.add(buf); transferables.push(buf) }
    }

    // 1. Line layers — including the curtain/lid meshes, which are the largest
    //    arrays in the payload and were previously structured-cloned every rebuild.
    if (Array.isArray(lineGeo)) {
      for (const L of lineGeo) {
        xfer(L.positions)
        xfer(L.colors)
        xfer(L.curtains?.positions)
        xfer(L.curtains?.indices)
        xfer(L.lids?.positions)
        xfer(L.lids?.colors)
        xfer(L.lids?.indices)
      }
    }

    // 2. Surface
    xfer(surfaceGeo.positions)
    xfer(surfaceGeo.brightnessBuf)
    xfer(surfaceGeo.indices)
    xfer(surfaceGeo.normals)
    xfer(surfaceGeo.uvs)

    // 3. Terrain grids (consumed on the main thread by particles / sampling).
    //    buildSurfaceGeometry/buildGpxGeometry above already finished reading them.
    xfer(terrain.grid)
    xfer(terrain.gridMask)
    xfer(terrain.gridSlopes)

    self.postMessage({ terrain, lineGeo, surfaceGeo, _gen }, transferables)
  } catch (err) {
    self.postMessage({ error: err.message, _gen })
  }
}
