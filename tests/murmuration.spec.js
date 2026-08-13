import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// The Soundscapes fixture: 6 s mono, a 120 Hz→8 kHz sweep over a 300 Hz drone
// with 1.5 kHz bursts once a second — so it has bass, air and onsets.
const MP3 = path.join(path.dirname(fileURLToPath(import.meta.url)), 'testdata', 'sweep.mp3')

// Switch inputs are display:none inside a label that is a *sibling* of the text
// span, so clicking the label text does nothing — walk from the span instead.
const toggleFor = (page, label) =>
  page.locator(`xpath=//span[text()="${label}"]/following-sibling::label`)

// TogColor puts its switch one level deeper, alongside the colour swatch.
const togColorFor = (page, label) =>
  page.locator(`xpath=//span[text()="${label}"]/following-sibling::div//label`)

async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })
  const t = page.locator('[data-testid="sidebar-toggle"]')
  if ((await t.innerText()) === '◀') { await t.click(); await page.waitForTimeout(400) }
  await page.waitForTimeout(1500)
}

/** Downsampled fingerprint of the canvas — see tests/rendering.spec.js. */
const frameSig = (page) => page.evaluate(() => {
  const c = document.querySelector('canvas')
  const off = document.createElement('canvas')
  off.width = 200; off.height = 100
  const ctx = off.getContext('2d')
  ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, 200, 100)
  const d = ctx.getImageData(0, 0, 200, 100).data
  const sig = []
  for (let i = 0; i < d.length; i += 4) if ((i / 4) % 37 === 0) sig.push(d[i], d[i + 1], d[i + 2])
  return sig.join(',')
})

/**
 * The simulation is pure and the dev server serves source, so it can be driven
 * directly rather than inferred from pixels — the same trick tests/rendering.spec.js
 * uses on buildTerrain. Builds a synthetic 64×64 cone and flies a flock over it.
 */
const runSim = (page, opts) => page.evaluate(async ({ n, seed, frames, dt, params }) => {
  const { makeTerrainField, createFlock, stepFlock, flockScales } =
    await import('/src/utils/murmuration.js')

  const rows = 64, cols = 64, scl = 4
  const grid = new Float32Array(rows * cols)
  const gridMask = new Uint8Array(rows * cols).fill(1)
  const gridSlopes = new Float32Array(rows * cols)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    grid[r * cols + c] = Math.max(0, 1 - Math.hypot(r - 32, c - 32) / 32)
  }
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const b = grid[r * cols + c]
    gridSlopes[r * cols + c] = Math.hypot(grid[r * cols + c + 1] - b, grid[(r + 1) * cols + c] - b)
  }
  const terrain = {
    grid, gridMask, gridSlopes, rows, cols, scl,
    halfW: ((cols - 1) * scl) / 2, halfH: ((rows - 1) * scl) / 2,
  }

  const field = makeTerrainField(terrain, 1, 0)
  const s = flockScales(field, params)
  const flock = createFlock(n, seed, field, params)
  for (let i = 0; i < frames; i++) stepFlock(flock, dt, field, params)

  let nonFinite = 0, underground = 0, escaped = 0, tooSlow = 0, tooFast = 0
  let cx = 0, cz = 0
  for (let i = 0; i < flock.n; i++) {
    const j = i * 3
    const x = flock.pos[j], y = flock.pos[j + 1], z = flock.pos[j + 2]
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) { nonFinite++; continue }
    if (y < field.heightAt(x, z) - 1e-3) underground++
    if (Math.abs(x) > field.halfW * 2 || Math.abs(z) > field.halfH * 2) escaped++
    const sp = Math.hypot(flock.vel[j], flock.vel[j + 1], flock.vel[j + 2])
    if (sp < s.minSpeed - 1e-3) tooSlow++
    if (sp > s.maxSpeed + 1e-3) tooFast++
    cx += x; cz += z
  }
  cx /= flock.n; cz /= flock.n
  let spread = 0
  for (let i = 0; i < flock.n; i++) spread += (flock.pos[i * 3] - cx) ** 2 + (flock.pos[i * 3 + 2] - cz) ** 2
  spread = Math.sqrt(spread / flock.n)

  return {
    nonFinite, underground, escaped, tooSlow, tooFast, spread,
    span: field.span, pos: Array.from(flock.pos),
  }
}, opts)

