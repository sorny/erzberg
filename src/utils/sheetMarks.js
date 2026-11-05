/**
 * The two marks that separate a map from a picture of a hill.
 *
 * Contours already letter their heights in metres, so the plate has always been
 * *able* to say where it is — and it said nothing. A scale bar and a north arrow
 * are both computable from numbers the app has had since it learned to read a
 * GeoTIFF: metres per raster pixel from the bounding box, and the direction of
 * the raster's own rows.
 *
 * ── Why the geometry is renderer-agnostic ────────────────────────────────────
 * These marks have to appear in three places that share no drawing code: the
 * viewport, which is DOM over a WebGL canvas; the SVG export, which writes
 * elements; and the PNG export, which composites through a 2D context. Three
 * implementations of one layout is how three of them come to disagree about
 * where the bar sits, which is the same failure the four exporters had over the
 * OpenStreetMap credit.
 *
 * So this module returns *shapes* — line segments, filled rectangles and text
 * runs, all in screen pixels — and each of the three renderers is a loop over
 * them. Nothing here imports three.js, a canvas, or React, which is also what
 * makes it testable against a synthetic projection.
 *
 * ── What the bar is honest about, and what it is not ─────────────────────────
 * A scale bar is exactly true for a plan view through an orthographic camera and
 * only locally true for anything else: tilt the camera and the far edge of the
 * plate is at a different scale from the near edge. `measureScale` therefore
 * measures at the centre of the scene and the panel says the tilt out loud, in
 * the same register the panel already uses for *assumed UTM*. It is not made to
 * look more certain than it is.
 *
 * The **ratio** — 1:25 000 — is the part that cannot ship, and the reason is
 * worth stating: it needs the sheet's physical size, and `frame.js` is keyed by
 * ratio on purpose, because an export carries pixel dimensions rather than
 * millimetres. A bar needs no millimetres and works now.
 */

/**
 * How much ground one screen pixel covers, and where north points.
 *
 * Takes a `project` rather than a camera, so it is the same eight lines for the
 * viewport's three.js camera and for the exporter's, and so a test can hand it a
 * projection it wrote itself.
 *
 * The bar is drawn horizontally, so the question is not "how big is a world
 * unit" but "which ground displacement moves one pixel to the right". That is a
 * 2×2 solve against the screen images of the two ground axes, which is exact for
 * an orthographic camera and correct at the centre for a perspective one.
 *
 * @param {(x:number,y:number,z:number)=>number[]} project world → screen pixels
 * @param {{x:number,y:number}} ground metres per world unit on each ground axis
 * @returns {{metresPerPixel:number, northAngle:number}|null}
 *   `northAngle` is radians, measured in screen space where y grows downward.
 *   Null when the view is edge-on and the ground has no area on screen at all.
 */
export function measureScale(project, ground) {
  if (!project || !(ground?.x > 0) || !(ground?.y > 0)) return null
  const o = project(0, 0, 0)
  const px = project(1, 0, 0)
  const pz = project(0, 0, 1)
  if (!o || !px || !pz) return null

  const dx = [px[0] - o[0], px[1] - o[1]]
  const dz = [pz[0] - o[0], pz[1] - o[1]]
  const det = dx[0] * dz[1] - dz[0] * dx[1]
  // A vanishing determinant is the ground seen exactly edge-on: the two axes
  // land on the same screen line and no bar drawn along it would mean anything.
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null

  // World displacement whose screen image is (1, 0) — one pixel to the right.
  const a = dz[1] / det
  const b = -dx[1] / det
  const metresPerPixel = Math.hypot(a * ground.x, b * ground.y)
  if (!Number.isFinite(metresPerPixel) || metresPerPixel <= 0) return null

  // North is −Z. Row 0 of a GeoTIFF is its northern edge, and the mesh lays row
  // r at world z = r·scl − halfH, so increasing z walks south.
  const northAngle = Math.atan2(-dz[1], -dz[0])
  return { metresPerPixel, northAngle }
}

/**
 * The largest 1-2-5 round number that fits inside `target`.
 *
 * A scale bar reads as a measurement rather than as a coincidence, so it is
 * always a distance somebody would say out loud: 200 m, 500 m, 1 km. Never
 * 437 m, which is what fitting the bar to the frame exactly would give.
 */
export function niceDistance(target) {
  if (!(target > 0) || !Number.isFinite(target)) return null
  const decade = 10 ** Math.floor(Math.log10(target))
  for (const step of [5, 2, 1]) if (decade * step <= target) return decade * step
  return decade / 2
}

