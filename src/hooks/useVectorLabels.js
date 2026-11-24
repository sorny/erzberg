/**
 * Vector features lettered with their names, heights and route numbers.
 *
 * One of the lettering passes, all of which run on the main thread and share
 * `textGeometry`: this one letters what a feature *is*, `useContourLabels`
 * letters what a contour *is at*, and `useTextLayers` letters whatever you type.
 *
 * Labels are geometry, flattened into the same `positions` array a contour uses,
 * so they inherit the layer's ink, the ghost occlusion, the hidden-line removal
 * and every exporter, including the SVG a plotter draws. A feature with nothing
 * to say is not labelled: no name means no name line.
 *
 * ── Three kinds of feature ──────────────────────────────────────────────────
 * A point is lettered beside its dot, in the plane its icon stands in. An area
 * is lettered the same way at a point inside it. A line is lettered *along*
 * itself: each glyph is placed and turned on the ground at its own point of the
 * line, on the straightest stretch that is long enough, and the run is turned so
 * that it reads left to right in the view. A road's number can also stand in a
 * shield, a box at the middle of the road.
 *
 * ── Collisions ───────────────────────────────────────────────────────────────
 * Every label is planned first, with its outline in the view plane. Layers with
 * *Avoid overlaps* then give way: in stack order, top layer first, and inside a
 * layer the higher summit or the longer line first, a label is dropped when it
 * would overlap one already kept. Layers without the switch are kept whole and
 * still count as obstacles.
 */

import { useMemo, useState, useEffect, useRef } from 'react'
import { loadTextFont, fontStyleKey, singleLineKey, textPolylines, glyphRun } from '../utils/textGeometry'
import { iconBasis, iconTriangles } from './useVectorIcons'
import { sampleBilinear } from '../utils/terrain'

// Segments one layer's labels may add, past which the layer draws none and the
// panel says so.
const MAX_LABEL_SEGMENTS = 80_000

// Baseline-to-baseline distance, in em.
const LINE_HEIGHT = 1.25

// The sharpest turn, in degrees, that a stretch of line may make under one name.
const MAX_TURN_DEG = 40

/** Does this layer want labels at all? */
export function hasLabels(layer) {
  if (!layer) return false
  if (layer.geom === 'line') return !!(layer.labelName || layer.labelShield)
  return !!(layer.labelName || (layer.labelHeight && layer.geom !== 'area'))
}

/**
 * The face a layer letters in, as one key. A single-line face replaces the
 * roman, bold and italic choice: a stroke font has no bold to offer.
 */
function fontStyleKeyOf(layer) {
  if (layer?.labelSingleLine && layer?.labelFont) return singleLineKey(layer.labelFont)
  return fontStyleKey({ bold: layer?.labelBold, italic: layer?.labelItalic })
}

/** The lines one point or area shows, in order. */
function linesFor(layer, bucket, feature) {
  const out = []
  if (layer.labelName) {
    const name = bucket?.names.get(feature)
    if (name) out.push(name)
  }
  if (layer.labelHeight && layer.geom === 'point') {
    // The feature's note, which for a point is what its `ele` tag said.
    const note = bucket?.notes.get(feature)
    if (note) out.push(note)
  }
  return out
}

// ── Building blocks ───────────────────────────────────────────────────────────

/**
 * Collects one label's geometry in world units: stroke segments, fill
 * triangles, `<text>` runs for the SVG, and its outline in the view plane.
 */
class Job {
  constructor(feature, priority) {
    this.feature = feature
    this.priority = priority
    this.segs = []      // flat x0, y0, z0, x1, y1, z1, …
    this.tris = []      // flat x, y, z per triangle vertex
    this.runs = []
    this.boxes = []     // [minU, minV, maxU, maxV] in the view plane
    this.frame = []     // shield box strokes
  }
}

/** The view plane's two axes, for measuring overlaps. */
function viewAxes(viewTilt, viewSpin) {
  const b = iconBasis(viewTilt ?? 50, viewSpin ?? 0)
  return { R: [b.rx, b.ry, b.rz], U: [b.ux, b.uy, b.uz] }
}

