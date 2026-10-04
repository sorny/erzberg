/**
 * Colour modes: Indexed, Outrun, Riso, Mineral, Land cover, Watershed.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { cellElev, boxBlur, jitterNoise } from '../terrain'
import { hexToRgb, computeVertexColor, sampleGradient } from '../colorUtils'
import { LANDFORMS, NO_FORM, geomorphons } from '../landforms'
import { groundMetres } from './ground.js'
import { BAYER4, F32List, RISO_TAC_OFF, U32List, inElevCut, lambertDarkness, mulberry32, normElev, quantiseTiers } from './shared.js'

/* ═══════════════════════════════════════════════════════════════════════════
 * COLOUR MODES
 *
 * Every mode above takes its colour the same way: one scalar into one shared
 * gradient, sampled once per vertex. The nine below each break that in a
 * different place — a lookup instead of a sample, an area instead of a stroke,
 * a separation instead of a blend, a classification instead of a ramp.
 *
 * Three helpers carry most of it, because four of the nine want the same thing:
 * a lattice of flat coloured cells rather than marks.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A lattice of terrain-conforming coloured quads.
 *
 * The colour modes that *block* rather than draw — Indexed, Mineral, Watershed —
 * all want the same geometry: one flat quad per lattice cell, lifted
 * to the terrain, carrying a flat colour. That is what `lids` is for, and Pillars
 * and Sprite Blocks already prove the path works end to end.
 *
 * `colorFn(i, r, c, elev)` returns an [r,g,b] triple, or null to leave the cell
 * empty. The optional outline is a separate concern and stays on the caller.
 */
