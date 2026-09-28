/**
 * Tone modes: Rock & Scree, Stipple, Sprite, Reticulation, Crossings, Truchet, Single Line, Roughness Mesh.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import Delaunator from 'delaunator'
import { cellElev, boxBlur, sampleBilinear } from '../terrain'
import { hexToRgb, computeVertexColor } from '../colorUtils'
import { F32List, U32List, drapeEdge, inElevCut, lambertDarkness, mulberry32, normElev, quantiseTiers } from './shared.js'

// ─── Truchet ─────────────────────────────────────────────────────────────────

/**
 * Quarter-arc tiles, turned by the ground.
 *
 * Smith's tile has two quarter circles at opposite corners, and its two
 * orientations are the whole alphabet. Tiled one way throughout, the arcs link
 * into chains along one diagonal; tiled the other way, along the other. So the
 * sign of ∂z/∂x · ∂z/∂y picks the diagonal: `fall` lays the chains down the
 * slope, `contour` lays them across it, and `random` is the classic pattern,
 * seeded.
 *
 * The gradient is read across the whole tile rather than one cell, so a tile
 * answers for the ground it covers. Tiles flatter than `threshold` (slope
 * against its 95th percentile) are left blank, and the landform shows as the
 * shape of what is drawn.
 */
export function buildTruchet(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, gridSlopes } = terrain
  const sMask = terrain.hasNoData ? gridMask : null
  const out = { positions: new F32List(), colors: new F32List() }
  const cell = Math.max(2, (o.spacing ?? 8) / scl)
  const ref = slopePercentile(terrain, 0.95)
  const align = o.align ?? 'fall'
  const rng = mulberry32(((o.seed ?? 5) * 2654435761) >>> 0)
  const R = cell / 2, segs = Math.max(4, Math.min(16, Math.round(cell * 0.8)))
  const at = (fr, fc) => sampleBilinear(grid, sMask, rows, cols,
    Math.max(0, Math.min(rows - 1, fr)), Math.max(0, Math.min(cols - 1, fc)))

  const arc = (cx, cy, a0) => {
    let pc = cx + R * Math.cos(a0), pr = cy + R * Math.sin(a0)
    for (let k = 1; k <= segs; k++) {
      const a = a0 + (Math.PI / 2) * (k / segs)
      const nc = cx + R * Math.cos(a), nr = cy + R * Math.sin(a)
      drapeEdge(out, terrain, p, sMask, pc, pr, nc, nr, a)
      pc = nc; pr = nr
    }
  }
  for (let r0 = 0; r0 + cell <= rows - 1 + 1e-9; r0 += cell) {
    for (let c0 = 0; c0 + cell <= cols - 1 + 1e-9; c0 += cell) {
      const mr = r0 + R, mc = c0 + R
      const mi = Math.round(mr) * cols + Math.round(mc)
      if (!gridMask[mi]) continue
      if (gridSlopes[mi] / ref < (o.threshold ?? 0.12)) { rng(); continue }
      const gx = at(mr, c0 + cell) - at(mr, c0), gz = at(r0 + cell, mc) - at(r0, mc)
      const same = gx * gz > 0
      const first = align === 'random' ? rng() < 0.5 : (align === 'contour' ? same : !same)
      if (align !== 'random') rng()
      if (first) { arc(c0, r0, 0); arc(c0 + cell, r0 + cell, Math.PI) }
      else { arc(c0 + cell, r0, Math.PI / 2); arc(c0, r0 + cell, Math.PI * 1.5) }
    }
  }
  return { positions: out.positions.toArray(), colors: out.colors.toArray() }
}

/** The slope below which `q` of the ground lies, for normalising against. */
function slopePercentile(terrain, q) {
  const { gridMask, gridSlopes, maxSlope } = terrain
  const BINS = 256, hist = new Uint32Array(BINS), top = maxSlope || 1
  let valid = 0
  for (let i = 0; i < gridSlopes.length; i++) if (gridMask[i]) { hist[Math.min(BINS - 1, Math.floor((gridSlopes[i] / top) * BINS))]++; valid++ }
  let acc = 0
  for (let b = 0; b < BINS; b++) { acc += hist[b]; if (acc >= valid * q) return ((b + 1) / BINS) * top }
  return top
}

// ─── Swiss rock & scree ──────────────────────────────────────────────────────

/**
 * Swisstopo-style alpine rock depiction, returned as two sub-layers:
 *  • Swiss-Rock  — cliff hachures: short downslope strokes (perpendicular to
 *    the contours) on cells steeper than the cliff threshold, with a little
 *    seeded jitter for a hand-drawn feel.
 *  • Swiss-Scree — slope-graded debris dots (isPoints) on the moderately steep
 *    band below the cliff threshold, denser toward the cliffs.
 */
