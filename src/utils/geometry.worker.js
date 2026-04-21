/**
 * Web Worker for heavy geometry calculations.
 * Runs on a background thread to keep the UI responsive.
 */
import { buildTerrain } from './terrain'
import { buildLineGeometry, buildSurfaceGeometry } from './geometryBuilders'

self.onmessage = (e) => {
  const { heightmapPixels, nodataMask, heightmapWidth, heightmapHeight, p } = e.data

  try {
    const terrain = buildTerrain(heightmapPixels, nodataMask, heightmapWidth, heightmapHeight, p)
    const lineGeo = buildLineGeometry(terrain, p)
    const surfaceGeo = buildSurfaceGeometry(terrain, p)

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

    self.postMessage({
      terrain,
      lineGeo,
      surfaceGeo
    }, transferables)
  } catch (err) {
    self.postMessage({ error: err.message })
  }
}
