/**
 * Line modes: Lines, Crosshatch, Flow, Curvature, Stream Network, Pencil, Ridge, Valley.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { cellElev, hasData, boxBlur, jitterNoise, sampleBilinear } from '../terrain'
import { computeVertexColor } from '../colorUtils'
import { F32List, concat, inElevCut, neighbour, normElev } from './shared.js'

// ─── Lines (arbitrary bearing) ───────────────────────────────────────────────

/**
 * Parallel terrain-draped lines at any bearing angle — the merger of the old
 * X Lines (angle 0°) and Y Lines (angle 90°) modes.
 *
 * Lines sit at perpendicular positions pos = k·lineStep + shift (in grid cells)
 * along the normal of the march direction, and are sampled in unit-cell steps.
 * At 0°/90° the sample points land exactly on grid rows/columns, so those
 * angles reproduce the old axis-aligned modes; oblique angles sample the
 * terrain bilinearly along the rotated rays.
 */
export function buildAngleLines(terrain, p, spacing, shift, angleDeg, fitBoundary = false) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const positions = new F32List(), colors = new F32List()
  // A solid raster takes the plain bilinear path — the renormalising one costs
  // a mask read and a divide per sample, and this is the hottest loop here.
  const sMask = terrain.hasNoData ? gridMask : null

  const lineStep = Math.max(1, Math.round((spacing ?? 4) / scl))
  const shiftCells = (shift ?? 0) % lineStep
  const theta = ((angleDeg ?? 0) * Math.PI) / 180
  // Snap near-axis components to exact 0/±1. At multiples of 90° cos/sin carry a
  // ~1e-16 rounding error; with fitBoundary the edge lines sit exactly on the grid
  // border, so that drift accumulates along the march (fc += dx·t) and pushes the
  // samples just outside [0, cols-1], clipping the whole left / part of the right
  // border line. Exact axis values keep them on the inclusive boundary.
  const snap = (v) => Math.abs(v) < 1e-9 ? 0 : Math.abs(v - 1) < 1e-9 ? 1 : Math.abs(v + 1) < 1e-9 ? -1 : v
  const dx = snap(Math.cos(theta)), dz = snap(Math.sin(theta))   // march direction (grid cols/rows)
  const nx = -dz, nz = dx                                        // line-pitch normal

  // Projection of the grid corners onto the normal (line positions) and the
  // march direction (sample range) — covers the grid exactly at any angle.
  let pMin = Infinity, pMax = -Infinity, tMin = Infinity, tMax = -Infinity
  for (const [c, r] of [[0, 0], [cols - 1, 0], [0, rows - 1], [cols - 1, rows - 1]]) {
    const pp = nx * c + nz * r; if (pp < pMin) pMin = pp; if (pp > pMax) pMax = pp
    const tt = dx * c + dz * r; if (tt < tMin) tMin = tt; if (tt > tMax) tMax = tt
  }
  const t0 = Math.ceil(tMin), t1 = Math.floor(tMax)

  // Line positions along the normal. By default lines sit at fixed multiples of
  // lineStep, so the far edge keeps whatever partial gap is left over (open/half
  // rectangles in Crosshatch). When fitBoundary is set, the first and last lines
  // are pinned to the grid edges (pMin/pMax) and the step is nudged so an integer
  // number of intervals spans them exactly — closing the rectangles on all sides.
  const linePos = []
  if (fitBoundary) {
    const span = pMax - pMin
    const n = Math.max(1, Math.round(span / lineStep))
    for (let k = 0; k <= n; k++) linePos.push(pMin + (span * k) / n)
  } else {
    const kMin = Math.ceil((pMin - shiftCells) / lineStep)
    const kMax = Math.floor((pMax - shiftCells) / lineStep)
    for (let k = kMin; k <= kMax; k++) linePos.push(k * lineStep + shiftCells)
  }

  for (const pos of linePos) {
    const ox = nx * pos, oz = nz * pos
    let prevOk = false, prevC = 0, prevR = 0, prevE = 0
    for (let t = t0; t <= t1; t++) {
      const fc = ox + dx * t, fr = oz + dz * t
      let ok = fc >= 0 && fc <= cols - 1 && fr >= 0 && fr <= rows - 1
      let elev = 0
      if (ok) {
        const ci = Math.round(fc), ri = Math.round(fr)
        ok = hasData(gridMask, ri, ci, cols)
        if (ok) {
          // Masked bilinear: a tap straddling a clipped edge must not blend
          // against the zeros parked in NoData, or the line dives to the floor.
          const b = sampleBilinear(grid, sMask, rows, cols, fr, fc)
          ok = b === b                      // NaN ⇒ nothing to drape on
          elev = (b - 0.5) * 100 * elevScale
          if (jitterAmt > 0) elev += jitterNoise(fc, fr) * jitterAmt
          ok = ok && inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)
        }
      }
      if (ok && prevOk) {
        positions.push6(prevC * scl - halfW, prevE, prevR * scl - halfH,
                        fc * scl - halfW, elev, fr * scl - halfH)
        const i0 = Math.round(prevR) * cols + Math.round(prevC)
        const i1 = Math.round(fr) * cols + Math.round(fc)
        colors.pushRgb(computeVertexColor(normElev(prevE, minElev, maxElev), gridSlopes[i0] / (maxSlope || 1), theta, p))
        colors.pushRgb(computeVertexColor(normElev(elev, minElev, maxElev), gridSlopes[i1] / (maxSlope || 1), theta, p))
      }
      prevOk = ok; prevC = fc; prevR = fr; prevE = elev
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

export function buildCrosshatch(terrain, p, spacing, angleDeg) {
  const a = buildAngleLines(terrain, p, spacing, 0, angleDeg ?? 0, true)
  const b = buildAngleLines(terrain, p, spacing, 0, (angleDeg ?? 0) + 90, true)
  return { positions: concat(a.positions, b.positions), colors: concat(a.colors, b.colors) }
}

// ─── Flow lines ───────────────────────────────────────────────────────────────

/**
 * Streamlines traced down the gradient field — the path water would take.
 *
 * Each seed is integrated downhill in fixed-length steps rather than jumping
 * cell to cell, so a line crosses the grid diagonally instead of staircasing
 * along it; the field is sampled bilinearly between cells for the same reason.
 *
 * Two rules keep the field legible rather than a tangle:
 *  - **Seeds run highest first.** Peaks are where the drainage pattern is
 *    legible, so they get to claim their lines before lower ground does.
 *  - **A trace stops on reaching ground another trace already covered.** Every
 *    streamline in a basin converges on the same outlet, so without this they
 *    would all overdraw the same channel; each cell belongs to the first line
 *    through it.
 *
 * A trace also ends at `maxLen`, at the grid edge, or where the gradient goes
 * flat and there is no longer a direction to follow.
 */
export function buildFlowLines(terrain, p, spacing, step, maxLen) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const seedStep = Math.max(1, (spacing ?? 10) / scl), n = rows*cols, mask = new Uint8Array(n), eps = 0.5
  const positions = new F32List(), colors = new F32List()
  // Solid raster ⇒ plain bilinear; see buildAngleLines.
  const sMask = terrain.hasNoData ? gridMask : null
  const seeds = []
  for (let rf = 0; rf < rows; rf += seedStep) {
    const r = Math.min(rows - 1, Math.round(rf))
    for (let cf = 0; cf < cols; cf += seedStep) {
      const c = Math.min(cols - 1, Math.round(cf))
      if (gridMask[r*cols+c]) seeds.push(r*cols+c)
    }
  }
  seeds.sort((a, b) => grid[b] - grid[a])
  for (const idx of seeds) {
    const r = Math.floor(idx / cols), c = idx % cols
    if (mask[idx]) continue
    let fr = r, fc = c, e0 = (sampleBilinear(grid, sMask, rows, cols, fr, fc) - 0.5)*100*elevScale
    for (let s = 0; s < (maxLen ?? 100); s++) {
        if (fr < eps || fr > rows-1-eps || fc < eps || fc > cols-1-eps) break
        const ri = Math.round(fr), ci = Math.round(fc)
        if (!gridMask[ri*cols+ci]) break
        mask[ri*cols+ci] = 1
        // Masked taps: reading the zeros in NoData as ground would manufacture a
        // cliff along the clipped edge and send every nearby path over it.
        const bL = sampleBilinear(grid, sMask, rows, cols, fr, fc-eps), bR = sampleBilinear(grid, sMask, rows, cols, fr, fc+eps)
        const bU = sampleBilinear(grid, sMask, rows, cols, fr-eps, fc), bD = sampleBilinear(grid, sMask, rows, cols, fr+eps, fc)
        const gx = bR-bL, gz = bD-bU, mag = Math.sqrt(gx*gx+gz*gz)
        if (!(mag >= 0.0005)) break      // also ends the path on a NaN tap
        const nfc = fc-(gx/mag)*(step??1), nfr = fr-(gz/mag)*(step??1)
        if (mask[Math.round(nfr)*cols+Math.round(nfc)] || !gridMask[Math.round(nfr)*cols+Math.round(nfc)]) break
        const b1 = sampleBilinear(grid, sMask, rows, cols, nfr, nfc), e1 = (b1-0.5)*100*elevScale
        if (e1 !== e1) break
        if (inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut) && inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut)) {
          positions.push6(fc*scl-halfW, e0, fr*scl-halfH, nfc*scl-halfW, e1, nfr*scl-halfH)
          const col0 = computeVertexColor(normElev(e0, minElev, maxElev), Math.min(1, mag/(maxSlope||0.02)), Math.atan2(gz, gx), p)
          colors.pushRgb2(col0)
        } else if (!(inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut) || inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut))) break
        fr=nfr; fc=nfc; e0=e1
      }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Curvature engraving ─────────────────────────────────────────────────

