/**
 * Web Worker — all heavy geometry computation runs here to keep the UI thread free.
 *
 * Pipeline per message:
 *   buildTerrain()       → terrain grid, slopes, elevation bounds
 *   buildLineGeometry()  → array of lineGeo layers (the 12 draw modes + mirroring)
 *   buildGpxGeometry()   → optional GPX track layer appended to lineGeo
 *   buildSurfaceGeometry()→ triangulated surface mesh for fill / STL / SVG depth buffer
 *
 * All Float32Array / Uint32Array buffers are transferred (zero-copy) back to the
 * main thread via the Transferables list. After transfer the originals are detached.
 */
import { buildTerrain } from './terrain'
import { buildLineGeometry, buildSurfaceGeometry, buildGpxGeometry } from './geometryBuilders'

self.onmessage = (e) => {
  const { heightmapPixels, nodataMask, heightmapWidth, heightmapHeight, p, _gen } = e.data

  try {
    const terrain = buildTerrain(heightmapPixels, nodataMask, heightmapWidth, heightmapHeight, p)
    const lineGeo = buildLineGeometry(terrain, p)
    const surfaceGeo = buildSurfaceGeometry(terrain, p)

    if (p.gpxPoints?.length > 0 && p.geoTiffBbox && p.geoTiffCRS?.startsWith('EPSG:')) {
      const gpxLayer = buildGpxGeometry(terrain, p, heightmapWidth, heightmapHeight)
      if (gpxLayer) lineGeo.push(gpxLayer)
    }

    // Collect all buffers for Transferables
    const transferables = []

    // 1. Line Layers
    if (Array.isArray(lineGeo)) {
      for (const L of lineGeo) {
        if (L.positions?.buffer) transferables.push(L.positions.buffer)
        if (L.colors?.buffer)    transferables.push(L.colors.buffer)
      }
    }

    // 2. Surface
    if (surfaceGeo.positions?.buffer)     transferables.push(surfaceGeo.positions.buffer)
    if (surfaceGeo.brightnessBuf?.buffer) transferables.push(surfaceGeo.brightnessBuf.buffer)
    if (surfaceGeo.indices?.buffer)       transferables.push(surfaceGeo.indices.buffer)

    self.postMessage({ terrain, lineGeo, surfaceGeo, _gen }, transferables)
  } catch (err) {
    self.postMessage({ error: err.message, _gen })
  }
}
