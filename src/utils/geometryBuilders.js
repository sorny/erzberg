/**
 * CPU-side geometry builders.
 * Each builder returns { positions: Float32Array, colors: Float32Array }
 * where positions are packed as segment pairs [ax,ay,az, bx,by,bz, ...]
 * and colors are RGB per vertex [r,g,b, r,g,b, ...] matching positions.
 *
 * These arrays are passed directly to LineSegmentsGeometry.setPositions / setColors.
 */

import { cellElev } from './terrain'
import { hexToRgb, sampleGradient, computeVertexColor } from './colorUtils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normElev(elev, minZ, maxZ) {
  return maxZ > minZ ? (elev - minZ) / (maxZ - minZ) : 0
}

function inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut) {
  const n = normElev(elev, minZ, maxZ)
  return n >= elevMinCut / 100 && n <= elevMaxCut / 100
}


// ─── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Main entry. Returns geometry arrays for the active draw mode(s).
 * Supports both single string mode or an array of modes.
 * @param {object} terrain   Output of buildTerrain()
 * @param {object} p         All Leva params (terrain + visual)
 */
export function buildLineGeometry(terrain, p) {
  if (!terrain) return empty()
  
  const modes = Array.isArray(p.drawMode) ? p.drawMode : [p.drawMode]
  if (modes.length === 0) return empty()

  const results = modes.map(m => {
    switch (m) {
      case 'lines-x':    return buildRidgelines(terrain, p, false)
      case 'lines-y':    return buildRidgelines(terrain, p, true)
      case 'crosshatch': return buildCrosshatch(terrain, p)
      case 'hachure':    return buildHachure(terrain, p)
      case 'contours':   return buildContours(terrain, p)
      case 'flow':       return buildFlowLines(terrain, p)
      default:           return empty()
    }
  })

  // Merge results efficiently
  let totalPos = 0, totalCol = 0
  for (const r of results) {
    totalPos += r.positions.length
    totalCol += r.colors.length
  }
  const positions = new Float32Array(totalPos)
  const colors = new Float32Array(totalCol)
  let offsetPos = 0, offsetCol = 0
  for (const r of results) {
    positions.set(r.positions, offsetPos)
    colors.set(r.colors, offsetCol)
    offsetPos += r.positions.length
    offsetCol += r.colors.length
  }

  return { positions, colors }
}

function empty() {
  return { positions: new Float32Array(0), colors: new Float32Array(0) }
}

// ─── Ridgelines (lines-x / lines-y) ──────────────────────────────────────────