/**
 * Bilinear sample of a principal-direction field, sign-aligned to a reference.
 *
 * Principal directions are a *line* field, not a vector field: ±v describe the
 * same direction, and neighbouring cells are free to disagree on sign. Plain
 * bilinear interpolation of such a field cancels to zero wherever neighbours
 * happen to be anti-aligned, which shreds a streamline into noise. Each corner
 * is therefore flipped to agree with `refX/refY` (the previous step's heading)
 * before being blended.
 */
function sampleDirAligned(dirX, dirY, rows, cols, fr, fc, refX, refY) {
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(fr)))
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(fc)))
  const r1 = Math.min(rows - 1, r0 + 1), c1 = Math.min(cols - 1, c0 + 1)
  const dr = fr - r0, dc = fc - c0
  let x = 0, y = 0
  for (let k = 0; k < 4; k++) {
    const rr = k < 2 ? r0 : r1, cc = (k & 1) ? c1 : c0
    const w = (k < 2 ? 1 - dr : dr) * ((k & 1) ? dc : 1 - dc)
    if (w === 0) continue
    const i = rr * cols + cc
    let vx = dirX[i], vy = dirY[i]
    if (vx * refX + vy * refY < 0) { vx = -vx; vy = -vy }
    x += vx * w; y += vy * w
  }
  const m = Math.hypot(x, y)
  return m < 1e-9 ? null : [x / m, y / m]
}