function fillCells(terrain, p, spacing, colorFn, regionFn, inkFn) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev } = terrain
  const { elevScale, jitterAmt, elevMinCut, elevMaxCut } = p
  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const half = step * scl * 0.5

  // Pass one: the colour of every lattice cell, kept so pass two can find the
  // boundaries. A boundary is where two cells disagree, which cannot be known
  // while the first of them is being written.
  const colAt = new Map(), elevAt = new Map(), regAt = new Map(), inkAt = new Map()

  /*
   * The same pass, written a second way, for the SVG.
   *
   * A fill is not a line and a triangle soup has no outline, so an exporter
   * given only `lids` can write nothing a plotter can hatch. What it needs is
   * the lattice itself — which cell belongs to which area, at what height, in
   * what ink — and `traceAreaRings` walks that into closed rings. Building it
   * here rather than in the exporter is what keeps the walk off the main thread
   * and puts the arrays in the worker's transfer list.
   *
   * The lattice is keyed by **ink**, not by the caller's region. Those are not
   * the same thing and the difference is large: Watershed deals ten inks to
   * however many catchments survive the fold, so two neighbouring basins often
   * hold the same colour. Keyed by region they trace as two shapes with a shared
   * seam and a doubled stroke — 31 189 of them on the reference plate, against
   * the ten flat areas the screen shows. Keyed by ink they merge, which is both
   * what the picture looks like and the shape a hatch fill wants.
   *
   * The key is the ink rounded to 8 bits, so it cannot disagree with the hex the
   * exporter writes. The ink itself is the region's *base* colour, without the
   * per-cell grain Mineral adds or the dither Indexed adds, so this does not
   * reintroduce the every-cell-is-its-own-area problem `regionFn` exists to
   * avoid.
   */
  const lw = Math.ceil(cols / step)
  const lh = Math.ceil(rows / step)
  const areaRegion = new Int32Array(lw * lh).fill(-1)
  const areaElev = new Float32Array(lw * lh)
  const areaInk = []
  const denseOf = new Map()

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const col = colorFn(i, r, c, elev)
      if (!col) continue
      colAt.set(i, col); elevAt.set(i, elev)
      // The stroke takes the region's *base* ink, without the per-cell grain or
      // relief shading the fill carries. Those modulate every cell separately,
      // so using the fill colour put 703 near-identical greens into a Mineral
      // plot — true to the screen and useless as a drawing. Five materials
      // should plot as five inks.
      if (inkFn) inkAt.set(i, inkFn(i, r, c, elev))
      // What counts as "the same area" is the *region*, not the pixel colour.
      // Mineral grains every cell so no two neighbours are byte-identical, and
      // Indexed dithers between two entries on purpose — comparing colours made
      // every single cell edge a boundary and handed a plotter the grid it was
      // supposed to avoid. Modes that have no such distinction pass none, and
      // the colour is the region.
      if (regionFn) regAt.set(i, regionFn(i, r, c, elev))

      const ink = inkAt.get(i) ?? col
      const key = (Math.round(ink[0] * 255) << 16) | (Math.round(ink[1] * 255) << 8) |
                   Math.round(ink[2] * 255)
      let dense = denseOf.get(key)
      if (dense === undefined) {
        dense = areaInk.length / 3
        denseOf.set(key, dense)
        areaInk.push(ink[0], ink[1], ink[2])
      }
      const li = (r / step) * lw + c / step
      areaRegion[li] = dense
      areaElev[li] = elev
    }
  }

  const lidP = new F32List(), lidC = new F32List(), lidI = new U32List()
  const outP = new F32List(), outC = new F32List()
  let lidV = 0

  // Two colours are "the same ink" only if they are the same ink. These come
  // from a palette or a material table, so an exact compare is right — a
  // tolerance would merge two adjacent palette entries and lose the boundary
  // that is the entire point of the drawing.
  const sameCol = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
  const same = regionFn
    ? (i, j) => regAt.has(j) && regAt.get(i) === regAt.get(j)
    : (i, j) => sameCol(colAt.get(i), colAt.get(j))

  for (const [i, col] of colAt) {
    const r = (i / cols) | 0, c = i % cols
    const elev = elevAt.get(i)
    const ink = inkAt.get(i) ?? col
    const wx = c * scl - halfW, wz = r * scl - halfH

    lidP.push6(wx - half, elev, wz - half, wx + half, elev, wz - half)
    lidP.push6(wx + half, elev, wz + half, wx - half, elev, wz + half)
    for (let v = 0; v < 4; v++) lidC.pushRgb(col)
    lidI.push3(lidV, lidV + 1, lidV + 2); lidI.push3(lidV, lidV + 2, lidV + 3)
    lidV += 4

    /*
     * The stroke half of the drawing, and the only half that plots.
     *
     * A fill is not a line, so these modes exported an empty SVG — the exporter
     * reads strokes and never looks at `lids`. Emitting all four sides of every
     * cell would fix that and hand a plotter a wall of grid lines, so only the
     * edges where the ink actually changes are drawn: the outline of each
     * region rather than of each square. On Watershed those edges are the
     * divides, on Mineral the material boundaries, on Indexed the band steps.
     *
     * East and south only, plus the two far sides where a neighbour is missing.
     * Every interior edge is shared by exactly two cells, and two directions
     * visit each edge once — the same argument Bitplane's staircase makes.
     *
     * Each segment carries the colour of the region it bounds, not a single pen.
     * A flat outline colour was the first version and it exported a monochrome
     * drawing: the SVG reads the per-vertex buffer and never looks at the fills,
     * so one pen there meant Watershed plotted as one colour and Mineral as
     * black. The boundary is the only thing that leaves this mode, so it has to
     * be the thing that carries the map.
     */
    const iE = i + step, iS = (r + step) * cols + c
    if (!colAt.has(iE) || !same(i, iE)) {
      outP.push6(wx + half, elev, wz - half, wx + half, elev, wz + half)
      outC.pushRgb2(ink)
    }
    if (!colAt.has(iS) || !same(i, iS)) {
      outP.push6(wx - half, elev, wz + half, wx + half, elev, wz + half)
      outC.pushRgb2(ink)
    }
    // The other two sides only where nothing is there to have drawn them.
    if (c - step < 0 || !colAt.has(i - step)) {
      outP.push6(wx - half, elev, wz - half, wx - half, elev, wz + half)
      outC.pushRgb2(ink)
    }
    if (r - step < 0 || !colAt.has((r - step) * cols + c)) {
      outP.push6(wx - half, elev, wz - half, wx + half, elev, wz - half)
      outC.pushRgb2(ink)
    }
  }

  return {
    lids: lidI.length > 0
      ? {
          positions: lidP.toArray(), colors: lidC.toArray(), indices: lidI.toArray(),
          // These quads lie *in* the terrain, not on top of it: each one is flat
          // at its cell's own elevation while the surface between cells is
          // interpolated, so the corners are genuinely inside the hill. They
          // need the depth bias an area fill takes, not the one a pillar cap
          // takes — see `lidMat` in HeightmapLines.
          hugsSurface: true,
        }
      : null,
    positions: outP.toArray(),
    colors: outC.toArray(),
    areas: colAt.size > 0
      ? {
          lw, lh, step, scl, halfW, halfH, half,
          region: areaRegion, elev: areaElev, inks: new Float32Array(areaInk),
        }
      : null,
  }
}

/**
 * Marching-squares isolines over the elevation field, in world coordinates.
 *
 * `buildContours` does this and a great deal more — labels, major/minor phase,
 * Chaikin, border closing. Outrun wants none of that and would have to unpick
 * it, so it takes the primitive directly. Interpolation is kept: these
 * are curves, and the whole point of Bitplane is what happens without it.
 *
 * Returns one entry per level: { lv, pts } with pts as flat [x0,z0,x1,z1,…].
 */