function buildRidgelines(terrain, p, isY) {
  const { grid, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const {
    lineSpacing, lineShift, elevScale,
    elevMinCut, elevMaxCut,
    jitterAmt,
  } = p

  const lineStep   = Math.max(1, Math.round(lineSpacing / scl))
  const lineOffset = (lineShift ?? 0) % lineStep
  const outerCount = isY ? cols : rows
  const innerCount = isY ? rows : cols

  const positions = []
  const colors = []

  for (let outer = lineOffset; outer < outerCount; outer += lineStep) {

    const outerPos = outer * scl - (isY ? halfW : halfH)

    for (let inner = 0; inner < innerCount - 1; inner++) {
      const r0 = isY ? inner : outer
      const c0 = isY ? outer : inner
      const r1 = isY ? inner + 1 : outer
      const c1 = isY ? outer : inner + 1

      const elev0 = cellElev(grid, r0, c0, cols, elevScale, jitterAmt)
      const elev1 = cellElev(grid, r1, c1, cols, elevScale, jitterAmt)

      if (!inElevCut(elev0, minZ, maxZ, elevMinCut, elevMaxCut) ||
          !inElevCut(elev1, minZ, maxZ, elevMinCut, elevMaxCut)) continue

      const innerPos0 = inner * scl - (isY ? halfH : halfW)
      const innerPos1 = (inner + 1) * scl - (isY ? halfH : halfW)

      let x0, z0, x1, z1
      if (isY) {
        x0 = outerPos; z0 = innerPos0
        x1 = outerPos; z1 = innerPos1
      } else {
        x0 = innerPos0; z0 = outerPos
        x1 = innerPos1; z1 = outerPos
      }

      positions.push(x0, elev0, z0, x1, elev1, z1)

      const slope0 = gridSlopes[r0 * cols + c0]
      const slope1 = gridSlopes[r1 * cols + c1]
      
      // Approximate aspect for grid lines
      const aspect0 = isY ? Math.PI : Math.PI/2

      const col0 = computeVertexColor(normElev(elev0, minZ, maxZ), slope0 / (maxSlope || 1), aspect0, p)
      const col1 = computeVertexColor(normElev(elev1, minZ, maxZ), slope1 / (maxSlope || 1), aspect0, p)
      colors.push(...col0, ...col1)
    }
  }

  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Crosshatch ───────────────────────────────────────────────────────────────

function buildCrosshatch(terrain, p) {
  const x = buildRidgelines(terrain, p, false)
  const y = buildRidgelines(terrain, p, true)
  return {
    positions: concat(x.positions, y.positions),
    colors: concat(x.colors, y.colors),
  }
}

// ─── Hachure ──────────────────────────────────────────────────────────────────

function buildHachure(terrain, p) {
  const { grid, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { hachureSpacing, elevScale, hachureLength, elevMinCut, elevMaxCut, jitterAmt } = p

  const lineStep = Math.max(1, Math.round((hachureSpacing ?? 4) / scl))
  const positions = []
  const colors = []

  for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {   // same spacing in both axes
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue

      // Central-difference gradient (smoother direction than forward differences)
      const bC  = grid[r * cols + c]
      const bL  = c > 0       ? grid[r * cols + c - 1]       : bC
      const bR  = c < cols-1  ? grid[r * cols + c + 1]       : bC
      const bU  = r > 0       ? grid[(r - 1) * cols + c]     : bC
      const bD  = r < rows-1  ? grid[(r + 1) * cols + c]     : bC
      const gx = (bR - bL) * 50 * elevScale   // elevation rise per grid step in X
      const gz = (bD - bU) * 50 * elevScale   // elevation rise per grid step in Z
      const mag = Math.sqrt(gx * gx + gz * gz)
      if (mag < 0.005) continue   // flat cell — skip

      // Tick runs PERPENDICULAR to gradient (along the contour)
      const tickLen = mag * hachureLength * scl
      const nx = -gz / mag   // perpendicular unit vector X
      const nz =  gx / mag   // perpendicular unit vector Z

      const wx = c * scl - halfW
      const wz = r * scl - halfH

      positions.push(
        wx - nx * tickLen * 0.5, elev, wz - nz * tickLen * 0.5,
        wx + nx * tickLen * 0.5, elev, wz + nz * tickLen * 0.5,
      )

      const slope = gridSlopes[r * cols + c]
      const aspect = Math.atan2(gz, gx)
      const col = computeVertexColor(normElev(elev, minZ, maxZ), slope / (maxSlope || 1), aspect, p)
      colors.push(...col, ...col)
    }
  }

  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Contours (marching squares) ──────────────────────────────────────────────

/** Bilinear interpolation of edge crossing position */
function edgeLerp(v0, v1, level) {
  if (Math.abs(v1 - v0) < 1e-10) return 0.5
  return (level - v0) / (v1 - v0)
}

/**
 * Standard 16-case marching squares on the brightness grid.
 * Returns flat array of [x0,z0, x1,z1, ...] segment endpoints (grid-local coords).
 */
function marchSquares(grid, rows, cols, level) {
  const segs = []  // [c0,r0, c1,r1, ...]

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const v00 = grid[r * cols + c]
      const v10 = grid[r * cols + c + 1]
      const v01 = grid[(r + 1) * cols + c]
      const v11 = grid[(r + 1) * cols + c + 1]

      const idx =
        (v00 >= level ? 8 : 0) |
        (v10 >= level ? 4 : 0) |
        (v11 >= level ? 2 : 0) |
        (v01 >= level ? 1 : 0)

      if (idx === 0 || idx === 15) continue

      // Edge intersections: top, right, bottom, left
      const top    = [c + edgeLerp(v00, v10, level), r]
      const right  = [c + 1, r + edgeLerp(v10, v11, level)]
      const bottom = [c + edgeLerp(v01, v11, level), r + 1]
      const left   = [c, r + edgeLerp(v00, v01, level)]

      // Emit one or two segments per cell
      const pairs = MARCHING_TABLE[idx]
      for (let i = 0; i < pairs.length; i += 2) {
        const [e0, e1] = [edges(top, right, bottom, left)[pairs[i]],
                          edges(top, right, bottom, left)[pairs[i + 1]]]
        segs.push(e0[0], e0[1], e1[0], e1[1])
      }
    }
  }
  return segs
}

function edges(top, right, bottom, left) {
  return [top, right, bottom, left]
}

// Marching-squares case table: each entry lists which edge pairs to connect.
// Edges: 0=top, 1=right, 2=bottom, 3=left
const MARCHING_TABLE = {
  1:  [3, 2],        // ◤
  2:  [2, 1],        // ◥  (rotated)
  3:  [3, 1],
  4:  [0, 1],
  5:  [0, 3, 2, 1],  // saddle: two segs
  6:  [0, 2],
  7:  [0, 3],
  8:  [0, 3],
  9:  [0, 2],
  10: [0, 1, 2, 3],  // saddle
  11: [0, 1],
  12: [3, 1],
  13: [2, 1],
  14: [3, 2],
}

function buildContours(terrain, p) {
  const { grid, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope } = terrain
  const { elevScale, contourInterval, elevMinCut, elevMaxCut } = p

  const positions = []
  const colors = []

  // Levels in brightness space
  const elevRange = 100 * elevScale
  const levelCount = Math.ceil(elevRange / contourInterval) + 1
  const startElev = Math.ceil((-elevRange / 2) / contourInterval) * contourInterval

  for (let li = 0; li < levelCount; li++) {
    const elev = startElev + li * contourInterval
    if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue

    // Convert elevation to brightness level
    const bLevel = elev / (100 * elevScale) + 0.5

    const segs = marchSquares(grid, rows, cols, bLevel)

    // For contours, slope is effectively 0 at the line itself. Aspect can be calculated from gradient.
    const col = computeVertexColor(normElev(elev, minZ, maxZ), 0, 0, p)

    for (let i = 0; i < segs.length; i += 4) {
      const c0 = segs[i],   r0 = segs[i + 1]
      const c1 = segs[i + 2], r1 = segs[i + 3]

      // Bilinearly interpolate elevation at fractional grid positions
      const e0 = interpElev(grid, rows, cols, r0, c0, elevScale)
      const e1 = interpElev(grid, rows, cols, r1, c1, elevScale)

      const x0 = c0 * scl - halfW, z0 = r0 * scl - halfH
      const x1 = c1 * scl - halfW, z1 = r1 * scl - halfH

      positions.push(x0, e0, z0, x1, e1, z1)
      colors.push(...col, ...col)
    }
  }

  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

function interpElev(grid, rows, cols, r, c, elevScale) {
  const r0 = Math.min(rows - 1, Math.floor(r))
  const c0 = Math.min(cols - 1, Math.floor(c))
  const r1 = Math.min(rows - 1, r0 + 1)
  const c1 = Math.min(cols - 1, c0 + 1)
  const fr = r - r0, fc = c - c0
  const b = (
    grid[r0 * cols + c0] * (1 - fr) * (1 - fc) +
    grid[r0 * cols + c1] * (1 - fr) * fc +
    grid[r1 * cols + c0] * fr * (1 - fc) +
    grid[r1 * cols + c1] * fr * fc
  )
  return (b - 0.5) * 100 * elevScale
}

// ─── Flow lines (gradient-descent streamlines) ───────────────────────────────

/** Bilinear brightness sample at continuous grid coords (fr=row, fc=col) */
function sampleBrightness(grid, rows, cols, fr, fc) {
  const r0 = Math.max(0, Math.min(rows - 1, Math.floor(fr)))
  const c0 = Math.max(0, Math.min(cols - 1, Math.floor(fc)))
  const r1 = Math.min(rows - 1, r0 + 1)
  const c1 = Math.min(cols - 1, c0 + 1)
  const dr = fr - r0, dc = fc - c0
  return (
    grid[r0 * cols + c0] * (1 - dr) * (1 - dc) +
    grid[r0 * cols + c1] * (1 - dr) * dc +
    grid[r1 * cols + c0] * dr * (1 - dc) +
    grid[r1 * cols + c1] * dr * dc
  )
}

function buildFlowLines(terrain, p) {
  const { grid, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope } = terrain
  const {
    lineSpacing, elevScale,
    flowStep = 0.5, flowMaxLen = 100,
    elevMinCut, elevMaxCut,
  } = p

  const lineStep = Math.max(1, Math.round(lineSpacing / scl))
  
  // High budget for dense flow fields
  const MAX_TOTAL_SEGMENTS = 3000000
  let totalSegments = 0

  const posBuf = new Float32Array(MAX_TOTAL_SEGMENTS * 6)
  const colBuf = new Float32Array(MAX_TOTAL_SEGMENTS * 6)

  // Occupancy mask prevents redundant lines in the same valleys
  const mask = new Uint8Array(rows * cols)

  const eps = 0.5

  outer: for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {
      if (totalSegments >= MAX_TOTAL_SEGMENTS) break outer
      
      // If this start point is already covered by a flow line, skip it
      if (mask[r * cols + c]) continue

      let fr = r, fc = c
      let b0 = sampleBrightness(grid, rows, cols, fr, fc)
      let e0 = (b0 - 0.5) * 100 * elevScale

      for (let step = 0; step < flowMaxLen; step++) {
        if (totalSegments >= MAX_TOTAL_SEGMENTS) break outer
        
        if (fr < eps || fr > rows - 1 - eps || fc < eps || fc > cols - 1 - eps) break

        // Mark mask (cruder than sub-pixel but effective for stopping convergence)
        mask[Math.round(fr) * cols + Math.round(fc)] = 1

        // Gradient
        const bL = sampleBrightness(grid, rows, cols, fr, fc - eps)
        const bR = sampleBrightness(grid, rows, cols, fr, fc + eps)
        const bU = sampleBrightness(grid, rows, cols, fr - eps, fc)
        const bD = sampleBrightness(grid, rows, cols, fr + eps, fc)
        
        const gx = bR - bL
        const gz = bD - bU
        const mag = Math.sqrt(gx * gx + gz * gz)
        if (mag < 0.0005) break

        const nfc = fc - (gx / mag) * flowStep
        const nfr = fr - (gz / mag) * flowStep
        
        // If we moved into a heavily occupied cell, stop this line
        if (mask[Math.round(nfr) * cols + Math.round(nfc)]) break

        const b1 = sampleBrightness(grid, rows, cols, nfr, nfc)
        const e1 = (b1 - 0.5) * 100 * elevScale

        const in0 = inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut)
        const in1 = inElevCut(e1, minZ, maxZ, elevMinCut, elevMaxCut)

        if (in0 && in1) {
          const pIdx = totalSegments * 6
          posBuf[pIdx]   = fc  * scl - halfW; posBuf[pIdx+1] = e0; posBuf[pIdx+2] = fr  * scl - halfH
          posBuf[pIdx+3] = nfc * scl - halfW; posBuf[pIdx+4] = e1; posBuf[pIdx+5] = nfr * scl - halfH

          const slopeNorm = Math.min(1, mag / (maxSlope || 0.02))
          const aspect = Math.atan2(gz, gx)

          const c0 = computeVertexColor(normElev(e0, minZ, maxZ), slopeNorm, aspect, p)
          const c1 = computeVertexColor(normElev(e1, minZ, maxZ), slopeNorm, aspect, p)
          
          colBuf[pIdx] = c0[0]; colBuf[pIdx+1] = c0[1]; colBuf[pIdx+2] = c0[2]
          colBuf[pIdx+3] = c1[0]; colBuf[pIdx+4] = c1[1]; colBuf[pIdx+5] = c1[2]
          
          totalSegments++
        } else if (!in0 && !in1) {
          break
        }

        fr = nfr; fc = nfc; b0 = b1; e0 = e1
      }
    }
  }

  return { 
    positions: posBuf.slice(0, totalSegments * 6), 
    colors: colBuf.slice(0, totalSegments * 6) 
  }
}

