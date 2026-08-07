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
 */
export function boxBlur(pixels, width, height, radius) {
  if (radius <= 0) return pixels
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
  const blurred = preBlurred ?? boxBlur(rawPixels, imageWidth, imageHeight, blurRadius)
  
  // Calculate grid dimensions correctly based on resolution
  const peakOff = Math.floor(gridOffsetX ?? 0)
  const lineOff = Math.floor(gridOffsetY ?? 0)
  const cols = Math.floor((imageWidth - peakOff) / scl)
  const rows = Math.floor((imageHeight - lineOff) / scl)
  
  const bpN = blackPoint / 255, wpN = whitePoint / 255, bpWpRange = Math.max(1e-6, wpN - bpN)

  const grid = new Float32Array(rows * cols)
  const gridMask = new Uint8Array(rows * cols)
  let minBrightness = 1, maxBrightness = 0

  for (let r = 0; r < rows; r++) {
    const py = r * scl + lineOff
    for (let c = 0; c < cols; c++) {
      const px = c * scl + peakOff
      const idx = py * imageWidth + px
      
      if (nodataMask && (nodataMask[idx] === 0 || idx >= rawPixels.length)) {
        grid[r * cols + c] = 0; gridMask[r * cols + c] = 0
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
  // Every consumer guards with `maxZ > minZ` and silently degrades when it fails
  // — normElev returns 0 for every vertex, so hypsometric ramps collapse to one
  // colour and an elevation cut above 0 culls the entire scene. Inverting the
  // terrain is a legitimate use of a signed slider; it should not also turn off
  // colouring.
  const zA = (minBrightness - 0.5) * 100 * elevScale
  const zB = (maxBrightness - 0.5) * 100 * elevScale
  const minZ = Math.min(zA, zB), maxZ = Math.max(zA, zB)
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
    halfW: hasValid ? ((minC + maxC) * scl) / 2 : ((cols - 1) * scl) / 2,
    halfH: hasValid ? ((minR + maxR) * scl) / 2 : ((rows - 1) * scl) / 2,
    minZ, maxZ, maxSlope, gridSlopes, elevScale,
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
