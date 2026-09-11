/**
 * Hours of direct sun, per cell.
 *
 * The almanac in `solar.js` answers "where is the sun at 09:15". This answers
 * the question the ground actually cares about: *how much* sun does this slope
 * get. It is a scalar field over the terrain, in hours, and the existing
 * marching-squares tracer contours it without modification — which is what makes
 * the plate the idea sheet promised. The north face comes out as a closed ring
 * of nothing.
 *
 * It is also the only field in this app that is a **measurement of the ground
 * rather than of the picture**. A contour is a height, an isophote is a shading
 * convention; this is a number an alpine hut, a ski aspect or a solar panel is
 * chosen by, and it comes out of the raster's own latitude with nothing invented
 * in between.
 *
 * ── What "lit" means here ────────────────────────────────────────────────────
 * A cell counts a sample when **both** tests pass:
 *
 *  1. **The sun is above the cell's own horizon.** Terrain between the cell and
 *     the sun blocks it — the ridge to the south of a valley is most of why a
 *     valley is dark in January.
 *  2. **The surface faces the sun at all.** A north wall gets no direct sun even
 *     with a clear horizon, because the sun is behind the wall.
 *
 * Both are what a hillshade already does per frame. This does it a few hundred
 * times and adds up the hours.
 *
 * ── The shadow test is a sweep, not a march ──────────────────────────────────
 * Ray-marching every cell toward the sun is O(cells · steps) per sun position,
 * and there are a few hundred positions in a year. The sweep below is O(cells):
 * walk the grid *in the sun's own direction* and carry one number, the height a
 * shadow has reached. A cell is in shadow when that height is above it, and it
 * hands on `max(its own height, the incoming height − the drop)` to the next
 * cell along. One pass, no steps to budget, and exact at the grid's resolution
 * rather than sampled.
 *
 * ── World units, not metres ──────────────────────────────────────────────────
 * The sweep works in the same world units the mesh is built in, so the shadows
 * are the shadows of the terrain *as drawn*. At the exaggeration a GeoTIFF
 * suggests, that is the real ground and the hours are real hours. Exaggerate the
 * relief by hand and the shadows lengthen with it — which is the same bargain
 * the hillshade's own cast shadows already make, and the panel says so.
 */
import { boxBlur } from './terrain'
import { dayOfYear, parseDate, sunPath, yearDays } from './solar'
import { bboxToWgs84 } from './geoCoords'
// The same 1-2-5 rule the scale bar picks its distance by. Imported rather than
// restated: two descriptions of one rule is how the two come to disagree, and a
// contour interval and a scale bar want exactly the same thing — a number a
// person would say out loud.
import { niceDistance } from './sheetMarks'

const RAD = Math.PI / 180

/**
 * A shadow sweep in one sun direction, accumulating hours.
 *
 * The grid is walked along whichever axis the sun leans on hardest, so the step
 * to the cell *toward the sun* is always exactly one row or one column across
 * and a fraction along the other — which is what makes the carried value
 * interpolable and the whole pass linear.
 *
 * `S` is the carried height, one entry per cell, reused between samples. It is
 * written for every cell on every pass, so it needs no clearing.
 */
