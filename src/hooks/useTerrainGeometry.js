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
  // Increments on every delivered result. Consumers use it to tell "a build is
  // running but frames are still arriving" (streaming) from "a build is running
  // and nothing has come back" (a genuine stall worth an overlay).
  const [resultCount, setResultCount] = useState(0)

  const workerRef = useRef(null)
  const startTimeRef = useRef(0)
  const prevPixelsRef = useRef(null)
  const genRef = useRef(0)
  // True between postMessage and the matching onmessage.
  const busyRef = useRef(false)
  // Which pixel buffer the live worker already holds, so we re-send the (large)
  // raster only when the loaded file actually changed or the worker was replaced.
  const workerPixelsRef = useRef(null)
  // Newest request that arrived while a build was running; only the latest is
  // kept, since intermediate states are never displayed.
  const pendingRef = useRef(null)
  const buildStartRef = useRef(0)
  const sendRef = useRef(null)

  // Floor for how long an in-flight build may run before a newer request
  // cancels it outright instead of queueing behind it.
  //
  // Terminating is the only way to interrupt a synchronous worker, but it also
  // destroys the cached raster and costs a worker respawn. Cancelling on *every*
  // superseding request is catastrophic when requests arrive faster than builds
  // complete — Soundscapes streaming at 30/s into 44 ms builds killed every
  // single one and completed 0.2 builds/s. Queueing instead lets each build
  // finish and run at the pipeline's natural rate.
  //
  // A fixed threshold would reintroduce exactly that failure at a heavier
  // setting (200 ms builds would all die at 150 ms), so the budget also scales
  // with what this pipeline has actually been completing. The rule is "cancel
  // only a build that is an outlier against the current cadence": a steady
  // stream never trips it, while a single huge rebuild queued behind fast ones
  // — dragging Resolution on a large GeoTIFF — still gets killed promptly.
  const CANCEL_AFTER_MS = 150
  const CANCEL_DURATION_FACTOR = 3
  const lastDurationRef = useRef(0)

  const ensureWorker = () => {
    if (workerRef.current) return
    workerRef.current = new GeometryWorker()
    workerPixelsRef.current = null
    workerRef.current.onmessage = (e) => {
      const elapsed = Math.round(performance.now() - startTimeRef.current)
      const { terrain, lineGeo, surfaceGeo, error, _gen } = e.data
      busyRef.current = false
      lastDurationRef.current = performance.now() - buildStartRef.current
      if (_gen === genRef.current) {
        if (error) console.error('[GeometryWorker] Error:', error)
        else {
          startTransition(() => {
            setTerrain(terrain); setLineGeo(lineGeo); setSurfaceGeo(surfaceGeo)
            setResultCount((n) => n + 1)
          })
          // Timing telemetry — also parsed by tests/benchmark.spec.js + performance.spec.js.
          console.log(`[Benchmark] Viewport Updated: Worker: ${elapsed}ms`)
          console.log(`[Perf] Terrain ready Main: ${elapsed}ms`)
        }
      }
      // Drain a queued request rather than idling — this is what turns a
      // faster-than-realtime request stream into steady throughput.
      const next = pendingRef.current
      pendingRef.current = null
      if (next) sendRef.current(next)
      else setIsComputing(false)
    }
  }

  const send = (req) => {
    ensureWorker()
    // Decided at send time, not request time: a queued request may be sent to a
    // different worker than the one that was live when it was created.
    const needsPixels = workerPixelsRef.current !== req.pixels
    workerPixelsRef.current = req.pixels
    startTimeRef.current = performance.now()
    buildStartRef.current = startTimeRef.current
    busyRef.current = true
    workerRef.current.postMessage({
      ...(needsPixels
        ? { heightmapPixels: req.pixels, nodataMask: req.mask, heightmapWidth: req.w, heightmapHeight: req.h }
        : null),
      p: req.p,
      _gen: ++genRef.current,
    })
  }
  sendRef.current = send

  useEffect(() => {
    if (!heightmapPixels) {
      workerRef.current?.terminate()
      workerRef.current = null
      workerPixelsRef.current = null
      pendingRef.current = null
      busyRef.current = false
      setTerrain(null); setLineGeo(null); setSurfaceGeo(null); setIsComputing(false)
      return
    }

    // Guard against the race where heightmap pixels arrive before App.jsx has
    // committed the auto-resolution state update. Only clamp on the render
    // where pixels actually changed — user slider changes must never be clamped.
    const pixelsJustChanged = prevPixelsRef.current !== heightmapPixels
    prevPixelsRef.current = heightmapPixels
    const safeResolution = pixelsJustChanged
      ? Math.max(p.resolution, Math.ceil(Math.max(heightmapWidth, heightmapHeight) / 1000))
      : p.resolution

    const req = {
      p: safeResolution !== p.resolution ? { ...p, resolution: safeResolution } : p,
      pixels: heightmapPixels, mask: nodataMask,
      w: heightmapWidth, h: heightmapHeight,
    }

    setIsComputing(true)

    if (busyRef.current) {
      const budget = Math.max(CANCEL_AFTER_MS, lastDurationRef.current * CANCEL_DURATION_FACTOR)
      if (performance.now() - buildStartRef.current > budget) {
        workerRef.current?.terminate()
        workerRef.current = null
        workerPixelsRef.current = null
        busyRef.current = false
        pendingRef.current = null
        send(req)
      } else {
        pendingRef.current = req   // newest wins
      }
      return
    }

    send(req)
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
    // Mode: Curvature engraving
    p.enabledCurv, p.spacingCurv, p.lengthCurv, p.thresholdCurv, p.radiusCurv,
    p.dirModeCurv, p.stepCurv, p.colorCurv,
    p.hypsoCurv, p.hypsoModeCurv, p.hypsoBandedCurv, p.hypsoIntervalCurv,
    // Mode: Swiss rock & scree
    p.enabledSwiss, p.spacingSwiss, p.thresholdSwiss, p.lengthSwiss, p.screeSwiss,
    p.seedSwiss, p.colorSwiss,
    p.hypsoSwiss, p.hypsoModeSwiss, p.hypsoBandedSwiss, p.hypsoIntervalSwiss,

    // Whether the surface mesh needs shading attributes (normals/UVs) at all.
    // This is the one fill-related value that must rebuild geometry: with no
    // fill layer on, the worker skips building them entirely, so switching one
    // on has to regenerate them. Individual fill *styling* params below stay
    // render-side.
    p.needsSurfaceShading,

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

  return { terrain, lineGeo, surfaceGeo, isComputing, resultCount }
}