const DEFAULTS = {
  speed: 1, cohesion: 1, alignment: 1.2, separation: 1.5, perception: 1,
  roost: 1, roostHeight: 1, clearance: 1, lift: 1, turbulence: 0.5, trail: 1,
  predator: false, predatorFear: 1,
}

test('the flock stays finite, above ground, on the map and in flight', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  // With the predator on: it is the strongest force in the simulation by an
  // order of magnitude, so if anything is going to fling a bird to infinity or
  // through a mountain, it is this.
  const r = await runSim(page, {
    n: 800, seed: 42, frames: 600, dt: 1 / 60,
    params: { ...DEFAULTS, predator: true },
  })
  console.log(`flock after 600 frames: ${JSON.stringify({ ...r, pos: undefined })}`)

  expect(r.nonFinite, 'no NaN/Infinity positions').toBe(0)
  // The steering term can be outrun on a cliff; the hard floor in the integrator
  // is what makes this an invariant rather than a tendency.
  expect(r.underground, 'no bird below the terrain').toBe(0)
  expect(r.escaped, 'no bird outside twice the terrain extent').toBe(0)
  // Birds never stop. Without the speed floor a murmuration settles into a
  // stationary cloud, which is the failure that looks least like a bug.
  expect(r.tooSlow, 'no bird below minimum speed').toBe(0)
  expect(r.tooFast, 'no bird above maximum speed').toBe(0)
  // Still a flock, not a smear across the whole map nor a single point.
  expect(r.spread).toBeGreaterThan(r.span * 0.02)
  expect(r.spread).toBeLessThan(r.span * 0.5)
})

test('same seed, same flock — at any frame rate', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  const a = await runSim(page, { n: 200, seed: 7, frames: 180, dt: 1 / 60, params: DEFAULTS })
  const b = await runSim(page, { n: 200, seed: 7, frames: 180, dt: 1 / 60, params: DEFAULTS })
  expect(b.pos, 'a seed must reproduce exactly').toEqual(a.pos)

  const c = await runSim(page, { n: 200, seed: 8, frames: 180, dt: 1 / 60, params: DEFAULTS })
  expect(c.pos, 'a different seed must produce a different flock').not.toEqual(a.pos)

  // Half the frames at twice the delta must land in the same place: the step
  // consumes time in fixed 1/60 s substeps precisely so the flock is not a
  // function of the machine it is running on.
  const d = await runSim(page, { n: 200, seed: 7, frames: 90, dt: 1 / 30, params: DEFAULTS })
  for (let i = 0; i < a.pos.length; i++) {
    expect(Math.abs(d.pos[i] - a.pos[i]), `component ${i} diverged with the timestep`).toBeLessThan(1e-3)
  }
})

test('murmuration mode animates on screen, and freezes when told to', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openApp(page)

  await page.locator('[data-testid="section-particles"]').click()
  const on = togColorFor(page, 'Particles')
  await on.click({ force: true })
  await expect(on.locator('input')).toBeChecked()
  await page.locator('[data-testid="particle-mode-murmuration"]').click()
  await page.waitForTimeout(1500)

  const a = await frameSig(page)
  await page.waitForTimeout(1200)
  const b = await frameSig(page)
  expect(b, 'the flock must be moving').not.toBe(a)

  // Pausing must stop the simulation *and* stop asking for frames. This is the
  // direct regression test for the frameloop="demand" gating bug class: a field
  // that keeps calling invalidate() while frozen pins the renderer at 60fps
  // drawing an identical picture.
  await page.locator('[data-testid="flock-pause"]').click()
  await page.waitForTimeout(800)
  const c = await frameSig(page)
  await page.waitForTimeout(1200)
  expect(await frameSig(page), 'a frozen flock must not move').toBe(c)

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})