export function buildSwissRockScree(terrain, p, spacing, threshold, length, screeDensity) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const rng = mulberry32(((p.seedSwiss ?? 42) * 2654435761 + 0x9e3779b9) >>> 0)

  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const cliffT = Math.max(0.02, threshold ?? 0.45)
  const screeT = cliffT * 0.45                       // lower edge of the scree band
  const dens  = Math.max(0, Math.min(1, screeDensity ?? 0.5))
  const eps   = Math.max(0.001, scl * 0.003)         // stipple-style dot half-length
  const maxS  = maxSlope || 1
  // Solid raster ⇒ plain bilinear; see buildAngleLines.
  const sMask = terrain.hasNoData ? gridMask : null

  const rockPos = new F32List(), rockCol = new F32List()
  const screePos = new F32List(), screeCol = new F32List()

  for (let r = 1; r < rows - 1; r += step) {
    for (let c = 1; c < cols - 1; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const slopeNorm = gridSlopes[i] / maxS
      if (slopeNorm < screeT) continue

      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const normE = normElev(elev, minElev, maxElev)
      const wx = c * scl - halfW, wz = r * scl - halfH

      if (slopeNorm >= cliffT) {
        // Cliff hachure: stroke pointing downslope, longer on steeper rock.
        const gx = grid[i + 1] - grid[i - 1]
        const gz = grid[i + cols] - grid[i - cols]
        const mag = Math.sqrt(gx * gx + gz * gz)
        if (mag < 1e-9) continue
        const ux = gx / mag, uz = gz / mag           // +gradient = uphill; stroke goes downhill
        const len = (length ?? 1) * scl * step * (0.6 + slopeNorm * 1.2)
        // Slight seeded perpendicular wobble — engraver's hand, reproducible.
        const j = (rng() - 0.5) * 0.35
        const sx = -ux * len - uz * len * j, sz = -uz * len + ux * len * j
        // The steepest ground is exactly what a selection edge cuts through, so
        // the far end of a cliff stroke is the one most likely to land outside
        // the data — where it would drape on the NoData floor and read as a
        // pillar. Shorten it until it is back on ground; drop it if it never is.
        let ex = 0, ez = 0, e1 = NaN
        for (let f = 1; f > 0.2; f -= 0.25) {
          ex = wx + sx * f; ez = wz + sz * f
          const b1 = sampleBilinear(grid, sMask, rows, cols,
                                    Math.max(0, Math.min(rows - 1, (ez + halfH) / scl)),
                                    Math.max(0, Math.min(cols - 1, (ex + halfW) / scl)))
          if (b1 === b1) { e1 = (b1 - 0.5) * 100 * elevScale; break }
        }
        if (e1 !== e1) continue
        rockPos.push6(wx, elev, wz, ex, e1, ez)
        const col = computeVertexColor(normE, slopeNorm, Math.atan2(gz, gx), p)
        rockCol.pushRgb2(col)
      } else if (rng() < dens * ((slopeNorm - screeT) / (cliffT - screeT))) {
        // Scree dot: jittered within the cell, denser approaching the cliffs.
        const jc = c + (rng() - 0.5) * step, jr = r + (rng() - 0.5) * step
        const sx2 = jc * scl - halfW, sz2 = jr * scl - halfH
        const sb = sampleBilinear(grid, sMask, rows, cols,
                                  Math.max(0, Math.min(rows - 1, jr)),
                                  Math.max(0, Math.min(cols - 1, jc)))
        if (sb !== sb) continue          // jittered clean off the data
        const se = (sb - 0.5) * 100 * elevScale
        screePos.push6(sx2 - eps, se, sz2, sx2 + eps, se, sz2)
        const col = computeVertexColor(normElev(se, minElev, maxElev), slopeNorm, 0, p)
        screeCol.pushRgb2(col)
      }
    }
  }

  return {
    'Swiss-Rock':  { positions: rockPos.toArray(),  colors: rockCol.toArray() },
    'Swiss-Scree': { positions: screePos.toArray(), colors: screeCol.toArray(), isPoints: true },
  }
}

// ─── Stipple ──────────────────────────────────────────────────────────────────

/**
 * Stipple dots, placed by rejection sampling against a density field.
 *
 * A candidate is generated per grid cell and kept with probability equal to the
 * local density, so `spacing` sets the *maximum* dot count and the field decides
 * how much of it survives. `densityMode` chooses what drives that field
 * (elevation, slope, …) and `gamma` bends it: above 1 concentrates dots into the
 * densest areas, below 1 spreads them toward an even wash.
 *
 * `jitter` displaces the candidate within its cell *before* the density is read,
 * so it moves the sample as well as the dot. At 0 the output is a visible regular
 * lattice — the grid the candidates came from — so some jitter is what makes it
 * read as stippling rather than as a halftone screen.
 *
 * Returned as `isPoints`, so the dispatcher skips occlusion curtains for it:
 * a dot has no length to hang a curtain from.
 */
