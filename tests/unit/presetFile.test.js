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
  MIGRATED_AZIMUTHS, PRESET_FORMAT, PRESET_KEYWORD,
  buildPreset, migrateAzimuths, parsePreset, presetComment, presetToText,
  readPngPreset, readSvgPreset, sheetSwap,
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

describe('migrateAzimuths', () => {
  it('turns every offset sun into a true bearing', () => {
    const before = { style: Object.fromEntries(MIGRATED_AZIMUTHS.map((k) => [k, 315])) }
    const after = migrateAzimuths(before)
    for (const k of MIGRATED_AZIMUTHS) expect(after.style[k]).toBe(45)
  })

  it('leaves Tanaka alone, because Tanaka was always right', () => {
    /*
     * The one edit that would have changed a picture.
     *
     * `tanakaSunAzimuth` was built as `(sin, −cos)` from the day it was written
     * — a true bearing — while every other light here was a quarter turn from
     * one. So the same 315° lit Tanaka from the north-west and the hillshade
     * from the north-east, and a blanket migration would have swung Tanaka to
     * the north-east to match a mistake.
     */
    expect(MIGRATED_AZIMUTHS).not.toContain('tanakaSunAzimuth')
    const out = migrateAzimuths({ style: { tanakaSunAzimuth: 315, hillshadeAzimuth: 315 } })
    expect(out.style.tanakaSunAzimuth).toBe(315)
    expect(out.style.hillshadeAzimuth).toBe(45)
  })

  it('wraps rather than running past a circle', () => {
    expect(migrateAzimuths({ style: { hillshadeAzimuth: 300 } }).style.hillshadeAzimuth).toBe(30)
    expect(migrateAzimuths({ style: { hillshadeAzimuth: 0 } }).style.hillshadeAzimuth).toBe(90)
  })

  it('does not touch the caller’s copy', () => {
    // A preset is applied by spreading it over live state, and a bundled one can
    // be applied twice. Mutating in place would turn its light a further quarter
    // on the second click.
    const src = { style: { hillshadeAzimuth: 315 } }
    migrateAzimuths(src)
    expect(src.style.hillshadeAzimuth).toBe(315)
  })

  it('shrugs at a payload with no sun in it', () => {
    expect(migrateAzimuths({ style: { enabledLines: true } }).style.enabledLines).toBe(true)
    expect(migrateAzimuths(null)).toBeNull()
  })
})

describe('parsePreset', () => {
  it('accepts a preset written before the format field existed', () => {
    // A preset written before this module existed is still a preset. The test is
    // whether the object holds a parameter group, not whether it announces
    // itself.
    // It is also older than format 3, so it keeps the old slope and aspect
    // reading, and older than 5, so it keeps the classic occlusion with walls.
    const p = parsePreset('{"style":{"enabledLines":true}}')
    expect(p.style).toMatchObject({ enabledLines: true, slopeShadeTrue: false, aspectMapBivariate: false,
      occludeBy: 'lines', wallsLines: true, wallsHachure: true })
  })

  it('migrates anything older than the true-bearing scale, once', () => {
    // A plate v1.13 exported carries `format: 1`, and a preset older than the
    // field carries none. Both are on the offset scale and both get the 90°.
    expect(parsePreset('{"format":1,"style":{"hillshadeAzimuth":315}}').style.hillshadeAzimuth).toBe(45)
    expect(parsePreset('{"style":{"hillshadeAzimuth":315}}').style.hillshadeAzimuth).toBe(45)
    // And one already on it is left exactly as it is — the failure that turns a
    // bundled preset's light a further quarter every time it is opened.
    expect(parsePreset(`{"format":${PRESET_FORMAT},"style":{"hillshadeAzimuth":315}}`)
      .style.hillshadeAzimuth).toBe(315)
  })

  it('rejects JSON that is not a preset', () => {
    expect(parsePreset('{"hello":"world"}')).toBeNull()
    expect(parsePreset('[1,2,3]')).toBeNull()
    expect(parsePreset('not json')).toBeNull()
    expect(parsePreset('')).toBeNull()
  })
})

describe('migrateShading', () => {
  it('keeps a plate from before format 3 on the old slope and aspect reading', () => {
    const p = parsePreset('{"format":2,"style":{"showSlopeShade":true}}')
    expect(p.style.slopeShadeTrue).toBe(false)
    expect(p.style.aspectMapBivariate).toBe(false)
  })
  it('leaves a current plate and an explicit choice alone', () => {
    expect(parsePreset(`{"format":${PRESET_FORMAT},"style":{"showSlopeShade":true}}`).style.slopeShadeTrue).toBeUndefined()
    expect(parsePreset('{"format":2,"style":{"slopeShadeTrue":true}}').style.slopeShadeTrue).toBe(true)
  })
})

