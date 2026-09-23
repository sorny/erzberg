/**
 * What the renderer costs, as opposed to what the geometry costs.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Every other performance spec here measures *building*: decode a GeoTIFF, run
 * the worker, hand a buffer to the main thread. `performance.spec.js` even has
 * a test called `render-performance-baseline`, and it reads
 * `[Perf] Terrain ready Main:` — which is geometry construction and contains no
 * rendering at all.
 *
 * So nothing measured the frame loop, and the frame loop is exactly where a
 * React Three Fiber or drei upgrade lands: the reconciler, prop diffing on
 * scene objects, `useFrame` scheduling. A tool that felt "substantially slower"
 * after such an upgrade would have passed this project's whole suite.
 *
 * ── How it reads the renderer ────────────────────────────────────────────────
 * No hook in the app. `WebGLRenderer` announces itself to `__THREE_DEVTOOLS__`
 * in its constructor, so stubbing one before the page loads hands us the real
 * renderer — the same trick `vector.spec.js` uses for the scene graph. That
 * matters: a probe added to the app would itself be a `useFrame`, and would
 * change the number it was there to measure.
 *
 * ── The one thing that makes this hard ───────────────────────────────────────
 * The canvas is `frameloop="demand"`. It renders when something calls
 * `invalidate()` and is otherwise perfectly idle, so sampling
 * `requestAnimationFrame` deltas measures the browser's clock rather than the
 * app's cost — an idle app looks like a fast one.
 *
 * Auto-rotate is the honest lever. `Scene.jsx` calls `invalidate()` on every
 * frame while it is on, which is a real user mode and a genuinely continuous
 * loop. Frames are counted from `gl.info.render.frame`, the renderer's own
 * counter, so what is measured is frames actually drawn rather than callbacks
 * actually fired.
 *
 * ── What to compare against ──────────────────────────────────────────────────
 * Every test prints its numbers. The ceilings are deliberately loose, because
 * this runs on whatever machine has it and a tight bound would be noise; they
 * are set to catch the magnitude that gets noticed — roughly a halving of the
 * frame rate — not a ten-percent drift.
 *
 * The draw-call and triangle counts are the exception, and they are the most
 * valuable numbers here: they are machine-independent. If an upgrade submits
 * more draw calls for the same scene, that is exact, reproducible, and a fact
 * about the library rather than about the hardware.
 *
 * ── Which build is on the other end ─────────────────────────────────────────
 * It decides the frame times, and nothing else. `playwright.config.js` starts
 * `npm run dev`, so that is what these tests normally measure — and a
 * development build of React is not the app anyone runs. React 19 spends about
 * a fifth of a 5 s auto-rotate inside `jsxDEV`, its dev-only JSX runtime, which
 * a production bundle does not contain at all. Measured on the same machine and
 * the same commit, the same scene holds 241 frames in production and 204 on the
 * dev server.
 *
 * So `frameBudget` reads which build answered and bounds it accordingly. In
 * production the bound is real. On a dev server it catches a catastrophe and
 * little else, and the honest verdict on an upgrade comes from a production run
 * plus the draw-call counts below, which are the same either way.
 *
 * BASELINE, React 19.3.0 · fiber 9.8.0 · drei 10.7.8 · three 0.186.0
 * Recorded 2026-09-23, headless Chrome, 1280×720, after `resetToDefaults`.
 * Every one of these is printed by the run, so a comparison needs no tooling:
 *
 *                        production      dev server
 *     opening frame      2 passes · 12 draw calls · 2 618 928 triangles
 *     its scene pass     3 calls · 2 618 880 triangles
 *     three mark layers  24 calls · 9 108 010 triangles
 *     auto-rotate median 16.7 ms        16.7 ms
 *     auto-rotate p95    17.6–18.0 ms   70.0–73.5 ms
 *     three marks p95    18.0–18.5 ms   74.9 ms
 *     orbit drag         3–7 ms         11 ms, pointer to painted frame
 *
 * The three counts carry no second column because they do not have one: they
 * are identical in both builds, and identical to what React 18.3.1 · fiber
 * 8.18.0 · drei 9.122.0 · three 0.184.0 submitted before the upgrade. That is
 * the whole value of them.
 *
 * The two scenes differing — 12 calls against 24, 2.6 M triangles against
 * 9.1 M — is the check that these numbers describe the terrain rather than the
 * furniture. While the gizmo bug above was live, both read 9 and 48.
 *
 * PREVIOUS, React 18.3.1 · fiber 8.18.0 · drei 9.122.0 · three 0.184.0, on the
 * dev server: auto-rotate p95 31–38 ms, orbit drag 4–9 ms, same three counts.
 * Its production p95 was 28.1 ms, against 17.6 ms now — the gain is not React's.
 * It is a memo in `sectionParams.js`: an orbit was re-deriving every panel
 * section about seven times a second, and React 19's dev build is what made
 * that visible.
 *
 * Re-record them when the stack moves, in the same breath as moving it.
 */