/**
 * Copperplate-style engraving that follows the *form* rather than the light.
 *
 * Mode: Engraving hatches by illumination — stroke density tracks how lit a
 * cell is. This instead traces streamlines through the principal-curvature
 * direction field, so the strokes themselves wrap around the shape the way a
 * burin follows a surface. The Hessian
 *
 *     H = [[h_xx, h_xy], [h_xy, h_yy]]
 *
 * has eigenvalues λ = (tr ± √(tr² − 4·det)) / 2; its eigenvectors are the
 * principal directions. Hatching across the form (`max`, the default) runs
 * along the direction of greatest bending — lines wrap a ridge like hoops round
 * a barrel. Hatching along the form (`min`) runs down the flattest direction,
 * combing out along ridges and valleys instead.
 *
 * Spacing uses Jobard–Lefebvre style occupancy: each streamline claims a disc
 * of cells as it advances and stops on reaching another line's territory, which
 * gives evenly separated strokes instead of the clumping a fixed seed grid
 * produces.
 */
export function buildCurvature(terrain, p, spacing, length, threshold, radius, dirMode, stepLen) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p

  const positions = new F32List(), colors = new F32List()
  if (rows < 5 || cols < 5) return { positions: positions.toArray(), colors: colors.toArray() }

  // Second derivatives are noise amplifiers; pre-smooth before differencing.
  // Mask-aware, or the step down to the zeros in NoData would be the strongest
  // curvature on the terrain and ring the whole selection with strokes.
  const sm = boxBlur(grid, cols, rows, Math.max(0, radius ?? 1), terrain.hasNoData ? gridMask : null)
  const n = rows * cols
  const dirX = new Float32Array(n), dirY = new Float32Array(n)
  const strength = new Float32Array(n)
  const wantMax = (dirMode ?? 'max') !== 'min'
  let maxStrength = 0

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      // Stencil taps read NoData as flat, not as a cliff down to 0 — see
      // `neighbour`. Without it the boundary of a clipped selection is the
      // strongest curvature on the terrain, and it took the strokes with it.
      const hxx = neighbour(sm, gridMask, i, 1) + neighbour(sm, gridMask, i, -1) - 2 * sm[i]
      const hyy = neighbour(sm, gridMask, i, cols) + neighbour(sm, gridMask, i, -cols) - 2 * sm[i]
      const hxy = (neighbour(sm, gridMask, i, cols + 1) - neighbour(sm, gridMask, i, cols - 1)
                 - neighbour(sm, gridMask, i, -cols + 1) + neighbour(sm, gridMask, i, -cols - 1)) / 4

      const tr = hxx + hyy
      const det = hxx * hyy - hxy * hxy
      const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det))
      const lo = (tr - disc) / 2, hi = (tr + disc) / 2
      // "Max"/"min" are by magnitude: the strongest and weakest bending,
      // regardless of whether the surface curves up or down there.
      const lam = wantMax
        ? (Math.abs(hi) >= Math.abs(lo) ? hi : lo)
        : (Math.abs(hi) <  Math.abs(lo) ? hi : lo)

      // Eigenvector of [[hxx,hxy],[hxy,hyy]] for lam. Both rows give it; pick
      // the better-conditioned one so near-diagonal Hessians stay stable.
      let vx, vy
      if (Math.abs(hxy) > 1e-12) {
        if (Math.abs(lam - hxx) >= Math.abs(lam - hyy)) { vx = hxy; vy = lam - hxx }
        else                                            { vx = lam - hyy; vy = hxy }
      } else {
        // Diagonal Hessian: principal directions are the axes.
        const alongX = Math.abs(hxx - lam) < Math.abs(hyy - lam)
        vx = alongX ? 1 : 0; vy = alongX ? 0 : 1
      }
      const m = Math.hypot(vx, vy)
      if (m < 1e-12) continue
      dirX[i] = vx / m; dirY[i] = vy / m
      // Strength asks "does the surface bend here at all", so it is always the
      // dominant curvature — never the eigenvalue we happened to pick a
      // direction from. Along-form hatching selects the *weakest* curvature,
      // which on a ridge is identically zero: keying the threshold to that
      // suppressed the mode everywhere it is most meaningful.
      const s = Math.max(Math.abs(hi), Math.abs(lo))
      strength[i] = s
      if (s > maxStrength) maxStrength = s
    }
  }
  if (maxStrength <= 0) return { positions: positions.toArray(), colors: colors.toArray() }

  const minStrength = (threshold ?? 0.15) * maxStrength
  const sep = Math.max(0.75, (spacing ?? 4) / scl)
  const sepCells = Math.max(1, Math.round(sep))
  const stepSize = Math.max(0.25, stepLen ?? 1)
  const maxSteps = Math.max(2, Math.round(length ?? 60))
  const owner = new Int32Array(n)      // 0 = free, else the claiming streamline id
  const eps = 0.5
  // Seeds sit `sepCells` apart but a line only blocks its neighbours within
  // half that. Claiming the full separation makes adjacent seeds collide on
  // their first step, chopping every stroke into a stub.
  const claimCells = Math.max(1, Math.round(sepCells / 2))

  const claim = (fr, fc, id) => {
    const r0 = Math.max(0, Math.round(fr) - claimCells), r1 = Math.min(rows - 1, Math.round(fr) + claimCells)
    const c0 = Math.max(0, Math.round(fc) - claimCells), c1 = Math.min(cols - 1, Math.round(fc) + claimCells)
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c
        if (owner[i] === 0) owner[i] = id
      }
    }
  }

  // Seed on a grid at the separation pitch, strongest curvature first so the
  // most structurally meaningful strokes claim their territory before filler.
  const seeds = []
  for (let r = 1; r < rows - 1; r += sepCells) {
    for (let c = 1; c < cols - 1; c += sepCells) {
      const i = r * cols + c
      if (gridMask[i] && strength[i] >= minStrength) seeds.push(i)
    }
  }
  seeds.sort((a, b) => strength[b] - strength[a])

  let id = 0
  for (const seed of seeds) {
    if (owner[seed] !== 0) continue
    id++
    const sr = Math.floor(seed / cols), sc = seed % cols

    // Trace outward from the seed in both senses of the (unoriented) direction.
    for (let dir = 0; dir < 2; dir++) {
      let fr = sr, fc = sc
      let hx = dirX[seed] * (dir ? -1 : 1), hy = dirY[seed] * (dir ? -1 : 1)
      let e0 = cellElev(grid, sr, sc, cols, elevScale, jitterAmt)

      for (let s = 0; s < maxSteps; s++) {
        if (fr < eps || fr > rows - 1 - eps || fc < eps || fc > cols - 1 - eps) break
        const d = sampleDirAligned(dirX, dirY, rows, cols, fr, fc, hx, hy)
        if (!d) break
        hx = d[0]; hy = d[1]

        const nfc = fc + hx * stepSize, nfr = fr + hy * stepSize
        if (nfr < eps || nfr > rows - 1 - eps || nfc < eps || nfc > cols - 1 - eps) break
        const ni = Math.round(nfr) * cols + Math.round(nfc)
        if (!gridMask[ni] || strength[ni] < minStrength) break
        if (owner[ni] !== 0 && owner[ni] !== id) break

        const e1 = cellElev(grid, Math.round(nfr), Math.round(nfc), cols, elevScale, jitterAmt)
        if (inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut) &&
            inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut)) {
          positions.push6(fc * scl - halfW, e0, fr * scl - halfH,
                          nfc * scl - halfW, e1, nfr * scl - halfH)
          const gi = Math.round(fr) * cols + Math.round(fc)
          colors.pushRgb2(computeVertexColor(
            normElev(e0, minElev, maxElev),
            Math.min(1, gridSlopes[gi] / (maxSlope || 1)),
            Math.atan2(hy, hx), p))
        }
        claim(nfr, nfc, id)
        fr = nfr; fc = nfc; e0 = e1
      }
    }
    claim(sr, sc, id)
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Stream Network ──────────────────────────────────────────────────────