/** The view-plane box round a set of world points, flat x, y, z. */
function boxOf(pts, axes, pad = 0) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity
  const { R, U } = axes
  for (let i = 0; i < pts.length; i += 3) {
    const u = pts[i] * R[0] + pts[i + 1] * R[1] + pts[i + 2] * R[2]
    const v = pts[i] * U[0] + pts[i + 1] * U[1] + pts[i + 2] * U[2]
    if (u < a) a = u
    if (u > c) c = u
    if (v < b) b = v
    if (v > d) d = v
  }
  return [a - pad, b - pad, c + pad, d + pad]
}

/**
 * Lays one em-unit block into the world through `place(ex, ey) → [x, y, z]`,
 * into a job.
 */
function layBlock(job, block, place, shapes) {
  for (const poly of block.polylines) {
    for (let k = 0; k + 3 < poly.length; k += 2) {
      const a = place(poly[k], poly[k + 1]), b = place(poly[k + 2], poly[k + 3])
      job.segs.push(a[0], a[1], a[2], b[0], b[1], b[2])
    }
  }
  if (shapes) {
    for (const shape of shapes) {
      for (let t = 0; t < shape.tris.length; t++) {
        const p = shape.tris[t] * 2
        const w = place(shape.pts[p], shape.pts[p + 1])
        job.tris.push(w[0], w[1], w[2])
      }
    }
  }
}

/** The ground height under a world point, or `fallback` off the raster. */
function groundAt(terrain, x, z, fallback) {
  if (!terrain?.grid) return fallback
  const { grid, gridMask, rows, cols, scl, halfW, halfH, elevScale } = terrain
  const b = sampleBilinear(grid, gridMask, rows, cols, (z + halfH) / scl, (x + halfW) / scl)
  return Number.isFinite(b) ? (b - 0.5) * 100 * (elevScale ?? 1) : fallback
}

// ── Points and areas ──────────────────────────────────────────────────────────

/**
 * A label in the plane its icon stands in, at an anchor: the lines of one
 * point or area, stacked down from the first.
 */
function planPlaneLabel(job, lines, anchor, layer, font, basis, axes, center = false) {
  const size = layer.labelSize ?? 10
  const align = center ? 'center' : (layer.labelAlign ?? 'center')
  const dx = center ? 0 : (layer.labelDx ?? 0)
  const dy = center ? 0 : (layer.labelDy ?? 14)
  const [ax, ay, az] = anchor
  const { rx, ry, rz, ux, uy, uz } = basis
  const corners = []
  for (let li = 0; li < lines.length; li++) {
    const block = textPolylines(lines[li], font)
    if (!block) continue
    const wide = block.width * size
    const x0 = dx - (align === 'center' ? wide / 2 : align === 'right' ? wide : 0)
    const y0 = dy - li * LINE_HEIGHT * size
    const place = (ex, ey) => {
      const u = x0 + ex * size, v = y0 + ey * size
      return [ax + u * rx + v * ux, ay + u * ry + v * uy, az + u * rz + v * uz]
    }
    const at = (u, v) => [ax + u * rx + v * ux, ay + u * ry + v * uy, az + u * rz + v * uz]
    if (!font.stroke) {
      job.runs.push({
        text: block.text, feature: job.feature,
        origin: at(dx, y0), emRight: at(dx + size, y0), emUp: at(dx, y0 + size),
        anchor: align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start',
      })
    }
    layBlock(job, block, place, layer.labelFill && !font.stroke ? iconTriangles(block) : null)
    corners.push(...place(0, -0.3), ...place(block.width, -0.3), ...place(0, 0.9), ...place(block.width, 0.9))
  }
  if (corners.length) job.boxes.push(boxOf(corners, axes, size * 0.15))
  return job
}

/** The anchors of a point layer: one per dot. */
function pointAnchors(dots) {
  const out = []
  const src = dots.positions
  for (let i = 0; i < src.length / 6; i++) {
    out.push({
      feature: dots.featureOfSegment ? dots.featureOfSegment[i] : i,
      at: [(src[i * 6] + src[i * 6 + 3]) * 0.5, src[i * 6 + 1], src[i * 6 + 2]],
    })
  }
  return out
}

/** The draped runs of each feature of a line or area layer, from its segments. */
function featureRuns(entry) {
  const pos = entry.positions, fos = entry.featureOfSegment
  const byFeature = new Map()
  let cur = null, lastF = -1
  for (let s = 0; s < pos.length / 6; s++) {
    const f = fos ? fos[s] : 0
    const o = s * 6
    const joins = cur && f === lastF &&
      pos[o] === cur[cur.length - 3] && pos[o + 1] === cur[cur.length - 2] && pos[o + 2] === cur[cur.length - 1]
    if (!joins) {
      cur = [pos[o], pos[o + 1], pos[o + 2]]
      let list = byFeature.get(f)
      if (!list) byFeature.set(f, (list = []))
      list.push(cur)
    }
    cur.push(pos[o + 3], pos[o + 4], pos[o + 5])
    lastF = f
  }
  return byFeature
}

