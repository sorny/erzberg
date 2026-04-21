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
    { id:'Cross',   builder: (t, ctx) => buildCrosshatch(t, ctx, p.spacingCross) },
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
    let layerCPos = new Float32Array(0), layerCInd = []
    let cIndOffset = 0
    
    // Build the base pass for this layer once
    const baseRes = cfg.builder(terrain, ctx)
    if (!baseRes || baseRes.positions.length === 0) continue

    // Build base curtains (occlusion geometry) for the lines
    const baseP = baseRes.positions
    const cP = []
    const cI = []
    let vIdx = 0
    const floorY = terrain.minZ - 500 // Deep enough to occlude, but less likely to clip camera
    for (let i = 0; i < baseP.length; i += 6) {
      const x0 = baseP[i], y0 = baseP[i+1], z0 = baseP[i+2]
      const x1 = baseP[i+3], y1 = baseP[i+4], z1 = baseP[i+5]
      if (Math.abs(x0-x1)<1e-4 && Math.abs(y0-y1)<1e-4 && Math.abs(z0-z1)<1e-4) continue

      cP.push(x0, y0, z0, x1, y1, z1, x1, floorY, z1, x0, floorY, z0)
      cI.push(vIdx, vIdx+1, vIdx+2, vIdx, vIdx+2, vIdx+3)
      vIdx += 4
    }

    // Mirror the base pass into all requested octants
    for (const sx of mX) {
      for (const sy of mY) {
        for (const sz of mZ) {
          const pPass = new Float32Array(baseP)
          for (let i = 0; i < pPass.length; i += 3) {
            pPass[i] *= sx; pPass[i+1] *= sy; pPass[i+2] *= sz
          }
          layerPos = concat(layerPos, pPass)
          layerCol = concat(layerCol, baseRes.colors)

          // Mirror curtains
          const cPass = new Float32Array(cP)
          for (let i = 0; i < cPass.length; i += 3) {
            cPass[i] *= sx; cPass[i+1] *= sy; cPass[i+2] *= sz
          }
          layerCPos = concat(layerCPos, cPass)
          const flipWinding = (sx * sy * sz) < 0
          for (let i = 0; i < cI.length; i += 3) {
            if (flipWinding) {
              layerCInd.push(cI[i] + cIndOffset, cI[i+2] + cIndOffset, cI[i+1] + cIndOffset)
            } else {
              layerCInd.push(cI[i] + cIndOffset, cI[i+1] + cIndOffset, cI[i+2] + cIndOffset)
            }
          }
          cIndOffset += (cP.length / 3)
        }
      }
    }

    finalLayers.push({
      id: cfg.id,
      positions: layerPos,
      colors: layerCol,
      curtains: { positions: layerCPos, indices: new Uint32Array(layerCInd) },
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

function buildCrosshatch(terrain, p, spacing) {
  const x = buildRidgelines(terrain, p, false, spacing, 0)
  const y = buildRidgelines(terrain, p, true,  spacing, 0)
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
      const bC = grid[r * cols + c], elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const bL = (c > 0 && gridMask[r * cols + c - 1]) ? grid[r * cols + c - 1] : bC
      const bR = (c < cols - 1 && gridMask[r * cols + c + 1]) ? grid[r * cols + c + 1] : bC
      const bU = (r > 0 && gridMask[(r - 1) * cols + c]) ? grid[(r - 1) * cols + c] : bC
      const bD = (r < rows - 1 && gridMask[(r + 1) * cols + c]) ? grid[(r + 1) * cols + c] : bC
      const gx = (bR - bL) * 50 * elevScale, gz = (bD - bU) * 50 * elevScale, mag = Math.sqrt(gx * gx + gz * gz)
      if (mag < 0.005) continue
      const tickLen = mag * (length ?? 1) * scl, nx = -gz / mag, nz = gx / mag, wx = c * scl - halfW, wz = r * scl - halfH
      positions.push(wx - nx * tickLen * 0.5, elev, wz - nz * tickLen * 0.5, wx + nx * tickLen * 0.5, elev, wz + nz * tickLen * 0.5)
      const col = computeVertexColor(normElev(elev, minZ, maxZ), gridSlopes[r * cols + c] / (maxSlope || 1), Math.atan2(gz, gx), p)
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
  const elevRange = 100 * elevScale, levelCount = Math.ceil(elevRange / step) + 1, startElev = Math.ceil((-elevRange / 2) / step) * step

  for (let li = 0; li < levelCount; li++) {
    const elev = startElev + li * step
    if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
    const col = computeVertexColor(normElev(elev, minZ, maxZ), 0, 0, p)
    const level = elev / (100 * elevScale) + 0.5
    
    // Fast Marching Squares
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        if (!gridMask[r*cols+c] || !gridMask[r*cols+c+1] || !gridMask[(r+1)*cols+c] || !gridMask[(r+1)*cols+c+1]) continue
        const v00 = grid[r*cols+c], v10 = grid[r*cols+c+1], v01 = grid[(r+1)*cols+c], v11 = grid[(r+1)*cols+c+1]
        const idx = (v00 >= level ? 8 : 0) | (v10 >= level ? 4 : 0) | (v11 >= level ? 2 : 0) | (v01 >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue
        const edgeLerp = (a, b, va, vb) => { 
          if (Math.abs(vb - va) < 1e-10) return 0.5
          return a + (b - a) * ((level - va) / (vb - va)) 
        }
        const top = [c + edgeLerp(0, 1, v00, v10), r], right = [c + 1, r + edgeLerp(0, 1, v10, v11)], bottom = [c + edgeLerp(0, 1, v01, v11), r + 1], left = [c, r + edgeLerp(0, 1, v00, v01)]
        const pairs = MARCHING_TABLE[idx], ed = [top, right, bottom, left]
        for (let i = 0; i < pairs.length; i += 2) { 
          const e0 = ed[pairs[i]], e1 = ed[pairs[i+1]]
          positions.push(e0[0]*scl-halfW, elev, e0[1]*scl-halfH, e1[0]*scl-halfW, elev, e1[1]*scl-halfH)
          colors.push(...col, ...col)
        }
      }
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}
const MARCHING_TABLE = { 1:[3,2], 2:[2,1], 3:[3,1], 4:[0,1], 5:[0,3,2,1], 6:[0,2], 7:[0,3], 8:[0,3], 9:[0,2], 10:[0,1,2,3], 11:[0,1], 12:[3,1], 13:[2,1], 14:[3,2] }

// ─── Flow lines ───────────────────────────────────────────────────────────────

function sampleB(grid, rows, cols, fr, fc) {
  const r0 = Math.max(0, Math.min(rows-1, Math.floor(fr))), c0 = Math.max(0, Math.min(cols-1, Math.floor(fc))), r1 = Math.min(rows-1, r0+1), c1 = Math.min(cols-1, c0+1), dr = fr-r0, dc = fc-c0
  return grid[r0*cols+c0]*(1-dr)*(1-dc) + grid[r0*cols+c1]*(1-dr)*dc + grid[r1*cols+c0]*dr*(1-dc) + grid[r1*cols+c1]*dr*dc
}

function buildFlowLines(terrain, p, spacing, step, maxLen) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const lineStep = Math.max(1, Math.round((spacing ?? 10) / scl)), MAX_TOTAL_SEGMENTS = 3000000, posBuf = new Float32Array(MAX_TOTAL_SEGMENTS*6), colBuf = new Float32Array(MAX_TOTAL_SEGMENTS*6), mask = new Uint8Array(rows*cols), eps = 0.5
  let totalSegments = 0
  outer: for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {
      if (totalSegments >= MAX_TOTAL_SEGMENTS) break outer
      if (!gridMask[r*cols+c] || mask[r*cols+c]) continue
      let fr = r, fc = c, b0 = sampleB(grid, rows, cols, fr, fc), e0 = (b0 - 0.5)*100*elevScale
      for (let s = 0; s < (maxLen ?? 100); s++) {
        if (totalSegments >= MAX_TOTAL_SEGMENTS) break outer
        if (fr < eps || fr > rows-1-eps || fc < eps || fc > cols-1-eps) break
        const ri = Math.round(fr), ci = Math.round(fc)
        if (!gridMask[ri*cols+ci]) break
        mask[ri*cols+ci] = 1
        const bL = sampleB(grid, rows, cols, fr, fc-eps), bR = sampleB(grid, rows, cols, fr, fc+eps), bU = sampleB(grid, rows, cols, fr-eps, fc), bD = sampleB(grid, rows, cols, fr+eps, fc)
        const gx = bR-bL, gz = bD-bU, mag = Math.sqrt(gx*gx+gz*gz)
        if (mag < 0.0005) break
        const nfc = fc-(gx/mag)*(step??1), nfr = fr-(gz/mag)*(step??1)
        if (mask[Math.round(nfr)*cols+Math.round(nfc)] || !gridMask[Math.round(nfr)*cols+Math.round(nfc)]) break
        const b1 = sampleB(grid, rows, cols, nfr, nfc), e1 = (b1-0.5)*100*elevScale
        if (inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut) && inElevCut(e1, minZ, maxZ, elevMinCut, elevMaxCut)) {
          const pIdx = totalSegments*6; posBuf[pIdx]=fc*scl-halfW; posBuf[pIdx+1]=e0; posBuf[pIdx+2]=fr*scl-halfH; posBuf[pIdx+3]=nfc*scl-halfW; posBuf[pIdx+4]=e1; posBuf[pIdx+5]=nfr*scl-halfH
          const col0 = computeVertexColor(normElev(e0, minZ, maxZ), Math.min(1, mag/(maxSlope||0.02)), Math.atan2(gz, gx), p)
          colBuf[pIdx]=col0[0]; colBuf[pIdx+1]=col0[1]; colBuf[pIdx+2]=col0[2]; colBuf[pIdx+3]=col0[0]; colBuf[pIdx+4]=col0[1]; colBuf[pIdx+5]=col0[2]
          totalSegments++
        } else if (!(inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut) || inElevCut(e1, minZ, maxZ, elevMinCut, elevMaxCut))) break
        fr=nfr; fc=nfc; b0=b1; e0=e1
      }
    }
  }
  return { positions: posBuf.slice(0, totalSegments*6), colors: colBuf.slice(0, totalSegments*6) }
}

