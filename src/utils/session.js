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
// `textLayers` is content rather than a look — the words someone typed onto a
// plate. It restores with the session for the same reason the panel state does:
// losing a title to a reload is the kind of small betrayal a tool should not
// commit. It is deliberately absent from a *preset*, which is a look and travels
// to other people's rasters.
const FIELDS = ['terrain', 'style', 'points', 'view', 'gradientStops', 'bgGradientStops', 'textLayers']

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
 * The same rule one field over. `terrain.resolution` is only ever set by
 * `autoResolution(width, height)` — it is the loaded raster's size, expressed as
 * a grid step. Restoring a 12 000 px GeoTIFF's resolution of 12 onto the ~1024 px
 * sample plate renders it on an 85×85 grid, with nothing on screen to say why.
 */
const TERRAIN_OMIT = ['resolution']

/**
 * Reads the stored settings, or null.
 *
 * Never throws. Storage can be unavailable outright (Safari private browsing,
 * a locked-down embed), and a half-written or hand-edited value has to degrade
 * to "no session" rather than to a blank app — losing the restore is a small
 * disappointment, failing to boot is not.
 */
export function loadSession(defaults) {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    const out = {}
    for (const f of FIELDS) if (data[f] != null) out[f] = data[f]
    for (const [field, omit] of [['view', VIEW_OMIT], ['terrain', TERRAIN_OMIT]]) {
      if (!out[field]) continue
      out[field] = { ...out[field] }
      for (const k of omit) delete out[field][k]
    }
    if (!Object.keys(out).length) return null
    // A session that says nothing is not a session. Opening the app loads its
    // sample plate, which sets `terrain.resolution` — a real state change, so
    // the settings get written even though nobody touched anything. Without this
    // the *second* visit would announce that settings had been restored when all
    // that came back were the defaults it would have used anyway.
    return defaults && !differsFromDefaults(out, defaults) ? null : out
  } catch {
    return null
  }
}

/**
 * Whether a restored set actually says anything the defaults do not.
 *
 * Compared after the omitted keys have been stripped, and through the same merge
 * the app performs — so a field the store has never heard of, and a field stored
 * at its default value, both read as "nothing to restore".
 */
function differsFromDefaults(restored, defaults) {
  for (const f of FIELDS) {
    const def = defaults[f]
    if (def == null) continue
    const merged = Array.isArray(def)
      ? (restored[f] ?? def)
      : withDefaults(def, restored[f])
    if (JSON.stringify(merged) !== JSON.stringify(def)) return true
  }
  return false
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
