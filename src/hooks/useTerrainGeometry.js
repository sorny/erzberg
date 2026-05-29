/**
 * Derives terrain grid and line geometry from the raw heightmap + visual params.
 */
import { useState, useEffect, useRef, startTransition } from 'react'
import { useStore } from '../store/useStore'
import GeometryWorker from '../utils/geometry.worker?worker'

export function useTerrainGeometry(p) {
  const { heightmapPixels, nodataMask, heightmapWidth, heightmapHeight } = useStore()

  const [terrain, setTerrain]       = useState(null)
  const [lineGeo, setLineGeo]       = useState(null)
  const [surfaceGeo, setSurfaceGeo] = useState(null)
  const [isComputing, setIsComputing] = useState(false)

  const workerRef = useRef(null)
  const startTimeRef = useRef(0)
  const prevPixelsRef = useRef(null)
  const genRef = useRef(0)

  useEffect(() => {
    if (!heightmapPixels) {
      workerRef.current?.terminate()
      workerRef.current = null
      setTerrain(null); setLineGeo(null); setSurfaceGeo(null); setIsComputing(false)
      return
    }

    // Terminate any in-progress computation so stale results never overwrite the latest params.
    workerRef.current?.terminate()
    workerRef.current = new GeometryWorker()
    setIsComputing(true)
    const gen = ++genRef.current

    workerRef.current.onmessage = (e) => {
      const elapsed = Math.round(performance.now() - startTimeRef.current)
      const { terrain, lineGeo, surfaceGeo, error, _gen } = e.data
      if (_gen !== genRef.current) return  // stale result from a superseded computation
      if (error) console.error('[GeometryWorker] Error:', error)
      else {
        startTransition(() => {
          setTerrain(terrain); setLineGeo(lineGeo); setSurfaceGeo(surfaceGeo)
        })
        // Timing telemetry — also parsed by tests/benchmark.spec.js + performance.spec.js.
        console.log(`[Benchmark] Viewport Updated: Worker: ${elapsed}ms`)
        console.log(`[Perf] Terrain ready Main: ${elapsed}ms`)
      }
      setIsComputing(false)
    }

    // Guard against the race where heightmap pixels arrive before App.jsx has
    // committed the auto-resolution state update. Only clamp on the render
    // where pixels actually changed — user slider changes must never be clamped.
    const pixelsJustChanged = prevPixelsRef.current !== heightmapPixels
    prevPixelsRef.current = heightmapPixels
    const safeResolution = pixelsJustChanged
      ? Math.max(p.resolution, Math.ceil(Math.max(heightmapWidth, heightmapHeight) / 1000))
      : p.resolution

    startTimeRef.current = performance.now()
    workerRef.current.postMessage({
      heightmapPixels, nodataMask, heightmapWidth, heightmapHeight,
      p: safeResolution !== p.resolution ? { ...p, resolution: safeResolution } : p,
      _gen: gen,
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

    // NOTE: weight / opacity / dash are render-side (resolved via layerStyle(id, p)
    // in HeightmapLines + svgExport) and deliberately excluded here so dragging
    // those sliders updates the material live without a full geometry rebuild.

    // Mode: X
    p.enabledX, p.spacingX, p.shiftX, p.colorX,
    p.hypsoX, p.hypsoModeX, p.hypsoBandedX, p.hypsoIntervalX,
    // Mode: Y
    p.enabledY, p.spacingY, p.shiftY, p.colorY,
    p.hypsoY, p.hypsoModeY, p.hypsoBandedY, p.hypsoIntervalY,
    // Mode: Cross
    p.enabledCross, p.spacingCross, p.colorCross,
    p.hypsoCross, p.hypsoModeCross, p.hypsoBandedCross, p.hypsoIntervalCross,
    // Mode: Pillars
    p.enabledPillars, p.spacingPillars, p.colorPillars,
    p.hypsoPillars, p.hypsoModePillars, p.hypsoBandedPillars, p.hypsoIntervalPillars,
    p.pillarGap, p.pillarDepth, p.pillarStyle, p.pillarSize, p.pillarSegments, p.pillarLidColor,
    // Mode: Contours
    p.enabledContours, p.intervalContours, p.colorContours,
    p.hypsoContours, p.hypsoModeContours, p.hypsoBandedContours, p.hypsoIntervalContours,
    p.majorIntervalContours, p.majorOffsetContours, p.closeRingsContours,
    p.tanakaContours, p.tanakaSunAzimuth,
    // Mode: Hachure
    p.enabledHachure, p.spacingHachure, p.lengthHachure, p.colorHachure,
    p.hypsoHachure, p.hypsoModeHachure, p.hypsoBandedHachure, p.hypsoIntervalHachure,
    // Mode: Flow
    p.enabledFlow, p.spacingFlow, p.stepFlow, p.maxLenFlow, p.colorFlow,
    p.hypsoFlow, p.hypsoModeFlow, p.hypsoBandedFlow, p.hypsoIntervalFlow,
    // Mode: Network
    p.enabledDag, p.thresholdDag, p.colorDag,
    p.hypsoDag, p.hypsoModeDag, p.hypsoBandedDag, p.hypsoIntervalDag,
    // Mode: Pencil
    p.enabledPencil, p.spacingPencil, p.thresholdPencil, p.colorPencil,
    p.hypsoPencil, p.hypsoModePencil, p.hypsoBandedPencil, p.hypsoIntervalPencil,
    // Mode: Ridge
    p.enabledRidge, p.spacingRidge, p.radiusRidge, p.thresholdRidge, p.colorRidge,
    p.hypsoRidge, p.hypsoModeRidge, p.hypsoBandedRidge, p.hypsoIntervalRidge,
    // Mode: Valley
    p.enabledValley, p.spacingValley, p.radiusValley, p.thresholdValley, p.colorValley,
    p.hypsoValley, p.hypsoModeValley, p.hypsoBandedValley, p.hypsoIntervalValley,
    // Mode: Stipple
    p.enabledStipple, p.spacingStipple, p.stippleDensityMode, p.stippleGamma, p.stippleJitter,
    p.colorStipple,
    p.hypsoStipple, p.hypsoModeStipple, p.hypsoBandedStipple, p.hypsoIntervalStipple,

    // Master line visibility
    p.showLines,

    // Global Surface Styling
    p.showFill, p.fillColor, p.fillHypsometric, p.fillBanded, p.fillHypsoInterval, p.fillHypsoWeight, p.fillHypsoMode,
    p.gradientStops,

    // GPX Track
    p.gpxPoints, p.geoTiffBbox, p.geoTiffCRS, p.colorGpx,
    p.hypsoGpx, p.hypsoModeGpx, p.hypsoBandedGpx, p.hypsoIntervalGpx,
  ])

  useEffect(() => () => workerRef.current?.terminate(), [])

  return { terrain, lineGeo, surfaceGeo, isComputing }
}