/** `500` → `500 m`, `2000` → `2 km`. Metres below a kilometre, never both. */
export function formatDistance(metres) {
  if (!(metres > 0)) return ''
  if (metres < 1000) return `${Math.round(metres * 100) / 100} m`
  const km = metres / 1000
  return `${Number.isInteger(km) ? km : Math.round(km * 10) / 10} km`
}

/**
 * The scale bar and the north arrow, as shapes in screen pixels.
 *
 * Both sit inside `frame` when the paper frame is on and inside the whole canvas
 * otherwise, which is the layout decision the idea sheet called the fussiest
 * kind: the marks belong to the *sheet*, so when a sheet has been declared they
 * go inside it rather than floating in the bleed the export is about to cut off.
 *
 * @param {object} o
 * @param {number} o.width          canvas width in the same pixels as `project`
 * @param {number} o.height
 * @param {{x,y,w,h}|null} o.frame  the paper rect, or null for the whole canvas
 * @param {number} o.metresPerPixel from `measureScale`
 * @param {number} o.northAngle     from `measureScale`, radians, screen space
 * @param {boolean} o.bar
 * @param {boolean} o.north
 * @param {number} o.scale          size multiplier from the panel
 * @param {string[]|null} o.title   the title block's lines, the first one the title
 * @param {object|null} o.grid      { affine, mode: 'ticks'|'lines', degrees, toCrs, toLonLat },
 *                                  see `gridMarks`
 * @param {object|null} o.magnetic  { turn, label }: point the arrow at magnetic
 *                                  north instead, `turn` radians clockwise from
 *                                  grid north, with `label` under it
 * @returns {{lines: number[][], rects: number[][], texts: object[],
 *            distance: number|null, boxes: object[]}|null}
 */
export function sheetMarks({
  width, height, frame = null, metresPerPixel, northAngle = 0,
  bar = true, north = true, scale = 1, title = null, grid = null, magnetic = null,
}) {
  if (!(width > 0) || !(height > 0)) return null
  const measured = metresPerPixel > 0 && Number.isFinite(metresPerPixel)
  // The bar, the arrows and the grid need the ground measured. The title does not.
  if (!measured) { bar = false; north = false; grid = null }
  if (!bar && !north && !title?.length && !grid) return null

  const box = frame ?? { x: 0, y: 0, w: width, h: height }
  if (!(box.w > 0) || !(box.h > 0)) return null

  const short = Math.min(box.w, box.h)
  const pad = short * 0.05
  const text = Math.max(7, short * 0.018 * scale)
  const lines = [], rects = [], texts = []
  // The room each mark holds, so a legend can stay out of it.
  const boxes = []

  const titleBox = title?.length ? titleBlock(box, title, pad, text, lines, texts) : null
  if (titleBox) boxes.push(titleBox)
  if (grid?.affine) gridMarks(box, grid, short, text, lines, texts, titleBox)

  // ── The bar ────────────────────────────────────────────────────────────────
  // Four alternating cells, which is the form every printed map uses: it lets
  // you read a quarter of the distance off the end without a second ruler.
  let distance = null
  if (bar) {
    distance = niceDistance(box.w * 0.22 * metresPerPixel)
    const barW = distance / metresPerPixel
    const barH = Math.max(2, short * 0.007 * scale)
    const x0 = box.x + pad
    const y0 = box.y + box.h - pad - barH
    const CELLS = 4
    const cell = barW / CELLS
    for (let i = 0; i < CELLS; i++) {
      if (i % 2 === 0) rects.push([x0 + i * cell, y0, cell, barH])
    }
    // The outline closes the empty cells, so the bar reads as one object rather
    // than as two detached blocks.
    lines.push([x0, y0, x0 + barW, y0], [x0 + barW, y0, x0 + barW, y0 + barH],
      [x0 + barW, y0 + barH, x0, y0 + barH], [x0, y0 + barH, x0, y0])
    // Ends and midpoint ticked and labelled the way a ruler is: 0 and the total,
    // so the number is anchored to a place on the bar and not merely near it.
    for (const [t, label] of [[0, '0'], [1, formatDistance(distance)]]) {
      const x = x0 + t * barW
      lines.push([x, y0, x, y0 - barH * 0.8])
      texts.push({ x, y: y0 - barH * 1.4, text: label, size: text, anchor: t ? 'end' : 'start' })
    }
    boxes.push({ x: x0, y: y0 - barH * 1.4 - text, w: barW, h: barH * 2.4 + text })
  }

  // ── The arrow ──────────────────────────────────────────────────────────────
  // One arrow: grid north, or magnetic north when that is asked for. Two from
  // one foot crowded each other at any size a sheet can give them.
  if (north) {
    const mag = magnetic && Number.isFinite(magnetic.turn)
    const angle = mag ? northAngle + magnetic.turn : northAngle
    const len = short * 0.075 * scale
    const cx = box.x + box.w - pad - len * 0.35
    const cy = box.y + box.h - pad - len * 0.5 - (mag ? text * 1.2 : 0)
    const ux = Math.cos(angle), uy = Math.sin(angle)
    const tipX = cx + ux * len * 0.5, tipY = cy + uy * len * 0.5
    const tailX = cx - ux * len * 0.5, tailY = cy - uy * len * 0.5
    lines.push([tailX, tailY, tipX, tipY])
    // Barbs at 150° either side of the shaft — an arrowhead drawn as two strokes
    // rather than as a filled triangle, because a pen has no fill.
    const barb = len * 0.28
    for (const sign of [1, -1]) {
      const ang = angle + Math.PI + sign * 0.42
      lines.push([tipX, tipY, tipX + Math.cos(ang) * barb, tipY + Math.sin(ang) * barb])
    }
    texts.push({
      x: tipX + ux * text * 0.9, y: tipY + uy * text * 0.9 + text * 0.35,
      text: mag ? 'MN' : 'N', size: text, anchor: 'middle',
    })
    // The declination under the foot, as topographic sheets letter it.
    if (mag && magnetic.label) {
      texts.push({ x: tailX, y: tailY + text * 1.4, text: magnetic.label, size: text * 0.8, anchor: 'middle' })
    }
    const r = len * 0.5 + text * 1.6
    boxes.push({ x: cx - r, y: cy - r, w: 2 * r, h: 2 * r + (mag ? text * 1.4 : 0) })
  }

  return { lines, rects, texts, distance, boxes }
}

