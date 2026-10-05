/**
 * Charts: the ground as a diagram, laid flat above the plate.
 *
 * Swath Profile, Hypsometry, Aspect Rose and Stereonet each read the whole
 * plate and draw the chart a geomorphologist would plot from it. Like Waveform
 * and Profile Sheet, each lies flat at the height of the highest point, so a
 * plan view shows it alone, north up, and nothing in it is draped.
 *
 * Heights, slopes and bearings are true metres and degrees, from the same
 * `groundMetres` the survey modes use: the GeoTIFF's own scale where there is
 * one, else *Pixel size* and *Relief*.
 *
 * Each chart has two pens and a third for its lettering: the data in the mode's
 * own ink (`<Id>`), the frame, the grid and the ticks in the line colour
 * (`<Id>-Rules`), and the numbers, which the rules carry as anchors and
 * `useScaleLabels` letters as `<Id>-Numbers`.
 */
import { sampleBilinear } from '../terrain'
import { computeVertexColor, hexToRgb } from '../colorUtils'
import { groundMetres } from './ground.js'
import { F32List } from './shared.js'

const RAD = Math.PI / 180
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

/** A round step for about `n` divisions of `range`: 1, 2 or 5 times a power of ten. */
function niceStep(range, n) {
  const raw = range / Math.max(1, n)
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow
}

/** Metres as a map writes them: `850 m`, `1.2 km`. */
function metres(m, step) {
  if (Math.abs(step) >= 1000 || Math.abs(m) >= 10000) {
    const km = m / 1000
    return `${Number.isInteger(km) ? km : km.toFixed(step >= 1000 ? 0 : 1)} km`
  }
  return `${Math.round(m)} m`
}

/** One chart's pens. Points are (x, z) on the plate: x east, z south. */
function chartPens(terrain, p) {
  const y = terrain.maxElev
  const ink = hexToRgb(p.lineColor)
  const main = { positions: new F32List(), colors: new F32List() }
  const extra = { positions: new F32List(), colors: new F32List() }
  const rules = { positions: new F32List(), colors: new F32List() }
  const anchors = []
  const put = (to, x0, z0, x1, z1, c0, c1) => {
    to.positions.push6(x0, y, z0, x1, y, z1)
    to.colors.pushRgb(c0); to.colors.pushRgb(c1)
  }
  return {
    ink, main, extra, rules, anchors,
    line: (x0, z0, x1, z1, c0 = ink, c1 = c0) => put(main, x0, z0, x1, z1, c0, c1),
    mark: (x0, z0, x1, z1, c0 = ink) => put(extra, x0, z0, x1, z1, c0, c0),
    rule: (x0, z0, x1, z1) => put(rules, x0, z0, x1, z1, ink, ink),
    text: (x, z, text, size, align = 'middle', valign = 'middle') => anchors.push({ x, y, z, text, size, align, valign }),
  }
}

/** The layers of one chart, `extra` under `extraId` when it has any. */
function chartLayers(id, pens, extraId) {
  const out = {}
  const take = (l) => ({ positions: l.positions.toArray(), colors: l.colors.toArray() })
  if (pens.main.positions.length) out[id] = take(pens.main)
  if (extraId && pens.extra.positions.length) out[extraId] = take(pens.extra)
  if (pens.rules.positions.length || pens.anchors.length) {
    out[`${id}-Rules`] = { ...take(pens.rules), scaleAnchors: pens.anchors.length ? pens.anchors : null }
  }
  return Object.keys(out).length ? out : null
}

/** A circle as a polyline of `n` chords, through `rule` or `line`. */
function circle(draw, cx, cz, r, n = 180) {
  for (let k = 0; k < n; k++) {
    const a = (k / n) * 2 * Math.PI, b = ((k + 1) / n) * 2 * Math.PI
    draw(cx + r * Math.sin(a), cz - r * Math.cos(a), cx + r * Math.sin(b), cz - r * Math.cos(b))
  }
}