test('shadows fall only on real terrain, never on empty space', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  const r = await page.evaluate(async () => {
    const { makeTerrainField, createFlock, stepFlock } = await import('/src/utils/murmuration.js')
    const rows = 128, cols = 128, scl = 4
    const grid = new Float32Array(rows * cols)
    const gridMask = new Uint8Array(rows * cols).fill(1)
    const gridSlopes = new Float32Array(rows * cols)
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      grid[y * cols + x] = Math.max(0, 1 - Math.hypot(y - 64, x - 64) / 64)
    }
    // A lasso-shaped hole, the case that used to draw shadows on nothing.
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (Math.hypot(y - 64, x - 40) < 18) { gridMask[y * cols + x] = 0; grid[y * cols + x] = 0 }
    }
    for (let y = 0; y < rows - 1; y++) for (let x = 0; x < cols - 1; x++) {
      const b = grid[y * cols + x]
      gridSlopes[y * cols + x] = Math.hypot(grid[y * cols + x + 1] - b, grid[(y + 1) * cols + x] - b)
    }
    const terrain = { grid, gridMask, gridSlopes, rows, cols, scl,
      halfW: ((cols - 1) * scl) / 2, halfH: ((rows - 1) * scl) / 2 }
    const field = makeTerrainField(terrain, 1, 0)

    // A 10° sun throws shadows their maximum distance — the case that used to
    // fling them off the side of the raster.
    const params = { shadow: true, predator: true, sunAzimuth: 315, sunAltitude: 10, roost: 0.4 }
    const flock = createFlock(3000, 42, field, params)
    for (let i = 0; i < 900; i++) stepFlock(flock, 1 / 60, field, params)

    let drawn = 0, culled = 0, offGrid = 0, overHole = 0, floating = 0
    for (let i = 0; i < flock.n; i++) {
      if (flock.shadowLift[i] < 0) { culled++; continue }
      drawn++
      const j = i * 3
      const sx = flock.shadow[j], sy = flock.shadow[j + 1], sz = flock.shadow[j + 2]
      const fc = (sx + field.halfW) / scl, fr = (sz + field.halfH) / scl
      if (fc < 0 || fr < 0 || fc > cols - 1 || fr > rows - 1) { offGrid++; continue }
      // "Real ground" is sampleBilinear's definition — a 2×2 footprint with at
      // least one valid corner — which is the rule every draw mode has used
      // since 0.9.7. A shadow on the rim of a cut is on ground that is there.
      const r0 = Math.floor(fr), c0 = Math.floor(fc)
      const r1 = Math.min(rows - 1, r0 + 1), c1 = Math.min(cols - 1, c0 + 1)
      if (!(gridMask[r0 * cols + c0] || gridMask[r0 * cols + c1] ||
            gridMask[r1 * cols + c0] || gridMask[r1 * cols + c1])) overHole++
      const g = field.groundAt(sx, sz)
      if (!Number.isNaN(g) && Math.abs(sy - g) > 30) floating++
    }
    return { drawn, culled, offGrid, overHole, floating }
  })
  console.log(`shadows: ${JSON.stringify(r)}`)

  expect(r.offGrid, 'no shadow past the edge of the raster').toBe(0)
  expect(r.overHole, 'no shadow inside a hole cut out of the raster').toBe(0)
  expect(r.floating, 'no shadow hanging above the ground it fell on').toBe(0)
  // The culling must be real, not the result of drawing nothing at all.
  expect(r.culled, 'a low sun over a holed raster must cull some').toBeGreaterThan(100)
  expect(r.drawn, 'most of the flock must still have a shadow').toBeGreaterThan(r.culled)
})

/**
 * Drives audioFeatures against a spectrogram built to order, so each assertion
 * is about one property of the analysis rather than about a particular mp3.
 * `shape(frame, bin)` returns the stored 0…1 magnitude.
 */
