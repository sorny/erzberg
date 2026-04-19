/**
 * SVG export — projects current line segment geometry through the active camera
 * into screen-space pixel coordinates, computes a tight bounding box around all
 * visible segments, and triggers a download.
 *
 * Occlusion: a software depth buffer (view-space Z, world-unit precision) is
 * rasterised from the terrain surface mesh in JavaScript so that peaks hide lines
 * behind them, matching the depth-buffer behaviour of the live viewport.
 *
 * View-space Z is used instead of NDC / window depth because the camera is very
 * far from the terrain (position [0,400,500], far=50000), which compresses all
 * terrain depths into a tiny window-depth range (~0.998-0.999).  A 50-unit
 * elevation difference causes only a 0.00014 window-depth difference, making
 * any epsilon-based NDC comparison unreliable.  In view space a 50-unit peak is
 * simply 50 units closer — clean and precise.
 */
import * as THREE from 'three'

const MARGIN    = 20   // px padding around the geometry bounding box
const N_SAMPLES = 32   // depth-test samples per segment
// Tolerance in world units.  Lines within EPS_VIEW units of the surface are
// treated as visible (handles float/interpolation noise).
const EPS_VIEW  = 1.0

// ─── Software depth buffer (view-space Z) ─────────────────────────────────────

/**
 * Rasterise every surface triangle into a full-resolution depth buffer.
 *
 * Depth value stored: inv_w = 1 / depth_to_camera  (= 1 / (-viewZ), always > 0).
 * This is the quantity that IS linearly interpolated in screen space for a
 * perspective-correct result (unlike view-space Z itself, which is not).
 * The buffer stores the MAXIMUM inv_w (= closest-to-camera surface).
 *
 * Returns a sampler: sample(sx, sy) → view-space Z of closest surface
 * (-Infinity when no surface covers that pixel, i.e. open sky).
 */
function buildZBuffer(surfaceGeo, groupMatrix, camera, W, H) {
  // Full resolution — half-res misses thin peak edges on dense grids.
  const buf = new Float32Array(W * H).fill(0)   // 0 = no surface (inv_w = 0)

  const { positions, indices } = surfaceGeo
  const nVerts = positions.length / 3
  const camInv = camera.matrixWorldInverse

  const vx  = new Float32Array(nVerts)  // screen X
  const vy  = new Float32Array(nVerts)  // screen Y
  const vd  = new Float32Array(nVerts)  // inv_w = 1 / depth_to_camera (> 0)

  const wld = new THREE.Vector3()
  const viw = new THREE.Vector3()

  for (let i = 0; i < nVerts; i++) {
    wld.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2])
    wld.applyMatrix4(groupMatrix)

    viw.copy(wld).applyMatrix4(camInv)
    vd[i] = 1.0 / (-viw.z)   // viw.z < 0 in front → inv_w > 0; larger = closer

    wld.project(camera)
    vx[i] = ( wld.x + 1) * 0.5 * W
    vy[i] = (-wld.y + 1) * 0.5 * H
  }

  const nTri = indices.length / 3
  for (let t = 0; t < nTri; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    fillTriangle(vx[a], vy[a], vd[a], vx[b], vy[b], vd[b], vx[c], vy[c], vd[c], buf, W, H)
  }

  return (sx, sy) => {
    const xi = Math.min(W - 1, Math.max(0, Math.round(sx)))
    const yi = Math.min(H - 1, Math.max(0, Math.round(sy)))
    const inv_w = buf[yi * W + xi]
    return inv_w > 0 ? -1.0 / inv_w : -Infinity   // -Infinity = open sky
  }
}

