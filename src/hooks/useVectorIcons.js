/**
 * Point features drawn as icons instead of dots.
 *
 * A point layer arrives from the worker as one degenerate segment per feature —
 * a dot. When the layer has an icon, this **replaces** that entry with one built
 * from the icon's polylines, so turning an icon on removes the dots from the
 * viewport and from every exporter in a single step rather than drawing both.
 *
 * ── Why it is built here and not in the worker ───────────────────────────────
 * Flattening an SVG needs `getPointAtLength`, which only answers inside a
 * rendered document — so the geometry cannot come from the worker. That turns
 * out to be the right place for it anyway: size, lift and orientation become
 * render-side like colour and weight, so dragging them is a frame rather than a
 * rebuild, and the *Face camera* mode can follow the camera at all.
 *
 * The anchors are free. They are the midpoints of the dot layer's own segments,
 * already projected, already draped, already clipped to the raster — there is no
 * second coordinate path here, and nothing to drift out of step with the first.
 */

import { useMemo, useState, useCallback } from 'react'
import { ShapeUtils, Vector2 } from 'three'
import { getIconGeometry } from '../utils/iconCatalogue'

// Segments one layer's icons may add. A median icon is ~30 segments, so this is
// two thousand of them; past it the layer keeps its dots rather than drawing a
// fraction of its icons and looking like missing data.
const MAX_ICON_SEGMENTS = 60_000

const DEG = Math.PI / 180

// ── Filling a glyph ───────────────────────────────────────────────────────────

/**
 * Is `(x, y)` inside this ring? Ray casting, for working out what nests in what.
 */
function inRing(x, y, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const yi = pts[i + 1], yj = pts[j + 1]
    if ((yi > y) !== (yj > y) &&
        x < (pts[j] - pts[i]) * (y - yi) / (yj - yi) + pts[i]) inside = !inside
  }
  return inside
}

/** Twice the signed area of a ring — sign is winding, magnitude sorts nesting. */
function ring2A(pts) {
  let a = 0
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    a += pts[j] * pts[i + 1] - pts[i] * pts[j + 1]
  }
  return a
}

/**
 * An icon's closed rings, sorted into filled shapes with their holes cut out.
 *
 * Maki draws its icons as filled silhouettes, so what the flattener hands back
 * is a set of *fill boundaries*: the skull's outline, and separately its eye
 * sockets and its teeth. Triangulating those blindly fills the sockets in, and
 * a solid oval is not a skull. The nesting has to be worked out first.
 *
 * Even-odd, like the area fills: a ring inside an odd number of other rings is
 * a hole, and it belongs to the smallest ring containing it — which is what
 * makes a window inside a tower inside a castle come out right rather than
 * being cut from the castle. Winding is deliberately not consulted; it says
 * what an SVG's `fill-rule` means, and the sets that get this wrong are exactly
 * the ones where reading it would mislead.
 *
 * The triangulation itself is three's `ShapeUtils`, which is earcut with hole
 * bridging. It ships with three and is far better tested than the ear clipper
 * this replaced, which had no hole support at all.
 */
function iconShapes(geo) {
  // Rings of fewer than three corners cannot be filled and cannot contain
  // anything; dropping them early keeps the nesting arithmetic honest.
  const rings = geo.polylines.filter((p) => p.length >= 8)
  if (!rings.length) return []

  const area = rings.map((p) => Math.abs(ring2A(p)))
  const parent = rings.map(() => -1)
  const depth = rings.map(() => 0)

  for (let i = 0; i < rings.length; i++) {
    const x = rings[i][0], y = rings[i][1]
    for (let j = 0; j < rings.length; j++) {
      // Strictly larger, or two identical rings would each swallow the other.
      if (i === j || area[j] <= area[i] || !inRing(x, y, rings[j])) continue
      depth[i]++
      if (parent[i] < 0 || area[j] < area[parent[i]]) parent[i] = j
    }
  }

  const out = []
  for (let i = 0; i < rings.length; i++) {
    if (depth[i] % 2) continue                       // a hole, cut below
    const holes = []
    for (let j = 0; j < rings.length; j++) {
      if (depth[j] % 2 && parent[j] === i) holes.push(toVecs(rings[j]))
    }
    const contour = toVecs(rings[i])
    // `triangulateShape` drops a duplicated end point from each ring it is
    // given, so the vertex list has to be read back *after* it has run.
    const faces = ShapeUtils.triangulateShape(contour, holes)
    if (!faces.length) continue
    const verts = [contour, ...holes].flat()
    const pts = new Float32Array(verts.length * 2)
    for (let v = 0; v < verts.length; v++) { pts[v * 2] = verts[v].x; pts[v * 2 + 1] = verts[v].y }
    const tris = new Uint32Array(faces.length * 3)
    for (let f = 0; f < faces.length; f++) {
      tris[f * 3] = faces[f][0]; tris[f * 3 + 1] = faces[f][1]; tris[f * 3 + 2] = faces[f][2]
    }
    out.push({ pts, tris })
  }
  return out
}