// ─── Stream Network ──────────────────────────────────────────────────────

function buildDagThinning(terrain, p, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p
  const n = rows*cols, next = new Int32Array(n).fill(-1), inDeg = new Int32Array(n).fill(0)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!gridMask[r*cols+c]) continue
      const i = r*cols+c; let minH = grid[i], target = -1
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = r+dr, nc = c+dc
          if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && gridMask[nr*cols+nc]) {
            const ni = nr*cols+nc; if (grid[ni] < minH) { minH = grid[ni]; target = ni }
          }
        }
      }
      if (target !== -1) { next[i] = target; inDeg[target]++ }
    }
  }
  const order = new Int32Array(n).fill(1), currentInDeg = new Int32Array(inDeg), maxInOrder = new Int32Array(n).fill(0), countMaxOrder = new Int32Array(n).fill(0), queue = []
  for (let i = 0; i < n; i++) if (gridMask[i] && inDeg[i] === 0) queue.push(i)
  let head = 0
  while (head < queue.length) {
    const i = queue[head++], dst = next[i]; if (dst === -1) continue
    const o = order[i]; if (o > maxInOrder[dst]) { maxInOrder[dst] = o; countMaxOrder[dst] = 1 } else if (o === maxInOrder[dst]) countMaxOrder[dst]++
    currentInDeg[dst]--; if (currentInDeg[dst] === 0) { order[dst] = (countMaxOrder[dst] > 1) ? maxInOrder[dst]+1 : maxInOrder[dst]; queue.push(dst) }
  }
  const positions = [], colors = []
  const strahlerThreshold = Math.max(1, Math.round(threshold ?? 2))
  for (let i = 0; i < n; i++) {
    const dst = next[i]; if (dst === -1 || order[i] < strahlerThreshold) continue
    const r0 = Math.floor(i/cols), c0 = i%cols, r1 = Math.floor(dst/cols), c1 = dst%cols, e0 = (grid[i]-0.5)*100*elevScale, e1 = (grid[dst]-0.5)*100*elevScale
    if (!inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut)) continue
    positions.push(c0*scl-halfW, e0, r0*scl-halfH, c1*scl-halfW, e1, r1*scl-halfH)
    const col = computeVertexColor(normElev(e0, minZ, maxZ), gridSlopes[i]/(maxSlope||1), Math.atan2(r1-r0, c1-c0), p); colors.push(...col, ...col)
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Pencil Shading ───────────────────────────────────────────────────────────