function isoLevels(terrain, p, levels) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minElev, maxElev } = terrain
  const { elevScale, jitterAmt } = p
  const n = Math.max(2, Math.min(64, Math.round(levels ?? 12)))
  const E = new Float32Array(rows * cols)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      E[r * cols + c] = cellElev(grid, r, c, cols, elevScale, jitterAmt)

  const out = []
  for (let k = 1; k < n; k++) {
    const t = k / n
    const lv = minElev + t * (maxElev - minElev)
    const pts = new F32List()
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const i00 = r * cols + c, i10 = i00 + 1, i01 = i00 + cols, i11 = i01 + 1
        if (!gridMask[i00] || !gridMask[i10] || !gridMask[i01] || !gridMask[i11]) continue
        const a = E[i00], b = E[i10], d = E[i11], e = E[i01]
        let code = 0
        if (a > lv) code |= 8
        if (b > lv) code |= 4
        if (d > lv) code |= 2
        if (e > lv) code |= 1
        if (code === 0 || code === 15) continue
        const ip = (v0, v1) => (lv - v0) / ((v1 - v0) || 1e-9)
        const T = [c + ip(a, b), r], R = [c + 1, r + ip(b, d)]
        const B = [c + ip(e, d), r + 1], L = [c, r + ip(a, e)]
        const emit = (u, v) => {
          pts.push3(u[0] * scl - halfW, lv, u[1] * scl - halfH)
          pts.push3(v[0] * scl - halfW, lv, v[1] * scl - halfH)
        }
        switch (code) {
          case 1: case 14: emit(L, B); break
          case 2: case 13: emit(B, R); break
          case 3: case 12: emit(L, R); break
          case 4: case 11: emit(T, R); break
          case 6: case 9:  emit(T, B); break
          case 7: case 8:  emit(L, T); break
          case 5:  emit(L, T); emit(B, R); break
          case 10: emit(T, R); emit(L, B); break
        }
      }
    }
    if (pts.length > 0) out.push({ lv, t, pts: pts.toArray() })
  }
  return out
}

/**
 * One frequency-modulated ink separation.
 *
 * A traditional halftone is *amplitude*-modulated — one grid, bigger dots for
 * more ink — and this engine cannot do that: `layerStyle` resolves one `weight`
 * for a whole layer, so every dot in a pen is the same size. The screens are
 * frequency-modulated instead, fixed dot and varying density, which is what
 * modern presses use anyway. The rotated angles are still what keeps three of
 * them from moiréing against each other.
 *
 * `coverage(i, r, c, elev)` returns 0–1. Returns the accepted dot positions in
 * grid coordinates so a caller can post-process them, which is what the ink
 * limit needs.
 */
function screenInk(terrain, p, o, coverage) {
  const { grid, gridMask, rows, cols, scl, minElev, maxElev } = terrain
  const { elevScale, jitterAmt, elevMinCut, elevMaxCut } = p
  const pitch = Math.max(0.5, (o.pitch ?? 2) / scl)
  const th = ((o.angle ?? 0) * Math.PI) / 180
  const cs = Math.cos(th), sn = Math.sin(th)
  const gam = Math.max(0.05, o.gamma ?? 1)
  const rng = mulberry32(((o.seed ?? 42) * 2654435761) >>> 0)
  const dx = (o.dx ?? 0) / scl, dy = (o.dy ?? 0) / scl
  const diag = Math.hypot(rows, cols)
  const dots = []

  for (let v = -diag; v < diag; v += pitch) {
    for (let u = -diag; u < diag; u += pitch) {
      const fc = u * cs - v * sn + cols / 2 + dx
      const fr = u * sn + v * cs + rows / 2 + dy
      const c = Math.round(fc), r = Math.round(fr)
      const j = rng()
      if (r < 0 || c < 0 || r >= rows || c >= cols) continue
      const i = r * cols + c
      if (!gridMask[i]) continue
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minElev, maxElev, elevMinCut, elevMaxCut)) continue
      const cov = Math.pow(Math.max(0, Math.min(1, coverage(i, r, c, elev))), gam)
      if (cov <= j) continue
      dots.push(fc, fr, elev, cov)
    }
  }
  return dots
}

/** Dots (grid coords) → a point layer. */
function dotsToLayer(terrain, dots, col, keep = null) {
  const { scl, halfW, halfH } = terrain
  const positions = new F32List(), colors = new F32List()
  for (let k = 0; k < dots.length; k += 4) {
    if (keep && !keep[k / 4]) continue
    const x = dots[k] * scl - halfW, z = dots[k + 1] * scl - halfH, y = dots[k + 2]
    positions.push6(x, y, z, x + 1e-4, y, z)
    colors.pushRgb2(col)
  }
  return { positions: positions.toArray(), colors: colors.toArray(), isPoints: true }
}

/**
 * The value at percentile `q` of a field, over valid cells only.
 *
 * Every threshold in these modes was a fraction of the field's *maximum* first,
 * and every one of them was wrong for the same reason the Fall Line gravity was:
 * a maximum is set by one outlier cell, so on a plate with a single cliff the
 * whole terrain reads as flat and a five-way classifier returns one class. A
 * percentile is stable against that and still scales with the terrain.
 *
 * Sampled on a stride rather than sorted whole — this decides a threshold, not a
 * value, and a 4k raster does not need every cell to find its 60th percentile.
 */
