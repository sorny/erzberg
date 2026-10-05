/**
 * Landforms: every cell as one of ten shapes, by geomorphons.
 *
 * After Jasiewicz and Stepinski (2013), "Geomorphons — a pattern recognition
 * approach to classification and mapping of landforms", the method behind GRASS
 * `r.geomorphon`. A cell looks out along the eight compass lines, as far as the
 * search distance. Along each line it asks whether the ground rises above the
 * flatness angle (+), falls below it (−), or does neither (0). How many lines
 * fall and how many rise is the landform, read off the GRASS table below: eight
 * falling lines is a peak, eight rising lines a pit, none either way flat.
 *
 * It needs true angles, so it runs on heights and cell sizes in metres. The
 * search distance sets the scale: a short one finds every spur on a slope, a
 * long one finds the ridge the spurs belong to.
 *
 * A leaf module with no imports, so the worker, the panel and the tests can all
 * read the class list from one place.
 */

/** The ten landforms, in GRASS's order, with the inks the mode opens with. */
export const LANDFORMS = [
  { id: 'Flat',      name: 'Flat',      color: '#e9e3d3' },
  { id: 'Peak',      name: 'Peak',      color: '#4a1a10' },
  { id: 'Ridge',     name: 'Ridge',     color: '#a4462a' },
  { id: 'Shoulder',  name: 'Shoulder',  color: '#e0b27a' },
  { id: 'Spur',      name: 'Spur',      color: '#cf8550' },
  { id: 'Slope',     name: 'Slope',     color: '#cdbf9e' },
  { id: 'Hollow',    name: 'Hollow',    color: '#8fb3a6' },
  { id: 'Footslope', name: 'Footslope', color: '#bed3ae' },
  { id: 'Valley',    name: 'Valley',    color: '#3e7a8a' },
  { id: 'Pit',       name: 'Pit',       color: '#1b3a55' },
]

/** No data, or outside the stencil. */
export const NO_FORM = 255

const FL = 0, PK = 1, RI = 2, SH = 3, SP = 4, SL = 5, HL = 6, FS = 7, VL = 8, PT = 9, __ = NO_FORM

// forms[falling][rising], copied from GRASS r.geomorphon (geom.c). A cell sees
// eight lines, so the cells below the anti-diagonal cannot occur.
const FORMS = [
  /*        0   1   2   3   4   5   6   7   8   rising */
  /* 0 */ [FL, FL, FL, FS, FS, VL, VL, VL, PT],
  /* 1 */ [FL, FL, FS, FS, FS, VL, VL, VL, __],
  /* 2 */ [FL, SH, SL, SL, HL, HL, VL, __, __],
  /* 3 */ [SH, SH, SL, SL, SL, HL, __, __, __],
  /* 4 */ [SH, SH, SP, SL, SL, __, __, __, __],
  /* 5 */ [RI, RI, SP, SP, __, __, __, __, __],
  /* 6 */ [RI, RI, RI, __, __, __, __, __, __],
  /* 7 */ [RI, RI, __, __, __, __, __, __, __],
  /* 8 */ [PK, __, __, __, __, __, __, __, __],
]

const DIRS = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]]

/**
 * The landform of every cell.
 *
 * `heights` in metres, `cellX`/`cellY` the metres one cell spans across and
 * down, `search` the look-out distance in metres and `flat` the flatness angle
 * in degrees. A line stops at the edge of the data rather than reading the hole
 * as a cliff. Compared as slopes (rise over run) rather than angles: the order
 * is the same and it saves an arctangent per step.
 *
 * @returns {Uint8Array} an index into LANDFORMS per cell, or NO_FORM
 */
export function geomorphons(heights, mask, rows, cols, cellX, cellY, search = 300, flat = 1) {
  const out = new Uint8Array(rows * cols).fill(NO_FORM)
  const reach = Math.max(2, Math.min(40, Math.round(search / Math.min(cellX, cellY))))
  const tanFlat = Math.tan(Math.max(0, flat) * Math.PI / 180)
  const stepLen = DIRS.map(([dr, dc]) => Math.hypot(dr * cellY, dc * cellX))
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (mask && !mask[i]) continue
      const h0 = heights[i]
      let rising = 0, falling = 0
      for (let d = 0; d < 8; d++) {
        const [dr, dc] = DIRS[d]
        let up = -Infinity, down = Infinity
        for (let k = 1; k <= reach; k++) {
          const rr = r + dr * k, cc = c + dc * k
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) break
          const j = rr * cols + cc
          if (mask && !mask[j]) break
          const s = (heights[j] - h0) / (k * stepLen[d])
          if (s > up) up = s
          if (s < down) down = s
        }
        if (up === -Infinity) continue
        const isUp = up > tanFlat, isDown = down < -tanFlat
        // Both: the steeper of the two decides, as GRASS's compare does.
        if (isUp && (!isDown || up > -down)) rising++
        else if (isDown) falling++
      }
      out[i] = FORMS[falling][rising]
    }
  }
  return out
}

/**
 * Whether a per-mode landform mask lets class `k` through.
 *
 * The mask is a bit set over the ten classes; 0 means no mask at all, which is
 * every layer by default, so an old preset without the key draws as before.
 */
export function formMaskHas(mask, k) {
  return !mask || ((mask >> k) & 1) === 1
}

/** Every class switched on: the value a mask starts from when first touched. */
export const ALL_FORMS = (1 << LANDFORMS.length) - 1

/**
 * What a landform mask keeps, in the fewest words: "all", "ridge, valley",
 * "all but flat, pit", or "6 of 10" when neither list is short.
 */
export function formReadout(mask) {
  if (!mask) return 'all'
  const name = (f) => f.name.toLowerCase()
  const kept = LANDFORMS.filter((_, k) => formMaskHas(mask, k))
  const dropped = LANDFORMS.filter((_, k) => !formMaskHas(mask, k))
  if (!kept.length) return 'none'
  if (kept.length <= 3) return kept.map(name).join(', ')
  if (dropped.length <= 3) return `all but ${dropped.map(name).join(', ')}`
  return `${kept.length} of ${LANDFORMS.length}`
}