/** Downslope gradient at a cell in true metres, or null at an edge of the data. */
function gradientAt(heights, mask, rows, cols, cellX, cellY, r, c) {
  if (r < 1 || c < 1 || r >= rows - 1 || c >= cols - 1) return null
  const i = r * cols + c
  if (!mask[i] || !mask[i - 1] || !mask[i + 1] || !mask[i - cols] || !mask[i + cols]) return null
  const gx = (heights[i + 1] - heights[i - 1]) / (2 * cellX)
  const gz = (heights[i + cols] - heights[i - cols]) / (2 * cellY)
  return [gx, gz]
}

/** Slope in degrees and the downslope bearing, clockwise from north (−z). */
function slopeAndBearing(gx, gz) {
  const slope = Math.atan(Math.hypot(gx, gz)) / RAD
  // Downslope is −∇h: east −gx, north +gz (north is −z).
  const bearing = ((Math.atan2(-gx, gz) / RAD) + 360) % 360
  return [slope, bearing]
}

/** Point at `bearing` degrees and radius `r` from (cx, cz), north up. */
const polar = (cx, cz, bearing, r) => [cx + r * Math.sin(bearing * RAD), cz - r * Math.cos(bearing * RAD)]

// ─── Swath Profile ───────────────────────────────────────────────────────────

/**
 * A swath profile: the ground along the plate's longer side, summarised
 * across a strip `width` of the shorter side wide (a share, 1 is all of it).
 *
 * At each of 500 steps along, every cell across the strip is read, and the
 * chart draws their mean as the mode's own pen, and their highest and lowest,
 * the envelope, as the rules. `quartiles` adds the 25th and 75th percentiles.
 * `hatch` fills the envelope with a vertical stroke every that many steps, so
 * the band reads as a tone a pen can draw. This is how tectonic geomorphology
 * reads relief along a range: where the mean rides the top of the envelope the
 * ground is a plateau, where it hugs the bottom it is cut by valleys.
 *
 * Heights are labelled in metres and the axis in distance along the strip.
 */