describe('migrateOcclusion', () => {
  it('gives a plate before format 5 the classic model with every wall, and leaves 5 alone', async () => {
    const { parsePreset, PRESET_FORMAT } = await import('../../src/utils/presetFile')
    expect(PRESET_FORMAT).toBeGreaterThanOrEqual(5)
    const old = parsePreset(JSON.stringify({ format: 4, style: { enabledHachure: true, wallsLines: false } }))
    expect(old.style.occludeBy).toBe('lines')
    expect(old.style.wallsHachure).toBe(true)
    // A key the plate already carries is kept.
    expect(old.style.wallsLines).toBe(false)
    const now = parsePreset(JSON.stringify({ format: 5, style: { enabledHachure: true } }))
    expect(now.style.occludeBy).toBeUndefined()
    expect(now.style.wallsHachure).toBeUndefined()
  })

  it('gives a mode copy its own mode\'s wall', async () => {
    const { migrateOcclusion } = await import('../../src/utils/presetFile')
    const out = migrateOcclusion({ style: { modeCopies: [{ uid: 'c1', mode: 'Hachure', values: { enabledHachure: true } }] } })
    expect(out.style.modeCopies[0].values.wallsHachure).toBe(true)
  })
})

describe('migrateStrokeBias', () => {
  it('gives a plate before format 6 the old depth test, and leaves 6 alone', async () => {
    const { parsePreset, PRESET_FORMAT } = await import('../../src/utils/presetFile')
    expect(PRESET_FORMAT).toBeGreaterThanOrEqual(6)
    expect(parsePreset(JSON.stringify({ format: 5, style: { showFill: true } })).style.strokeDepthBias).toBe(0)
    expect(parsePreset(JSON.stringify({ format: 2, style: {} })).style.strokeDepthBias).toBe(0)
    expect(parsePreset(JSON.stringify({ format: 6, style: { showFill: true } })).style.strokeDepthBias).toBeUndefined()
  })

  it('keeps a bias the plate already carries', async () => {
    const { migrateStrokeBias } = await import('../../src/utils/presetFile')
    expect(migrateStrokeBias({ style: { strokeDepthBias: 1.5 } }).style.strokeDepthBias).toBe(1.5)
  })
})

describe('repairWaveform', () => {
  it('turns the labels the panel wrote into the values they named, in any format', async () => {
    const { parsePreset } = await import('../../src/utils/presetFile')
    for (const format of [2, PRESET_FORMAT]) {
      const s = parsePreset(JSON.stringify({ format, style: { placeWaveform: 'on line', sidesWaveform: 'one side' } })).style
      expect(s.placeWaveform).toBe('line')
      expect(s.sidesWaveform).toBe('one')
    }
    expect(parsePreset(JSON.stringify({ format: PRESET_FORMAT, style: { sidesWaveform: 'mirrored' } })).style.sidesWaveform).toBe('both')
  })

  it('repairs mode copies, and returns a sound payload as it is', async () => {
    const { repairWaveform } = await import('../../src/utils/presetFile')
    const sound = { style: { placeWaveform: 'row', modeCopies: [{ mode: 'Waveform', values: { sidesWaveform: 'one' } }] } }
    expect(repairWaveform(sound)).toBe(sound)
    const bad = { style: { modeCopies: [{ mode: 'Waveform', values: { placeWaveform: 'on line' } }] } }
    expect(repairWaveform(bad).style.modeCopies[0].values.placeWaveform).toBe('line')
    expect(bad.style.modeCopies[0].values.placeWaveform).toBe('on line')
  })
})

describe('migrateWaveformClip', () => {
  it('keeps the cut for a plate before format 7, and leaves 7 alone', async () => {
    const { parsePreset } = await import('../../src/utils/presetFile')
    expect(PRESET_FORMAT).toBeGreaterThanOrEqual(7)
    expect(parsePreset(JSON.stringify({ format: 6, style: { enabledWaveform: true } })).style.clipWaveform).toBe(true)
    expect(parsePreset(JSON.stringify({ format: 7, style: { enabledWaveform: true } })).style.clipWaveform).toBeUndefined()
  })

  it('reaches Waveform copies, and keeps a value the plate carries', async () => {
    const { migrateWaveformClip } = await import('../../src/utils/presetFile')
    const out = migrateWaveformClip({ style: { clipWaveform: false, modeCopies: [{ mode: 'Waveform', values: {} }, { mode: 'Lines', values: {} }] } })
    expect(out.style.clipWaveform).toBe(false)
    expect(out.style.modeCopies[0].values.clipWaveform).toBe(true)
    expect(out.style.modeCopies[1].values.clipWaveform).toBeUndefined()
  })
})

