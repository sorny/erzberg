import { create } from 'zustand'
import { applyEdit, buildEditMask, cropBbox } from '../utils/heightmapEdit'
import { cropMaskData } from '../utils/maskLayers'

/**
 * Global store — only holds data that cannot live in plain React state:
 *  - loaded heightmap pixel data
 *  - GeoTIFF NoData mask
 *  - filename display
 *  - overlay texture image
 *  - vector sources (OSM / GeoJSON / GPX coordinates)
 *
 * All tweakable visual / terrain params live in React state in App.jsx. That
 * includes the vector *layers* — their colour and weight are params like any
 * other, and only the coordinates they point at live here.
 *
 * ── Source vs. derived ───────────────────────────────────────────────────────
 * The raster is held twice: `src*` is exactly what was loaded, and
 * `heightmapPixels`/`nodataMask`/`heightmapWidth`/`heightmapHeight` are what the
 * rest of the app consumes — the source with the current Edit Mode clip applied.
 * With `edit === null` the two are the same object, so nothing costs anything
 * until a selection exists.
 *
 * Everything downstream (useTerrainGeometry, the geometry worker, exports,
 * Sidebar, the elevation profile) reads only the derived names and needs to know
 * nothing about clipping. Keeping the source is what lets Edit Mode be
 * re-entered on the full raster and cleared, and it is also why a Soundscape
 * streaming a new raster 30×/s keeps its clip: each pushed frame is a new
 * *source*, re-clipped on the way through.
 */

// The rasterized selection depends only on the edit's shape and the raster's
// dimensions, so it survives the per-frame pixel churn of a streaming
// Soundscape. Module-level rather than in the store: it is a memo, not state.
let maskCache = { edit: null, srcMask: null, w: 0, h: 0, value: null }

function editMaskFor(edit, srcMask, w, h) {
  if (!edit) return null
  const c = maskCache
  if (c.edit === edit && c.srcMask === srcMask && c.w === w && c.h === h) return c.value
  const value = buildEditMask(edit, srcMask, w, h)
  maskCache = { edit, srcMask, w, h, value }
  return value
}

/** The clipped raster + geo extent the app renders, given the source and edit. */
function derive(s) {
  if (!s.srcPixels || !s.edit) {
    return {
      heightmapPixels: s.srcPixels,
      nodataMask:      s.srcMask,
      heightmapWidth:  s.srcWidth,
      heightmapHeight: s.srcHeight,
      geoTiffBbox:     s.geoTiffBboxSrc ?? null,
      masks:           s.srcMasks,
    }
  }
  const pre = editMaskFor(s.edit, s.srcMask, s.srcWidth, s.srcHeight)
  const out = applyEdit(
    { pixels: s.srcPixels, mask: s.srcMask, width: s.srcWidth, height: s.srcHeight },
    s.edit, pre,
  )
  return {
    heightmapPixels: out.pixels,
    nodataMask:      out.mask,
    heightmapWidth:  out.width,
    heightmapHeight: out.height,
    // Cropping moves the raster's corners, and geoToPixel() reads the bbox as
    // the extent of the *whole* raster — leaving it uncropped would silently
    // project every GPX point against the wrong extent.
    geoTiffBbox:     pre ? cropBbox(s.geoTiffBboxSrc, pre, s.srcWidth, s.srcHeight) : (s.geoTiffBboxSrc ?? null),
    // Painted masks are authored against the *source* raster, so they are
    // cropped here alongside the pixels rather than being re-authored whenever
    // the clip moves. Same rectangle, same arithmetic.
    masks: pre
      ? s.srcMasks.map((m) => (m.width === s.srcWidth && m.height === s.srcHeight
          ? { ...m, data: cropMaskData(m.data, s.srcWidth, pre), width: pre.w, height: pre.h }
          : m))
      : s.srcMasks,
  }
}

