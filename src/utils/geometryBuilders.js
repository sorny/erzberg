/**
 * CPU-side geometry builders.
 */

import { cellElev, hasData, boxBlur } from './terrain'
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
    { id:'Contours',builder: (t, ctx) => buildContours(t, ctx, p.intervalContours, p.majorIntervalContours, p.majorOffsetContours, p.closeRingsContours) },
    { id:'Hachure', builder: (t, ctx) => buildHachure(t, ctx, p.spacingHachure, p.lengthHachure) },
    { id:'Flow',    builder: (t, ctx) => buildFlowLines(t, ctx, p.spacingFlow, p.stepFlow, p.maxLenFlow) },
    { id:'Dag',     builder: (t, ctx) => buildDagThinning(t, ctx, p.thresholdDag) },
    { id:'Pencil',  builder: (t, ctx) => buildPencilShading(t, ctx, p.spacingPencil, p.thresholdPencil) },
    { id:'Ridge',   builder: (t, ctx) => buildRidgeLines(t, ctx, p.spacingRidge, p.radiusRidge, p.thresholdRidge) },
    { id:'Valley',  builder: (t, ctx) => buildTpiFeatures(t, ctx, p.spacingValley, p.radiusValley, p.thresholdValley, false) },
    { id:'Stipple', builder: (t, ctx) => buildStipple(t, ctx, p.spacingStipple, p.stippleDensityMode, p.stippleGamma, p.stippleJitter) },
  ]

  const finalLayers = []

  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)

  for (const cfg of MODES_CONFIG) {
    if (!p[`enabled${cfg.id}`]) continue

    const ctx = getLayerContext(cfg.id, p[`color${cfg.id}`], p[`opacity${cfg.id}`])
    
    // Build the base pass for this layer once
    const baseRes = cfg.builder(terrain, ctx)
    if (!baseRes) continue

    // Handle builders that return sub-layers (e.g. { minor: {...}, major: {...} })
    const subLayers = (baseRes.positions instanceof Float32Array) 
      ? { [cfg.id]: baseRes } 
      : baseRes

    for (const [subId, res] of Object.entries(subLayers)) {
      if (!res.positions || res.positions.length === 0) continue

      let layerPos = new Float32Array(0), layerCol = new Float32Array(0)
      let layerCPos = new Float32Array(0), layerCInd = []
      let cIndOffset = 0
      let layerLidPos = new Float32Array(0), layerLidCol = new Float32Array(0)
      let layerLidInd = [], lidIndOffset = 0

      const baseP = res.positions
      const cP = []
      const cI = []
      let vIdx = 0
      const floorY = terrain.minZ - 500

      for (let i = 0; i < baseP.length; i += 6) {
        const x0 = baseP[i], y0 = baseP[i+1], z0 = baseP[i+2]
        const x1 = baseP[i+3], y1 = baseP[i+4], z1 = baseP[i+5]
        if (Math.abs(x0-x1)<1e-4 && Math.abs(y0-y1)<1e-4 && Math.abs(z0-z1)<1e-4) continue
        cP.push(x0, y0, z0, x1, y1, z1, x1, floorY, z1, x0, floorY, z0)
        cI.push(vIdx, vIdx+1, vIdx+2, vIdx, vIdx+2, vIdx+3)
        vIdx += 4
      }

      const baseLidP = res.lids?.positions ?? new Float32Array(0)
      const baseLidC = res.lids?.colors   ?? new Float32Array(0)
      const baseLidI = res.lids ? Array.from(res.lids.indices) : []

      // Mirror the base pass into all requested octants
      for (const sx of mX) {
        for (const sy of mY) {
          for (const sz of mZ) {
            const pPass = new Float32Array(baseP)
            for (let i = 0; i < pPass.length; i += 3) { pPass[i] *= sx; pPass[i+1] *= sy; pPass[i+2] *= sz }
            layerPos = concat(layerPos, pPass)
            layerCol = concat(layerCol, res.colors)

            const cPass = new Float32Array(cP)
            for (let i = 0; i < cPass.length; i += 3) {
              cPass[i] *= sx; cPass[i+1] *= sy; cPass[i+2] *= sz
            }
            layerCPos = concat(layerCPos, cPass)

            const flipWinding = (sx * sy * sz) < 0

            for (let i = 0; i < cI.length; i += 3) {
              if (flipWinding) layerCInd.push(cI[i] + cIndOffset, cI[i+2] + cIndOffset, cI[i+1] + cIndOffset)
              else layerCInd.push(cI[i] + cIndOffset, cI[i+1] + cIndOffset, cI[i+2] + cIndOffset)
            }
            cIndOffset += (cP.length / 3)

            if (baseLidP.length > 0) {
              const lPass = new Float32Array(baseLidP)
              for (let i = 0; i < lPass.length; i += 3) { lPass[i] *= sx; lPass[i+1] *= sy; lPass[i+2] *= sz }
              layerLidPos = concat(layerLidPos, lPass)
              layerLidCol = concat(layerLidCol, baseLidC)
              for (let i = 0; i < baseLidI.length; i += 3) {
                if (flipWinding) layerLidInd.push(baseLidI[i]+lidIndOffset, baseLidI[i+2]+lidIndOffset, baseLidI[i+1]+lidIndOffset)
                else layerLidInd.push(baseLidI[i]+lidIndOffset, baseLidI[i+1]+lidIndOffset, baseLidI[i+2]+lidIndOffset)
              }
              lidIndOffset += baseLidP.length / 3
            }
          }
        }
      }

      // Apply specific weight for Major Contours
      const weight = (subId === 'Contours-Major') ? p.majorWeightContours : p[`weight${cfg.id}`]

      finalLayers.push({
        id: (subId === cfg.id) ? cfg.id : subId,
        positions: layerPos,
        colors: layerCol,
        curtains: { positions: layerCPos, indices: new Uint32Array(layerCInd) },
        lids: layerLidInd.length > 0
          ? { positions: layerLidPos, colors: layerLidCol, indices: new Uint32Array(layerLidInd) }
          : null,
        weight: weight,
        opacity: p[`opacity${cfg.id}`],
        dash: p[`dash${cfg.id}`]
      })
    }
  }

  return finalLayers
}