/**
 * Stream network, pruned by Strahler order.
 *
 * Every cell drains to its lowest of eight neighbours, which makes the grid a
 * directed acyclic graph — so a topological sweep (Kahn's algorithm on
 * in-degree, ridges having in-degree 0) can resolve the whole network in one
 * pass with no iteration to a fixed point.
 *
 * `threshold` is a Strahler order, not a cell count: a channel's order rises
 * only where two tributaries of *equal* order meet, and otherwise inherits the
 * highest of its inputs. That is the distinction worth having — it prunes by
 * how branched the network above a point is rather than by how much area drains
 * through it, so a long unbranched gully stays order 1 no matter how far it
 * runs, and raising the threshold strips headwaters while leaving the trunk.
 *
 * `accum` weights the drawn channels by flow accumulation — how many cells
 * drain through each one, which the same sweep sums on the way down. A line
 * layer has one weight, so a heavier channel is drawn as parallel passes, up to
 * `passes` on the trunk, `gap` cells apart. That is also what a plotter does to
 * lay a heavier line with one pen. The count follows log accumulation, because
 * the raw count grows by orders of magnitude towards the outlet.
 */
export function buildDagThinning(terrain, p, threshold, opts = {}) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const n = rows*cols, next = new Int32Array(n).fill(-1), inDeg = new Int32Array(n).fill(0)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!gridMask[r*cols+c]) continue
      const i = r*cols+c; let minH = grid[i], target = -1
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = r+dr, nc = c+dc
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && gridMask[nr*cols+nc]) {
            const ni = nr*cols+nc; if (grid[ni] < minH) { minH = grid[ni]; target = ni }
          }
        }
      }
      if (target !== -1) { next[i] = target; inDeg[target]++ }
    }
  }
  const order = new Int32Array(n).fill(1), currentInDeg = new Int32Array(inDeg), maxInOrder = new Int32Array(n).fill(0), countMaxOrder = new Int32Array(n).fill(0), queue = []
  for (let i = 0; i < n; i++) if (gridMask[i] && inDeg[i] === 0) queue.push(i)
  const acc = new Float64Array(n).fill(1)
  let head = 0
  while (head < queue.length) {
    const i = queue[head++], dst = next[i]; if (dst === -1) continue
    acc[dst] += acc[i]
    const o = order[i]; if (o > maxInOrder[dst]) { maxInOrder[dst] = o; countMaxOrder[dst] = 1 } else if (o === maxInOrder[dst]) countMaxOrder[dst]++
    currentInDeg[dst]--; if (currentInDeg[dst] === 0) { order[dst] = (countMaxOrder[dst] > 1) ? maxInOrder[dst]+1 : maxInOrder[dst]; queue.push(dst) }
  }
  const positions = new F32List(), colors = new F32List()
  const strahlerThreshold = Math.max(1, Math.round(threshold ?? 2))
  const maxPasses = opts.accum ? Math.max(1, Math.min(8, Math.round(opts.passes ?? 4))) : 1
  let accMin = Infinity, accMax = 0
  if (maxPasses > 1) {
    for (let i = 0; i < n; i++) {
      if (next[i] === -1 || order[i] < strahlerThreshold) continue
      if (acc[i] < accMin) accMin = acc[i]
      if (acc[i] > accMax) accMax = acc[i]
    }
  }
  const logSpan = Math.log(accMax / accMin) || 1
  const gap = (opts.gap ?? 0.35) * scl
  for (let i = 0; i < n; i++) {
    const dst = next[i]; if (dst === -1 || order[i] < strahlerThreshold) continue
    const r0 = Math.floor(i/cols), c0 = i%cols, r1 = Math.floor(dst/cols), c1 = dst%cols, e0 = (grid[i]-0.5)*100*elevScale, e1 = (grid[dst]-0.5)*100*elevScale
    if (!inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut)) continue
    const col = computeVertexColor(normElev(e0, minElev, maxElev), gridSlopes[i]/(maxSlope||1), Math.atan2(r1-r0, c1-c0), p)
    const k = maxPasses > 1 ? 1 + Math.round((maxPasses - 1) * Math.log(acc[i] / accMin) / logSpan) : 1
    // Offsets across the step, centred on it, so one pass sits on the channel.
    const len = Math.hypot(c1-c0, r1-r0) || 1, ox = -(r1-r0)/len*gap, oz = (c1-c0)/len*gap
    for (let q = 0; q < k; q++) {
      const f = q - (k - 1) / 2
      positions.push6(c0*scl-halfW+ox*f, e0, r0*scl-halfH+oz*f, c1*scl-halfW+ox*f, e1, r1*scl-halfH+oz*f)
      colors.pushRgb2(col)
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}


