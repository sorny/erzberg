/**
 * Web Worker — all heavy geometry computation runs here to keep the UI thread free.
 *
 * Pipeline per message:
 *   buildTerrain()        → terrain grid, slopes, elevation bounds
 *   buildLineGeometry()   → array of lineGeo layers (the 14 draw modes + mirroring)
 *   buildVectorGeometry() → OSM / GeoJSON / GPX layers, draped (cached, see below)
 *   buildSurfaceGeometry()→ triangulated surface mesh for fill / SVG depth buffer
 *
 * The source heightmap is CACHED here across messages. It is by far the largest
 * thing in the payload (an 8k GeoTIFF is a 256 MB Float32Array) and it does not
 * change when a style slider moves, so re-sending it per rebuild meant a full
 * structured-clone copy on every drag tick. The main thread now sends the pixels
 * once per loaded file; subsequent builds carry only the params object.
 *
 * Vector sources are cached the same way and for a sharper version of the same
 * reason: an OSM fetch over an alpine tile is a few million coordinates, and it
 * used to ride inside `p` (as `gpxPoints`) and be structured-cloned on every
 * single rebuild.
 *
 * Their *output* is cached too, keyed on the params that actually affect
 * draping. Dragging a contour-interval slider does not move a road, so it must
 * not cost a re-drape of every road in the valley. On a cache hit the reply
 * simply omits `vectorGeo` and the main thread keeps the arrays it already has —
 * which it must, because those buffers were transferred away on the first build
 * and this worker no longer owns them.
 *
 * All Float32Array / Uint32Array buffers are transferred (zero-copy) back to the
 * main thread via the Transferables list. After transfer the originals are detached.
 */
import { boxBlur, buildTerrain, maskHasHoles } from './terrain'
import { buildLineGeometry, buildSurfaceGeometry } from './geometryBuilders'
import { buildVectorGeometry } from './vectorGeometry'
import { layerBuildKey } from './vectorLayers'

// Cached source raster — replaced only by a message carrying `heightmapPixels`.
let src = null

// Cached vector sources — replaced only by a message carrying `vectorData`.
let vectorSrc = null

// Last vector build, and the signature it was built from. `geo` is not retained
// after posting (its buffers are transferred), so a hit means "the main thread's
// copy is still correct", not "here it is again".
let vectorCache = { sig: null }

// Bumped on every new raster and every new vector payload, so the signature can
// name "the data these were built from" without hashing megabytes.
let dataGen = 0

/**
 * Everything a vector layer's *geometry* depends on.
 *
 * Colour, weight, opacity and dash are deliberately absent: `layerStyle`
 * resolves those at render time, so dragging them is free. `layerBuildKey`
 * carries the per-layer half (visibility, fill); the rest is the terrain the
 * features are draped on, which is exactly the param set `buildTerrain` reads.
 */
function vectorSignature(p) {
  const layers = p.vectorLayers ?? []
  if (!layers.length || !vectorSrc?.length) return 'none'
  return [
    dataGen,
    p.resolution, p.blurRadius, p.elevScale, p.elevMinCut, p.elevMaxCut,
    p.blackPoint, p.whitePoint, p.jitterAmt, p.gridOffsetX, p.gridOffsetY,
    p.geoTiffCRS, (p.geoTiffBbox ?? []).join(','),
    layers.map(layerBuildKey).join(';'),
  ].join('|')
}

// Cached blur of that raster. The blur is a function of the raster and the
// radius alone, but buildTerrain re-ran it on every message — so dragging an
// unrelated style slider re-blurred the full-resolution image each tick, which
// at 8k is the single most expensive thing in the pipeline. Keyed on identity of
// the pixels plus the radius; anything else invalidates it.
//
// It costs one extra full-size buffer held for as long as the raster is loaded,
// but only when blur is actually on: at radius 0 boxBlur returns its input, so
// the cache holds the same array `src` already does.
let blurCache = { pixels: null, radius: -1, result: null }