function concat(a, b) { const out = new Float32Array(a.length+b.length); out.set(a, 0); out.set(b, a.length); return out }

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

// Chains raw marching-squares segments (grid coords) into polylines, then closes
// any open ends that sit on the grid border by walking the border between them.
// Returns a flat world-space array [x0,y,z0, x1,y,z1, ...] of segment pairs.
function closeContourRings(levelSegs, rows, cols, scl, halfW, halfH, elev) {
  const n = levelSegs.length / 4
  if (n === 0) return []

  const toWorld = (c, r) => [c * scl - halfW, r * scl - halfH]
  const key = (c, r) => `${c},${r}`

  // Build endpoint adjacency: key -> [segment indices]
  const adj = new Map()
  for (let i = 0; i < n; i++) {
    const k0 = key(levelSegs[i*4],   levelSegs[i*4+1])
    const k1 = key(levelSegs[i*4+2], levelSegs[i*4+3])
    if (!adj.has(k0)) adj.set(k0, [])
    if (!adj.has(k1)) adj.set(k1, [])
    adj.get(k0).push(i)
    adj.get(k1).push(i)
  }

  // Chain segments into polylines
  const visited = new Uint8Array(n)
  const chains = []
  for (let start = 0; start < n; start++) {
    if (visited[start]) continue
    visited[start] = 1
    const chain = [
      { c: levelSegs[start*4],   r: levelSegs[start*4+1] },
      { c: levelSegs[start*4+2], r: levelSegs[start*4+3] },
    ]
    // Extend tail then head
    for (const [getEnd, insert] of [
      [() => chain[chain.length - 1], pt => chain.push(pt)],
      [() => chain[0],                pt => chain.unshift(pt)],
    ]) {
      let tip = getEnd()
      while (true) {
        const next = (adj.get(key(tip.c, tip.r)) || []).find(i => !visited[i])
        if (next === undefined) break
        visited[next] = 1
        const nc0 = levelSegs[next*4], nr0 = levelSegs[next*4+1]
        const nc1 = levelSegs[next*4+2], nr1 = levelSegs[next*4+3]
        tip = key(nc0, nr0) === key(tip.c, tip.r) ? { c: nc1, r: nr1 } : { c: nc0, r: nr0 }
        insert(tip)
      }
    }
    chains.push(chain)
  }

  // Emit all chain segments
  const result = []
  for (const chain of chains) {
    for (let i = 0; i < chain.length - 1; i++) {
      const [x0, z0] = toWorld(chain[i].c,   chain[i].r)
      const [x1, z1] = toWorld(chain[i+1].c, chain[i+1].r)
      result.push(x0, elev, z0, x1, elev, z1)
    }
  }

  // Collect open border endpoints
  // Clockwise border position in [0, 4): top=0..1, right=1..2, bottom=2..3, left=3..4
  const EPS = 1e-9
  const onBorder = (c, r) => c <= EPS || r <= EPS || c >= cols - 1 - EPS || r >= rows - 1 - EPS
  const borderPos = (c, r) => {
    if (r <= EPS)            return c / (cols - 1)
    if (c >= cols - 1 - EPS) return 1 + r / (rows - 1)
    if (r >= rows - 1 - EPS) return 2 + (1 - c / (cols - 1))
    return                          3 + (1 - r / (rows - 1))
  }

  const bpts = []
  for (const chain of chains) {
    const head = chain[0], tail = chain[chain.length - 1]
    if (key(head.c, head.r) === key(tail.c, tail.r)) continue // already closed
    if (onBorder(head.c, head.r)) bpts.push({ c: head.c, r: head.r, pos: borderPos(head.c, head.r) })
    if (onBorder(tail.c, tail.r)) bpts.push({ c: tail.c, r: tail.r, pos: borderPos(tail.c, tail.r) })
  }

  if (bpts.length < 2 || bpts.length % 2 !== 0) return result
  bpts.sort((a, b) => a.pos - b.pos)

  // Grid corners in clockwise order
  const corners = [
    { c: 0,        r: 0,        pos: 0 },
    { c: cols - 1, r: 0,        pos: 1 },
    { c: cols - 1, r: rows - 1, pos: 2 },
    { c: 0,        r: rows - 1, pos: 3 },
  ]

  // Walk border clockwise from p0 to p1, inserting any corners in between
  const traceBorder = (p0, p1) => {
    const pts = [{ c: p0.c, r: p0.r }]
    const inRange = pos => p0.pos < p1.pos
      ? pos > p0.pos + EPS && pos < p1.pos - EPS
      : pos > p0.pos + EPS || pos  < p1.pos - EPS
    const dist = pos => (pos - p0.pos + 4) % 4
    corners
      .filter(corner => inRange(corner.pos))
      .sort((a, b) => dist(a.pos) - dist(b.pos))
      .forEach(corner => pts.push({ c: corner.c, r: corner.r }))
    pts.push({ c: p1.c, r: p1.r })
    return pts
  }

  // Pair consecutive border endpoints and emit border segments
  for (let i = 0; i < bpts.length; i += 2) {
    const pts = traceBorder(bpts[i], bpts[i + 1])
    for (let j = 0; j < pts.length - 1; j++) {
      const [x0, z0] = toWorld(pts[j].c,   pts[j].r)
      const [x1, z1] = toWorld(pts[j+1].c, pts[j+1].r)
      result.push(x0, elev, z0, x1, elev, z1)
    }
  }

  return result
}

