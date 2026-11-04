/**
 * Coloured 3D models: the STL's solid with the plate on top.
 *
 * STL has no colour. These two formats carry the same solid (`buildSolid`) with
 * the plate laid over its top surface, from a top-down picture of the scene:
 *
 *   • glTF (`.glb`): the picture as a texture, for Blender and any web viewer.
 *   • 3MF: the picture sampled into vertex colours, for multi-material printers.
 *
 * The walls and the base take one colour, the paper's. Units are the STL's:
 * one world unit per raster cell, written as millimetres in the 3MF.
 */
import { zip } from './zipWrite'

/**
 * The top surface's ground extent in STL axes, for the UVs and the capture.
 * `tris` holds x, y, z per vertex, and the top is its first `top` floats.
 */
export function topBounds(tris, top) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let i = 0; i < top; i += 3) {
    const x = tris[i], y = tris[i + 1]
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
  }
  return { minX, maxX, minY, maxY }
}

/**
 * A vertex's place on the picture: u across, v down. The picture's top row is
 * north, which is the largest STL y (STL y is world −z).
 */
const uvOf = (b, x, y) => [(x - b.minX) / Math.max(1e-9, b.maxX - b.minX),
                           (b.maxY - y) / Math.max(1e-9, b.maxY - b.minY)]

// ── glTF ─────────────────────────────────────────────────────────────────────

/**
 * A binary glTF: two primitives, the textured top and the plain sides, and the
 * PNG inside the file.
 *
 * @param {{tris: number[], top: number}} solid
 * @param {Uint8Array} png   the top-down picture
 * @param {number[]} side    the walls' colour, linear RGB 0–1
 */
export function writeGlb({ tris, top }, png, side = [0.8, 0.8, 0.8]) {
  const b = topBounds(tris, top)
  const nTop = top / 3, nSide = (tris.length - top) / 3
  // glTF is y-up: STL (x, y, z) is glTF (x, z, −y), a rotation, so winding holds.
  const pos = (from, count) => {
    const out = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const j = from + i * 3
      out[i * 3] = tris[j]; out[i * 3 + 1] = tris[j + 2]; out[i * 3 + 2] = -tris[j + 1]
    }
    return out
  }
  const topPos = pos(0, nTop), sidePos = pos(top, nSide)
  const uv = new Float32Array(nTop * 2)
  for (let i = 0; i < nTop; i++) {
    const [u, v] = uvOf(b, tris[i * 3], tris[i * 3 + 1])
    uv[i * 2] = u; uv[i * 2 + 1] = v
  }
  const minMax = (a) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < a.length; i++) { const k = i % 3; if (a[i] < mn[k]) mn[k] = a[i]; if (a[i] > mx[k]) mx[k] = a[i] }
    return { min: mn, max: mx }
  }

  const parts = [topPos, uv, sidePos, png].map((a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
  const views = []
  let offset = 0
  for (const p of parts) {
    views.push({ buffer: 0, byteOffset: offset, byteLength: p.byteLength })
    offset += Math.ceil(p.byteLength / 4) * 4
  }
  const accessors = [
    { bufferView: 0, componentType: 5126, count: nTop, type: 'VEC3', ...minMax(topPos) },
    { bufferView: 1, componentType: 5126, count: nTop, type: 'VEC2' },
  ]
  const primitives = [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }]
  if (nSide) {
    accessors.push({ bufferView: 2, componentType: 5126, count: nSide, type: 'VEC3', ...minMax(sidePos) })
    primitives.push({ attributes: { POSITION: 2 }, material: 1 })
  }
  const json = {
    asset: { version: '2.0', generator: 'erzberg' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'plate' }],
    meshes: [{ name: 'plate', primitives }],
    materials: [
      { name: 'plate', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 } },
      { name: 'sides', pbrMetallicRoughness: { baseColorFactor: [...side, 1], metallicFactor: 0, roughnessFactor: 1 } },
    ],
    samplers: [{ magFilter: 9729, minFilter: 9729, wrapS: 33071, wrapT: 33071 }],
    textures: [{ sampler: 0, source: 0 }],
    images: [{ bufferView: 3, mimeType: 'image/png' }],
    accessors, bufferViews: views, buffers: [{ byteLength: offset }],
  }
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonLen = Math.ceil(jsonBytes.length / 4) * 4
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + offset)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true)
  dv.setUint32(12, jsonLen, true); dv.setUint32(16, 0x4E4F534A, true)
  out.set(jsonBytes, 20)
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLen)       // JSON pads with spaces
  const binAt = 20 + jsonLen
  dv.setUint32(binAt, offset, true); dv.setUint32(binAt + 4, 0x004E4942, true)
  parts.forEach((p, i) => out.set(p, binAt + 8 + views[i].byteOffset))
  return out
}

