/**
 * Features into stencils.
 *
 * Three things here are worth holding down, and all three are silent failures.
 *
 * **Holes.** A feature's rings have to be scanned *together*. Filling each ring
 * separately and unioning paints the holes solid, and the result looks correct
 * until the first lake with an island in it.
 *
 * **Winding.** Neither OpenStreetMap nor GeoJSON promises which way round a
 * ring is traced, so a fill that depends on winding cuts some holes and fills
 * others from the same file.
 *
 * **Metres.** A projected raster states its extent in metres and a geographic
 * one in degrees. Reading a degree as a metre does not throw — it produces a
 * corridor a hundred thousand times too wide, which is a filled rectangle.
 */
import { describe, it, expect } from 'vitest'
import {
  canMakeMask, enclosesRegion, featureRings, growMask, maskFromFeatures,
  pixelsPerMetre, simplifyRing, stitchRings,
} from '../../src/utils/maskFromVector'

// A 100 × 100 raster over a hundredth of a degree: one pixel is ~11 m.
const RASTER = { bbox: [0, 0, 0.01, 0.01], crs: 'EPSG:4326', width: 100, height: 100 }

/** Pack features the way `packBucket` does: flat coords, ring and poly indices. */
function pack(features, geom = 'area') {
  const coords = [], rings = [], polys = []
  for (const f of features) {
    polys.push(rings.length)
    for (const ring of f) {
      rings.push(coords.length >> 1)
      for (const [lon, lat] of ring) coords.push(lon, lat)
    }
  }
  rings.push(coords.length >> 1)
  polys.push(rings.length - 1)
  return {
    geom,
    coords: Float64Array.from(coords),
    rings: Int32Array.from(rings),
    polys: Int32Array.from(polys),
  }
}

/** A closed box ring, in degrees, from fractions of the raster extent. */
const box = (a, b, c, d) => [
  [a * 0.01, b * 0.01], [c * 0.01, b * 0.01],
  [c * 0.01, d * 0.01], [a * 0.01, d * 0.01], [a * 0.01, b * 0.01],
]

/** One feature holding one ring — the shape a line or a point arrives as. */
const single = (ring) => [ring]

const countOn = (m) => m.reduce((n, v) => n + v, 0)
/** Row/col are raster pixels; the raster is north-up so row 0 is max latitude. */
const at = (m, col, row) => m[row * 100 + col]

describe('canMakeMask', () => {
  it('refuses a bucket with no coordinates and a raster with no extent', () => {
    expect(canMakeMask(pack([[box(0.2, 0.2, 0.8, 0.8)]]), RASTER)).toBe(true)
    expect(canMakeMask({ coords: [] }, RASTER)).toBe(false)
    expect(canMakeMask(pack([[box(0.2, 0.2, 0.8, 0.8)]]), { ...RASTER, bbox: null })).toBe(false)
  })
})

describe('pixelsPerMetre', () => {
  it('reads degrees from a geographic raster', () => {
    // 0.01° of latitude is 1105.7 m across 100 px.
    expect(pixelsPerMetre(RASTER)).toBeCloseTo(100 / 1105.74, 5)
  })

  it('reads metres from a projected one', () => {
    const utm = { bbox: [491360, 5261430, 495360, 5265430], crs: 'EPSG:32633', width: 400, height: 400 }
    expect(pixelsPerMetre(utm)).toBeCloseTo(0.1, 6)   // 4000 m over 400 px
  })
})