export function buildStipple(terrain, p, spacing, densityMode, gamma, jitter) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const step = Math.max(1, Math.round((spacing ?? 0.5) / scl))
  const eps = Math.max(0.001, scl * 0.003)
  const jAmt = (jitter ?? 0.8) * step
  const gam  = gamma ?? 1.2
  const dm   = densityMode ?? 'slope'
  const positions = new F32List(), colors = new F32List()
  // Seeded so a given seed always produces the identical dot pattern.
  const rng = mulberry32(((p.seedStipple ?? 42) * 2654435761) >>> 0)

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const jr = r + (rng() - 0.5) * jAmt
      const jc = c + (rng() - 0.5) * jAmt
      const ri = Math.max(0, Math.min(rows - 1, Math.floor(jr)))
      const ci = Math.max(0, Math.min(cols - 1, Math.floor(jc)))
      if (!gridMask[ri * cols + ci]) continue

      const elev = cellElev(grid, ri, ci, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue

      const normE = normElev(elev, minElev, maxElev)
      const slope = gridSlopes[ri * cols + ci] / (maxSlope || 1)

      let density
      if      (dm === 'elevation') density = normE
      else if (dm === 'invElev')   density = 1 - normE
      else if (dm === 'invSlope')  density = 1 - slope
      else                         density = slope

      density = Math.pow(Math.max(0, Math.min(1, density)), gam)
      if (rng() > density) continue

      const wx = jc * scl - halfW
      const wz = jr * scl - halfH
      positions.push6(wx - eps, elev, wz, wx + eps, elev, wz)
      const col = computeVertexColor(normE, slope, 0, p)
      colors.pushRgb2(col)
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray(), isPoints: true }
}

/**
 * Each quantised tier drawn as an isometric block.
 *
 * Bitplane draws the *boundaries* between plateaus; this draws the plateaus
 * themselves, one cuboid per lattice cell — a top face at the snapped tier
 * height, and side faces dropped only where the neighbour is lower. Under an
 * orthographic camera at 30° that is an arcade tile map.
 *
 * The side walls go only to the *neighbour's* tier rather than to a common
 * floor. Dropping every block to the base plate would bury the entire stack in
 * one solid mass of vertical lines: what makes a voxel landscape legible is that
 * you see exactly one riser per step, and its height is the step.
 *
 * The top faces ship as a `lids` mesh, so a block reads as a solid plate rather
 * than a wireframe square and the stack self-occludes without any depth work of
 * its own — the same mechanism `buildPillars` uses for its cuboid caps.
 */
export function buildSprite(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevMinCut, elevMaxCut } = p
  const { tier, nT, yOf } = quantiseTiers(terrain, p, o.tiers)
  const step = Math.max(1, Math.round((o.spacing ?? 6) / scl))
  const half = step * scl * 0.5 * Math.max(0.1, Math.min(1, o.size ?? 1))

  const positions = new F32List(), colors = new F32List()
  const lidP = new F32List(), lidC = new F32List(), lidI = new U32List()
  let lidV = 0

  const tierAt = (r, c) => {
    if (r < 0 || r >= rows || c < 0 || c >= cols) return -1
    return tier[r * cols + c]
  }

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      const t = tier[i]
      if (t < 0) continue
      const y = yOf(t)
      if (!inElevCut(y, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const wx = c * scl - halfW, wz = r * scl - halfH
      const col = computeVertexColor(t / Math.max(1, nT - 1),
                                     gridSlopes[i] / (maxSlope || 1), 0, p)

      // Top face outline.
      positions.push6(wx - half, y, wz - half, wx + half, y, wz - half)
      positions.push6(wx + half, y, wz - half, wx + half, y, wz + half)
      positions.push6(wx + half, y, wz + half, wx - half, y, wz + half)
      positions.push6(wx - half, y, wz + half, wx - half, y, wz - half)
      for (let e = 0; e < 4; e++) colors.pushRgb2(col)

      // Risers, only where the neighbour actually sits lower.
      for (const [dr, dc] of [[0, step], [step, 0], [0, -step], [-step, 0]]) {
        const tn = tierAt(r + dr, c + dc)
        if (tn < 0 || tn >= t) continue
        const yLo = yOf(tn)
        const ex = dc > 0 ? wx + half : dc < 0 ? wx - half : 0
        const ez = dr > 0 ? wz + half : dr < 0 ? wz - half : 0
        if (dc !== 0) {
          positions.push6(ex, y, wz - half, ex, yLo, wz - half)
          positions.push6(ex, y, wz + half, ex, yLo, wz + half)
        } else {
          positions.push6(wx - half, y, ez, wx - half, yLo, ez)
          positions.push6(wx + half, y, ez, wx + half, yLo, ez)
        }
        colors.pushRgb2(col); colors.pushRgb2(col)
      }

      if (o.faces !== false) {
        const lidCol = o.faceColor ? hexToRgb(o.faceColor) : col
        lidP.push6(wx - half, y, wz - half, wx + half, y, wz - half)
        lidP.push6(wx + half, y, wz + half, wx - half, y, wz + half)
        for (let v = 0; v < 4; v++) lidC.pushRgb(lidCol)
        lidI.push3(lidV, lidV + 1, lidV + 2); lidI.push3(lidV, lidV + 2, lidV + 3)
        lidV += 4
      }
    }
  }
  void grid; void gridMask
  const lids = lidI.length > 0
    ? { positions: lidP.toArray(), colors: lidC.toArray(), indices: lidI.toArray() }
    : null
  return { positions: positions.toArray(), colors: colors.toArray(), lids }
}

