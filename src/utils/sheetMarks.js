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
 * @returns {{lines: number[][], rects: number[][], texts: object[],
 *            distance: number|null}|null}
 */
export function sheetMarks({
  width, height, frame = null, metresPerPixel, northAngle = 0,
  bar = true, north = true, scale = 1,
}) {
  if (!(width > 0) || !(height > 0)) return null
  if (!bar && !north) return null
  if (!(metresPerPixel > 0) || !Number.isFinite(metresPerPixel)) return null

  const box = frame ?? { x: 0, y: 0, w: width, h: height }
  if (!(box.w > 0) || !(box.h > 0)) return null

  const short = Math.min(box.w, box.h)
  const pad = short * 0.05
  const text = Math.max(7, short * 0.018 * scale)
  const lines = [], rects = [], texts = []

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
  }

  // ── The arrow ──────────────────────────────────────────────────────────────
  if (north) {
    const len = short * 0.075 * scale
    const cx = box.x + box.w - pad - len * 0.35
    const cy = box.y + box.h - pad - len * 0.5
    const ux = Math.cos(northAngle), uy = Math.sin(northAngle)
    const tipX = cx + ux * len * 0.5, tipY = cy + uy * len * 0.5
    const tailX = cx - ux * len * 0.5, tailY = cy - uy * len * 0.5
    lines.push([tailX, tailY, tipX, tipY])
    // Barbs at 150° either side of the shaft — an arrowhead drawn as two strokes
    // rather than as a filled triangle, because a pen has no fill.
    const barb = len * 0.28
    for (const sign of [1, -1]) {
      const ang = northAngle + Math.PI + sign * 0.42
      lines.push([tipX, tipY, tipX + Math.cos(ang) * barb, tipY + Math.sin(ang) * barb])
    }
    texts.push({
      x: tipX + ux * text * 0.9, y: tipY + uy * text * 0.9 + text * 0.35,
      text: 'N', size: text, anchor: 'middle',
    })
  }

  return { lines, rects, texts, distance }
}