describe('areas', () => {
  it('fills a polygon where the polygon is', () => {
    const m = maskFromFeatures(pack([[box(0.25, 0.25, 0.75, 0.75)]]), RASTER)
    expect(at(m, 50, 50)).toBe(1)
    expect(at(m, 5, 5)).toBe(0)
    // Half the width and half the height of the raster: a quarter of its area.
    expect(countOn(m) / (100 * 100)).toBeCloseTo(0.25, 1)
  })

  it('cuts a hole rather than filling it', () => {
    // The lake-with-an-island case. Outer ring plus an inner one, scanned
    // together — separately they would union and the island would vanish.
    const m = maskFromFeatures(pack([[box(0.2, 0.2, 0.8, 0.8), box(0.4, 0.4, 0.6, 0.6)]]), RASTER)
    expect(at(m, 25, 50), 'inside the outer ring').toBe(1)
    expect(at(m, 50, 50), 'inside the hole').toBe(0)
  })

  it('cuts the hole whichever way round the rings are traced', () => {
    const outer = box(0.2, 0.2, 0.8, 0.8)
    const inner = box(0.4, 0.4, 0.6, 0.6)
    const same = maskFromFeatures(pack([[outer, inner]]), RASTER)
    const opposed = maskFromFeatures(pack([[outer, [...inner].reverse()]]), RASTER)
    expect(Array.from(opposed)).toEqual(Array.from(same))
  })

  it('unions separate features', () => {
    const m = maskFromFeatures(pack([[box(0.1, 0.1, 0.3, 0.3)], [box(0.7, 0.7, 0.9, 0.9)]]), RASTER)
    expect(at(m, 20, 80)).toBe(1)
    expect(at(m, 80, 20)).toBe(1)
    expect(at(m, 50, 50)).toBe(0)
  })

  it('leaves out the features the panel has hidden', () => {
    // Someone who switched three lakes off and then asked for a mask of the
    // lakes did not mean those three.
    const b = pack([[box(0.1, 0.1, 0.3, 0.3)], [box(0.7, 0.7, 0.9, 0.9)]])
    const m = maskFromFeatures(b, RASTER, { hidden: [0] })
    expect(at(m, 20, 80)).toBe(0)
    expect(at(m, 80, 20)).toBe(1)
  })

  it('takes only the features that were picked', () => {
    // The point of the picker: a mask of one district out of seventeen must
    // not require hiding the other sixteen from the drawing.
    const b = pack([[box(0.1, 0.1, 0.3, 0.3)], [box(0.7, 0.7, 0.9, 0.9)]])
    const m = maskFromFeatures(b, RASTER, { only: [1] })
    expect(at(m, 20, 80), 'the one not picked').toBe(0)
    expect(at(m, 80, 20), 'the one picked').toBe(1)
  })

  it('takes a Set as readily as an array', () => {
    const b = pack([[box(0.1, 0.1, 0.3, 0.3)], [box(0.7, 0.7, 0.9, 0.9)]])
    const m = maskFromFeatures(b, RASTER, { only: new Set([0]) })
    expect(at(m, 20, 80)).toBe(1)
    expect(at(m, 80, 20)).toBe(0)
  })

  it('lets an explicit pick outrank the layer’s hidden list', () => {
    // `only` is a decision made against a list that already showed which were
    // hidden, so it is the whole answer once it exists.
    const b = pack([[box(0.1, 0.1, 0.3, 0.3)], [box(0.7, 0.7, 0.9, 0.9)]])
    const m = maskFromFeatures(b, RASTER, { only: [0], hidden: [0] })
    expect(at(m, 20, 80), 'picked, though the layer hides it').toBe(1)
  })

  it('draws nothing when nothing is picked', () => {
    const b = pack([[box(0.1, 0.1, 0.3, 0.3)]])
    expect(countOn(maskFromFeatures(b, RASTER, { only: [] }))).toBe(0)
  })

  it('stitches a multipolygon split across several member ways', () => {
    // A `landuse=forest` relation arrives as its member ways exactly as a
    // boundary does. Filling each separately paints slivers.
    const split = pack([[
      [[0.002, 0.002], [0.008, 0.002]], [[0.008, 0.002], [0.008, 0.008]],
      [[0.008, 0.008], [0.002, 0.008]], [[0.002, 0.008], [0.002, 0.002]],
    ]])
    const m = maskFromFeatures(split, RASTER)
    expect(at(m, 50, 50)).toBe(1)
    expect(countOn(m) / (100 * 100)).toBeCloseTo(0.36, 1)
  })

  it('clips at the raster edge instead of wrapping', () => {
    const m = maskFromFeatures(pack([[box(-0.5, -0.5, 0.5, 0.5)]]), RASTER)
    expect(at(m, 5, 95)).toBe(1)
    expect(at(m, 95, 5), 'the far corner must stay clear').toBe(0)
  })
})

