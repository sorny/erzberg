/**
 * The surface mesh the lines are drawn over.
 *
 * Split out of geometryBuilders.js, which keeps the dispatcher and re-exports
 * the public API, so importers are unchanged.
 */
import { cellElev, NODATA_SENTINEL_Y } from '../terrain'

// ─── Surface ──────────────────────────────────────────────────────────────────

/**
 * Vertex normals for the surface mesh, computed in the worker so the main
 * thread never runs three.js computeVertexNormals() over megavertex meshes.
 * Same semantics as three.js: area-weighted face-normal accumulation
 * (n = (C−B) × (A−B) per triangle), then per-vertex normalization; vertices
 * referenced by no triangle (masked NoData cells) keep a zero normal.
 */
function computeSurfaceNormals(positions, indices) {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3
    const abx = positions[a]     - positions[b],
          aby = positions[a + 1] - positions[b + 1],
          abz = positions[a + 2] - positions[b + 2]
    const cbx = positions[c]     - positions[b],
          cby = positions[c + 1] - positions[b + 1],
          cbz = positions[c + 2] - positions[b + 2]
    const nx = cby * abz - cbz * aby
    const ny = cbz * abx - cbx * abz
    const nz = cbx * aby - cby * abx
    normals[a] += nx; normals[a + 1] += ny; normals[a + 2] += nz
    normals[b] += nx; normals[b + 1] += ny; normals[b + 2] += nz
    normals[c] += nx; normals[c + 1] += ny; normals[c + 2] += nz
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i], y = normals[i + 1], z = normals[i + 2]
    const len = Math.sqrt(x * x + y * y + z * z) || 1
    normals[i] = x / len; normals[i + 1] = y / len; normals[i + 2] = z / len
  }
  return normals
}

/** Grid UVs for the base octant; mirrored octants keep (0,0). The shader passes
 *  that sample UVs — texture overlay, cast shadows, AO — describe the primary
 *  terrain, and a mirrored copy has no meaningful position in that space. */
function buildSurfaceUvs(vertexCount, rows, cols) {
  const uvs = new Float32Array(vertexCount * 2)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      uvs[i * 2]     = c / (cols - 1)
      uvs[i * 2 + 1] = 1 - r / (rows - 1)
    }
  }
  return uvs
}

/**
 * The triangulated terrain surface: the fill layer, the SVG depth buffer's
 * occluder, and the mesh STL export is built from.
 *
 * Three decisions here are load-bearing and not obvious from the code:
 *
 *  - **A quad is emitted only when all four of its corners have data.** That is
 *    what makes a NoData hole a real hole rather than a stretched skin across
 *    the gap.
 *  - **Masked vertices are parked at `NODATA_SENTINEL_Y`** instead of being
 *    compacted out, which keeps vertex index == grid index and so keeps the
 *    index arithmetic trivial. Nothing references them, so the renderer never
 *    sees them — but anything walking the position array directly must skip
 *    them, and STL export once shipped a base plate 10 000 units down because
 *    it did not.
 *  - **Indices are counted in a first pass before being written.** The count is
 *    not known up front once holes are possible, and growing the buffer would
 *    mean reallocating a multi-megabyte array mid-build.
 *
 * Normals and UVs are skipped entirely when no fill layer needs them — see
 * `needsSurfaceShading`. They are the bulk of the work here.
 */
