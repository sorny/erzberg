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
  const { heightmapPixels, heightmapWidth, heightmapHeight } = useStore()

  const [terrain, setTerrain]       = useState(null)
  const [lineGeo, setLineGeo]       = useState(null)
  const [surfaceGeo, setSurfaceGeo] = useState(null)
  const [isComputing, setIsComputing] = useState(false)

  // We keep a single worker instance alive
  const workerRef = useRef(null)

  useEffect(() => {
    if (!heightmapPixels) {
      setTerrain(null)
      setLineGeo(null)
      setSurfaceGeo(null)
      setIsComputing(false)
      return
    }

    // Initialize worker if needed
    if (!workerRef.current) {
      workerRef.current = new GeometryWorker()
    }

    setIsComputing(true)

    // Handle results from the worker
    workerRef.current.onmessage = (e) => {
      const { terrain, lineGeo, surfaceGeo, error } = e.data
      if (error) {
        console.error('[GeometryWorker] Error:', error)
      } else {
        setTerrain(terrain)
        setLineGeo(lineGeo)
        setSurfaceGeo(surfaceGeo)
      }
      setIsComputing(false)
    }

    // Start background calculation
    workerRef.current.postMessage({
      heightmapPixels,
      heightmapWidth,
      heightmapHeight,
      p
    })

    return () => {
      // Note: we don't necessarily want to terminate the worker on every update 
      // as it's expensive to restart, but we could if needed.
    }
  }, [
    heightmapPixels, heightmapWidth, heightmapHeight,
    p.resolution, p.blurRadius, p.gridOffsetX, p.gridOffsetY,
    p.blackPoint, p.whitePoint, p.elevScale,
    p.drawMode, p.lineSpacing, p.lineShift, p.hachureSpacing, p.hachureLength, p.contourInterval,
    p.flowStep, p.flowMaxLen,
    p.elevMinCut, p.elevMaxCut,
    p.jitterAmt,
    p.lineColor, p.fillColor,
    p.lineHypsometric, p.lineBanded, p.lineHypsoInterval, p.lineHypsoWeight, p.lineHypsoMode,
    p.fillHypsometric, p.fillBanded, p.fillHypsoInterval, p.fillHypsoWeight, p.fillHypsoMode,
    p.gradientStops,
  ])

  // Cleanup on unmount
  useEffect(() => () => workerRef.current?.terminate(), [])

  return { terrain, lineGeo, surfaceGeo, isComputing }
}
