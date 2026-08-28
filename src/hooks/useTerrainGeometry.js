/**
 * Derives terrain grid and line geometry from the raw heightmap + visual params.
 */
import { useState, useEffect, useMemo, useRef, startTransition } from 'react'
import { useStore } from '../store/useStore'
import { vectorBuildSignature } from '../utils/vectorLayers'
import GeometryWorker from '../utils/geometry.worker?worker'

export function useTerrainGeometry(p) {
  // Selector-per-field: an unselected useStore() re-renders this hook's owner on
  // every unrelated store write (loading an overlay texture, GeoTIFF metadata, …),
  // and each of those re-renders re-runs the rebuild effect's dependency check.
  const heightmapPixels = useStore((s) => s.heightmapPixels)
  const nodataMask      = useStore((s) => s.nodataMask)
  const heightmapWidth  = useStore((s) => s.heightmapWidth)
  const heightmapHeight = useStore((s) => s.heightmapHeight)
  const vectorSources   = useStore((s) => s.vectorSources)

  const [terrain, setTerrain]       = useState(null)
  const [lineGeo, setLineGeo]       = useState(null)
  const [vectorGeo, setVectorGeo]   = useState(null)
  const [surfaceGeo, setSurfaceGeo] = useState(null)
  const [isComputing, setIsComputing] = useState(false)
  // Increments on every delivered result. Consumers use it to tell "a build is
  // running but frames are still arriving" (streaming) from "a build is running
  // and nothing has come back" (a genuine stall worth an overlay).
  const [resultCount, setResultCount] = useState(0)
  /**
   * The last rebuild failure, for the caller to say out loud.
   *
   * A failed rebuild leaves the *previous* picture on screen, which is exactly
   * what a successful-but-subtle one looks like — so without this the two are
   * indistinguishable from the user's side. Carries a `seq` because the same
   * message twice running is two events, and the toast keys on it.
   */
  const [error, setError] = useState(null)
  const errorSeq = useRef(0)
  const fail = (msg) => setError({ msg, seq: ++errorSeq.current })

  const workerRef = useRef(null)
  const startTimeRef = useRef(0)
  const prevDimsRef = useRef({ w: 0, h: 0 })
  const genRef = useRef(0)
  // True between postMessage and the matching onmessage.
  const busyRef = useRef(false)
  // Which pixel buffer the live worker already holds, so we re-send the (large)
  // raster only when the loaded file actually changed or the worker was replaced.
  const workerPixelsRef = useRef(null)
  // Same idea for the vector sources — an OSM fetch is millions of coordinates
  // and must not be cloned into the worker on every slider tick.
  const workerVectorRef = useRef(null)
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

  // Everything about the vector layers that changes their geometry, as one
  // string. Cheap to compute (a few dozen short joins) and the only vector
  // dependency the rebuild effect has — see the note in its dependency list.
  // Sorted, so reordering the stack is not in it; draw order is resolved below.
  const vectorBuildKey = vectorBuildSignature(p.vectorLayers)

  // The stack, as one string, for the merge memo below. Ids only: what this has
  // to notice is a layer moving, and a layer moving changes nothing else.
  const vectorOrderKey = (p.vectorLayers ?? []).map((l) => l.id).join(',')

  const ensureWorker = () => {
    if (workerRef.current) return
    workerRef.current = new GeometryWorker()
    workerPixelsRef.current = null
    workerVectorRef.current = null
    workerRef.current.onmessage = (e) => {
      const elapsed = Math.round(performance.now() - startTimeRef.current)
      const { terrain, lineGeo, surfaceGeo, error, _gen } = e.data
      busyRef.current = false
      lastDurationRef.current = performance.now() - buildStartRef.current
      if (_gen === genRef.current) {
        if (error) {
          console.error('[GeometryWorker] Error:', error)
          fail(`Geometry rebuild failed: ${error}`)
        } else {
          startTransition(() => {
            setTerrain(terrain); setLineGeo(lineGeo); setSurfaceGeo(surfaceGeo)
            // Absent, not null, means the worker's vector cache was still valid
            // and it deliberately sent nothing — the arrays we already hold are
            // the only copy, since they were transferred out of the worker.
            if ('vectorGeo' in e.data) setVectorGeo(e.data.vectorGeo)
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

    /**
     * A worker that throws *out* never reaches onmessage.
     *
     * That is the failure this hook had no answer for: `busyRef` stayed true
     * for ever, so the "Computing geometry…" overlay latched on and the only
     * thing that could clear it was an unrelated parameter change happening to
     * trip the cancel budget. The worker is dropped rather than reused — its
     * cached raster and vector sources are in an unknown state after an
     * uncaught throw, and `ensureWorker` re-sends both on the next build.
     */
    const die = (msg) => {
      busyRef.current = false
      pendingRef.current = null
      setIsComputing(false)
      workerRef.current?.terminate()
      workerRef.current = null
      workerPixelsRef.current = null
      workerVectorRef.current = null
      fail(msg)
    }
    workerRef.current.onerror = (ev) => {
      console.error('[GeometryWorker] Uncaught:', ev.message || ev)
      die(`Geometry rebuild failed: ${ev.message || 'the worker stopped.'}`)
    }
    // A result that cannot be structured-cloned fails here, not in onerror.
    workerRef.current.onmessageerror = () => {
      console.error('[GeometryWorker] Result could not be deserialised.')
      die('Geometry rebuild failed: the result could not be read.')
    }
  }

  const send = (req) => {
    ensureWorker()
    // Decided at send time, not request time: a queued request may be sent to a
    // different worker than the one that was live when it was created.
    const needsPixels = workerPixelsRef.current !== req.pixels
    workerPixelsRef.current = req.pixels
    const needsVectors = workerVectorRef.current !== req.vectors
    workerVectorRef.current = req.vectors
    startTimeRef.current = performance.now()
    buildStartRef.current = startTimeRef.current
    busyRef.current = true
    workerRef.current.postMessage({
      ...(needsPixels
        ? { heightmapPixels: req.pixels, nodataMask: req.mask, heightmapWidth: req.w, heightmapHeight: req.h }
        : null),
      ...(needsVectors ? { vectorData: req.vectors } : null),
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
      workerVectorRef.current = null
      pendingRef.current = null
      busyRef.current = false
      setTerrain(null); setLineGeo(null); setVectorGeo(null); setSurfaceGeo(null); setIsComputing(false)
      return
    }

    // Guard against the race where heightmap pixels arrive before App.jsx has
    // committed the auto-resolution state update: a resolution chosen for a
    // 1k raster would build an 8k one as a 64-megacell grid and hang.
    //
    // Keyed on the *dimensions*, not on the pixel buffer's identity. A buffer
    // that changes at unchanged dimensions — erosion writing back, a Soundscape
    // streaming, an Edit Mode clip being cleared — is not a new picture, and the
    // resolution already on screen is by definition safe for its size. Clamping
    // those left the resolution stuck at the guard's value, because nothing
    // afterwards changes p.resolution to trigger the corrected rebuild.
    //
    // The threshold matches autoResolution()'s 1024-cell budget in App.jsx. When
    // it was stricter (/1000), a 1024² raster clamped to 2 while App asked for
    // 1, and the two never agreed.
    const dimsChanged = prevDimsRef.current.w !== heightmapWidth || prevDimsRef.current.h !== heightmapHeight
    prevDimsRef.current = { w: heightmapWidth, h: heightmapHeight }
    const safeResolution = dimsChanged
      ? Math.max(p.resolution, Math.ceil(Math.max(heightmapWidth, heightmapHeight) / 1024))
      : p.resolution

    const req = {
      p: safeResolution !== p.resolution ? { ...p, resolution: safeResolution } : p,
      pixels: heightmapPixels, mask: nodataMask,
      w: heightmapWidth, h: heightmapHeight,
      vectors: vectorSources,
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
    // This list IS the rebuild contract: a worker rebuild is expensive, so it names
    // every param that changes the geometry and nothing else. Depending on `p`
    // wholesale would rebuild the terrain on every colour pick and slider tick.
    // `send` is held in sendRef and is stable by construction.
    //
    // Audited against the worker's actual reads: the only params it touches that are
    // absent here are the weight/opacity/dash families (resolved render-side by
    // layerStyle — see the NOTE below) and the fill switches, which reach this effect
    // through the precomputed p.needsSurfaceShading. No knob is silently inert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Labels move the contour geometry itself — the line is broken where a
    // number goes — so every one of these is a rebuild, not a re-render.
    p.labelContours, p.labelSizeContours, p.labelSpacingContours, p.labelMajorOnlyContours,
    p.labelPadContours,
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
    p.enabledIso, p.levelsIso, p.sunAzimuthIso, p.gammaIso, p.smoothingIso, p.radiusIso,
    p.colorIso,
    p.hypsoIso, p.hypsoModeIso, p.hypsoBandedIso, p.hypsoIntervalIso,
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

    // Same shape of trade: occlusion curtains are geometry, and building them
    // for a scene that will not draw them costs ~18 MB and a per-segment loop on
    // every rebuild. One rebuild when the switch moves is much cheaper.
    p.depthOcclusion,

    // NOTE: the fill params (showFill, fillColor, fillBanded, fillHypso*) are
    // render-side only — fill styling is pure GPU uniforms in SurfaceMesh.
    // They are deliberately excluded so toggling/dragging them never spawns a
    // worker rebuild. gradientStops stays: it is baked into line vertex colors.
    p.gradientStops,

    // Vector layers. `vectorBuildKey` is a string rather than p.vectorLayers
    // itself, and that is the whole point: the layer array is replaced on every
    // colour-picker tick, so depending on its identity would rebuild all
    // fourteen draw modes to recolour one road. The key covers only what moves
    // the geometry — see layerBuildKey in utils/vectorLayers.js.
    vectorSources, vectorBuildKey, p.geoTiffBbox, p.geoTiffCRS,
  ])

  useEffect(() => () => workerRef.current?.terminate(), [])

  // One list for the renderer and the SVG exporter: vector layers are lineGeo
  // entries in every respect, they just arrive on their own channel so a mode
  // rebuild does not have to re-drape them.
  //
  // This is also the one place a stack becomes paint order. `p.vectorLayers` is
  // top-first (see utils/vectorLayers.js); everything downstream — renderOrder in
  // HeightmapLines, document order in the SVG export — is last-wins, so the stack
  // is reversed here and nowhere else. Sorting rather than trusting the worker's
  // order is what lets the reorder skip the rebuild entirely: on a cache hit the
  // arrays we already hold arrive in whatever order they were first built in.
  const merged = useMemo(() => {
    if (!vectorGeo?.length) return lineGeo
    const rank = new Map((p.vectorLayers ?? []).map((l, i) => [l.id, i]))
    // '#icons' entries stand in for their layer and rank with it. A layer that
    // has just been removed can still be in `vectorGeo` for a render — removal is
    // two state updates — and ranks below the stack rather than on top of it.
    const orphan = rank.size
    const at = (g) => rank.get(g.id.split('#')[0]) ?? orphan
    const stacked = [...vectorGeo].sort((a, b) => at(b) - at(a))
    return [...(lineGeo ?? []), ...stacked]
    // `vectorOrderKey` stands in for p.vectorLayers, which is a new array on
    // every colour-picker tick — re-sorting the whole stack for a recolour would
    // hand HeightmapLines a new array and remount every layer in the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineGeo, vectorGeo, vectorOrderKey])

  return { terrain, lineGeo: merged, surfaceGeo, isComputing, resultCount, error }
}
