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
