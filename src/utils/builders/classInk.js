/**
 * Land cover as a colour source, for any draw mode.
 *
 * Until this pass, only two modes could be inked by what the ground *is*: the
 * Land cover mode itself and Pillars. Every other mode took its colour from the
 * line style or the hypsometric ramp, so a contour across forest and scree was
 * one colour. Giving each builder the class lookup would have meant 40 call
 * sites of `computeVertexColor`, none of which knows its grid cell.
 *
 * It does not need to. Every vertex a builder emits has a world position, and a
 * world position is a cell: world X of cell c is `c·scl − halfW` (terrain.js),
 * so the cell is that inverted and rounded. One pass after the build recolours
 * any mode, and the same pass splits the layer by class — which is the part a
 * plotter needs, because one pen layer per class is one pen per class. Pillars
 * already does that split inside its builder; this is the same rule for the rest.
 *
 * ── Which class a segment belongs to ─────────────────────────────────────────
 * Its midpoint's. A segment is one stroke, and a stroke goes to one pen, so it
 * cannot follow a class boundary that runs through its middle. At the grid
 * spacing the builders work at, a segment spans about a cell, so the midpoint is
 * the honest choice and the error is under one cell.
 *
 * `class` writes the class ink on both ends. `plate` writes the plate colour at
 * each end's own cell, so the colour stays continuous along a line while the
 * pen still follows the class.
 *
 * Lids — the filled areas — are left as the builder made them: the source is a
 * stroke colour, as the hypsometric ramp has always been.
 */
import { hexToRgb } from '../colorUtils'
import { F32List } from './shared.js'

/** The two sources this pass serves. Any other `hypsoMode` is the builder's own. */
export const CLASS_INK_SOURCES = new Set(['class', 'plate'])

/** Modes that ink by class in their own builder, and must not be split twice. */
export const OWN_CLASS_INK = new Set(['Pillars', 'Cover'])

// What travels with a layer as a whole: on the first output layer only, as
// Pillars' `half()` does, so a fill, an occluder or a contour label set is not
// drawn once per class.
const WHOLE_LAYER = ['lids', 'occluder', 'labelAnchors', 'note']
// What every part must keep, because it says how its strokes are drawn.
const PER_PART = ['isPoints', 'selfOcclude']

/**
 * One builder layer → `{ [suffix]: layer }`, or null when there is nothing to do.
 *
 * The suffix is `Class<k>` for a class and `''` for the strokes on no class
 * (a no-data cell), which keep the builder's own colour and the layer's own id.
 */
export function inkByClass(res, terrain, source) {
  const { gridClass, gridPlate, gridMask, rows, cols, scl, halfW, halfH } = terrain ?? {}
  if (!gridClass || !CLASS_INK_SOURCES.has(source)) return null
  const P = res?.positions
  if (!P || P.length < 6) return null
  const C = res.colors?.length === P.length ? res.colors : null
  const usePlate = source === 'plate' && !!gridPlate
  const palette = (terrain.classColors ?? []).map(hexToRgb)

  const cellOf = (x, z) => {
    const c = Math.min(cols - 1, Math.max(0, Math.round((x + halfW) / scl)))
    const r = Math.min(rows - 1, Math.max(0, Math.round((z + halfH) / scl)))
    return r * cols + c
  }

  const parts = new Map()   // class index, or -1 for no class
  const partOf = (k) => {
    let t = parts.get(k)
    if (!t) { t = { positions: new F32List(), colors: new F32List() }; parts.set(k, t) }
    return t
  }

  for (let s = 0; s < P.length; s += 6) {
    const x0 = P[s], y0 = P[s + 1], z0 = P[s + 2]
    const x1 = P[s + 3], y1 = P[s + 4], z1 = P[s + 5]
    const mid = cellOf((x0 + x1) / 2, (z0 + z1) / 2)
    const k = gridMask && !gridMask[mid] ? -1 : gridClass[mid]
    const ink = k >= 0 ? palette[k] : null
    const t = partOf(ink || usePlate ? k : -1)
    t.positions.push6(x0, y0, z0, x1, y1, z1)
    if (k < 0 || (!ink && !usePlate)) {
      // No class here: the builder's own colour, unchanged.
      if (C) t.colors.push6(C[s], C[s + 1], C[s + 2], C[s + 3], C[s + 4], C[s + 5])
      else t.colors.push6(0, 0, 0, 0, 0, 0)
    } else if (usePlate) {
      const a = cellOf(x0, z0) * 3, b = cellOf(x1, z1) * 3
      t.colors.push6(gridPlate[a] / 255, gridPlate[a + 1] / 255, gridPlate[a + 2] / 255,
                     gridPlate[b] / 255, gridPlate[b + 1] / 255, gridPlate[b + 2] / 255)
    } else {
      t.colors.push6(ink[0], ink[1], ink[2], ink[0], ink[1], ink[2])
    }
  }

  const out = {}
  const keys = [...parts.keys()].sort((a, b) => a - b)
  for (const k of keys) {
    const t = parts.get(k)
    const layer = { positions: t.positions.toArray(), colors: t.colors.toArray() }
    for (const f of PER_PART) if (res[f] !== undefined) layer[f] = res[f]
    out[k < 0 ? '' : `Class${k}`] = layer
  }
  const first = out[keys[0] < 0 ? '' : `Class${keys[0]}`]
  for (const f of WHOLE_LAYER) if (res[f] !== undefined) first[f] = res[f]
  return out
}
