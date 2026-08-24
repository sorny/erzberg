/**
 * Terrain data extraction and processing.
 */

/**
 * Y value parked on surface vertices with no data.
 *
 * The renderer never sees these — `buildSurfaceGeometry` emits a quad only when
 * all four corners are valid, so a masked vertex is never referenced by an
 * index. Anything reading the position array *directly* must exclude them by
 * hand, which is why this lives here rather than as a literal at the one write
 * site: STL export walks the raw positions and once shipped a base plate 10 000
 * units below the model because it did not know.
 */
export const NODATA_SENTINEL_Y = -10000

/**
 * Area-average a raster onto a different grid, skipping NoData.
 *
 * Used to square up a pixel that is not square on the ground. Every destination
 * cell covers an axis-aligned rectangle of source cells and takes their mean
 * weighted by how much of each it actually overlaps, so a non-integer ratio
 * (1.474, for a square-degree raster in the Alps) does not beat between keeping
 * and dropping whole rows. A cell whose rectangle holds no valid source is NaN,
 * which every `isNodata` here already rejects on the `!isFinite` test — the
 * declared NoData value is deliberately not reused, since a raster that declares
 * none would then have no fill to write.
 *
 * Downsampling only, in the sense that matters: the caller shrinks the finer
 * axis rather than stretching the coarser one, so this never has to invent a
 * value between two samples.
 */
export function areaResample(src, width, height, newWidth, newHeight, isNodata) {
  const out = new Float32Array(newWidth * newHeight)
  const sx = width / newWidth, sy = height / newHeight

  for (let r = 0; r < newHeight; r++) {
    const y0 = r * sy, y1 = y0 + sy
    const ry0 = Math.floor(y0), ry1 = Math.min(height - 1, Math.ceil(y1) - 1)
    for (let c = 0; c < newWidth; c++) {
      const x0 = c * sx, x1 = x0 + sx
      const rx0 = Math.floor(x0), rx1 = Math.min(width - 1, Math.ceil(x1) - 1)

      let sum = 0, wsum = 0
      for (let y = ry0; y <= ry1; y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0)
        if (wy <= 0) continue
        const row = y * width
        for (let x = rx0; x <= rx1; x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0)
          if (wx <= 0) continue
          const v = src[row + x]
          if (isNodata(v)) continue
          const w = wx * wy
          sum += v * w; wsum += w
        }
      }
      out[r * newWidth + c] = wsum > 0 ? sum / wsum : NaN
    }
  }
  return out
}

// Separable box blur: horizontal window mean per row, then vertical window mean
// per column. Because the horizontal window (and its clamped count) depends only
// on x, mean-of-means equals the 2D box mean exactly — identical output to an
// integral-image blur, but without the Float64 integral of the FULL-RES image
// ((W+1)×(H+1)×8 bytes ≈ 512 MB for an 8k GeoTIFF). Peak extra memory here is
// two W×H Float32 buffers; accumulators are Float64 scalars/rows for precision.
function boxBlurInt(pixels, width, height, r) {
  // Horizontal pass — per-row prefix sums (reused buffer), clamped window mean.
  const tmp = new Float32Array(pixels.length)
  const pre = new Float64Array(width + 1)
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) pre[x + 1] = pre[x] + pixels[row + x]
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(width - 1, x + r)
      tmp[row + x] = (pre[x1 + 1] - pre[x0]) / (x1 - x0 + 1)
    }
  }
  // Vertical pass — rolling per-column sums over the clamped row window.
  const out = new Float32Array(pixels.length)
  const colSum = new Float64Array(width)
  const rInit = Math.min(r, height - 1)
  for (let y = 0; y <= rInit; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) colSum[x] += tmp[row + x]
  }
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(height - 1, y + r)
    const invCount = 1 / (y1 - y0 + 1)
    const row = y * width
    for (let x = 0; x < width; x++) out[row + x] = colSum[x] * invCount
    const yAdd = y + r + 1
    if (yAdd < height) { const ra = yAdd * width; for (let x = 0; x < width; x++) colSum[x] += tmp[ra + x] }
    if (y - r >= 0)    { const rs = (y - r) * width; for (let x = 0; x < width; x++) colSum[x] -= tmp[rs + x] }
  }
  return out
}

