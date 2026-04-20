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
    const surfaceGeo = buildSurfaceGeometry(terrain, p.elevScale, p.jitterAmt)

    // Send back the results. We use Transferables for the large Float32Arrays 
    // to avoid expensive copying.
    self.postMessage({
      terrain,
      lineGeo,
      surfaceGeo
    }, [
      lineGeo.positions.buffer,
      lineGeo.colors.buffer,
      surfaceGeo.positions.buffer,
      surfaceGeo.brightnessBuf.buffer,
      surfaceGeo.indices.buffer
    ])
  } catch (err) {
    self.postMessage({ error: err.message })
  }
}
