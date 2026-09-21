/**
 * What a produced work owes, in one answer.
 *
 * Three datasets in this app come with a credit attached, and all three attach
 * it to the *output* rather than to the tool: ODbL 4.3 binds to the Produced
 * Work, CC-BY binds to anything derived from the licensed material, and the
 * Copernicus terms ask for a line wherever the imagery goes. So the question is
 * never "is OpenStreetMap wired up" but "is OpenStreetMap in this file".
 *
 * `osmFetch.js` already learned that lesson the hard way — its own note records
 * four exporters asking the same question four ways, with the SVG crediting and
 * PNG, STL and WebM silently not. Land cover would have made it five, so the
 * question now has one home and every exporter reads the same sentence.
 */
import { osmAttribution } from './osmFetch'
import { DRAW_MODE_IDS } from './drawModes'
import { ALL_CLASSES } from './coverPlate'

/**
 * Is the cover plate actually in the picture?
 *
 * Two ways for it to be, and both count. The Land cover mode inks the classes
 * directly. Any other mode with a class mask set is *shaped* by them — its marks
 * stop where a class stops — which is derivation just as surely, and is in fact
 * the more common use.
 *
 * A loaded plate that nothing draws from earns no credit, for the same reason a
 * hidden OSM layer does not: it is not in the file.
 */
export function coverInUse(style, cover) {
  if (!cover) return false
  if (style?.enabledCover) return true
  return DRAW_MODE_IDS.some((id) => style?.[`enabled${id}`] && (style?.[`coverMask${id}`] ?? ALL_CLASSES) !== ALL_CLASSES)
}

/**
 * Every credit this export must carry, or null when it owes none.
 *
 * Joined with a newline rather than a separator, because these are sentences
 * from different licences and not items in a list — the SVG writes them into a
 * comment and the PNG into a text chunk, and both read better as lines.
 */
export function workAttribution(src = {}) {
  // Two callers, two shapes. Scene passes the merged parameter bus, where the
  // style keys sit at the top level; App passes the state blocks separately.
  // Taking the source itself as the style bag when none is named covers both
  // without either call site having to reshape what it already holds.
  const style = src.style ?? src
  const lines = []
  const osm = osmAttribution(src.vectorLayers)
  if (osm) lines.push(osm)
  if (coverInUse(style, src.cover) && src.cover?.attribution) lines.push(src.cover.attribution)
  // Imagery counts when it is actually draped. Fetched and switched off is the
  // same as a hidden layer: it is not in the file.
  if (style?.showImagery && src.imagery?.credit) lines.push(src.imagery.credit)
  return lines.length ? lines.join('\n') : null
}