/**
 * A flat `[x, y, …]` ring as the `Vector2` list `ShapeUtils` wants.
 *
 * Real `Vector2`s rather than `{ x, y }` literals: `triangulateShape` drops a
 * duplicated end point by calling `.equals()` on the last one, so a plain
 * object throws on the first icon.
 */
function toVecs(p) {
  const out = []
  for (let i = 0; i < p.length; i += 2) out.push(new Vector2(p[i], p[i + 1]))
  return out
}

// Nesting and triangulation depend only on the icon, so they are computed once
// and hung off the cached geometry rather than redone on every camera nudge.
const triCache = new WeakMap()

/** Closed shapes of an icon, triangulated with their holes cut: `[{ pts, tris }]`. */
export function iconTriangles(geo) {
  let hit = triCache.get(geo)
  if (!hit) { hit = iconShapes(geo); triCache.set(geo, hit) }
  return hit
}

/**
 * The icon plane's basis, from an azimuth θ and an elevation φ.
 *
 * These are the camera's own angles: `Scene` places the camera with
 * `setFromSphericalCoords(dist, phi, theta)` from `tilt` and `rotation`, so
 * feeding those two straight in makes the plane perpendicular to the view and
 * the icon undistorted. At φ = 90° (camera on the horizon) the icon stands
 * upright facing the camera; at φ = 0° (camera overhead) it lies flat on the
 * ground with its top pointing away — which is how a symbol on a map should
 * read from above.
 *
 * Exported because the labels hook has to agree with it exactly: a name lying
 * flat beside an upright summit triangle reads as a bug, and two copies of this
 * arithmetic is how that happens.
 */
export function iconBasis(tiltDeg, spinDeg) {
  const phi = tiltDeg * DEG, theta = spinDeg * DEG
  const cp = Math.cos(phi), sp = Math.sin(phi)
  const ct = Math.cos(theta), st = Math.sin(theta)
  return {
    rx: ct,        ry: 0,  rz: -st,       // right
    ux: -cp * st,  uy: sp, uz: -cp * ct,  // up
  }
}

/** How many segments one icon draws, plus its leader line. */
function iconCost(geo, lift) {
  return geo.segments + (lift > 0 ? 1 : 0)
}

/**
 * One point layer's dots → its icons, as a `lineGeo`-shaped record.
 *
 * `featureOfSegment` is rebuilt as it goes: every segment of an icon carries the
 * feature index its dot had, so the picker still resolves a click to the right
 * summit, the highlight lights the whole glyph, and the tooltip still names it.
 */
function buildIconLayer(dots, layer, geo) {
  const src = dots.positions
  const srcFeature = dots.featureOfSegment
  const n = src.length / 6
  if (!n) return null

  const size = layer.iconSize ?? 18
  const lift = layer.iconLift ?? 0
  const { rx, ry, rz, ux, uy, uz } = iconBasis(
    layer.iconFaceCamera ? layer.viewTilt : (layer.iconTilt ?? 50),
    layer.iconFaceCamera ? layer.viewSpin : (layer.iconSpin ?? 0),
  )

  const per = iconCost(geo, lift)
  const total = n * per
  if (total > MAX_ICON_SEGMENTS) return null

  const positions = new Float32Array(total * 6)
  const featureOfSegment = new Int32Array(total)
  let w = 0, s = 0

  // Filled glyphs. Not exported to SVG — that is a line-art format and these are
  // triangles — but they are in the viewport and in every PNG and video capture.
  const shapes = layer.iconFill ? iconTriangles(geo) : null
  const triCount = shapes ? shapes.reduce((a, sh) => a + sh.tris.length / 3, 0) : 0
  const fillPos = triCount ? new Float32Array(n * triCount * 9) : null
  const fillIdx = triCount ? new Uint32Array(n * triCount * 3) : null
  let fw = 0, fi = 0

  for (let i = 0; i < n; i++) {
    // The dot is a segment shorter than its own width, so its midpoint is the
    // feature's position.
    const ax = (src[i * 6] + src[i * 6 + 3]) * 0.5
    const ay = src[i * 6 + 1]
    const az = src[i * 6 + 2]
    const cy = ay + lift
    const feature = srcFeature ? srcFeature[i] : i

    if (lift > 0) {
      positions[w] = ax;     positions[w + 1] = ay; positions[w + 2] = az
      positions[w + 3] = ax; positions[w + 4] = cy; positions[w + 5] = az
      w += 6
      featureOfSegment[s++] = feature
    }

    if (shapes) {
      for (const sh of shapes) {
        for (let t = 0; t < sh.tris.length; t++) {
          const v = sh.tris[t]
          const u = sh.pts[v * 2] * size, q = sh.pts[v * 2 + 1] * size
          fillPos[fw]     = ax + u * rx + q * ux
          fillPos[fw + 1] = cy + u * ry + q * uy
          fillPos[fw + 2] = az + u * rz + q * uz
          fillIdx[fi] = fi
          fw += 3; fi++
        }
      }
    }

    for (const poly of geo.polylines) {
      for (let k = 0; k + 3 < poly.length; k += 2) {
        const u0 = poly[k] * size,     v0 = poly[k + 1] * size
        const u1 = poly[k + 2] * size, v1 = poly[k + 3] * size
        positions[w]     = ax + u0 * rx + v0 * ux
        positions[w + 1] = cy + u0 * ry + v0 * uy
        positions[w + 2] = az + u0 * rz + v0 * uz
        positions[w + 3] = ax + u1 * rx + v1 * ux
        positions[w + 4] = cy + u1 * ry + v1 * uy
        positions[w + 5] = az + u1 * rz + v1 * uz
        w += 6
        featureOfSegment[s++] = feature
      }
    }
  }

  return {
    // Suffixed rather than reused: two entries sharing an id would collide as
    // React keys and produce two identically named pen layers in the SVG.
    // `layerStyle` splits on the '#' so the style still comes from the layer.
    id: `${layer.id}#icons`,
    positions: w === positions.length ? positions : positions.subarray(0, w),
    colors: null,
    curtains: null,
    lids: null,
    // False on purpose: this is real line geometry, and it is what makes the SVG
    // exporter write strokes rather than a circle per feature.
    isPoints: false,
    // …but the picker should still treat it as the deliberate mark a dot was.
    isIcon: true,
    featureOfSegment: s === featureOfSegment.length ? featureOfSegment : featureOfSegment.subarray(0, s),
    fills: fw ? { positions: fillPos.subarray(0, fw), indices: fillIdx.subarray(0, fi) } : null,
  }
}

