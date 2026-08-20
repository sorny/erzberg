/**
 * The bundled icon set, and the flattened geometry each one turns into.
 *
 * The files live in `public/icons/` rather than being generated into `src/`,
 * which is the same arrangement `public/presets/` uses and buys the same two
 * things: the icons stay real SVG files with their upstream licence beside them,
 * auditable and replaceable without a rebuild, and the picker can preview one
 * with an ordinary `<img>` exactly as the preset tiles do.
 *
 * Flattening is cached per icon. It costs a fetch and a few hundred
 * `getPointAtLength` calls, and the answer never changes.
 */

import { flattenSvg } from './svgFlatten'

const base = () => import.meta.env.BASE_URL || '/'

export const iconUrl = (id) => `${base()}icons/${encodeURIComponent(id)}.svg`

let manifestPromise = null

/** `{ source, license, icons: [{ id, label }] }`, fetched once. */
export function loadIconManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(`${base()}icons/manifest.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`icons/manifest.json: ${r.status}`))))
      .catch((err) => {
        // A missing manifest is a missing feature, not a broken app: the panel
        // shows no picker and point layers go on drawing dots.
        console.error('[icons] manifest unavailable:', err)
        manifestPromise = null
        return { icons: [] }
      })
  }
  return manifestPromise
}

const cache = new Map()

/**
 * An icon's polylines, or null while it is still loading or if it failed.
 *
 * Deliberately synchronous-with-a-cache rather than a promise: the geometry hook
 * runs on every render and cannot await. A miss kicks off the fetch and returns
 * null, the layer draws its dots for one frame, and the state bump when the
 * fetch lands brings the icon in.
 */
export function getIconGeometry(id, onLoaded) {
  if (!id) return null
  const hit = cache.get(id)
  if (hit) return hit.geo

  cache.set(id, { geo: null })
  fetch(iconUrl(id))
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`${id}.svg: ${r.status}`))))
    .then((text) => {
      cache.set(id, { geo: flattenSvg(text) })
      onLoaded?.()
    })
    .catch((err) => {
      console.error('[icons] could not load', id, err)
      cache.set(id, { geo: null, failed: true })
    })
  return null
}

/** For tests and for the custom-upload path, which already has the source. */
export function cacheIconGeometry(id, geo) {
  cache.set(id, { geo })
}
