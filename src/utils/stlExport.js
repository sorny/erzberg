/**
 * Binary STL export — one or two closed, watertight solids for 3D printing.
 *
 * heightmap.stl     — terrain body: top surface + side walls + base plate.
 *                     Three-part manifold with a 2-unit solid base below the
 *                     lowest terrain point. Always produced.
 *
 * heightmap_gpx.stl — GPX track ribbon. Only produced when a GPX track is
 *                     loaded and the GeoTIFF bbox / CRS are known.
 *                     The ribbon is built as per-segment independent closed
 *                     rectangular prisms (12 triangles each, all 6 faces
 *                     sealed with their own start/end caps). Miter joins are
 *                     intentionally avoided: averaged perpendiculars at sharp
 *                     corners cause self-intersections that slicers report as
 *                     non-manifold even when the edge topology is correct.
 *                     Load both files into Bambu Studio / PrusaSlicer and
 *                     assign different filaments for multicolour printing.
 *
 * Coordinate mapping (world → STL):
 *   stl_x =  world_x   (terrain column, right)
 *   stl_y = -world_z   (negated row — preserves handedness, det = +1)
 *   stl_z =  world_y   (elevation, build direction in Z-up slicers)
 */

import { geoToWorld, sampleTerrainElev } from './geoCoords'

// ── STL writer ────────────────────────────────────────────────────────────────