export const useStore = create((set) => ({
  // ── Source raster, exactly as loaded ────────────────────────────────────────
  srcPixels: null,
  srcMask: null,
  srcWidth: 0,
  srcHeight: 0,

  // Edit Mode clip, in source pixel coordinates. See utils/heightmapEdit.js.
  // { rect:{x,y,w,h}, shape:{type,points}|null, feather:number } | null
  edit: null,

  // ── Derived raster — what every consumer reads ──────────────────────────────
  // Raw pixel brightness extracted from the loaded image (Float32Array, values 0–1)
  heightmapPixels: null,
  // Mask for GeoTIFF NoData pixels (Uint8Array, 1=valid, 0=nodata)
  nodataMask: null,
  heightmapWidth: 0,
  heightmapHeight: 0,
  heightmapFilename: '',

  // Overlay texture
  textureImage: null, // Image data (base64 or blob URL)

  // Vector sources — packed WGS84 geometry from OSM, GeoJSON and GPX.
  // See utils/vectorLayers.js for the shape. Held here rather than in React
  // state for the same reason the raster is: an OSM fetch over an alpine tile is
  // millions of coordinates, and it is posted to the geometry worker by
  // identity. The matching *layer* records (colour, weight, visibility) live in
  // App.jsx, joined to these by `sourceId`.
  vectorSources: [],

  // Land cover, in the plate's *own* grid and extent, exactly as the file
  // stated them. Laying it onto the raster is a derivation App re-runs whenever
  // the raster moves — see `coverGrid` there — because a crop changes both the
  // dimensions and the extent, and a plate flattened onto the old ones at load
  // time would go quietly inert.
  // { labels, plate, width, height, bbox, crs, classes, attribution, … } | null
  cover: null,

  // Masks drawn by hand or loaded from an image, on the *source* raster's grid.
  // `masks` below is the same list cropped to whatever Edit Mode is showing —
  // the same source-versus-derived split the raster itself has.
  srcMasks: [],
  masks: [],

  // Satellite imagery for the current extent, resampled onto the raster's grid.
  // { rgba, width, height, url, sceneId, date, cloud, credit } | null
  imagery: null,

  // Which feature is under the cursor, and which one was last clicked or picked
  // in the panel. Here rather than in App's `p` bus for a specific reason: `p`
  // is rebuilt every render and is what gets postMessage'd to the geometry
  // worker, so a pointer-move writing into it would re-render the whole sidebar
  // and ripple into geometry. Read through selectors, a hover re-renders the two
  // small components that care — the highlight and the tooltip — and nothing
  // else. `x`/`y` are client pixels, for placing the tooltip.
  vectorHover: null,     // { layerId, feature, x, y } | null
  vectorSelected: null,  // { layerId, feature } | null

  // Real-world elevation metadata — only populated when a GeoTIFF is loaded
  geoTiffElevMin: null,   // metres (or native unit)
  geoTiffElevMax: null,
  geoTiffBboxSrc: null,   // the file's own extent, before any clip
  geoTiffBbox: null,      // [minX, minY, maxX, maxY] in native CRS, clipped
  // 'EPSG:<code>' | 'EPSG:projected-unknown' | 'EPSG:geographic-unknown' | 'EPSG:none'.
  // classifyCRS() in utils/geoCoords.js is the only thing that interprets these.
  geoTiffCRS: null,
  geoTiffCRSName: null,   // the CRS name the file states about itself, if any

  /**
   * Replaces the source raster.
   *
   * The clip is dropped, because a rectangle in the old raster's coordinates
   * means nothing in a new one — except for `opts.keepEdit` at unchanged
   * dimensions, which is the Soundscape streaming case: same picture, next
   * frame. Freezing a whole track changes the dimensions and so drops the clip
   * through the same rule, without needing to know anything about soundscapes.
   */
  setHeightmap: (pixels, mask, width, height, filename, opts) =>
    set((s) => {
      const keep = !!opts?.keepEdit && !!s.edit && width === s.srcWidth && height === s.srcHeight
      const next = {
        srcPixels: pixels, srcMask: mask, srcWidth: width, srcHeight: height,
        heightmapFilename: filename,
        edit: keep ? s.edit : null,
        // A cover plate describes one particular piece of ground, and this
        // setter is only ever called with a *new* raster — a load, or a
        // Soundscape's next frame. Neither is the ground the plate described,
        // so it goes, for the same reason the clip goes. An Edit Mode crop does
        // not come through here and keeps its plate.
        cover: null,
        // Masks and imagery go with it, and for the same reason: both are
        // about one particular piece of ground.
        srcMasks: [],
        imagery: null,
      }
      return { ...next, ...derive({ ...s, ...next }) }
    }),

  setEdit: (edit) =>
    set((s) => {
      const next = { edit: edit ?? null }
      return { ...next, ...derive({ ...s, ...next }) }
    }),

  clearEdit: () =>
    set((s) => {
      const next = { edit: null }
      return { ...next, ...derive({ ...s, ...next }) }
    }),

  /**
   * Writes back pixels computed *from the derived raster* — hydraulic erosion is
   * the only caller.
   *
   * With a clip active those pixels are the size of the clip, so they are
   * scattered back into the source at the clip's position: erosion then applies
   * to what you can see, and the clip stays live and editable afterwards. Cells
   * inside the feather ramp are skipped so the ramp is not baked into the source
   * and re-ramped on every run.
   */
  setPixels: (px) =>
    set((s) => {
      if (!s.edit || !s.srcPixels) {
        const next = { srcPixels: px }
        return { ...next, ...derive({ ...s, ...next }) }
      }
      const pre = editMaskFor(s.edit, s.srcMask, s.srcWidth, s.srcHeight)
      if (!pre) {
        const next = { srcPixels: px }
        return { ...next, ...derive({ ...s, ...next }) }
      }
      const { x, y, w, h, mask, weight } = pre
      const srcPixels = new Float32Array(s.srcPixels)
      for (let row = 0; row < h; row++) {
        const dstOff = row * w
        const srcOff = (y + row) * s.srcWidth + x
        for (let c = 0; c < w; c++) {
          const di = dstOff + c
          if (mask && !mask[di]) continue
          if (weight && weight[di] < 1) continue
          srcPixels[srcOff + c] = px[di]
        }
      }
      const next = { srcPixels }
      return { ...next, ...derive({ ...s, ...next }) }
    }),

  setTextureImage: (img) => set({ textureImage: img }),

  addVectorSource: (source) =>
    set((s) => ({ vectorSources: [...s.vectorSources, source] })),

  removeVectorSource: (id) =>
    set((s) => ({
      vectorSources: s.vectorSources.filter((v) => v.id !== id),
      // A highlight pointing at coordinates that no longer exist would draw
      // stale segments until the next pointer move.
      vectorHover: null, vectorSelected: null,
    })),

  clearVectorSources: () => set({ vectorSources: [], vectorHover: null, vectorSelected: null }),

  /**
   * The whole list at once, for putting one back.
   *
   * Reset all clears the vectors and offers an Undo, and an undo has to restore
   * the *coordinates* rather than only the style records — those live here.
   * Replaying `addVectorSource` would work and is worse: it is one set() per
   * source, and it silently reverses nothing if the list came back empty.
   */
  setVectorSources: (sources) =>
    set({ vectorSources: sources ?? [], vectorHover: null, vectorSelected: null }),

  setCover: (cover) => set({ cover: cover ?? null }),

  /**
   * Replaces the whole mask list.
   *
   * One setter rather than add/remove/patch, because every caller already holds
   * the list it wants: the Studio commits a painted plane, the panel reorders
   * or deletes, and a reset clears. Routing all of them through one door is what
   * keeps `derive` the only place that knows about cropping.
   */
  setMasks: (masks) =>
    set((s) => {
      const next = { srcMasks: masks ?? [] }
      return { ...next, ...derive({ ...s, ...next }) }
    }),

  setImagery: (imagery) => set({ imagery: imagery ?? null }),

  /**
   * How much ground one screen pixel covers, and where north points on screen.
   *
   * Here rather than in App state for the reason the file's opening note gives:
   * it cannot live in plain React state. It is measured off the *camera*, which
   * OrbitControls drives directly during a drag precisely so that orbiting does
   * not re-render the app sixty times a second — so the only place to read it is
   * inside the render loop, and the only thing that may re-render on it is the
   * one small overlay that draws the marks.
   *
   * Guarded rather than written blind. A drag produces a new measurement every
   * frame and almost all of them are the same measurement; the epsilon is a
   * twentieth of a percent of the scale and a tenth of a degree of bearing,
   * which is finer than either mark can express and coarse enough that a
   * stationary camera writes nothing at all.
   */
  mapScale: null,
  setMapScale: (next) =>
    set((s) => {
      const prev = s.mapScale
      if (prev === next) return {}
      if (prev && next
        && Math.abs(prev.metresPerPixel - next.metresPerPixel) < prev.metresPerPixel * 5e-4
        && Math.abs(prev.northAngle - next.northAngle) < 0.0017) return {}
      return { mapScale: next }
    }),

  setVectorHover: (h) => set({ vectorHover: h }),
  setVectorSelected: (v) => set({ vectorSelected: v }),

  setGeoTiffMeta: (elevMin, elevMax, bbox, crs, crsName) =>
    set((s) => {
      const next = { geoTiffElevMin: elevMin, geoTiffElevMax: elevMax, geoTiffBboxSrc: bbox ?? null,
                     geoTiffCRS: crs ?? null, geoTiffCRSName: crsName ?? null }
      return { ...next, ...derive({ ...s, ...next }) }
    }),

  clearGeoTiffMeta: () =>
    set({ geoTiffElevMin: null, geoTiffElevMax: null, geoTiffBboxSrc: null, geoTiffBbox: null,
          geoTiffCRS: null, geoTiffCRSName: null }),
}))