/** Scan-line triangle fill storing MAXIMUM inv_w (closest surface) per pixel. */
function fillTriangle(x0, y0, d0, x1, y1, d1, x2, y2, d2, buf, W, H) {
  // Sort top-to-bottom
  if (y1 < y0) { let t; t=x0;x0=x1;x1=t; t=y0;y0=y1;y1=t; t=d0;d0=d1;d1=t }
  if (y2 < y0) { let t; t=x0;x0=x2;x2=t; t=y0;y0=y2;y2=t; t=d0;d0=d2;d2=t }
  if (y2 < y1) { let t; t=x1;x1=x2;x2=t; t=y1;y1=y2;y2=t; t=d1;d1=d2;d2=t }

  const dy02 = y2 - y0
  if (dy02 < 0.5) return   // degenerate

  for (let y = Math.max(0, Math.ceil(y0)); y <= Math.min(H - 1, Math.floor(y2)); y++) {
    // Long edge (p0→p2)
    const t02 = (y - y0) / dy02
    const lx = x0 + (x2 - x0) * t02
    const ld = d0 + (d2 - d0) * t02

    // Short edge
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
      const d = dL + (dR - dL) * t   // inv_w; perspective-correct since 1/w is linear
      const idx = y * W + x
      if (d > buf[idx]) buf[idx] = d   // MAX inv_w = closest surface to camera
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function exportSVG({
  positions, colors, camera, width, height,
  bgColor, lineColor, strokeWeight,
  surfaceGeo, groupMatrix,
}) {
  if (!positions || positions.length === 0) {
    console.warn('[SVG] No geometry to export.')
    return
  }

  const camInv = camera.matrixWorldInverse
  const wld2 = new THREE.Vector3()  // reusable world-space
  const viw2 = new THREE.Vector3()  // reusable view-space

  /**
   * Project a local-space point →
   *   [screenX, screenY, viewSpaceZ]
   * viewSpaceZ is negative in front of the camera (Three.js convention).
   */
  const project = (x, y, z) => {
    wld2.set(x, y, z)
    if (groupMatrix) wld2.applyMatrix4(groupMatrix)
    viw2.copy(wld2).applyMatrix4(camInv)
    const viewZ = viw2.z                        // negative = in front
    wld2.project(camera)
    return [
      ( wld2.x + 1) * 0.5 * width,
      (-wld2.y + 1) * 0.5 * height,
      viewZ,
    ]
  }

  // Build depth sampler (null = no occlusion)
  const surfViewZ = (surfaceGeo && groupMatrix)
    ? buildZBuffer(surfaceGeo, groupMatrix, camera, width, height)
    : null

  // ── Collect visible (sub-)segments ────────────────────────────────────────

  const allSegs = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  const addSeg = (x0, y0, x1, y1, stroke) => {
    if (Math.hypot(x1 - x0, y1 - y0) < 0.1) return
    allSegs.push({ x0, y0, x1, y1, stroke })
    if (x0 < minX) minX = x0; if (x0 > maxX) maxX = x0
    if (y0 < minY) minY = y0; if (y0 > maxY) maxY = y0
    if (x1 < minX) minX = x1; if (x1 > maxX) maxX = x1
    if (y1 < minY) minY = y1; if (y1 > maxY) maxY = y1
  }

  const segCount = positions.length / 6
  for (let s = 0; s < segCount; s++) {
    const i = s * 6
    const ax = positions[i],     ay = positions[i + 1], az = positions[i + 2]
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5]

    // Segment color (use start-vertex color)
    let stroke = lineColor
    if (colors && colors.length > i + 2) {
      const r = Math.round(colors[i]     * 255)
      const g = Math.round(colors[i + 1] * 255)
      const b = Math.round(colors[i + 2] * 255)
      stroke = `rgb(${r},${g},${b})`
    }

    if (!surfViewZ) {
      // No depth buffer — emit full segment without occlusion
      const [x0, y0] = project(ax, ay, az)
      const [x1, y1] = project(bx, by, bz)
      addSeg(x0, y0, x1, y1, stroke)
      continue
    }

    // ── Occlusion: sample N+1 points, collect visible runs ──
    const pts = []
    for (let t = 0; t <= N_SAMPLES; t++) {
      const f  = t / N_SAMPLES
      const px = ax + (bx - ax) * f
      const py = ay + (by - ay) * f
      const pz = az + (bz - az) * f
      const [sx, sy, lineZ] = project(px, py, pz)
      const surfZ = surfViewZ(sx, sy)
      // surfZ is the view-space Z of the closest surface (-Infinity = sky).
      // lineZ is the view-space Z of this line sample.
      // Visible when the line is at or in front of the surface (within EPS_VIEW).
      const visible = surfZ === -Infinity || lineZ >= surfZ - EPS_VIEW
      pts.push({ sx, sy, visible })
    }

    // Emit visible sub-segments
    let runStart = null
    for (let t = 0; t <= N_SAMPLES; t++) {
      const { visible } = pts[t]
      if (visible && runStart === null) {
        runStart = t
      } else if (!visible && runStart !== null) {
        const p0 = pts[runStart], p1 = pts[t - 1]
        addSeg(p0.sx, p0.sy, p1.sx, p1.sy, stroke)
        runStart = null
      }
    }
    if (runStart !== null) {
      const p0 = pts[runStart], p1 = pts[N_SAMPLES]
      addSeg(p0.sx, p0.sy, p1.sx, p1.sy, stroke)
    }
  }

  if (allSegs.length === 0) {
    console.warn('[SVG] All segments were occluded or degenerate.')
    return
  }

  // ── Emit SVG ──────────────────────────────────────────────────────────────

  const vx = minX - MARGIN
  const vy = minY - MARGIN
  const vw = (maxX - minX) + MARGIN * 2
  const vh = (maxY - minY) + MARGIN * 2
  const sw = (strokeWeight * 0.5).toFixed(3)

  const lines = allSegs.map(({ x0, y0, x1, y1, stroke }) =>
    `    <line x1="${(x0 - vx).toFixed(1)}" y1="${(y0 - vy).toFixed(1)}" ` +
    `x2="${(x1 - vx).toFixed(1)}" y2="${(y1 - vy).toFixed(1)}" stroke="${stroke}"/>`
  )

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     width="${vw.toFixed(0)}" height="${vh.toFixed(0)}"`,
    `     viewBox="0 0 ${vw.toFixed(1)} ${vh.toFixed(1)}">`,
    `  <rect width="100%" height="100%" fill="${bgColor}"/>`,
    `  <g stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">`,
    ...lines,
    `  </g>`,
    `</svg>`,
  ].join('\n')

  download(svg, 'heightmap.svg', 'image/svg+xml')
}

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
