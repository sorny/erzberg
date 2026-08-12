/**
 * Non-destructive heightmap clipping — the maths behind Edit Mode.
 *
 * An `edit` describes, in *source pixel coordinates*, which part of the loaded
 * raster is wanted:
 *
 *   { rect: {x,y,w,h}, shape: Shape|null, feather: px }
 *
 * where a Shape is either a ring of points or an ellipse:
 *
 *   { type: 'lasso'|'polygon', points: [x0,y0,x1,y1,…] }
 *   { type: 'ellipse', cx, cy, rx, ry }
 *
 * The ellipse is kept as an ellipse rather than approximated by a ring: a
 * 128-gon shows visible flats once the raster is a few thousand pixels wide, and
 * the implicit test is both exact and cheaper to fill than a scanline crossing
 * list.
 *
 * `applyEdit` turns it into a smaller raster the rest of the app consumes in
 * place of the loaded one. Two properties matter downstream:
 *
 *  • The output is cropped to the selection's bounding box, so the geometry grid
 *    shrinks with the selection instead of carrying a mostly-empty raster.
 *  • Everything outside the shape is marked nodata, which `buildTerrain` already
 *    both skips and *centres on* (it derives halfW/halfH from the valid-cell
 *    bounding box), so a clipped terrain lands in the middle of the view without
 *    anything else being taught about selections.
 */