export function buildSwathProfile(terrain, p, o) {
  const { gridMask, rows, cols, halfW, halfH, hasNoData } = terrain
  if (rows < 3 || cols < 3) return null
  const { heights, cellX, cellY } = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const STEPS = 500
  const wide = cols >= rows
  const nLong = wide ? cols : rows, nShort = wide ? rows : cols
  const per = (nLong - 1) / STEPS
  const share = clamp(o.width ?? 1, 0.02, 1)
  const j0 = (nShort - 1) * (1 - share) / 2, j1 = (nShort - 1) - j0
  const across = Math.max(2, Math.round(j1 - j0) + 1)
  const sMask = hasNoData ? gridMask : null

  const lo3 = new Float32Array(STEPS + 1), hi3 = new Float32Array(STEPS + 1), mean = new Float32Array(STEPS + 1)
  const q1 = new Float32Array(STEPS + 1), q3 = new Float32Array(STEPS + 1), ok = new Uint8Array(STEPS + 1)
  const buf = new Float32Array(across)
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i <= STEPS; i++) {
    const t = Math.min(i * per, nLong - 1)
    let n = 0, sum = 0
    for (let k = 0; k < across; k++) {
      const s = j0 + (j1 - j0) * k / (across - 1)
      const v = wide ? sampleBilinear(heights, sMask, rows, cols, s, t) : sampleBilinear(heights, sMask, rows, cols, t, s)
      if (v === v) { buf[n++] = v; sum += v }
    }
    if (!n) continue
    const a = buf.subarray(0, n).sort()
    ok[i] = 1
    lo3[i] = a[0]; hi3[i] = a[n - 1]; mean[i] = sum / n
    q1[i] = a[Math.floor((n - 1) * 0.25)]; q3[i] = a[Math.floor((n - 1) * 0.75)]
    if (a[0] < lo) lo = a[0]
    if (a[n - 1] > hi) hi = a[n - 1]
  }
  if (!(hi > lo)) return null

  const P = chartPens(terrain, p)
  const S = Math.min(2 * halfW, 2 * halfH)
  const left = -halfW + 0.12 * S, right = halfW - 0.04 * S
  const top = -halfH + 0.06 * S, bottom = halfH - 0.12 * S
  const size = 0.028 * S
  const step = niceStep(hi - lo, 5)
  const vlo = Math.floor(lo / step) * step, vhi = Math.ceil(hi / step) * step
  const xOf = (i) => left + (right - left) * i / STEPS
  const zOf = (v) => bottom - (v - vlo) / (vhi - vlo) * (bottom - top)
  const shade = (v) => computeVertexColor((v - lo) / (hi - lo), 0, 0, p)

  // The frame, the height grid and its numbers.
  P.rule(left, top, right, top); P.rule(right, top, right, bottom)
  P.rule(right, bottom, left, bottom); P.rule(left, bottom, left, top)
  for (let v = vlo; v <= vhi + step / 2; v += step) {
    const z = zOf(v)
    if (v > vlo && v < vhi) P.rule(left, z, right, z)
    P.rule(left - 0.012 * S, z, left, z)
    P.text(left - 0.02 * S, z, metres(v, step), size, 'end', 'middle')
  }
  // Distance along the strip, from the left.
  const length = (nLong - 1) * (wide ? cellX : cellY)
  const dStep = niceStep(length, 6)
  for (let d = 0; d <= length + 1e-6; d += dStep) {
    const x = left + (right - left) * d / length
    P.rule(x, bottom, x, bottom + 0.012 * S)
    P.text(x, bottom + 0.022 * S, metres(d, dStep), size, 'middle', 'top')
  }

  // The envelope and its hatch, then the mean.
  const hatch = Math.max(0, Math.round(o.hatch ?? 3))
  const series = [lo3, hi3, ...(o.quartiles ? [q1, q3] : [])]
  for (const s of series) {
    for (let i = 0; i < STEPS; i++) if (ok[i] && ok[i + 1]) P.rule(xOf(i), zOf(s[i]), xOf(i + 1), zOf(s[i + 1]))
  }
  if (hatch > 0) for (let i = 0; i <= STEPS; i += hatch) if (ok[i]) P.rule(xOf(i), zOf(hi3[i]), xOf(i), zOf(lo3[i]))
  for (let i = 0; i < STEPS; i++) {
    if (ok[i] && ok[i + 1]) P.line(xOf(i), zOf(mean[i]), xOf(i + 1), zOf(mean[i + 1]), shade(mean[i]), shade(mean[i + 1]))
  }
  return chartLayers('SwathProfile', P)
}

// ─── Hypsometry ──────────────────────────────────────────────────────────────

/**
 * The hypsometric curve (Strahler, 1952): how much of the plate lies above
 * each height, both as shares, in a square frame.
 *
 * Read along the curve, a point at (a, h) says a share a of the ground stands
 * higher than h of the way from the lowest point to the highest. A curve that
 * bulges up and right is ground still mostly high, an upland not yet cut; one
 * that sags is ground worn down to its base, with a few summits left. The area
 * under it is the hypsometric integral, written in the frame.
 *
 * With `bins` above 0, the frame's right side carries the histogram it is
 * drawn from: the share of the ground in each band of height, as bars inward.
 */