/**
 * Box blur over a Float32Array of brightness values. O(W×H) — see `boxBlurInt`.
 *
 * Fractional radii are supported by lerping the two neighbouring integer
 * radii, which is what lets the Blur slider move smoothly instead of stepping.
 * That costs a second full pass, so the integer case is kept on its own path
 * — and since the slider steps by 0.1, the fractional case is the normal one.
 * The lerp writes back into `lo` rather than allocating a third buffer: at 8k
 * that is 268 MB of peak that bought nothing, `lo` is always a private result
 * of `boxBlurInt` here, and nothing else can be holding a reference to it.
 *
 * `mask` (optional, 1 = data) switches to *normalized convolution*: the window
 * mean is taken over the valid samples alone instead of over the raw buffer,
 * whose NoData cells hold 0. Without it, a blur next to a clipped edge averages
 * real ground against those zeros and sags the terrain toward the floor for a
 * radius' width all along the cut — a dark rim on the surface and, for the modes
 * that differentiate a blurred field, a ring of phantom features tracing the
 * selection. Pass it only when the mask actually has holes (`maskHasHoles`):
 * it costs two extra blur passes and buys nothing on a solid raster.
 */
export function boxBlur(pixels, width, height, radius, mask = null) {
  if (radius <= 0) return pixels
  if (mask) return boxBlurMasked(pixels, mask, width, height, radius)
  const rLo = Math.floor(radius), rHi = Math.ceil(radius), frac = radius - rLo
  if (frac === 0) return boxBlurInt(pixels, width, height, rLo)
  const hi = boxBlurInt(pixels, width, height, rHi)
  // rLo === 0 means "no blur" for the lower end, so the source is the operand —
  // and must not be written to.
  if (rLo <= 0) {
    const out = new Float32Array(pixels.length)
    for (let i = 0; i < pixels.length; i++) out[i] = pixels[i] * (1 - frac) + hi[i] * frac
    return out
  }
  const lo = boxBlurInt(pixels, width, height, rLo)
  for (let i = 0; i < lo.length; i++) lo[i] += (hi[i] - lo[i]) * frac
  return lo
}

/**
 * Normalized convolution: blur the masked signal and the mask itself, then
 * divide. Σ(w·v·m) / Σ(w·m) is the mean over *valid* samples in the window,
 * which is what "blur, ignoring the holes" means.
 *
 * NoData cells keep their 0 rather than being filled in from their neighbours:
 * every consumer gates on the mask, and inventing ground outside the selection
 * would leak it into slope and curvature at the boundary — the very thing this
 * is here to prevent.
 */
function boxBlurMasked(pixels, mask, width, height, radius) {
  const n = pixels.length
  // One scratch buffer serves both convolutions, and the quotient is written
  // back over the numerator: at 8k every full-size Float32Array is 268 MB, so
  // the peak here is three of them rather than five.
  const scratch = new Float32Array(n)
  for (let i = 0; i < n; i++) scratch[i] = mask[i] ? 1 : 0
  const den = boxBlur(scratch, width, height, radius)      // Σ w·m
  for (let i = 0; i < n; i++) scratch[i] = mask[i] ? pixels[i] : 0
  const num = boxBlur(scratch, width, height, radius)      // Σ w·m·v
  for (let i = 0; i < n; i++) {
    // den is the share of the window that carried data. It goes to zero only
    // where no valid cell is within reach at all — and a valid cell falls back
    // to its own unblurred value there rather than to the NoData floor.
    num[i] = mask[i] ? (den[i] > 1e-9 ? num[i] / den[i] : pixels[i]) : 0
  }
  return num
}

/** Whether a NoData mask actually excludes anything — the guard that keeps the
 *  mask-aware paths off the hot path for the usual solid raster. */
export function maskHasHoles(mask) {
  if (!mask) return false
  for (let i = 0; i < mask.length; i++) if (!mask[i]) return true
  return false
}

/**
 * Build the terrain grid from loaded heightmap pixel data.
 * Respects the nodataMask to skip invalid pixels.
 *
 * `preBlurred` lets a caller supply the blurred raster it already has. The blur
 * depends only on the source pixels and the radius, neither of which changes
 * when a style slider moves, so the worker caches it across rebuilds rather than
 * repeating the most expensive step in the pipeline on every drag tick.
 */
