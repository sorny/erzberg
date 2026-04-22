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
    p.hypsoX, p.hypsoModeX, p.hypsoBandedX, p.hypsoIntervalX,
    // Mode: Y
    p.enabledY, p.spacingY, p.shiftY, p.colorY, p.weightY, p.opacityY, p.dashY,
    p.hypsoY, p.hypsoModeY, p.hypsoBandedY, p.hypsoIntervalY,
    // Mode: Cross
    p.enabledCross, p.spacingCross, p.colorCross, p.weightCross, p.opacityCross, p.dashCross,
    p.hypsoCross, p.hypsoModeCross, p.hypsoBandedCross, p.hypsoIntervalCross,
    // Mode: Pillars
    p.enabledPillars, p.spacingPillars, p.colorPillars, p.weightPillars, p.opacityPillars, p.dashPillars,
    p.hypsoPillars, p.hypsoModePillars, p.hypsoBandedPillars, p.hypsoIntervalPillars,
    p.pillarGap, p.pillarDepth,
    // Mode: Contours
    p.enabledContours, p.intervalContours, p.colorContours, p.weightContours, p.opacityContours, p.dashContours,
    p.hypsoContours, p.hypsoModeContours, p.hypsoBandedContours, p.hypsoIntervalContours,
    p.majorIntervalContours, p.majorWeightContours, p.majorOffsetContours,
    // Mode: Hachure
    p.enabledHachure, p.spacingHachure, p.lengthHachure, p.colorHachure, p.weightHachure, p.opacityHachure, p.dashHachure,
    p.hypsoHachure, p.hypsoModeHachure, p.hypsoBandedHachure, p.hypsoIntervalHachure,
    // Mode: Flow
    p.enabledFlow, p.spacingFlow, p.stepFlow, p.maxLenFlow, p.colorFlow, p.weightFlow, p.opacityFlow, p.dashFlow,
    p.hypsoFlow, p.hypsoModeFlow, p.hypsoBandedFlow, p.hypsoIntervalFlow,
    // Mode: Network
    p.enabledDag, p.thresholdDag, p.colorDag, p.weightDag, p.opacityDag, p.dashDag,
    p.hypsoDag, p.hypsoModeDag, p.hypsoBandedDag, p.hypsoIntervalDag,
    // Mode: Pencil
    p.enabledPencil, p.spacingPencil, p.thresholdPencil, p.colorPencil, p.weightPencil, p.opacityPencil, p.dashPencil,
    p.hypsoPencil, p.hypsoModePencil, p.hypsoBandedPencil, p.hypsoIntervalPencil,
    // Mode: Ridge
    p.enabledRidge, p.spacingRidge, p.radiusRidge, p.thresholdRidge, p.colorRidge, p.weightRidge, p.opacityRidge, p.dashRidge,
    p.hypsoRidge, p.hypsoModeRidge, p.hypsoBandedRidge, p.hypsoIntervalRidge,
    // Mode: Valley
    p.enabledValley, p.spacingValley, p.radiusValley, p.thresholdValley, p.colorValley, p.weightValley, p.opacityValley, p.dashValley,
    p.hypsoValley, p.hypsoModeValley, p.hypsoBandedValley, p.hypsoIntervalValley,

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