describe('stitchRings', () => {
  /** A box cut into `n` open segments, the way Overpass returns a relation. */
  const segments = () => {
    const c = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
    return [
      Float64Array.from([...c[0], ...c[1]]),
      Float64Array.from([...c[1], ...c[2]]),
      Float64Array.from([...c[2], ...c[3]]),
      Float64Array.from([...c[3], ...c[4]]),
    ]
  }

  it('joins open segments that share endpoints into one closed loop', () => {
    // The real case: Jakomini, one of Graz's seventeen districts, arrives as
    // seven open ways and not one of them is closed.
    const out = stitchRings(segments())
    expect(out).toHaveLength(1)
    expect(out[0].closed).toBe(true)
  })

  it('flips a segment that meets the tail backwards', () => {
    // A relation lists members in whatever order the mapper added them, and
    // nothing says they run the same way round.
    const segs = segments()
    segs[2] = Float64Array.from([0, 10, 10, 10])    // reversed
    const out = stitchRings(segs)
    expect(out).toHaveLength(1)
    expect(out[0].closed).toBe(true)
  })

  it('leaves an already-closed ring alone', () => {
    const ring = Float64Array.from([0, 0, 10, 0, 10, 10, 0, 10, 0, 0])
    const out = stitchRings([ring])
    expect(out).toHaveLength(1)
    expect(out[0].closed).toBe(true)
    expect(out[0].pts).toBe(ring)
  })

  it('reports a genuinely open chain as open rather than forcing it shut', () => {
    const segs = segments()
    segs.pop()                                      // one side missing
    const out = stitchRings(segs)
    expect(out.every((l) => !l.closed)).toBe(true)
  })

  it('keeps two separate rings separate', () => {
    // Exact endpoint matching, not a tolerance: two districts that merely pass
    // close to one another must not be welded into one.
    const a = Float64Array.from([0, 0, 1, 0, 1, 1, 0, 1, 0, 0])
    const b = Float64Array.from([5, 5, 6, 5, 6, 6, 5, 6, 5, 5])
    expect(stitchRings([a, b])).toHaveLength(2)
  })
})

describe('enclosesRegion', () => {
  it('is true for a boundary made of open segments', () => {
    // Read off the geometry, not off `geom`: `geom` says how a layer is drawn,
    // and an administrative boundary is drawn as a line while being an area.
    const b = pack([[
      [[0, 0], [0.01, 0]], [[0.01, 0], [0.01, 0.01]],
      [[0.01, 0.01], [0, 0.01]], [[0, 0.01], [0, 0]],
    ]], 'line')
    expect(enclosesRegion(b)).toBe(true)
  })

  it('is false for a road', () => {
    expect(enclosesRegion(pack([single([[0, 0], [0.01, 0.005]])], 'line'))).toBe(false)
  })
})

