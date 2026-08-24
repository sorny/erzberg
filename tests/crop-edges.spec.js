import { test, expect } from '@playwright/test'

/**
 * Crop-edge behaviour of the draw modes.
 *
 * A clipped selection leaves the grid with holes, and the raster stores 0 in
 * them — the darkest possible ground, which maps to the very bottom of the
 * scene. Anything that read those zeros as terrain drew the edge of the
 * selection instead of the landscape: strokes plunging to the base (they read as
 * pillars), a sagging rim under blur, phantom crests tracing the outline.
 *
 * These run the real builders in the page, through the dev server's module
 * graph — the subject is the geometry, so nothing here touches the UI.
 */

const PAGE = 'http://localhost:5173'

/**
 * Builds a synthetic terrain under `shape` (null = a plain rect crop, the
 * control) and reports per-mode segment and plunge counts.
 *
 * The terrain is a dome with a pit that bottoms out at brightness 0, so its own
 * minimum sits exactly where NoData would drape a stroke. That is what makes
 * the artifact visible at all: with a higher minimum the elevation cut culled
 * the plunging segments instead of the geometry never producing them.
 */
async function measure(page, shape) {
  return page.evaluate(async (shape) => {
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
    const { buildEditMask, applyEdit } = await import('/src/utils/heightmapEdit.js')

    const W = 128, H = 128
    const px = new Float32Array(W * H), srcMask = new Uint8Array(W * H).fill(1)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2)
      let v = 0.35 + 0.6 * Math.exp(-(dx * dx + dy * dy) * 1.5)
      const pd = Math.hypot(x - 55, y - 58)
      if (pd < 6) v = Math.max(0, v * (pd / 6) ** 2)      // the pit
      px[y * W + x] = v
    }

    const base = {
      resolution: 1, blurRadius: 0, gridOffsetX: 0, gridOffsetY: 0,
      blackPoint: 0, whitePoint: 255, elevScale: 1,
      elevMinCut: 0, elevMaxCut: 100, jitterAmt: 0,
      showMirrorPlusX: true, showMirrorPlusY: true, showMirrorPlusZ: true,
      spacingLines: 4, shiftLines: 0, spacingCross: 4,
      spacingEngrave: 3, levelsEngrave: 3, sunAzimuthEngrave: 315, gammaEngrave: 1,
      spacingFlow: 10, stepFlow: 1, maxLenFlow: 100,
      spacingSwiss: 2, thresholdSwiss: 0.45, lengthSwiss: 1, screeSwiss: 0.5, seedSwiss: 42,
    }

    const edit = { rect: { x: 24, y: 34, w: 81, h: 61 }, shape, feather: 0 }
    const out = applyEdit({ pixels: px, mask: srcMask, width: W, height: H },
                          edit, buildEditMask(edit, srcMask, W, H))
    const t = buildTerrain(out.pixels, out.mask, out.width, out.height, base)

    let holes = 0
    for (const m of t.gridMask) if (!m) holes++
    const relief = t.maxElev - t.minElev

    const modes = {
      Lines:   { enabledLines: true,   colorLines: '#000',   angleLines: 30 },
      Cross:   { enabledCross: true,   colorCross: '#000',   angleCross: 23 },
      Engrave: { enabledEngrave: true, colorEngrave: '#000', angleEngrave: 45 },
      Flow:    { enabledFlow: true,    colorFlow: '#000' },
      Swiss:   { enabledSwiss: true,   colorSwiss: '#000' },
      // Isophotes read the light rather than the ground, and light is a slope —
      // so the step down into a hole is the brightest edge on the terrain and
      // would ring the whole selection if the mask were not honoured.
      Iso:     { enabledIso: true,     colorIso: '#000' },
    }
    const stats = { holes, relief }
    for (const [name, cfg] of Object.entries(modes)) {
      let segs = 0, plunge = 0
      for (const layer of buildLineGeometry(t, { ...base, ...cfg })) {
        const pos = layer.positions
        segs += pos.length / 6
        // A segment dropping more than a third of the whole relief between its
        // two ends is a wall, not a slope.
        for (let i = 0; i < pos.length; i += 6) {
          if (Math.abs(pos[i + 1] - pos[i + 4]) > relief / 3) plunge++
        }
      }
      stats[name] = { segs, plunge }
    }
    return stats
  }, shape)
}

test('a clipped selection does not fringe the draw modes with plunging strokes', async ({ page }) => {
  await page.goto(PAGE)
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  const clipped = await measure(page, { type: 'ellipse', cx: 64, cy: 64, rx: 40, ry: 30 })
  const solid   = await measure(page, null)

  expect(clipped.holes, 'the ellipse must actually clip the grid').toBeGreaterThan(500)
  expect(solid.holes, 'the plain rect crop is the control — no holes').toBe(0)

  for (const mode of ['Lines', 'Cross', 'Engrave', 'Flow', 'Iso']) {
    expect(clipped[mode].segs, `${mode} must still draw`).toBeGreaterThan(50)
    // The pit is the only wall on this terrain and these modes step over it
    // rather than down it, so the honest count is zero.
    expect(clipped[mode].plunge, `${mode} drops strokes to the base at the clip`).toBe(0)
  }

  // Swiss hachures DO run down the pit wall, so its count is not zero — what
  // matters is that clipping adds none of its own.
  expect(clipped.Swiss.plunge,
         'clipping must not add plunging cliff strokes').toBeLessThanOrEqual(solid.Swiss.plunge)
})

test('blur is taken over valid ground only, so a clipped edge does not sag', async ({ page }) => {
  await page.goto(PAGE)
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  const sag = await page.evaluate(async () => {
    const { boxBlur, buildTerrain } = await import('/src/utils/terrain.js')
    // A flat plateau, right half masked away. Blurred honestly it stays flat
    // right up to the cut; blurred against the NoData zeros it ramps down.
    const W = 64, H = 8
    const px = new Float32Array(W * H).fill(0.8)
    const mask = new Uint8Array(W * H).fill(1)
    for (let y = 0; y < H; y++) for (let x = 32; x < W; x++) { mask[y * W + x] = 0; px[y * W + x] = 0 }

    const plain  = boxBlur(px, W, H, 4)
    const masked = boxBlur(px, W, H, 4, mask)
    const t = buildTerrain(px, mask, W, H, {
      resolution: 1, blurRadius: 4, gridOffsetX: 0, gridOffsetY: 0,
      blackPoint: 0, whitePoint: 255, elevScale: 1,
    })
    const row = 4
    return {
      plainAtEdge:  plain[row * W + 31],
      maskedAtEdge: masked[row * W + 31],
      maskedInVoid: masked[row * W + 40],
      hasNoData: t.hasNoData,
      gridAtEdge: t.grid[4 * t.cols + 31],
    }
  })

  expect(sag.hasNoData, 'the half-masked raster must report holes').toBe(true)
  expect(sag.plainAtEdge, 'control: the unmasked blur does sag').toBeLessThan(0.6)
  expect(sag.maskedAtEdge, 'the last valid cell keeps its height').toBeCloseTo(0.8, 5)
  expect(sag.maskedInVoid, 'NoData stays NoData — no invented ground').toBe(0)
  expect(sag.gridAtEdge, 'and buildTerrain carries that through').toBeCloseTo(0.8, 5)
})