export function buildHypsometry(terrain, p, o) {
  const { gridMask, rows, cols, halfW, halfH } = terrain
  const { heights } = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  let n = 0
  for (let i = 0; i < rows * cols; i++) if (gridMask[i]) n++
  if (n < 2) return null
  const a = new Float32Array(n)
  for (let i = 0, k = 0; i < rows * cols; i++) if (gridMask[i]) a[k++] = heights[i]
  a.sort()
  const lo = a[0], hi = a[n - 1]
  if (!(hi > lo)) return null

  const P = chartPens(terrain, p)
  const S = 0.72 * Math.min(2 * halfW, 2 * halfH)
  const x0 = -S / 2, x1 = S / 2, top = -S / 2 - 0.02 * S, bottom = S / 2 - 0.02 * S
  const size = 0.034 * S
  const X = (share) => x0 + share * (x1 - x0)
  const Z = (rel) => bottom - rel * (bottom - top)

  // The curve, 200 steps along the share of area above.
  const N = 200
  let px = 0, pz = 0, pr = 0, integral = 0
  for (let k = 0; k <= N; k++) {
    const share = k / N
    const rel = (a[Math.min(n - 1, Math.round((1 - share) * (n - 1)))] - lo) / (hi - lo)
    const x = X(share), z = Z(rel)
    if (k > 0) P.line(px, pz, x, z, computeVertexColor(pr, 0, 0, p), computeVertexColor(rel, 0, 0, p))
    px = x; pz = z; pr = rel
  }
  for (let k = 0; k < n; k++) integral += (a[k] - lo) / (hi - lo)
  integral /= n

  // The frame, a grid at quarters, and the axes' numbers.
  P.rule(x0, top, x1, top); P.rule(x1, top, x1, bottom); P.rule(x1, bottom, x0, bottom); P.rule(x0, bottom, x0, top)
  for (const q of [0.25, 0.5, 0.75]) { P.rule(X(q), top, X(q), bottom); P.rule(x0, Z(q), x1, Z(q)) }
  for (const q of [0, 0.5, 1]) {
    const label = q === 0.5 ? '0.5' : String(q)
    P.text(X(q), bottom + 0.03 * S, label, size, 'middle', 'top')
    P.text(x0 - 0.03 * S, Z(q), label, size, 'end', 'middle')
  }
  P.text((x0 + x1) / 2, bottom + 0.1 * S, 'a / A', size, 'middle', 'top')
  P.text(x0, top - 0.04 * S, 'h / H', size, 'middle', 'bottom')
  P.text(x1 - 0.04 * S, top + 0.06 * S, `HI ${integral.toFixed(2)}`, size * 1.2, 'end', 'top')
  P.text(x1 + 0.03 * S, Z(0), metres(lo, 1), size * 0.9, 'start', 'middle')
  P.text(x1 + 0.03 * S, Z(1), metres(hi, 1), size * 0.9, 'start', 'middle')

  // The histogram, as bars in from the right side.
  const bins = Math.max(0, Math.round(o.bins ?? 20))
  if (bins > 0) {
    const count = new Uint32Array(bins)
    for (let k = 0; k < n; k++) count[Math.min(bins - 1, Math.floor((a[k] - lo) / (hi - lo) * bins))]++
    const most = Math.max(...count)
    const reach = 0.3 * (x1 - x0)
    for (let b = 0; b < bins; b++) {
      if (!count[b]) continue
      const w = reach * count[b] / most, zb = Z(b / bins), zt = Z((b + 1) / bins)
      P.rule(x1, zt, x1 - w, zt); P.rule(x1 - w, zt, x1 - w, zb); P.rule(x1 - w, zb, x1, zb)
    }
  }
  return chartLayers('Hypsometry', P)
}

// ─── Aspect Rose ─────────────────────────────────────────────────────────────

/**
 * A rose diagram of the way the ground faces: in `sectors` around the compass,
 * the share of the ground whose downslope bearing falls there, weighted by its
 * gradient (`by: 'slope'`) so steep ground counts for more, or by area alone.
 * Ground flatter than `minSlope` degrees faces nowhere and is left out.
 *
 * With `scale: 'area'` a petal's radius goes with the square root of its share,
 * so its area, not its length, is the share; a linear rose makes the largest
 * petals look larger than they are. Rings mark shares of the largest petal, and
 * are labelled with the share they stand for. `hatch` fills each petal with
 * arcs that far apart, in steps of the chart's radius over 100.
 */