describe('a line layer that closes', () => {
  /** A municipality: a box delivered as four open segments. */
  const boundary = () => pack([[
    [[0.002, 0.002], [0.008, 0.002]], [[0.008, 0.002], [0.008, 0.008]],
    [[0.008, 0.008], [0.002, 0.008]], [[0.002, 0.008], [0.002, 0.002]],
  ]], 'line')

  it('fills by default rather than tracing its own outline', () => {
    // The bug a user hit: a mask of a municipality came back as the contour.
    const m = maskFromFeatures(boundary(), RASTER, { geom: 'line' })
    expect(at(m, 50, 50), 'the middle has to be inside').toBe(1)
    expect(countOn(m) / (100 * 100)).toBeCloseTo(0.36, 1)
  })

  it('traces the corridor when fill is switched off', () => {
    // Still worth having: "within fifty metres of the border" is a real mask.
    const m = maskFromFeatures(boundary(), RASTER, { geom: 'line', fill: false, widthM: 22 })
    expect(at(m, 50, 50), 'the middle is outside a corridor').toBe(0)
    expect(at(m, 20, 50), 'the border itself is inside it').toBe(1)
  })

  it('still strokes a line that does not close', () => {
    const m = maskFromFeatures(pack([single([[0.001, 0.005], [0.009, 0.005]])], 'line'),
      RASTER, { geom: 'line', widthM: 30 })
    expect(at(m, 50, 50)).toBe(1)
    expect(countOn(m) / (100 * 100)).toBeLessThan(0.3)
  })

  it('buffers a filled boundary outwards on request', () => {
    const plain = maskFromFeatures(boundary(), RASTER, { geom: 'line' })
    const grown = maskFromFeatures(boundary(), RASTER, { geom: 'line', grow: 110 })
    expect(countOn(grown)).toBeGreaterThan(countOn(plain))
  })
})

describe('lines', () => {
  it('strokes a corridor of about the width asked for', () => {
    // A horizontal line across the middle, 110 m wide — ten pixels, so five
    // either side of the centre.
    const line = [single([[0.001, 0.005], [0.009, 0.005]])]
    const m = maskFromFeatures(pack(line, 'line'), RASTER, { geom: 'line', widthM: 55 })
    expect(at(m, 50, 50)).toBe(1)
    expect(at(m, 50, 47)).toBe(1)
    expect(at(m, 50, 30), 'well outside the corridor').toBe(0)
  })

  it('does not leave gaps between the reported points', () => {
    const line = [single([[0.001, 0.005], [0.009, 0.005]])]
    const m = maskFromFeatures(pack(line, 'line'), RASTER, { geom: 'line', widthM: 30 })
    let gaps = 0
    for (let c = 15; c < 85; c++) if (!at(m, c, 50)) gaps++
    expect(gaps, 'a corridor must not be dotted').toBe(0)
  })

  it('reads the extent in the raster’s own units', () => {
    // The failure this guards is not subtle once it happens: treating the
    // degrees of a geographic bbox as metres makes every corridor fill the
    // whole raster.
    const line = [single([[0.001, 0.005], [0.009, 0.005]])]
    const m = maskFromFeatures(pack(line, 'line'), RASTER, { geom: 'line', widthM: 55 })
    expect(countOn(m) / (100 * 100)).toBeLessThan(0.3)
  })
})

describe('points', () => {
  it('stamps one disc per coordinate', () => {
    const pts = [single([[0.002, 0.008]]), single([[0.008, 0.002]])]
    const m = maskFromFeatures(pack(pts, 'point'), RASTER, { geom: 'point', widthM: 44 })
    expect(at(m, 20, 20)).toBe(1)
    expect(at(m, 80, 80)).toBe(1)
    expect(at(m, 50, 50)).toBe(0)
  })
})

