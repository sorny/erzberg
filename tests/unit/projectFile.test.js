import { describe, expect, it } from 'vitest'
import { isProjectFile, pack, readProject, unpack, writeProject } from '../../src/utils/projectFile'

describe('the project file', () => {
  it('packs typed arrays into binary entries and back', () => {
    const bins = []
    const src = { a: new Float32Array([1.5, -2]), b: [new Uint8Array([7]), 'x'], f: () => 1, n: null,
                  names: new Map([[0, 'Grimming'], [3, 'Kulm']]) }
    const json = pack(src, bins)
    expect(bins.map((b) => b.name)).toEqual(['bin/0', 'bin/1'])
    expect(json.a).toEqual({ $bin: 'bin/0', type: 'Float32Array' })
    expect('f' in json).toBe(false)
    const read = (name) => bins.find((b) => b.name === name).data
    const back = unpack(JSON.parse(JSON.stringify(json)), read)
    expect(Array.from(back.a)).toEqual([1.5, -2])
    expect(back.a).toBeInstanceOf(Float32Array)
    expect(Array.from(back.b[0])).toEqual([7])
    expect(back.n).toBeNull()
    expect(back.names).toBeInstanceOf(Map)
    expect(back.names.get(3)).toBe('Kulm')
  })

  it('round-trips through a zip', async () => {
    const pixels = new Float32Array(64 * 64).map((_, i) => (i % 97) / 97)
    const state = { terrain: { srcPixels: pixels, srcWidth: 64, srcHeight: 64, heightmapFilename: 'x.tif' },
                    preset: { style: { bgColor: '#fff' } }, textLayers: [{ text: 'Grimming' }] }
    const bytes = await writeProject(state)
    expect(bytes[0]).toBe(0x50)
    const back = await readProject(bytes.buffer)
    expect(back.project).toBe(1)
    expect(back.terrain.srcWidth).toBe(64)
    expect(Array.from(back.terrain.srcPixels)).toEqual(Array.from(pixels))
    expect(back.textLayers[0].text).toBe('Grimming')
  })

  it('is null for a zip that is not a project, and refuses a newer one', async () => {
    const { zip } = await import('../../src/utils/zipWrite')
    expect(await readProject((await zip([{ name: 'a.txt', data: 'hi' }])).buffer)).toBeNull()
    const newer = await zip([{ name: 'project.json', data: '{"app":"erzberg","project":99}' }])
    await expect(readProject(newer.buffer)).rejects.toThrow(/newer/)
  })

  it('knows its name', () => {
    expect(isProjectFile('Grimming.erzberg')).toBe(true)
    expect(isProjectFile('a.zip')).toBe(false)
  })
})

describe('the zip writer', () => {
  it('reports its progress and stops when asked', async () => {
    const { zip, ZIP_CANCELLED } = await import('../../src/utils/zipWrite')
    const entries = [{ name: 'a', data: new Uint8Array(1000) }, { name: 'b', data: new Uint8Array(3000) }]
    const seen = []
    await zip(entries, { onProgress: (f) => seen.push(f) })
    expect(seen).toEqual([0.25, 1])
    let asked = 0
    await expect(zip(entries, { shouldCancel: () => ++asked > 1 })).rejects.toBe(ZIP_CANCELLED)
  })
})