import { expect, test } from '@playwright/test'
import { openStage, resetToDefaults, waitForApp } from './helpers.js'

const PAGE = 'http://localhost:5173'

/**
 * Hands the test the real `WebGLRenderer`.
 *
 * Must run before any script on the page: three checks for the global inside
 * the constructor, so a stub installed afterwards is never consulted.
 */
async function captureRenderer(page) {
  await page.addInitScript(() => {
    window.__gl = null
    window.__THREE_DEVTOOLS__ = {
      dispatchEvent(e) {
        // The gizmo has a renderer of its own in some versions; the first one
        // announced is the Canvas's, which is the one the terrain draws in.
        if (e.detail?.isWebGLRenderer && !window.__gl) window.__gl = e.detail
      },
    }
  })
}

/**
 * The build that answered, and the frame time that is healthy for it.
 *
 * A vite dev server injects its own client shim into the document; a built
 * bundle has nothing like it. That is the whole test — see the note at the top
 * for why the two builds cannot share one bound.
 *
 * Production: 33 ms is two frames at 60 Hz, and the same "did this halve"
 * question the median bound asks. The recorded value is 17.6–18.0 ms.
 * Dev server: the recorded value is 70–74 ms, nearly all of it React's own
 * development instrumentation, so 120 ms is a floor under a catastrophe rather
 * than a measurement anyone should tune against.
 */
async function frameBudget(page) {
  const dev = await page.evaluate(() => !!document.querySelector('script[src*="/@vite/client"]'))
  return dev ? { name: 'dev server', p95: 120 } : { name: 'production', p95: 33 }
}

/** Boots the app with the renderer captured, at a known baseline. */
async function boot(page) {
  await captureRenderer(page)
  await page.goto(PAGE)
  await waitForApp(page)
  await page.waitForSelector('text=Grid:', { timeout: 30_000 })
  await resetToDefaults(page)
  await page.waitForTimeout(1500)
  expect(await page.evaluate(() => !!window.__gl),
    'the renderer must be reachable, or every number below is fiction').toBe(true)
}

/**
 * What the renderer submits for the scene, summed across every pass in a frame.
 *
 * ── The trap this exists to avoid ────────────────────────────────────────────
 * A frame here is **two** `render()` calls: the terrain, then the orientation
 * gizmo in a second pass. `info.autoReset` clears the counters at the top of
 * each one, so anything reading `gl.info.render` afterwards sees only the
 * gizmo — a steady, plausible, entirely wrong `9 draw calls · 48 triangles`.
 *
 * Measured while that bug was live: the terrain pass submits 7 945 010
 * triangles and the gizmo pass 48, and the gizmo is what every naive read
 * returns. A baseline recorded that way would have been a baseline of the axis
 * widget, and an upgrade could have halved the terrain's frame rate without
 * moving it a single triangle.
 *
 * So `render` is wrapped and each pass is captured before the next resets it.
 * The result is per frame: total calls and triangles across all passes, plus
 * the largest single pass, which is the terrain and the number that matters.
 *
 * Must be called while the loop is running — auto-rotate on — because under
 * `frameloop="demand"` an idle app renders nothing at all.
 */