const runAudio = (page, opts) => page.evaluate(async ({ shapeSrc, seconds, dt, playing }) => {
  const { makeBandPlan, createAudioState, sampleAudio, applyAudio } =
    await import('/src/utils/audioFeatures.js')

  const bins = 128, frames = 600, fftSize = 2048, sampleRate = 44100
  const hop = fftSize / 4
  const shape = new Function('f', 'b', 'bins', shapeSrc)
  const data = new Float32Array(frames * bins)
  for (let f = 0; f < frames; f++) for (let b = 0; b < bins; b++) {
    data[f * bins + b] = shape(f, b, bins)
  }
  const spec = { data, frames, bins, hop, sampleRate, fftSize, logFreq: true,
                 duration: (frames * hop) / sampleRate }

  const plan = makeBandPlan(spec)
  const state = createAudioState()
  const trace = []
  for (let t = 0; t < seconds; t += dt) {
    sampleAudio(spec, plan, state, t, dt, playing)
    trace.push({ level: state.level, bass: state.env[0], mid: state.env[1],
                 high: state.env[2], startle: state.startle })
  }
  const last = trace[trace.length - 1]
  const peakStartle = Math.max(...trace.map(x => x.startle))
  // applyAudio is a pure transform on the way into the simulation.
  const base = { speed: 1, cohesion: 1, separation: 1.5, turbulence: 0.5,
                 predator: true, predatorFear: 1 }
  const off = applyAudio(base, last, {})
  const on  = applyAudio(base, { ...last, level: 1, bass: 1, high: 1, startle: 1 },
                         { speed: 1, pulse: 1, shimmer: 1, startle: 1 })
  return { last, peakStartle, off, on, bandRanges: plan.ranges }
}, opts)

test('the flock hears bands, onsets and silence', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=erzberg', { timeout: 30000 })

  // Log-spaced bins put the low frequencies in the first rows. Energy only
  // there must read as bass and not as air.
  const low = await runAudio(page, {
    shapeSrc: 'return b < bins * 0.12 ? 0.9 : 0.02', seconds: 2, dt: 1 / 60, playing: true,
  })
  expect(low.last.bass, 'low-frequency energy must reach the bass band').toBeGreaterThan(0.7)
  expect(low.last.high, 'and must not leak into the high band').toBeLessThan(0.3)

  const high = await runAudio(page, {
    shapeSrc: 'return b > bins * 0.75 ? 0.9 : 0.02', seconds: 2, dt: 1 / 60, playing: true,
  })
  expect(high.last.high, 'high-frequency energy must reach the high band').toBeGreaterThan(0.7)
  expect(high.last.bass, 'and must not leak into the bass band').toBeLessThan(0.3)

  // A steady tone has no attacks in it; a repeating broadband hit is all attack.
  const steady = await runAudio(page, {
    shapeSrc: 'return 0.6', seconds: 3, dt: 1 / 60, playing: true,
  })
  const beats = await runAudio(page, {
    shapeSrc: 'return (f % 40) < 3 ? 0.95 : 0.05', seconds: 3, dt: 1 / 60, playing: true,
  })
  console.log(`startle — steady ${steady.peakStartle.toFixed(3)}, beats ${beats.peakStartle.toFixed(3)}`)
  expect(beats.peakStartle, 'onsets must fire the startle envelope').toBeGreaterThan(0.5)
  expect(steady.peakStartle, 'a steady tone must not').toBeLessThan(0.2)

  // Auto-gain: a track 20 dB quieter still moves the flock, because the peak
  // follower is relative to the track's own recent loudest.
  const quiet = await runAudio(page, {
    shapeSrc: 'return b < bins * 0.12 ? 0.09 : 0.002', seconds: 2, dt: 1 / 60, playing: true,
  })
  expect(quiet.last.bass, 'a quiet track must still drive the flock').toBeGreaterThan(0.7)

  // Paused playback releases toward silence rather than freezing mid-gesture.
  const paused = await runAudio(page, {
    shapeSrc: 'return 0.9', seconds: 3, dt: 1 / 60, playing: false,
  })
  expect(paused.last.level, 'a stopped track must decay to silence').toBeLessThan(0.01)

  // applyAudio must be inert at zero and move each target the right way at one.
  expect(low.off.speed).toBe(1)
  expect(low.off.separation).toBe(1.5)
  expect(low.off.turbulence).toBe(0.5)
  expect(low.on.speed, 'loud must fly faster').toBeGreaterThan(1)
  expect(low.on.separation, 'bass must open the flock out').toBeGreaterThan(1.5)
  expect(low.on.cohesion, 'and ease cohesion at the same time').toBeLessThan(1)
  expect(low.on.turbulence, 'highs must add shimmer').toBeGreaterThan(0.5)
  expect(low.on.predatorFear, 'onsets must widen the fear radius').toBeGreaterThan(1)
})