// ─── Pencil Shading ───────────────────────────────────────────────────────────

/**
 * Cross-hatch marks on convex ground, sized by how sharply it bends.
 *
 * The measure is the negated discrete Laplacian, and the test is one-sided:
 * only cells above `threshold` are marked, so ridges and crests get hatching
 * while hollows of equal curvature get none. Keying on curvature rather than
 * height or illumination is what leaves both flats and uniform slopes clean —
 * only the form transitions are drawn.
 *
 * Each mark is a fixed X of two diagonals in world space, not oriented to the
 * surface; its size grows with curvature up to a cap of two grid cells. The
 * regularity is the point — it reads as a pencil texture rather than as
 * structure competing with the other modes.
 */
export function buildPencilShading(terrain, p, spacing, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev } = terrain
  const { elevScale, jitterAmt, elevMinCut, elevMaxCut } = p
  const positions = new F32List(), colors = new F32List(), step = Math.max(1, Math.round((spacing ?? 4) / scl))
  const curvThreshold = threshold ?? 0.5
  for (let r = step; r < rows - step; r += step) {
    for (let c = step; c < cols - step; c += step) {
      const i = r*cols + c
      if (!gridMask[i] || r <= 0 || r >= rows-1 || c <= 0 || c >= cols-1) continue
      // The Laplacian reads NoData as flat (see `neighbour`), so a clipped edge
      // does not pack shading marks along the outline of the selection.
      const curv = -(neighbour(grid, gridMask, i, -cols) + neighbour(grid, gridMask, i, cols)
                   + neighbour(grid, gridMask, i, -1)    + neighbour(grid, gridMask, i, 1)
                   - 4*grid[i]) * 100
      if (curv < curvThreshold) continue
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const wx = c*scl-halfW, wz = r*scl-halfH, len = Math.min(scl*2, curv*0.5), col = computeVertexColor(normElev(elev, minElev, maxElev), 0, 0, p)
      positions.push6(wx-0.7*len, elev, wz-0.7*len, wx+0.7*len, elev, wz+0.7*len)
      positions.push6(wx-0.7*len, elev, wz+0.7*len, wx+0.7*len, elev, wz-0.7*len)
      colors.pushRgb2(col); colors.pushRgb2(col)
    }
  }
  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Ridge Lines (Differential Geometry) ──────────────────────────────────────