function accumulateSample(field, elev, gx, gz, mask, rows, cols, cellW, sample, S) {
  const azR = sample.azimuth * RAD, altR = sample.altitude * RAD
  /*
   * A true bearing, placed against the raster's own north.
   *
   * `sample.azimuth` is a compass bearing: 90° is east, 180° is due south, and
   * at 47° N the sun spends the whole year in the southern half of that circle.
   * Row 0 of a georeferenced raster is its northern edge and column 0 its
   * western one, so east is +column and north is −row.
   *
   * This mode was written this way when it was the only one that was. Every
   * other sun in the app built its light as `(cos az, sin alt, sin az)`, a
   * quarter turn from a compass, and the two conventions sat side by side until
   * v1.14.0 moved all of them onto this one.
   */
  const cosAlt = Math.cos(altR)
  const dc = Math.sin(azR), dr = -Math.cos(azR)
  const Lx = dc * cosAlt, Ly = Math.sin(altR), Lz = dr * cosAlt
  const weight = sample.hours

  // Which axis leads. Normalising by the larger component is what keeps the
  // minor step below one cell, so the upstream sample spans two neighbours and
  // no third.
  const alongCols = Math.abs(dc) >= Math.abs(dr)
  const lead = alongCols ? dc : dr
  const slope = (alongCols ? dr : dc) / Math.abs(lead)
  const step = lead >= 0 ? 1 : -1
  const nMajor = alongCols ? cols : rows
  const nMinor = alongCols ? rows : cols
  const majStride = alongCols ? 1 : cols
  const minStride = alongCols ? cols : 1
  // How far the sun falls over one major step, in world units.
  const drop = Math.hypot(1, slope) * cellW * Math.tan(altR)

  // From the sun's side inward, so the upstream cell is always already done.
  const first = step > 0 ? nMajor - 1 : 0
  const last = step > 0 ? -1 : nMajor
  for (let maj = first; maj !== last; maj -= step) {
    const upMaj = maj + step
    const upBase = upMaj * majStride
    const upInside = upMaj >= 0 && upMaj < nMajor
    const majBase = maj * majStride
    for (let min = 0; min < nMinor; min++) {
      const i = majBase + min * minStride
      let incoming = -Infinity
      if (upInside) {
        const fm = min + slope
        const m0 = Math.floor(fm), t = fm - m0
        const a = (m0 >= 0 && m0 < nMinor) ? S[upBase + m0 * minStride] : -Infinity
        const b = (m0 + 1 >= 0 && m0 + 1 < nMinor) ? S[upBase + (m0 + 1) * minStride] : -Infinity
        // At the edge one of the two neighbours is off the grid. Falling back to
        // the one that exists is a boundary approximation and the honest one:
        // there is no terrain out there to cast anything.
        incoming = (a === -Infinity || b === -Infinity)
          ? (a > b ? a : b)
          : a + (b - a) * t
        incoming -= drop
      }
      if (mask && !mask[i]) {
        // A void neither blocks the light nor receives it. The shadow passes
        // straight through, which is what a hole in the data should do.
        S[i] = incoming
        continue
      }
      const e = elev[i]
      S[i] = e > incoming ? e : incoming
      if (e < incoming) continue                      // a ridge is in the way

      // And the surface has to face the sun at all. Same expression the Lambert
      // shading uses, tested only for its sign.
      const g0 = gx[i], g1 = gz[i]
      if (-g0 * Lx + Ly - g1 * Lz > 0) field[i] += weight
    }
  }
}

/**
 * The last field computed, and what it was computed from.
 *
 * Three of the mode's eight parameters do not touch the field at all: the
 * contour count picks levels off a finished one, and the two smoothing controls
 * act after it exists. Every one of them is a *geometry* parameter — correctly,
 * since they move vertices — so each drags a full rebuild behind it, and without
 * this that rebuild pays for a few hundred shadow sweeps to draw the same
 * numbers at different heights. A second of it on a 1024² grid, per slider tick.
 *
 * One entry, not a map. The mode is being tuned or it is not, and a second entry
 * would hold a second terrain alive for nothing. The terrain is compared by
 * identity, which is exactly right: the worker builds a new one whenever
 * anything upstream of it moves, and holds the previous grid only until the next
 * build overwrites this.
 *
 * Same shape as the worker's own `vectorCache`, and for the same reason.
 */
let fieldCache = { key: null, terrain: null, value: null }