test('a track loaded from the Particles panel drives the live flock', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await openApp(page)

  await page.locator('[data-testid="section-particles"]').click()
  await togColorFor(page, 'Particles').click({ force: true })
  await page.locator('[data-testid="particle-mode-murmuration"]').click()
  await page.waitForTimeout(1500)

  await toggleFor(page, 'React to audio').click({ force: true })
  // With nothing loaded the block says so rather than pretending to listen.
  await expect(page.locator('text=No track loaded')).toBeVisible()

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('text=↑ Load audio'),
  ])
  await chooser.setFiles(MP3)
  // Analysis done when the warning gives way to the transport and the sliders.
  await expect(page.locator('[data-testid="flock-audio-drive"]')).toBeVisible({ timeout: 30000 })
  await expect(page.locator('text=No track loaded')).toHaveCount(0)

  // Exercise the whole chain: the hook's stable live ref reaching the flock's
  // useFrame, which is the part the pure analysis test cannot cover.
  await page.locator('[data-testid="flock-audio-drive"]').fill('2')
  await page.locator('xpath=//span[text()="sweep.mp3"]/preceding-sibling::button').click()
  await page.waitForTimeout(2500)

  const a = await frameSig(page)
  await page.waitForTimeout(1200)
  expect(await frameSig(page), 'the flock must keep flying while the track plays').not.toBe(a)

  expect(errors, `errors:\n${errors.join('\n')}`).toEqual([])
})

test('Space pauses and resumes the flock, and the button follows', async ({ page }) => {
  await openApp(page)
  await page.locator('[data-testid="section-particles"]').click()
  await togColorFor(page, 'Particles').click({ force: true })
  await page.locator('[data-testid="particle-mode-murmuration"]').click()
  await page.waitForTimeout(1500)

  const btn = page.locator('[data-testid="flock-pause"]')
  await expect(btn).toContainText('Pause')

  // Focus has to leave the mode button first, or Space is the browser pressing
  // that button rather than the app's hotkey. Blur it directly: clicking the
  // viewport also does that, but it feeds a click to OrbitControls and to every
  // other viewport handler on the way, which is a lot of scene state to disturb
  // for the sake of moving focus.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
  await page.keyboard.press('Space')
  await page.waitForTimeout(700)
  await expect(btn, 'Space must freeze the flock').toContainText('Resume')

  const a = await frameSig(page)
  await page.waitForTimeout(1000)
  expect(await frameSig(page), 'a paused flock must not move').toBe(a)

  await page.keyboard.press('Space')
  await page.waitForTimeout(900)
  await expect(btn, 'Space must let it go again').toContainText('Pause')
  expect(await frameSig(page), 'a resumed flock must move').not.toBe(a)

  // Paused is a state you tune in, so the steering controls must stay put
  // rather than folding away with the motion.
  await btn.click()
  await expect(btn).toContainText('Resume')
  await expect(page.locator('[data-testid="flock-cohesion"]'),
    'the steering controls must survive a pause').toBeVisible()
})

test('the particle field paints over the draw modes, not under them', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openApp(page)

  // Hologram, frozen: the home buffer is a pure function of the terrain and the
  // spacing, so this frame is bit-reproducible — unlike a flock, whose pose
  // depends on how many substeps happened to run before the screenshot.
  await page.locator('[data-testid="section-particles"]').click()
  const on = togColorFor(page, 'Particles')
  await on.click({ force: true })
  await expect(on.locator('input')).toBeChecked()
  await page.locator('[data-testid="particle-size"]').fill('9')
  await page.locator('[data-testid="particle-spacing"]').fill('4')
  await toggleFor(page, 'Animate').click({ force: true })
  await page.waitForTimeout(3000)

  // Every line layer sets renderOrder = layerIndex + 1 and every mark material
  // has depthWrite: false, so a particle field left at the default renderOrder 0
  // is painted over by the Lines mode unconditionally — the field came out with
  // the line pattern ruled straight across it, however far in front it was.
  // Measured over the default Lines field: 40 657 blue pixels with the field
  // ordered last, 3 420 without. The threshold sits an order of magnitude clear
  // of the broken value and less than half the working one.
  const bluePixels = await page.evaluate(() => {
    const c = document.querySelector('canvas')
    const off = document.createElement('canvas')
    off.width = 640; off.height = 360
    const ctx = off.getContext('2d')
    ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, 640, 360)
    const d = ctx.getImageData(0, 0, 640, 360).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 40 && d[i + 2] > 90) n++
    return n
  })
  console.log(`particle pixels surviving the line field: ${bluePixels}`)
  expect(bluePixels, 'the draw modes must not paint over the particle field').toBeGreaterThan(15000)

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})