describe('growMask', () => {
  const dot = () => {
    const d = new Uint8Array(100 * 100)
    d[50 * 100 + 50] = 1
    return d
  }

  it('grows a round patch, not a square one', () => {
    const d = dot()
    growMask(d, 100, 100, 10)
    expect(at(d, 60, 50), 'on the axis, at the radius').toBe(1)
    expect(at(d, 58, 58), 'the corner of the bounding box stays clear').toBe(0)
    // πr² = 314, rasterised at pixel centres.
    expect(countOn(d)).toBeGreaterThan(280)
    expect(countOn(d)).toBeLessThan(350)
  })

  it('shrinks on a negative radius', () => {
    const d = new Uint8Array(100 * 100).fill(0)
    for (let r = 30; r < 70; r++) for (let c = 30; c < 70; c++) d[r * 100 + c] = 1
    growMask(d, 100, 100, -5)
    expect(at(d, 50, 50)).toBe(1)
    expect(at(d, 31, 50), 'the old edge is eaten back').toBe(0)
  })

  it('does nothing at all below half a pixel', () => {
    const d = dot()
    const before = Array.from(d)
    growMask(d, 100, 100, 0.2)
    expect(Array.from(d)).toEqual(before)
  })

  it('survives an empty mask and a full one', () => {
    const empty = new Uint8Array(100 * 100)
    growMask(empty, 100, 100, 5)
    expect(countOn(empty)).toBe(0)
    const full = new Uint8Array(100 * 100).fill(1)
    growMask(full, 100, 100, 5)
    expect(countOn(full)).toBe(100 * 100)
  })
})

describe('featureRings', () => {
  /** A municipality: a box delivered as four open segments. */
  const boundary = () => pack([[
    [[0.002, 0.002], [0.008, 0.002]], [[0.008, 0.002], [0.008, 0.008]],
    [[0.008, 0.008], [0.002, 0.008]], [[0.002, 0.008], [0.002, 0.002]],
  ]], 'line')

  it('hands back a closed ring in raster pixels', () => {
    // What Edit Mode clips to. Pixels, not degrees: the shape lives in source
    // pixel coordinates alongside the crop rect and the feather.
    const [ring] = featureRings(boundary(), RASTER)
    expect(ring.length).toBeGreaterThanOrEqual(8)
    for (let i = 0; i < ring.length; i += 2) {
      expect(ring[i]).toBeGreaterThanOrEqual(0)
      expect(ring[i]).toBeLessThanOrEqual(100)
    }
  })

  it('skips anything that does not close', () => {
    // A road cannot clip a heightmap, and saying so here is what lets the
    // panel grey the button rather than produce an empty raster.
    expect(featureRings(pack([single([[0.001, 0.005], [0.009, 0.005]])], 'line'), RASTER))
      .toHaveLength(0)
  })

  it('keeps holes as their own rings', () => {
    const withHole = pack([[box(0.2, 0.2, 0.8, 0.8), box(0.4, 0.4, 0.6, 0.6)]])
    expect(featureRings(withHole, RASTER)).toHaveLength(2)
  })

  it('honours the pick', () => {
    const two = pack([[box(0.1, 0.1, 0.3, 0.3)], [box(0.7, 0.7, 0.9, 0.9)]])
    expect(featureRings(two, RASTER)).toHaveLength(2)
    expect(featureRings(two, RASTER, { only: [1] })).toHaveLength(1)
  })
})

describe('simplifyRing', () => {
  it('drops points that lie on the line between their neighbours', () => {
    const pts = []
    for (let i = 0; i <= 100; i++) pts.push(i, 0)      // a dead straight run
    for (let i = 100; i >= 0; i--) pts.push(i, 40)
    const out = simplifyRing(Float64Array.from(pts), 0.34)
    expect(out.length).toBeLessThan(pts.length / 5)
  })

  it('keeps the corners that carry the shape', () => {
    const box4 = Float64Array.from([0, 0, 50, 0, 50, 50, 0, 50, 0, 0])
    expect(simplifyRing(box4, 0.34).length).toBe(box4.length)
  })

  it('survives a ring long enough to overflow a recursive implementation', () => {
    // A coastline or a river-following border is tens of thousands of nearly
    // collinear points, which is exactly the input that recurses once per
    // point. This must not throw.
    const pts = []
    for (let i = 0; i < 60000; i++) pts.push(i * 0.001, Math.sin(i * 0.0001) * 0.4)
    pts.push(pts[0], pts[1])
    expect(() => simplifyRing(Float64Array.from(pts), 0.34)).not.toThrow()
  })
})