/**
 * Ridge crests from the Hessian's principal curvatures.
 *
 * A cell qualifies on two counts: its strongest principal curvature exceeds the
 * threshold, *and* it is a local maximum along that curvature's own direction.
 * The second test is what distinguishes a crest from a merely convex slope —
 * without it the whole flank of a hill passes.
 *
 * `radius` pre-smooths the grid, and is not optional in practice: second
 * derivatives amplify noise, so on raw data every pixel of sensor grain reads as
 * its own ridge. It doubles as the scale control — a small radius finds every
 * spur, a large one only the range.
 *
 * Compare `buildTpiFeatures`, which asks a different question: TPI measures
 * height against the neighbourhood mean, so it finds ground that *sits* high,
 * while this finds ground that is *shaped* like a crest.
 */
export function buildRidgeLines(terrain, p, spacing, radius, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  
  // 1. Pre-smooth for stable second derivatives — mask-aware, so the drop to
  //    the zeros in NoData is not read as a crest along the selection edge.
  const smoothed = boxBlur(grid, cols, rows, radius, terrain.hasNoData ? gridMask : null)
  const ridgeThreshold = (threshold ?? 0.5) * 0.1
  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const positions = new F32List(), colors = new F32List()
  
  // 2. Compute Ridge points using Hessian Eigenvalues
  // Point is a ridge if max principal curvature is high AND it's a local maximum in direction of curvature
  const isRidge = new Uint8Array(rows * cols)
  const curvatures = new Float32Array(rows * cols)

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue

      // Finite differences for second derivatives, reading NoData as flat (see
      // `neighbour`) so the border of a clipped selection is not the sharpest
      // crest on the terrain and drawn as a ridge in its own right.
      const hxx = neighbour(smoothed, gridMask, i, 1) + neighbour(smoothed, gridMask, i, -1) - 2*smoothed[i]
      const hyy = neighbour(smoothed, gridMask, i, cols) + neighbour(smoothed, gridMask, i, -cols) - 2*smoothed[i]
      const hxy = (neighbour(smoothed, gridMask, i, cols+1) - neighbour(smoothed, gridMask, i, cols-1)
                 - neighbour(smoothed, gridMask, i, -cols+1) + neighbour(smoothed, gridMask, i, -cols-1)) / 4

      // Eigenvalues of Hessian J = [[hxx, hxy], [hxy, hyy]]
      // lambda = (tr(J) +- sqrt(tr(J)^2 - 4*det(J))) / 2
      const tr = hxx + hyy
      const det = hxx * hyy - hxy * hxy
      const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det))
      const lambda1 = (tr - disc) / 2 // Smallest eigenvalue (most negative for ridge)
      
      curvatures[i] = -lambda1
      if (-lambda1 > ridgeThreshold) isRidge[i] = 1
    }
  }

  // 3. Connect neighboring Ridge points to form segments
  for (let r = 1; r < rows - 1; r += step) {
    for (let c = 1; c < cols - 1; c += step) {
      const i = r * cols + c
      if (!isRidge[i]) continue
      
      // Check 8-neighborhood for other ridge points to connect to
      for (let dr = 0; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc <= 0) continue // Skip self and previous columns in current row
          const nr = r + dr, nc = c + dc
          const ni = nr * cols + nc
          if (nr >= rows || nc < 0 || nc >= cols || !isRidge[ni]) continue
          
          const e0 = cellElev(grid, r, c, cols, elevScale, jitterAmt)
          const e1 = cellElev(grid, nr, nc, cols, elevScale, jitterAmt)
          
          if (inElevCut(e0, minElev, maxElev, elevMinCut, elevMaxCut) && inElevCut(e1, minElev, maxElev, elevMinCut, elevMaxCut)) {
            positions.push6(c*scl-halfW, e0, r*scl-halfH, nc*scl-halfW, e1, nr*scl-halfH)
            const col = computeVertexColor(normElev(e0, minElev, maxElev), gridSlopes[i]/(maxSlope||1), 0, p)
            colors.pushRgb2(col)
          }
        }
      }
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}