/**
 * Crazed emulsion: the walls of a Worley cellular pattern, thinned by tone.
 *
 * Reticulation in a real emulsion is the gelatin cracking into a network of
 * islands, so the mark is the *boundary* between cells and not the cells
 * themselves. That boundary is where the two nearest feature points are
 * equidistant — F₂ − F₁ ≈ 0 — which is the Voronoi diagram of the feature set,
 * obtained here without ever building one:
 *
 *     F₁, F₂ = the two smallest distances to jittered feature points
 *     wall  ⟺  F₂ − F₁ < width
 *
 * A Fortune sweep would give exact edges and cost a real data structure; this
 * costs nine bucket lookups per sample and gives an edge with thickness, which
 * is what a crack has. The feature points sit one per cell of a coarse grid,
 * jittered from `mulberry32` so a seed reproduces the pattern exactly.
 *
 * The tone gate is what stops it being wallpaper: walls are drawn only where the
 * plate is dark enough to have cracked, on the same density modes Stipple
 * offers, so the crazing pools in the shadows and leaves the highlights clean.
 */
export function buildReticulation(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const cell = Math.max(2, Math.round((o.cell ?? 12) / scl))
  const step = Math.max(1, Math.round((o.spacing ?? 1.5) / scl))
  const width = Math.max(0.05, o.width ?? 0.5) * cell * 0.25
  const gam = o.gamma ?? 1
  const dm = o.densityMode ?? 'invElev'
  const rng = mulberry32(((o.seed ?? 42) * 2654435761) >>> 0)

  // One jittered feature point per coarse cell, laid out once.
  const fR = Math.ceil(rows / cell) + 2, fC = Math.ceil(cols / cell) + 2
  const fx = new Float32Array(fR * fC), fy = new Float32Array(fR * fC)
  for (let i = 0; i < fR; i++) {
    for (let j = 0; j < fC; j++) {
      const k = i * fC + j
      fy[k] = (i - 1 + rng()) * cell
      fx[k] = (j - 1 + rng()) * cell
    }
  }

  const positions = new F32List(), colors = new F32List()
  const eps = Math.max(0.001, scl * 0.003)

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue

      const normE = normElev(elev, minElev, maxElev)
      const slope = gridSlopes[i] / (maxSlope || 1)
      let density
      if      (dm === 'elevation') density = normE
      else if (dm === 'slope')     density = slope
      else if (dm === 'invSlope')  density = 1 - slope
      else                         density = 1 - normE
      density = Math.pow(Math.max(0, Math.min(1, density)), gam)
      if (density <= 0.001) continue

      // The two nearest feature points, over the 3×3 buckets that can hold them.
      const bi = Math.floor(r / cell) + 1, bj = Math.floor(c / cell) + 1
      let f1 = Infinity, f2 = Infinity
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const ii = bi + di, jj = bj + dj
          if (ii < 0 || ii >= fR || jj < 0 || jj >= fC) continue
          const k = ii * fC + jj
          const dr = fy[k] - r, dc = fx[k] - c
          const d = Math.sqrt(dr * dr + dc * dc)
          if (d < f1) { f2 = f1; f1 = d } else if (d < f2) f2 = d
        }
      }
      if (!(f2 - f1 < width * density)) continue

      const wx = c * scl - halfW, wz = r * scl - halfH
      positions.push6(wx - eps, elev, wz, wx + eps, elev, wz)
      colors.pushRgb2(computeVertexColor(normE, slope, 0, p))
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray(), isPoints: true }
}

