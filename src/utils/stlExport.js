/**
 * Binary STL export — produces a closed, watertight solid ready for 3D printing.
 *
 * The mesh is built from three parts:
 *   1. Top surface  — terrain triangles with elevation baked into Y
 *   2. Bottom plate — flat rectangle at baseY (2 world-units below terrain minimum)
 *   3. Side walls   — quads connecting the perimeter top edge to the base
 *
 * Coordinate system: X/Z horizontal, Y vertical (up). Most slicers let you
 * re-orient on import; the model lands flat-side-down if left as-is.
 *
 * Winding: right-hand rule, normals computed per-triangle and written into
 * the STL so slicers with strict manifold checks accept the file.
 */

export function exportSTL({ surfaceGeo, terrain }) {
  if (!surfaceGeo || !terrain) return

  const { positions, indices } = surfaceGeo
  const { rows, cols } = terrain

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const vx = (i) => positions[i * 3]
  const vy = (i) => positions[i * 3 + 1]
  const vz = (i) => positions[i * 3 + 2]

  // 9-float triangle buffer (ax,ay,az, bx,by,bz, cx,cy,cz)
  const tris = []
  const add = (ax, ay, az, bx, by, bz, cx, cy, cz) =>
    tris.push(ax, ay, az, bx, by, bz, cx, cy, cz)

  // ── Base Y ────────────────────────────────────────────────────────────────────

  let minY = Infinity
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minY) minY = positions[i]
  }
  const baseY = minY - 2   // 2 world-unit solid base below lowest terrain point

  // ── 1. Top surface ────────────────────────────────────────────────────────────
  // Winding from buildSurfaceGeometry gives normals pointing +Y (up) — correct.

  const nTri = indices.length / 3
  for (let t = 0; t < nTri; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    add(vx(a), vy(a), vz(a),
        vx(b), vy(b), vz(b),
        vx(c), vy(c), vz(c))
  }

  // ── 2. Bottom plate ───────────────────────────────────────────────────────────
  // Winding tl→tr→bl and tr→br→bl gives normal pointing −Y (down).

  const tlx = vx(0),                     tlz = vz(0)
  const trx = vx(cols - 1),              trz = vz(cols - 1)
  const blx = vx((rows - 1) * cols),     blz = vz((rows - 1) * cols)
  const brx = vx((rows - 1) * cols + cols - 1)
  const brz = vz((rows - 1) * cols + cols - 1)

  add(tlx, baseY, tlz,  trx, baseY, trz,  blx, baseY, blz)
  add(trx, baseY, trz,  brx, baseY, brz,  blx, baseY, blz)

  // ── 3. Side walls ─────────────────────────────────────────────────────────────
  // Perimeter is traversed clockwise from above so that (top, next, base) gives
  // outward-pointing normals on each wall quad.

  const perim = []
  for (let c = 0; c < cols; c++)        perim.push(c)                           // top edge →
  for (let r = 1; r < rows; r++)        perim.push(r * cols + cols - 1)         // right edge ↓
  for (let c = cols - 2; c >= 0; c--)  perim.push((rows - 1) * cols + c)       // bottom edge ←
  for (let r = rows - 2; r >= 1; r--)  perim.push(r * cols)                     // left edge ↑

  const n = perim.length
  for (let i = 0; i < n; i++) {
    const i0 = perim[i], i1 = perim[(i + 1) % n]
    const ax = vx(i0), ay = vy(i0), az = vz(i0)   // top  — current
    const bx = vx(i1), by = vy(i1), bz = vz(i1)   // top  — next
    // (top-curr, top-next, base-curr) and (top-next, base-next, base-curr)
    add(ax, ay, az,   bx, by, bz,   ax, baseY, az)
    add(bx, by, bz,   bx, baseY, bz,  ax, baseY, az)
  }

  // ── Write binary STL ──────────────────────────────────────────────────────────

  const triCount = tris.length / 9
  const buf = new ArrayBuffer(84 + triCount * 50)
  const dv  = new DataView(buf)

  // 80-byte ASCII header (not used by most slicers, but nice to have)
  const hdr = 'Heightmap Lines STL Export'
  for (let i = 0; i < Math.min(hdr.length, 80); i++) dv.setUint8(i, hdr.charCodeAt(i))
  dv.setUint32(80, triCount, true)

  let off = 84
  for (let t = 0; t < triCount; t++) {
    const b  = t * 9
    const ax = tris[b],   ay = tris[b+1], az = tris[b+2]
    const bx = tris[b+3], by = tris[b+4], bz = tris[b+5]
    const cx = tris[b+6], cy = tris[b+7], cz = tris[b+8]

    // Face normal via cross product (B−A) × (C−A), normalised
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
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'heightmap.stl' })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
