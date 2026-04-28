/**
 * SVG export — projects current line segment geometry through the active camera
 * into screen-space pixel coordinates, computes a tight bounding box around all
 * visible segments, and triggers a download.
 *
 * Occlusion: a software depth buffer (view-space Z, world-unit precision) is
 * rasterised from the terrain surface mesh in JavaScript so that peaks hide lines
 * behind them, matching the depth-buffer behaviour of the live viewport.
 */
import * as THREE from 'three'
import { sampleGradient } from './colorUtils'
import { DASH_SVG } from './stylePresets'

const MARGIN    = 20   // px padding around the geometry bounding box
const N_SAMPLES = 64   // depth-test samples per segment (increased for precision)

// ─── Software depth buffer (view-space Z) ─────────────────────────────────────

function buildZBuffer(zGeos, groupMatrix, camera, W, H, elevMinCut, elevMaxCut) {
  const buf = new Float32Array(W * H).fill(0)
  const camInv = camera.matrixWorldInverse
  const wld = new THREE.Vector3()
  const viw = new THREE.Vector3()
  const minB = (elevMinCut || 0) / 100
  const maxB = (elevMaxCut || 100) / 100

  for (const geo of zGeos) {
    const { positions, indices, brightnessBuf } = geo
    if (!positions || positions.length === 0) continue
    const nVerts = positions.length / 3
    const vx  = new Float32Array(nVerts)
    const vy  = new Float32Array(nVerts)
    const vd  = new Float32Array(nVerts)
    const vb  = brightnessBuf ? new Float32Array(nVerts) : null

    for (let i = 0; i < nVerts; i++) {
      wld.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      if (groupMatrix) wld.applyMatrix4(groupMatrix)
      viw.copy(wld).applyMatrix4(camInv)
      vd[i] = 1.0 / (-viw.z)
      wld.project(camera)
      vx[i] = ( wld.x + 1) * 0.5 * W
      vy[i] = (-wld.y + 1) * 0.5 * H
      if (vb) vb[i] = brightnessBuf[i]
    }

    const nTri = indices.length / 3
    for (let t = 0; t < nTri; t++) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
      if (vb) {
        const avgB = (vb[a] + vb[b] + vb[c]) / 3
        if (avgB < minB || avgB > maxB) continue
      }
      fillTriangle(vx[a], vy[a], vd[a], vx[b], vy[b], vd[b], vx[c], vy[c], vd[c], buf, W, H)
    }
  }

  return (sx, sy) => {
    const xi = Math.min(W - 1, Math.max(0, Math.round(sx)))
    const yi = Math.min(H - 1, Math.max(0, Math.round(sy)))
    const inv_w = buf[yi * W + xi]
    return inv_w > 0 ? -1.0 / inv_w : -Infinity
  }
}