function writeBinarySTL(tris, filename) {
  const triCount = tris.length / 9
  const buf = new ArrayBuffer(84 + triCount * 50)
  const dv  = new DataView(buf)

  const hdr = 'Heightmap Lines STL Export'
  for (let i = 0; i < Math.min(hdr.length, 80); i++) dv.setUint8(i, hdr.charCodeAt(i))
  dv.setUint32(80, triCount, true)

  let off = 84
  for (let t = 0; t < triCount; t++) {
    const b  = t * 9
    const ax = tris[b],   ay = tris[b+1], az = tris[b+2]
    const bx = tris[b+3], by = tris[b+4], bz = tris[b+5]
    const cx = tris[b+6], cy = tris[b+7], cz = tris[b+8]

    const ex = bx-ax, ey = by-ay, ez = bz-az
    const fx = cx-ax, fy = cy-ay, fz = cz-az
    let nx = ey*fz - ez*fy
    let ny = ez*fx - ex*fz
    let nz = ex*fy - ey*fx
    const len = Math.sqrt(nx*nx + ny*ny + nz*nz)
    if (len > 0) { nx /= len; ny /= len; nz /= len }

    dv.setFloat32(off, nx, true); off += 4
    dv.setFloat32(off, ny, true); off += 4
    dv.setFloat32(off, nz, true); off += 4
    dv.setFloat32(off, ax, true); off += 4
    dv.setFloat32(off, ay, true); off += 4
    dv.setFloat32(off, az, true); off += 4
    dv.setFloat32(off, bx, true); off += 4
    dv.setFloat32(off, by, true); off += 4
    dv.setFloat32(off, bz, true); off += 4
    dv.setFloat32(off, cx, true); off += 4
    dv.setFloat32(off, cy, true); off += 4
    dv.setFloat32(off, cz, true); off += 4
    dv.setUint16(off, 0, true); off += 2
  }

  const blob = new Blob([buf], { type: 'application/octet-stream' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── GPX ribbon builder ────────────────────────────────────────────────────────

const GPX_H  = 2.0   // ribbon height in world units (= 2 mm before slicer scaling)
const GPX_HW = 3.0   // half-width in world units

/**
 * Build a watertight rectangular-tube ribbon for one continuous run of track
 * points. All 6 faces (top, bottom, left, right, start cap, end cap) are
 * emitted with correct outward normals.
 *
 * @param {Array<{worldX, worldZ, e}>} run  – consecutive in-extent track points
 * @param {number[]} tris                   – flat triangle accumulator (9 floats/tri)
 */
/**
 * Each segment is emitted as its own independent closed rectangular prism
 * (12 triangles, all 6 faces sealed). No vertices are shared between segments.
 *
 * Using averaged/miter perpendiculars at interior joints causes self-intersecting
 * geometry at sharp bends, which Bambu Studio (and other slicers) report as
 * non-manifold even when the edge topology is correct. Per-segment boxes are
 * provably non-self-intersecting and unconditionally manifold.
 */
function buildGpxRibbon(run, tris) {
  // Deduplicate consecutive points that produce zero-length segments.
  const pts = [run[0]]
  for (let i = 1; i < run.length; i++) {
    const prev = pts[pts.length - 1]
    const dx = run[i].worldX - prev.worldX
    const dz = run[i].worldZ - prev.worldZ
    if (dx * dx + dz * dz > 1e-8) pts.push(run[i])
  }
  if (pts.length < 2) return

  const add = (ax, ay, az, bx, by, bz, cx, cy, cz) =>
    tris.push(ax, ay, az, bx, by, bz, cx, cy, cz)

  for (let i = 0; i < pts.length - 1; i++) {
    const x0 = pts[i].worldX,   z0 = pts[i].worldZ,   e0 = pts[i].e
    const x1 = pts[i+1].worldX, z1 = pts[i+1].worldZ, e1 = pts[i+1].e

    const dx = x1 - x0, dz = z1 - z0
    const len = Math.sqrt(dx * dx + dz * dz)
    const px = -dz / len * GPX_HW   // perpendicular offset in world X
    const pz =  dx / len * GPX_HW   // perpendicular offset in world Z

    // 8 corners in STL space: stl_x = world_x, stl_y = -world_z, stl_z = world_y
    const TL0 = [x0+px, -(z0+pz), e0+GPX_H],  TR0 = [x0-px, -(z0-pz), e0+GPX_H]
    const BL0 = [x0+px, -(z0+pz), e0        ],  BR0 = [x0-px, -(z0-pz), e0        ]
    const TL1 = [x1+px, -(z1+pz), e1+GPX_H],  TR1 = [x1-px, -(z1-pz), e1+GPX_H]
    const BL1 = [x1+px, -(z1+pz), e1        ],  BR1 = [x1-px, -(z1-pz), e1        ]

    // Top (+stl_z, outward = up)
    add(...TL0, ...TL1, ...TR0)
    add(...TL1, ...TR1, ...TR0)
    // Bottom (-stl_z, outward = down)
    add(...BR0, ...BL1, ...BL0)
    add(...BR0, ...BR1, ...BL1)
    // Left (-stl_y, outward = left)
    add(...TL0, ...BL0, ...TL1)
    add(...TL1, ...BL0, ...BL1)
    // Right (+stl_y, outward = right)
    add(...TR0, ...TR1, ...BR0)
    add(...TR1, ...BR1, ...BR0)
    // Start cap (outward = -track direction)
    add(...BL0, ...TL0, ...BR0)
    add(...TL0, ...TR0, ...BR0)
    // End cap (outward = +track direction)
    add(...BL1, ...TR1, ...TL1)
    add(...BL1, ...BR1, ...TR1)
  }
}

// ── Public export ─────────────────────────────────────────────────────────────

export function exportSTL({ surfaceGeo, terrain, gpxPoints, geoTiffBbox, geoTiffCRS, p, baseName }) {
  if (!surfaceGeo || !terrain) return

  const { positions, indices } = surfaceGeo
  const { rows, cols } = terrain

  const spx = (i) =>  positions[i * 3]
  const spy = (i) => -positions[i * 3 + 2]
  const spz = (i) =>  positions[i * 3 + 1]

  let minWorldY = Infinity
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minWorldY) minWorldY = positions[i]
  }
  const baseZ = minWorldY - 2

  const tris = []
  const add = (ax, ay, az, bx, by, bz, cx, cy, cz) =>
    tris.push(ax, ay, az, bx, by, bz, cx, cy, cz)

  // ── 1. Top surface ────────────────────────────────────────────────────────
  const nTri = indices.length / 3
  for (let t = 0; t < nTri; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    add(spx(a), spy(a), spz(a),
        spx(b), spy(b), spz(b),
        spx(c), spy(c), spz(c))
  }

  // ── 2. Side walls ─────────────────────────────────────────────────────────
  const perim = []
  for (let c = 0; c < cols; c++)       perim.push(c)
  for (let r = 1; r < rows; r++)       perim.push(r * cols + cols - 1)
  for (let c = cols - 2; c >= 0; c--) perim.push((rows - 1) * cols + c)
  for (let r = rows - 2; r >= 1; r--) perim.push(r * cols)

  const pn = perim.length
  for (let i = 0; i < pn; i++) {
    const i0 = perim[i], i1 = perim[(i + 1) % pn]
    const ax = spx(i0), ay = spy(i0), az = spz(i0)
    const bx = spx(i1), by = spy(i1), bz = spz(i1)
    add(ax, ay, az,  bx, by, bz,  ax, ay, baseZ)
    add(bx, by, bz,  bx, by, baseZ,  ax, ay, baseZ)
  }

  // ── 3. Base plate ─────────────────────────────────────────────────────────
  for (let i = 0; i < pn; i++) {
    const i0 = perim[i], i1 = perim[(i + 1) % pn]
    add(0, 0, baseZ, spx(i0), spy(i0), baseZ, spx(i1), spy(i1), baseZ)
  }

  const base = baseName ?? 'heightmap'
  writeBinarySTL(tris, `${base}.stl`)

  // ── GPX ribbon — separate file for multicolour printing ───────────────────
  if (gpxPoints?.length > 1 && geoTiffBbox && geoTiffCRS?.startsWith('EPSG:') && p) {
    const peakOff   = Math.floor(p.gridOffsetX ?? 0)
    const lineOff   = Math.floor(p.gridOffsetY ?? 0)
    const { scl, halfW, halfH } = terrain
    const imageWidth  = p.imageWidth
    const imageHeight = p.imageHeight
    if (!imageWidth || !imageHeight) return

    // Map every GPX point to world space (null = outside extent)
    const allPts = gpxPoints.map(({ lat, lon }) => {
      const wp = geoToWorld(lat, lon, geoTiffBbox, geoTiffCRS,
                            imageWidth, imageHeight, peakOff, lineOff, halfW, halfH)
      if (!wp) return null
      return {
        worldX: wp.worldX,
        worldZ: wp.worldZ,
        e: sampleTerrainElev(wp.pixelCol, wp.pixelRow, terrain, scl, peakOff, lineOff),
      }
    })

    // Split into continuous runs at null gaps
    const runs = []
    let cur = []
    for (const pt of allPts) {
      if (pt) { cur.push(pt) }
      else    { if (cur.length >= 2) runs.push(cur); cur = [] }
    }
    if (cur.length >= 2) runs.push(cur)

    if (runs.length === 0) return

    const gpxTris = []
    for (const run of runs) buildGpxRibbon(run, gpxTris)
    writeBinarySTL(gpxTris, `${base}-gpx.stl`)
  }
}