function percentileOf(field, gridMask, q) {
  const s = []
  for (let i = 0; i < field.length; i += 7) {
    if (gridMask && !gridMask[i]) continue
    const v = field[i]
    if (Number.isFinite(v)) s.push(v)
  }
  if (s.length === 0) return 0
  s.sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

/**
 * Rescale a field to 0–1 between two of its own percentiles.
 *
 * A screened ink needs its coverage to use the whole range or the plate comes
 * out as one flat tint: on real terrain the raw fields occupy a narrow band, and
 * a gamma applied to a band still gives a band.
 */
function stretchField(field, gridMask, lo, hi) {
  const a = percentileOf(field, gridMask, lo), b = percentileOf(field, gridMask, hi)
  const r = (b - a) || 1
  return (v) => Math.max(0, Math.min(1, (v - a) / r))
}

/**
 * A palette of N discrete inks, sampled off the shared gradient.
 *
 * The alternative was a per-mode array of colour stops, which `geometryKey`
 * cannot represent — it stringifies, so every edit inside one would be invisible
 * to the rebuild. `gradientStops` already solved that by living in
 * GEOMETRY_NON_SCALAR, so the colour modes borrow it rather than adding a second
 * exception. Quantising it *is* the palette: the editor is the one already on
 * screen, and a sixteen-entry ramp is what a sixteen-colour machine had.
 */
function quantPalette(p, n) {
  const stops = p.gradientStops
  const out = new Array(n)
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0.5 : k / (n - 1)
    const c = sampleGradient(stops, t)
    out[k] = [c[0], c[1], c[2]]      // sampleGradient pools its result; copy it
  }
  return out
}

/**
 * 01 · INDEXED — colour as a two-dimensional lookup.
 *
 * A hypsometric ramp answers one question, "how high", and cannot tell a
 * snowfield from the cliff beside it because both are high. The index here is
 * two-dimensional — elevation tier by slope class — so those two get different
 * inks, and that separation is what makes the plate read as terrain rather than
 * as a heat map.
 *
 * Between two adjacent elevation entries there is no blend, there is a 4×4 Bayer
 * screen: alternating cells of two inks reading, at arm's length, as a third the
 * palette does not contain. That artefact is the aesthetic. It is what a
 * sixteen-colour machine did when asked for a sky.
 *
 * The dual of Bitplane, deliberately: that mode quantises *geometry* and leaves
 * colour continuous, this quantises *colour* and leaves geometry continuous.
 * They stack.
 */
export function buildIndexed(terrain, p, o) {
  const { rows, cols, gridSlopes, maxSlope } = terrain
  const nE = Math.max(2, Math.min(16, Math.round(o.tiers ?? 6)))
  const nS = Math.max(1, Math.min(4, Math.round(o.slopeBands ?? 2)))
  const dither = Math.max(0, Math.min(1, o.dither ?? 1))
  const shift = Math.max(0, Math.min(1, o.steepShift ?? 0.35))
  const pal = quantPalette(p, nE)

  // The slope axis shifts the entry along the same ramp rather than needing a
  // second palette — one gradient, two dimensions read out of it.
  const entry = (e, s) => {
    const t = nE === 1 ? 0 : e / (nE - 1)
    const k = Math.round(Math.min(1, t + (s / Math.max(1, nS)) * shift) * (nE - 1))
    return pal[Math.max(0, Math.min(nE - 1, k))]
  }

  const { tier } = quantiseTiers(terrain, p, nE)
  // The region is the *undithered* entry: the dither is there for the screen,
  // and a plot of it would be noise rather than bands.
  const entryOf = (i) => {
    const t = tier[i]
    if (t < 0) return -1
    const sN = Math.min(0.999, gridSlopes[i] / (maxSlope || 1))
    return t * nS + Math.floor(Math.pow(sN, 0.6) * nS)
  }
  const cells = fillCells(terrain, p, o.spacing, (i, r, c) => {
    const t = tier[i]
    if (t < 0) return null
    const sN = Math.min(0.999, gridSlopes[i] / (maxSlope || 1))
    const s = Math.floor(Math.pow(sN, 0.6) * nS)
    let e = t
    // Dither toward the entry above, on how far up its own band the cell sits.
    const frac = residual(terrain, p, i, nE)
    if (frac * dither > (BAYER4[(r & 3) * 4 + (c & 3)] + 0.5) / 16) e = Math.min(nE - 1, e + 1)
    return entry(e, s)
  }, entryOf, (i) => {
    const k = entryOf(i)
    if (k < 0) return null
    return entry(Math.floor(k / nS), k % nS)
  })
  void rows; void cols
  return { positions: cells.positions, colors: cells.colors, lids: cells.lids, areas: cells.areas }
}

/** How far up its own band a cell sits — the residual the dither screens on. */
function residual(terrain, p, i, nT) {
  const { grid, cols, minElev, maxElev } = terrain
  const { elevScale, jitterAmt } = p
  const r = (i / cols) | 0, c = i % cols
  const ne = normElev(cellElev(grid, r, c, cols, elevScale, jitterAmt), minElev, maxElev)
  return ne * nT - Math.floor(ne * nT)
}

/**
 * 02 · OUTRUN — light that adds.
 *
 * Every line in this tool blends normally, which is why nothing in it has ever
 * looked like it was emitting. Neon is not a colour, it is a *summation*: a wide
 * dim halo in additive composite, a thin near-white filament on top, and the
 * arithmetic does the rest. Where contours crowd, the halos sum and the ground
 * between them lifts to a glowing plane; out on an open face a single line hangs
 * alone in the dark.
 *
 * The two halves have to be two layers, and not for tidiness: `layerStyle`
 * resolves one `weight` per layer, so a fat halo under a thin core is
 * structurally impossible in one. That constraint is the design.
 */
