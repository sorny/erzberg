/**
 * Derives terrain grid and line geometry from the raw heightmap + Leva params.
 *
 * This hook offloads heavy CPU calculations to a Web Worker to keep the UI
 * responsive and allow loading indicators to render during background work.
 */
import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import GeometryWorker from '../utils/geometry.worker?worker'

export function useTerrainGeometry(p) {
  const { heightmapPixels, nodataMask, heightmapWidth, heightmapHeight } = useStore()

  const [terrain, setTerrain]       = useState(null)
  const [lineGeo, setLineGeo]       = useState(null)
  const [surfaceGeo, setSurfaceGeo] = useState(null)
  const [isComputing, setIsComputing] = useState(false)

  const workerRef = useRef(null)

  useEffect(() => {
    if (!heightmapPixels) {
      setTerrain(null); setLineGeo(null); setSurfaceGeo(null); setIsComputing(false)
      return
    }

    if (!workerRef.current) workerRef.current = new GeometryWorker()
    setIsComputing(true)

    workerRef.current.onmessage = (e) => {
      const { terrain, lineGeo, surfaceGeo, error } = e.data
      if (error) console.error('[GeometryWorker] Error:', error)
      else { setTerrain(terrain); setLineGeo(lineGeo); setSurfaceGeo(surfaceGeo) }
      setIsComputing(false)
    }

    workerRef.current.postMessage({
      heightmapPixels, nodataMask, heightmapWidth, heightmapHeight, p
    })
  }, [
    heightmapPixels, nodataMask, heightmapWidth, heightmapHeight,
    p.resolution, p.blurRadius, p.gridOffsetX, p.gridOffsetY,
    p.blackPoint, p.whitePoint, p.elevScale,
    p.drawMode, p.lineSpacing, p.lineShift, p.hachureSpacing, p.hachureLength, p.contourInterval,
    p.flowStep, p.flowMaxLen, p.strahlerThreshold,
    p.curvatureThreshold, p.curvatureDensity,
    p.elevMinCut, p.elevMaxCut,
    p.jitterAmt,
    p.lineColor, p.fillColor,
    p.lineHypsometric, p.lineBanded, p.lineHypsoInterval, p.lineHypsoWeight, p.lineHypsoMode,
    p.fillHypsometric, p.fillBanded, p.fillHypsoInterval, p.fillHypsoWeight, p.fillHypsoMode,
    p.gradientStops,
  ])

  useEffect(() => () => workerRef.current?.terminate(), [])

  return { terrain, lineGeo, surfaceGeo, isComputing }
}
