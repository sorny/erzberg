/**
 * The look, written into a plate and read back out of it.
 *
 * Two containers, two ways to be silently wrong. A `tEXt` chunk is Latin-1 and
 * drops anything it cannot represent, so a layer named outside that set would
 * cost the whole preset without a word. An XML comment ends at the first `-->`,
 * so a `--` anywhere in the payload would truncate the file's own syntax. Both
 * are byte-level properties of a pure function, which is what makes them worth
 * asserting here rather than through a downloaded file eleven seconds into a
 * browser spec.
 */
import { describe, expect, it } from 'vitest'
import {
  PRESET_FORMAT, PRESET_KEYWORD,
  buildPreset, parsePreset, presetComment, presetToText, readPngPreset, readSvgPreset,
} from '../../src/utils/presetFile'
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

/** Signature, IHDR, IEND — structurally a PNG and nothing more. */
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

const STATE = {
  terrain: { resolution: 2, blurRadius: 3 },
  style: { enabledContours: true, colorContours: '#123456' },
  points: { showPoints: false },
  view: { tilt: 41, showFrame: true },
  gradientStops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }],
  bgGradientStops: [],
}

describe('buildPreset', () => {
  it('carries the six parameter groups and says what format it is', () => {
    const p = buildPreset(STATE)
    expect(p.format).toBe(PRESET_FORMAT)
    expect(p.app).toBe('erzberg')
    expect(p.style.colorContours).toBe('#123456')
    expect(p.view.tilt).toBe(41)
  })

  it('never carries the raster or its filename', () => {
    // The promise at the top of the README is that your files stay on your
    // machine, and a plate posted to a forum is that file leaving by another
    // route. The payload has no field for either, which is the guarantee.
    const p = buildPreset({ ...STATE, heightmapFilename: 'private-survey.tif' })
    expect(JSON.stringify(p)).not.toContain('private-survey')
    expect(p.heightmapDataURL).toBeUndefined()
  })

  it('takes a vector layer’s style and leaves its data behind', () => {
    const p = buildPreset({
      ...STATE,
      vectorLayers: [{
        id: 'l1', sourceId: 's1', count: 412, hidden: [3, 9],
        bucket: 'peaks', color: '#ff0000', visible: true,
      }],
    })
    expect(p.vectorStyles).toEqual([{ bucket: 'peaks', color: '#ff0000', visible: true }])
    expect(p.vectorStackOrder).toBe(true)
  })

  it('drops an uploaded glyph rather than writing one that cannot come back', () => {
    // `iconCustom` holds typed arrays. JSON writes those as `{"0":…}` objects
    // with no length, so every loop over them runs zero times — a layer told it
    // has an icon and drawing nothing at all.
    const p = buildPreset({
      ...STATE,
      vectorLayers: [{ id: 'l1', icon: 'custom', iconCustom: { polylines: [] }, color: '#0f0' }],
    })
    expect(p.vectorStyles[0].icon).toBeNull()
    expect(p.vectorStyles[0].iconCustom).toBeUndefined()
  })
})

describe('presetToText', () => {
  it('escapes everything Latin-1 cannot carry', () => {
    const text = presetToText({ style: { name: '地図' } })
    expect(text).toBe('{"style":{"name":"\\u5730\\u56f3"}}')
    // The property that matters: every byte is one a `tEXt` chunk will accept.
    expect([...text].every((c) => c.charCodeAt(0) <= 0x7E)).toBe(true)
  })

  it('round-trips through JSON unchanged', () => {
    expect(parsePreset(presetToText(buildPreset(STATE)))).toEqual(buildPreset(STATE))
  })
})

describe('the PNG chunk', () => {
  it('survives the round trip through the writer that puts it there', () => {
    const payload = buildPreset(STATE)
    const png = withTextChunks(stubPng(), [
      ['Copyright', '© OpenStreetMap contributors'],
      [PRESET_KEYWORD, presetToText(payload)],
    ])
    expect(readPngPreset(png)).toEqual(payload)
  })

  it('reads nothing out of a PNG that has no preset in it', () => {
    expect(readPngPreset(stubPng())).toBeNull()
    expect(readPngPreset(withTextChunks(stubPng(), [['Copyright', 'x']]))).toBeNull()
  })

  it('refuses a file that is not a PNG, and a truncated one', () => {
    expect(readPngPreset(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).toBeNull()
    const png = withTextChunks(stubPng(), [[PRESET_KEYWORD, presetToText(buildPreset(STATE))]])
    expect(readPngPreset(png.subarray(0, png.length - 40))).toBeNull()
  })

  it('walks the chunk list rather than searching the bytes', () => {
    // A compressed IDAT can hold any byte sequence, the keyword included. A
    // substring search would find this one and then read the image as JSON.
    const png = stubPng()
    const decoy = new TextEncoder().encode(`${PRESET_KEYWORD}\0{"style":{}}`)
    const out = new Uint8Array(png.length + decoy.length)
    out.set(png.subarray(0, 33), 0)
    out.set(decoy, 33)
    out.set(png.subarray(33), 33 + decoy.length)
    expect(readPngPreset(out)).toBeNull()
  })
})

describe('the SVG comment', () => {
  it('survives the round trip', () => {
    const payload = buildPreset(STATE)
    const svg = `<?xml version="1.0"?>\n<svg>\n${presetComment(payload)}\n<g/>\n</svg>`
    expect(readSvgPreset(svg)).toEqual(payload)
  })

  it('cannot close its own comment early', () => {
    // A layer name is user text and can hold anything. Two minus signs in a row
    // would end the comment mid-payload and leave `-->` loose in the document,
    // which is a broken file rather than a lost preset.
    const payload = buildPreset({ ...STATE, style: { note: 'north--south -- traverse --->' } })
    const comment = presetComment(payload)
    expect(comment.slice(4, -3)).not.toContain('--')
    expect(readSvgPreset(`<svg>${comment}</svg>`).style.note).toBe('north--south -- traverse --->')
  })

  it('reads nothing out of an SVG that has none', () => {
    expect(readSvgPreset('<svg><!-- © OpenStreetMap contributors --></svg>')).toBeNull()
    expect(readSvgPreset('')).toBeNull()
  })
})

describe('parsePreset', () => {
  it('accepts a preset written before the format field existed', () => {
    // Every preset in `public/presets` predates this module and is still a
    // preset. The test is whether the object holds a parameter group, not
    // whether it announces itself.
    expect(parsePreset('{"style":{"enabledLines":true}}')).toEqual({ style: { enabledLines: true } })
  })

  it('rejects JSON that is not a preset', () => {
    expect(parsePreset('{"hello":"world"}')).toBeNull()
    expect(parsePreset('[1,2,3]')).toBeNull()
    expect(parsePreset('not json')).toBeNull()
    expect(parsePreset('')).toBeNull()
  })
})
