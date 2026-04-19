/**
 * Terrain data extraction and processing.
 *
 * Coordinate convention (Three.js world space):
 *   X = terrain column  (right)
 *   Y = elevation       (up)
 *   Z = terrain row     (toward viewer)
 *
 * Elevation = (brightness − 0.5) × 100 × elevScale
 *   → black (0) → −50 × elevScale
 *   → white (1) → +50 × elevScale
 */

/** Apply a box blur to a Float32Array of brightness values using an integral image. O(W×H). */
export function boxBlur(pixels, width, height, radius) {
  if (radius <= 0) return pixels
  const r = Math.round(radius)
  const integral = new Float64Array((width + 1) * (height + 1))

  // Build 2D integral image
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      integral[(y + 1) * (width + 1) + (x + 1)] =
        pixels[y * width + x] +
        integral[y * (width + 1) + (x + 1)] +
        integral[(y + 1) * (width + 1) + x] -
        integral[y * (width + 1) + x]
    }
  }

  const out = new Float32Array(pixels.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const y0 = Math.max(0, y - r)
      const x1 = Math.min(width - 1, x + r)
      const y1 = Math.min(height - 1, y + r)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      out[y * width + x] = (
        integral[(y1 + 1) * (width + 1) + (x1 + 1)] -
        integral[y0 * (width + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0]
      ) / area
    }
  }
  return out
}

/**
 * Build the terrain grid from loaded heightmap pixel data.
 *
 * @param {Float32Array} rawPixels  Brightness per pixel, 0–1
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {object} p               Terrain params from Leva
 * @returns {{ grid, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes }}
 */
export function buildTerrain(rawPixels, imageWidth, imageHeight, p) {
  const {
    resolution: scl,
    blurRadius,
    gridOffsetX,
    gridOffsetY,
    blackPoint,
    whitePoint,
    elevScale,
  } = p

  // Blur first
  const blurred = boxBlur(rawPixels, imageWidth, imageHeight, blurRadius)

  // Sampling with sub-pixel offsets
  const peakOff = Math.floor(gridOffsetX ?? 0) % scl
  const lineOff = Math.floor(gridOffsetY ?? 0) % scl

  const cols = Math.max(2, Math.ceil((imageWidth - peakOff) / scl) + 1)
  const rows = Math.max(2, Math.ceil((imageHeight - lineOff) / scl) + 1)

  const bpN = blackPoint / 255
  const wpN = whitePoint / 255
  const bpWpRange = Math.max(1e-6, wpN - bpN)

  const grid = new Float32Array(rows * cols)

  let minBrightness = 1, maxBrightness = 0

  for (let r = 0; r < rows; r++) {
    const py = Math.min(imageHeight - 1, r * scl + lineOff)
    for (let c = 0; c < cols; c++) {
      const px = Math.min(imageWidth - 1, c * scl + peakOff)
      const raw = blurred[Math.round(py) * imageWidth + Math.round(px)]
      const clamped = Math.max(bpN, Math.min(wpN, raw))
      const norm = (clamped - bpN) / bpWpRange
      grid[r * cols + c] = norm
      if (norm < minBrightness) minBrightness = norm
      if (norm > maxBrightness) maxBrightness = norm
    }
  }

  // Actual elevation range
  const minZ = (minBrightness - 0.5) * 100 * elevScale
  const maxZ = (maxBrightness - 0.5) * 100 * elevScale

  // Max slope (gradient magnitude in brightness units per grid step)
  let maxSlope = 0
  const gridSlopes = new Float32Array(rows * cols)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b = grid[r * cols + c]
      const br = c < cols - 1 ? grid[r * cols + c + 1] : b
      const bd = r < rows - 1 ? grid[(r + 1) * cols + c] : b
      const slope = Math.sqrt((br - b) ** 2 + (bd - b) ** 2)
      gridSlopes[r * cols + c] = slope
      if (slope > maxSlope) maxSlope = slope
    }
  }

  const halfW = ((cols - 1) * scl) / 2
  const halfH = ((rows - 1) * scl) / 2

  return { grid, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes, elevScale }
}

/** Return Three.js world-space Y (elevation) for a grid cell. */
export function cellElev(grid, r, c, cols, elevScale, jitterAmt = 0) {
  const brightness = grid[r * cols + c]
  let elev = (brightness - 0.5) * 100 * elevScale
  if (jitterAmt > 0) {
    // inline value noise — avoids import inside tight loop
    const nx = c * 0.15, ny = r * 0.15
    const ix = Math.floor(nx), iy = Math.floor(ny)
    const fx = nx - ix, fy = ny - iy
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    const h = (a, b) => {
      let n = ((a * 1031 + b * 2999) | 0)
      n = (((n ^ (n >>> 13)) * 0x45d9f3b) | 0)
      return (((n ^ (n >>> 16)) & 0xffff) / 0xffff)
    }
    const noise = h(ix,iy)*(1-ux)*(1-uy) + h(ix+1,iy)*ux*(1-uy) + h(ix,iy+1)*(1-ux)*uy + h(ix+1,iy+1)*ux*uy
    elev += (noise - 0.5) * jitterAmt * 2
  }
  return elev
}