export function buildSurfaceGeometry(terrain, p) {
  // minB/maxB ride along in the metadata rather than being recomputed on the
  // main thread: buildTerrain already has them over the *valid* cells, and a
  // scan of `brightnessBuf` could not tell a genuine 0 from a NoData vertex.
  const { grid, gridMask, rows, cols, scl, halfW, halfH, elevScale, minB, maxB } = terrain
  const { jitterAmt } = p
  // Normals and UVs feed the terrain shader only. STL export derives its own
  // facet normals and SVG export needs just positions/indices, so when nothing
  // shades the surface both are skipped — they are the bulk of this builder.
  // `needsSurfaceShading` is a worker dependency, so turning a fill layer on
  // triggers one rebuild that fills them back in.
  const shade = p.needsSurfaceShading !== false
  const NO_F32 = new Float32Array(0)
  const vertexCount = rows * cols
  const basePos = new Float32Array(vertexCount * 3), baseBright = new Float32Array(vertexCount)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (!gridMask[i]) { basePos[i*3]=c*scl-halfW; basePos[i*3+1]=NODATA_SENTINEL_Y; basePos[i*3+2]=r*scl-halfH; baseBright[i]=0 }
      else { basePos[i*3]=c*scl-halfW; basePos[i*3+1]=cellElev(grid, r, c, cols, elevScale, jitterAmt); basePos[i*3+2]=r*scl-halfH; baseBright[i]=grid[i] }
    }
  }
  // Two-pass index build: count valid quads first so the buffer is allocated once.
  let quadCount = 0
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = r*cols+c
      if (gridMask[tl] && gridMask[tl+1] && gridMask[tl+cols] && gridMask[tl+cols+1]) quadCount++
    }
  }
  if (!quadCount) return { positions: new Float32Array(0), brightnessBuf: new Float32Array(0), indices: new Uint32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), metadata: { rows, cols, minB, maxB } }
  const baseIndices = new Uint32Array(quadCount * 6)
  let bi = 0
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = r*cols+c, tr = tl+1, bl = tl+cols, br = bl+1
      if (gridMask[tl] && gridMask[tr] && gridMask[bl] && gridMask[br]) {
        baseIndices[bi] = tl; baseIndices[bi+1] = bl; baseIndices[bi+2] = tr
        baseIndices[bi+3] = tr; baseIndices[bi+4] = bl; baseIndices[bi+5] = br
        bi += 6
      }
    }
  }
  const mX = [p.showMirrorPlusX ? 1 : null, p.showMirrorMinusX ? -1 : null].filter(v => v !== null)
  const mY = [p.showMirrorPlusY ? 1 : null, p.showMirrorMinusY ? -1 : null].filter(v => v !== null)
  const mZ = [p.showMirrorPlusZ ? 1 : null, p.showMirrorMinusZ ? -1 : null].filter(v => v !== null)
  const nOct = mX.length * mY.length * mZ.length

  // Fast path: single identity octant — the base buffers are the final mesh.
  if (nOct === 1 && mX[0] === 1 && mY[0] === 1 && mZ[0] === 1) {
    return {
      positions: basePos, brightnessBuf: baseBright, indices: baseIndices,
      normals: shade ? computeSurfaceNormals(basePos, baseIndices) : NO_F32,
      uvs: shade ? buildSurfaceUvs(vertexCount, rows, cols) : NO_F32,
      metadata: { rows, cols, minB, maxB },
    }
  }

  // Pre-allocate all octants once (repeated concat() is O(octants²) in copies).
  const finalPos = new Float32Array(basePos.length * nOct)
  const finalBright = new Float32Array(baseBright.length * nOct)
  const finalIndices = new Uint32Array(baseIndices.length * nOct)
  let posOff = 0, brightOff = 0, indOff = 0, indexOffset = 0
  for (const sx of mX) {
    for (const sy of mY) {
      for (const sz of mZ) {
        for (let i = 0; i < basePos.length; i += 3) {
          finalPos[posOff + i]     = basePos[i]     * sx
          finalPos[posOff + i + 1] = basePos[i + 1] * sy
          finalPos[posOff + i + 2] = basePos[i + 2] * sz
        }
        posOff += basePos.length
        finalBright.set(baseBright, brightOff); brightOff += baseBright.length
        const flipWinding = (sx * sy * sz) < 0
        for (let i = 0; i < baseIndices.length; i += 3) {
          finalIndices[indOff + i] = baseIndices[i] + indexOffset
          if (flipWinding) {
            finalIndices[indOff + i + 1] = baseIndices[i + 2] + indexOffset
            finalIndices[indOff + i + 2] = baseIndices[i + 1] + indexOffset
          } else {
            finalIndices[indOff + i + 1] = baseIndices[i + 1] + indexOffset
            finalIndices[indOff + i + 2] = baseIndices[i + 2] + indexOffset
          }
        }
        indOff += baseIndices.length
        indexOffset += vertexCount
      }
    }
  }
  return {
    positions: finalPos, brightnessBuf: finalBright, indices: finalIndices,
    normals: shade ? computeSurfaceNormals(finalPos, finalIndices) : NO_F32,
    uvs: shade ? buildSurfaceUvs(vertexCount * nOct, rows, cols) : NO_F32,
    metadata: { rows, cols, minB, maxB },
  }
}