export function buildOutrun(terrain, p, o) {
  const rings = isoLevels(terrain, p, o.levels)
  const core = { P: new F32List(), C: new F32List() }
  const glow = { P: new F32List(), C: new F32List() }
  const whiten = Math.max(0, Math.min(1, o.whiten ?? 0.75))

  for (const ring of rings) {
    const hue = computeVertexColor(ring.t, 0, 0, p)
    const hot = [hue[0] + (1 - hue[0]) * whiten,
                 hue[1] + (1 - hue[1]) * whiten,
                 hue[2] + (1 - hue[2]) * whiten]
    for (let i = 0; i < ring.pts.length; i += 6) {
      core.P.push6(ring.pts[i], ring.pts[i+1], ring.pts[i+2],
                   ring.pts[i+3], ring.pts[i+4], ring.pts[i+5])
      glow.P.push6(ring.pts[i], ring.pts[i+1], ring.pts[i+2],
                   ring.pts[i+3], ring.pts[i+4], ring.pts[i+5])
      core.C.pushRgb2(hot)
      glow.C.pushRgb2(hue)
    }
  }
  return {
    'Outrun-Glow': { positions: glow.P.toArray(), colors: glow.C.toArray() },
    'Outrun-Core': { positions: core.P.toArray(), colors: core.C.toArray() },
  }
}

/**
 * RISO — separations that overprint, and a press that refuses.
 *
 * Three spot inks, each carrying a different reading of the terrain, each
 * screened at its own angle. They are not composed, they are *overprinted*:
 * every colour past the first three is one the machine never held. Pink over
 * aqua is a bruised violet, aqua over yellow a sharp green. Multiply blending is
 * what makes that work, and it wants paper — on a dark ground three light inks
 * multiply to mud.
 *
 * Two controls decide which machine you are printing on, and they are the whole
 * range of the mode:
 *
 *  • **Registration.** At any offset above zero the plates sit a hair apart —
 *    the tell of a real duplicator, and the reason it does not read as a
 *    computer's idea of print. At zero they are in perfect register, like a
 *    press.
 *
 *  • **Coverage cap.** A real press has a total-area-coverage ceiling: past it
 *    the sheet cannot dry, so the shadows are pulled back — and they go
 *    strangely flat and slightly wrong-coloured, because the ink removed is
 *    whichever was contributing least. At the top of its range the cap cannot
 *    bind (three inks cannot exceed 3.0) and the mode prints everything.
 *
 * This was two modes. They shared the screening, the angles, the blending, the
 * dots and all three fields, and differed only in those two knobs — which is not
 * two modes, it is one with its range unexplored.
 *
 * A traditional halftone is *amplitude*-modulated — one grid, bigger dots for
 * more ink — and this engine cannot do that: `layerStyle` resolves one `weight`
 * for a whole layer, so every dot in a pen is the same size. The screens are
 * frequency-modulated instead, fixed dot and varying density, which is what
 * modern presses use anyway. The rotated angles are still what keeps three of
 * them from moiréing against each other.
 */
export function buildRiso(terrain, p, o) {
  const { cols, gridSlopes, minElev, maxElev } = terrain
  const lam = lambertDarkness(terrain, o.azimuth ?? 315, 1, p.elevScale, 0)
  // Each separation is stretched to its own range first. Raw, the three fields
  // occupy narrow and *different* bands on real terrain, so one ink covers the
  // sheet while the other two barely print — measured on the sample plate, the
  // shadow ink alone was most of the coverage.
  const sSlope = stretchField(gridSlopes, terrain.gridMask, 0.04, 0.96)
  const sLam   = stretchField(lam, terrain.gridMask, 0.04, 0.96)
  const off = o.offset ?? 0
  const inks = [
    { id: 'Riso-A', col: o.colorA, field: (i, r, c, e) => normElev(e, minElev, maxElev),
      angle: 15, gamma: o.gammaA, dx: off, dy: -off * 0.7 },
    { id: 'Riso-B', col: o.colorB, field: (i) => sSlope(gridSlopes[i]),
      angle: 45, gamma: o.gammaB, dx: -off * 0.9, dy: off },
    { id: 'Riso-C', col: o.colorC, field: (i) => 1 - sLam(lam[i]),
      angle: 75, gamma: o.gammaC, dx: off * 0.5, dy: off * 1.2 },
  ]

  const placed = inks.map((ink, k) => screenInk(terrain, p, {
    pitch: o.pitch, angle: ink.angle, gamma: ink.gamma,
    dx: ink.dx, dy: ink.dy, seed: (o.seed ?? 42) + k * 101,
  }, ink.field))

  /*
   * The clamp, over the three coverages that actually landed on each cell — a
   * dot that was never placed cannot be the one to drop.
   *
   * Scope worth stating: this limits the three inks *this mode* lays down. A
   * limit across every enabled layer in the scene has no home in the
   * architecture, because nothing between the builders and the renderer sees all
   * the layers at once while their coverage is still known.
   */
  const TAC = o.limit ?? RISO_TAC_OFF
  const keep = placed.map((dots) => new Uint8Array(dots.length / 4).fill(1))
  if (TAC < RISO_TAC_OFF) {
    const cellDots = new Map()
    placed.forEach((dots, plate) => {
      for (let k = 0; k < dots.length; k += 4) {
        const key = Math.round(dots[k + 1]) * cols + Math.round(dots[k])
        if (!cellDots.has(key)) cellDots.set(key, [])
        cellDots.get(key).push({ plate, idx: k / 4, cov: dots[k + 3] })
      }
    })
    for (const [, list] of cellDots) {
      let total = 0
      for (const d of list) total += d.cov
      if (total <= TAC) continue
      list.sort((a, b) => a.cov - b.cov)     // cheapest ink goes first
      for (const d of list) {
        if (total <= TAC) break
        keep[d.plate][d.idx] = 0
        total -= d.cov
      }
    }
  }

  const out = {}
  inks.forEach((ink, k) => {
    out[ink.id] = dotsToLayer(terrain, placed[k], hexToRgb(ink.col), keep[k])
  })
  return out
}