export function buildTerrain(rawPixels, nodataMask, imageWidth, imageHeight, p, preBlurred = null) {
  const { resolution: scl, blurRadius, gridOffsetX, gridOffsetY, blackPoint, whitePoint, elevScale } = p
  // `??` is lazy, so the full-resolution mask scan only runs when this call is
  // the one doing the blur — in the worker `preBlurred` is always supplied, and
  // an 8k scan on every slider tick would be pure waste.
  const blurred = preBlurred ??
    boxBlur(rawPixels, imageWidth, imageHeight, blurRadius, maskHasHoles(nodataMask) ? nodataMask : null)

  // Calculate grid dimensions correctly based on resolution
  const peakOff = Math.floor(gridOffsetX ?? 0)
  const lineOff = Math.floor(gridOffsetY ?? 0)
  const cols = Math.floor((imageWidth - peakOff) / scl)
  const rows = Math.floor((imageHeight - lineOff) / scl)
  
  const bpN = blackPoint / 255, wpN = whitePoint / 255, bpWpRange = Math.max(1e-6, wpN - bpN)

  const grid = new Float32Array(rows * cols)
  const gridMask = new Uint8Array(rows * cols)
  let minBrightness = 1, maxBrightness = 0
  let holes = false

  for (let r = 0; r < rows; r++) {
    const py = r * scl + lineOff
    for (let c = 0; c < cols; c++) {
      const px = c * scl + peakOff
      const idx = py * imageWidth + px

      if (nodataMask && (nodataMask[idx] === 0 || idx >= rawPixels.length)) {
        grid[r * cols + c] = 0; gridMask[r * cols + c] = 0; holes = true
      } else {
        const raw = blurred[idx]
        const clamped = Math.max(bpN, Math.min(wpN, raw))
        const norm = (clamped - bpN) / bpWpRange
        grid[r * cols + c] = norm; gridMask[r * cols + c] = 1
        if (norm < minBrightness) minBrightness = norm
        if (norm > maxBrightness) maxBrightness = norm
      }
    }
  }

  // Ordered, not just computed: elevScale is signed (the slider reaches −10, and
  // the effective value is baseElevScale + the user's offset), so a negative
  // scale maps the brightest cell to the lowest elevation and crosses the pair.
  // Every consumer guards with `maxElev > minElev` and silently degrades when that
  // fails — normElev returns 0 for every vertex, so hypsometric ramps collapse to one
  // colour and an elevation cut above 0 culls the entire scene. Inverting the
  // terrain is a legitimate use of a signed slider; it should not also turn off
  // colouring.
  const eLo = (minBrightness - 0.5) * 100 * elevScale
  const eHi = (maxBrightness - 0.5) * 100 * elevScale
  const minElev = Math.min(eLo, eHi), maxElev = Math.max(eLo, eHi)
  let maxSlope = 0
  const gridSlopes = new Float32Array(rows * cols)
  
  let minC = cols, maxC = 0, minR = rows, maxR = 0
  let hasValid = false

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (gridMask[r * cols + c] === 0) continue
      hasValid = true
      if (c < minC) minC = c
      if (c > maxC) maxC = c
      if (r < minR) minR = r
      if (r > maxR) maxR = r

      const b = grid[r * cols + c]
      const br = (c < cols - 1 && gridMask[r * cols + c + 1]) ? grid[r * cols + c + 1] : b
      const bd = (r < rows - 1 && gridMask[(r + 1) * cols + c]) ? grid[(r + 1) * cols + c] : b
      const slope = Math.sqrt((br - b) ** 2 + (bd - b) ** 2)
      gridSlopes[r * cols + c] = slope
      if (slope > maxSlope) maxSlope = slope
    }
  }

  return {
    grid, gridMask, rows, cols, scl,
    // Does the grid have holes at all? Every mask-aware path is a cost the
    // ordinary solid raster should not pay, and the builders have no cheap way
    // to find out for themselves. Answered as a by-product of the scan above,
    // over the *grid* rather than the raster — that is the mask the builders
    // index, and a subsampling resolution can step over a thin void entirely.
    hasNoData: holes,
    // CENTRING OFFSETS, not half-extents, despite the names: world X of cell c is
    // `c·scl − halfW`, which puts the *midpoint* of the valid-cell range at the
    // origin. Every consumer that maps a cell to the world uses them that way.
    halfW: hasValid ? ((minC + maxC) * scl) / 2 : ((cols - 1) * scl) / 2,
    halfH: hasValid ? ((minR + maxR) * scl) / 2 : ((rows - 1) * scl) / 2,
    // The actual half-extents, which are a different number as soon as the valid
    // region is off-centre. For the full grid the two coincide — minC + maxC and
    // maxC − minC are both cols − 1 — which is why using halfW for a size went
    // unnoticed until an off-centre lasso crop: at valid columns 800…1000 of 1024,
    // halfW is 900·scl while the region is only 200·scl wide.
    spanHalfW: hasValid ? ((maxC - minC) * scl) / 2 : ((cols - 1) * scl) / 2,
    spanHalfH: hasValid ? ((maxR - minR) * scl) / 2 : ((rows - 1) * scl) / 2,
    minElev, maxElev, maxSlope, gridSlopes, elevScale,
    // Brightness bounds over the valid cells. Raw terrain view stretches the
    // greyscale across them, so a heightmap occupying only the middle of the
    // range still reads at full contrast instead of as flat mid-grey. The seeds
    // are 1 and 0, so a raster with no valid cell at all leaves them crossed —
    // fall back to the full range rather than shipping an inverted one.
    minB: hasValid ? minBrightness : 0,
    maxB: hasValid ? maxBrightness : 1,
  }
}