const rendererInfo = (page, ms = 1500) => page.evaluate(async (ms) => {
  const gl = window.__gl
  const orig = gl.render.bind(gl)
  const frames = []
  let pass = []
  gl.render = function (scene, camera) {
    orig(scene, camera)
    const r = gl.info.render
    pass.push({ calls: r.calls, triangles: r.triangles, lines: r.lines, points: r.points })
  }
  const t0 = performance.now()
  await new Promise((done) => {
    const tick = () => {
      if (pass.length) { frames.push(pass); pass = [] }
      if (performance.now() - t0 < ms) requestAnimationFrame(tick)
      else done()
    }
    requestAnimationFrame(tick)
  })
  gl.render = orig

  const sum = (f, k) => f.reduce((a, p) => a + p[k], 0)
  // The median frame, so one warm-up frame cannot set the baseline.
  const byCalls = frames.filter((f) => f.length).sort((a, b) => sum(a, 'calls') - sum(b, 'calls'))
  const mid = byCalls[Math.floor(byCalls.length / 2)] ?? []
  const biggest = mid.reduce((a, p) => (p.triangles > (a?.triangles ?? -1) ? p : a), null)
  const { memory, programs } = gl.info
  return {
    passes: mid.length,
    calls: sum(mid, 'calls'),
    triangles: sum(mid, 'triangles'),
    lines: sum(mid, 'lines'),
    points: sum(mid, 'points'),
    sceneCalls: biggest?.calls ?? 0,
    sceneTriangles: biggest?.triangles ?? 0,
    geometries: memory.geometries, textures: memory.textures,
    programs: programs?.length ?? 0,
  }
}, ms)

/**
 * Samples the frame loop for `ms`, and reports what the renderer actually drew.
 *
 * Deltas come from the renderer's frame counter rather than from the rAF
 * callback: under `frameloop="demand"` a callback can fire on a frame nothing
 * was drawn in, and counting those would flatter the result.
 */
const sampleFrames = (page, ms) => page.evaluate(async (ms) => {
  const gl = window.__gl
  const marks = []
  let last = gl.info.render.frame
  const t0 = performance.now()
  await new Promise((done) => {
    const tick = () => {
      const f = gl.info.render.frame
      if (f !== last) { marks.push(performance.now()); last = f }
      if (performance.now() - t0 < ms) requestAnimationFrame(tick)
      else done()
    }
    requestAnimationFrame(tick)
  })
  const deltas = marks.slice(1).map((t, i) => t - marks[i]).sort((a, b) => a - b)
  const at = (q) => (deltas.length ? deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * q))] : NaN)
  return {
    frames: marks.length,
    elapsed: performance.now() - t0,
    median: at(0.5),
    p95: at(0.95),
    worst: deltas[deltas.length - 1],
  }
}, ms)

/** Turns auto-rotate on, which is what makes the on-demand loop continuous. */
async function startAutoRotate(page) {
  await openStage(page, 'frame')
  const tog = page.locator('input[type=checkbox][aria-label="Auto-rotate"]')
  if (!(await tog.isChecked())) await tog.click()
  await page.waitForTimeout(1200)   // let the loop reach a steady state
}