function buildContours(terrain, p, interval, majorInterval, majorOffset, closeRings) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ } = terrain
  const { elevScale, elevMinCut, elevMaxCut } = p

  const minorPos = [], minorCol = []
  const majorPos = [], majorCol = []

  const step = (interval ?? 4)
  // Use a small epsilon to ensure we catch 0.0 if the terrain starts there
  const startElev = Math.ceil((minZ - 1e-7) / step) * step
  const maxElevPossible = Math.ceil(maxZ / step) * step

  const majorMod = majorInterval ?? 0
  const offset = majorOffset ?? 1

  const numSteps = Math.max(0, Math.floor((maxElevPossible - startElev) / step) + 1)

  for (let i = 0; i < numSteps; i++) {
    const elev = startElev + i * step
    if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue

    // Check if major based on bottom-up index + phase offset
    const isMajor = (majorMod > 1) ? ((i + (majorMod - offset)) % majorMod === 0) : (majorMod === 1)

    const targetPos = (isMajor && majorMod > 0) ? majorPos : minorPos
    const targetCol = (isMajor && majorMod > 0) ? majorCol : minorCol
    const col = computeVertexColor(normElev(elev, minZ, maxZ), 0, 0, p)
    const level = elev / (100 * elevScale) + 0.5

    const levelSegs = closeRings ? [] : null

    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        // If all 4 are NoData, skip cell
        const m00 = gridMask[r*cols+c], m10 = gridMask[r*cols+c+1], m01 = gridMask[(r+1)*cols+c], m11 = gridMask[(r+1)*cols+c+1]
        if (!m00 && !m10 && !m01 && !m11) continue

        // Treat NoData as being slightly below the level so shorelines draw
        const v00 = m00 ? grid[r*cols+c] : level - 1e-7
        const v10 = m10 ? grid[r*cols+c+1] : level - 1e-7
        const v11 = m11 ? grid[(r+1)*cols+c+1] : level - 1e-7
        const v01 = m01 ? grid[(r+1)*cols+c] : level - 1e-7

        const idx = (v00 >= level ? 8 : 0) | (v10 >= level ? 4 : 0) | (v11 >= level ? 2 : 0) | (v01 >= level ? 1 : 0)
        if (idx === 0 || idx === 15) continue
        const edgeLerp = (a, b, va, vb) => {
          if (Math.abs(vb - va) < 1e-10) return 0.5
          return a + (b - a) * ((level - va) / (vb - va))
        }
        const top = [c + edgeLerp(0, 1, v00, v10), r], right = [c + 1, r + edgeLerp(0, 1, v10, v11)], bottom = [c + edgeLerp(0, 1, v01, v11), r + 1], left = [c, r + edgeLerp(0, 1, v00, v01)]
        const pairs = MARCHING_TABLE[idx], ed = [top, right, bottom, left]
        for (let pi = 0; pi < pairs.length; pi += 2) {
          const e0 = ed[pairs[pi]], e1 = ed[pairs[pi+1]]
          if (closeRings) {
            levelSegs.push(e0[0], e0[1], e1[0], e1[1])
          } else {
            targetPos.push(e0[0]*scl-halfW, elev, e0[1]*scl-halfH, e1[0]*scl-halfW, elev, e1[1]*scl-halfH)
            targetCol.push(...col, ...col)
          }
        }
      }
    }

    if (closeRings && levelSegs.length > 0) {
      const worldSegs = closeContourRings(levelSegs, rows, cols, scl, halfW, halfH, elev)
      for (let j = 0; j < worldSegs.length; j += 6) {
        targetPos.push(worldSegs[j], worldSegs[j+1], worldSegs[j+2], worldSegs[j+3], worldSegs[j+4], worldSegs[j+5])
        targetCol.push(...col, ...col)
      }
    }
  }

  return {
    'Contours-Minor': { positions: new Float32Array(minorPos), colors: new Float32Array(minorCol) },
    'Contours-Major': { positions: new Float32Array(majorPos), colors: new Float32Array(majorCol) },
  }
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
      const curv = -(grid[(r-1)*cols+c] + grid[(r+1)*cols+c] + grid[r*cols+c-1] + grid[r*cols+c+1] - 4*grid[r*cols+c]) * 100
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