// ─── Surface mesh geometry (triangle grid) ────────────────────────────────────

/**
 * Build triangle-grid geometry for the terrain surface.
 * Elevation is BAKED into Y positions so that wireframe, normals, and
 * any material (including plain MeshBasicMaterial) all work correctly.
 * `brightness` attribute [0–1] is kept for gradient coloring in the shader.
 */
export function buildSurfaceGeometry(terrain, elevScale, jitterAmt) {
  const { grid, rows, cols, scl, halfW, halfH } = terrain

  const vertexCount = rows * cols
  const positions    = new Float32Array(vertexCount * 3)
  const brightnessBuf = new Float32Array(vertexCount)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i   = r * cols + c
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      positions[i * 3]     = c * scl - halfW
      positions[i * 3 + 1] = elev          // ← actual elevation baked in
      positions[i * 3 + 2] = r * scl - halfH
      brightnessBuf[i] = grid[i]
    }
  }

  const indexCount = (rows - 1) * (cols - 1) * 6
  const indices = new Uint32Array(indexCount)
  let idx = 0
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = r * cols + c
      const tr = tl + 1
      const bl = tl + cols
      const br = bl + 1
      indices[idx++] = tl; indices[idx++] = bl; indices[idx++] = tr
      indices[idx++] = tr; indices[idx++] = bl; indices[idx++] = br
    }
  }

  return { positions, brightnessBuf, indices }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function concat(a, b) {
  const out = new Float32Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
