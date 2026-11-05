/**
 * The facts a sheet's marks print, gathered once from the plate.
 *
 * The title block, the magnetic arrow and a grid in degrees all need something
 * the shared parameters do not carry: where the terrain came from, what the
 * projection is called, the contour interval in metres, the declination today.
 * App builds this object, and the viewport and both exporters pass it to
 * `sheetMarks`, so the three print the same thing.
 */
import { crsDisplayName, metresPerWorldUnit, projectWgs84, unprojectWgs84 } from './geoCoords'
import { declination, decimalYear, formatDeclination } from './magnetic'
import { crsAffine, sheetMarks } from './sheetMarks'
import { legendShapes, markFont } from './legend'

/** The lines the title block can hold, in order, and their panel names. */
export const TITLE_LINES = [
  ['projection', 'Projection'],
  ['interval', 'Contour interval'],
  ['range', 'Height range'],
  ['source', 'Data source'],
  ['date', 'Date'],
]

const fmtM = (v) => `${Math.round(v).toLocaleString('en-US').replace(/,/g, ' ')} m`

/**
 * The title block's text: the title, then each chosen fact. A fact the plate
 * does not have (no contours, no georeference) is left out, not printed empty.
 */
export function titleLines(p, facts, today = new Date()) {
  const want = new Set(String(p.frameTitleFacts ?? '').split(',').map((s) => s.trim()).filter(Boolean))
  const title = (p.frameTitleText ?? '').trim()
    || String(facts.filename ?? '').replace(/\.[^.]+$/, '') || 'Untitled'
  const out = [title]
  const geo = p.geoTiffElevMax != null && p.geoTiffElevMin != null
  if (want.has('projection') && facts.crs && facts.crs !== 'EPSG:none') out.push(crsDisplayName(facts.crs, facts.crsName))
  if (want.has('interval') && p.enabledContours && geo) {
    const m = (p.intervalContours ?? 0) * metresPerWorldUnit(p.geoTiffElevMin, p.geoTiffElevMax,
      p.elevScale, p.blackPoint ?? 0, p.whitePoint ?? 255)
    if (m > 0 && Number.isFinite(m)) out.push(`Contour interval ${Math.round(m * 10) / 10} m`)
  }
  if (want.has('range') && geo) out.push(`Heights ${fmtM(p.geoTiffElevMin)} to ${fmtM(p.geoTiffElevMax)}`)
  if (want.has('source') && facts.provenance) out.push(facts.provenance)
  if (want.has('date')) out.push(today.toISOString().slice(0, 10))
  return out
}

