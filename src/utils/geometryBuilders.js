/**
 * CPU-side geometry builders.
 */

import { cellElev, hasData } from './terrain'
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
 * Returns an ARRAY of layers, each with its own geometry and styling.
 */
export function buildLineGeometry(terrain, p) {
  if (!terrain) return []
  
  // Helper to map per-layer hypsometric params to the keys computeVertexColor expects
  const getLayerContext = (id, baseColor, baseOpacity) => ({
    ...p,
    lineColor:        baseColor,
    lineOpacity:      baseOpacity,
    lineHypsometric:  p[`hypso${id}`],
    lineHypsoMode:    p[`hypsoMode${id}`],
    lineBanded:       p[`hypsoBanded${id}`],
    lineHypsoInterval:p[`hypsoInterval${id}`]
  })

  const MODES_CONFIG = [
    { id:'X',       builder: (t, ctx) => buildRidgelines(t, ctx, false, p.spacingX, p.shiftX) },
    { id:'Y',       builder: (t, ctx) => buildRidgelines(t, ctx, true,  p.spacingY, p.shiftY) },
    { id:'Cross',   builder: (t, ctx) => buildCrosshatch(t, ctx) },
    { id:'Pillars', builder: (t, ctx) => buildPillars(t, ctx, p.spacingPillars) },
    { id:'Contours',builder: (t, ctx) => buildContours(t, ctx, p.intervalContours) },
    { id:'Hachure', builder: (t, ctx) => buildHachure(t, ctx, p.spacingHachure, p.lengthHachure) },
    { id:'Flow',    builder: (t, ctx) => buildFlowLines(t, ctx, p.spacingFlow, p.stepFlow, p.maxLenFlow) },
    { id:'Dag',     builder: (t, ctx) => buildDagThinning(t, ctx, p.thresholdDag) },
    { id:'Pencil',  builder: (t, ctx) => buildPencilShading(t, ctx, p.spacingPencil, p.thresholdPencil) },
  ]

  const finalLayers = []

  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)

  for (const cfg of MODES_CONFIG) {
    if (!p[`enabled${cfg.id}`]) continue

    const ctx = getLayerContext(cfg.id, p[`color${cfg.id}`], p[`opacity${cfg.id}`])
    let layerPos = new Float32Array(0), layerCol = new Float32Array(0)
    
    // Build the base pass for this layer once
    const baseRes = cfg.builder(terrain, ctx)
    if (baseRes.positions.length === 0) continue

    // Mirror the base pass into all requested octants
    for (const sx of mX) {
      for (const sy of mY) {
        for (const sz of mZ) {
          const pPass = new Float32Array(baseRes.positions)
          for (let i = 0; i < pPass.length; i += 3) {
            pPass[i] *= sx; pPass[i+1] *= sy; pPass[i+2] *= sz
          }
          layerPos = concat(layerPos, pPass)
          layerCol = concat(layerCol, baseRes.colors)
        }
      }
    }

    finalLayers.push({
      id: cfg.id,
      positions: layerPos,
      colors: layerCol,
      weight: p[`weight${cfg.id}`],
      opacity: p[`opacity${cfg.id}`],
      dash: p[`dash${cfg.id}`]
    })
  }

  return finalLayers
}

function empty() { return { positions: new Float32Array(0), colors: new Float32Array(0) } }

// ─── Ridgelines ──────────────────────────────────────────────────────────────

