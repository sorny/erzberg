/**
 * A small zip writer, for the project file.
 *
 * Reading zips already goes through `but-unzip`, which writes nothing. This
 * writes what it reads: each entry deflated with the platform's own
 * `CompressionStream` (browsers and Node 18 and later), or stored when that is
 * missing or the data does not shrink. No zip64, so the whole file stays below
 * 4 GB, far above any raster the app can draw.
 */

let table = null
export function crc32(bytes) {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      table[n] = c >>> 0
    }
  }
  let c = 0xFFFFFFFF
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream !== 'function') return null
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** What `zip` throws when `shouldCancel` says stop. */
export const ZIP_CANCELLED = Symbol('zip cancelled')

/**
 * A zip of `[{ name, data: Uint8Array | string }]`, as bytes.
 *
 * `onProgress(0–1)` follows the bytes compressed so far, and `shouldCancel()`
 * is asked between entries. A 50 MB raster takes seconds to deflate, and a
 * caller showing an overlay needs both.
 */
export async function zip(entries, { onProgress, shouldCancel } = {}) {
  const enc = new TextEncoder()
  const parts = [], central = []
  const raws = entries.map(({ data }) => (typeof data === 'string' ? enc.encode(data) : data))
  const total = raws.reduce((n, r) => n + r.length, 0) || 1
  let done = 0
  let offset = 0
  for (const [k, { name }] of entries.entries()) {
    if (shouldCancel?.()) throw ZIP_CANCELLED
    const raw = raws[k]
    const packed = await deflateRaw(raw)
    const deflated = packed && packed.length < raw.length
    const body = deflated ? packed : raw
    const fname = enc.encode(name)
    const crc = crc32(raw)
    const head = (sig, extra) => {
      const h = new Uint8Array(extra + fname.length)
      const dv = new DataView(h.buffer)
      dv.setUint32(0, sig, true)
      return { h, dv }
    }
    // Local file header.
    const { h: local, dv: l } = head(0x04034b50, 30)
    l.setUint16(4, 20, true); l.setUint16(6, 0x0800, true)       // version, UTF-8 names
    l.setUint16(8, deflated ? 8 : 0, true)
    l.setUint32(14, crc, true); l.setUint32(18, body.length, true); l.setUint32(22, raw.length, true)
    l.setUint16(26, fname.length, true)
    local.set(fname, 30)
    // Central directory record.
    const { h: cen, dv: c } = head(0x02014b50, 46)
    c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true)
    c.setUint16(10, deflated ? 8 : 0, true)
    c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, raw.length, true)
    c.setUint16(28, fname.length, true)
    c.setUint32(42, offset, true)
    cen.set(fname, 46)
    parts.push(local, body)
    central.push(cen)
    offset += local.length + body.length
    done += raw.length
    onProgress?.(done / total)
  }
  const cenSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true)
  e.setUint32(12, cenSize, true); e.setUint32(16, offset, true)
  const out = new Uint8Array(offset + cenSize + 22)
  let at = 0
  for (const p of [...parts, ...central, end]) { out.set(p, at); at += p.length }
  return out
}