/**
 * The title block in the top left of the sheet: the title, a rule under it,
 * and one fact per line below.
 */
function titleBlock(box, title, pad, text, lines, texts) {
  const x = box.x + pad
  let y = box.y + pad + text * 1.4
  texts.push({ x, y, text: title[0], size: text * 1.4, anchor: 'start' })
  if (title.length > 1) {
    y += text * 0.7
    lines.push([x, y, x + Math.min(box.w * 0.3, text * 0.6 * Math.max(...title.map((t) => t.length))), y])
    y += text * 0.4
  }
  let wide = text * 0.62 * title[0].length * 1.4
  for (const t of title.slice(1)) {
    y += text * 1.25
    texts.push({ x, y, text: t, size: text, anchor: 'start' })
    wide = Math.max(wide, text * 0.56 * t.length)
  }
  // The block's extent, with a margin, so a grid can stay out of it.
  const m = text * 0.6
  return { x: x - m, y: box.y + pad - m, w: wide + 2 * m, h: y - (box.y + pad) + 2 * m }
}

/** A segment with the part inside `r` cut out: zero, one or two pieces. */
function outside(seg, r) {
  if (!r) return [seg]
  const inner = clip(seg.x0, seg.y0, seg.x1, seg.y1, r)
  if (!inner) return [seg]
  const out = []
  if (Math.hypot(inner.x0 - seg.x0, inner.y0 - seg.y0) > 0.5) out.push({ x0: seg.x0, y0: seg.y0, x1: inner.x0, y1: inner.y0 })
  if (Math.hypot(seg.x1 - inner.x1, seg.y1 - inner.y1) > 0.5) out.push({ x0: inner.x1, y0: inner.y1, x1: seg.x1, y1: seg.y1 })
  return out
}

/**
 * The map grid → screen mapping, as `[a, b, c, d, e, f]` with
 * `sx = a·X + b·Y + c` and `sy = d·X + e·Y + f`, from three ground points.
 *
 * Exact for a plan view, which is the only view a grid is drawn in: tilted,
 * the far side of the plate is at another scale and straight ticks would lie.
 *
 * @param {Function} project  world → screen pixels, as for `measureScale`
 * @param {object} place      { bbox, width, height, halfW, halfH, peakOff, lineOff }
 */
