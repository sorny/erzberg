/**
 * What a dropped file is for.
 *
 * The app takes six kinds of file through six separate buttons, each of which
 * knows exactly what it is being handed. A drop knows nothing: one gesture has
 * to serve all six, and two of the extensions are genuinely ambiguous.
 *
 * ── The two that overlap ─────────────────────────────────────────────────────
 * **`.png`** is both the heightmap format and an export format, and every plate
 * this app writes carries its whole parameter set in a `tEXt` chunk. So a
 * dropped PNG is a preset if it has that chunk and a terrain if it does not —
 * decidable from the bytes, with no guessing and no dialog.
 *
 * **`.json`** is both what `Preset ⬇` writes and what GeoJSON is called half
 * the time. `parsePreset` already answers this: it returns null unless the
 * object holds one of the six parameter groups, and no GeoJSON does.
 *
 * ── The shape ────────────────────────────────────────────────────────────────
 * Rather than return one answer, this returns the routes to *try*, in order.
 * The caller attempts each and stops at the first that takes the file, which
 * puts the whole ambiguity in one list per extension instead of spread across
 * the loaders. `.svg` is the case that makes the point: an exported plate is a
 * preset, and any other SVG is an icon for a layer that a drop cannot name.
 */

/**
 * The routes to try for a filename, best first. Empty for a file nothing here
 * can take.
 */
export function classifyDrop(name) {
  const n = String(name ?? '').toLowerCase()
  const ext = (list) => list.some((e) => n.endsWith(e))

  if (ext(['.tif', '.tiff', '.geotiff'])) return ['geotiff']
  if (ext(['.png']))                      return ['preset', 'raster']
  if (ext(['.svg']))                      return ['preset']
  if (ext(['.geojson']))                  return ['geojson', 'preset']
  if (ext(['.json']))                     return ['preset', 'geojson']
  if (ext(['.gpx']))                      return ['gpx']
  // Named so the caller can say where it goes rather than refusing in silence.
  if (ext(['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac'])) return ['audio']
  return []
}

/**
 * Why a file was not taken, in the app's own terms.
 *
 * Every branch names the button that *would* take it. A drop that fails is a
 * user who guessed the gesture right and the file wrong, and telling them the
 * file is unsupported when there is a control for it three sections down is the
 * least useful true thing the app could say.
 */
export function explainDrop(name, tried) {
  const n = String(name ?? '')
  const short = n.length > 48 ? n.slice(0, 45) + '…' : n
  if (tried?.includes('audio')) {
    return `${short} is audio. Open it under Soundscapes, which turns a track into terrain — a drop here would only replace the ground.`
  }
  if (/\.svg$/i.test(n)) {
    return `${short} carries no erzberg preset, so there is nothing here to apply. To use it as a point marker, open the layer and press ↑ Custom SVG.`
  }
  if (/\.png$/i.test(n)) {
    return `Could not read ${short} as a heightmap or a preset.`
  }
  if (/\.(jpe?g|webp|gif|bmp|avif)$/i.test(n)) {
    return `${short} is not a heightmap — those are PNG or GeoTIFF. For a photographic texture over the terrain, use Texture under Terrain Style.`
  }
  return `Nothing here takes ${short}. Drop a PNG or GeoTIFF heightmap, a GPX or GeoJSON overlay, or a preset — the JSON from Preset ⬇, or any PNG or SVG this app exported.`
}

/**
 * Whether a drag is carrying files at all.
 *
 * Text selections, links and images dragged out of another page all fire the
 * same events, and the highlight must not come up for those. `dataTransfer`
 * hides the file list itself during a drag for privacy, but `types` is
 * readable, which is exactly enough to answer this.
 */
export function dragHasFiles(dataTransfer) {
  const types = dataTransfer?.types
  if (!types) return false
  return Array.from(types).includes('Files')
}