/**
 * Hours of direct sun over a period, per cell.
 *
 * @param {object} terrain the worker's terrain product
 * @param {object} o
 * @param {number} o.elevScale   the effective exaggeration, as the mesh uses it
 * @param {number} o.lat         degrees north
 * @param {number[]} o.dayNumbers  days of the year to stand for the period
 * @param {number} o.perDay      sun positions between sunrise and sunset
 * @param {number} o.daysStandFor  days each sampled day represents — 365/n for a
 *                                 year, 1 for a single date
 * @returns {{hours: Float32Array, max: number, samples: number, dayHours: number}}
 *   `hours` is −1 where there is no ground, so the tracer can skip those cells
 *   the way the isophotes do.
 */
export function sunHoursField(terrain, { elevScale, lat, dayNumbers, perDay, daysStandFor }) {
  // Everything the field depends on, and nothing that only decides how it is
  // drawn. The terrain rides alongside as an identity rather than in the key:
  // hashing a grid of a million cells to avoid recomputing over it would be its
  // own kind of silly.
  const key = `${elevScale}|${lat}|${perDay}|${daysStandFor}|${dayNumbers.join(',')}`
  if (fieldCache.terrain === terrain && fieldCache.key === key) return fieldCache.value

  const { grid, gridMask, rows, cols, scl } = terrain
  const n = rows * cols
  const mask = terrain.hasNoData ? gridMask : null

  const samples = sunPath({ lat, dayNumbers, perDay })
  const field = new Float32Array(n)

  // Elevation in world units, and the two gradients the incidence test needs.
  // Computed once: they do not change between sun positions, and recomputing
  // them a few hundred times is most of the cost of not doing this.
  const elev = new Float32Array(n)
  const gx = new Float32Array(n), gz = new Float32Array(n)
  const eScale = 100 * elevScale
  const dScale = eScale / (2 * scl)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (mask && !mask[i]) { elev[i] = 0; field[i] = -1; continue }
      const b = grid[i]
      elev[i] = (b - 0.5) * eScale
      const bL = (c > 0 && (!mask || mask[i - 1])) ? grid[i - 1] : b
      const bR = (c < cols - 1 && (!mask || mask[i + 1])) ? grid[i + 1] : b
      const bU = (r > 0 && (!mask || mask[i - cols])) ? grid[i - cols] : b
      const bD = (r < rows - 1 && (!mask || mask[i + cols])) ? grid[i + cols] : b
      gx[i] = (bR - bL) * dScale
      gz[i] = (bD - bU) * dScale
    }
  }

  const S = new Float32Array(n)
  for (const sample of samples) {
    accumulateSample(field, elev, gx, gz, mask, rows, cols, scl, sample, S)
  }

  // One sampled day stands for several. Scaling at the end rather than per
  // sample keeps the weight of a sample the hours it really is, which is what
  // makes the single-day case need no special path.
  const stand = daysStandFor ?? 1
  let max = 0, min = Infinity, dayHours = 0
  for (const s of samples) dayHours += s.hours
  if (stand !== 1) {
    for (let i = 0; i < n; i++) if (field[i] > 0) field[i] *= stand
  }
  // The range over *ground*. The −1 in a void is a sentinel, not a reading, and
  // a minimum taken over it would put every contour level outside the field.
  for (let i = 0; i < n; i++) {
    const v = field[i]
    if (v < 0) continue
    if (v > max) max = v
    if (v < min) min = v
  }

  const out = {
    hours: field, max, min: min === Infinity ? 0 : min,
    samples: samples.length, dayHours: dayHours * stand,
  }
  // Handed out by reference. Every caller reads it — `smoothField` returns a new
  // array rather than blurring in place — so one copy serves them all.
  fieldCache = { key, terrain, value: out }
  return out
}

/**
 * Smooth the field without filling in its holes.
 *
 * A shadow edge is hard by nature — a ridge either blocks the sun or it does not
 * — so an unsmoothed field traces every notch in the skyline. This is the
 * control that makes a line broad, the way `radiusIso` is for the isophotes.
 *
 * The sentinel has to be put back afterwards, and that is the whole reason this
 * is a function rather than one call. `boxBlur`'s masked path writes **0** into a
 * void, because every other consumer of it gates on the mask separately and 0 is
 * the safe floor for a brightness. This field gates on the *value*: −1 means
 * "no ground", and the tracer skips any cell with a negative corner. Blurred and
 * left at 0, a void reads as ground that gets no sun at all — so the tracer stops
 * skipping it and draws a closed line round the edge of the selection, which
 * describes the selection rather than the terrain.
 */
