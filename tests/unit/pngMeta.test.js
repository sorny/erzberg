/**
 * PNG text chunks — the ODbL credit an exported plate has to carry.
 *
 * The SVG exporter writes its attribution as an XML comment and that is easy to
 * check by eye. A PNG is a binary container the canvas hands back finished, so
 * the credit is spliced into the encoded bytes afterwards — which means chunk
 * framing, a CRC the decoder is entitled to reject, and an insertion point that
 * has to be legal. All of that is arithmetic over a buffer, and this asserts it
 * directly rather than through a browser download.
 */
import { describe, expect, it } from 'vitest'
import { withTextChunks } from '../../src/utils/pngExport'

const SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

const crc = (bytes) => {
  let c = 0xFFFFFFFF
  for (const b of bytes) {
    c ^= b
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

/**
 * The smallest thing that is structurally a PNG: signature, IHDR, IEND.
 *
 * Its own chunks carry real checksums, which matters — the assertion below is
 * that *every* chunk in the output validates, so a stub with zero CRCs would
 * fail it whatever the code under test did, and pass it for the wrong reason if
 * the assertion were narrowed to the inserted chunk alone.
 */
function stubPng() {
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length)
    const dv = new DataView(out.buffer)
    dv.setUint32(0, data.length)
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
    out.set(data, 8)
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)))
    return out
  }
  const ihdr = chunk('IHDR', new Uint8Array(13))
  const iend = chunk('IEND', new Uint8Array(0))
  const out = new Uint8Array(8 + ihdr.length + iend.length)
  out.set(SIG, 0); out.set(ihdr, 8); out.set(iend, 8 + ihdr.length)
  return out
}

/** Walk a PNG's chunk list into [{type, keyword, text, crcOk}]. */
function readChunks(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out = []
  let i = 8
  while (i < bytes.length) {
    const len = dv.getUint32(i)
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8))
    const data = bytes.subarray(i + 8, i + 8 + len)
    // Recompute the CRC the way a decoder would, over type + data.
    const crcOk = crc(bytes.subarray(i + 4, i + 8 + len)) === dv.getUint32(i + 8 + len)
    const entry = { type, crcOk }
    if (type === 'tEXt') {
      const z = data.indexOf(0)
      entry.keyword = String.fromCharCode(...data.subarray(0, z))
      entry.text = String.fromCharCode(...data.subarray(z + 1))
    }
    out.push(entry)
    i += 12 + len
    if (type === 'IEND') break
  }
  return out
}

describe('withTextChunks', () => {
  it('writes a readable tEXt chunk with a valid CRC', () => {
    const out = withTextChunks(stubPng(), [['Copyright', '© OpenStreetMap contributors']])
    const chunks = readChunks(out)
    const text = chunks.find((c) => c.type === 'tEXt')
    expect(text).toBeDefined()
    expect(text.keyword).toBe('Copyright')
    expect(text.text).toBe('© OpenStreetMap contributors')
    // A decoder is entitled to reject a chunk whose checksum does not match, so
    // this is the assertion that decides whether the credit survives at all.
    expect(chunks.every((c) => c.crcOk)).toBe(true)
  })

  it('inserts after IHDR, before the image data', () => {
    const out = withTextChunks(stubPng(), [['Copyright', 'x']])
    expect(readChunks(out).map((c) => c.type)).toEqual(['IHDR', 'tEXt', 'IEND'])
  })

  it('keeps the signature and every original chunk intact', () => {
    const src = stubPng()
    const out = withTextChunks(src, [['Copyright', '© OpenStreetMap contributors']])
    expect([...out.subarray(0, 8)]).toEqual(SIG)
    expect(out.length).toBe(src.length + 12 + 'Copyright'.length + 1 + 28)
  })

  it('writes several entries in order', () => {
    const out = withTextChunks(stubPng(), [['Copyright', 'a'], ['Source', 'b']])
    const t = readChunks(out).filter((c) => c.type === 'tEXt')
    expect(t.map((c) => c.keyword)).toEqual(['Copyright', 'Source'])
  })

  it('refuses text tEXt cannot represent rather than mangling it', () => {
    // tEXt is Latin-1. A CJK string would silently truncate to nonsense, so the
    // chunk is dropped instead — the file is still valid, just uncredited.
    const out = withTextChunks(stubPng(), [['Copyright', '地図']])
    expect(readChunks(out).some((c) => c.type === 'tEXt')).toBe(false)
  })

  it('returns the input untouched when it is not a PNG', () => {
    const junk = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect([...withTextChunks(junk, [['Copyright', 'x']])]).toEqual([...junk])
  })

  it('is a no-op with nothing to write', () => {
    const src = stubPng()
    expect(withTextChunks(src, []).length).toBe(src.length)
  })
})