test.describe('render performance', () => {
  test('the scene submits a known number of draw calls', async ({ page }) => {
    /*
     * The machine-independent measurement, and the one worth watching hardest.
     *
     * Draw calls are a fact about what the library asked the GPU to do, not
     * about how fast this GPU did it. A reconciler that stops batching, or a
     * drei component that adds a pass, shows up here identically on every
     * machine — which is exactly what a library upgrade needs to be judged on.
     */
    await boot(page)
    // The loop has to be running or the counters describe an idle frame — see
    // the note on `rendererInfo`.
    await startAutoRotate(page)
    const info = await rendererInfo(page)
    console.log(`RENDER frame: ${info.passes} passes · ${info.calls} calls · ` +
                `${info.triangles.toLocaleString()} triangles · ${info.lines} lines`)
    console.log(`RENDER scene pass: ${info.sceneCalls} calls · ` +
                `${info.sceneTriangles.toLocaleString()} triangles`)
    console.log(`RENDER resident: ${info.geometries} geometries · ` +
                `${info.textures} textures · ${info.programs} programs`)

    // Two passes: the terrain, then the gizmo. A third would mean something
    // grew a render pass, which is exactly the kind of cost an upgrade adds
    // without anyone deciding to.
    expect(info.passes, 'render passes per frame').toBe(2)
    expect(info.calls, 'draw calls per frame').toBeGreaterThan(0)
    // Bounds rather than equality: a spurious failure on an exact number
    // teaches people to delete the test.
    expect(info.calls, 'a jump here means something stopped batching').toBeLessThan(40)
    expect(info.programs, 'shader programs compiled').toBeLessThan(30)
    expect(info.geometries, 'geometries resident').toBeLessThan(60)
  })

  test('a rotating scene holds its frame rate', async ({ page }) => {
    test.setTimeout(120_000)
    await boot(page)
    await startAutoRotate(page)

    const budget = await frameBudget(page)
    const s = await sampleFrames(page, 4000)
    console.log(`RENDER auto-rotate (${budget.name}): ${s.frames} frames in ${s.elapsed.toFixed(0)}ms · ` +
                `median ${s.median.toFixed(1)}ms · p95 ${s.p95.toFixed(1)}ms · ` +
                `worst ${s.worst.toFixed(1)}ms`)

    // It has to be drawing at all: a frame loop that stalled would otherwise
    // report a beautiful median over three frames.
    expect(s.frames, 'auto-rotate must produce a continuous loop').toBeGreaterThan(60)

    /*
     * 33 ms is 30 fps, twice the 16.7 ms a healthy loop holds here. The bound
     * is that loose on purpose — this runs on whatever machine has it, and the
     * question it answers is "did this halve", not "did this drift".
     */
    expect(s.median, 'median frame time under sustained rendering').toBeLessThan(33)
    // The 95th is what a hand feels as a stutter, so it gets its own bound
    // rather than hiding inside an average — and its own bound per build, since
    // a development React is four times slower here than the one that ships.
    expect(s.p95, `the slow frames are what reads as jank (${budget.name})`)
      .toBeLessThan(budget.p95)
  })

  test('a heavy scene still renders, and says what it costs', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)

    // More marks on screen than the opening preset draws. Crosshatch and
    // hachure over the same ground is a realistic plate, not a synthetic one.
    await openStage(page, 'marks')
    for (const id of ['Cross', 'Hachure', 'Contours']) {
      const pip = page.locator(`[data-testid="mode-tile-${id}"]`)
      if ((await pip.getAttribute('aria-pressed')) !== 'true') await pip.click()
    }
    await page.waitForTimeout(6000)

    await startAutoRotate(page)
    const before = await rendererInfo(page)
    const s = await sampleFrames(page, 4000)

    console.log(`RENDER heavy frame: ${before.calls} calls · ` +
                `${before.triangles.toLocaleString()} triangles · ${before.lines} lines`)
    console.log(`RENDER heavy loop: ${s.frames} frames · median ${s.median.toFixed(1)}ms · ` +
                `p95 ${s.p95.toFixed(1)}ms`)

    expect(s.frames, 'a heavy plate must still animate').toBeGreaterThan(30)
    // Looser than the light scene, and stated rather than derived: this is a
    // real plate with three mark layers over a million-vertex surface.
    expect(s.median, 'median frame time with three mark layers').toBeLessThan(50)
  })

  test('an orbit drag reaches the screen promptly', async ({ page }) => {
    /*
     * The number a hand actually notices.
     *
     * Everything above measures a loop that is already running. This measures
     * the other thing an upgrade can spoil: how long it takes for a pointer
     * move to become a drawn frame, which under `frameloop="demand"` includes
     * the whole React round trip that fiber owns.
     */
    test.setTimeout(120_000)
    await boot(page)

    const box = await page.evaluate(() => {
      const r = document.querySelector('canvas').getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })
    const cx = box.x + box.w * 0.4, cy = box.y + box.h * 0.5

    const latencies = []
    for (let i = 0; i < 5; i++) {
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      const ms = await page.evaluate(() => {
        const gl = window.__gl
        const from = gl.info.render.frame
        const t0 = performance.now()
        return new Promise((done) => {
          const tick = () => {
            if (gl.info.render.frame !== from) return done(performance.now() - t0)
            if (performance.now() - t0 > 2000) return done(-1)
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
      })
      await page.mouse.move(cx + 60 + i * 5, cy + 20)
      await page.mouse.up()
      await page.waitForTimeout(250)
      if (ms >= 0) latencies.push(ms)
    }

    latencies.sort((a, b) => a - b)
    const median = latencies[Math.floor(latencies.length / 2)]
    console.log(`RENDER drag latency: ${latencies.map((n) => n.toFixed(0)).join(', ')}ms · ` +
                `median ${median?.toFixed(0)}ms`)

    expect(latencies.length, 'a drag must draw something').toBeGreaterThan(2)
    // Two frames at 60 fps is 33 ms; 120 leaves room for a slow machine while
    // still failing a round trip that has become visibly laggy.
    expect(median, 'pointer to painted frame').toBeLessThan(120)
  })
})