export function buildAspectRose(terrain, p, o) {
  const { gridMask, rows, cols, halfW, halfH } = terrain
  const { heights, cellX, cellY } = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const N = Math.max(4, Math.round(o.sectors ?? 36))
  const minSlope = Math.max(0, o.minSlope ?? 2)
  const sector = 360 / N
  const w = new Float64Array(N)
  let total = 0
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const g = gradientAt(heights, gridMask, rows, cols, cellX, cellY, r, c)
      if (!g) continue
      const [slope, bearing] = slopeAndBearing(g[0], g[1])
      if (slope < minSlope) continue
      const wt = o.by === 'area' ? 1 : Math.hypot(g[0], g[1])
      w[Math.floor((bearing + sector / 2) / sector) % N] += wt
      total += wt
    }
  }
  if (!(total > 0)) return null

  const P = chartPens(terrain, p)
  const R = 0.4 * Math.min(2 * halfW, 2 * halfH)
  const size = 0.07 * R
  const most = Math.max(...w) / total
  const equal = (o.scale ?? 'area') === 'area'
  const radius = (share) => R * (equal ? Math.sqrt(share / most) : share / most)
  const r = Array.from(w, (v) => radius(v / total))
  const shade = (k) => computeVertexColor(w[k] / total / most, 0, 0, p)

  // Each petal's arc, and the radial edges between neighbours, drawn once each.
  for (let k = 0; k < N; k++) {
    const a = (k - 0.5) * sector, b = (k + 0.5) * sector
    const steps = Math.max(2, Math.ceil(sector / 2))
    for (let s = 0; s < steps; s++) {
      const [xa, za] = polar(0, 0, a + (b - a) * s / steps, r[k])
      const [xb, zb] = polar(0, 0, a + (b - a) * (s + 1) / steps, r[k])
      P.line(xa, za, xb, zb, shade(k))
    }
    // From a little out, or thirty-six edges meet in a blot at the centre.
    const edge = Math.max(r[k], r[(k + N - 1) % N]), hub = 0.04 * R
    if (edge > hub) {
      const [xs, zs] = polar(0, 0, a, hub), [xe, ze] = polar(0, 0, a, edge)
      P.line(xs, zs, xe, ze, shade(k))
    }
    const hatch = Math.max(0, o.hatch ?? 0) * R / 100
    if (hatch > 0) {
      for (let rr = hatch; rr < r[k]; rr += hatch) {
        for (let s = 0; s < steps; s++) {
          const [xa, za] = polar(0, 0, a + (b - a) * s / steps, rr)
          const [xb, zb] = polar(0, 0, a + (b - a) * (s + 1) / steps, rr)
          P.line(xa, za, xb, zb, shade(k))
        }
      }
    }
  }

  // Rings, the axes, a tick every 10° and the compass points.
  const rings = Math.max(1, Math.round(o.rings ?? 4))
  for (let i = 1; i <= rings; i++) {
    const shareOf = most * i / rings
    const rr = radius(shareOf)
    circle(P.rule, 0, 0, rr)
    const [tx, tz] = polar(0, 0, 45, rr)
    P.text(tx + 0.02 * R, tz, `${(shareOf * 100).toFixed(shareOf < 0.1 ? 1 : 0)}%`, size * 0.75, 'start', 'bottom')
  }
  P.rule(0, -R * 1.04, 0, R * 1.04); P.rule(-R * 1.04, 0, R * 1.04, 0)
  for (let d = 0; d < 360; d += 10) {
    const [xa, za] = polar(0, 0, d, R * 1.04), [xb, zb] = polar(0, 0, d, R * (d % 90 ? 1.08 : 1.1))
    P.rule(xa, za, xb, zb)
  }
  for (const [d, l] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    const [x, z] = polar(0, 0, d, R * 1.2)
    P.text(x, z, l, size, 'middle', 'middle')
  }
  return chartLayers('AspectRose', P)
}