function buildPencilShading(terrain, p, spacing, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ } = terrain
  const { elevScale, jitterAmt, elevMinCut, elevMaxCut } = p
  const positions = [], colors = [], step = Math.max(1, Math.round((spacing ?? 4) / scl))
  const curvThreshold = threshold ?? 0.5
  for (let r = step; r < rows - step; r += step) {
    for (let c = step; c < cols - step; c += step) {
      if (!gridMask[r*cols+c] || r <= 0 || r >= rows-1 || c <= 0 || c >= cols-1) continue
      const curv = -(grid[(r-1)*cols+c] + grid[(r+1)*cols+c] + grid[r*cols+c-1] + grid[r*cols+c+step] - 4*grid[r*cols+c]) * 100
      if (curv < curvThreshold) continue
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const wx = c*scl-halfW, wz = r*scl-halfH, len = Math.min(scl*2, curv*0.5), col = computeVertexColor(normElev(elev, minZ, maxZ), 0, 0, p)
      positions.push(wx-0.7*len, elev, wz-0.7*len, wx+0.7*len, elev, wz+0.7*len, wx-0.7*len, elev, wz+0.7*len, wx+0.7*len, elev, wz-0.7*len)
      colors.push(...col, ...col, ...col, ...col)
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Pillars ──────────────────────────────────────────────────────────────

function buildPillars(terrain, p, spacing) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p

  const step = Math.max(1, Math.round((spacing ?? 8) / scl))
  const positions = []
  const colors = []

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue

      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue

      const wx = c * scl - halfW
      const wz = r * scl - halfH

      positions.push(wx, minZ, wz, wx, elev, wz)
      const slope = gridSlopes[i]
      const colBase = computeVertexColor(normElev(minZ, minZ, maxZ), 0, 0, p)
      const colPeak = computeVertexColor(normElev(elev, minZ, maxZ), slope / (maxSlope || 1), 0, p)
      colors.push(...colBase, ...colPeak)
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
  let finalPos = new Float32Array(0), finalBright = new Float32Array(0), finalIndices = new Uint32Array(0), indexOffset = 0
  if (!baseIndices.length) return { positions: finalPos, brightnessBuf: finalBright, indices: finalIndices, metadata: { rows, cols } }
  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)
  const indicesList = []
  for (const sx of mX) {
    for (const sy of mY) {
      for (const sz of mZ) {
        const pPass = new Float32Array(basePos)
        for (let i = 0; i < pPass.length; i += 3) { pPass[i] *= sx; pPass[i+1] *= sy; pPass[i+2] *= sz }
        finalPos = concat(finalPos, pPass); finalBright = concat(finalBright, baseBright)
        const flipWinding = (sx * sy * sz) < 0
        for (let i = 0; i < baseIndices.length; i += 3) {
          if (flipWinding) indicesList.push(baseIndices[i] + indexOffset, baseIndices[i+2] + indexOffset, baseIndices[i+1] + indexOffset)
          else indicesList.push(baseIndices[i] + indexOffset, baseIndices[i+1] + indexOffset, baseIndices[i+2] + indexOffset)
        }
        indexOffset += vertexCount
      }
    }
  }
  return { positions: finalPos, brightnessBuf: finalBright, indices: new Uint32Array(indicesList), metadata: { rows, cols } }
}

function concat(a, b) { const out = new Float32Array(a.length+b.length); out.set(a, 0); out.set(b, a.length); return out }
