/**
 * Which scene gets picked, and which ones must not be.
 *
 * The network is stubbed rather than reached. A suite that depends on somebody
 * else's uptime reports their bad afternoon as our regression, which is why
 * `masks.spec.js` leaves imagery alone — but the *choosing* is our logic and it
 * is where the bug was, so it is tested here against a fixed catalogue.
 *
 * The case that matters is the last one. A scene whose `visual` asset was never
 * converted to COG still appears in the catalogue, pointing at the original ESA
 * product on `s3://` in JPEG 2000 — and the one such scene over Graz has zero
 * cloud cover, so a sort by cloud alone put the single unreadable scene in the
 * archive at the front of the list every time.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { findScenes } from '../../src/utils/imageryFetch'

const GRAZ = [15.337, 47.002, 15.547, 47.144]
const COG = 'image/tiff; application=geotiff; profile=cloud-optimized'

/** One STAC feature, with whatever `visual` asset the case is about. */
function feature(id, { href, type = COG, cloud = 10, date = '2024-07-15' }) {
  return {
    id,
    assets: href ? { visual: { href, type } } : {},
    properties: { datetime: `${date}T10:00:00Z`, 'eo:cloud_cover': cloud, 'proj:epsg': 32633 },
  }
}

/** Answer the next STAC search with exactly these features. */
function catalogue(features) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ features }),
  })))
}

afterEach(() => vi.unstubAllGlobals())

describe('findScenes', () => {
  it('keeps an HTTPS COG', async () => {
    catalogue([feature('good', { href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/a/TCI.tif' })])
    const out = await findScenes(GRAZ)
    expect(out.map((s) => s.id)).toEqual(['good'])
    expect(out[0].epsg).toBe(32633)
  })

  it('drops a scene served over s3://, whatever its format claims', async () => {
    // No browser fetches this scheme, and the failure surfaced as a console
    // error from inside geotiff.js rather than anywhere this app could explain.
    catalogue([feature('raw', { href: 's3://sentinel-s2-l2a/tiles/33/T/WN/2024/9/1/0/R10m/TCI.jp2', type: 'image/jp2' })])
    expect(await findScenes(GRAZ)).toEqual([])
  })

  it('drops a format geotiff.js cannot decode even over HTTPS', async () => {
    catalogue([feature('jp2', { href: 'https://example.invalid/TCI.jp2', type: 'image/jp2' })])
    expect(await findScenes(GRAZ)).toEqual([])
  })

  it('keeps an asset that states no type at all', async () => {
    // A missing field must not disqualify an otherwise fine COG.
    catalogue([feature('untyped', { href: 'https://example.invalid/TCI.tif', type: undefined })])
    expect(await findScenes(GRAZ)).toHaveLength(1)
  })

  it('does not pick the clearest scene when the clearest scene is unreadable', async () => {
    // The Graz regression, stated as the thing a user saw: one scene in forty,
    // zero cloud, first in the sort, and the only one that cannot be read.
    catalogue([
      feature('S2A_33TWN_20240901_0_L2A', {
        href: 's3://sentinel-s2-l2a/tiles/33/T/WN/2024/9/1/0/R10m/TCI.jp2',
        type: 'image/jp2', cloud: 0,
      }),
      feature('S2B_33TWN_20240906_0_L2A', {
        href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/b/TCI.tif', cloud: 4,
      }),
    ])
    const out = await findScenes(GRAZ)
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('S2B_33TWN_20240906_0_L2A')
  })

  it('asks for the growing season, and falls back rather than returning nothing', async () => {
    // Graz is northern, so the seasonal window is May to September. A catalogue
    // holding only a March scene must still answer with it — an extent that is
    // always cloudy in season is better served late than not at all.
    catalogue([feature('march', { href: 'https://example.invalid/TCI.tif', date: '2024-03-02' })])
    expect(await findScenes(GRAZ)).toHaveLength(1)

    catalogue([
      feature('march', { href: 'https://example.invalid/m.tif', date: '2024-03-02', cloud: 0 }),
      feature('july', { href: 'https://example.invalid/j.tif', date: '2024-07-02', cloud: 30 }),
    ])
    const out = await findScenes(GRAZ)
    expect(out.map((s) => s.id), 'in-season wins over clearer out-of-season').toEqual(['july'])
  })
})