// ── 3MF ──────────────────────────────────────────────────────────────────────

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0').toUpperCase()

/**
 * A 3MF package: one mesh object with a colour group, one colour per distinct
 * vertex colour, and each triangle naming its three.
 *
 * @param {{tris: number[], top: number}} solid
 * @param {(u, v) => number[]} colorAt  the picture's sRGB 0–255 colour at a UV
 * @param {number[]} side   the walls' sRGB colour, 0–255
 */
export async function write3mf({ tris, top }, colorAt, side = [204, 204, 204]) {
  const b = topBounds(tris, top)
  const vIndex = new Map(), verts = []
  const cIndex = new Map(), colors = []
  const vertex = (x, y, z) => {
    const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`
    let i = vIndex.get(key)
    if (i === undefined) { i = verts.length; vIndex.set(key, i); verts.push(`<vertex x="${x.toFixed(3)}" y="${y.toFixed(3)}" z="${z.toFixed(3)}"/>`) }
    return i
  }
  const color = (rgb) => {
    // Five bits a channel: past that a printer cannot tell two colours apart.
    const q = rgb.map((c) => Math.round(c / 8) * 8)
    const key = (q[0] << 16) | (q[1] << 8) | q[2]
    let i = cIndex.get(key)
    if (i === undefined) { i = colors.length; cIndex.set(key, i); colors.push(`<m:color color="#${q.map(hex2).join('')}"/>`) }
    return i
  }
  const sideColor = color(side)
  const triangles = []
  for (let t = 0; t < tris.length; t += 9) {
    const v = [], c = []
    for (let k = 0; k < 3; k++) {
      const x = tris[t + k * 3], y = tris[t + k * 3 + 1], z = tris[t + k * 3 + 2]
      v.push(vertex(x, y, z))
      c.push(t < top ? color(colorAt(...uvOf(b, x, y))) : sideColor)
    }
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue   // a sliver the rounding closed
    triangles.push(`<triangle v1="${v[0]}" v2="${v[1]}" v3="${v[2]}" pid="1" p1="${c[0]}" p2="${c[1]}" p3="${c[2]}"/>`)
  }
  const model = [
    '<?xml version="1.0" encoding="UTF-8"?>\n',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"',
    ' xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">\n',
    '<metadata name="Application">erzberg</metadata>\n<resources>\n<m:colorgroup id="1">',
    colors.join(''), '</m:colorgroup>\n<object id="2" type="model" pid="1" pindex="', String(sideColor), '"><mesh><vertices>',
    verts.join(''), '</vertices><triangles>', triangles.join(''),
    '</triangles></mesh></object>\n</resources>\n<build><item objectid="2"/></build>\n</model>\n',
  ].join('')
  return zip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n' },
    { name: '3D/3dmodel.model', data: model },
  ])
}

/** `#rrggbb` → linear RGB 0–1, as glTF wants a base colour. */
export function linearRgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
}

/** `#rrggbb` → sRGB 0–255. */
export function srgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