// ─── Ridge Lines (Differential Geometry) ──────────────────────────────────────

function buildRidgeLines(terrain, p, spacing, radius, threshold) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  
  // 1. Pre-smooth for stable second derivatives
  const smoothed = boxBlur(grid, cols, rows, radius)
  const ridgeThreshold = (threshold ?? 0.5) * 0.1
  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const positions = [], colors = []
  
  // 2. Compute Ridge points using Hessian Eigenvalues
  // Point is a ridge if max principal curvature is high AND it's a local maximum in direction of curvature
  const isRidge = new Uint8Array(rows * cols)
  const curvatures = new Float32Array(rows * cols)

  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      
      // Finite differences for second derivatives
      const hxx = smoothed[i+1] + smoothed[i-1] - 2*smoothed[i]
      const hyy = smoothed[i+cols] + smoothed[i-cols] - 2*smoothed[i]
      const hxy = (smoothed[i+cols+1] - smoothed[i+cols-1] - smoothed[i-cols+1] + smoothed[i-cols-1]) / 4
      
      // Eigenvalues of Hessian J = [[hxx, hxy], [hxy, hyy]]
      // lambda = (tr(J) +- sqrt(tr(J)^2 - 4*det(J))) / 2
      const tr = hxx + hyy
      const det = hxx * hyy - hxy * hxy
      const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det))
      const lambda1 = (tr - disc) / 2 // Smallest eigenvalue (most negative for ridge)
      
      curvatures[i] = -lambda1
      if (-lambda1 > ridgeThreshold) isRidge[i] = 1
    }
  }

  // 3. Connect neighboring Ridge points to form segments
  for (let r = 1; r < rows - 1; r += step) {
    for (let c = 1; c < cols - 1; c += step) {
      const i = r * cols + c
      if (!isRidge[i]) continue
      
      // Check 8-neighborhood for other ridge points to connect to
      for (let dr = 0; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc <= 0) continue // Skip self and previous columns in current row
          const nr = r + dr, nc = c + dc
          const ni = nr * cols + nc
          if (nr >= rows || nc < 0 || nc >= cols || !isRidge[ni]) continue
          
          const e0 = cellElev(grid, r, c, cols, elevScale, jitterAmt)
          const e1 = cellElev(grid, nr, nc, cols, elevScale, jitterAmt)
          
          if (inElevCut(e0, minZ, maxZ, elevMinCut, elevMaxCut) && inElevCut(e1, minZ, maxZ, elevMinCut, elevMaxCut)) {
            positions.push(c*scl-halfW, e0, r*scl-halfH, nc*scl-halfW, e1, nr*scl-halfH)
            const col = computeVertexColor(normElev(e0, minZ, maxZ), gridSlopes[i]/(maxSlope||1), 0, p)
            colors.push(...col, ...col)
          }
        }
      }
    }
  }

  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Ridge & Valley (TPI) ────────────────────────────────────────────────────

