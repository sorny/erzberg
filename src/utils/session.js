/**
 * The settings the app was left in, kept across a reload.
 *
 * A look here is built over an hour of nudging a few hundred parameters, and
 * before this a stray ⌘R returned all of it to defaults with no prompt and no
 * way back. The escape hatch existed — *Preset ⬇* writes the same object as
 * JSON — but it is in the Export section and nothing suggested it until after
 * something had already been lost.
 *
 * What is stored is only the parameters: terrain, style, points, view and the
 * two gradients, all small plain JSON. The raster is deliberately left out. It
 * can be a 256 MB typed array, localStorage is a synchronous ~5 MB string store,
 * and the app opens on its sample plate anyway — restoring settings onto that is
 * the same picture a preset gives you, which is the thing worth keeping.
 */

const KEY = 'erzberg.session.v1'

/** Field names, so a shape change in one place cannot drift from the other. */
const FIELDS = ['terrain', 'style', 'points', 'view', 'gradientStops', 'bgGradientStops']

/**
 * View keys that describe the *raster*, not the look, and so must not come back.
 *
 * Zoom and pan are set by autoZoom from the loaded image's dimensions, against a
 * baseZoom the app derives the same way. The raster is not restored — the app
 * reopens on its sample plate — so a zoom carried over from a session that had a
 * 12 000 px GeoTIFF open would frame the sample wrongly *and* make the panel's
 * "75%" read against a base it was never measured from. Tilt, rotation, lens,
 * supersampling, guides and the paper frame are all properties of the look and
 * do come back.
 */
const VIEW_OMIT = ['zoom', 'panX', 'panY', 'panZ']

/**
 * Reads the stored settings, or null.
 *
 * Never throws. Storage can be unavailable outright (Safari private browsing,
 * a locked-down embed), and a half-written or hand-edited value has to degrade
 * to "no session" rather than to a blank app — losing the restore is a small
 * disappointment, failing to boot is not.
 */
export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const out = {}
    for (const f of FIELDS) if (data[f] != null) out[f] = data[f]
    if (out.view) {
      out.view = { ...out.view }
      for (const k of VIEW_OMIT) delete out.view[k]
    }
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}

/**
 * Writes the settings. Also never throws: a full or blocked quota means this
 * session simply will not be restored, which is where the app already was.
 */
export function saveSession(data) {
  try {
    const out = {}
    for (const f of FIELDS) if (data[f] != null) out[f] = data[f]
    localStorage.setItem(KEY, JSON.stringify(out))
  } catch {
    /* no session to restore — see above */
  }
}

export function clearSession() {
  try { localStorage.removeItem(KEY) } catch { /* nothing to clear */ }
}

/**
 * Restored settings merged over the defaults.
 *
 * Merged rather than replaced so a build that adds a parameter still starts it
 * at its default instead of `undefined`, which is how a stale session would
 * otherwise turn into a slider with no value.
 */
export function withDefaults(def, saved) {
  return saved ? { ...def, ...saved } : def
}