// ─── Stereonet ───────────────────────────────────────────────────────────────

/** A field's level as segments, by marching squares on a `g`×`g` grid. */
function isoSegments(field, g, level, at, out) {
  const v = (i, j) => field[j * g + i]
  const lerp = (a, b) => (level - a) / (b - a)
  for (let j = 0; j < g - 1; j++) {
    for (let i = 0; i < g - 1; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1)
      const idx = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0)
      if (idx === 0 || idx === 15) continue
      // Crossing points on the four edges: top (a-b), right (b-c), bottom (d-c), left (a-d).
      const e = [
        (a > level) !== (b > level) ? [i + lerp(a, b), j] : null,
        (b > level) !== (c > level) ? [i + 1, j + lerp(b, c)] : null,
        (d > level) !== (c > level) ? [i + lerp(d, c), j + 1] : null,
        (a > level) !== (d > level) ? [i, j + lerp(a, d)] : null,
      ].filter(Boolean)
      for (let k = 0; k + 1 < e.length; k += 2) out(at(e[k]), at(e[k + 1]))
    }
  }
}

/**
 * Every slope as the pole to its plane on a lower-hemisphere equal-area net
 * (Schmidt net), as structural geology plots bedding and joints.
 *
 * A slope that dips δ toward the bearing α has its pole plunging 90° − δ
 * toward α + 180°, and the equal-area projection puts it at r = R·√2·sin(δ/2)
 * from the centre: level ground at the centre, a cliff at the rim, on the side
 * opposite the way it faces. Up to `sample` cells are read, evenly; ground
 * flatter than `minSlope` is left out.
 *
 * `poles` marks each pole with a small cross, its own pen. `contours` draws the
 * density of the poles in `levels` lines, in multiples of a uniform spread,
 * from a Gaussian count over the net. `net` draws the graticule: great circles
 * through north and south and small circles about that axis, every 10°.
 */