/**
 * 24 · MINERAL — a field map, not a ramp.
 *
 * Colour that means a rock type rather than a height. Slope and curvature pick a
 * material, each material carries a flat colour, and each carries its own noise
 * tooth — so the surfaces differ in texture as well as hue, the way a geological
 * survey sheet distinguishes them.
 *
 * The classifier is deliberately coarse and table-driven: five classes is what a
 * legend can hold, and the thresholds are percentiles of the terrain's own slope
 * so the same settings read on a quarry and an alp.
 */
export function buildMineral(terrain, p, o) {
  const { grid, gridMask, rows, cols, gridSlopes, maxSlope, minElev, maxElev } = terrain
  const { elevScale, jitterAmt } = p

  // Curvature, smoothed — a raw second difference classifies noise.
  const blurred = boxBlur(grid, cols, rows, Math.max(1, Math.round(o.radius ?? 2)),
                          terrain.hasNoData ? gridMask : null)
  const curv = new Float32Array(rows * cols)
  let cMax = 1e-9
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      const v = Math.abs(blurred[i - 1] + blurred[i + 1] + blurred[i - cols] + blurred[i + cols]
                         - 4 * blurred[i])
      curv[i] = v
      if (v > cMax) cMax = v
    }
  }

  const cols5 = [o.colorA, o.colorB, o.colorC, o.colorD, o.colorE].map(hexToRgb)
  const grain = Math.max(0, Math.min(1, o.grain ?? 0.28))

  // Both cuts are percentiles of this terrain's own distribution. Against
  // `maxSlope` a single cliff cell set the scale and every other cell fell into
  // one class — measured on the sample plate, five materials came out as one.
  const qSteep = Math.max(0.02, Math.min(0.98, o.steep ?? 0.62))
  const qBroken = Math.max(0.02, Math.min(0.98, o.broken ?? 0.45))
  const tSteep = percentileOf(gridSlopes, gridMask, qSteep)
  const tScree = percentileOf(gridSlopes, gridMask, qSteep * 0.55)
  const tBroken = percentileOf(curv, gridMask, qBroken)

  // Named once so the fill and the boundary agree on what a material is.
  const classOf = (i, elev) => {
    const s = gridSlopes[i], k = curv[i]
    if (s > tSteep) return k > tBroken ? 0 : 1            // rock face / massive rock
    if (s > tScree) return k > tBroken ? 2 : 3            // scree / bench
    return normElev(elev ?? cellElev(grid, (i / cols) | 0, i % cols, cols, elevScale, jitterAmt),
                    minElev, maxElev) > 0.6 ? 4 : 3
  }

  const cells = fillCells(terrain, p, o.spacing, (i, r, c, elev) => {
    const m = classOf(i, elev)
    const base = cols5[m]
    // Each material has its own tooth: the same hash, seeded by the class.
    const g = 1 - grain * 0.5 + grain * jitterNoise(c + m * 37, r + m * 91)
    return [Math.min(1, base[0] * g), Math.min(1, base[1] * g), Math.min(1, base[2] * g)]
  }, (i) => classOf(i), (i, r, c, elev) => cols5[classOf(i, elev)])
  void elevScale; void jitterAmt; void maxSlope; void cMax
  return { positions: cells.positions, colors: cells.colors, lids: cells.lids, areas: cells.areas }
}