export function smoothField(hours, cols, rows, radius, mask) {
  if (!(radius > 0)) return hours
  const out = boxBlur(hours, cols, rows, radius, mask)
  if (mask) for (let i = 0; i < out.length; i++) if (!mask[i]) out[i] = -1
  return out
}

/**
 * The days a period is sampled on, and what one sampled day stands for.
 *
 * A year is twelve-ish days spread evenly and each stands for a twelfth of the
 * year. A single date is itself, and stands for one day. Both come back in the
 * same shape so the field builder has one path.
 *
 * A date that will not parse falls back to the year rather than to a guess at a
 * day. Half a typed date is not a date, and the year is the answer this mode is
 * really for.
 */
export function samplingFor(period, days, isoDate) {
  if (period === 'day') {
    const when = parseDate(isoDate)
    if (when) return { dayNumbers: [dayOfYear(when)], daysStandFor: 1 }
  }
  const numbers = yearDays(days)
  return { dayNumbers: numbers, daysStandFor: 365 / numbers.length }
}

/**
 * Where the sun is being asked about.
 *
 * A GeoTIFF answers it from its own bounding box — the same call the OSM query
 * and the almanac make. A plain PNG has no location, so the mode carries its own
 * latitude, exactly as every other mode here carries its own azimuth.
 */
export function latitudeFor(p) {
  const wgs = bboxToWgs84(p.geoTiffBbox, p.geoTiffCRS)
  return {
    lat: wgs ? (wgs[1] + wgs[3]) / 2 : (p.latSunHours ?? 0),
    fromRaster: !!wgs,
  }
}

/**
 * The hour marks to contour at, and the boundary of the permanent shade.
 *
 * Three decisions, and the first is why this is not just an interval slider. The
 * field's range is not knowable in advance: a few thousand hours for a year, a
 * handful for a day, and less again in a deep valley. So the panel asks roughly
 * *how many* lines and this picks a round hour step to fit — 200 h, 500 h, 2 h —
 * rather than making somebody guess a number and get one line or a hundred.
 *
 * The second is that the steps are fitted to the field's **own range**, not to
 * zero. A year's field clusters hard against its maximum: most of a gentle
 * landscape gets nearly the whole of the daylight, and all the shape is in the
 * top fifth. Levels counted up from zero spend nineteen of twenty on ground
 * where nothing is happening and draw a nearly empty plate. This is the same
 * rule a contour map follows — a plateau is not contoured from sea level.
 *
 * The third is the level at `SHADE_EDGE`, and it is included only when there is
 * ground that never sees the sun. Marching squares cannot trace the boundary of
 * the zero region directly, because a test of `field ≥ 0` puts every cell on the
 * same side of it and draws nothing at all. A level just above zero traces that
 * boundary instead, and it is the line the whole idea was for: the north face,
 * closed and separate.
 */
export const SHADE_EDGE = 0.5

export function sunHourLevels(min, max, levels) {
  if (!(max > 0) || !(max > min)) return []
  const want = Math.max(1, Math.min(24, Math.round(levels ?? 6)))
  const lo = Math.max(0, min)
  const step = niceDistance((max - lo) / want) ?? (max - lo)
  const edge = Math.min(SHADE_EDGE, step / 4)
  const out = lo <= 0 ? [edge] : []
  // From the first round multiple above the floor, so the lines land on numbers
  // somebody would say rather than on the floor plus an offset.
  for (let v = Math.ceil((lo + 1e-9) / step) * step; v < max; v += step) {
    if (v > edge) out.push(v)
  }
  return out
}