/**
 * Substitutes icon geometry for the dots of every point layer that asked for one.
 *
 * Returns `{ lineGeo, overflowed }` — `overflowed` naming the layers whose icons
 * would have cost more than the budget and which are therefore still drawing
 * dots, so the panel can say so instead of leaving it a mystery.
 */
export function useVectorIcons(lineGeo, vectorLayers, viewTilt, viewSpin) {
  // Icon geometry arrives asynchronously the first time an icon is chosen. This
  // is how the hook hears about it: the fetch lands, the tick moves, the memo
  // re-runs and the dots become icons.
  const [tick, setTick] = useState(0)
  const onLoaded = useCallback(() => setTick((t) => t + 1), [])

  // A string rather than the array, for the usual reason: `vectorLayers` is
  // replaced on every colour-picker tick, and rebuilding icon geometry for a
  // change that cannot move a vertex is waste.
  const anyFaceCamera = (vectorLayers ?? []).some((l) => l.icon && l.iconFaceCamera)
  const key = (vectorLayers ?? [])
    .filter((l) => l.icon)
    // A custom icon is named by its file, and two uploads can easily share one
    // — `icon.svg`, `Untitled.svg`. The segment count comes along to tell them
    // apart, so replacing a glyph with a different glyph of the same name
    // redraws instead of keeping the old one until some other field is touched.
    .map((l) => `${l.id}|${l.icon}|${l.iconSize}|${l.iconLift}|${l.iconFaceCamera ? 1 : 0}|` +
                `${l.iconTilt}|${l.iconSpin}|${l.iconFill ? 1 : 0}|` +
                `${l.iconCustom?.name ?? ''}#${l.iconCustom?.geo?.segments ?? 0}`)
    .join(';')
  /*
   * With `iconFaceCamera` on, this changes at the orbit sync rate — roughly
   * seven times a second during a drag — and each change re-emits the layer's
   * geometry on the main thread. That looks like the one piece of per-gesture
   * geometry work left outside the worker, so it was measured rather than
   * assumed: at MAX_ICON_SEGMENTS, the ceiling above which the hook gives up and
   * draws dots instead, one rebuild writes 1.4 MB of typed array in 0.26 ms —
   * 0.2% of the 150 ms sync interval, and bounded by the budget rather than by
   * how much data was fetched.
   *
   * So there is nothing here to move off the main thread. The empty string when
   * no layer faces the camera is the part that matters: it keeps the memo from
   * re-running at all for the ordinary case.
   */
  const camKey = anyFaceCamera ? `${viewTilt}|${viewSpin}` : ''

  return useMemo(() => {
    const overflowed = new Set()
    if (!key || !Array.isArray(lineGeo)) return { lineGeo, overflowed }

    const byId = new Map((vectorLayers ?? []).map((l) => [l.id, l]))
    let changed = false

    const out = lineGeo.map((entry) => {
      const layer = byId.get(entry.id)
      if (!layer?.icon || !entry.isPoints) return entry

      const geo = layer.icon === 'custom'
        ? layer.iconCustom?.geo
        : getIconGeometry(layer.icon, onLoaded)
      // Still loading, or the file was unreadable: the dots stand in, which is
      // a stand-in rather than a hole.
      if (!geo?.polylines?.length) return entry

      const built = buildIconLayer(entry, { ...layer, viewTilt, viewSpin }, geo)
      if (!built) { overflowed.add(layer.id); return entry }
      changed = true
      return built
    })

    return { lineGeo: changed ? out : lineGeo, overflowed }
    // `key` and `camKey` stand in for vectorLayers/tilt/rotation — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineGeo, key, camKey, tick, onLoaded])
}
