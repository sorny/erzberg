/**
 * Derives terrain grid and line geometry from the raw heightmap + Leva params.
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
    // Terrain Globals
    p.resolution, p.blurRadius, p.gridOffsetX, p.gridOffsetY,
    p.blackPoint, p.whitePoint, p.elevScale, p.elevMinCut, p.elevMaxCut, p.jitterAmt,
    
    // Creative / Mirroring
    p.showMirrorPlusX, p.showMirrorMinusX,
    p.showMirrorPlusY, p.showMirrorMinusY,
    p.showMirrorPlusZ, p.showMirrorMinusZ,

    // Mode: X
    p.enabledX, p.spacingX, p.shiftX, p.colorX, p.weightX, p.opacityX, p.dashX,
    // Mode: Y
    p.enabledY, p.spacingY, p.shiftY, p.colorY, p.weightY, p.opacityY, p.dashY,
    // Mode: Cross
    p.enabledCross, p.spacingCross, p.colorCross, p.weightCross, p.opacityCross, p.dashCross,
    // Mode: Pillars
    p.enabledPillars, p.spacingPillars, p.colorPillars, p.weightPillars, p.opacityPillars, p.dashPillars,
    // Mode: Contours
    p.enabledContours, p.intervalContours, p.colorContours, p.weightContours, p.opacityContours, p.dashContours,
    // Mode: Hachure
    p.enabledHachure, p.spacingHachure, p.lengthHachure, p.colorHachure, p.weightHachure, p.opacityHachure, p.dashHachure,
    // Mode: Flow
    p.enabledFlow, p.spacingFlow, p.stepFlow, p.maxLenFlow, p.colorFlow, p.weightFlow, p.opacityFlow, p.dashFlow,
    // Mode: Network
    p.enabledDag, p.thresholdDag, p.colorDag, p.weightDag, p.opacityDag, p.dashDag,
    // Mode: Pencil
    p.enabledPencil, p.spacingPencil, p.thresholdPencil, p.colorPencil, p.weightPencil, p.opacityPencil, p.dashPencil,

    // Global Line Styling (for fallback)
    p.showLines, p.lineColor, p.strokeWeight, p.lineOpacity, p.lineDash,
    p.lineHypsometric, p.lineBanded, p.lineHypsoInterval, p.lineHypsoWeight, p.lineHypsoMode,
    
    // Global Surface Styling
    p.showFill, p.fillColor, p.fillHypsometric, p.fillBanded, p.fillHypsoInterval, p.fillHypsoWeight, p.fillHypsoMode,
    p.gradientStops,
  ])

  useEffect(() => () => workerRef.current?.terminate(), [])

  return { terrain, lineGeo, surfaceGeo, isComputing }
}