/** Plan length of a run, on the ground plane. */
function runLength(run) {
  let L = 0
  for (let i = 3; i < run.length; i += 3) L += Math.hypot(run[i] - run[i - 3], run[i + 2] - run[i - 1])
  return L
}

/**
 * A point inside an area, for its name: the middle of the widest span of the
 * horizontal line through the middle of its outline.
 */
function interiorPoint(runs, terrain) {
  let minZ = Infinity, maxZ = -Infinity, ySum = 0, yN = 0
  for (const r of runs) {
    for (let i = 0; i < r.length; i += 3) {
      if (r[i + 2] < minZ) minZ = r[i + 2]
      if (r[i + 2] > maxZ) maxZ = r[i + 2]
      ySum += r[i + 1]; yN++
    }
  }
  if (!(maxZ > minZ)) return null
  const zc = (minZ + maxZ) / 2
  const xs = []
  for (const r of runs) {
    for (let i = 3; i < r.length; i += 3) {
      const z0 = r[i - 1], z1 = r[i + 2]
      if ((z0 <= zc) !== (z1 <= zc)) xs.push(r[i - 3] + ((zc - z0) / (z1 - z0)) * (r[i] - r[i - 3]))
    }
  }
  xs.sort((a, b) => a - b)
  let best = null, wide = 0
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (xs[k + 1] - xs[k] > wide) { wide = xs[k + 1] - xs[k]; best = (xs[k] + xs[k + 1]) / 2 }
  }
  if (best == null) return null
  return [best, groundAt(terrain, best, zc, ySum / yN), zc]
}

// ── Lines ─────────────────────────────────────────────────────────────────────

/** Arc-length lookup along a run: position and ground-plane direction at s. */
function walker(run) {
  const cum = [0]
  for (let i = 3; i < run.length; i += 3) {
    cum.push(cum[cum.length - 1] + Math.hypot(run[i] - run[i - 3], run[i + 2] - run[i - 1]))
  }
  const total = cum[cum.length - 1]
  let k = 1
  const at = (s) => {
    s = Math.max(0, Math.min(total, s))
    if (s < cum[k - 1]) k = 1
    while (k < cum.length - 1 && cum[k] < s) k++
    const i = (k - 1) * 3
    const len = cum[k] - cum[k - 1] || 1
    const t = (s - cum[k - 1]) / len
    const dx = run[i + 3] - run[i], dz = run[i + 5] - run[i + 2]
    const d = Math.hypot(dx, dz) || 1
    return {
      x: run[i] + dx * t, y: run[i + 1] + (run[i + 4] - run[i + 1]) * t, z: run[i + 2] + dz * t,
      tx: dx / d, tz: dz / d,
    }
  }
  return { at, total }
}

/** The largest turn, in degrees, between consecutive glyph stations. */
function maxTurn(stations) {
  let worst = 0
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1], b = stations[i]
    const cos = Math.max(-1, Math.min(1, a.tx * b.tx + a.tz * b.tz))
    worst = Math.max(worst, (Math.acos(cos) * 180) / Math.PI)
  }
  return worst
}

/**
 * A name along a line: the windows to letter, best first.
 *
 * A window is the stretch of the line under the name. It must be longer than
 * the name, and no two glyphs in it may turn more than `MAX_TURN_DEG` apart.
 * The window nearest the middle wins among the straight ones. `repeat` is the
 * gap between two copies in name lengths; 0 letters the line once.
 */