/** The plate's centre as [lat, lon], or null without a georeference that can be inverted. */
export function centreLatLon(bbox, crs) {
  if (!bbox) return null
  const r = unprojectWgs84((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2, crs)
  return r && Number.isFinite(r[0]) && Number.isFinite(r[1]) ? r : null
}

/**
 * Magnetic north at the plate's centre, as a turn from grid north.
 *
 * Two angles add up: grid north to true north (the meridian convergence, read
 * by stepping north from the centre and seeing where that lands in the grid),
 * and true north to magnetic north (the declination). Radians clockwise on the
 * sheet, with the declination for the label.
 */
export function magneticNorth(bbox, crs, date = new Date()) {
  const c = centreLatLon(bbox, crs)
  if (!c) return null
  const [lat, lon] = c
  const a = projectWgs84(lat, lon, crs), b = projectWgs84(lat + 0.01, lon, crs)
  if (!a || !b) return null
  const convergence = Math.atan2(b[0] - a[0], b[1] - a[1])
  const { declination: d, valid } = declination(lat, lon, decimalYear(date))
  return { turn: convergence + (d * Math.PI) / 180, declination: d, valid,
           label: formatDeclination(d) + (valid ? '' : ' (model expired)') }
}

/**
 * Everything the marks need beyond the parameters.
 *
 * @param {object} p      the shared parameters
 * @param {object} facts  { filename, crs, crsName, provenance } from the store
 */
export function sheetFacts(p, facts, today = new Date()) {
  const crs = facts.crs
  return {
    title: p.frameTitle ? titleLines(p, facts, today) : null,
    magnetic: p.frameNorth && p.frameMagnetic ? magneticNorth(p.geoTiffBbox, crs, today) : null,
    gridMode: p.frameGrid && p.frameGrid !== 'off' ? p.frameGrid : null,
    degrees: p.frameGridUnits === 'degrees',
    toCrs: (lon, lat) => projectWgs84(lat, lon, crs),
    toLonLat: (x, y) => { const r = unprojectWgs84(x, y, crs); return r ? [r[1], r[0]] : null },
  }
}

/** Below this tilt the view counts as a plan, and the grid can be drawn. */
export const PLAN_TILT = 6

/**
 * The marks for one surface: the viewport, the PNG or the SVG.
 *
 * Each measures in its own pixels, so each passes its own `scale` (from
 * `measureScale`) and either its own `project` or an `affine` the viewport
 * measured already. The grid is drawn in a plan view only. `sheet.legend` is
 * the entries App reads from the plate (utils/legend.js), laid out here.
 */
export function marksFor({ p, sheet, width, height, frame, scale, project = null, affine = null, terrain = null }) {
  let grid = null
  if (sheet?.gridMode && (p.tilt ?? 0) < PLAN_TILT) {
    const map = affine ?? (project && terrain && p.geoTiffBbox && crsAffine(project, {
      bbox: p.geoTiffBbox, width: p.imageWidth, height: p.imageHeight,
      halfW: terrain.halfW, halfH: terrain.halfH,
      peakOff: Math.floor(p.gridOffsetX ?? 0), lineOff: Math.floor(p.gridOffsetY ?? 0),
    }))
    if (map) grid = { affine: map, mode: sheet.gridMode, degrees: sheet.degrees, toCrs: sheet.toCrs, toLonLat: sheet.toLonLat }
  }
  const marks = sheetMarks({
    width, height, frame, metresPerPixel: scale?.metresPerPixel, northAngle: scale?.northAngle ?? 0,
    bar: !!p.frameScaleBar, north: !!p.frameNorth, scale: p.frameMarkScale ?? 1,
    title: sheet?.title ?? null, grid, magnetic: sheet?.magnetic ?? null,
  })
  // The legend goes in after the other marks, clear of the room they hold.
  const legend = sheet?.legend?.length && width > 0 && height > 0 && legendShapes(sheet.legend, {
    box: frame ?? { x: 0, y: 0, w: width, h: height },
    corner: p.legendCorner ?? 'bl', scale: p.legendScale ?? 1, upper: p.legendCaps !== false,
    boxed: !!p.legendBox, heading: (p.legendHeading ?? '').trim() || null, avoid: marks?.boxes ?? [],
  })
  if (!marks && !legend) return null
  const font = markFont(p.frameMarkFont)
  if (!legend) return { ...marks, font }
  const base = marks ?? { lines: [], rects: [], texts: [], distance: null, boxes: [] }
  // Text in the legend's own ink; the swatches keep theirs.
  const ink = p.legendInk || null
  return {
    ...base, font,
    rects: [...base.rects, ...legend.rects],
    lines: [...base.lines, ...legend.lines.map((l) => (l.length < 5 && ink ? [...l, ink] : l))],
    texts: [...base.texts, ...legend.texts.map((t) => (ink ? { ...t, color: ink } : t))],
    boxes: [...base.boxes, legend.bounds],
  }
}

/** Does the plate want any sheet mark at all? */
export const wantsSheetMarks = (p) =>
  !!(p.frameScaleBar || p.frameNorth || p.frameTitle || p.legendOn || (p.frameGrid && p.frameGrid !== 'off'))