describe('migrateRisoDots', () => {
  it('keeps the old dots for a plate before format 8, and leaves 8 alone', async () => {
    const { parsePreset } = await import('../../src/utils/presetFile')
    expect(PRESET_FORMAT).toBeGreaterThanOrEqual(8)
    const old = parsePreset(JSON.stringify({ format: 7, style: { enabledRiso: true, weightRiso: 3, opacityRiso: 0.4 } })).style
    expect([old.weightRiso, old.opacityRiso]).toEqual([1, 1])
    const now = parsePreset(JSON.stringify({ format: 8, style: { enabledRiso: true, weightRiso: 3, opacityRiso: 0.4 } })).style
    expect([now.weightRiso, now.opacityRiso]).toEqual([3, 0.4])
  })

  it('reaches Riso copies only', async () => {
    const { migrateRisoDots } = await import('../../src/utils/presetFile')
    const out = migrateRisoDots({ style: { modeCopies: [{ mode: 'Riso', values: { weightRiso: 5 } }, { mode: 'Lines', values: {} }] } })
    expect(out.style.modeCopies[0].values.weightRiso).toBe(1)
    expect(out.style.modeCopies[1].values.weightRiso).toBeUndefined()
  })
})

describe('Riso separations', () => {
  it('take the mode dot size and opacity', async () => {
    const { layerStyle } = await import('../../src/utils/builders/shared')
    for (const id of ['Riso-A', 'Riso-B', 'Riso-C']) {
      const st = layerStyle(id, { weightRiso: 4.5, opacityRiso: 0.3 })
      expect([st.weight, st.opacity]).toEqual([4.5, 0.3])
    }
  })
})

describe('migrateOutrunPens', () => {
  it('keeps the old core and no halo for a plate before format 8, and leaves 8 alone', async () => {
    const { parsePreset } = await import('../../src/utils/presetFile')
    const style = { enabledOutrun: true, weightOutrun: 3, opacityOutrun: 0.5, dashOutrun: 'dashed', glowOpacityOutrun: 0.4 }
    const old = parsePreset(JSON.stringify({ format: 7, style })).style
    expect([old.weightOutrun, old.opacityOutrun, old.dashOutrun, old.glowOpacityOutrun]).toEqual([1, 1, 'solid', 0])
    const now = parsePreset(JSON.stringify({ format: 8, style })).style
    expect([now.weightOutrun, now.opacityOutrun, now.dashOutrun, now.glowOpacityOutrun]).toEqual([3, 0.5, 'dashed', 0.4])
  })

  it('reaches Outrun copies only', async () => {
    const { migrateOutrunPens } = await import('../../src/utils/presetFile')
    const out = migrateOutrunPens({ style: { modeCopies: [{ mode: 'Outrun', values: { glowOpacityOutrun: 0.5 } }, { mode: 'Lines', values: {} }] } })
    expect(out.style.modeCopies[0].values.glowOpacityOutrun).toBe(0)
    expect(out.style.modeCopies[1].values.glowOpacityOutrun).toBeUndefined()
  })
})

describe('Outrun pens', () => {
  it('take the core and halo settings, with an additive halo', async () => {
    const { layerStyle } = await import('../../src/utils/builders/shared')
    const p = { weightOutrun: 1.5, opacityOutrun: 0.9, dashOutrun: 'solid', glowWeightOutrun: 12, glowOpacityOutrun: 0.3 }
    const core = layerStyle('Outrun-Core', p)
    const glow = layerStyle('Outrun-Glow', p)
    expect([core.weight, core.opacity]).toEqual([1.5, 0.9])
    expect([glow.weight, glow.opacity, glow.blending]).toEqual([12, 0.3, 'additive'])
  })
})

