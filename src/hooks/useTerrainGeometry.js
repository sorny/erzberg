/**
 * Derives terrain grid and line geometry from the raw heightmap + visual params.
 */
import { useState, useEffect, useRef, startTransition } from 'react'
import { useStore } from '../store/useStore'
import GeometryWorker from '../utils/geometry.worker?worker'

export function useTerrainGeometry(p) {
  // Selector-per-field: an unselected useStore() re-renders this hook's owner on
  // every unrelated store write (loading an overlay texture, GeoTIFF metadata, …),
  // and each of those re-renders re-runs the rebuild effect's dependency check.
  const heightmapPixels = useStore((s) => s.heightmapPixels)
  const nodataMask      = useStore((s) => s.nodataMask)
  const heightmapWidth  = useStore((s) => s.heightmapWidth)
  const heightmapHeight = useStore((s) => s.heightmapHeight)

  const [terrain, setTerrain]       = useState(null)
  const [lineGeo, setLineGeo]       = useState(null)
  const [surfaceGeo, setSurfaceGeo] = useState(null)
  const [isComputing, setIsComputing] = useState(false)

  const workerRef = useRef(null)
  const startTimeRef = useRef(0)
  const prevPixelsRef = useRef(null)
  const genRef = useRef(0)
  // True between postMessage and the matching onmessage. Terminating is the only
  // way to cancel a synchronous worker build, so we pay the respawn cost only
  // when there is actually work to kill.
  const busyRef = useRef(false)
  // Which pixel buffer the live worker already holds, so we re-send the (large)
  // raster only when the loaded file actually changed or the worker was replaced.
  const workerPixelsRef = useRef(null)

  useEffect(() => {
    if (!heightmapPixels) {
      workerRef.current?.terminate()
      workerRef.current = null
      workerPixelsRef.current = null
      busyRef.current = false
      setTerrain(null); setLineGeo(null); setSurfaceGeo(null); setIsComputing(false)
      return
    }

    // Cancel an in-flight build so stale results never overwrite the latest params.
    // A worker sitting idle is reused as-is — respawning it would also throw away
    // the cached heightmap and force a full re-clone of the raster.
    if (workerRef.current && busyRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
      workerPixelsRef.current = null
    }

    if (!workerRef.current) {
      workerRef.current = new GeometryWorker()
      workerPixelsRef.current = null
      workerRef.current.onmessage = (e) => {
        const elapsed = Math.round(performance.now() - startTimeRef.current)
        const { terrain, lineGeo, surfaceGeo, error, _gen } = e.data
        busyRef.current = false
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
    }

    setIsComputing(true)
    const gen = ++genRef.current

    // Guard against the race where heightmap pixels arrive before App.jsx has
    // committed the auto-resolution state update. Only clamp on the render
    // where pixels actually changed — user slider changes must never be clamped.
    const pixelsJustChanged = prevPixelsRef.current !== heightmapPixels
    prevPixelsRef.current = heightmapPixels
    const safeResolution = pixelsJustChanged
      ? Math.max(p.resolution, Math.ceil(Math.max(heightmapWidth, heightmapHeight) / 1000))
      : p.resolution

    // Only ship the raster when this worker instance does not already have it.
    const needsPixels = workerPixelsRef.current !== heightmapPixels
    workerPixelsRef.current = heightmapPixels

    startTimeRef.current = performance.now()
    busyRef.current = true
    workerRef.current.postMessage({
      ...(needsPixels ? { heightmapPixels, nodataMask, heightmapWidth, heightmapHeight } : null),
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

    // Mode: Lines
    p.enabledLines, p.spacingLines, p.shiftLines, p.angleLines, p.colorLines,
    p.hypsoLines, p.hypsoModeLines, p.hypsoBandedLines, p.hypsoIntervalLines,
    // Mode: Cross
    p.enabledCross, p.spacingCross, p.angleCross, p.colorCross,
    p.hypsoCross, p.hypsoModeCross, p.hypsoBandedCross, p.hypsoIntervalCross,
    // Mode: Pillars
    p.enabledPillars, p.spacingPillars, p.colorPillars,
    p.hypsoPillars, p.hypsoModePillars, p.hypsoBandedPillars, p.hypsoIntervalPillars,
    p.pillarGap, p.pillarDepth, p.pillarStyle, p.pillarSize, p.pillarSegments, p.pillarLidColor,
    // Mode: Contours
    p.enabledContours, p.intervalContours, p.colorContours,
    p.hypsoContours, p.hypsoModeContours, p.hypsoBandedContours, p.hypsoIntervalContours,
    p.majorIntervalContours, p.majorOffsetContours, p.closeRingsContours, p.smoothingContours,
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
    p.seedStipple, p.colorStipple,
    p.hypsoStipple, p.hypsoModeStipple, p.hypsoBandedStipple, p.hypsoIntervalStipple,
    // Mode: Engraving
    p.enabledEngrave, p.spacingEngrave, p.angleEngrave, p.levelsEngrave, p.sunAzimuthEngrave, p.gammaEngrave,
    p.colorEngrave,
    p.hypsoEngrave, p.hypsoModeEngrave, p.hypsoBandedEngrave, p.hypsoIntervalEngrave,
    // Mode: Swiss rock & scree
    p.enabledSwiss, p.spacingSwiss, p.thresholdSwiss, p.lengthSwiss, p.screeSwiss,
    p.seedSwiss, p.colorSwiss,
    p.hypsoSwiss, p.hypsoModeSwiss, p.hypsoBandedSwiss, p.hypsoIntervalSwiss,

    // NOTE: the fill params (showFill, fillColor, fillBanded, fillHypso*) are
    // render-side only — fill styling is pure GPU uniforms in SurfaceMesh.
    // They are deliberately excluded so toggling/dragging them never spawns a
    // worker rebuild. gradientStops stays: it is baked into line vertex colors.
    p.gradientStops,

    // GPX Track
    p.gpxPoints, p.geoTiffBbox, p.geoTiffCRS, p.colorGpx,
    p.hypsoGpx, p.hypsoModeGpx, p.hypsoBandedGpx, p.hypsoIntervalGpx,
  ])

  useEffect(() => () => workerRef.current?.terminate(), [])

  return { terrain, lineGeo, surfaceGeo, isComputing }
}