function fillTriangle(x0, y0, d0, x1, y1, d1, x2, y2, d2, buf, W, H) {
  if (y1 < y0) { let t; t=x0;x0=x1;x1=t; t=y0;y0=y1;y1=t; t=d0;d0=d1;d1=t }
  if (y2 < y0) { let t; t=x0;x0=x2;x2=t; t=y0;y0=y2;y2=t; t=d0;d0=d2;d2=t }
  if (y2 < y1) { let t; t=x1;x1=x2;x2=t; t=y1;y1=y2;y2=t; t=d1;d1=d2;d2=t }
  const dy02 = y2 - y0
  if (dy02 < 0.5) return
  for (let y = Math.max(0, Math.ceil(y0)); y <= Math.min(H - 1, Math.floor(y2)); y++) {
    const t02 = (y - y0) / dy02
    const lx = x0 + (x2 - x0) * t02
    const ld = d0 + (d2 - d0) * t02
    let rx, rd
    if (y <= y1) {
      const dy01 = y1 - y0
      const t01  = dy01 > 0 ? (y - y0) / dy01 : 0
      rx = x0 + (x1 - x0) * t01
      rd = d0 + (d1 - d0) * t01
    } else {
      const dy12 = y2 - y1
      const t12  = dy12 > 0 ? (y - y1) / dy12 : 0
      rx = x1 + (x2 - x1) * t12
      rd = d1 + (d2 - d1) * t12
    }
    const xL = lx <= rx ? lx : rx
    const xR = lx <= rx ? rx : lx
    const dL = lx <= rx ? ld : rd
    const dR = lx <= rx ? rd : ld
    const dx = xR - xL
    for (let x = Math.max(0, Math.ceil(xL)); x <= Math.min(W - 1, Math.floor(xR)); x++) {
      const t = dx > 0 ? (x - xL) / dx : 0
      const d = dL + (dR - dL) * t
      const idx = y * W + x
      if (d > buf[idx]) buf[idx] = d
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

function buildFillPolygons(surfaceGeo, groupMatrix, camera, W, H, fillHypsometric, gradientStops, elevMinCut, elevMaxCut) {
  const { positions, indices, brightnessBuf } = surfaceGeo
  const nVerts  = positions.length / 3
  const camInv  = camera.matrixWorldInverse
  const sx = new Float32Array(nVerts)
  const sy = new Float32Array(nVerts)
  const sz = new Float32Array(nVerts)
  const wld = new THREE.Vector3()
  const viw = new THREE.Vector3()

  for (let i = 0; i < nVerts; i++) {
    wld.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    if (groupMatrix) wld.applyMatrix4(groupMatrix)
    viw.copy(wld).applyMatrix4(camInv)
    sz[i] = viw.z
    wld.project(camera)
    sx[i] = ( wld.x + 1) * 0.5 * W
    sy[i] = (-wld.y + 1) * 0.5 * H
  }

  const nTri = indices.length / 3
  const polys = []
  const minB = (elevMinCut || 0) / 100
  const maxB = (elevMaxCut || 100) / 100

  for (let t = 0; t < nTri; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    const brightness = (brightnessBuf[a] + brightnessBuf[b] + brightnessBuf[c]) / 3
    if (brightness < minB || brightness > maxB) continue

    const avgZ = (sz[a] + sz[b] + sz[c]) / 3
    let fill
    if (fillHypsometric && gradientStops?.length > 1) {
      const [r, g, bl] = sampleGradient(gradientStops, brightness)
      fill = `rgb(${Math.round(r*255)},${Math.round(g*255)},${Math.round(bl*255)})`
    } else {
      fill = '#ffffff'
    }
    polys.push({ pts: [[sx[a], sy[a]], [sx[b], sy[b]], [sx[c], sy[c]]], avgZ, fill })
  }
  polys.sort((a, b) => a.avgZ - b.avgZ)
  return polys
}

export function exportSVG({
  lineGeo, camera, width, height,
  bgColor, bgGradient, bgGradientStops,
  surfaceGeo, groupMatrix,
  showFill, fillHypsometric, gradientStops,
  showLines, depthOcclusion, occlusionBias, occlusionOpacity, occlusionColor,
  particlePositions, particleCount, particleColor, particleSize,
  elevMinCut, elevMaxCut,
}) {
  const bias = occlusionBias ?? 0.1
  const ghostOpac = occlusionOpacity ?? 0
  const camInv = camera.matrixWorldInverse
  const wld2 = new THREE.Vector3()
  const viw2 = new THREE.Vector3()

  const project = (x, y, z) => {
    wld2.set(x, y, z)
    if (groupMatrix) wld2.applyMatrix4(groupMatrix)
    viw2.copy(wld2).applyMatrix4(camInv)
    const viewZ = viw2.z
    wld2.project(camera)
    return [
      ( wld2.x + 1) * 0.5 * width,
      (-wld2.y + 1) * 0.5 * height,
      viewZ,
    ]
  }

  const zGeos = []
  if (showFill && surfaceGeo && groupMatrix) {
    zGeos.push(surfaceGeo)
  }
  if (showLines && Array.isArray(lineGeo)) {
    for (const layer of lineGeo) {
      if (layer.curtains && layer.curtains.positions.length > 0) {
        zGeos.push(layer.curtains)
      }
    }
  }

  // Only build Z-Buffer if occlusion is enabled
  const surfViewZ = (depthOcclusion && zGeos.length > 0 && groupMatrix)
    ? buildZBuffer(zGeos, groupMatrix, camera, width, height, elevMinCut, elevMaxCut)
    : null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const expandBB = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }

  const svgLayers = []

  if (showLines && Array.isArray(lineGeo)) {
    for (const layer of lineGeo) {
      const { id, positions, colors, weight, opacity, dash } = layer
      if (!positions || positions.length === 0) continue

      const visibleSegs = []
      const ghostSegs = []
      const segCount = positions.length / 6
      for (let s = 0; s < segCount; s++) {
        const i = s * 6
        const ax = positions[i], ay = positions[i+1], az = positions[i+2]
        const bx = positions[i+3], by = positions[i+4], bz = positions[i+5]
        
        let stroke = '#000000'
        if (colors && colors.length > i + 2) {
          stroke = `rgb(${Math.round(colors[i]*255)},${Math.round(colors[i+1]*255)},${Math.round(colors[i+2]*255)})`
        }

        const addSeg = (x0, y0, x1, y1, isVisible) => {
          if (Math.hypot(x1 - x0, y1 - y0) < 0.1) return
          if (isVisible) visibleSegs.push({ x0, y0, x1, y1, stroke })
          else ghostSegs.push({ x0, y0, x1, y1, stroke: occlusionColor || '#000000' })
          expandBB(x0, y0); expandBB(x1, y1)
        }

        if (!surfViewZ) {
          const p0 = project(ax, ay, az), p1 = project(bx, by, bz)
          addSeg(p0[0], p0[1], p1[0], p1[1], true)
          continue
        }

        const pts = []
        for (let t = 0; t <= N_SAMPLES; t++) {
          const f = t / N_SAMPLES
          const [sx, sy, lineZ] = project(ax+(bx-ax)*f, ay+(by-ay)*f, az+(bz-az)*f)
          const surfZ = surfViewZ(sx, sy)
          pts.push({ sx, sy, visible: (surfZ === -Infinity || lineZ >= surfZ - bias) })
        }
        let runStart = 0
        for (let t = 1; t <= N_SAMPLES; t++) {
          if (pts[t].visible !== pts[runStart].visible) {
            const isVisible = pts[runStart].visible
            if (isVisible || ghostOpac > 0) {
              addSeg(pts[runStart].sx, pts[runStart].sy, pts[t].sx, pts[t].sy, isVisible)
            }
            runStart = t
          }
        }
        if (pts[runStart].visible || ghostOpac > 0) {
          addSeg(pts[runStart].sx, pts[runStart].sy, pts[N_SAMPLES].sx, pts[N_SAMPLES].sy, pts[runStart].visible)
        }
      }

      if (visibleSegs.length > 0 || ghostSegs.length > 0) {
        svgLayers.push({ id, visibleSegs, ghostSegs, weight, opacity, dash })
      }
    }
  }

  const projectedParticles = []
  if (particlePositions && particleCount > 0) {
    for (let i = 0; i < particleCount; i++) {
      wld2.set(particlePositions[i*3], particlePositions[i*3+1], particlePositions[i*3+2])
      if (groupMatrix) wld2.applyMatrix4(groupMatrix)
      viw2.copy(wld2).applyMatrix4(camInv)
      if (viw2.z >= 0) continue
      
      const r = ((particleSize ?? 4) * 300 / (-viw2.z)) * 0.5
      wld2.project(camera)
      const cx = (wld2.x+1)*0.5*width, cy = (-wld2.y+1)*0.5*height
      
      let visible = true
      if (surfViewZ) {
        const surfZ = surfViewZ(cx, cy)
        if (surfZ !== -Infinity && viw2.z < surfZ - bias) visible = false
      }

      if (visible || ghostOpac > 0) {
        projectedParticles.push({ cx, cy, r, visible })
        expandBB(cx-r, cy-r); expandBB(cx+r, cy+r)
      }
    }
  }

  if (svgLayers.length === 0 && projectedParticles.length === 0) return

  const vx = minX - MARGIN, vy = minY - MARGIN
  const vw = (maxX - minX) + MARGIN * 2, vh = (maxY - minY) + MARGIN * 2
  
  const fillPolygons = (showFill && surfaceGeo && groupMatrix) ? buildFillPolygons(surfaceGeo, groupMatrix, camera, width, height, fillHypsometric, gradientStops, elevMinCut, elevMaxCut) : []
  const fillEls = fillPolygons.map(({ pts, fill }) => `<polygon points="${pts.map(([px, py]) => `${(px-vx).toFixed(1)},${(py-vy).toFixed(1)}`).join(' ')}" fill="${fill}" stroke="none"/>`)
  
  const layerGroups = []
  for (const layer of svgLayers) {
    const sw = (layer.weight * 0.5).toFixed(3)
    const dashArray = DASH_SVG[layer.dash ?? 'solid'] ?? ''
    const modeId    = layer.id ?? 'Lines'
    const modeLabel = modeId.replace(/([A-Z])/g, ' $1').trim()
    const inner = []

    // Ghost pass (Hidden)
    if (layer.ghostSegs.length > 0) {
      const ghostEls = layer.ghostSegs.map(({ x0, y0, x1, y1, stroke }) => `<line x1="${(x0-vx).toFixed(1)}" y1="${(y0-vy).toFixed(1)}" x2="${(x1-vx).toFixed(1)}" y2="${(y1-vy).toFixed(1)}" stroke="${stroke}"/>`)
      inner.push(`<g stroke-width="${sw}" opacity="${ghostOpac * layer.opacity}" stroke-linecap="round" stroke-linejoin="round"${dashArray ? ` stroke-dasharray="${dashArray}"` : ''}>${ghostEls.join('')}</g>`)
    }
    // Main pass (Visible)
    if (layer.visibleSegs.length > 0) {
      const lineEls = layer.visibleSegs.map(({ x0, y0, x1, y1, stroke }) => `<line x1="${(x0-vx).toFixed(1)}" y1="${(y0-vy).toFixed(1)}" x2="${(x1-vx).toFixed(1)}" y2="${(y1-vy).toFixed(1)}" stroke="${stroke}"/>`)
      inner.push(`<g stroke-width="${sw}" opacity="${layer.opacity}" stroke-linecap="round" stroke-linejoin="round"${dashArray ? ` stroke-dasharray="${dashArray}"` : ''}>${lineEls.join('')}</g>`)
    }

    layerGroups.push(`<g id="layer-${modeId}" inkscape:groupmode="layer" inkscape:label="${modeLabel}">${inner.join('')}</g>`)
  }

  const pColor = particleColor ?? '#000000'
  const circleEls = projectedParticles.map(({ cx, cy, r, visible }) => `<circle cx="${(cx-vx).toFixed(1)}" cy="${(cy-vy).toFixed(1)}" r="${r.toFixed(2)}" fill="${visible ? pColor : occlusionColor}" opacity="${visible ? 1 : ghostOpac}"/>`)
  const useBgGrad = bgGradient && bgGradientStops?.length > 1
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${vw.toFixed(0)}" height="${vh.toFixed(0)}" viewBox="0 0 ${vw.toFixed(1)} ${vh.toFixed(1)}">`,
    ...(useBgGrad ? [`<defs><linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">${bgGradientStops.map(s => `<stop offset="${Math.round(s.pos*100)}%" stop-color="${s.color}"/>`).join('')}</linearGradient></defs>`] : []),
    `<rect width="100%" height="100%" fill="${useBgGrad ? 'url(#bg-grad)' : bgColor}"/>`,
    ...(fillEls.length > 0 ? [`<g>${fillEls.join('')}</g>`] : []),
    ...layerGroups,
    ...(circleEls.length > 0 ? [`<g stroke="none">${circleEls.join('')}</g>`] : []),
    `</svg>`,
  ].join('\n')
  download(svg, 'heightmap.svg', 'image/svg+xml')
}

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