function lineWindows(w, width, size, repeat) {
  if (w.total < width * 1.1) return []
  const half = width / 2
  const lo = half, hi = w.total - half
  const steps = Math.max(1, Math.min(60, Math.ceil((hi - lo) / Math.max(size, 1e-6))))
  const probe = (c) => {
    const st = []
    for (let k = 0; k <= 6; k++) st.push(w.at(c - half + (width * k) / 6))
    return maxTurn(st)
  }
  if (!(repeat > 0)) {
    let best = null, score = Infinity
    for (let i = 0; i <= steps; i++) {
      const c = lo + ((hi - lo) * i) / steps
      const turn = probe(c)
      if (turn > MAX_TURN_DEG) continue
      const sc = turn / MAX_TURN_DEG + Math.abs(c - w.total / 2) / w.total
      if (sc < score) { score = sc; best = c }
    }
    return best == null ? [] : [best]
  }
  const out = []
  const gap = width * (1 + repeat)
  for (let c = lo; c <= hi; c += gap) {
    // Slide forward to the first straight enough window from here.
    for (let d = 0; d < gap / 2; d += Math.max(size, width / 8)) {
      if (c + d <= hi && probe(c + d) <= MAX_TURN_DEG) { out.push(c + d); break }
    }
  }
  return out
}

/** Places one name along a run at window centre `c`, into a job. */
function layAlong(job, w, c, run, font, layer, terrain, axes, viewSpin) {
  const size = layer.labelSize ?? 10
  const track = layer.labelTracking ?? 0
  const text = job.text
  const glyphs = glyphRun(text, font, track)
  if (!glyphs) return false
  const width = glyphs.width * size
  // Read left to right in the view: if the line runs the other way here, walk
  // it backwards.
  const theta = ((viewSpin ?? 0) * Math.PI) / 180
  const Rx = Math.cos(theta), Rz = -Math.sin(theta)
  const mid = w.at(c)
  const back = mid.tx * Rx + mid.tz * Rz < 0
  const side = layer.labelSide ?? 'above'
  const base = side === 'below' ? -1.0 : side === 'on' ? -0.35 : 0.35
  const lift = 1.5
  const fill = layer.labelFill && !font.stroke
  const corners = []
  for (const g of glyphs.glyphs) {
    const off = (g.x + g.adv / 2) * size
    const s = back ? c + width / 2 - off : c - width / 2 + off
    const p = w.at(s)
    const tx = back ? -p.tx : p.tx, tz = back ? -p.tz : p.tz
    // The glyph's up on the ground: the direction a quarter turn from its
    // reading direction, the same turn that takes the view's right to its up.
    const nx = tz, nz = -tx
    const y = groundAt(terrain, p.x, p.z, p.y) + lift
    const place = (ex, ey) => {
      const u = (ex - g.adv / 2) * size, v = (ey + base) * size
      return [p.x + tx * u + nx * v, y, p.z + tz * u + nz * v]
    }
    layBlock(job, g, place, fill ? iconTriangles(g) : null)
    if (!font.stroke && g.ch.trim()) {
      job.runs.push({
        text: g.ch, feature: job.feature, anchor: 'middle',
        origin: place(g.adv / 2, 0), emRight: (() => { const o = place(g.adv / 2, 0); return [o[0] + tx * size, o[1], o[2] + tz * size] })(),
        emUp: (() => { const o = place(g.adv / 2, 0); return [o[0] + nx * size, o[1], o[2] + nz * size] })(),
      })
    }
    const glyphBox = [...place(0, -0.3), ...place(g.adv, -0.3), ...place(0, 0.9), ...place(g.adv, 0.9)]
    job.boxes.push(boxOf(glyphBox, axes, size * 0.08))
    corners.push(...glyphBox)
  }
  return corners.length > 0
}

/** A road number in a box, square to the view, at the middle of a window. */
function planShield(job, note, anchor, layer, font, basis, axes) {
  const size = (layer.labelSize ?? 10) * 0.9
  const block = textPolylines(note, font)
  if (!block) return false
  const { rx, ry, rz, ux, uy, uz } = basis
  const [ax, ay, az] = anchor
  const wide = block.width * size
  const x0 = -wide / 2, y0 = -0.35 * size
  const place = (ex, ey) => {
    const u = x0 + ex * size, v = y0 + ey * size
    return [ax + u * rx + v * ux, ay + u * ry + v * uy, az + u * rz + v * uz]
  }
  const at = (u, v) => [ax + u * rx + v * ux, ay + u * ry + v * uy, az + u * rz + v * uz]
  if (!font.stroke) {
    job.runs.push({ text: block.text, feature: job.feature, anchor: 'middle',
      origin: at(0, y0), emRight: at(size, y0), emUp: at(0, y0 + size) })
  }
  layBlock(job, block, place, layer.labelFill && !font.stroke ? iconTriangles(block) : null)
  // The box: padding of a third of an em round the type.
  const pad = 0.35 * size
  const u0 = x0 - pad, u1 = x0 + wide + pad, v0 = y0 - 0.3 * size - pad * 0.6, v1 = y0 + 0.75 * size + pad
  const ring = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1), at(u0, v0)]
  for (let i = 1; i < ring.length; i++) job.frame.push(...ring[i - 1], ...ring[i])
  job.boxes.push(boxOf(ring.flat(), axes, size * 0.1))
  return true
}

