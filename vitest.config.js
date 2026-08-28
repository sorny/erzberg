import { defineConfig } from 'vitest/config'

/**
 * Unit tests for the parts that are just arithmetic.
 *
 * Its own config, not a `test` block inside vite.config.js, because the two want
 * opposite things: the app build needs the React and Tailwind plugins and a
 * browser target, and none of that belongs in a Node process running Douglas–
 * Peucker over a Float32Array. Nothing here transforms JSX.
 *
 * ── Why this exists beside Playwright rather than instead of it ──────────────
 * The end-to-end suite is right about what it covers: the things worth
 * asserting about a renderer only exist in a real renderer, and
 * playwright.config.js argues that at length. But it meant the purely numeric
 * modules — simplifyFlat, the box blur, area resampling, the bilinear tap, the
 * projections — were reachable only through a GPU, a dev server and a headed
 * Chrome that runs one spec at a time. A deviation-bound regression surfaced as
 * a pixel diff eleven seconds into a spec, if it surfaced at all.
 *
 * These run in about a second and assert the maths directly. They do not
 * replace a single Playwright spec.
 *
 * `environment: 'node'` is deliberate: every module under test here is pure and
 * imports nothing from the DOM (verified — terrain.js, frame.js and colorUtils
 * import nothing at all; geoCoords and geometryBuilders import only each other).
 * A module that needs a document does not belong in this suite.
 *
 * ── Why Vitest and not `node --test` ────────────────────────────────────────
 * Everything under src/ imports without a file extension (`from './defaults'`,
 * `from './utils/gradientPresets'`). Vite resolves that; Node's ESM loader does
 * not, so a spec run directly under Node fails at the first import with
 * ERR_MODULE_NOT_FOUND — which is why the cheapest possible runner is not an
 * option here.
 *
 * Adding the extensions was considered and declined. It touches nearly every
 * module in the tree for no behavioural gain, and this project's stated position
 * on tree-wide mechanical diffs is in eslint.config.js: a change of that shape
 * "would produce a diff across the whole tree that buried the findings a linter
 * exists to surface". The convention is settled and Vite is not going anywhere.
 *
 * So the dependency is recorded rather than removed: these tests need a
 * Vite-based runner, and that is a deliberate choice rather than an accident.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // Only the unit directory. Playwright owns tests/*.spec.js and would
    // otherwise be handed files it cannot run, and vice versa — the two runners
    // are separated by extension as well as by directory, so neither can pick up
    // the other's files by accident.
    include: ['tests/unit/**/*.test.js'],
  },
})
