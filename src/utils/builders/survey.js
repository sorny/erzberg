/**
 * Map conventions: Bedding, Slope Classes, Runout, Glacier, and the surveyor's
 * Profile Sheet.
 *
 * The first four read the ground in real metres, through the same
 * `groundMetres` the walking and looking modes use, because each answers in a
 * unit a map reader already knows: a dip, a slope and a reach angle in degrees,
 * and a contour interval on the ice in metres. The Profile Sheet is a drawing
 * convention rather than a measurement, and reads the plate's own heights.
 */
import { boxBlur, sampleBilinear } from '../terrain'
import { smoothField } from '../sunHours'
import { computeVertexColor, hexToRgb } from '../colorUtils'
import { groundMetres } from './ground.js'
import { F32List, drapeEdge, hatchWhere, joinLayers, simplifyFlat, traceLevelSet } from './shared.js'

const RAD = Math.PI / 180

// ─── Bedding ─────────────────────────────────────────────────────────────────

/**
 * Where tilted layers of rock would crop out.
 *
 * Contours cut the ground with level planes. A bed is a plane that dips at
 * `dip` degrees towards the bearing `azimuth`, so its height falls by
 * s · tan(dip) with the distance s along that bearing. The bed meets the
 * ground where h + s · tan(dip) is constant, and the traces are the level set
 * of that field. Where a trace crosses a valley it bends into a V, pointing
 * down the dip when the bed dips downstream more steeply than the valley
 * falls: the rule of V's, read off a geological map.
 *
 * Heights and distances are true metres and never the exaggerated relief, so a
 * dip of 30° is 30° on the ground whatever the height slider says.
 *
 * `marker` > 0 draws every Nth bed as a second pen, the way a map picks out a
 * seam or a marker horizon.
 */
export function buildBedding(terrain, p, o) {
  const { gridMask, rows, cols } = terrain
  const n = rows * cols
  const { heights, cellX, cellY } = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const tn = Math.tan(Math.max(0, Math.min(85, o.dip ?? 25)) * RAD)
  // The dip direction as a bearing: north is row 0.
  const az = (o.azimuth ?? 135) * RAD
  const dc = Math.sin(az) * cellX, dr = -Math.cos(az) * cellY

  const f = new Float32Array(n)
  let lo = Infinity, hi = -Infinity
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const v = heights[i] + (c * dc + r * dr) * tn
      f[i] = v
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
  }
  if (!(hi > lo)) return null
  // traceLevelSet reads a negative value as no ground, so the field starts at 0.
  for (let i = 0; i < n; i++) f[i] = gridMask[i] ? f[i] - lo : -1

  const beds = Math.max(2, Math.min(300, Math.round(o.beds ?? 40)))
  const step = (hi - lo) / beds
  const shift = (((o.offset ?? 0) % 1) + 1) % 1 * step
  const every = Math.max(0, Math.round(o.marker ?? 0))
  const plain = [], marked = []
  for (let k = 0; k <= beds; k++) {
    const level = shift + k * step
    if (level <= 0 || level >= hi - lo) continue
    ;(every > 0 && k % every === 0 ? marked : plain).push(level)
  }
  const smooth = Math.max(0, Math.min(25, Math.round(o.smoothing ?? 2)))
  const main = traceLevelSet(terrain, p, f, plain, smooth)
  if (!marked.length) return main
  const seamInk = { ...p, lineColor: o.markerColor ?? p.lineColor }
  return { 'Bedding-Beds': main, 'Bedding-Marker': traceLevelSet(terrain, seamInk, f, marked, smooth) }
}

// ─── Slope Classes ───────────────────────────────────────────────────────────

/**
 * Slope in degrees per cell, from central differences in true metres, and −1
 * off the ground. A neighbour in NoData reads as the cell itself, so the edge
 * of a clipped selection is not a cliff.
 */