// ─── Ridge & Valley (TPI) ────────────────────────────────────────────────────

/**
 * Ridges and valleys by Topographic Position Index.
 *
 * TPI is a cell's elevation minus the mean of its neighbourhood: strongly
 * positive on a crest, strongly negative in a hollow, near zero on a uniform
 * slope regardless of how steep that slope is. `radius` sets the neighbourhood,
 * and so the scale of landform picked out — a small radius finds every gully, a
 * large one only the major spurs.
 *
 * Ridges and valleys are the same measurement with the sign flipped, so one
 * builder serves both and `isRidge` selects which tail of the distribution is
 * kept. They are separate draw modes because they are usually styled apart.
 */
export function buildTpiFeatures(terrain, p, spacing, radius, threshold, isRidge) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  
  // The neighbourhood mean is just a box blur of the grid — separable and O(n),
  // so the radius is free rather than costing a window scan per cell. It is
  // taken over the *valid* neighbours only: counting NoData as zero elevation
  // would drag the mean down near a clipped edge and make every cell there read
  // as a ridge.
  const blurred = boxBlur(grid, cols, rows, radius, terrain.hasNoData ? gridMask : null)
  
  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const positions = new F32List(), colors = new F32List()

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      
      const val = grid[i]
      const avg = blurred[i]
      const tpi = val - avg
      
      const meetsThreshold = isRidge ? (tpi > threshold * 0.05) : (tpi < -threshold * 0.05)
      if (!meetsThreshold) continue
      
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      
      const wx = c * scl - halfW
      const wz = r * scl - halfH
      
      // A tick along the valley's axis, sized by how deep the cell sits. Across
      // a valley the ground bends hard and along it hardly at all, so the axis
      // is the direction of least curvature: the smoothed grid's Hessian gives
      // the direction of most, θ = ½·atan2(2h_xz, h_xx − h_zz), and the axis is
      // a quarter turn from it. The gradient would not do — beside the floor it
      // points at the floor, across the valley. It used to lie along x
      // everywhere, a row of dashes across every valley.
      const size = Math.abs(tpi) * 50 * scl
      let ux = 1, uz = 0
      {
        // Clamped at the raster's edge, so the edge row is oriented too.
        const b = (dr, dc) => blurred[Math.min(rows - 1, Math.max(0, r + dr)) * cols + Math.min(cols - 1, Math.max(0, c + dc))]
        const hxx = b(0, 1) + b(0, -1) - 2 * avg
        const hzz = b(1, 0) + b(-1, 0) - 2 * avg
        const hxz = (b(1, 1) - b(1, -1) - b(-1, 1) + b(-1, -1)) / 4
        if (Math.abs(hxx) + Math.abs(hzz) + Math.abs(hxz) > 1e-12) {
          const axis = 0.5 * Math.atan2(2 * hxz, hxx - hzz) + Math.PI / 2
          ux = Math.cos(axis); uz = Math.sin(axis)
        }
      }
      positions.push6(wx - ux * size, elev, wz - uz * size, wx + ux * size, elev, wz + uz * size)

      const slope = gridSlopes[i]
      const col = computeVertexColor(normElev(elev, minElev, maxElev), slope / (maxSlope || 1), 0, p)
      colors.pushRgb2(col)
    }
  }

  return { positions: positions.toArray(), colors: colors.toArray() }
}