/**
 * 34 · COVER — colour by what the ground actually is.
 *
 * Every other colour mode in this app derives its palette from the shape of the
 * land: Mineral classifies by slope and curvature, Indexed by elevation tier,
 * Watershed by which way water runs. They are all, in the end, the heightmap
 * wearing different clothes. This one is not — it inks a fact the heightmap does
 * not contain, which is why a quarry and the spruce stand beside it can come out
 * as different materials even where they are the same gradient.
 *
 * ── Two sources, one geometry ────────────────────────────────────────────────
 * **Plate** inks each cell with its own colour, taken from the imagery the
 * classes were cut from. It is continuous and it is the one that looks like a
 * photograph of the ground rather than a map of it.
 *
 * **Class** inks each cell with its class's single flat colour, which is the
 * same picture with the variation taken out — closer to a printed land-use
 * sheet, and the one to reach for when the plate is going to be plotted.
 *
 * Both deal *regions* by class, not by colour. That is what keeps the SVG
 * honest: `traceAreaRings` needs areas to hatch, and a plate keyed by its own
 * per-cell colour would trace a hundred and sixty thousand of them.
 */
export function buildCover(terrain, p, o) {
  const { gridClass, gridPlate, cols } = terrain
  // Nothing loaded is not an error — it is a layer that has nothing to draw, and
  // the panel says so where the switch is rather than here.
  if (!gridClass) return null

  const palette = (terrain.classColors ?? []).map(hexToRgb)
  const fallback = hexToRgb(o.color ?? '#888888')
  const usePlate = o.source !== 'class' && Boolean(gridPlate)
  const grain = Math.max(0, Math.min(1, o.grain ?? 0))

  const inkOf = (i) => palette[gridClass[i]] ?? fallback

  const cells = fillCells(terrain, p, o.spacing,
    (i, r, c) => {
      const base = usePlate
        ? [gridPlate[i * 3] / 255, gridPlate[i * 3 + 1] / 255, gridPlate[i * 3 + 2] / 255]
        : inkOf(i)
      if (!grain) return base
      // The same hash Mineral uses, seeded by the class, so two materials that
      // happen to share a tone still read as two surfaces.
      const m = gridClass[i]
      const g = 1 - grain * 0.5 + grain * jitterNoise(c + m * 37, r + m * 91)
      return [Math.min(1, base[0] * g), Math.min(1, base[1] * g), Math.min(1, base[2] * g)]
    },
    (i) => gridClass[i],
    (i) => inkOf(i))

  void cols
  return { positions: cells.positions, colors: cells.colors, lids: cells.lids, areas: cells.areas }
}

/**
 * 25 · WATERSHED — colour by catchment.
 *
 * Big flat areas of unmixed colour with hard edges along the divides, so the
 * picture is a map of where water goes rather than of how high anything is. The
 * boundaries are ridgelines, which is why they look drawn rather than imposed.
 *
 * The machinery already exists: Stream Network walks exactly this graph to
 * accumulate flow. Here every cell walks steepest descent to a sink and inherits
 * that sink's label — the same D8 traversal, read for identity instead of for
 * volume. Small basins are folded into their neighbour so a plate is a dozen
 * areas of colour rather than a thousand.
 */
