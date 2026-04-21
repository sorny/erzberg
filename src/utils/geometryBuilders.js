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
      case 'dag':        return buildDagThinning(terrain, p)
      case 'pencil':     return buildPencilShading(terrain, p)
      case 'z':          return buildPillars(terrain, p)
      default:           return empty()
    }
  })

  let totalPos = 0, totalCol = 0
  for (const r of results) { totalPos += r.positions.length; totalCol += r.colors.length }
  const positions = new Float32Array(totalPos)
  const colors = new Float32Array(totalCol)
  let offsetPos = 0, offsetCol = 0
  for (const r of results) {
    positions.set(r.positions, offsetPos); colors.set(r.colors, offsetCol)
    offsetPos += r.positions.length; offsetCol += r.colors.length
  }
  return { positions, colors }
}

function empty() { return { positions: new Float32Array(0), colors: new Float32Array(0) } }

// ─── Ridgelines ──────────────────────────────────────────────────────────────

function buildRidgelines(terrain, p, isY) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { lineSpacing, lineShift, elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const lineStep = Math.max(1, Math.round(lineSpacing / scl)), lineOffset = (lineShift ?? 0) % lineStep
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
  const x = buildRidgelines(terrain, p, false), y = buildRidgelines(terrain, p, true)
  return { positions: concat(x.positions, y.positions), colors: concat(x.colors, y.colors) }
}

// ─── Hachure ──────────────────────────────────────────────────────────────────

function buildHachure(terrain, p) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { hachureSpacing, elevScale, hachureLength, elevMinCut, elevMaxCut, jitterAmt } = p
  const lineStep = Math.max(1, Math.round((hachureSpacing ?? 4) / scl))
  const positions = [], colors = []

  for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {
      if (!hasData(gridMask, r, c, cols)) continue
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const bC = grid[r * cols + c]
      const bL = (c > 0 && gridMask[r * cols + c - 1]) ? grid[r * cols + c - 1] : bC
      const bR = (c < cols - 1 && gridMask[r * cols + c + 1]) ? grid[r * cols + c + 1] : bC
      const bU = (r > 0 && gridMask[(r - 1) * cols + c]) ? grid[(r - 1) * cols + c] : bC
      const bD = (r < rows - 1 && gridMask[(r + 1) * cols + c]) ? grid[(r + 1) * cols + c] : bC
      const gx = (bR - bL) * 50 * elevScale, gz = (bD - bU) * 50 * elevScale, mag = Math.sqrt(gx * gx + gz * gz)
      if (mag < 0.005) continue
      const tickLen = mag * hachureLength * scl, nx = -gz / mag, nz = gx / mag, wx = c * scl - halfW, wz = r * scl - halfH
      positions.push(wx - nx * tickLen * 0.5, elev, wz - nz * tickLen * 0.5, wx + nx * tickLen * 0.5, elev, wz + nz * tickLen * 0.5)
      const col = computeVertexColor(normElev(elev, minZ, maxZ), gridSlopes[r * cols + c] / (maxSlope || 1), Math.atan2(gz, gx), p)
      colors.push(...col, ...col)
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Contours ─────────────────────────────────────────────────────────────────

function edgeLerp(v0, v1, level) { if (Math.abs(v1 - v0) < 1e-10) return 0.5; return (level - v0) / (v1 - v0) }

function marchSquares(grid, gridMask, rows, cols, level) {
  const segs = []
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (!gridMask[r*cols+c] || !gridMask[r*cols+c+1] || !gridMask[(r+1)*cols+c] || !gridMask[(r+1)*cols+c+1]) continue
      const v00 = grid[r*cols+c], v10 = grid[r*cols+c+1], v01 = grid[(r+1)*cols+c], v11 = grid[(r+1)*cols+c+1]
      const idx = (v00 >= level ? 8 : 0) | (v10 >= level ? 4 : 0) | (v11 >= level ? 2 : 0) | (v01 >= level ? 1 : 0)
      if (idx === 0 || idx === 15) continue
      const top = [c + edgeLerp(v00, v10, level), r], right = [c + 1, r + edgeLerp(v10, v11, level)], bottom = [c + edgeLerp(v01, v11, level), r + 1], left = [c, r + edgeLerp(v00, v01, level)]
      const pairs = MARCHING_TABLE[idx], ed = [top, right, bottom, left]
      for (let i = 0; i < pairs.length; i += 2) { const e0 = ed[pairs[i]], e1 = ed[pairs[i+1]]; segs.push(e0[0], e0[1], e1[0], e1[1]) }
    }
  }
  return segs
}