function blurredSource(p) {
  const radius = p.blurRadius ?? 0
  if (blurCache.pixels === src.heightmapPixels && blurCache.radius === radius) {
    return blurCache.result
  }
  // Blurring across a clipped edge would average real ground against the zeros
  // parked in the NoData cells and sag the terrain toward the floor all along
  // the cut, so a holed raster gets the mask-aware (normalized) blur.
  const result = boxBlur(src.heightmapPixels, src.heightmapWidth, src.heightmapHeight, radius,
                         src.hasNoData ? src.nodataMask : null)
  blurCache = { pixels: src.heightmapPixels, radius, result }
  return result
}

self.onmessage = (e) => {
  const { heightmapPixels, nodataMask, heightmapWidth, heightmapHeight, vectorData, p, _gen } = e.data

  // A message with pixels refreshes the cache; one without reuses it.
  // `hasNoData` is scanned once per raster, not per rebuild: the mask is always
  // present (the PNG loader builds one even for a fully opaque image), so the
  // question that matters is whether it excludes anything.
  if (heightmapPixels) {
    src = { heightmapPixels, nodataMask, heightmapWidth, heightmapHeight,
            hasNoData: maskHasHoles(nodataMask) }
    dataGen++
  }
  if (vectorData !== undefined) {
    vectorSrc = vectorData
    dataGen++
  }
  if (!src) {
    self.postMessage({ error: 'No heightmap loaded in worker.', _gen })
    return
  }

  try {
    const terrain = buildTerrain(
      src.heightmapPixels, src.nodataMask, src.heightmapWidth, src.heightmapHeight, p,
      blurredSource(p)
    )
    const lineGeo = buildLineGeometry(terrain, p)
    const surfaceGeo = buildSurfaceGeometry(terrain, p)

    // Rebuilt only when something it actually depends on moved — see the header.
    const sig = vectorSignature(p)
    const vectorGeo = sig === vectorCache.sig
      ? null
      : buildVectorGeometry(terrain, p, vectorSrc, src.heightmapWidth, src.heightmapHeight)
    vectorCache = { sig }

    // Collect all buffers for zero-copy Transferables. A Set guards against
    // pushing the same ArrayBuffer twice (postMessage throws on duplicates).
    const seen = new Set()
    const transferables = []
    const xfer = (arr) => {
      const buf = arr?.buffer
      if (buf && !seen.has(buf)) { seen.add(buf); transferables.push(buf) }
    }

    // 1. Line layers — including the curtain/lid meshes, which are the largest
    //    arrays in the payload and were previously structured-cloned every rebuild.
    for (const L of [...(Array.isArray(lineGeo) ? lineGeo : []), ...(vectorGeo ?? [])]) {
      xfer(L.positions)
      xfer(L.colors)
      xfer(L.curtains?.positions)
      xfer(L.curtains?.indices)
      xfer(L.lids?.positions)
      xfer(L.lids?.colors)
      xfer(L.lids?.indices)
      xfer(L.fills?.positions)
      xfer(L.fills?.indices)
      xfer(L.featureOfSegment)
    }

    // 2. Surface
    xfer(surfaceGeo.positions)
    xfer(surfaceGeo.brightnessBuf)
    xfer(surfaceGeo.indices)
    xfer(surfaceGeo.normals)
    xfer(surfaceGeo.uvs)

    // 3. Terrain grids (consumed on the main thread by particles / sampling).
    //    buildSurfaceGeometry/buildVectorGeometry above already finished reading them.
    xfer(terrain.grid)
    xfer(terrain.gridMask)
    xfer(terrain.gridSlopes)

    // `vectorGeo` omitted entirely on a cache hit — null would be
    // indistinguishable from "this raster has no vector layers", and the two
    // want opposite handling on the main thread.
    const msg = { terrain, lineGeo, surfaceGeo, _gen }
    if (vectorGeo) msg.vectorGeo = vectorGeo
    self.postMessage(msg, transferables)
  } catch (err) {
    self.postMessage({ error: err.message, _gen })
  }
}