/** Deterministic value-noise in [-1, 1] for elevation jitter. Works for
 *  fractional grid coordinates (used by the angle-based line marcher) and
 *  matches cellElev exactly at integer cells. */
export function jitterNoise(c, r) {
  const nx = c * 0.15, ny = r * 0.15, ix = Math.floor(nx), iy = Math.floor(ny), fx = nx - ix, fy = ny - iy
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const h = (a, b) => {
    let n = ((a * 1031 + b * 2999) | 0); n = (((n ^ (n >>> 13)) * 0x45d9f3b) | 0)
    return (((n ^ (n >>> 16)) & 0xffff) / 0xffff)
  }
  const noise = h(ix,iy)*(1-ux)*(1-uy) + h(ix+1,iy)*ux*(1-uy) + h(ix,iy+1)*(1-ux)*uy + h(ix+1,iy+1)*ux*uy
  return (noise - 0.5) * 2
}

export function cellElev(grid, r, c, cols, elevScale, jitterAmt = 0) {
  const brightness = grid[r * cols + c]
  let elev = (brightness - 0.5) * 100 * elevScale
  if (jitterAmt > 0) elev += jitterNoise(c, r) * jitterAmt
  return elev
}

/** Check if a grid cell and its immediate neighborhood have valid data. */
export function hasData(gridMask, r, c, cols) {
  if (!gridMask) return true
  return gridMask[r * cols + c] === 1
}

/**
 * Bilinear brightness sample that never blends against NoData.
 *
 * The grid stores 0 for masked cells, and 0 is not "absent" — it is the darkest
 * possible ground, which `(b − 0.5)·100·elevScale` puts at the very bottom of
 * the scene. A plain bilinear tap whose 2×2 footprint straddles a clipped edge
 * therefore returns a value pulled toward that floor, and any mode that drapes
 * itself on fractional coordinates — Lines and Crosshatch at an oblique bearing,
 * Engraving at every angle, Flow, Swiss rock — drew a segment plunging from the
 * terrain down to the base along the whole cut. Read as pillars; the reason
 * cropping with a lasso or an ellipse fringed the selection with them.
 *
 * The fix is normalized convolution again (cf. `boxBlurMasked`): weight only the
 * corners that carry data and renormalise, so a tap next to the edge returns the
 * height of the ground that IS there. Returns NaN when the footprint holds no
 * data at all, which callers must treat as "no sample here" — a stroke ends
 * rather than diving.
 */
export function sampleBilinear(grid, gridMask, rows, cols, fr, fc) {
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(fr)))
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(fc)))
  const r1 = Math.min(rows - 1, r0 + 1), c1 = Math.min(cols - 1, c0 + 1)
  const dr = fr - r0, dc = fc - c0
  const i00 = r0 * cols + c0, i01 = r0 * cols + c1
  const i10 = r1 * cols + c0, i11 = r1 * cols + c1
  const w00 = (1 - dr) * (1 - dc), w01 = (1 - dr) * dc
  const w10 = dr * (1 - dc),       w11 = dr * dc
  if (!gridMask) {
    return grid[i00] * w00 + grid[i01] * w01 + grid[i10] * w10 + grid[i11] * w11
  }
  // Branch-free: the mask is 0/1, so multiplying through drops the invalid
  // corners from both the sum and its normaliser in one pass.
  const m00 = gridMask[i00], m01 = gridMask[i01], m10 = gridMask[i10], m11 = gridMask[i11]
  const wSum = w00 * m00 + w01 * m01 + w10 * m10 + w11 * m11
  if (wSum <= 0) return NaN
  return (grid[i00] * w00 * m00 + grid[i01] * w01 * m01 +
          grid[i10] * w10 * m10 + grid[i11] * w11 * m11) / wSum
}
