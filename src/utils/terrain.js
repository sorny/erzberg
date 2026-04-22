/**
 * Terrain data extraction and processing.
 */

/** Apply a box blur to a Float32Array of brightness values using an integral image. O(W×H). */
export function boxBlur(pixels, width, height, radius) {
  if (radius <= 0) return pixels
  const r = Math.round(radius)
  const integral = new Float64Array((width + 1) * (height + 1))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      integral[(y + 1) * (width + 1) + (x + 1)] = pixels[y * width + x] + integral[y * (width + 1) + (x + 1)] + integral[(y + 1) * (width + 1) + x] - integral[y * (width + 1) + x]
    }
  }
  const out = new Float32Array(pixels.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(width - 1, x + r), y1 = Math.min(height - 1, y + r)
      const area = (x1 - x0 + 1) * (y1 - y0 + 1)
      out[y * width + x] = (integral[(y1 + 1) * (width + 1) + (x1 + 1)] - integral[y0 * (width + 1) + (x1 + 1)] - integral[(y1 + 1) * (width + 1) + x0] + integral[y0 * (width + 1) + x0]) / area
    }
  }
  return out
}

/**
 * Build the terrain grid from loaded heightmap pixel data.
 * Respects the nodataMask to skip invalid pixels.
 */
export function buildTerrain(rawPixels, nodataMask, imageWidth, imageHeight, p) {
  const { resolution: scl, blurRadius, gridOffsetX, gridOffsetY, blackPoint, whitePoint, elevScale } = p
  const blurred = boxBlur(rawPixels, imageWidth, imageHeight, blurRadius)
  
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

  const minZ = (minBrightness - 0.5) * 100 * elevScale, maxZ = (maxBrightness - 0.5) * 100 * elevScale
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
    minZ, maxZ, maxSlope, gridSlopes, elevScale 
  }
}

export function cellElev(grid, r, c, cols, elevScale, jitterAmt = 0) {
  const brightness = grid[r * cols + c]
  let elev = (brightness - 0.5) * 100 * elevScale
  if (jitterAmt > 0) {
    const nx = c * 0.15, ny = r * 0.15, ix = Math.floor(nx), iy = Math.floor(ny), fx = nx - ix, fy = ny - iy
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10), uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    const h = (a, b) => {
      let n = ((a * 1031 + b * 2999) | 0); n = (((n ^ (n >>> 13)) * 0x45d9f3b) | 0)
      return (((n ^ (n >>> 16)) & 0xffff) / 0xffff)
    }
    const noise = h(ix,iy)*(1-ux)*(1-uy) + h(ix+1,iy)*ux*(1-uy) + h(ix,iy+1)*(1-ux)*uy + h(ix+1,iy+1)*ux*uy
    elev += (noise - 0.5) * jitterAmt * 2
  }
  return elev
}

/** Check if a grid cell and its immediate neighborhood have valid data. */
export function hasData(gridMask, r, c, cols) {
  if (!gridMask) return true
  return gridMask[r * cols + c] === 1
}
