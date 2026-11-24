/**
 * XYZ tiles into one MBTiles file, the SQLite tile store MapBox defined.
 *
 * Written with Node's own `node:sqlite`, so the command line needs no native
 * module. MBTiles counts tile rows from the south (TMS), so each XYZ row is
 * flipped on the way in.
 */
import { existsSync, rmSync } from 'node:fs'

/**
 * @param {string} file the .mbtiles path; an existing file is replaced
 * @param {{z, x, y, png: Buffer}[]} tiles
 * @param {{ name: string, bounds: number[], minZoom: number, maxZoom: number }} meta
 */
export async function writeMbtiles(file, tiles, meta) {
  const { DatabaseSync } = await import('node:sqlite')
  if (existsSync(file)) rmSync(file)
  const db = new DatabaseSync(file)
  try {
    db.exec(`
      CREATE TABLE metadata (name TEXT, value TEXT);
      CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);
      CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);
    `)
    const [w, s, e, n] = meta.bounds
    const put = db.prepare('INSERT INTO metadata (name, value) VALUES (?, ?)')
    for (const [k, v] of Object.entries({
      name: meta.name, format: 'png', type: 'overlay', version: '1',
      description: 'An erzberg plate', attribution: meta.attribution ?? '',
      bounds: [w, s, e, n].map((v) => v.toFixed(6)).join(','),
      center: `${((w + e) / 2).toFixed(6)},${((s + n) / 2).toFixed(6)},${meta.minZoom}`,
      minzoom: String(meta.minZoom), maxzoom: String(meta.maxZoom),
    })) put.run(k, v)
    const add = db.prepare('INSERT INTO tiles (zoom_level, tile_column, tile_row, tile_data) VALUES (?, ?, ?, ?)')
    db.exec('BEGIN')
    for (const { z, x, y, png } of tiles) add.run(z, x, 2 ** z - 1 - y, png)
    db.exec('COMMIT')
  } finally {
    db.close()
  }
}