describe('migrateCoral', () => {
  it('keeps the crowded growth on a plate before format 11', async () => {
    const { parsePreset, migrateCoral } = await import('../../src/utils/presetFile')
    expect(PRESET_FORMAT).toBeGreaterThanOrEqual(11)
    expect(parsePreset(JSON.stringify({ format: 10, style: { enabledCoral: true } })).style.crowdCoral).toBe(true)
    expect(parsePreset(JSON.stringify({ format: 11, style: { enabledCoral: true } })).style.crowdCoral).toBeUndefined()
    const out = migrateCoral({ style: { modeCopies: [{ mode: 'Coral', values: {} }, { mode: 'Lines', values: {} }] } })
    expect(out.style.modeCopies[0].values.crowdCoral).toBe(true)
    expect(out.style.modeCopies[1].values.crowdCoral).toBeUndefined()
  })
})

describe('migrateScreens', () => {
  it('keeps whole-cell Stipple and plain Riso for a plate before format 9, and leaves 9 alone', async () => {
    const { parsePreset } = await import('../../src/utils/presetFile')
    expect(PRESET_FORMAT).toBeGreaterThanOrEqual(9)
    const old = parsePreset(JSON.stringify({ format: 8, style: { enabledStipple: true, spacingStipple: 0.5 } })).style
    expect([old.snapStipple, old.overprintRiso, old.spacingStipple]).toEqual([true, false, 0.5])
    const now = parsePreset(JSON.stringify({ format: 9, style: { enabledStipple: true, spacingStipple: 0.5 } })).style
    expect([now.snapStipple, now.overprintRiso]).toEqual([undefined, undefined])
  })

  it('reaches Stipple and Riso copies only', async () => {
    const { migrateScreens } = await import('../../src/utils/presetFile')
    const out = migrateScreens({ style: { modeCopies: [{ mode: 'Stipple', values: {} }, { mode: 'Riso', values: {} }, { mode: 'Lines', values: {} }] } })
    expect(out.style.modeCopies[0].values.snapStipple).toBe(true)
    expect(out.style.modeCopies[1].values.overprintRiso).toBe(false)
    expect(out.style.modeCopies[2].values).toEqual({})
  })

  it('multiplies the Riso inks unless overprint is off', async () => {
    const { layerStyle } = await import('../../src/utils/builders/shared')
    expect(layerStyle('Riso-A', {}).blending).toBe('multiply')
    expect(layerStyle('Riso-B', { overprintRiso: false }).blending).toBe('normal')
  })
})

