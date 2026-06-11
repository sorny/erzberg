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
import { DASH_SEGMENT_SIZES } from './stylePresets'

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
  // View-space z of the near plane (camera looks down -z). Vertices on the
  // camera side of it project to garbage screen coordinates (the perspective
  // divide mirrors them), so triangles touching them must not be rasterised.
  const nearZ = -(camera.near ?? 0.1)

  for (const geo of zGeos) {
    const { positions, indices, brightnessBuf } = geo
    if (!positions || positions.length === 0) continue
    const nVerts = positions.length / 3
    const vx  = new Float32Array(nVerts)
    const vy  = new Float32Array(nVerts)
    const vd  = new Float32Array(nVerts)
    const behind = new Uint8Array(nVerts)
    const vb  = brightnessBuf ? new Float32Array(nVerts) : null

    for (let i = 0; i < nVerts; i++) {
      wld.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
      if (groupMatrix) wld.applyMatrix4(groupMatrix)
      viw.copy(wld).applyMatrix4(camInv)
      if (viw.z > nearZ) { behind[i] = 1; continue }
      vd[i] = 1.0 / (-viw.z)
      wld.project(camera)
      vx[i] = ( wld.x + 1) * 0.5 * W
      vy[i] = (-wld.y + 1) * 0.5 * H
      if (vb) vb[i] = brightnessBuf[i]
    }

    const nTri = indices.length / 3
    for (let t = 0; t < nTri; t++) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
      if (behind[a] || behind[b] || behind[c]) continue
      // Reject triangles fully outside the canvas — when zoomed in, that is
      // most of the terrain, and fillTriangle's per-row clamping would still
      // walk their full vertical extent.
      if ((vx[a] < 0 && vx[b] < 0 && vx[c] < 0) || (vx[a] > W && vx[b] > W && vx[c] > W) ||
          (vy[a] < 0 && vy[b] < 0 && vy[c] < 0) || (vy[a] > H && vy[b] > H && vy[c] > H)) continue
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

// ─── Dash segment splitter ────────────────────────────────────────────────────

// Splits a screen-space line segment into actual on-sub-segments according to a
// dash pattern, starting at `dashOffset` px into the repeating cycle.  Returns
// an array of {x0,y0,x1,y1} objects covering only the "on" portions.
function splitDashSegment(x0, y0, x1, y1, dashOffset, dashPx, gapPx) {
  const len = Math.hypot(x1 - x0, y1 - y0)
  if (len < 0.1) return []
  const dx = (x1 - x0) / len
  const dy = (y1 - y0) / len
  const cycle = dashPx + gapPx
  const result = []
  let cp = ((dashOffset % cycle) + cycle) % cycle  // position within current cycle
  let sp = 0  // position along segment

  while (sp < len) {
    if (cp < dashPx) {
      // Currently in a dash — draw to its end (or to segment end)
      const end = Math.min(sp + (dashPx - cp), len)
      result.push([sp, end])
      sp = end
      cp = dashPx
    } else {
      // Currently in a gap — skip to next dash start
      sp += cycle - cp
      cp = 0
      if (sp >= len) break
    }
  }

  return result.map(([t0, t1]) => ({
    x0: x0 + dx * t0, y0: y0 + dy * t0,
    x1: x0 + dx * t1, y1: y0 + dy * t1,
  }))
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function exportSVG({
  lineGeo, lineStyles = {}, camera, width, height,
  bgColor, bgGradient, bgGradientStops,
  surfaceGeo, groupMatrix,
  showFill,
  showLines, depthOcclusion, occlusionBias, occlusionOpacity, occlusionColor,
  particlePositions, particleCount, particleColor, particleSize,
  elevMinCut, elevMaxCut,
  baseName,
}) {
  const bias = occlusionBias ?? 0.1
  const ghostOpac = occlusionOpacity ?? 0
  const camInv = camera.matrixWorldInverse
  const wld2 = new THREE.Vector3()
  const viw2 = new THREE.Vector3()

  // The export captures what the viewport shows. Geometry behind the camera's
  // near plane projects to garbage screen coordinates (the perspective divide
  // mirrors it, often millions of px out), and when zoomed in most of the
  // terrain lies far outside the canvas — both previously inflated the SVG
  // viewBox until the actual content was a sub-pixel sliver. So: segments are
  // clipped against the near plane, anything fully outside the canvas (+PAD)
  // is dropped, and the final viewBox is clamped to the canvas rect.
  const nearZ = -(camera.near ?? 0.1)
  const PAD = MARGIN

  const viewZOf = (x, y, z) => {
    wld2.set(x, y, z)
    if (groupMatrix) wld2.applyMatrix4(groupMatrix)
    viw2.copy(wld2).applyMatrix4(camInv)
    return viw2.z
  }

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

  const offCanvas2 = (p0, p1) =>
    (p0[0] < -PAD && p1[0] < -PAD) || (p0[0] > width  + PAD && p1[0] > width  + PAD) ||
    (p0[1] < -PAD && p1[1] < -PAD) || (p0[1] > height + PAD && p1[1] > height + PAD)

  const offCanvas1 = (sx, sy) =>
    sx < -PAD || sx > width + PAD || sy < -PAD || sy > height + PAD

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

  // Build Z-buffer when depth occlusion is on, or when fill is enabled (fill acts as
  // a depth occluder in SVG — it is not rendered as polygons, only used to cull lines).
  const surfViewZ = ((depthOcclusion || showFill) && zGeos.length > 0 && groupMatrix)
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
      const { id, positions, colors, isPoints } = layer
      const { weight = 1, opacity = 1, dash = 'solid' } = lineStyles[id] ?? {}
      if (!positions || positions.length === 0) continue

      // ── Point layers (stipple dots) ──────────────────────────────────────────
      if (isPoints) {
        const dotR = (weight ?? 1) * 0.25
        const visibleDots = []
        const ghostDots = []
        const dotCount = positions.length / 6
        for (let s = 0; s < dotCount; s++) {
          const i = s * 6
          const cx3 = (positions[i] + positions[i+3]) * 0.5
          const cy3 = (positions[i+1] + positions[i+4]) * 0.5
          const cz3 = (positions[i+2] + positions[i+5]) * 0.5
          const [sx, sy, lineZ] = project(cx3, cy3, cz3)
          if (lineZ > nearZ || offCanvas1(sx, sy)) continue
          const fill = (colors && colors.length > i + 2)
            ? `rgb(${Math.round(colors[i]*255)},${Math.round(colors[i+1]*255)},${Math.round(colors[i+2]*255)})`
            : '#000000'
          let visible = true
          if (surfViewZ) {
            const surfZ = surfViewZ(sx, sy)
            visible = surfZ === -Infinity || lineZ >= surfZ - bias
          }
          if (visible) {
            visibleDots.push({ cx: sx, cy: sy, fill })
            expandBB(sx - dotR, sy - dotR); expandBB(sx + dotR, sy + dotR)
          } else if (ghostOpac > 0) {
            ghostDots.push({ cx: sx, cy: sy, fill: occlusionColor || '#000000' })
            expandBB(sx - dotR, sy - dotR); expandBB(sx + dotR, sy + dotR)
          }
        }
        if (visibleDots.length > 0 || ghostDots.length > 0) {
          svgLayers.push({ id, isPoints: true, visibleDots, ghostDots, dotR, weight, opacity })
        }
        continue
      }

      // ── Line layers ──────────────────────────────────────────────────────────
      const visibleSegs = []
      const ghostSegs = []
      const segCount = positions.length / 6

      // Track cumulative screen-space length per connected chain so stroke-dashoffset
      // makes the dash pattern flow continuously across all segments of a terrain line.
      let visCumLen = 0, ghostCumLen = 0
      let visLastX = null, visLastY = null
      let ghostLastX = null, ghostLastY = null
      const CONNECT_EPS = 1.0

      for (let s = 0; s < segCount; s++) {
        const i = s * 6
        let ax = positions[i], ay = positions[i+1], az = positions[i+2]
        let bx = positions[i+3], by = positions[i+4], bz = positions[i+5]

        // Near-plane clip in view space. World→view is affine, so the view-space
        // crossing parameter t maps to the same t on the world-space segment.
        const za = viewZOf(ax, ay, az)
        const zb = viewZOf(bx, by, bz)
        if (za > nearZ && zb > nearZ) continue // fully behind the camera
        if (za > nearZ || zb > nearZ) {
          const t = (nearZ - za) / (zb - za)
          const cx3 = ax + (bx - ax) * t, cy3 = ay + (by - ay) * t, cz3 = az + (bz - az) * t
          if (za > nearZ) { ax = cx3; ay = cy3; az = cz3 }
          else            { bx = cx3; by = cy3; bz = cz3 }
        }

        let stroke = '#000000'
        if (colors && colors.length > i + 2) {
          stroke = `rgb(${Math.round(colors[i]*255)},${Math.round(colors[i+1]*255)},${Math.round(colors[i+2]*255)})`
        }

        const addSeg = (x0, y0, x1, y1, isVisible) => {
          const segLen = Math.hypot(x1 - x0, y1 - y0)
          if (segLen < 0.1) return
          if (isVisible) {
            if (visLastX === null || Math.hypot(x0 - visLastX, y0 - visLastY) > CONNECT_EPS) visCumLen = 0
            visibleSegs.push({ x0, y0, x1, y1, stroke, dashOffset: visCumLen })
            visCumLen += segLen
            visLastX = x1; visLastY = y1
          } else {
            if (ghostLastX === null || Math.hypot(x0 - ghostLastX, y0 - ghostLastY) > CONNECT_EPS) ghostCumLen = 0
            ghostSegs.push({ x0, y0, x1, y1, stroke: occlusionColor || '#000000', dashOffset: ghostCumLen })
            ghostCumLen += segLen
            ghostLastX = x1; ghostLastY = y1
          }
          expandBB(x0, y0); expandBB(x1, y1)
        }

        if (!surfViewZ) {
          const p0 = project(ax, ay, az), p1 = project(bx, by, bz)
          if (offCanvas2(p0, p1)) continue
          addSeg(p0[0], p0[1], p1[0], p1[1], true)
          continue
        }

        // Skip segments entirely outside the canvas before the (expensive)
        // per-sample occlusion test — when zoomed in this is most of them.
        {
          const p0 = project(ax, ay, az), p1 = project(bx, by, bz)
          if (offCanvas2(p0, p1)) continue
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
      if (offCanvas1(cx, cy)) continue

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

  // Clamp the content bounding box to the canvas: partially visible segments
  // are kept whole, so the box can spill slightly past the edges. The export
  // mirrors the viewport — never larger than what is on screen. (Zoomed-out
  // scenes keep their tight content box; the clamp is a no-op there.)
  minX = Math.max(minX, 0); minY = Math.max(minY, 0)
  maxX = Math.min(maxX, width); maxY = Math.min(maxY, height)
  if (maxX <= minX || maxY <= minY) return

  const vx = minX - MARGIN, vy = minY - MARGIN
  const vw = (maxX - minX) + MARGIN * 2, vh = (maxY - minY) + MARGIN * 2
  
  const layerGroups = []
  for (const layer of svgLayers) {
    const sw        = (layer.weight * 0.5).toFixed(3)
    const dashSizes = DASH_SEGMENT_SIZES[layer.dash ?? 'solid'] ?? null
    const modeId    = layer.id ?? 'Lines'
    const modeLabel = modeId.replace(/([A-Z])/g, ' $1').trim()
    const inner = []

    if (layer.isPoints) {
      const r = layer.dotR.toFixed(2)
      if (layer.ghostDots.length > 0) {
        const els = layer.ghostDots.map(({ cx, cy, fill }) =>
          `<circle cx="${(cx-vx).toFixed(1)}" cy="${(cy-vy).toFixed(1)}" r="${r}" fill="${fill}"/>`)
        inner.push(`<g stroke="none" opacity="${ghostOpac * layer.opacity}">${els.join('')}</g>`)
      }
      if (layer.visibleDots.length > 0) {
        const els = layer.visibleDots.map(({ cx, cy, fill }) =>
          `<circle cx="${(cx-vx).toFixed(1)}" cy="${(cy-vy).toFixed(1)}" r="${r}" fill="${fill}"/>`)
        inner.push(`<g stroke="none" opacity="${layer.opacity}">${els.join('')}</g>`)
      }
      layerGroups.push(`<g id="layer-${modeId}" inkscape:groupmode="layer" inkscape:label="${modeLabel}">${inner.join('')}</g>`)
      continue
    }

    const buildLineEls = (segs) => {
      if (!dashSizes) {
        return segs.map(({ x0, y0, x1, y1, stroke }) =>
          `<line x1="${(x0-vx).toFixed(1)}" y1="${(y0-vy).toFixed(1)}" x2="${(x1-vx).toFixed(1)}" y2="${(y1-vy).toFixed(1)}" stroke="${stroke}"/>`)
      }
      const { dashPx, gapPx } = dashSizes
      const els = []
      for (const { x0, y0, x1, y1, stroke, dashOffset } of segs) {
        for (const s of splitDashSegment(x0, y0, x1, y1, dashOffset, dashPx, gapPx)) {
          els.push(`<line x1="${(s.x0-vx).toFixed(1)}" y1="${(s.y0-vy).toFixed(1)}" x2="${(s.x1-vx).toFixed(1)}" y2="${(s.y1-vy).toFixed(1)}" stroke="${stroke}"/>`)
        }
      }
      return els
    }

    // Ghost pass (Hidden)
    if (layer.ghostSegs.length > 0) {
      const ghostEls = buildLineEls(layer.ghostSegs)
      inner.push(`<g stroke-width="${sw}" opacity="${ghostOpac * layer.opacity}" stroke-linecap="round" stroke-linejoin="round">${ghostEls.join('')}</g>`)
    }
    // Main pass (Visible)
    if (layer.visibleSegs.length > 0) {
      const lineEls = buildLineEls(layer.visibleSegs)
      inner.push(`<g stroke-width="${sw}" opacity="${layer.opacity}" stroke-linecap="round" stroke-linejoin="round">${lineEls.join('')}</g>`)
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
    ...layerGroups,
    ...(circleEls.length > 0 ? [`<g stroke="none">${circleEls.join('')}</g>`] : []),
    `</svg>`,
  ].join('\n')
  download(svg, `${baseName ?? 'heightmap'}.svg`, 'image/svg+xml')
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