export function buildStereonet(terrain, p, o) {
  const { gridMask, rows, cols, halfW, halfH } = terrain
  const { heights, cellX, cellY } = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const R = 0.42 * Math.min(2 * halfW, 2 * halfH)
  const minSlope = Math.max(0, o.minSlope ?? 2)
  let valid = 0
  for (let i = 0; i < rows * cols; i++) if (gridMask[i]) valid++
  const stride = Math.max(1, Math.ceil(Math.sqrt(valid / Math.max(100, o.sample ?? 3000))))
  const poles = []
  for (let r = 1; r < rows - 1; r += stride) {
    for (let c = 1; c < cols - 1; c += stride) {
      const g = gradientAt(heights, gridMask, rows, cols, cellX, cellY, r, c)
      if (!g) continue
      const [dip, dipDir] = slopeAndBearing(g[0], g[1])
      if (dip < minSlope) continue
      const [x, z] = polar(0, 0, dipDir + 180, R * Math.SQRT2 * Math.sin(dip / 2 * RAD))
      poles.push(x, z, dip)
    }
  }
  const P = chartPens(terrain, p)
  const size = 0.07 * R

  if (o.poles !== false) {
    const m = 0.012 * R
    for (let k = 0; k < poles.length; k += 3) {
      const [x, z] = [poles[k], poles[k + 1]], c = computeVertexColor(poles[k + 2] / 90, 0, 0, p)
      P.mark(x - m, z, x + m, z, c); P.mark(x, z - m, x, z + m, c)
    }
  }

  if (o.contours !== false && poles.length >= 30) {
    // A Gaussian count on a grid over the net, in multiples of a uniform spread.
    const G = 64, cell = 2 * R / (G - 1), sigma = 0.08 * R, field = new Float32Array(G * G)
    const reach = Math.ceil(3 * sigma / cell)
    for (let k = 0; k < poles.length; k += 3) {
      const ci = (poles[k] + R) / cell, cj = (poles[k + 1] + R) / cell
      for (let j = Math.max(0, Math.floor(cj - reach)); j <= Math.min(G - 1, Math.ceil(cj + reach)); j++) {
        for (let i = Math.max(0, Math.floor(ci - reach)); i <= Math.min(G - 1, Math.ceil(ci + reach)); i++) {
          const dx = (i - ci) * cell, dz = (j - cj) * cell
          field[j * G + i] += Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma))
        }
      }
    }
    // A uniform spread of the same poles over the disc, through the same kernel.
    const uniform = (poles.length / 3) * 2 * Math.PI * sigma * sigma / (Math.PI * R * R)
    for (let k = 0; k < field.length; k++) field[k] /= uniform
    let peak = 0
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      if (Math.hypot(i * cell - R, j * cell - R) <= R && field[j * G + i] > peak) peak = field[j * G + i]
    }
    const levels = Math.max(1, Math.round(o.levels ?? 5))
    const at = ([i, j]) => [i * cell - R, j * cell - R]
    for (let l = 1; l <= levels; l++) {
      const level = peak * l / (levels + 1)
      isoSegments(field, G, level, at, ([xa, za], [xb, zb]) => {
        if (Math.hypot(xa, za) > R || Math.hypot(xb, zb) > R) return
        const c = computeVertexColor(l / (levels + 1), 0, 0, p)
        P.line(xa, za, xb, zb, c)
      })
    }
  }

  // The primitive circle, the graticule, a tick every 10° and north.
  circle(P.rule, 0, 0, R, 240)
  if (o.net) {
    const project = (e, nth, u) => {
      // A lower-hemisphere direction (east, north, up ≤ 0) onto the net.
      const plunge = Math.asin(clamp(-u, -1, 1)), trend = Math.atan2(e, nth) / RAD
      return polar(0, 0, trend, R * Math.SQRT2 * Math.sin((Math.PI / 2 - plunge) / 2))
    }
    const curve = (f) => {
      let prev = null
      for (let t = 0; t <= 90; t++) {
        const q = project(...f(t * Math.PI / 90))
        if (prev) P.rule(prev[0], prev[1], q[0], q[1])
        prev = q
      }
    }
    for (let d = 10; d < 90; d += 10) {
      const cd = Math.cos(d * RAD), sd = Math.sin(d * RAD)
      // Great circles striking north, dipping d east and west.
      curve((t) => [Math.sin(t) * cd, Math.cos(t), -Math.sin(t) * sd])
      curve((t) => [-Math.sin(t) * cd, Math.cos(t), -Math.sin(t) * sd])
      // Small circles about the north–south axis.
      curve((t) => [sd * Math.cos(t), cd, -sd * Math.sin(t)])
      curve((t) => [sd * Math.cos(t), -cd, -sd * Math.sin(t)])
    }
    P.rule(0, -R, 0, R); P.rule(-R, 0, R, 0)
  } else {
    const c = 0.05 * R
    P.rule(-c, 0, c, 0); P.rule(0, -c, 0, c)
  }
  for (let d = 0; d < 360; d += 10) {
    const [xa, za] = polar(0, 0, d, R), [xb, zb] = polar(0, 0, d, R * (d % 90 ? 1.03 : 1.06))
    P.rule(xa, za, xb, zb)
  }
  const [nx, nz] = polar(0, 0, 0, R * 1.14)
  P.text(nx, nz, 'N', size, 'middle', 'middle')
  P.text(R * 0.98, R * 0.98, `n = ${poles.length / 3}`, size * 0.75, 'end', 'top')
  return chartLayers('Stereonet', P, 'Stereonet-Poles')
}