/**
 * Every sign change of the scanline, after its own running mean is taken out.
 *
 * The density of the marks is the terrain's local *pitch* — how often the ground
 * crosses its own average — which is a different measurement from either slope
 * or curvature: dense on scree and broken rock, empty on a glacier or a screefree
 * face, regardless of how steep either is.
 *
 * Detrending is what makes it a pitch rather than a horizon: without subtracting
 * the blur, a scanline crosses its mean twice on a whole mountain and the mode
 * draws two dots.
 */
export function buildZeroCross(terrain, p, o) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const mask = terrain.hasNoData ? gridMask : null
  const base = boxBlur(grid, cols, rows, Math.max(1, o.detrend ?? 6), mask)
  const step = Math.max(1, Math.round((o.spacing ?? 2) / scl))
  const eps = Math.max(0.001, scl * 0.003)
  const both = o.axes !== 'rows'

  const positions = new F32List(), colors = new F32List()
  const emit = (r, c, i) => {
    const elev = cellElev(grid, r, c, cols, elevScale, p.jitterAmt)
    if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) return
    const wx = c * scl - halfW, wz = r * scl - halfH
    positions.push6(wx - eps, elev, wz, wx + eps, elev, wz)
    colors.pushRgb2(computeVertexColor(normElev(elev, minElev, maxElev),
                                       gridSlopes[i] / (maxSlope || 1), 0, p))
  }
  for (let r = 0; r < rows; r += step) {
    for (let c = 1; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i] || !gridMask[i - 1]) continue
      const a = grid[i - 1] - base[i - 1], b = grid[i] - base[i]
      if (a === 0 || (a > 0) === (b > 0)) continue
      emit(r, c, i)
    }
  }
  if (both) {
    for (let c = 0; c < cols; c += step) {
      for (let r = 1; r < rows; r++) {
        const i = r * cols + c
        if (!gridMask[i] || !gridMask[i - cols]) continue
        const a = grid[i - cols] - base[i - cols], b = grid[i] - base[i]
        if (a === 0 || (a > 0) === (b > 0)) continue
        emit(r, c, i)
      }
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray(), isPoints: true }
}

/**
 * Points drawn from a density field by rejection, at most one per cell.
 *
 * The one-per-cell rule is the cheapest separation there is, and it matters to
 * both callers: two samples in one cell give the tour a zero-length hop and the
 * triangulation a sliver. Candidates are uniform over the raster, so the field
 * decides only how many survive where — the same contract as Stipple.
 */
function sampleByDensity(terrain, density, count, rng) {
  const { gridMask, rows, cols } = terrain
  const taken = new Uint8Array(rows * cols)
  const xs = [], ys = []
  const tries = count * 200
  for (let k = 0; k < tries && xs.length < count; k++) {
    const fc = rng() * (cols - 1), fr = rng() * (rows - 1)
    const i = Math.round(fr) * cols + Math.round(fc)
    if (!gridMask[i] || taken[i] || rng() >= density[i]) continue
    taken[i] = 1
    xs.push(fc); ys.push(fr)
  }
  return { xs, ys, n: xs.length }
}

/**
 * Points into square buckets, for nearest-neighbour queries.
 *
 * `start[b]..start[b+1]` indexes `items`, a counting sort by bucket. Built once
 * and never edited: the tour marks visited points in its own array, which is
 * simpler than removing them and costs only a few skipped reads near the end.
 */
function bucketPoints(xs, ys, n, cols, rows) {
  const size = Math.max(1, Math.sqrt((cols * rows) / Math.max(1, n)) * 1.5)
  const bw = Math.max(1, Math.ceil(cols / size)), bh = Math.max(1, Math.ceil(rows / size))
  const of = new Int32Array(n), count = new Int32Array(bw * bh + 1)
  for (let i = 0; i < n; i++) {
    const b = Math.min(bh - 1, Math.floor(ys[i] / size)) * bw + Math.min(bw - 1, Math.floor(xs[i] / size))
    of[i] = b; count[b + 1]++
  }
  for (let b = 0; b < bw * bh; b++) count[b + 1] += count[b]
  const start = count.slice(), fill = count.slice(), items = new Int32Array(n)
  for (let i = 0; i < n; i++) items[fill[of[i]]++] = i
  return { size, bw, bh, start, items }
}

/**
 * The nearest point to (x, y) that `skip` does not reject, searched in square
 * rings of buckets. A ring can stop the search once its inner edge lies
 * farther than the best distance found so far.
 */