function slopeDegrees(terrain, ground) {
  const { gridMask, rows, cols } = terrain
  const { heights, cellX, cellY } = ground
  const h = (r, c, i) => {
    const k = Math.max(0, Math.min(rows - 1, r)) * cols + Math.max(0, Math.min(cols - 1, c))
    return gridMask[k] ? heights[k] : heights[i]
  }
  const deg = new Float32Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { deg[i] = -1; continue }
      const gx = (h(r, c + 1, i) - h(r, c - 1, i)) / (2 * cellX)
      const gy = (h(r + 1, c, i) - h(r - 1, c, i)) / (2 * cellY)
      deg[i] = Math.atan(Math.hypot(gx, gy)) / RAD
    }
  }
  return deg
}

/**
 * Steep ground in three bands, each hatched and each its own pen.
 *
 * The bands are the ones Alpine avalanche maps use: 30–35°, 35–40° and over
 * 40°, below which slab avalanches are rare. The slope is measured in true
 * metres, from central differences over the raster, and blurred by `radius`
 * so a band's edge follows the landform and not the noise in the data.
 *
 * The lightest band takes a hatch at twice the spacing, the middle one at the
 * spacing, and the steepest a cross-hatch at the spacing, so the three read
 * apart with one pen as well as with three.
 *
 * The share of the ground in each band rides back to the panel as `note`.
 */