// ── One layer ─────────────────────────────────────────────────────────────────

/**
 * Every label a layer would draw, as jobs, before collisions are settled.
 * Returns `{ jobs, segments }`, or null when there is nothing to letter.
 */
function planLayer(entry, layer, bucket, font, terrain, view) {
  const axes = viewAxes(view.tilt, view.spin)
  const basis = iconBasis(
    layer.iconFaceCamera !== false ? view.tilt : (layer.iconTilt ?? 50),
    layer.iconFaceCamera !== false ? view.spin : (layer.iconSpin ?? 0),
  )
  const jobs = []
  // Stops planning once the layer is past the budget: it will draw no labels,
  // and laying out the rest would only cost time.
  let segs = 0
  const over = () => {
    const j = jobs[jobs.length - 1]
    if (j) segs += (j.segs.length + j.frame.length) / 6
    return segs > MAX_LABEL_SEGMENTS
  }

  if (layer.geom === 'point') {
    for (const { feature, at } of pointAnchors(entry)) {
      const lines = linesFor(layer, bucket, feature)
      if (!lines.length) continue
      // Higher summits first.
      const h = parseFloat(bucket.notes.get(feature))
      jobs.push(planPlaneLabel(new Job(feature, Number.isFinite(h) ? h : -1e9), lines, at, layer, font, basis, axes))
      if (over()) return { jobs, segments: segs }
    }
  } else if (layer.geom === 'area') {
    for (const [feature, runs] of featureRuns(entry)) {
      const lines = linesFor(layer, bucket, feature)
      if (!lines.length) continue
      const at = interiorPoint(runs, terrain)
      if (!at) continue
      let area = 0
      for (const r of runs) area += runLength(r)
      jobs.push(planPlaneLabel(new Job(feature, area), lines, at, layer, font, basis, axes, true))
      if (over()) return { jobs, segments: segs }
    }
  } else {
    const size = layer.labelSize ?? 10
    for (const [feature, runs] of featureRuns(entry)) {
      const name = layer.labelName ? bucket.names.get(feature) : null
      const note = layer.labelShield ? bucket.notes.get(feature) : null
      if (!name && !note) continue
      // The longest draped run carries the lettering.
      let run = runs[0], L = runLength(run)
      for (const r of runs) { const l = runLength(r); if (l > L) { L = l; run = r } }
      const w = walker(run)
      // The name takes the straightest stretch; the shield then stands a
      // quarter of the line away from it, on the longer side.
      let windows = []
      if (name) {
        const glyphs = glyphRun(name, font, layer.labelTracking ?? 0)
        if (glyphs) windows = lineWindows(w, glyphs.width * size, size, layer.labelRepeat ?? 0)
      }
      if (note) {
        const job = new Job(feature, L * 2)
        const c = windows.length === 1 ? windows[0] : null
        const at = c == null ? w.total / 2 : c < w.total / 2 ? w.total * 0.75 : w.total * 0.25
        const m = w.at(at)
        if (planShield(job, note, [m.x, groundAt(terrain, m.x, m.z, m.y) + 2, m.z], layer, font, basis, axes)) {
          job.shield = true
          jobs.push(job)
          if (over()) return { jobs, segments: segs }
        }
      }
      for (const c of windows) {
        const job = new Job(feature, L)
        job.text = name
        if (layAlong(job, w, c, run, font, layer, terrain, axes, view.spin)) {
          jobs.push(job)
          if (over()) return { jobs, segments: segs }
        }
      }
    }
  }
  if (!jobs.length) return null
  return { jobs, segments: segs }
}

// ── Collisions ────────────────────────────────────────────────────────────────