export function crsAffine(project, { bbox, width, height, halfW, halfH, peakOff = 0, lineOff = 0 }) {
  if (!project || !bbox || !(width > 0) || !(height > 0)) return null
  const [minX, minY, maxX, maxY] = bbox
  const kx = (maxX - minX) / width, ky = (maxY - minY) / height
  // A map point's world position: column and row, less the centring offsets.
  const world = (X, Y) => [(X - minX) / kx - peakOff - halfW, (maxY - Y) / ky - lineOff - halfH]
  const pts = [[minX, maxY], [maxX, maxY], [minX, minY]].map(([X, Y]) => {
    const [wx, wz] = world(X, Y)
    return project(wx, 0, wz)
  })
  if (pts.some((p) => !p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) return null
  const [o, ex, ey] = pts
  const a = (ex[0] - o[0]) / (maxX - minX), d = (ex[1] - o[1]) / (maxX - minX)
  const b = (ey[0] - o[0]) / (minY - maxY), e = (ey[1] - o[1]) / (minY - maxY)
  return [a, b, o[0] - a * minX - b * maxY, d, e, o[1] - d * minX - e * maxY]
}

const applyAffine = ([a, b, c, d, e, f], X, Y) => [a * X + b * Y + c, d * X + e * Y + f]
function invertAffine([a, b, c, d, e, f]) {
  const det = a * e - b * d
  if (Math.abs(det) < 1e-15) return null
  return (sx, sy) => [(e * (sx - c) - b * (sy - f)) / det, (a * (sy - f) - d * (sx - c)) / det]
}

/** A 1-2-5 step near a fifth of `span`, so four to six lines cross the sheet. */
export function gridStep(span) {
  return niceDistance(span / 4) ?? span
}

/** Steps for a grid in degrees, from one minute to ten degrees. */
const DEGREE_STEPS = [1, 2, 5, 10, 15, 30].map((m) => m / 60).concat([1, 2, 5, 10])

/** `14.0833` → `14°05′`, the way a sheet edge letters degrees. */
export function formatDegrees(v, pos, neg) {
  const a = Math.abs(v)
  let deg = Math.floor(a), min = Math.round((a - deg) * 60)
  if (min === 60) { deg += 1; min = 0 }
  return `${deg}°${min ? String(min).padStart(2, '0') + '′' : ''}${v < 0 ? neg : pos}`
}

/** A grid figure as surveyors letter it: `419 000`, thousands apart. */
function formatGridValue(v) {
  return Math.round(v).toLocaleString('en-US').replace(/,/g, ' ')
}

/**
 * Coordinate ticks or a full grid inside the sheet, with each figure lettered
 * where its line meets the edge.
 */
function gridMarks(box, grid, short, text, lines, texts, avoid = null) {
  const toCrs = invertAffine(grid.affine)
  if (!toCrs) return
  const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
  const tick = short * 0.02
  const full = grid.mode === 'lines'
  const size = text * 0.75
  // Each figure's rough box, so no two overlap and none runs into the title
  // block or off the sheet. Glyphs are about 0.55 of the size wide.
  const placed = avoid ? [avoid] : []
  const boxOf = (x, y, label, anchor) => {
    const w = size * 0.55 * label.length
    return { x: anchor === 'end' ? x - w : x, y: y - size, w, h: size * 1.2 }
  }
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  // One map line, as screen pieces cut to the sheet, with its figure at each end.
  const draw = (screenPts, label) => {
    const ends = []
    for (let i = 0; i + 1 < screenPts.length; i++) {
      const [x0, y0] = screenPts[i], [x1, y1] = screenPts[i + 1]
      const seg = clip(x0, y0, x1, y1, box)
      if (!seg) continue
      if (full) for (const piece of outside(seg, avoid)) lines.push([piece.x0, piece.y0, piece.x1, piece.y1])
      ends.push([seg.x0, seg.y0, seg.x1, seg.y1])
    }
    if (!ends.length) return
    const first = ends[0], last = ends[ends.length - 1]
    for (const [ex, ey, ox, oy] of [[first[0], first[1], first[2], first[3]], [last[2], last[3], last[0], last[1]]]) {
      if (!onEdge(ex, ey, box)) continue
      const len = Math.hypot(ox - ex, oy - ey) || 1
      const ux = (ox - ex) / len, uy = (oy - ey) / len
      if (!full) lines.push([ex, ey, ex + ux * tick, ey + uy * tick])
      // Beside its line, not on it: right of a line that meets the top or the
      // bottom, above a line that meets a side.
      const across = Math.abs(uy) >= Math.abs(ux)
      let anchor = across ? 'start' : (ux > 0 ? 'start' : 'end')
      let tx = ex + ux * tick * 1.2 + (across ? size * 0.35 : 0)
      const ty = ey + uy * tick * 1.2 + (across ? (uy > 0 ? size * 0.8 : -size * 0.2) : -size * 0.35)
      // Near the right edge, a figure goes left of its line.
      if (across && tx + size * 0.55 * label.length > box.x + box.w) { anchor = 'end'; tx = ex - size * 0.35 }
      const b = boxOf(tx, ty, label, anchor)
      if (b.x < box.x || b.x + b.w > box.x + box.w || placed.some((p) => overlaps(p, b))) continue
      placed.push(b)
      texts.push({ x: tx, y: ty, text: label, size, anchor })
    }
  }

  if (!grid.degrees) {
    const xs = corners.map(([x, y]) => toCrs(x, y))
    const [minX, maxX] = [Math.min(...xs.map((p) => p[0])), Math.max(...xs.map((p) => p[0]))]
    const [minY, maxY] = [Math.min(...xs.map((p) => p[1])), Math.max(...xs.map((p) => p[1]))]
    const step = gridStep(Math.max(maxX - minX, maxY - minY))
    if (!(step > 0)) return
    for (let X = Math.ceil(minX / step) * step; X <= maxX; X += step) {
      draw([applyAffine(grid.affine, X, minY), applyAffine(grid.affine, X, maxY)], formatGridValue(X))
    }
    for (let Y = Math.ceil(minY / step) * step; Y <= maxY; Y += step) {
      draw([applyAffine(grid.affine, minX, Y), applyAffine(grid.affine, maxX, Y)], formatGridValue(Y))
    }
    return
  }

  // Degrees: meridians and parallels are curves in most grids, so each is
  // sampled and drawn as a run of short pieces.
  if (!grid.toCrs || !grid.toLonLat) return
  const edge = []
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    edge.push([box.x + t * box.w, box.y], [box.x + t * box.w, box.y + box.h], [box.x, box.y + t * box.h], [box.x + box.w, box.y + t * box.h])
  }
  const ll = edge.map(([x, y]) => grid.toLonLat(...toCrs(x, y))).filter((p) => p && Number.isFinite(p[0]) && Number.isFinite(p[1]))
  if (ll.length < 4) return
  const lons = ll.map((p) => p[0]), lats = ll.map((p) => p[1])
  const [lo0, lo1, la0, la1] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]
  const pick = (span) => DEGREE_STEPS.reduce((best, s) => (Math.abs(span / s - 5) < Math.abs(span / best - 5) ? s : best))
  const step = pick(Math.max(lo1 - lo0, la1 - la0))
  const SAMPLES = 24
  const run = (fn) => {
    const out = []
    for (let i = 0; i <= SAMPLES; i++) {
      const xy = fn(i / SAMPLES)
      const c = xy && grid.toCrs(xy[0], xy[1])
      if (c) out.push(applyAffine(grid.affine, c[0], c[1]))
    }
    return out
  }
  const eps = step * 1e-6
  for (let lon = Math.ceil(lo0 / step) * step; lon <= lo1 + eps; lon += step) {
    draw(run((t) => [lon, la0 + t * (la1 - la0)]), formatDegrees(lon, 'E', 'W'))
  }
  for (let lat = Math.ceil(la0 / step) * step; lat <= la1 + eps; lat += step) {
    draw(run((t) => [lo0 + t * (lo1 - lo0), lat]), formatDegrees(lat, 'N', 'S'))
  }
}

function onEdge(x, y, r, eps = 0.5) {
  return Math.abs(x - r.x) < eps || Math.abs(x - r.x - r.w) < eps || Math.abs(y - r.y) < eps || Math.abs(y - r.y - r.h) < eps
}

/** Liang–Barsky, as in `frame.js`, kept here so this module imports nothing. */
function clip(x0, y0, x1, y1, r) {
  const dx = x1 - x0, dy = y1 - y0
  let t0 = 0, t1 = 1
  for (const [p, q] of [[-dx, x0 - r.x], [dx, r.x + r.w - x0], [-dy, y0 - r.y], [dy, r.y + r.h - y0]]) {
    if (p === 0) { if (q < 0) return null; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return null; if (t > t0) t0 = t } else { if (t < t0) return null; if (t < t1) t1 = t }
  }
  return { x0: x0 + t0 * dx, y0: y0 + t0 * dy, x1: x0 + t1 * dx, y1: y0 + t1 * dy }
}