function buildTpiFeatures(terrain, p, spacing, radius, threshold, isRidge) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  
  // 1. Calculate neighborhood mean using Integral Image (boxBlur)
  const blurred = boxBlur(grid, cols, rows, radius)
  
  const step = Math.max(1, Math.round((spacing ?? 2) / scl))
  const positions = [], colors = []
  
  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue
      
      const val = grid[i]
      const avg = blurred[i]
      const tpi = val - avg
      
      const meetsThreshold = isRidge ? (tpi > threshold * 0.05) : (tpi < -threshold * 0.05)
      if (!meetsThreshold) continue
      
      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue
      
      const wx = c * scl - halfW
      const wz = r * scl - halfH
      
      // Draw a small cross-mark centered at the feature point
      const size = Math.abs(tpi) * 50 * scl
      positions.push(wx - size, elev, wz, wx + size, elev, wz)
      
      const slope = gridSlopes[i]
      const col = computeVertexColor(normElev(elev, minZ, maxZ), slope / (maxSlope || 1), 0, p)
      colors.push(...col, ...col)
    }
  }
  
  return { positions: new Float32Array(positions), colors: new Float32Array(colors) }
}

// ─── Pillars ──────────────────────────────────────────────────────────────

function buildPillars(terrain, p, spacing) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt, pillarGap, pillarDepth } = p

  const step     = Math.max(1, Math.round((spacing ?? 8) / scl))
  const gap      = pillarGap ?? 0
  const depth    = pillarDepth ?? 0
  const style    = p.pillarStyle ?? 'line'
  const halfSize = (p.pillarSize ?? 0.8) * step * scl * 0.5
  const segs     = Math.max(3, Math.round(p.pillarSegments ?? 8))

  const positions = [], colors = []
  const lidP = [], lidC = [], lidI = []
  let lidVIdx = 0

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const i = r * cols + c
      if (!gridMask[i]) continue

      const elev = cellElev(grid, r, c, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue

      const wx = c * scl - halfW
      const wz = r * scl - halfH
      const top    = elev - gap
      const bottom = minZ - depth
      if (top <= bottom) continue

      const slope   = gridSlopes[i]
      const colBase = computeVertexColor(normElev(bottom, minZ, maxZ), 0, 0, p)
      const colPeak = computeVertexColor(normElev(top,    minZ, maxZ), slope / (maxSlope || 1), 0, p)
      const colLid  = p.pillarLidColor ? hexToRgb(p.pillarLidColor) : colPeak

      if (style === 'cuboid') {
        const h = halfSize
        // Top face perimeter (4 edges)
        positions.push(wx-h,top,wz-h, wx+h,top,wz-h,  wx+h,top,wz-h, wx+h,top,wz+h,
                       wx+h,top,wz+h, wx-h,top,wz+h,  wx-h,top,wz+h, wx-h,top,wz-h)
        for (let e = 0; e < 4; e++) colors.push(...colPeak, ...colPeak)
        // Bottom face (4 edges)
        positions.push(wx-h,bottom,wz-h, wx+h,bottom,wz-h,  wx+h,bottom,wz-h, wx+h,bottom,wz+h,
                       wx+h,bottom,wz+h, wx-h,bottom,wz+h,  wx-h,bottom,wz+h, wx-h,bottom,wz-h)
        for (let e = 0; e < 4; e++) colors.push(...colBase, ...colBase)
        // 4 vertical edges (base → peak colour gradient)
        positions.push(wx-h,bottom,wz-h, wx-h,top,wz-h,  wx+h,bottom,wz-h, wx+h,top,wz-h,
                       wx+h,bottom,wz+h, wx+h,top,wz+h,  wx-h,bottom,wz+h, wx-h,top,wz+h)
        for (let e = 0; e < 4; e++) colors.push(...colBase, ...colPeak)
        // Lid mesh — 2 triangles covering the top face
        lidP.push(wx-h,top,wz-h, wx+h,top,wz-h, wx+h,top,wz+h, wx-h,top,wz+h)
        for (let v = 0; v < 4; v++) lidC.push(...colLid)
        lidI.push(lidVIdx,lidVIdx+1,lidVIdx+2, lidVIdx,lidVIdx+2,lidVIdx+3)
        lidVIdx += 4
      } else if (style === 'cylinder') {
        const rad = halfSize
        for (let s = 0; s < segs; s++) {
          const a0 = (s       / segs) * Math.PI * 2
          const a1 = ((s + 1) / segs) * Math.PI * 2
          const x0 = wx + rad * Math.cos(a0), z0 = wz + rad * Math.sin(a0)
          const x1 = wx + rad * Math.cos(a1), z1 = wz + rad * Math.sin(a1)
          positions.push(x0, top,    z0, x1, top,    z1); colors.push(...colPeak, ...colPeak)
          positions.push(x0, bottom, z0, x1, bottom, z1); colors.push(...colBase, ...colBase)
          positions.push(x0, bottom, z0, x0, top,    z0); colors.push(...colBase, ...colPeak)
        }
        // Lid mesh — N-gon fan from centre
        lidP.push(wx, top, wz); lidC.push(...colLid)           // centre vertex
        for (let s = 0; s < segs; s++) {
          const a = (s / segs) * Math.PI * 2
          lidP.push(wx + rad * Math.cos(a), top, wz + rad * Math.sin(a))
          lidC.push(...colLid)
        }
        for (let s = 0; s < segs; s++)
          lidI.push(lidVIdx, lidVIdx + s + 1, lidVIdx + ((s + 1) % segs) + 1)
        lidVIdx += segs + 1
      } else {
        positions.push(wx, bottom, wz, wx, top, wz)
        colors.push(...colBase, ...colPeak)
      }
    }
  }

  const lids = lidI.length > 0
    ? { positions: new Float32Array(lidP), colors: new Float32Array(lidC), indices: new Uint32Array(lidI) }
    : null
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), lids }
}

