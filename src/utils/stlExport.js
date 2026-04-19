/**
 * Binary STL export — closed, watertight solid for 3D printing.
 *
 * Three-part mesh:
 *   1. Top surface  — terrain triangles (elevation in Y_world)
 *   2. Side walls   — quads from every perimeter edge down to the base
 *   3. Base plate   — center fan over ALL perimeter base vertices
 *
 * Manifold guarantee: each edge is shared by exactly 2 faces.
 *   • Top surface interior edges: shared by 2 top triangles (grid).
 *   • Top surface boundary edges: shared with the corresponding wall tri.
 *   • Wall vertical corner edges: shared by the two adjacent wall quads.
 *   • Wall base edges: shared between wall tri and the adjacent base fan tri.
 *   • Base fan spoke edges: shared by the two adjacent fan tris.
 *
 * Coordinate mapping  (world → STL):
 *   stl_x =  world_x      (terrain column, right)
 *   stl_y = -world_z      (negated row → negate Z preserves handedness, det = +1)
 *   stl_z =  world_y      (elevation, build direction in Z-up slicers)
 *
 * With this mapping the perimeter is still CW in stl XY, so ALL original
 * windings remain correct — no face flipping required.
 * The model lays flat on the print bed (XY) with peaks pointing up (+Z).
 */

export function exportSTL({ surfaceGeo, terrain }) {
  if (!surfaceGeo || !terrain) return

  const { positions, indices } = surfaceGeo
  const { rows, cols } = terrain

  // ── Coordinate mapping ────────────────────────────────────────────────────
  const spx = (i) =>  positions[i * 3]        //  world X  → stl X
  const spy = (i) => -positions[i * 3 + 2]    // -world Z  → stl Y  (preserves handedness)
  const spz = (i) =>  positions[i * 3 + 1]    //  world Y  → stl Z  (elevation = build dir)

  // Base in stl Z = world minY − 2
  let minWorldY = Infinity
  for (let i = 1; i < positions.length; i += 3) {
    if (positions[i] < minWorldY) minWorldY = positions[i]
  }
  const baseZ = minWorldY - 2   // 2-unit solid base below lowest terrain point

  // Triangle accumulator: flat [ax,ay,az, bx,by,bz, cx,cy,cz, ...]
  const tris = []
  const add = (ax, ay, az, bx, by, bz, cx, cy, cz) =>
    tris.push(ax, ay, az, bx, by, bz, cx, cy, cz)

  // ── 1. Top surface ────────────────────────────────────────────────────────
  // buildSurfaceGeometry winding → +Y_world normals.
  // After (x, -z, y) remap, +Y_world becomes +Z_stl (up). ✓

  const nTri = indices.length / 3
  for (let t = 0; t < nTri; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2]
    add(spx(a), spy(a), spz(a),
        spx(b), spy(b), spz(b),
        spx(c), spy(c), spz(c))
  }

  // ── Perimeter (CW in stl XY after the -Z remap) ──────────────────────────
  const perim = []
  for (let c = 0; c < cols; c++)       perim.push(c)                         // top    →
  for (let r = 1; r < rows; r++)       perim.push(r * cols + cols - 1)       // right  ↓
  for (let c = cols - 2; c >= 0; c--) perim.push((rows - 1) * cols + c)     // bottom ←
  for (let r = rows - 2; r >= 1; r--) perim.push(r * cols)                   // left   ↑

  const n = perim.length

  // ── 2. Side walls ─────────────────────────────────────────────────────────
  // (top-curr, top-next, base-curr) and (top-next, base-next, base-curr)
  // With CW perimeter this winding gives outward-pointing normals. ✓

  for (let i = 0; i < n; i++) {
    const i0 = perim[i], i1 = perim[(i + 1) % n]
    const ax = spx(i0), ay = spy(i0), az = spz(i0)   // top current
    const bx = spx(i1), by = spy(i1), bz = spz(i1)   // top next
    add(ax, ay, az,  bx, by, bz,  ax, ay, baseZ)      // quad tri 1
    add(bx, by, bz,  bx, by, baseZ,  ax, ay, baseZ)   // quad tri 2
  }

  // ── 3. Base plate — center fan ────────────────────────────────────────────
  // One fan triangle per perimeter edge, all meeting at (0, 0, baseZ).
  // Terrain is centred at world origin → stl centre = (0, 0).
  // Winding (centre, p0, p1) with CW perimeter → −Z_stl normal (down). ✓
  // Every wall-base edge is now shared with exactly one fan triangle. ✓

  for (let i = 0; i < n; i++) {
    const i0 = perim[i], i1 = perim[(i + 1) % n]
    add(0, 0, baseZ,
        spx(i0), spy(i0), baseZ,
        spx(i1), spy(i1), baseZ)
  }

  // ── Write binary STL ──────────────────────────────────────────────────────

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

    // Face normal: (B−A) × (C−A), normalised
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
