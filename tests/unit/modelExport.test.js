import { describe, expect, it } from 'vitest'
import { linearRgb, topBounds, write3mf, writeGlb } from '../../src/utils/modelExport'

// Two top triangles over a 10 × 10 square, then one wall triangle below.
const solid = {
  tris: [0, 0, 5, 10, 0, 5, 10, 10, 5,   0, 0, 5, 10, 10, 5, 0, 10, 5,   0, 0, 5, 10, 0, 5, 0, 0, 0],
  top: 18,
}

describe('coloured models', () => {
  it('measures the top surface', () => {
    expect(topBounds(solid.tris, solid.top)).toEqual({ minX: 0, maxX: 10, minY: 0, maxY: 10 })
  })

  it('writes a valid GLB with the texture inside', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2, 3])
    const glb = writeGlb(solid, png, linearRgb('#ffffff'))
    const dv = new DataView(glb.buffer)
    expect(dv.getUint32(0, true)).toBe(0x46546C67)
    expect(dv.getUint32(8, true)).toBe(glb.length)
    const jsonLen = dv.getUint32(12, true)
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + jsonLen)))
    expect(json.meshes[0].primitives).toHaveLength(2)
    expect(json.accessors[0].count).toBe(6)
    // y-up: the top sits at height 5 on the y axis.
    expect(json.accessors[0].min[1]).toBe(5)
    const img = json.bufferViews[json.images[0].bufferView]
    const bin = 20 + jsonLen + 8
    expect(Array.from(glb.subarray(bin + img.byteOffset, bin + img.byteOffset + 4))).toEqual([0x89, 0x50, 0x4E, 0x47])
  })

  it('writes a 3MF with shared vertices and one colour per vertex colour', async () => {
    const bytes = await write3mf(solid, (u) => (u < 0.5 ? [255, 0, 0] : [0, 0, 255]), [200, 200, 200])
    const { unzip } = await import('but-unzip')
    const files = new Map()
    for (const e of unzip(bytes)) files.set(e.filename, new TextDecoder().decode(await e.read()))
    expect([...files.keys()].sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels'])
    const model = files.get('3D/3dmodel.model')
    expect((model.match(/<vertex /g) ?? []).length).toBe(5)
    expect((model.match(/<triangle /g) ?? []).length).toBe(3)
    expect(model).toContain('color="#FF0000"')
    expect(model).toContain('color="#C8C8C8"')
  })
})