// ─── Stipple ──────────────────────────────────────────────────────────────────

function buildStipple(terrain, p, spacing, densityMode, gamma, jitter) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, minZ, maxZ, maxSlope, gridSlopes } = terrain
  const { elevScale, elevMinCut, elevMaxCut, jitterAmt } = p
  const step = Math.max(1, Math.round((spacing ?? 0.5) / scl))
  const eps = Math.max(0.001, scl * 0.003)
  const jAmt = (jitter ?? 0.8) * step
  const gam  = gamma ?? 1.2
  const dm   = densityMode ?? 'slope'
  const positions = [], colors = []

  for (let r = 0; r < rows; r += step) {
    for (let c = 0; c < cols; c += step) {
      const jr = r + (Math.random() - 0.5) * jAmt
      const jc = c + (Math.random() - 0.5) * jAmt
      const ri = Math.max(0, Math.min(rows - 1, Math.floor(jr)))
      const ci = Math.max(0, Math.min(cols - 1, Math.floor(jc)))
      if (!gridMask[ri * cols + ci]) continue

      const elev = cellElev(grid, ri, ci, cols, elevScale, jitterAmt)
      if (!inElevCut(elev, minZ, maxZ, elevMinCut, elevMaxCut)) continue

      const normE = normElev(elev, minZ, maxZ)
      const slope = gridSlopes[ri * cols + ci] / (maxSlope || 1)

      let density
      if      (dm === 'elevation') density = normE
      else if (dm === 'invElev')   density = 1 - normE
      else if (dm === 'invSlope')  density = 1 - slope
      else                         density = slope

      density = Math.pow(Math.max(0, Math.min(1, density)), gam)
      if (Math.random() > density) continue

      const wx = jc * scl - halfW
      const wz = jr * scl - halfH
      positions.push(wx - eps, elev, wz, wx + eps, elev, wz)
      const col = computeVertexColor(normE, slope, 0, p)
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