/** A uniform grid of kept boxes, for overlap tests in near constant time. */
class BoxGrid {
  constructor(cell) { this.cell = Math.max(cell, 1e-3); this.map = new Map() }
  *cells(b) {
    const c = this.cell
    for (let i = Math.floor(b[0] / c); i <= Math.floor(b[2] / c); i++) {
      for (let j = Math.floor(b[1] / c); j <= Math.floor(b[3] / c); j++) yield `${i},${j}`
    }
  }
  hits(boxes) {
    for (const b of boxes) {
      for (const k of this.cells(b)) {
        for (const o of this.map.get(k) ?? []) {
          if (b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]) return true
        }
      }
    }
    return false
  }
  add(boxes) {
    for (const b of boxes) for (const k of this.cells(b)) {
      let l = this.map.get(k)
      if (!l) this.map.set(k, (l = []))
      l.push(b)
    }
  }
}

/**
 * Which jobs survive. `planned` is in stack order, top first. Layers without
 * Avoid overlaps keep every label and go into the grid first.
 */
export function settleCollisions(planned) {
  let sum = 0, n = 0
  for (const { jobs } of planned) for (const j of jobs) for (const b of j.boxes) { sum += b[3] - b[1]; n++ }
  const grid = new BoxGrid(n ? (sum / n) * 2 : 10)
  for (const p of planned) if (!p.layer.labelAvoid) for (const j of p.jobs) grid.add(j.boxes)
  const dropped = new Map()
  for (const p of planned) {
    if (!p.layer.labelAvoid) continue
    // Shields first, then by priority, high to low.
    const order = [...p.jobs].sort((a, b) => (b.shield ? 1 : 0) - (a.shield ? 1 : 0) || b.priority - a.priority)
    const keep = []
    for (const j of order) {
      if (grid.hits(j.boxes)) continue
      grid.add(j.boxes)
      keep.push(j)
    }
    dropped.set(p.layer.id, p.jobs.length - keep.length)
    p.jobs = keep
  }
  return dropped
}

// ── Emission ──────────────────────────────────────────────────────────────────

/** Kept jobs → the `#labels` entry, and the `#shields` entry for the boxes. */
function emit(layer, jobs, font) {
  let nSeg = 0, nTri = 0, nFrame = 0
  for (const j of jobs) { nSeg += j.segs.length; nTri += j.tris.length; nFrame += j.frame.length }
  const out = []
  if (nSeg) {
    const positions = new Float32Array(nSeg)
    const featureOfSegment = new Int32Array(nSeg / 6)
    const fillPos = nTri ? new Float32Array(nTri) : null
    const fillIdx = nTri ? new Uint32Array(nTri / 3) : null
    const runs = []
    let w = 0, s = 0, fw = 0
    for (const j of jobs) {
      positions.set(j.segs, w)
      featureOfSegment.fill(j.feature, s, s + j.segs.length / 6)
      w += j.segs.length; s += j.segs.length / 6
      if (fillPos) { fillPos.set(j.tris, fw); fw += j.tris.length }
      runs.push(...j.runs)
    }
    if (fillIdx) for (let i = 0; i < fillIdx.length; i++) fillIdx[i] = i
    out.push({
      // Suffixed like the icon layer's, so `layerStyle` resolves the style back
      // to the layer and the SVG's pen layer is called "Peaks · labels".
      id: `${layer.id}#labels`,
      positions, colors: null, curtains: null, lids: null, isPoints: false,
      featureOfSegment,
      isLabelText: true,
      textRuns: runs.length ? runs : null,
      textStyle: runs.length ? {
        family: font.family ?? 'Space Mono',
        weight: layer.labelBold ? 700 : 400,
        style: layer.labelItalic ? 'italic' : 'normal',
      } : null,
      fills: fillPos ? { positions: fillPos, indices: fillIdx } : null,
    })
  }
  if (nFrame) {
    const positions = new Float32Array(nFrame)
    const featureOfSegment = new Int32Array(nFrame / 6)
    let w = 0, s = 0
    for (const j of jobs) {
      if (!j.frame.length) continue
      positions.set(j.frame, w)
      featureOfSegment.fill(j.feature, s, s + j.frame.length / 6)
      w += j.frame.length; s += j.frame.length / 6
    }
    out.push({
      id: `${layer.id}#shields`, positions, colors: null, curtains: null, lids: null,
      isPoints: false, featureOfSegment, isLabelText: true, fills: null,
    })
  }
  return out
}

/**
 * Appends label entries for every layer that asked for them.
 *
 * `lineGeo` is what the icons hook produced; labels go beside each layer's own
 * geometry. `dotsGeo` is the worker's own output, where the anchors and the
 * draped lines come from. `terrain` gives the ground height under a name.
 *
 * Returns `{ lineGeo, overflowed, dropped }`: the layers whose labels would
 * cost more than the budget, and how many labels each Avoid overlaps layer
 * gave up.
 */