function nearestIn(B, xs, ys, x, y, skip) {
  const bx = Math.min(B.bw - 1, Math.floor(x / B.size)), by = Math.min(B.bh - 1, Math.floor(y / B.size))
  let best = -1, bestD = Infinity
  const maxRing = Math.max(B.bw, B.bh)
  for (let ring = 0; ring <= maxRing; ring++) {
    if (best >= 0 && (ring - 1) * B.size > Math.sqrt(bestD)) break
    for (let gy = by - ring; gy <= by + ring; gy++) {
      if (gy < 0 || gy >= B.bh) continue
      const edgeRow = gy === by - ring || gy === by + ring
      for (let gx = bx - ring; gx <= bx + ring; gx += edgeRow ? 1 : 2 * ring || 1) {
        if (gx < 0 || gx >= B.bw) continue
        const b = gy * B.bw + gx
        for (let k = B.start[b]; k < B.start[b + 1]; k++) {
          const j = B.items[k]
          if (skip(j)) continue
          const d = (xs[j] - x) ** 2 + (ys[j] - y) ** 2
          if (d < bestD) { bestD = d; best = j }
        }
      }
    }
  }
  return best
}

/** The `k` nearest other points of every point — the 2-opt candidate lists. */
function nearestLists(B, xs, ys, n, k) {
  const out = new Int32Array(n * k).fill(-1)
  const cand = [], dist = []
  for (let i = 0; i < n; i++) {
    const bx = Math.min(B.bw - 1, Math.floor(xs[i] / B.size)), by = Math.min(B.bh - 1, Math.floor(ys[i] / B.size))
    cand.length = 0; dist.length = 0
    // Two rings cover k neighbours at the bucket size chosen above in all but
    // the sparsest corners, and a short list there only makes 2-opt a little
    // less thorough — the full pass after it catches what this misses.
    for (let gy = by - 2; gy <= by + 2; gy++) {
      if (gy < 0 || gy >= B.bh) continue
      for (let gx = bx - 2; gx <= bx + 2; gx++) {
        if (gx < 0 || gx >= B.bw) continue
        const b = gy * B.bw + gx
        for (let m = B.start[b]; m < B.start[b + 1]; m++) {
          const j = B.items[m]
          if (j !== i) { cand.push(j); dist.push((xs[j] - xs[i]) ** 2 + (ys[j] - ys[i]) ** 2) }
        }
      }
    }
    const order = cand.map((_, q) => q).sort((a, b) => dist[a] - dist[b])
    for (let q = 0; q < Math.min(k, order.length); q++) out[i * k + q] = cand[order[q]]
  }
  return out
}

/**
 * A short closed tour through every point: nearest neighbour, then 2-opt.
 *
 * Two 2-opt phases. The first tries only each city's nearest few neighbours,
 * which finds almost every improvement at a fraction of the cost. The second
 * tries every pair, and is what makes the line non-intersecting: in the plane,
 * two crossing edges can always be uncrossed by a 2-opt move that shortens the
 * tour, so a tour no pair can improve has no crossings. Both stop at the time
 * budget, so a very large point count can leave a crossing behind.
 */
function tspTour(xs, ys, n, cols, rows, budgetMs) {
  const t0 = Date.now()
  const B = bucketPoints(xs, ys, n, cols, rows)
  const tour = new Int32Array(n), used = new Uint8Array(n)
  let cur = 0
  used[0] = 1
  for (let k = 1; k < n; k++) {
    const nx = nearestIn(B, xs, ys, xs[cur], ys[cur], (j) => used[j] === 1)
    tour[k] = nx; used[nx] = 1; cur = nx
  }
  if (n < 4) return tour

  const pos = new Int32Array(n)
  for (let k = 0; k < n; k++) pos[tour[k]] = k
  const d = (a, b) => Math.sqrt((xs[a] - xs[b]) ** 2 + (ys[a] - ys[b]) ** 2)
  // Reverses tour positions i..j (cyclic, inclusive), or the complement when
  // that is shorter — on a cycle the two reversals give the same tour.
  const reverse = (i, j) => {
    let len = ((j - i + n) % n) + 1
    if (len * 2 > n) { const ni = (j + 1) % n; j = (i - 1 + n) % n; i = ni; len = n - len }
    for (let s = 0; s < len >> 1; s++) {
      const a = (i + s) % n, b = (j - s + n) % n
      const ca = tour[a], cb = tour[b]
      tour[a] = cb; tour[b] = ca; pos[cb] = a; pos[ca] = b
    }
  }

  const K = 8
  const near = nearestLists(B, xs, ys, n, K)
  let improved = true
  while (improved && Date.now() - t0 < budgetMs) {
    improved = false
    for (let i = 0; i < n; i++) {
      const a = tour[i], b = tour[(i + 1) % n], dab = d(a, b)
      for (let q = 0; q < K; q++) {
        const c = near[a * K + q]
        if (c < 0) break
        const dac = d(a, c)
        if (dac >= dab) break
        const j = pos[c], e = tour[(j + 1) % n]
        if (c === b || e === a) continue
        if (dac + d(b, e) < dab + d(c, e) - 1e-9) { reverse(i + 1, j); improved = true; break }
      }
    }
  }
  improved = true
  while (improved && Date.now() - t0 < budgetMs) {
    improved = false
    for (let i = 0; i < n - 1 && Date.now() - t0 < budgetMs; i++) {
      const a = tour[i], b = tour[i + 1], dab = d(a, b)
      for (let j = i + 2; j < n; j++) {
        const c = tour[j], e = tour[(j + 1) % n]
        if (e === a) continue
        if (d(a, c) + d(b, e) < dab + d(c, e) - 1e-9) { reverse(i + 1, j); improved = true; break }
      }
    }
  }
  return tour
}