describe('format 10: every ink as picked', () => {
  it('rewrites an older plate\'s line inks as the tone curve drew them', async () => {
    const { parsePreset } = await import('../../src/utils/presetFile')
    const { screenInkHex } = await import('../../src/utils/screenInk')
    const out = parsePreset('{"format":9,"style":{"bgColor":"#050805","colorPrinter":"#39ff6a","hillshadeShadowColor":"#223344"}}')
    expect(out.style.colorPrinter).toBe(screenInkHex('#39ff6a'))
    expect(out.style.colorPrinter).toBe('#b6e3c1')
    // The paper and the surface were never curved, so they stay.
    expect(out.style.bgColor).toBe('#050805')
    expect(out.style.hillshadeShadowColor).toBe('#223344')
    expect('inksAsPicked' in out.style).toBe(false)
  })

  it('leaves a plate that drew as picked alone, and a format 10 plate too', async () => {
    const { parsePreset } = await import('../../src/utils/presetFile')
    const picked = parsePreset('{"format":9,"style":{"inksAsPicked":true,"colorPrinter":"#39ff6a"}}')
    expect(picked.style).toEqual({ colorPrinter: '#39ff6a', crowdCoral: true })
    expect(parsePreset('{"format":10,"style":{"colorPrinter":"#39ff6a"}}').style).toEqual({ colorPrinter: '#39ff6a', crowdCoral: true })
  })

  it('fills the inks a sparse plate leaves out with the curved default', async () => {
    const { softenInks } = await import('../../src/utils/softInks')
    const { STYLE_DEF } = await import('../../src/defaults')
    const { screenInkHex } = await import('../../src/utils/screenInk')
    const out = softenInks({ style: { enabledMineral: true } }).style
    expect(out.colorAMineral).toBe(screenInkHex(STYLE_DEF.colorAMineral))
    // Black is black under the curve, so a black default is not written.
    expect(STYLE_DEF.colorContours).toBe('#000000')
    expect('colorContours' in out).toBe(false)
    expect('bgColor' in out).toBe(false)
  })

  it('curves the gradient only where lines alone read it', async () => {
    const { softenInks } = await import('../../src/utils/softInks')
    const stops = [{ pos: 0, color: '#000080' }, { pos: 1, color: '#00ffff' }]
    const lines = softenInks({ style: { hypsoDag: true }, gradientStops: stops })
    // Blue to cyan bends under the curve, so the ramp takes stops between.
    expect(lines.gradientStops.length).toBeGreaterThan(2)
    expect(softenInks({ style: { hypsoDag: true, fillHypsometric: true }, gradientStops: stops }).gradientStops).toBe(stops)
    expect(softenInks({ style: {}, gradientStops: stops }).gradientStops).toBe(stops)
  })

  it('keeps the blend between curved stops within two levels of the curve', async () => {
    const { curveStops } = await import('../../src/utils/softInks')
    const { sampleGradient, hexToRgb } = await import('../../src/utils/colorUtils')
    const { screenInk } = await import('../../src/utils/screenInk')
    const stops = [{ pos: 0, color: '#000080' }, { pos: 0.25, color: '#00ffff' }, { pos: 0.5, color: '#00ff00' }, { pos: 1, color: '#800000' }]
    const curved = curveStops(stops)
    for (let t = 0; t <= 1; t += 0.01) {
      const got = sampleGradient(curved, t).map((c) => Math.round(c * 255))
      const want = hexToRgb(screenInk(...sampleGradient(stops, t))).map((c) => Math.round(c * 255))
      got.forEach((v, i) => expect(Math.abs(v - want[i]), `t=${t.toFixed(2)}`).toBeLessThanOrEqual(6))
    }
  })

  it('weakens Mineral\'s grain by what the curve kept of it', async () => {
    const { softenInks } = await import('../../src/utils/softInks')
    const out = softenInks({ style: { enabledMineral: true, grainMineral: 0.28 } }).style
    expect(out.grainMineral).toBeGreaterThan(0)
    expect(out.grainMineral).toBeLessThan(0.28)
    expect('grainMineral' in softenInks({ style: { grainMineral: 0.28 } }).style).toBe(true)
  })

  it('no bundled preset carries the old switch', async () => {
    const { readFileSync } = await import('node:fs')
    const names = JSON.parse(readFileSync('public/presets/manifest.json', 'utf8'))
    for (const n of names) {
      const d = JSON.parse(readFileSync(`public/presets/${n}`, 'utf8'))
      expect('inksAsPicked' in (d.style ?? {}), n).toBe(false)
      expect('crowdCoral' in (d.style ?? {}), n).toBe(false)
      expect(d.format, n).toBe(PRESET_FORMAT)
    }
  })
})

describe('sheetSwap', () => {
  const wild = { legendOn: true, frameNorth: true, frameTitleText: 'Wild Terrain', bogus: 1 }
  it('applies a sheet block and remembers what it replaced', () => {
    const { patch, last } = sheetSwap({ legendOn: false, frameNorth: false }, null, wild)
    expect(patch).toEqual({ legendOn: true, frameNorth: true, frameTitleText: 'Wild Terrain' })
    expect(last.before).toEqual({ legendOn: false, frameNorth: false, frameTitleText: undefined })
  })
  it('puts the old values back when the next preset has no block', () => {
    const view = { legendOn: false, frameNorth: false }
    const a = sheetSwap(view, null, wild)
    const b = sheetSwap({ ...view, ...a.patch }, a.last, undefined)
    expect(b.patch).toEqual({ legendOn: false, frameNorth: false, frameTitleText: undefined })
    expect(b.last).toBeNull()
  })
  it('keeps a value you changed after the preset set it', () => {
    const a = sheetSwap({ legendOn: false, frameNorth: false }, null, wild)
    const edited = { ...a.patch, frameNorth: false, frameTitleText: 'My sheet' }
    const b = sheetSwap(edited, a.last, null)
    expect(b.patch).toEqual({ legendOn: false })
  })
  it('does nothing when neither preset letters the sheet', () => {
    expect(sheetSwap({ legendOn: true }, null, null)).toEqual({ patch: {}, last: null })
  })
  it('swaps one lettered look for another from the original values', () => {
    const a = sheetSwap({ legendOn: false, frameNorth: false }, null, wild)
    const b = sheetSwap({ legendOn: false, frameNorth: false, ...a.patch }, a.last, { legendOn: true })
    expect(b.patch).toEqual({ legendOn: true, frameNorth: false, frameTitleText: undefined })
    expect(b.last.before).toEqual({ legendOn: false })
  })
})