export function useVectorLabels(lineGeo, dotsGeo, vectorLayers, vectorSources, viewTilt, viewSpin, terrain = null) {
  const [fonts, setFonts] = useState({})
  const asked = useRef(new Set())
  const wantedFaces = [...new Set((vectorLayers ?? []).filter(hasLabels).map(fontStyleKeyOf))].sort().join(',')
  useEffect(() => {
    for (const key of wantedFaces ? wantedFaces.split(',') : []) {
      if (asked.current.has(key)) continue
      asked.current.add(key)
      loadTextFont(key).then((f) => {
        if (!f) asked.current.delete(key)
        setFonts((cur) => ({ ...cur, [key]: f }))
      })
    }
  }, [wantedFaces])

  // Strings rather than the arrays: `vectorLayers` is replaced on every colour
  // tick, and rebuilding text for a change that moves no vertex is waste.
  const labelled = (vectorLayers ?? []).filter(hasLabels)
  const key = labelled
    .map((l) => `${l.id}|${l.geom}|${l.labelName ? 1 : 0}|${l.labelHeight ? 1 : 0}|${l.labelShield ? 1 : 0}|${l.labelSize}|` +
                `${l.labelDx}|${l.labelDy}|${l.labelAlign}|${l.labelFill && !l.labelSingleLine ? 1 : 0}|` +
                `${fontStyleKeyOf(l)}|${l.iconFaceCamera ? 1 : 0}|${l.iconTilt}|${l.iconSpin}|` +
                `${l.labelSide}|${l.labelRepeat}|${l.labelTracking}|${l.labelAvoid ? 1 : 0}`)
    .join(';')
  // The view matters to a face-camera label, to the reading direction of a
  // line label, and to every overlap test.
  const viewBound = labelled.some((l) => l.iconFaceCamera || l.geom !== 'point' || l.labelAvoid)
  const camKey = viewBound ? `${viewTilt}|${viewSpin}` : ''
  const order = labelled.map((l) => l.id).join(',')

  return useMemo(() => {
    const overflowed = new Set()
    const dropped = new Map()
    if (!key || !Array.isArray(lineGeo) || !Array.isArray(dotsGeo)) return { lineGeo, overflowed, dropped }

    const byId = new Map()
    for (const e of dotsGeo) if (!e.id.includes('#')) byId.set(e.id, e)

    const planned = []
    for (const layer of vectorLayers ?? []) {
      if (!hasLabels(layer)) continue
      const entry = byId.get(layer.id)
      if (!entry?.positions?.length) continue
      const bucket = vectorSources
        ?.find((s) => s.id === layer.sourceId)
        ?.buckets.find((b) => b.key === layer.bucket)
      if (!bucket) continue
      const font = fonts[fontStyleKeyOf(layer)]
      if (!font) continue
      const plan = planLayer(entry, layer, bucket, font, terrain, { tilt: viewTilt, spin: viewSpin })
      if (!plan) continue
      if (plan.segments > MAX_LABEL_SEGMENTS) { overflowed.add(layer.id); continue }
      planned.push({ layer, font, jobs: plan.jobs })
    }
    if (!planned.length) return { lineGeo, overflowed, dropped }
    for (const [id, n] of settleCollisions(planned)) dropped.set(id, n)

    const extra = new Map()
    for (const p of planned) {
      const entries = emit(p.layer, p.jobs, p.font)
      if (entries.length) extra.set(p.layer.id, entries)
    }

    // Spliced in directly behind the geometry they label, so a layer dragged to
    // the bottom of the stack takes its lettering with it.
    // A layer's entries sit together (hatch, stroke, decoration, icons), so the
    // labels go after the last of them.
    const out = []
    for (let i = 0; i < lineGeo.length; i++) {
      const entry = lineGeo[i]
      out.push(entry)
      const base = entry.id.split('#')[0]
      const next = lineGeo[i + 1]?.id.split('#')[0]
      const labels = next === base ? null : extra.get(base)
      if (labels) { out.push(...labels); extra.delete(base) }
    }
    for (const labels of extra.values()) out.push(...labels)
    return { lineGeo: out, overflowed, dropped }
    // `key`, `camKey` and `order` stand in for the layers and the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineGeo, dotsGeo, vectorSources, key, camKey, order, fonts, terrain])
}