/**
 * The density fields the point-set modes sample, all in [0, 1].
 *
 * `shade` is Lambert darkness from a fixed sun, which is what gives a single
 * line portrait of a mountain its modelling: the pen dwells where the slope
 * turns away from the light.
 */
function pointDensity(terrain, p, mode, gamma, azimuth) {
  const { grid, gridMask, rows, cols, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, jitterAmt } = p
  const n = rows * cols, out = new Float32Array(n)
  const dark = mode === 'shade' ? lambertDarkness(terrain, azimuth, 1, elevScale, 1) : null
  const gam = gamma ?? 1
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const ne = normElev(cellElev(grid, r, c, cols, elevScale, jitterAmt), minElev, maxElev)
      const s = gridSlopes[i] / (maxSlope || 1)
      const v = mode === 'shade' ? dark[i]
        : mode === 'elevation' ? ne
        : mode === 'invElev' ? 1 - ne
        : mode === 'invSlope' ? 1 - s
        : s
      out[i] = Math.pow(Math.max(0, Math.min(1, v)), gam)
    }
  }
  return out
}

/**
 * The whole terrain as one unbroken stroke.
 *
 * A weighted stipple, joined by a travelling-salesman tour. The dots crowd
 * where the density field is high and the tour has to visit every one of them,
 * so tone becomes how tightly one line coils. For a pen plotter it is the
 * cheapest plate there is: one pen-down, one pen-up.
 *
 * The tour is closed and then, unless `closed` is set, opened at its longest
 * edge — usually a jump across an empty flat, which is the edge a viewer is
 * least likely to miss.
 */
export function buildTsp(terrain, p, o) {
  const { gridMask, rows, cols } = terrain
  const out = { positions: new F32List(), colors: new F32List() }
  const sMask = terrain.hasNoData ? gridMask : null
  const count = Math.max(50, Math.min(8000, Math.round(o.count ?? 2500)))
  const rng = mulberry32(((o.seed ?? 7) * 2654435761) >>> 0)
  const density = pointDensity(terrain, p, o.densityMode ?? 'shade', o.gamma, o.azimuth ?? 315)
  const { xs, ys, n } = sampleByDensity(terrain, density, count, rng)
  if (n < 2) return { positions: out.positions.toArray(), colors: out.colors.toArray() }

  const tour = tspTour(xs, ys, n, cols, rows, 2000)
  let startAt = 0, edges = n
  if (!o.closed) {
    let longest = -1
    for (let k = 0; k < n; k++) {
      const a = tour[k], b = tour[(k + 1) % n], dd = Math.hypot(xs[a] - xs[b], ys[a] - ys[b])
      if (dd > longest) { longest = dd; startAt = (k + 1) % n }
    }
    edges = n - 1
  }
  for (let k = 0; k < edges; k++) {
    const a = tour[(startAt + k) % n], b = tour[(startAt + k + 1) % n]
    drapeEdge(out, terrain, p, sMask, xs[a], ys[a], xs[b], ys[b], Math.atan2(ys[b] - ys[a], xs[b] - xs[a]))
  }
  return { positions: out.positions.toArray(), colors: out.colors.toArray() }
}

/**
 * A triangle net whose mesh size is the ground's roughness.
 *
 * The Terrain Ruggedness Index is the mean absolute height difference between
 * a cell and its eight neighbours — how broken the ground is, independent of
 * which way it faces. Points are sampled with that as their density, then
 * triangulated (Delaunator), so scree and crags shatter into small facets and
 * meadows lie under a few long ones. `floor` keeps a minimum density, or a flat
 * would get no points and the net would stretch straight across it.
 *
 * Voronoi is the same triangulation's dual: one edge between the circumcentres
 * of every pair of adjacent triangles. Cells on the hull are unbounded and are
 * left open, and an edge whose end falls off the raster is dropped.
 */
