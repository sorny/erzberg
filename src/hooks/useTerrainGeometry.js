/**
 * Derives terrain grid and line geometry from the raw heightmap + visual params.
 */
import { useState, useEffect, useMemo, useRef, startTransition } from 'react'
import { useStore } from '../store/useStore'
import { vectorBuildSignature } from '../utils/vectorLayers'
import { geometryKey } from '../params'
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

  // Every geometry-affecting parameter, as one string — the rebuild effect's
  // whole dependency on `p`. Built from the registry in src/params.js, so it
  // covers a new draw mode's params the moment they exist in defaults.js.
  const rebuildKey = geometryKey(p)

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
    // The rebuild contract, derived rather than transcribed.
    //
    // `rebuildKey` is built in src/params.js from every geometry-affecting
    // parameter in defaults.js — see RENDER_SIDE there for the exception list and
    // why each entry is on it. What used to stand here was ~180 keys written out
    // by hand behind this same eslint-disable, which no tool could check against
    // the worker: it reads half of them through computed keys (`p[`hypso${id}`]`),
    // so a draw mode added without touching the list got a knob that moved and
    // changed nothing. The derived key was verified to reproduce that list
    // exactly — 172 params either way, no drift — so this is a change of
    // mechanism and not of behaviour.
    //
    // The four that cannot come from the key:
    //  • gradientStops is an array (see GEOMETRY_NON_SCALAR) and is depended on
    //    by identity, as it was before.
    //  • needsSurfaceShading is computed onto `p` by App, not a stored param.
    //  • geoTiffBbox / geoTiffCRS come from the store, not from defaults.
    // `send` is held in sendRef and is stable by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    heightmapPixels, nodataMask, heightmapWidth, heightmapHeight,
    rebuildKey,
    p.gradientStops, p.needsSurfaceShading, p.geoTiffBbox, p.geoTiffCRS,
    // Vector layers. `vectorBuildKey` is a string rather than p.vectorLayers
    // itself, and that is the whole point: the layer array is replaced on every
    // colour-picker tick, so depending on its identity would rebuild all fifteen
    // draw modes to recolour one road. See layerBuildKey in utils/vectorLayers.js.
    vectorSources, vectorBuildKey,
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