function buildRidgelines(terrain, p, isY, spacing, shift) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const lineStep = Math.max(1, Math.round((spacing ?? 4) / scl)), lineOffset = (shift ?? 0) % lineStep
  const outerCount = isY ? cols : rows, innerCount = isY ? rows : cols
  const positions = [], colors = []

  for (let outer = lineOffset; outer < outerCount; outer += lineStep) {
    const outerPos = outer * scl - (isY ? halfW : halfH)
    for (let inner = 0; inner < innerCount - 1; inner++) {
      const r0 = isY ? inner : outer, c0 = isY ? outer : inner
      const r1 = isY ? inner + 1 : outer, c1 = isY ? outer : inner + 1
      if (!hasData(gridMask, r0, c0, cols) || !hasData(gridMask, r1, c1, cols)) continue
      const elev0 = cellElev(grid, r0, c0, cols, elevScale, jitterAmt)
      const elev1 = cellElev(grid, r1, c1, cols, elevScale, jitterAmt)
      if (!inElevCut(elev0, minZ, maxZ, elevMinCut, elevMaxCut) || !inElevCut(elev1, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const innerPos0 = inner * scl - (isY ? halfH : halfW), innerPos1 = (inner + 1) * scl - (isY ? halfH : halfW)
      let x0, z0, x1, z1
      if (isY) { x0 = outerPos; z0 = innerPos0; x1 = outerPos; z1 = innerPos1 }
      else { x0 = innerPos0; z0 = outerPos; x1 = innerPos1; z1 = outerPos }
      positions.push(x0, elev0, z0, x1, elev1, z1)
      const slope0 = gridSlopes[r0 * cols + c0], slope1 = gridSlopes[r1 * cols + c1]
      const col0 = computeVertexColor(normElev(elev0, minZ, maxZ), slope0 / (maxSlope || 1), isY ? Math.PI : Math.PI/2, p)
      const col1 = computeVertexColor(normElev(elev1, minZ, maxZ), slope1 / (maxSlope || 1), isY ? Math.PI : Math.PI/2, p)
      colors.push(...col0, ...col1)
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

function buildCrosshatch(terrain, p) {
  const x = buildRidgelines(terrain, p, false, p.spacingCross, 0)
  const y = buildRidgelines(terrain, p, true,  p.spacingCross, 0)
  return { positions: concat(x.positions, y.positions), colors: concat(x.colors, y.colors) }
}

// ─── Hachure ──────────────────────────────────────────────────────────────────

function buildHachure(terrain, p, spacing, length) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const lineStep = Math.max(1, Math.round((spacing ?? 4) / scl))
  const positions = [], colors = []

  for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {
      if (!hasData(gridMask, r, c, cols)) continue
      const b = grid[r * cols + c], elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const br = (c < cols - 1) ? grid[r * cols + c + 1] : b, bd = (r < rows - 1) ? grid[(r + 1) * cols + c] : b
      const gx = br - b, gy = bd - b, len = Math.sqrt(gx * gx + gy * gy)
      if (len < 0.001) continue
      const nx = -gy / len, ny = gx / len, l = (length ?? 1) * len * 50
      const x0 = c * scl - halfW, z0 = r * scl - halfH
      positions.push(x0 - nx * l, elev, z0 - ny * l, x0 + nx * l, elev, z0 + ny * l)
      const col = computeVertexColor(normElev(elev, minZ, maxZ), len / (maxSlope || 1), Math.atan2(gy, gx), p)
      colors.push(...col, ...col)
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Contours ─────────────────────────────────────────────────────────────────

function buildContours(terrain, p, interval) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const positions = [], colors = []
  const step = (interval ?? 4)

  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const i0 = r * cols + c, i1 = i0 + 1, i2 = (r + 1) * cols + c, i3 = i2 + 1
      if (!gridMask[i0] || !gridMask[i1] || !gridMask[i2] || !gridMask[i3]) continue
      const v0 = (grid[i0] - 0.5) * 100 * elevScale, v1 = (grid[i1] - 0.5) * 100 * elevScale
      const v2 = (grid[i2] - 0.5) * 100 * elevScale, v3 = (grid[i3] - 0.5) * 100 * elevScale
      const minV = Math.min(v0, v1, v2, v3), maxV = Math.max(v0, v1, v2, v3)
      const start = Math.ceil(minV / step) * step
      for (let v = start; v <= maxV; v += step) {
        if (!inElevCut(v, minZ, maxZ, elevMinCut, elevMaxCut)) continue
        const pts = []
        const interp = (a, b, va, vb) => { const t = (v - va) / (vb - va); return a + (b - a) * t }
        if ((v0 < v) !== (v1 < v)) pts.push(interp(c * scl, (c+1) * scl, v0, v1) - halfW, v, r * scl - halfH)
        if ((v1 < v) !== (v3 < v)) pts.push((c+1) * scl - halfW, v, interp(r * scl, (r+1) * scl, v1, v3) - halfH)
        if ((v3 < v) !== (v2 < v)) pts.push(interp((c+1) * scl, c * scl, v3, v2) - halfW, v, (r+1) * scl - halfH)
        if ((v2 < v) !== (v0 < v)) pts.push(c * scl - halfW, v, interp((r+1) * scl, r * scl, v2, v0) - halfH)
        if (pts.length >= 6) {
          positions.push(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5])
          const col = computeVertexColor(normElev(v, minZ, maxZ), 0.5, 0, p)
          colors.push(...col, ...col)
        }
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Flow ─────────────────────────────────────────────────────────────────────

function buildFlowLines(terrain, p, spacing, step, maxLen) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ } = terrain
  const { elevScale } = p
  const lineStep = Math.max(1, Math.round((spacing ?? 10) / scl))
  const positions = [], colors = []
  const occupancy = new Uint8Array(rows * cols)

  for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {
      if (!gridMask[r * cols + c] || occupancy[r * cols + c]) continue
      let currR = r, currC = c, len = 0
      while (len < (maxLen ?? 100)) {
        const i = Math.round(currR) * cols + Math.round(currC)
        if (i < 0 || i >= rows * cols || !gridMask[i]) break
        occupancy[i] = 1
        const b = grid[i], br = (currC < cols - 1) ? grid[i + 1] : b, bd = (currR < rows - 1) ? grid[i + cols] : b
        const gx = br - b, gy = bd - b, gLen = Math.sqrt(gx * gx + gy * gy)
        if (gLen < 0.0001) break
        const dr = gy / gLen * (step ?? 1), dc = gx / gLen * (step ?? 1)
        const nextR = currR + dr, nextC = currC + dc
        const e0 = (b - 0.5) * 100 * elevScale, e1 = (grid[Math.min(rows*cols-1, Math.round(nextR)*cols + Math.round(nextC))] - 0.5) * 100 * elevScale
        positions.push(currC * scl - halfW, e0, currR * scl - halfH, nextC * scl - halfW, e1, nextR * scl - halfH)
        const col = computeVertexColor(normElev(e0, minZ, maxZ), gLen * 10, Math.atan2(gy, gx), p)
        colors.push(...col, ...col)
        currR = nextR; currC = nextC; len++
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Stream Network (DAG) ──────────────────────────────────────────────────────

function buildDagThinning(terrain, p, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ } = terrain
  const { elevScale } = p
  const accumulation = new Float32Array(rows * cols).fill(1)
  const sorted = [...Array(rows * cols).keys()].sort((a, b) => grid[b] - grid[a])
  for (const i of sorted) {
    if (!gridMask[i]) continue
    const r = Math.floor(i / cols), c = i % cols
    let maxD = -1, nextIdx = -1
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const nr = r + dr, nc = c + dc
        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && gridMask[nr * cols + nc]) {
          const drop = grid[i] - grid[nr * cols + nc]
          if (drop > maxD) { maxD = drop; nextIdx = nr * cols + nc }
        }
      }
    }
    if (nextIdx !== -1 && maxD > 0) accumulation[nextIdx] += accumulation[i]
  }
  const positions = [], colors = []
  for (let i = 0; i < rows * cols; i++) {
    if (accumulation[i] > (threshold ?? 2) * 50) {
      const r = Math.floor(i / cols), c = i % cols
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr, nc = c + dc
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && gridMask[nr * cols + nc]) {
            const ni = nr * cols + nc
            if (accumulation[ni] > accumulation[i]) {
              const e0 = (grid[i]-0.5)*100*elevScale, e1 = (grid[ni]-0.5)*100*elevScale
              positions.push(c*scl-halfW, e0, r*scl-halfH, nc*scl-halfW, e1, nr*scl-halfH)
              const col = computeVertexColor(normElev(e0, minZ, maxZ), 0.5, 0, p)
              colors.push(...col, ...col)
            }
          }
        }
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Pencil Shading ───────────────────────────────────────────────────────────

function buildPencilShading(terrain, p, spacing, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain
  const { elevScale } = p
  const positions = [], colors = []
  const step = Math.max(1, Math.round((spacing ?? 4) / scl))
  for (let r = step; r < rows - step; r += step) {
    for (let c = step; c < cols - step; c += step) {
      if (!gridMask[r * cols + c]) continue
      const center = grid[r * cols + c]
      const laplacian = (grid[(r-step)*cols+c] + grid[(r+step)*cols+c] + grid[r*cols+c-step] + grid[r*cols+c+step]) - 4 * center
      if (Math.abs(laplacian) > (threshold ?? 0.5) * 0.05) {
        const e = (center - 0.5) * 100 * elevScale
        const x = c * scl - halfW, z = r * scl - halfH
        positions.push(x - 1, e, z, x + 1, e, z)
        const col = computeVertexColor(normElev(center, terrain.minZ, terrain.maxZ), 0.5, 0, p)
        colors.push(...col, ...col)
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Pillars ──────────────────────────────────────────────────────────────

function buildPillars(terrain, p, spacing) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, elevScale } = terrain
  const { elevMinCut, elevMaxCut, jitterAmt } = p
  const step = Math.max(1, Math.round((spacing ?? 8) / scl))
  const positions = [], colors = []
  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      if (!gridMask[r * cols + c]) continue
      const e = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(e, terrain.minZ, terrain.maxZ, elevMinCut, elevMaxCut)) continue
      const x = c * scl - halfW, z = r * scl - halfH
      positions.push(x, 0, z, x, e, z)
      const col = computeVertexColor(normElev(e, terrain.minZ, terrain.maxZ), 0.5, 0, p)
      colors.push(...col, ...col)
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Surface ──────────────────────────────────────────────────────────────────

export function buildSurfaceGeometry(terrain, p) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, elevScale } = terrain
  const { jitterAmt } = p
  const vertexCount = rows * cols
  const basePos = new Float32Array(vertexCount * 3), baseBright = new Float32Array(vertexCount)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { basePos[i*3]=c*scl-halfW; basePos[i*3+1]=-10000; basePos[i*3+2]=r*scl-halfH; baseBright[i]=0 }
      else { basePos[i*3]=c*scl-halfW; basePos[i*3+1]=cellElev(grid, r, c, cols, elevScale, jitterAmt); basePos[i*3+2]=r*scl-halfH; baseBright[i]=grid[i] }
    }
  }
  const baseIndices = []
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = r*cols+c, tr = tl+1, bl = tl+cols, br = bl+1
      if (gridMask[tl] && gridMask[tr] && gridMask[bl] && gridMask[br]) baseIndices.push(tl, bl, tr, tr, bl, br)
    }
  }
  let finalPos = new Float32Array(0), finalBright = new Float32Array(0), finalIndices = [], indexOffset = 0
  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)
  for (const sx of mX) {
    for (const sy of mY) {
      for (const sz of mZ) {
        const pPass = new Float32Array(basePos)
        for (let i = 0; i < pPass.length; i += 3) { pPass[i] *= sx; pPass[i+1] *= sy; pPass[i+2] *= sz }
        finalPos = concat(finalPos, pPass); finalBright = concat(finalBright, baseBright)
        const flipWinding = (sx * sy * sz) < 0
        for (let i = 0; i < baseIndices.length; i += 3) {
          if (flipWinding) finalIndices.push(baseIndices[i] + indexOffset, baseIndices[i+2] + indexOffset, baseIndices[i+1] + indexOffset)
          else finalIndices.push(baseIndices[i] + indexOffset, baseIndices[i+1] + indexOffset, baseIndices[i+2] + indexOffset)
        }
        indexOffset += vertexCount
      }
    }
  }
  return { positions: finalPos, brightnessBuf: finalBright, indices: new Uint32Array(finalIndices), metadata: { rows, cols } }
}

function concat(a, b) { const out = new Float32Array(a.length+b.length); out.set(a, 0); out.set(b, a.length); return out }
