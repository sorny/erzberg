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
import { clipSegment, insideRect } from './frame'
import { makePacer, makeReporter, CANCELLED, STRIDE } from './pacing'

const MARGIN    = 20   // px padding around the geometry bounding box
const N_SAMPLES = 64   // depth-test samples per segment (increased for precision)

// ─── Software depth buffer (view-space Z) ─────────────────────────────────────

/**
 * Rasterises the occluders into a software depth buffer and returns a sampler.
 *
 * The SVG has no depth test of its own, so hiding a line behind a mountain means
 * knowing how far away the terrain is at each pixel. The occluders — the surface
 * mesh and the per-layer occlusion curtains — are scan-converted here into a
 * screen-sized buffer, and each line sample then compares its own depth against
 * it.
 *
 * The buffer stores **inverse** view-space depth (`1 / -z`), for two reasons: it
 * interpolates linearly in screen space where `z` does not, so `fillTriangle`
 * can lerp it down an edge correctly; and it makes `0` a usable empty value,
 * since no real surface is infinitely far away. The returned sampler turns that
 * back into a depth, reporting `-Infinity` — nothing here, never occlude —
 * wherever no occluder was drawn.
 */
async function buildZBuffer(zGeos, groupMatrix, camera, W, H, elevMinCut, elevMaxCut,
                            pacer = null, onPhase = null) {
  const buf = new Float32Array(W * H).fill(0)
  const camInv = camera.matrixWorldInverse
  const wld = new THREE.Vector3()
  const viw = new THREE.Vector3()
  // `??`, not `||`: 0 is a legitimate cut. With `||`, dragging Elev max cut to 0
  // fell back to 100 and the depth buffer kept every triangle the viewport had
  // discarded, so the export culled lines against terrain that was not there.
  const cutLo = (elevMinCut ?? 0) / 100
  const cutHi = (elevMaxCut ?? 100) / 100
  // View-space z of the near plane (camera looks down -z). Vertices on the
  // camera side of it project to garbage screen coordinates (the perspective
  // divide mirrors them), so triangles touching them must not be rasterised.
  const nearZ = -(camera.near ?? 0.1)

  // Work total up front so the caller's bar is determinate rather than a guess.
  let totalUnits = 0
  for (const g of zGeos) {
    if (!g.positions || g.positions.length === 0) continue
    totalUnits += g.positions.length / 3 + g.indices.length / 3
  }
  let done = 0

  for (const geo of zGeos) {
    const { positions, indices, brightnessBuf } = geo
    if (!positions || positions.length === 0) continue
    // The cut is a fraction of the data's own brightness range, matching the
    // surface shader and the line builders. Curtain geometry carries no bounds
    // (and no brightness either), so it falls back to the full range and the
    // test below is skipped for it anyway.
    const lo = geo.metadata?.minB ?? 0
    const span = Math.max(1e-5, (geo.metadata?.maxB ?? 1) - lo)
    const nVerts = positions.length / 3
    const vx  = new Float32Array(nVerts)
    const vy  = new Float32Array(nVerts)
    const vd  = new Float32Array(nVerts)
    const behind = new Uint8Array(nVerts)
    const vb  = brightnessBuf ? new Float32Array(nVerts) : null

    for (let i = 0; i < nVerts; i++) {
      if (pacer && (i & STRIDE) === 0 && pacer.due()) {
        await pacer.yield()
        onPhase?.((done + i) / totalUnits)
      }
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

    done += nVerts

    const nTri = indices.length / 3
    for (let t = 0; t < nTri; t++) {
      if (pacer && (t & STRIDE) === 0 && pacer.due()) {
        await pacer.yield()
        onPhase?.((done + t) / totalUnits)
      }
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
      if (behind[a] || behind[b] || behind[c]) continue
      // Reject triangles fully outside the canvas — when zoomed in, that is
      // most of the terrain, and fillTriangle's per-row clamping would still
      // walk their full vertical extent.
      if ((vx[a] < 0 && vx[b] < 0 && vx[c] < 0) || (vx[a] > W && vx[b] > W && vx[c] > W) ||
          (vy[a] < 0 && vy[b] < 0 && vy[c] < 0) || (vy[a] > H && vy[b] > H && vy[c] > H)) continue
      if (vb) {
        const avgB = ((vb[a] + vb[b] + vb[c]) / 3 - lo) / span
        if (avgB < cutLo || avgB > cutHi) continue
      }
      fillTriangle(vx[a], vy[a], vd[a], vx[b], vy[b], vd[b], vx[c], vy[c], vd[c], buf, W, H)
    }
    done += nTri
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

/**
 * Project the scene and write an SVG.
 *
 * Async because it must be. The work is a few hundred milliseconds on an ordinary
 * plate and many seconds on a dense one, and run as one block that is a tab the
 * browser offers to kill — measured at a single 242 ms frame gap on the default
 * scene, with every other frame at 17 ms. It now hands the main thread back about
 * every 24 ms, which keeps the overlay painting, lets it report where it has got
 * to, and gives the user somewhere to press Cancel.
 *
 * @param onProgress  (fraction 0…1, label) — called at yield points only.
 * @param shouldCancel called at each yield; returning true unwinds without writing.
 * @returns 'done' | 'cancelled' | 'empty'
 */
export async function exportSVG(opts) {
  const pacer = makePacer(opts.shouldCancel)
  try {
    return await runExport(opts, pacer)
  } catch (e) {
    // The pacer throws this the moment Cancel is pressed. The download is the
    // last statement of the run, so an abandoned export leaves no file behind.
    if (e === CANCELLED) return 'cancelled'
    throw e
  }
}

async function runExport({
  onProgress,
  lineGeo, lineStyles = {}, camera, width, height,
  bgColor, bgGradient, bgGradientStops,
  surfaceGeo, groupMatrix,
  surfaceOccludes,
  depthOcclusion, occlusionBias, occlusionOpacity, occlusionColor,
  particlePositions, particleCount, particleColor, particleSize, particleSizeMax, particleSegments, particleOpacity,
  particleShadows, particleShadowLift, particleShadowColor, particleShadowOpacity, particleShadowSize,
  elevMinCut, elevMaxCut,
  // Paper framing. `frame` becomes the viewBox; `frameClip` is that rect inset
  // by the margin and is what geometry is actually cut to. Both null when
  // framing is off, which leaves every path below exactly as it was.
  frame, frameClip,
  baseName,
}, pacer) {
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

  /**
   * The paper crop, intersected with the canvas.
   *
   * `frame` stays exactly as given — it is the viewBox, and the page keeping the
   * shape you chose is the entire point of framing, so it must not be trimmed to
   * whatever happens to be on screen. What *is* trimmed is the region geometry is
   * cut to, because beyond the canvas there is no scene to export: Offset X/Y
   * reach ±50% at Scale 100%, which puts part of the frame off the drawing buffer.
   * Culling against the untrimmed frame let that part through, and the depth
   * sampler clamps its lookup to the buffer's edge pixel — so hidden-line removal
   * out there was decided against the depth of the last on-screen column, with a
   * seam at the boundary. Overhang now yields blank paper, which is the truth.
   */
  const clipRect = frameClip ? (() => {
    const x0 = Math.max(frameClip.x, 0), y0 = Math.max(frameClip.y, 0)
    const x1 = Math.min(frameClip.x + frameClip.w, width)
    const y1 = Math.min(frameClip.y + frameClip.h, height)
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }
  })() : null

  /**
   * Half the largest point sprite the GPU will actually draw.
   *
   * `gl_PointSize` is silently clamped to `ALIASED_POINT_SIZE_RANGE` — 511 on
   * one machine here, and as little as 63 on others — while this exporter was
   * happily projecting the unclamped size. Both compute `size · 300 / −z`, so
   * they agree until that product passes the ceiling, and then they diverge by
   * however far past it the maths went: at a close zoom with a large Size the
   * viewport shows a sprite pinned at the ceiling and the SVG shows one fifty
   * times bigger. The export is supposed to be what the viewport shows, so it
   * has to inherit the same limit.
   */
  const maxRadius = (particleSizeMax ?? Infinity) / 2

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

  // ── Fast path for the per-sample occlusion walk ────────────────────────────
  //
  // `project` above is fine for the handful of one-off calls, but the occlusion
  // loop runs it millions of times, and there it does four mat4 transforms where
  // one suffices: groupMatrix, camInv for viewZ, then .project() which applies
  // camInv *again* before the projection matrix. Folding the whole chain into a
  // single MVP, plus the one row of the modelview that produces viewZ, cuts it to
  // one transform and no allocation — the array `project` returns was the other
  // half of the cost, at two objects per sample.
  const mvp = new THREE.Matrix4()
    .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
  if (groupMatrix) mvp.multiply(groupMatrix)
  const m = mvp.elements

  const mv = new THREE.Matrix4().copy(camInv)
  if (groupMatrix) mv.multiply(groupMatrix)
  const e = mv.elements
  // Third row of the modelview — view-space z as a plain dot product.
  const z0 = e[2], z1 = e[6], z2 = e[10], z3 = e[14]

  const hw = 0.5 * width, hh = 0.5 * height
  // Reused across every segment; sized for the sample ceiling.
  const sxBuf = new Float64Array(N_SAMPLES + 1)
  const syBuf = new Float64Array(N_SAMPLES + 1)
  const visBuf = new Uint8Array(N_SAMPLES + 1)

  // Everything outside this is not worth projecting. Without a frame it is the
  // canvas, as before; with one it is the paper, so most off-frame geometry
  // never reaches the occlusion walk at all.
  const cull = clipRect
    ? { x0: clipRect.x, y0: clipRect.y, x1: clipRect.x + clipRect.w, y1: clipRect.y + clipRect.h }
    : { x0: 0, y0: 0, x1: width, y1: height }

  const offCanvas2 = (p0, p1) =>
    (p0[0] < cull.x0 - PAD && p1[0] < cull.x0 - PAD) || (p0[0] > cull.x1 + PAD && p1[0] > cull.x1 + PAD) ||
    (p0[1] < cull.y0 - PAD && p1[1] < cull.y0 - PAD) || (p0[1] > cull.y1 + PAD && p1[1] > cull.y1 + PAD)

  const offCanvas1 = (sx, sy) =>
    sx < cull.x0 - PAD || sx > cull.x1 + PAD || sy < cull.y0 - PAD || sy > cull.y1 + PAD

  /**
   * A mark that cannot be cut in half — a stipple dot, a particle, a shadow.
   * A pen either draws a dot or it does not, so these are kept or dropped by
   * their centre; one whose centre is inside may overhang the paper edge by its
   * own radius, which for a plotted dot is the right trade.
   */
  const dotInside = (x, y) => !clipRect || insideRect(x, y, clipRect)

  const zGeos = []
  if (surfaceOccludes && surfaceGeo && groupMatrix) {
    zGeos.push(surfaceGeo)
  }
  if (Array.isArray(lineGeo)) {
    for (const layer of lineGeo) {
      if (layer.curtains && layer.curtains.positions.length > 0) {
        zGeos.push(layer.curtains)
      }
    }
  }

  const willBuildZ = !!((depthOcclusion || surfaceOccludes) && zGeos.length > 0 && groupMatrix)

  /**
   * Where each phase sits on the bar.
   *
   * Fixed shares rather than a unit count spanning all three, because their units
   * are not comparable — a triangle, a segment sampled up to 64 times and an
   * emitted string element cost wildly different amounts, so a single counter
   * would stall and then sprint. Ranges keep the bar monotonic and roughly
   * truthful, which is all a progress bar owes anyone. With occlusion off there is
   * no depth buffer, so the walk takes its share.
   */
  const PHASE = willBuildZ
    ? { z: [0, 0.25], walk: [0.25, 0.85], build: [0.85, 1] }
    : { z: [0, 0],    walk: [0, 0.8],     build: [0.8, 1] }

  // Throttled in the reporter, so callers get whole percentage points and the
  // loops below can report as freely as they like.
  const emit = makeReporter(onProgress)
  const report = (range, frac, label) => {
    const f = frac < 0 ? 0 : frac > 1 ? 1 : frac
    emit(range[0] + (range[1] - range[0]) * f, label)
  }

  // Build the Z-buffer when depth occlusion is on, or when any fill layer is
  // drawing. A visible surface acts as a depth occluder here — it is never
  // rasterised into the SVG as polygons, only used to cull lines behind it,
  // which is what keeps the export matching the viewport.
  report(PHASE.z, 0, 'Building depth buffer…')
  const surfViewZ = willBuildZ
    ? await buildZBuffer(zGeos, groupMatrix, camera, width, height, elevMinCut, elevMaxCut,
                         pacer, (f) => report(PHASE.z, f, 'Building depth buffer…'))
    : null

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const expandBB = (x, y) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }

  const svgLayers = []

  // Segments across every layer, so the walk's share of the bar advances evenly
  // rather than restarting per layer.
  const WALK_LABEL = 'Hiding lines behind terrain…'
  const walkTotal = Array.isArray(lineGeo)
    ? lineGeo.reduce((n, l) => n + (l.positions ? l.positions.length / 6 : 0), 0)
    : 0
  let walkDone = 0
  report(PHASE.walk, 0, WALK_LABEL)

  if (Array.isArray(lineGeo)) {
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
          if ((s & STRIDE) === 0 && pacer.due()) {
            await pacer.yield()
            report(PHASE.walk, (walkDone + s) / Math.max(1, walkTotal), WALK_LABEL)
          }
          const i = s * 6
          const cx3 = (positions[i] + positions[i+3]) * 0.5
          const cy3 = (positions[i+1] + positions[i+4]) * 0.5
          const cz3 = (positions[i+2] + positions[i+5]) * 0.5
          const [sx, sy, lineZ] = project(cx3, cy3, cz3)
          if (lineZ > nearZ || offCanvas1(sx, sy)) continue
          if (!dotInside(sx, sy)) continue
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
        walkDone += dotCount
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
        if ((s & STRIDE) === 0 && pacer.due()) {
          await pacer.yield()
          report(PHASE.walk, (walkDone + s) / Math.max(1, walkTotal), WALK_LABEL)
        }
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

        // The one funnel every segment passes through, visible and ghost alike,
        // for all fourteen draw modes and the GPX track — so the paper crop
        // belongs here rather than in each of them.
        //
        // The chain bookkeeping advances with the *original* segment even when
        // only part of it survives, and the drawn piece carries `tHead × length`
        // added to its dash offset. Dash phase accumulates along a chain, so
        // without that a clipped stroke would restart its pattern at the paper
        // edge, which is visible as a stutter all along the frame.
        const addSeg = (x0, y0, x1, y1, isVisible) => {
          const segLen = Math.hypot(x1 - x0, y1 - y0)
          if (segLen < 0.1) return
          // Framing off is the default and this is the funnel every segment of
          // every mode passes through — a quarter of a million of them in this
          // file's own measurement — so it must not allocate a rect and repeat
          // the hypot just to arrive back at segLen.
          let cx0 = x0, cy0 = y0, cx1 = x1, cy1 = y1, tHead = 0, drawn = segLen
          if (clipRect) {
            const c = clipSegment(x0, y0, x1, y1, clipRect)
            if (c) { cx0 = c.x0; cy0 = c.y0; cx1 = c.x1; cy1 = c.y1; tHead = c.tHead
                     drawn = Math.hypot(cx1 - cx0, cy1 - cy0) }
            else   { drawn = 0 }
          }

          if (isVisible) {
            if (visLastX === null || Math.hypot(x0 - visLastX, y0 - visLastY) > CONNECT_EPS) visCumLen = 0
            if (drawn >= 0.1) {
              visibleSegs.push({ x0: cx0, y0: cy0, x1: cx1, y1: cy1, stroke,
                                 dashOffset: visCumLen + tHead * segLen })
              expandBB(cx0, cy0); expandBB(cx1, cy1)
            }
            visCumLen += segLen
            visLastX = x1; visLastY = y1
          } else {
            if (ghostLastX === null || Math.hypot(x0 - ghostLastX, y0 - ghostLastY) > CONNECT_EPS) ghostCumLen = 0
            if (drawn >= 0.1) {
              ghostSegs.push({ x0: cx0, y0: cy0, x1: cx1, y1: cy1,
                               stroke: occlusionColor || '#000000',
                               dashOffset: ghostCumLen + tHead * segLen })
              expandBB(cx0, cy0); expandBB(cx1, cy1)
            }
            ghostCumLen += segLen
            ghostLastX = x1; ghostLastY = y1
          }
        }

        if (!surfViewZ) {
          const p0 = project(ax, ay, az), p1 = project(bx, by, bz)
          if (offCanvas2(p0, p1)) continue
          addSeg(p0[0], p0[1], p1[0], p1[1], true)
          continue
        }

        // Skip segments entirely outside the canvas before the (expensive)
        // per-sample occlusion test — when zoomed in this is most of them.
        const q0 = project(ax, ay, az), q1 = project(bx, by, bz)
        if (offCanvas2(q0, q1)) continue

        // Sample count follows the segment's screen length instead of being a
        // flat 64. Visibility is read from a per-pixel Z-buffer, so two samples
        // per pixel resolves every transition it can represent; a fixed 64 meant
        // ~30 samples per *pixel* at a typical grid cell of ~2.7 screen px. Both
        // endpoints are already projected just above, so the length is free.
        //
        // Two per pixel rather than one: at one, a transition inside a pixel can
        // land between samples and the run boundary shifts.
        //
        // Measured on the reference terrain at a 40° tilt: the whole export goes
        // 1042 ms -> 265 ms (3.9x; the remainder is Z-buffer rasterisation and
        // string building, which this does not touch), for 255 105 elements
        // against 255 578 before — 0.19% fewer, from occlusion transitions inside
        // a single pixel that a per-pixel depth buffer could not have placed
        // accurately anyway.
        const n = Math.max(2, Math.min(N_SAMPLES,
          Math.ceil(2 * Math.hypot(q1[0] - q0[0], q1[1] - q0[1]))))

        const dx = bx - ax, dy = by - ay, dz = bz - az
        for (let t = 0; t <= n; t++) {
          const f = t / n
          const x = ax + dx * f, y = ay + dy * f, z = az + dz * f
          const cw = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15])
          const sx = ((m[0] * x + m[4] * y + m[8]  * z + m[12]) * cw + 1) * hw
          const sy = (-((m[1] * x + m[5] * y + m[9] * z + m[13]) * cw) + 1) * hh
          const lineZ = z0 * x + z1 * y + z2 * z + z3
          const surfZ = surfViewZ(sx, sy)
          sxBuf[t] = sx; syBuf[t] = sy
          visBuf[t] = (surfZ === -Infinity || lineZ >= surfZ - bias) ? 1 : 0
        }
        let runStart = 0
        for (let t = 1; t <= n; t++) {
          if (visBuf[t] !== visBuf[runStart]) {
            const isVisible = visBuf[runStart] === 1
            if (isVisible || ghostOpac > 0) {
              addSeg(sxBuf[runStart], syBuf[runStart], sxBuf[t], syBuf[t], isVisible)
            }
            runStart = t
          }
        }
        if (visBuf[runStart] === 1 || ghostOpac > 0) {
          addSeg(sxBuf[runStart], syBuf[runStart], sxBuf[n], syBuf[n], visBuf[runStart] === 1)
        }
      }

      walkDone += segCount
      if (visibleSegs.length > 0 || ghostSegs.length > 0) {
        svgLayers.push({ id, visibleSegs, ghostSegs, weight, opacity, dash })
      }
    }
  }

  // The flock loops below take no yields on purpose. They read the *live* buffers
  // — ParticleSystem hands them out uncopied so an export catches the frame on
  // screen — so pausing mid-pass would let the birds move and splice two different
  // moments into one picture. They are small beside the segment walk, and staying
  // atomic costs nothing measurable.
  const projectedParticles = []
  if (particlePositions && particleCount > 0) {
    for (let i = 0; i < particleCount; i++) {
      wld2.set(particlePositions[i*3], particlePositions[i*3+1], particlePositions[i*3+2])
      if (groupMatrix) wld2.applyMatrix4(groupMatrix)
      viw2.copy(wld2).applyMatrix4(camInv)
      if (viw2.z >= 0) continue
      
      const r = Math.min(maxRadius, ((particleSize ?? 4) * 300 / (-viw2.z)) * 0.5)
      wld2.project(camera)
      const cx = (wld2.x+1)*0.5*width, cy = (-wld2.y+1)*0.5*height
      if (offCanvas1(cx, cy)) continue
      if (!dotInside(cx, cy)) continue

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

  // ── Murmuration shadows ─────────────────────────────────────────────────────
  //
  // Discs on the terrain, so unlike the birds they are *behind* things rather
  // than in front and the depth test earns its keep: a shadow on the far slope
  // must be hidden by the ridge in front of it.
  const projectedShadows = []
  if (particleShadows && particleCount > 0) {
    for (let i = 0; i < particleCount; i++) {
      // Negative lift = no ground under it; the shader culls these too.
      if (particleShadowLift && particleShadowLift[i] < 0) continue
      wld2.set(particleShadows[i*3], particleShadows[i*3+1], particleShadows[i*3+2])
      if (groupMatrix) wld2.applyMatrix4(groupMatrix)
      viw2.copy(wld2).applyMatrix4(camInv)
      if (viw2.z >= 0) continue
      const r = Math.min(maxRadius, ((particleShadowSize ?? 4) * 300 / (-viw2.z)) * 0.5)
      wld2.project(camera)
      const cx = (wld2.x+1)*0.5*width, cy = (-wld2.y+1)*0.5*height
      if (offCanvas1(cx, cy)) continue
      if (!dotInside(cx, cy)) continue
      if (surfViewZ) {
        const surfZ = surfViewZ(cx, cy)
        // No ghost pass: a hidden shadow is simply not there. Drawing it faint
        // through a mountain would read as a smudge on the rock.
        if (surfZ !== -Infinity && viw2.z < surfZ - bias) continue
      }
      projectedShadows.push({ cx, cy, r })
      expandBB(cx-r, cy-r); expandBB(cx+r, cy+r)
    }
  }

  // ── Murmuration streaks ─────────────────────────────────────────────────────
  //
  // One segment per bird, nose to tail. Unlike the hologram field — whose motion
  // lives in the vertex shader and never reaches the CPU — the flock's positions
  // ARE the buffer the renderer draws from, so this is the frame on screen.
  const projectedTrails = []
  if (particleSegments && particleCount > 0) {
    for (let i = 0; i < particleCount; i++) {
      const k = i * 6
      let ax = particleSegments[k],     ay = particleSegments[k + 1], az = particleSegments[k + 2]
      let bx = particleSegments[k + 3], by = particleSegments[k + 4], bz = particleSegments[k + 5]

      // Same near-plane clip the line layers use: world→view is affine, so the
      // view-space crossing parameter is the world-space one.
      const za = viewZOf(ax, ay, az)
      const zb = viewZOf(bx, by, bz)
      if (za > nearZ && zb > nearZ) continue
      if (za > nearZ || zb > nearZ) {
        const t = (nearZ - za) / (zb - za)
        const cx3 = ax + (bx - ax) * t, cy3 = ay + (by - ay) * t, cz3 = az + (bz - az) * t
        if (za > nearZ) { ax = cx3; ay = cy3; az = cz3 }
        else            { bx = cx3; by = cy3; bz = cz3 }
      }

      let p0 = project(ax, ay, az), p1 = project(bx, by, bz)
      if (offCanvas2(p0, p1)) continue
      if (clipRect) {
        const c = clipSegment(p0[0], p0[1], p1[0], p1[1], clipRect)
        if (!c) continue
        p0 = [c.x0, c.y0, p0[2]]; p1 = [c.x1, c.y1, p1[2]]
      }

      // Depth-tested at the head only. A streak is a couple of pixels long and
      // the bird it hangs off is the thing being occluded; sampling both ends
      // would double the cost to disagree with the dot in front of it.
      let visible = true
      if (surfViewZ) {
        const surfZ = surfViewZ(p0[0], p0[1])
        visible = surfZ === -Infinity || p0[2] >= surfZ - bias
      }
      if (!visible && ghostOpac <= 0) continue
      projectedTrails.push({ x0: p0[0], y0: p0[1], x1: p1[0], y1: p1[1], visible })
      expandBB(p0[0], p0[1]); expandBB(p1[0], p1[1])
    }
  }

  if (svgLayers.length === 0 && projectedParticles.length === 0 &&
      projectedTrails.length === 0 && projectedShadows.length === 0) return 'empty'

  report(PHASE.build, 0, 'Assembling SVG…')

  // With a frame, the page *is* the frame: the whole point is an output whose
  // shape you chose rather than one the geometry happened to land in, so the
  // content box plays no part and neither does MARGIN — the paper margin is
  // already baked into frameClip, which the geometry above was cut to.
  let vx, vy, vw, vh
  if (frame) {
    vx = frame.x; vy = frame.y; vw = frame.w; vh = frame.h
  } else {
    // Clamp the content bounding box to the canvas: partially visible segments
    // are kept whole, so the box can spill slightly past the edges. The export
    // mirrors the viewport — never larger than what is on screen. (Zoomed-out
    // scenes keep their tight content box; the clamp is a no-op there.)
    minX = Math.max(minX, 0); minY = Math.max(minY, 0)
    maxX = Math.min(maxX, width); maxY = Math.min(maxY, height)
    if (maxX <= minX || maxY <= minY) return 'empty'

    vx = minX - MARGIN; vy = minY - MARGIN
    vw = (maxX - minX) + MARGIN * 2; vh = (maxY - minY) + MARGIN * 2
  }
  
  const BUILD_LABEL = 'Assembling SVG…'
  const buildTotal = svgLayers.reduce((n, l) => n +
    (l.isPoints ? l.visibleDots.length + l.ghostDots.length
                : l.visibleSegs.length + l.ghostSegs.length), 0)
  let buildDone = 0

  /**
   * `array.map(…)` over a quarter of a million elements is itself a long block,
   * so the element strings are produced in paced chunks like everything else.
   */
  const mapPaced = async (arr, fn) => {
    const out = new Array(arr.length)
    for (let i = 0; i < arr.length; i++) {
      if ((i & STRIDE) === 0 && pacer.due()) {
        await pacer.yield()
        report(PHASE.build, (buildDone + i) / Math.max(1, buildTotal), BUILD_LABEL)
      }
      out[i] = fn(arr[i])
    }
    buildDone += arr.length
    return out
  }

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
        const els = await mapPaced(layer.ghostDots, ({ cx, cy, fill }) =>
          `<circle cx="${(cx-vx).toFixed(1)}" cy="${(cy-vy).toFixed(1)}" r="${r}" fill="${fill}"/>`)
        inner.push(`<g stroke="none" opacity="${ghostOpac * layer.opacity}">${els.join('')}</g>`)
      }
      if (layer.visibleDots.length > 0) {
        const els = await mapPaced(layer.visibleDots, ({ cx, cy, fill }) =>
          `<circle cx="${(cx-vx).toFixed(1)}" cy="${(cy-vy).toFixed(1)}" r="${r}" fill="${fill}"/>`)
        inner.push(`<g stroke="none" opacity="${layer.opacity}">${els.join('')}</g>`)
      }
      layerGroups.push(`<g id="layer-${modeId}" inkscape:groupmode="layer" inkscape:label="${modeLabel}">${inner.join('')}</g>`)
      continue
    }

    const buildLineEls = async (segs) => {
      if (!dashSizes) {
        return mapPaced(segs, ({ x0, y0, x1, y1, stroke }) =>
          `<line x1="${(x0-vx).toFixed(1)}" y1="${(y0-vy).toFixed(1)}" x2="${(x1-vx).toFixed(1)}" y2="${(y1-vy).toFixed(1)}" stroke="${stroke}"/>`)
      }
      // A dashed segment expands to however many on-pieces the pattern gives it,
      // so this maps to arrays and flattens rather than one-for-one.
      const { dashPx, gapPx } = dashSizes
      const perSeg = await mapPaced(segs, ({ x0, y0, x1, y1, stroke, dashOffset }) =>
        splitDashSegment(x0, y0, x1, y1, dashOffset, dashPx, gapPx).map((s) =>
          `<line x1="${(s.x0-vx).toFixed(1)}" y1="${(s.y0-vy).toFixed(1)}" x2="${(s.x1-vx).toFixed(1)}" y2="${(s.y1-vy).toFixed(1)}" stroke="${stroke}"/>`).join(''))
      return perSeg
    }

    // Ghost pass (Hidden)
    if (layer.ghostSegs.length > 0) {
      const ghostEls = await buildLineEls(layer.ghostSegs)
      inner.push(`<g stroke-width="${sw}" opacity="${ghostOpac * layer.opacity}" stroke-linecap="round" stroke-linejoin="round">${ghostEls.join('')}</g>`)
    }
    // Main pass (Visible)
    if (layer.visibleSegs.length > 0) {
      const lineEls = await buildLineEls(layer.visibleSegs)
      inner.push(`<g stroke-width="${sw}" opacity="${layer.opacity}" stroke-linecap="round" stroke-linejoin="round">${lineEls.join('')}</g>`)
    }

    layerGroups.push(`<g id="layer-${modeId}" inkscape:groupmode="layer" inkscape:label="${modeLabel}">${inner.join('')}</g>`)
  }

  const pColor = particleColor ?? '#000000'
  // The viewport sprite is a soft radial falloff; an SVG circle is a flat disc,
  // so the export already only approximates it. Carrying the opacity across at
  // least keeps a deliberately faint field faint on paper.
  const pOpac = particleOpacity ?? 1
  const circleEls = projectedParticles.map(({ cx, cy, r, visible }) => `<circle cx="${(cx-vx).toFixed(1)}" cy="${(cy-vy).toFixed(1)}" r="${r.toFixed(2)}" fill="${visible ? pColor : occlusionColor}" opacity="${(visible ? pOpac : ghostOpac).toFixed(3)}"/>`)
  const shadowEls = projectedShadows.map(({ cx, cy, r }) =>
    `<circle cx="${(cx-vx).toFixed(1)}" cy="${(cy-vy).toFixed(1)}" r="${r.toFixed(2)}"/>`)
  const shadowGroup = shadowEls.length > 0
    ? [`<g id="layer-flock-shadow" inkscape:groupmode="layer" inkscape:label="Flock shadow" fill="${particleShadowColor ?? '#000000'}" stroke="none" opacity="${(particleShadowOpacity ?? 0.35).toFixed(3)}">${shadowEls.join('')}</g>`]
    : []
  // Its own Inkscape layer, unlike the dots: a plotter run is sorted by layer,
  // and streaks are the pen-drawn half of the flock.
  const trailStroke = Math.max(0.3, (particleSize ?? 4) * 0.15)
  const trailEls = projectedTrails.map(({ x0, y0, x1, y1, visible }) =>
    `<line x1="${(x0-vx).toFixed(1)}" y1="${(y0-vy).toFixed(1)}" x2="${(x1-vx).toFixed(1)}" y2="${(y1-vy).toFixed(1)}" stroke="${visible ? pColor : occlusionColor}" opacity="${(visible ? 0.75 * pOpac : ghostOpac).toFixed(3)}"/>`)
  const trailGroup = trailEls.length > 0
    ? [`<g id="layer-flock" inkscape:groupmode="layer" inkscape:label="Flock" fill="none" stroke-width="${trailStroke.toFixed(2)}" stroke-linecap="round">${trailEls.join('')}</g>`]
    : []
  const useBgGrad = bgGradient && bgGradientStops?.length > 1
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    // width/height at the same precision as the viewBox, so the page is not
    // non-uniformly scaled by the rounding. With a frame the sheet's proportion is
    // the whole point: an ISO 1500 × 1060.66 written as height="1061" over a
    // 1060.7 viewBox lands at 1:1.4147 instead of 1:1.41421, and frame.js stores
    // these ratios exactly rather than as rounded millimetres for that reason.
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${vw.toFixed(1)}" height="${vh.toFixed(1)}" viewBox="0 0 ${vw.toFixed(1)} ${vh.toFixed(1)}">`,
    ...(useBgGrad ? [`<defs><linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">${bgGradientStops.map(s => `<stop offset="${Math.round(s.pos*100)}%" stop-color="${s.color}"/>`).join('')}</linearGradient></defs>`] : []),
    `<rect width="100%" height="100%" fill="${useBgGrad ? 'url(#bg-grad)' : bgColor}"/>`,
    ...layerGroups,
    // After the line layers, matching the viewport's render order: a shadow
    // falls *on* the terrain, so it darkens the marks drawn there rather than
    // hiding beneath them.
    ...shadowGroup,
    ...trailGroup,
    ...(circleEls.length > 0 ? [`<g stroke="none">${circleEls.join('')}</g>`] : []),
    `</svg>`,
  ].join('\n')

  // Last breath before the file exists, so Cancel is honoured right up to the
  // point where honouring it still means "nothing was written".
  await pacer.yield()
  report(PHASE.build, 1, BUILD_LABEL)
  download(svg, `${baseName ?? 'heightmap'}.svg`, 'image/svg+xml')
  return 'done'
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
