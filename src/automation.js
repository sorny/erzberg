/**
 * `window.erzberg` — the page driven by a script instead of a hand.
 *
 * `scripts/erzberg.js` opens the built app headless with `?automation` and calls
 * these. Every call goes through the same path the panel uses — a raster through
 * the drop handler, a preset through `applyPreset`, a value through `setParams`,
 * a file through the exporter's own trigger — so a plate rendered from the
 * command line is the plate the UI would have drawn, and there is no second
 * renderer to fall behind it.
 *
 * Without the query parameter none of this is installed and the app boots as it
 * always has. With it, three things change at boot and nothing else does: no
 * stored session is read, the opening preset does not land, and the panel
 * starts shut so the canvas is the whole window the script asked for.
 */
import { useEffect, useRef } from 'react'
import { DRAW_MODES } from './utils/drawModes'
import { coerceParams, modePatch, resolveModes } from './utils/paramCoerce'
import { readPresetFile } from './utils/presetFile'
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from './defaults'

export const AUTOMATION = typeof location !== 'undefined'
  && new URLSearchParams(location.search).has('automation')

const EXPORT_KIND = { svg: 'svg', png: 'png', pngAlpha: 'pngAlpha', stl: 'stl' }

const frame = () => new Promise((r) => requestAnimationFrame(() => r()))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Inputs arrive by URL rather than as arguments: the CLI serves them beside the
// app, and a 200 MB GeoTIFF does not belong inside a `page.evaluate` string.
async function fileAt(name, url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`could not read ${name} (HTTP ${res.status})`)
  return new File([await res.blob()], name)
}

/**
 * Install the API. `live` is read through a ref, so each call sees this render's
 * state and callbacks rather than the ones from the render that installed it.
 *
 * Returns the hook App's `finishExport` calls, which is how an export reports
 * back: every writer already ends there, with its status.
 */
export function useAutomation(live) {
  const ref = useRef(live)
  ref.current = live
  const pending = useRef(null)
  // When anything that could still move the plate last moved.
  const lastChange = useRef(0)
  useEffect(() => { lastChange.current = performance.now() },
    [live.lineGeo, live.isComputing, live.isLoading, live.p])

  useEffect(() => {
    if (!AUTOMATION) return
    const L = () => ref.current

    /**
     * Resolves once the plate has stopped moving: no build in flight, no raster
     * loading, and the drawing unchanged for `quietMs`. The quiet window is what
     * covers the lettering passes, which finish after the worker does (fonts are
     * fetched) and replace the drawing once more when they land.
     *
     * The window starts no earlier than the call. A change made in the same
     * task, `setModes(…)` and then `settle()` in one `page.evaluate`, starts its
     * rebuild only once React has rendered and run its effects. Until then the
     * build flag and `lastChange` still describe the plate before the change, so
     * a plate that had been still for a while counted as settled at once, and
     * the export after it drew the old geometry.
     */
    const settle = async ({ quietMs = 600, timeoutMs = 300_000 } = {}) => {
      const t0 = performance.now()
      await frame(); await frame()
      for (;;) {
        const s = L()
        const quiet = performance.now() - Math.max(lastChange.current, t0) >= quietMs
        if (!s.isComputing && !s.isLoading && quiet) break
        if (performance.now() - t0 > timeoutMs) throw new Error(`the plate did not settle within ${timeoutMs / 1000} s`)
        await sleep(50)
      }
      await frame()
      return { building: false, buildMs: L().lastBuildMs ?? null }
    }

    const run = (kind, start) => new Promise((resolve, reject) => {
      if (pending.current) { reject(new Error('another export is still running')); return }
      pending.current = { kind, resolve }
      if (start() === false) { pending.current = null; reject(new Error('the export slot is busy')) }
    })

    window.erzberg = {
      version: 1,
      settle,

      /** A heightmap, by the drop path: GeoTIFF, 16-bit PNG and 8-bit images alike. */
      async loadRaster(name, url) {
        await L().handleDroppedFile(await fileAt(name, url))
        await settle()
        const s = L()
        if (s.loadError) throw new Error(s.loadError)
        if (s.heightmapFilename !== name) throw new Error(`${name} did not load`)
        return { width: s.heightmapWidth, height: s.heightmapHeight }
      },

      /** A preset from a JSON file, or one embedded in an SVG or PNG this app wrote. */
      async applyPreset(name, url) {
        const d = await readPresetFile(await fileAt(name, url)).catch(() => null)
        if (!d) throw new Error(`${name} carries no erzberg preset`)
        L().applyPreset(d, name.replace(/\.[^.]+$/, ''))
        await frame()
        return true
      },

      /** Switch modes on by id or label; with `only`, every other mode off first. */
      setModes(names, only = false) {
        const { ids, errors } = resolveModes(names)
        if (errors.length) throw new Error(errors.join('; '))
        L().setParams(modePatch(ids, only))
        return ids
      },

      /** Flat `{ key: text }`, typed against each key's default. */
      setParams(raw) {
        const { values, errors } = coerceParams(raw)
        if (errors.length) throw new Error(errors.join('; '))
        L().setParams(values)
        return values
      },

      /** Writes one file through the browser download. Resolves with its status. */
      export(kind) {
        const k = EXPORT_KIND[kind]
        if (!k) return Promise.reject(new Error(`unknown export kind "${kind}"`))
        const s = L()
        if (k === 'svg') return run(k, () => s.beginSvgExport())
        if (k === 'stl') return run(k, () => s.handleStl())
        return run(k, () => s.beginPngExport(k === 'pngAlpha'))
      },

      /** The plot figures the Export section shows, for the drawing as it stands. */
      async preflight() {
        await run('preflight', () => L().beginPreflight())
        await frame(); await frame()
        return L().plotStats ?? null
      },

      catalog() {
        return {
          modes: DRAW_MODES.map(({ id, label }) => ({ id, label })),
          params: { terrain: TERRAIN_DEF, style: STYLE_DEF, points: POINTS_DEF, view: VIEW_DEF },
          presets: Object.keys(L().externalPresets ?? {}),
        }
      },
    }
    return () => { delete window.erzberg }
  }, [])

  return (status) => {
    const job = pending.current
    if (!job) return
    pending.current = null
    job.resolve(status)
  }
}
