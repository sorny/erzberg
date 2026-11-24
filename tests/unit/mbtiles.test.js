import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { writeMbtiles } from '../../scripts/mbtiles.js'

describe('writeMbtiles', () => {
  it('stores tiles with their rows counted from the south, and the metadata', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'mbt-')), 'plate.mbtiles')
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    await writeMbtiles(file, [{ z: 10, x: 554, y: 360, png }], {
      name: 'graz', bounds: [14.9, 47.0, 15.1, 47.1], minZoom: 10, maxZoom: 10,
    })
    const db = new DatabaseSync(file)
    const row = db.prepare('SELECT * FROM tiles').get()
    expect(row.zoom_level).toBe(10)
    expect(row.tile_column).toBe(554)
    expect(row.tile_row).toBe(1023 - 360)
    expect(Buffer.from(row.tile_data)).toEqual(png)
    const meta = Object.fromEntries(db.prepare('SELECT name, value FROM metadata').all().map((r) => [r.name, r.value]))
    expect(meta.format).toBe('png')
    expect(meta.bounds).toBe('14.900000,47.000000,15.100000,47.100000')
    db.close()
  })
})