test('the field survives switching modes back and forth', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await openApp(page)

  await page.locator('[data-testid="section-particles"]').click()
  await togColorFor(page, 'Particles').click({ force: true })
  await page.locator('[data-testid="particle-size"]').fill('9')

  // The hologram geometry is now disposed when the mode flips away from it —
  // ~25 MB of buffer at a 1024² grid, previously held until the next rebuild.
  // Round-tripping is where that goes wrong if the rebuild does not fire.
  const painted = () => page.evaluate(() => {
    const c = document.querySelector('canvas')
    const off = document.createElement('canvas')
    off.width = 640; off.height = 360
    const ctx = off.getContext('2d')
    ctx.drawImage(c, 0, 0, c.width, c.height, 0, 0, 640, 360)
    const d = ctx.getImageData(0, 0, 640, 360).data
    let n = 0
    for (let i = 0; i < d.length; i += 4) if (d[i + 2] > d[i] + 40 && d[i + 2] > 90) n++
    return n
  })

  for (const mode of ['murmuration', 'hologram', 'murmuration', 'hologram']) {
    await page.locator(`[data-testid="particle-mode-${mode}"]`).click()
    await page.waitForTimeout(2500)
    expect(await painted(), `${mode} must still draw after the switch`).toBeGreaterThan(2000)
  }

  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})

test('SVG export carries the live flock, birds and streaks', async ({ page }) => {
  await openApp(page)

  await page.locator('[data-testid="section-particles"]').click()
  await togColorFor(page, 'Particles').click({ force: true })
  await page.locator('[data-testid="particle-mode-murmuration"]').click()
  await page.waitForTimeout(2000)

  // Freeze first: the export is a still, and a moving flock would make the
  // count below a race against whatever frame it happened to catch.
  await page.locator('[data-testid="flock-pause"]').click()
  await page.waitForTimeout(500)
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.keyboard.press('Digit1'),
  ])
  const svg = await download.createReadStream().then(stream => new Promise((res, rej) => {
    const chunks = []
    stream.on('data', c => chunks.push(c))
    stream.on('end', () => res(Buffer.concat(chunks).toString('utf-8')))
    stream.on('error', rej)
  }))

  const inLayer = (id, tag) => {
    const m = svg.match(new RegExp(`<g id="${id}"[^>]*>(.*?)</g>`, 's'))
    return m ? (m[1].match(new RegExp(`<${tag} `, 'g')) ?? []).length : 0
  }
  const shadows = inLayer('layer-flock-shadow', 'circle')
  // Birds are the circles that are not shadows: they get no layer of their own,
  // sharing the bare group the hologram field has always used.
  const circles = (svg.match(/<circle /g) ?? []).length - shadows
  const streaks = inLayer('layer-flock', 'line')
  console.log(`SVG flock: ${circles} birds, ${streaks} streaks, ${shadows} shadows`)

  // A generous floor, not the exact population: the export culls anything
  // behind the near plane, off canvas or hidden by a peak, and the default
  // camera sees only part of the sky the flock is in.
  expect(circles, 'birds must reach the SVG as circles').toBeGreaterThan(100)
  expect(streaks, 'streaks must reach the SVG as their own plotter layer').toBeGreaterThan(100)
  // One segment per bird — a streak is only ever drawn with the bird it hangs
  // off, so the two counts track each other.
  expect(Math.abs(circles - streaks)).toBeLessThan(circles * 0.25)
  // Shadows are the one part of the field the exporter genuinely depth-culls —
  // those on the far slope are hidden by the ridge — so expect fewer than birds,
  // but not none.
  expect(shadows, 'shadows must reach the SVG in their own layer').toBeGreaterThan(100)
  expect(shadows).toBeLessThanOrEqual(circles)
})
