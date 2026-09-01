/**
 * Free text placed in the scene.
 *
 * A contour letters its own height and a peak letters its own name, and both
 * are *derived*: the string comes from the data and the position comes from the
 * feature. Neither can put a title on a plate, name a valley the survey never
 * named, or sign it.
 *
 * A text layer is the same lettering machinery with the derivation removed. You
 * supply the string and the position; everything downstream — the faces, the
 * fill, the plane it stands in, the pen it plots with — is what a point label
 * already had, because it is literally the same code.
 *
 * These are `lineGeo` entries like every other layer, so they inherit ghost
 * occlusion, hidden-line removal and every exporter without any of those
 * learning that free text exists. They are appended last, which is what puts
 * them in front of the drawing they annotate.
 */

/** Ids are `txt:N`, the way vector layers are `vec:N`. */
export const isTextLayerId = (id) => typeof id === 'string' && id.startsWith('txt:')

/**
 * One text layer.
 *
 * Placement is in *fractions of the terrain's half-extent* rather than in world
 * units, so a text stays where it was put when the resolution slider moves the
 * grid under it. `lift` is world units above the ground it sits on, which is the
 * one part that should not scale with the plate.
 */
export const TEXT_LAYER_DEF = {
  text: 'erzberg',
  visible: true,

  // Where it stands. x and z are −1…1 across the plate; y is sampled from the
  // terrain under that point, so the text sits on the ground and `lift` raises
  // it off.
  x: 0,
  z: 0,
  lift: 70,

  // Type. The same four controls a point label has, plus the stroke faces.
  size: 28,
  align: 'center',
  dx: 0,
  dy: 0,
  bold: false,
  italic: false,
  singleLine: false,
  font: null,

  // The plane it stands in. Face camera is the useful default for a title: it
  // stays readable while the scene orbits.
  faceCamera: true,
  tilt: 50,
  spin: 0,

  // Ink, resolved render-side by `layerStyle` — so recolouring one costs a
  // frame, exactly as it does for a vector layer.
  color: '#111111',
  weight: 2,
  opacity: 1,
  dash: 'solid',
  fill: false,
  fillColor: null,
  fillOpacity: null,
  strokeOutside: false,
}

let nextId = 1

/** A new text layer, named for the panel and numbered for its id. */
export function makeTextLayer(overrides = {}) {
  const n = nextId++
  return { id: `txt:${n}`, ...TEXT_LAYER_DEF, ...overrides }
}

/**
 * Re-seed the counter so a restored session does not hand out an id it is
 * already using. Two layers sharing an id would collide in `layerStyle` and in
 * React's keys at once.
 */
export function adoptTextLayers(layers) {
  for (const l of layers ?? []) {
    const n = Number.parseInt(String(l.id).slice(4), 10)
    if (Number.isFinite(n) && n >= nextId) nextId = n + 1
  }
  return layers ?? []
}

/** The row label: whatever it says, trimmed to something a list can hold. */
export function textLayerName(l) {
  const t = (l.text ?? '').trim().split('\n')[0]
  if (!t) return 'Empty'
  return t.length > 22 ? t.slice(0, 21) + '…' : t
}