export function buildWatershed(terrain, p, o) {
  const { grid, gridMask, rows, cols, minElev, maxElev } = terrain
  const { elevScale, jitterAmt } = p
  void jitterAmt
  const n = rows * cols

  // D8 on a raw DEM finds a pit at every dimple: measured on the sample plate
  // that gave thousands of one-cell basins and the plate came out as confetti.
  // The walk runs on a blurred grid for the same reason Ridge and Curvature
  // blur before differentiating — a divide is a ridge, and a ridge is a second
  // derivative in disguise.
  const smoothed = boxBlur(grid, cols, rows, Math.max(0, Math.round(o.radius ?? 3)),
                           terrain.hasNoData ? gridMask : null)
  const E = new Float32Array(n)
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      E[r * cols + c] = (smoothed[r * cols + c] - 0.5) * 100 * elevScale

  const label = new Int32Array(n).fill(-1)
  const stack = new Int32Array(Math.min(n, 1 << 20))
  let nextLabel = 0
  const sizes = []

  for (let start = 0; start < n; start++) {
    if (label[start] >= 0 || !gridMask[start]) continue
    let cur = start, sp = 0
    for (;;) {
      if (label[cur] >= 0) break
      if (sp < stack.length) stack[sp++] = cur
      const c = cur % cols, r = (cur / cols) | 0
      let best = cur, bv = E[cur]
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc
          if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue
          const q = nr * cols + nc
          if (!gridMask[q]) continue
          if (E[q] < bv) { bv = E[q]; best = q }
        }
      }
      if (best === cur) { label[cur] = nextLabel++; sizes.push(0); break }
      cur = best
    }
    const lab = label[cur]
    for (let k = 0; k < sp; k++) label[stack[k]] = lab
  }
  for (let i = 0; i < n; i++) if (label[i] >= 0) sizes[label[i]]++

  // A thousand one-cell basins is noise, not a map. Anything under the minimum
  // area is re-pointed at the largest basin touching it.
  const minArea = Math.max(1, Math.round((o.minBasin ?? 0.4) / 100 * n))
  const remap = new Int32Array(sizes.length)
  for (let k = 0; k < sizes.length; k++) remap[k] = k
  if (minArea > 1) {
    const bestNbr = new Int32Array(sizes.length).fill(-1)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const a = label[i]
        if (a < 0 || sizes[a] >= minArea) continue
        for (const q of [i + 1, i + cols]) {
          if (q >= n) continue
          const b = label[q]
          if (b < 0 || b === a) continue
          if (bestNbr[a] < 0 || sizes[b] > sizes[bestNbr[a]]) bestNbr[a] = b
        }
      }
    }
    for (let k = 0; k < sizes.length; k++) if (sizes[k] < minArea && bestNbr[k] >= 0) remap[k] = bestNbr[k]
    // A small basin can be folded into a neighbour that is itself small, so the
    // chain has to be followed rather than stepped once — with path compression,
    // because without it this is O(basins²) and a real DEM has tens of thousands
    // of pits. Walking the chain naively hung the worker outright.
    //
    // Two mutually-small basins would point at each other and spin, so a
    // fold-in is only accepted when it strictly increases the target's size or
    // breaks the tie by index. That makes the graph a forest, which is what
    // makes compression terminate.
    for (let k = 0; k < sizes.length; k++) {
      const t = remap[k]
      if (t !== k && !(sizes[t] > sizes[k] || (sizes[t] === sizes[k] && t < k))) remap[k] = k
    }
    for (let k = 0; k < sizes.length; k++) {
      let root = k
      while (remap[root] !== root) root = remap[root]
      let cur = k
      while (remap[cur] !== root) { const nx = remap[cur]; remap[cur] = root; cur = nx }
    }
  }

  const pal = quantPalette(p, Math.max(2, Math.min(24, Math.round(o.inks ?? 10))))
  const rng = mulberry32(((o.seed ?? 11) * 2654435761) >>> 0)
  const pick = new Int32Array(sizes.length)
  for (let k = 0; k < sizes.length; k++) pick[k] = Math.floor(rng() * pal.length)

  const shade = Math.max(0, Math.min(1, o.shade ?? 0.32))
  const lam = shade > 0 ? lambertDarkness(terrain, o.azimuth ?? 315, 1, elevScale, 0) : null

  const cells = fillCells(terrain, p, o.spacing, (i) => {
    const l = label[i]
    if (l < 0) return null
    const c = pal[pick[remap[l]] % pal.length]
    if (!lam) return c
    const v = 1 - shade * lam[i]
    return [c[0] * v, c[1] * v, c[2] * v]
  }, (i) => (label[i] < 0 ? -1 : remap[label[i]]),
     (i) => (label[i] < 0 ? null : pal[pick[remap[label[i]]] % pal.length]))
  void minElev; void maxElev
  return { positions: cells.positions, colors: cells.colors, lids: cells.lids, areas: cells.areas }
}

/**
 * The landform of every cell, for the Landforms mode, the per-mode landform
 * masks and the Form colour source alike (see utils/landforms.js).
 *
 * Read with the Landforms mode's own settings whether or not the mode is on,
 * so a mask and the mode beside it always agree on where the ridges are. Kept
 * for the next build while the ground and the settings are the same: a
 * rebuild that only moved a line should not walk eight lines from every cell.
 */
let formCache = { key: null, grid: null, forms: null }
export function landformGrid(terrain, p) {
  const { grid, gridMask, rows, cols } = terrain
  const g = groundMetres(terrain, p, p.cellMetresLandform, p.reliefLandform)
  const key = `${g.key}|${rows}x${cols}|${p.searchLandform}|${p.flatLandform}|${p.radiusLandform}`
  if (formCache.grid === grid && formCache.key === key) return formCache.forms
  // Blurred first, as Mineral and Watershed blur before they classify: on raw
  // heights every grain of sensor noise turns a cell into a pit or a peak, and
  // a mask cut from that is confetti.
  const blur = Math.max(0, Math.round(p.radiusLandform ?? 2))
  const raw = g.ground().heights
  const heights = blur ? boxBlur(raw, cols, rows, blur, terrain.hasNoData ? gridMask : null) : raw
  const forms = geomorphons(heights, gridMask, rows, cols, g.cellX, g.cellY,
                            p.searchLandform ?? 300, p.flatLandform ?? 1)
  formCache = { key, grid, forms }
  return forms
}

/** The ten landform inks of a style block, lettered A to J. */
export function landformInks(p) {
  return LANDFORMS.map((f, k) => p[`color${'ABCDEFGHIJ'[k]}Landform`] ?? f.color)
}

/**
 * 58 · LANDFORMS — the ground as ten shapes: flat, peak, ridge, shoulder,
 * spur, slope, hollow, footslope, valley, pit.
 *
 * Classified by geomorphons (utils/landforms.js) and drawn as flat areas, one
 * ink per landform, the way Mineral draws its materials: the SVG traces each
 * landform as closed areas that a plotter can hatch.
 */
export function buildLandform(terrain, p, o) {
  const forms = terrain.gridForm
  if (!forms) return null
  const inks = o.inks.map(hexToRgb)
  const inkOf = (i) => (forms[i] === NO_FORM ? null : inks[forms[i]])
  const cells = fillCells(terrain, p, o.spacing, inkOf, (i) => forms[i], inkOf)
  return { positions: cells.positions, colors: cells.colors, lids: cells.lids, areas: cells.areas }
}