export function buildRugged(terrain, p, o) {
  const { grid, gridMask, rows, cols } = terrain
  const out = { positions: new F32List(), colors: new F32List() }
  const sMask = terrain.hasNoData ? gridMask : null
  const n = rows * cols
  const src = (o.radius ?? 0) > 0 ? boxBlur(grid, cols, rows, o.radius, sMask) : grid

  const tri = new Float32Array(n)
  let triMax = 0
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      let sum = 0, cnt = 0
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue
          const rr = r + dr, cc = c + dc
          if (rr < 0 || rr >= rows || cc < 0 || cc >= cols || !gridMask[rr * cols + cc]) continue
          sum += Math.abs(src[rr * cols + cc] - src[i]); cnt++
        }
      }
      tri[i] = cnt ? sum / cnt : 0
      if (tri[i] > triMax) triMax = tri[i]
    }
  }
  // Normalised to the 98th percentile, not the maximum: one cliff pixel would
  // otherwise set the scale and leave the rest of the plate uniformly sparse.
  const BINS = 512, hist = new Uint32Array(BINS)
  let valid = 0
  for (let i = 0; i < n; i++) if (gridMask[i]) { hist[Math.min(BINS - 1, Math.floor((tri[i] / (triMax || 1)) * BINS))]++; valid++ }
  let acc = 0, bin = BINS - 1
  for (let b = 0; b < BINS; b++) { acc += hist[b]; if (acc >= valid * 0.98) { bin = b; break } }
  const ref = ((bin + 1) / BINS) * (triMax || 1)

  const floor = Math.max(0, Math.min(1, o.floor ?? 0.12)), gam = o.gamma ?? 1
  const density = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (gridMask[i]) density[i] = floor + (1 - floor) * Math.pow(Math.min(1, tri[i] / (ref || 1)), gam)
  }
  const count = Math.max(20, Math.min(12000, Math.round(o.count ?? 3000)))
  const rng = mulberry32(((o.seed ?? 11) * 2654435761) >>> 0)
  const { xs, ys, n: m } = sampleByDensity(terrain, density, count, rng)
  if (m < 3) return { positions: out.positions.toArray(), colors: out.colors.toArray() }

  const coords = new Float64Array(m * 2)
  for (let k = 0; k < m; k++) { coords[2 * k] = xs[k]; coords[2 * k + 1] = ys[k] }
  const del = new Delaunator(coords)
  const { triangles, halfedges } = del
  const kind = o.kind ?? 'delaunay'
  const next = (e) => (e % 3 === 2 ? e - 2 : e + 1)

  if (kind === 'delaunay' || kind === 'both') {
    for (let e = 0; e < triangles.length; e++) {
      if (halfedges[e] > e) continue      // each shared edge once; hull edges (−1) always
      const a = triangles[e], b = triangles[next(e)]
      drapeEdge(out, terrain, p, sMask, xs[a], ys[a], xs[b], ys[b], Math.atan2(ys[b] - ys[a], xs[b] - xs[a]))
    }
  }
  if (kind === 'voronoi' || kind === 'both') {
    const nt = triangles.length / 3, cx = new Float64Array(nt), cy = new Float64Array(nt)
    for (let t = 0; t < nt; t++) {
      const a = triangles[3 * t], b = triangles[3 * t + 1], c = triangles[3 * t + 2]
      const ax = xs[a], ay = ys[a], bx = xs[b] - ax, by = ys[b] - ay, qx = xs[c] - ax, qy = ys[c] - ay
      const dd = 2 * (bx * qy - by * qx)
      if (Math.abs(dd) < 1e-12) { cx[t] = NaN; cy[t] = NaN; continue }
      const b2 = bx * bx + by * by, c2 = qx * qx + qy * qy
      cx[t] = ax + (qy * b2 - by * c2) / dd
      cy[t] = ay + (bx * c2 - qx * b2) / dd
    }
    const inside = (x, y) => x >= 0 && x <= cols - 1 && y >= 0 && y <= rows - 1
    for (let e = 0; e < triangles.length; e++) {
      const f = halfedges[e]
      if (f < e) continue                 // hull edges (−1) and the second half of each pair
      const t0 = Math.floor(e / 3), t1 = Math.floor(f / 3)
      if (!inside(cx[t0], cy[t0]) || !inside(cx[t1], cy[t1])) continue
      drapeEdge(out, terrain, p, sMask, cx[t0], cy[t0], cx[t1], cy[t1], Math.atan2(cy[t1] - cy[t0], cx[t1] - cx[t0]))
    }
  }
  return { positions: out.positions.toArray(), colors: out.colors.toArray() }
}