const MARCHING_TABLE = { 1:[3,2], 2:[2,1], 3:[3,1], 4:[0,1], 5:[0,3,2,1], 6:[0,2], 7:[0,3], 8:[0,3], 9:[0,2], 10:[0,1,2,3], 11:[0,1], 12:[3,1], 13:[2,1], 14:[3,2] }

function buildContours(terrain, p) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ } = terrain
  const { elevScale, contourInterval, elevMinCut, elevMaxCut } = p
  const positions = [], colors = [], elevRange = 100 * elevScale, levelCount = Math.ceil(elevRange / contourInterval) + 1, startElev = Math.ceil((-elevRange / 2) / contourInterval) * contourInterval
  for (let li = 0; li < levelCount; li++) {
    const elev = startElev + li * contourInterval
    if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
    const segs = marchSquares(grid, gridMask, rows, cols, elev / (100 * elevScale) + 0.5)
    const col = computeVertexColor(normElev(elev, minZ, maxZ), 0, 0, p)
    for (let i = 0; i < segs.length; i += 4) {
      const c0 = segs[i], r0 = segs[i+1], c1 = segs[i+2], r1 = segs[i+3]
      positions.push(c0*scl-halfW, interpElev(grid, rows, cols, r0, c0, elevScale), r0*scl-halfH, c1*scl-halfW, interpElev(grid, rows, cols, r1, c1, elevScale), r1*scl-halfH)
      colors.push(...col, ...col)
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

function interpElev(grid, rows, cols, r, c, elevScale) {
  const r0 = Math.min(rows-1, Math.floor(r)), c0 = Math.min(cols-1, Math.floor(c)), r1 = Math.min(rows-1, r0+1), c1 = Math.min(cols-1, c0+1), fr = r-r0, fc = c-c0
  return ( (grid[r0*cols+c0]*(1-fr)*(1-fc) + grid[r0*cols+c1]*(1-fr)*fc + grid[r1*cols+c0]*fr*(1-fc) + grid[r1*cols+c1]*fr*fc) - 0.5 ) * 100 * elevScale
}

// ─── Flow lines ───────────────────────────────────────────────────────────────

function sampleBrightness(grid, rows, cols, fr, fc) {
  const r0 = Math.max(0, Math.min(rows-1, Math.floor(fr))), c0 = Math.max(0, Math.min(cols-1, Math.floor(fc))), r1 = Math.min(rows-1, r0+1), c1 = Math.min(cols-1, c0+1), dr = fr-r0, dc = fc-c0
  return grid[r0*cols+c0]*(1-dr)*(1-dc) + grid[r0*cols+c1]*(1-dr)*dc + grid[r1*cols+c0]*dr*(1-dc) + grid[r1*cols+c1]*dr*dc
}

function buildFlowLines(terrain, p) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope } = terrain
  const { lineSpacing, elevScale, flowStep = 0.5, flowMaxLen = 100, elevMinCut, elevMaxCut } = p
  const lineStep = Math.max(1, Math.round(lineSpacing / scl)), MAX_TOTAL_SEGMENTS = 3000000, posBuf = new Float32Array(MAX_TOTAL_SEGMENTS*6), colBuf = new Float32Array(MAX_TOTAL_SEGMENTS*6), mask = new Uint8Array(rows*cols), eps = 0.5
  let totalSegments = 0
  outer: for (let r = 0; r < rows; r += lineStep) {
    for (let c = 0; c < cols; c += lineStep) {
      if (totalSegments >= MAX_TOTAL_SEGMENTS) break outer
      if (!gridMask[r*cols+c] || mask[r*cols+c]) continue
      let fr = r, fc = c, b0 = sampleBrightness(grid, rows, cols, fr, fc), e0 = (b0 - 0.5)*100*elevScale
      for (let step = 0; step < flowMaxLen; step++) {
        if (totalSegments >= MAX_TOTAL_SEGMENTS) break outer
        if (fr < eps || fr > rows-1-eps || fc < eps || fc > cols-1-eps) break
        const ri = Math.round(fr), ci = Math.round(fc)
        if (!gridMask[ri*cols+ci]) break
        mask[ri*cols+ci] = 1
        const bL = sampleBrightness(grid, rows, cols, fr, fc-eps), bR = sampleBrightness(grid, rows, cols, fr, fc+eps), bU = sampleBrightness(grid, rows, cols, fr-eps, fc), bD = sampleBrightness(grid, rows, cols, fr+eps, fc)
        const gx = bR-bL, gz = bD-bU, mag = Math.sqrt(gx*gx+gz*gz)
        if (mag < 0.0005) break
        const nfc = fc-(gx/mag)*flowStep, nfr = fr-(gz/mag)*flowStep
        if (mask[Math.round(nfr)*cols+Math.round(nfc)] || !gridMask[Math.round(nfr)*cols+Math.round(nfc)]) break
        const b1 = sampleBrightness(grid, rows, cols, nfr, nfc), e1 = (b1-0.5)*100*elevScale
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

// ─── Stream Network ───────────────────────────────────────────────────────────

function buildDagThinning(terrain, p) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, strahlerThreshold = 2, elevMinCut, elevMaxCut } = p
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

function buildPencilShading(terrain, p) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ } = terrain
  const { elevScale, jitterAmt, curvatureThreshold = 0.5, lineSpacing = 4, elevMinCut, elevMaxCut } = p
  const positions = [], colors = [], step = Math.max(1, Math.round(lineSpacing / scl))
  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      if (!gridMask[r*cols+c] || r <= 0 || r >= rows-1 || c <= 0 || c >= cols-1) continue
      const curv = -(grid[(r-1)*cols+c] + grid[(r+1)*cols+c] + grid[r*cols+c-1] + grid[r*cols+c+1] - 4*grid[r*cols+c]) * 100
      if (curv < curvatureThreshold) continue
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      const wx = c*scl-halfW, wz = r*scl-halfH, len = Math.min(scl*2, curv*0.5), col = computeVertexColor(normElev(elev, minZ, maxZ), 0, 0, p)
      positions.push(wx-0.7*len, elev, wz-0.7*len, wx+0.7*len, elev, wz+0.7*len, wx-0.7*len, elev, wz+0.7*len, wx+0.7*len, elev, wz-0.7*len)
      colors.push(...col, ...col, ...col, ...col)
    }
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Pillars (Z-Visualization) ────────────────────────────────────────────────

function buildPillars(terrain, p) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { lineSpacing, elevScale, elevMinCut, elevMaxCut, jitterAmt } = p

  const step = Math.max(1, Math.round(lineSpacing / scl))
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

      // Segment from global floor to local peak
      positions.push(
        wx, minZ, wz,
        wx, elev, wz
      )

      const slope = gridSlopes[i]
      const colBase = computeVertexColor(normElev(minZ, minZ, maxZ), 0, 0, p)
      const colPeak = computeVertexColor(normElev(elev, minZ, maxZ), slope / (maxSlope || 1), 0, p)
      
      colors.push(...colBase, ...colPeak)
    }
  }

  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Surface ──────────────────────────────────────────────────────────────────

export function buildSurfaceGeometry(terrain, elevScale, jitterAmt) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH } = terrain
  const vertexCount = rows * cols, positions = new Float32Array(vertexCount * 3), brightnessBuf = new Float32Array(vertexCount)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { positions[i*3]=c*scl-halfW; positions[i*3+1]=-10000; positions[i*3+2]=r*scl-halfH; brightnessBuf[i]=0 }
      else { positions[i*3]=c*scl-halfW; positions[i*3+1]=cellElev(grid, r, c, cols, elevScale, jitterAmt); positions[i*3+2]=r*scl-halfH; brightnessBuf[i]=grid[i] }
    }
  }
  const indices = []
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = r*cols+c, tr = tl+1, bl = tl+cols, br = bl+1
      if (gridMask[tl] && gridMask[tr] && gridMask[bl] && gridMask[br]) { indices.push(tl, bl, tr, tr, bl, br) }
    }
  }
  return { positions, brightnessBuf, indices: new Uint32Array(indices) }
}

function concat(a, b) { const out = new Float32Array(a.length+b.length); out.set(a, 0); out.set(b, a.length); return out }