/** Integer, clamped-to-raster rectangle. Returns null if it has no area. */
function clampRect(rect, srcW, srcH) {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(srcW, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(srcH, Math.ceil(rect.y + rect.h))
  if (x1 <= x0 || y1 <= y0) return null
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Whether a shape encloses any area at all — the guard every caller needs. */
export function isUsableShape(shape) {
  if (!shape) return false
  if (shape.type === 'ellipse') return shape.rx > 0.5 && shape.ry > 0.5
  return shape.points?.length >= 6   // fewer than 3 vertices is not an area
}

/** Bounding box of a shape, as a rect. */
export function shapeBounds(shape) {
  if (!isUsableShape(shape)) return null
  if (shape.type === 'ellipse') {
    return { x: shape.cx - shape.rx, y: shape.cy - shape.ry, w: shape.rx * 2, h: shape.ry * 2 }
  }
  const points = shape.points
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    const x = points[i], y = points[i + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * The region the edit actually keeps: the crop rect, further narrowed to the
 * shape's bounding box when there is one. This is what the output raster spans.
 */
export function effectiveBounds(edit, srcW, srcH) {
  const full = { x: 0, y: 0, w: srcW, h: srcH }
  let b = clampRect(edit?.rect ?? full, srcW, srcH)
  if (!b) return null
  const sb = shapeBounds(edit?.shape)
  if (sb) {
    const x0 = Math.max(b.x, Math.floor(sb.x))
    const y0 = Math.max(b.y, Math.floor(sb.y))
    const x1 = Math.min(b.x + b.w, Math.ceil(sb.x + sb.w) + 1)
    const y1 = Math.min(b.y + b.h, Math.ceil(sb.y + sb.h) + 1)
    if (x1 <= x0 || y1 <= y0) return null
    b = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }
  return b
}

/**
 * Even-odd scanline fill of a closed polygon into `out` (1 = inside).
 *
 * A lasso is just a polygon whose vertices came from a drag, so both tools land
 * here. The closing edge is implicit. Sampling is at pixel centres, which is
 * what keeps a rectangle drawn by hand from gaining a half-pixel fringe.
 */
function fillPolygon(out, points, b) {
  const n = points.length / 2
  const xs = new Float64Array(n)
  for (let row = 0; row < b.h; row++) {
    const yc = b.y + row + 0.5
    let count = 0
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const yi = points[i * 2 + 1], yj = points[j * 2 + 1]
      if ((yi > yc) === (yj > yc)) continue
      const xi = points[i * 2], xj = points[j * 2]
      xs[count++] = xi + ((yc - yi) / (yj - yi)) * (xj - xi)
    }
    if (count < 2) continue
    const spans = xs.subarray(0, count)
    spans.sort()
    const rowOff = row * b.w
    for (let k = 0; k + 1 < count; k += 2) {
      const cx0 = Math.max(0, Math.ceil(spans[k] - b.x - 0.5))
      const cx1 = Math.min(b.w - 1, Math.floor(spans[k + 1] - b.x - 0.5))
      for (let c = cx0; c <= cx1; c++) out[rowOff + c] = 1
    }
  }
}

/**
 * Fill an ellipse into `out` (1 = inside), one row span at a time.
 *
 * Solving the ellipse equation for x per row gives the exact span directly, so
 * this touches only the pixels it sets — testing every pixel in the bounding box
 * would do 4/π times the work and get the same answer.
 */
function fillEllipse(out, { cx, cy, rx, ry }, b) {
  const iry = 1 / Math.max(1e-6, ry)
  for (let row = 0; row < b.h; row++) {
    const dy = (b.y + row + 0.5 - cy) * iry
    const dy2 = dy * dy
    if (dy2 > 1) continue
    const dx = Math.sqrt(1 - dy2) * rx
    const c0 = Math.max(0, Math.ceil(cx - dx - b.x - 0.5))
    const c1 = Math.min(b.w - 1, Math.floor(cx + dx - b.x - 0.5))
    const off = row * b.w
    for (let c = c0; c <= c1; c++) out[off + c] = 1
  }
}

const SQ2 = Math.SQRT2

/**
 * Chamfer (3,4)-style distance from every selected cell to the nearest
 * unselected one, in pixels. Anything past the edge of the crop counts as
 * unselected, so a pure crop feathers against its own border.
 *
 * Two sequential passes, no queue — the approximation is well under a pixel of
 * error, which is invisible in a gradient that is at least a few pixels wide.
 */
function distanceToEdge(mask, w, h) {
  const d = new Float32Array(w * h)
  const INF = 1e9
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? INF : 0

  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : d[y * w + x]

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (d[i] === 0) continue
      let v = d[i]
      const a = at(x - 1, y) + 1, b = at(x, y - 1) + 1
      const c = at(x - 1, y - 1) + SQ2, e = at(x + 1, y - 1) + SQ2
      if (a < v) v = a; if (b < v) v = b; if (c < v) v = c; if (e < v) v = e
      d[i] = v
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      if (d[i] === 0) continue
      let v = d[i]
      const a = at(x + 1, y) + 1, b = at(x, y + 1) + 1
      const c = at(x + 1, y + 1) + SQ2, e = at(x - 1, y + 1) + SQ2
      if (a < v) v = a; if (b < v) v = b; if (c < v) v = c; if (e < v) v = e
      d[i] = v
    }
  }
  return d
}

/**
 * Rasterizes an edit into the geometry `applyEdit` needs.
 *
 * Split out from `applyEdit` because it depends only on the *shape* of the edit
 * and the raster's dimensions — not on the pixel values. A streaming Soundscape
 * replaces the pixels 30×/s under an unchanged selection, so the store caches
 * this and each frame pays only the per-pixel copy.
 *
 * @returns {{x,y,w,h, mask: Uint8Array|null, weight: Float32Array|null}|null}
 *   `mask` null means "every cell in the rect is selected" (a plain crop of a
 *   raster that has no nodata of its own), so no per-cell test is needed at all.
 */
export function buildEditMask(edit, srcMask, srcW, srcH) {
  const b = effectiveBounds(edit, srcW, srcH)
  if (!b) return null

  const shape = isUsableShape(edit?.shape) ? edit.shape : null
  const feather = Math.max(0, edit?.feather ?? 0)
  const needsMask = !!shape || !!srcMask

  let mask = null
  if (needsMask) {
    mask = new Uint8Array(b.w * b.h)
    if (!shape) mask.fill(1)
    else if (shape.type === 'ellipse') fillEllipse(mask, shape, b)
    else fillPolygon(mask, shape.points, b)
    // The raster's own voids (GeoTIFF NoData, transparent PNG pixels) are not
    // selectable ground; folding them in here means the feather also softens the
    // edge of a void rather than only the edge the user drew.
    if (srcMask) {
      for (let row = 0; row < b.h; row++) {
        const srcOff = (b.y + row) * srcW + b.x
        const dstOff = row * b.w
        for (let c = 0; c < b.w; c++) if (!srcMask[srcOff + c]) mask[dstOff + c] = 0
      }
    }
  }

  let weight = null
  if (feather > 0) {
    const full = mask ?? new Uint8Array(b.w * b.h).fill(1)
    const dist = distanceToEdge(full, b.w, b.h)
    weight = dist
    for (let i = 0; i < dist.length; i++) {
      const t = Math.min(1, dist[i] / feather)
      weight[i] = t * t * (3 - 2 * t)   // smoothstep
    }
  }

  return { ...b, mask, weight }
}

/**
 * Applies an edit to a source raster.
 *
 * Feathering is done as an elevation ramp rather than as mask opacity: the
 * geometry pipeline's mask is binary (a cell is ground or it is not), so a
 * partial weight has nowhere to live there. Fading the *value* toward the
 * lowest point of the selection instead makes the clipped edge melt down to its
 * own base level, which is both what a feathered cut should look like and what
 * keeps a clipped STL printable.
 *
 * @param {{pixels: Float32Array, mask: Uint8Array|null, width: number, height: number}} src
 * @param {object|null} edit
 * @param {object|null} pre  cached `buildEditMask` result for this edit
 */
export function applyEdit(src, edit, pre = null) {
  if (!edit || !src?.pixels) {
    return { pixels: src.pixels, mask: src.mask, width: src.width, height: src.height }
  }
  const m = pre ?? buildEditMask(edit, src.mask, src.width, src.height)
  // An empty selection would leave nothing to render and no way back except the
  // panel; showing the raster unclipped is the honest failure.
  if (!m) return { pixels: src.pixels, mask: src.mask, width: src.width, height: src.height }

  const { x, y, w, h, mask, weight } = m
  const pixels = new Float32Array(w * h)
  const outMask = mask ? new Uint8Array(w * h) : null

  // The floor the feather ramps down to — the lowest selected point, so the
  // ramp joins the terrain's own base rather than a value it never reaches.
  let floorV = 0
  if (weight) {
    floorV = Infinity
    for (let row = 0; row < h; row++) {
      const srcOff = (y + row) * src.width + x
      const dstOff = row * w
      for (let c = 0; c < w; c++) {
        if (mask && !mask[dstOff + c]) continue
        const v = src.pixels[srcOff + c]
        if (v < floorV) floorV = v
      }
    }
    if (!isFinite(floorV)) floorV = 0
  }

  for (let row = 0; row < h; row++) {
    const srcOff = (y + row) * src.width + x
    const dstOff = row * w
    for (let c = 0; c < w; c++) {
      const di = dstOff + c
      if (mask && !mask[di]) continue     // pixels/outMask are already 0 here
      const v = src.pixels[srcOff + c]
      pixels[di] = weight ? floorV + (v - floorV) * weight[di] : v
      if (outMask) outMask[di] = 1
    }
  }

  return { pixels, mask: outMask, width: w, height: h }
}

/**
 * The georeferenced extent of a cropped raster.
 *
 * Linear over the pixel grid with north up, which is the same mapping
 * `geoToPixel` in geoCoords.js reads the bbox with. Without this, a GPX track
 * would still be projected against the *uncropped* extent and land in the wrong
 * part of the terrain.
 */
export function cropBbox(bbox, b, srcW, srcH) {
  if (!bbox || !b) return bbox ?? null
  const [minX, minY, maxX, maxY] = bbox
  const sx = (maxX - minX) / srcW
  const sy = (maxY - minY) / srcH
  return [
    minX + b.x * sx,
    maxY - (b.y + b.h) * sy,
    minX + (b.x + b.w) * sx,
    maxY - b.y * sy,
  ]
}

/** One-line description of an edit for the sidebar status row. */
export function describeEdit(edit, srcW, srcH) {
  if (!edit) return null
  const b = effectiveBounds(edit, srcW, srcH)
  if (!b) return null
  const parts = [`${b.w}×${b.h} of ${srcW}×${srcH}`]
  if (isUsableShape(edit.shape)) parts.push(edit.shape.type)
  if (edit.feather > 0) parts.push(`feather ${Math.round(edit.feather)}px`)
  return parts.join(' · ')
}