export function buildSlopeClass(terrain, p, o) {
  const { gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const deg = slopeDegrees(terrain, groundMetres(terrain, p, o.cellMetres, o.relief).ground())
  const field = smoothField(deg, cols, rows, o.radius ?? 1, gridMask)

  const [a, b, c] = [o.low ?? 30, o.mid ?? 35, o.high ?? 40].sort((x, y) => x - y)
  let ground = 0, inA = 0, inB = 0, inC = 0
  for (let i = 0; i < n; i++) {
    const v = field[i]
    if (v < 0) continue
    ground++
    if (v >= c) inC++; else if (v >= b) inB++; else if (v >= a) inA++
  }
  const note = ground ? { low: inA / ground, mid: inB / ground, high: inC / ground } : null

  const pitch = Math.max(0.5, (o.spacing ?? 4) / scl)
  const angle = o.angle ?? 45
  const out = {
    'SlopeClass-Low':  { ...hatchWhere(terrain, p, (i) => field[i] >= a && field[i] < b, [angle], pitch * 2), note },
    'SlopeClass-Mid':  { ...hatchWhere(terrain, p, (i) => field[i] >= b && field[i] < c, [angle], pitch), note },
    'SlopeClass-High': { ...hatchWhere(terrain, p, (i) => field[i] >= c, [angle, angle + 90], pitch), note },
  }
  // The outline goes with the lightest band, where it is the edge of the ink.
  if (o.outline) out['SlopeClass-Low'] = { ...joinLayers(out['SlopeClass-Low'], traceLevelSet(terrain, p, field, [a], 2)), note }
  return out
}

// ─── Runout ──────────────────────────────────────────────────────────────────

/**
 * Where falling rock stops.
 *
 * Release zones are the ground steeper than `release` degrees. From seeds on a
 * grid inside them, a block walks down the fall line of the ground in true
 * metres. It stops where the line from its release point to where it is now
 * is flatter than `reach` degrees: the reach angle, or Fahrböschung, that
 * Alpine hazard maps use for rockfall. A higher release point therefore runs
 * farther over the same ground than a lower one.
 *
 * Paths from neighbouring seeds meet in the same gully and would plot the same
 * line many times. The first path through a cell owns it, and a later one goes
 * on walking there without drawing, so that it still stops where its own
 * release height says. It draws again where it runs past the end of the path
 * it joined. Seeds run highest first, so the longest paths claim the gullies.
 *
 * On flat ground the block keeps the heading it had, because the reach angle
 * and not the slope decides where it stops. Each stop is a short tick across
 * the fall line, and the ticks make a front along the foot of each wall. A walk
 * that leaves the data does not stop, and gets no tick.
 *
 * Two pens: the paths with their stops, and the release zones, outlined and
 * hatched. The number of paths and the longest run ride back as `note`.
 */
export function buildRunout(terrain, p, o) {
  const { gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const sMask = terrain.hasNoData ? gridMask : null
  const ground = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const { cellX, cellY } = ground
  const release = Math.max(5, Math.min(85, o.release ?? 40))
  const reach = Math.max(1, Math.min(release - 1, o.reach ?? 32))
  const radius = Math.max(0, o.radius ?? 1)
  const field = smoothField(slopeDegrees(terrain, ground), cols, rows, radius, gridMask)
  // The walk reads the same blurred ground, or it steps round every bump in the
  // data that the release zones were blurred to ignore.
  const hs = radius > 0 ? boxBlur(ground.heights, cols, rows, radius, sMask) : ground.heights
  const at = (fr, fc) => sampleBilinear(hs, sMask, rows, cols, fr, fc)

  const pitch = Math.max(1, (o.spacing ?? 6) / scl)
  const seeds = []
  for (let rf = 0.5, row = 0; rf < rows - 1; rf += pitch, row++) {
    for (let cf = 0.5 + (row % 2) * pitch / 2; cf < cols - 1; cf += pitch) {
      const i = Math.round(rf) * cols + Math.round(cf)
      if (gridMask[i] && field[i] >= release) seeds.push(i)
    }
  }
  seeds.sort((a, b) => hs[b] - hs[a])

  const tanReach = Math.tan(reach * RAD)
  const stepM = 0.5 * Math.min(cellX, cellY)
  const maxSteps = 4 * (rows + cols)
  const owner = new Int32Array(n), ticked = new Uint8Array(n)
  const out = { positions: new F32List(), colors: new F32List() }
  const tick = Math.max(1.5, pitch * 0.5)
  let id = 0, longest = 0
  for (const seed of seeds) {
    if (owner[seed]) continue
    id++
    let fr = Math.floor(seed / cols), fc = seed % cols, dist = 0, stopped = false, ux = 0, uy = 0
    const z0 = at(fr, fc)
    if (z0 !== z0) continue
    for (let s = 0; s < maxSteps; s++) {
      const gx = (at(fr, fc + 0.5) - at(fr, fc - 0.5)) / cellX
      const gy = (at(fr + 0.5, fc) - at(fr - 0.5, fc)) / cellY
      const mag = Math.hypot(gx, gy)
      // NaN is a tap in NoData, and the walk ends. On flat ground the block
      // keeps its heading, because the reach angle, not the slope, stops it.
      if (mag !== mag) break
      if (mag > 1e-6) { ux = -gx / mag; uy = -gy / mag }
      else if (!ux && !uy) { stopped = true; break }
      const nfc = fc + ux * stepM / cellX, nfr = fr + uy * stepM / cellY
      if (nfr < 0 || nfc < 0 || nfr > rows - 1 || nfc > cols - 1) break
      const k = Math.round(nfr) * cols + Math.round(nfc)
      if (!gridMask[k]) break
      const z = at(nfr, nfc)
      if (z !== z) break
      if (owner[k] === 0 || owner[k] === id) {
        owner[k] = id
        drapeEdge(out, terrain, p, sMask, fc, fr, nfc, nfr, Math.atan2(uy, ux))
      }
      fr = nfr; fc = nfc; dist += stepM
      if (dist > 2 * stepM && (z0 - z) / dist < tanReach) { stopped = true; break }
    }
    if (dist > longest) longest = dist
    const k = Math.round(fr) * cols + Math.round(fc)
    if (!stopped || ticked[k]) continue
    ticked[k] = 1
    // Across the fall line, in cells.
    let tc = -uy / cellX, tr = ux / cellY
    const tm = Math.hypot(tc, tr) || 1
    tc = tc / tm * tick; tr = tr / tm * tick
    drapeEdge(out, terrain, p, sMask, fc - tc, fr - tr, fc + tc, fr + tr, Math.atan2(tr, tc))
  }
  const note = { paths: id, longest }
  const paths = { positions: out.positions.toArray(), colors: out.colors.toArray(), note }
  if (!o.zone) return paths

  const zoneInk = { ...p, lineColor: o.zoneColor ?? p.lineColor }
  let zone = traceLevelSet(terrain, zoneInk, field, [release], 2)
  if (o.hatch) zone = joinLayers(zone, hatchWhere(terrain, zoneInk, (i) => field[i] >= release, [o.angle ?? 45], Math.max(0.5, pitch / 2)))
  return { 'Runout-Paths': paths, 'Runout-Release': { ...zone, note } }
}

// ─── Glacier ─────────────────────────────────────────────────────────────────

/**
 * Ice on the high ground, as the Swiss national map draws it.
 *
 * Ice lies above the `snowline` (a share of the height range, from low to
 * high) on ground flatter than `steep` degrees. A rock wall too steep to hold
 * ice stays out of it. The 0/1 field is blurred by `radius`, so the edge of the
 * ice follows the landform and not single cells.
 *
 * Three pens, as on the map:
 *  - Ice: the edge of the ice, and contours on the ice every `interval` true
 *    metres, in the ice colour. Off the ice there are none; Contours draws the
 *    rock.
 *  - Crevasses: short arcs across the fall line, on a staggered grid, where
 *    the ice is steeper than `crack` degrees. They grow longer as the ice
 *    steepens toward `steep`, the way an icefall breaks up.
 *  - Moraine: small rings in a band just outside the edge, where the ice drops
 *    its rock.
 *
 * The share of the ground under ice and the snowline in metres ride back to
 * the panel as `note`.
 */
export function buildGlacier(terrain, p, o) {
  const { gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const sMask = terrain.hasNoData ? gridMask : null
  const ground = groundMetres(terrain, p, o.cellMetres, o.relief).ground()
  const { heights, cellX, cellY } = ground
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) if (gridMask[i]) { if (heights[i] < lo) lo = heights[i]; if (heights[i] > hi) hi = heights[i] }
  if (!(hi > lo)) return null
  const snow = lo + Math.max(0, Math.min(1, o.snowline ?? 0.7)) * (hi - lo)
  const steep = Math.max(5, Math.min(80, o.steep ?? 35))
  const crack = Math.max(0, Math.min(steep - 1, o.crack ?? 15))
  const slope = slopeDegrees(terrain, ground)

  const ice0 = new Float32Array(n)
  for (let i = 0; i < n; i++) ice0[i] = gridMask[i] && heights[i] >= snow && slope[i] < steep ? 1 : 0
  const radius = Math.max(0, o.radius ?? 2)
  const ice = radius > 0 ? boxBlur(ice0, cols, rows, radius, sMask) : ice0
  let under = 0, groundCells = 0
  for (let i = 0; i < n; i++) if (gridMask[i]) { groundCells++; if (ice[i] >= 0.5) under++ }
  const note = { share: groundCells ? under / groundCells : 0, snowline: snow }
  if (!under) return null

  const iceInk = { ...p, lineColor: o.iceColor ?? p.lineColor }
  // Contours on the ice only: traceLevelSet reads a negative value as no ground.
  const onIce = new Float32Array(n)
  for (let i = 0; i < n; i++) onIce[i] = ice[i] >= 0.5 ? heights[i] - lo + 1 : -1
  const interval = Math.max(1, o.interval ?? 50)
  const levels = []
  for (let h = Math.ceil(snow / interval) * interval; h < hi && levels.length < 400; h += interval) levels.push(h - lo + 1)
  const edge = traceLevelSet(terrain, iceInk, ice, [0.5], 2)
  const iceLayer = levels.length ? joinLayers(edge, traceLevelSet(terrain, iceInk, onIce, levels, 2)) : edge

  // Crevasses: arcs across the fall line of the ice.
  const hs = (r, c) => sampleBilinear(heights, sMask, rows, cols, r, c)
  const P = Math.max(1, (o.spacing ?? 6) / scl)
  const cracks = { positions: new F32List(), colors: new F32List() }
  for (let rf = P / 2, row = 0; rf < rows - 1; rf += P, row++) {
    for (let cf = P / 2 + (row % 2) * P / 2; cf < cols - 1; cf += P) {
      const i = Math.round(rf) * cols + Math.round(cf)
      if (!gridMask[i] || ice[i] < 0.8 || slope[i] < crack) continue
      const gx = (hs(rf, cf + 0.5) - hs(rf, cf - 0.5)) / cellX, gy = (hs(rf + 0.5, cf) - hs(rf - 0.5, cf)) / cellY
      const m = Math.hypot(gx, gy)
      if (!(m > 0)) continue
      // Downhill and across, in cells.
      let dc = -gx / m / cellX, dr = -gy / m / cellY
      const dm = Math.hypot(dc, dr); dc /= dm; dr /= dm
      const tc = -dr, tr = dc
      const L = P * (0.45 + 0.6 * Math.min(1, (slope[i] - crack) / ((steep - crack) || 1)))
      let pc = cf - tc * L / 2, pr = rf - tr * L / 2
      for (let s = 1; s <= 6; s++) {
        const t = s / 6, bow = 4 * t * (1 - t) * 0.3 * L
        const qc = cf + tc * L * (t - 0.5) + dc * bow, qr = rf + tr * L * (t - 0.5) + dr * bow
        drapeEdge(cracks, terrain, iceInk, sMask, pc, pr, qc, qr, Math.atan2(qr - pr, qc - pc))
        pc = qc; pr = qr
      }
    }
  }
  const out = {
    'Glacier-Ice': { ...iceLayer, note },
    'Glacier-Crevasses': { positions: cracks.positions.toArray(), colors: cracks.colors.toArray(), note },
  }
  if (!o.moraine) return out

  // Moraine: rings in the band just outside the edge.
  const mp = Math.max(0.75, P / 2), rad = 0.22 * mp
  const dots = { positions: new F32List(), colors: new F32List() }
  for (let rf = mp / 2, row = 0; rf < rows - 1; rf += mp, row++) {
    for (let cf = mp / 2 + (row % 2) * mp / 2; cf < cols - 1; cf += mp) {
      const i = Math.round(rf) * cols + Math.round(cf)
      if (!gridMask[i] || ice[i] < 0.12 || ice[i] >= 0.45) continue
      let pc = cf + rad, pr = rf
      for (let s = 1; s <= 6; s++) {
        const a = s / 6 * 2 * Math.PI, qc = cf + Math.cos(a) * rad, qr = rf + Math.sin(a) * rad
        drapeEdge(dots, terrain, p, sMask, pc, pr, qc, qr, a)
        pc = qc; pr = qr
      }
    }
  }
  out['Glacier-Moraine'] = { positions: dots.positions.toArray(), colors: dots.colors.toArray(), note }
  return out
}

// ─── Profile Sheet ───────────────────────────────────────────────────────────

/**
 * A surveyor's profile sheet: the ground read along parallel transects, drawn
 * as a stack of profiles over a rule at every station.
 *
 * The long band reads `count` transects along the plate's longer side, evenly
 * spaced across it. With `bands` at 2, a second band below reads half as many
 * along the shorter side, the cross profiles, at the same horizontal scale, so
 * it ends as much short of the right edge as the plate is narrower than long.
 *
 * What a profile plots, `plot`:
 *  - `change`: the elevation change so far, up and down alike, from the height
 *    of its first sample. It rises everywhere but on the flat, and steeply
 *    where the ground is rough.
 *  - `climb`: the ascent so far, which stays level on every descent.
 *  - `height`: the ground itself.
 * The profiles in a band share one scale, so they cross and bundle as they do
 * on paper. `smooth` blurs each transect first, so a sum of small steps does
 * not count the noise in the raster as climb.
 *
 * Every length on the sheet is in steps, a 500th of its width, whatever the
 * raster's resolution: each transect is read at one sample per step, so the
 * resolution slider does not change the drawing.
 *
 * A station is where a profile bends: a vertex that Douglas–Peucker keeps at a
 * tolerance of `tolerance` steps, gathered over every profile in the band. So the rules crowd where the ground is rough and thin out on the
 * flat. Each profile is drawn straight from station to station, and a short
 * level mark (`node`) sits on it wherever it bends itself.
 *
 * The rules, the frame, `grid` divisions and the ticks (`tick`) past the frame
 * are a second pen, `ProfileSheet-Rules`. With `numbers`, the stations are
 * counted from the left and a number hangs under each one there is room for,
 * so a cluster of rules shares one, as on a hand-drawn sheet. The rules carry
 * them as anchors, and `useScaleLabels` letters them as `ProfileSheet-Numbers`.
 * The sheet lies flat at the height of the highest point, like Waveform, so a
 * plan view shows it alone.
 */
export function buildProfileSheet(terrain, p, o) {
  const { grid, gridMask, rows, cols, halfW, halfH, maxElev, hasNoData } = terrain
  if (rows < 3 || cols < 3) return null
  const sMask = hasNoData ? gridMask : null
  const plot = o.plot ?? 'change'
  const smooth = Math.max(0, Math.round(o.smooth ?? 8))
  const divisions = Math.max(1, Math.round(o.grid ?? 4))
  const count = Math.max(1, Math.round(o.count ?? 12))
  const twoBands = (o.bands ?? 2) >= 2
  // The long side reads first; both bands share its horizontal scale, a step
  // of the sheet's width, and `per` grid cells of the raster to a step.
  const STEPS = 500
  const wide = cols >= rows
  const nLong = wide ? cols : rows, nShort = wide ? rows : cols
  const hs = (2 * halfW) / STEPS
  const per = (nLong - 1) / STEPS
  const tol = Math.max(0.05, o.tolerance ?? 1.5)
  const tick = Math.max(0, o.tick ?? 5) * hs
  const node = Math.max(0, o.node ?? 4) * hs
  const y = maxElev
  const ruleInk = hexToRgb(p.lineColor)

  const lines = new F32List(), lineColors = new F32List()
  const rules = new F32List(), ruleColors = new F32List()
  const anchors = []
  const size = 4.5 * hs
  const rule = (x0, z0, x1, z1) => { rules.push6(x0, y, z0, x1, y, z1); ruleColors.pushRgb2(ruleInk) }

  /**
   * `k` transects along the long side (`along` true) or the short side, as
   * plotted values with the samples that have ground. A gap in the data is
   * held across for the running sum, and left out of the drawing.
   */
  const transects = (along, k) => {
    const n = along ? STEPS + 1 : Math.max(2, Math.round((nShort - 1) / per) + 1)
    const m = along ? nShort : nLong
    const out = []
    for (let j = 0; j < k; j++) {
      const off = (j + 0.5) / k * (m - 1)
      const h = new Float32Array(n), ok = new Uint8Array(n)
      let last = NaN, first = -1
      for (let i = 0; i < n; i++) {
        // `along` the long side is along the columns on a wide plate.
        const at = Math.min(i * per, (along ? nLong : nShort) - 1)
        const [r, c] = (along === wide) ? [off, at] : [at, off]
        const v = sampleBilinear(grid, sMask, rows, cols, r, c)
        if (v === v) { ok[i] = 1; last = v; if (first < 0) first = i }
        h[i] = last
      }
      if (first < 0) continue
      for (let i = 0; i < first; i++) h[i] = h[first]
      const s = smooth > 0 ? boxBlur(h, n, 1, smooth) : h
      const v = new Float32Array(n)
      if (plot === 'height') v.set(s)
      else {
        v[0] = s[0]
        for (let i = 1; i < n; i++) {
          const d = s[i] - s[i - 1]
          v[i] = v[i - 1] + (plot === 'climb' ? Math.max(0, d) : Math.abs(d))
        }
      }
      out.push({ v, ok })
    }
    return out
  }

  /** One band of the sheet, between `zTop` and `zBot`, from the left edge. */
  const band = (profiles, zTop, zBot) => {
    if (!profiles.length) return
    const n = profiles[0].v.length
    let lo = Infinity, hi = -Infinity
    for (const { v, ok } of profiles) for (let i = 0; i < n; i++) if (ok[i]) { if (v[i] < lo) lo = v[i]; if (v[i] > hi) hi = v[i] }
    if (!(hi > lo)) return
    const pad = (zBot - zTop) * 0.06
    const zOf = (a) => zBot - pad - (a - lo) / (hi - lo) * (zBot - zTop - 2 * pad)
    const xOf = (i) => -halfW + i * hs
    const shade = (a) => computeVertexColor((a - lo) / (hi - lo), 0, 0, p)

    // Stations: the bends of every profile, found per run of data, in cells.
    const station = new Uint8Array(n)
    station[0] = 1; station[n - 1] = 1
    const bends = profiles.map(({ v, ok }) => {
      const own = new Uint8Array(n)
      for (let i = 0; i < n;) {
        while (i < n && !ok[i]) i++
        let j = i
        while (j < n && ok[j]) j++
        if (j - i >= 2) {
          const pts = new Float64Array((j - i) * 2)
          for (let q = i; q < j; q++) { pts[2 * (q - i)] = q; pts[2 * (q - i) + 1] = zOf(v[q]) / hs }
          const kept = simplifyFlat(pts, tol)
          for (let q = 0; q < kept.length; q += 2) { const at = Math.round(kept[q]); own[at] = 1; station[at] = 1 }
        }
        i = j
      }
      return own
    })

    // The rules: a station rule through the frame with a tick past it at each
    // end, the frame's top and bottom, and the grid between them.
    const at = []
    for (let i = 0; i < n; i++) if (station[i]) at.push(i)
    for (const i of at) rule(xOf(i), zTop - tick, xOf(i), zBot + tick)
    rule(xOf(0), zTop, xOf(n - 1), zTop)
    rule(xOf(0), zBot, xOf(n - 1), zBot)
    for (let g = 1; g < divisions; g++) {
      const z = zTop + (zBot - zTop) * g / divisions
      rule(xOf(0), z, xOf(n - 1), z)
    }
    if (o.numbers) {
      let last = -Infinity
      at.forEach((i, k) => {
        if (xOf(i) - last < 2.4 * size) return
        anchors.push({ x: xOf(i), y, z: zBot + tick + 1.5 * hs, text: String(k + 1), size, align: 'middle', valign: 'top' })
        last = xOf(i)
      })
    }

    // Each profile straight from station to station, and a level mark on its
    // own bends.
    profiles.forEach(({ v, ok }, k) => {
      for (let a = 0; a + 1 < at.length; a++) {
        const i0 = at[a], i1 = at[a + 1]
        if (!ok[i0] || !ok[i1]) continue
        lines.push6(xOf(i0), y, zOf(v[i0]), xOf(i1), y, zOf(v[i1]))
        lineColors.pushRgb(shade(v[i0])); lineColors.pushRgb(shade(v[i1]))
      }
      if (node > 0) {
        for (let i = 0; i < n; i++) {
          if (!bends[k][i] || !ok[i]) continue
          const z = zOf(v[i])
          lines.push6(xOf(i) - node / 2, y, z, xOf(i) + node / 2, y, z)
          lineColors.pushRgb2(shade(v[i]))
        }
      }
    })
  }

  const depth = 2 * halfH
  if (twoBands) {
    band(transects(true, count), -halfH + depth * 0.04, -halfH + depth * 0.56)
    band(transects(false, Math.max(1, Math.round(count / 2))), -halfH + depth * 0.64, -halfH + depth * 0.96)
  } else {
    band(transects(true, count), -halfH + depth * 0.05, -halfH + depth * 0.95)
  }
  if (!lines.length && !rules.length) return null
  return {
    ProfileSheet: { positions: lines.toArray(), colors: lineColors.toArray() },
    'ProfileSheet-Rules': { positions: rules.toArray(), colors: ruleColors.toArray(), scaleAnchors: anchors.length ? anchors : null },
  }
}
