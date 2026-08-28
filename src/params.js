/**
 * The parameter space, described once.
 *
 * Four objects in `defaults.js` define every tweakable value in the app, and
 * three separate things needed to reason about that set — which state object
 * owns a key, which keys move a vertex, and whether the four sets are disjoint
 * at all. Each answered the question its own way, none could see the others,
 * and two of the three were maintained by hand:
 *
 *  • `useTerrainGeometry`'s rebuild dependency array named ~180 keys literally,
 *    behind an eslint-disable, while the worker reads many of the same values
 *    through computed keys (`p[`hypso${id}`]`). No tool could reconcile the two,
 *    so a draw mode added without touching the array got a knob that moved and
 *    changed nothing, silently.
 *
 *  • `setParams` in App.jsx sorted incoming keys into groups with a
 *    `startsWith` filter over sixteen prefixes. It misrouted nothing, but 73 of
 *    262 style keys matched no prefix and were simply undeliverable — angleLines,
 *    every hillshade*, every label*Contours, all six overlay switches.
 *
 *  • Nothing checked that the four groups do not share a key. They do not today
 *    (348 keys, no collisions), but a future `view.seed` against
 *    `style.seedStipple` would have resolved by spread order with no warning.
 *
 * All three are now derived from the same index, so the parameter space has one
 * description and adding a parameter to `defaults.js` is the whole edit.
 */
import { POINTS_DEF, STYLE_DEF, TERRAIN_DEF, VIEW_DEF } from './defaults'
import { DRAW_MODE_IDS } from './utils/drawModes'

const GROUPS = { terrain: TERRAIN_DEF, style: STYLE_DEF, points: POINTS_DEF, view: VIEW_DEF }

/**
 * key → the name of the state object that owns it.
 *
 * Built eagerly at module load, and the build *is* the collision guard: `p` is
 * the four groups spread into one bus, so two groups claiming one name means the
 * bus silently carries whichever spread came last. Failing at import is the
 * cheapest possible place to find that out.
 */
export const GROUP_OF = (() => {
  const m = new Map()
  for (const [group, def] of Object.entries(GROUPS)) {
    for (const k of Object.keys(def)) {
      if (m.has(k)) throw new Error(
        `[params] "${k}" is declared in both ${m.get(k).toUpperCase()}_DEF and ${group.toUpperCase()}_DEF — ` +
        `the merged param bus in App.jsx cannot carry both.`)
      m.set(k, group)
    }
  }
  return m
})()

/**
 * Everything that is NOT geometry.
 *
 * Stated as the exception list because it is the shorter one — 176 of 348 — and
 * because every entry is a deliberate trade the architecture doc already argues
 * for, which is worth being able to read in one place. The rule for adding to
 * it: a parameter belongs here only if the *worker* can be shown never to move a
 * vertex for it, either because it never reads the value or because it reads it
 * only through `layerStyle()` / `needsSurfaceShading()`, both of which are
 * resolved at render time.
 *
 * Verified against the dependency array this replaces: the two sets are
 * identical, 172 keys either way, so the rebuild contract is unchanged.
 */
const RENDER_SIDE = [
  // Resolved per layer at render time by layerStyle(id, p) — in HeightmapLines
  // for the viewport and in svgExport for the plot. Dragging a line's weight or
  // opacity must not cost a rebuild of all fifteen draw modes.
  /^(weight|opacity|dash)/,
  // The occlusion *look*. `depthOcclusion` itself is deliberately absent from
  // this list: the curtains are geometry, and building them for a scene that
  // will not draw them costs ~18 MB a rebuild.
  /^occlusion(Bias|Color|Opacity)$/,
  // Surface fill and the mesh overlay — pure uniforms in SurfaceMesh. The one
  // fill-related value that does rebuild reaches the effect as the precomputed
  // p.needsSurfaceShading, not from here.
  // Unanchored on purpose: this has to cover the whole `fill*` family
  // (fillColor, fillBanded, fillHypso*), not just the bare word.
  /^(fill|bgColor|bgGradient|meshColor|showFill|showMesh)/,
  // Every surface overlay: hillshade and its cast shadows, slope, aspect, sky
  // view factor, water, and the raw terrain view. All branches within the one
  // surface shader.
  /^(hillshade|slopeShade|slopeColor|aspectMap|ao|water)/,
  /^show(Hillshade|SlopeShade|AspectMap|AO|WaterFill|Sun|RawTerrain)$/,
  // Ink that is chosen after the geometry exists: Tanaka's two stroke weights,
  // the contour label's own colour/weight, the major-contour weight, the scree
  // dot weight. `tanakaContours` and the label *placement* params are geometry
  // and stay out of this.
  // Unanchored too — these are prefixes of suffixed names
  // (tanakaWeightBright, labelColorContours, screeWeightSwiss).
  /^(tanakaWeight|labelColor|labelWeight|majorWeight|screeWeight|screenWeight)/,
  /^label(SingleLine|Font)Contours$/,
  // Texture overlay — sampled in the surface shader.
  /^(texture|showTexture)/,
  // The camera, the lens, supersampling, the guides and the paper frame. None of
  // them reaches the worker at all.
  /^(tilt|rotation|zoom|fov|pan|orthographic|renderScale|autoRotate|showGuides)/,
  /^(frame|showFrame)/,
  // Particles: both fields are built on the main thread from the terrain grid
  // the worker already returned.
  /^(flock|holo|point|particle|animateParticles|showPoints)/,
]

/**
 * Geometry-affecting parameters that are not scalars.
 *
 * `geometryKey` builds a string, and a string cannot represent these: an array
 * of `{pos, color}` stops stringifies to "[object Object],[object Object]" no
 * matter what is in it, so a key containing one would be blind to every
 * gradient edit — and the stops are baked into line vertex colours, which is a
 * rebuild. They are excluded here and depended on by identity instead, which is
 * what the array this replaces did.
 *
 * Currently exactly one. If a second ever appears, it belongs here and in the
 * hook's dependency list beside it, not in the key.
 */
export const GEOMETRY_NON_SCALAR = ['gradientStops']

const isGeometry = (k) =>
  !GEOMETRY_NON_SCALAR.includes(k) && !RENDER_SIDE.some((re) => re.test(k))

/**
 * The render-side patterns allowed to claim a key that names a draw mode.
 *
 * Several RENDER_SIDE patterns are unanchored prefixes — `fill`, `point`, `pan`,
 * `rotation`, `frame`, `texture` — because they have to cover a whole family
 * (`fillColor`, `fillBanded`, `fillHypsoInterval`) rather than a bare word. That
 * is correct for the families they were written for and quietly wrong for a
 * draw mode named afterwards: `fillTruss`, `pointSizeFlash` and
 * `rotationBitplane` all match, all get classified render-side, and all produce
 * a control that moves while nothing happens.
 *
 * That is the same failure the hand-written dependency array used to have. It is
 * caught here instead of found later: a key ending in a draw-mode id may only be
 * render-side if it matches one of these, which are the six things a mode is
 * genuinely allowed to style after its geometry exists.
 */
const MODE_SUFFIX_RENDER_SIDE = [
  /^(weight|opacity|dash)[A-Z]/,
  /^(tanakaWeight|labelColor|labelWeight|majorWeight|screeWeight|screenWeight)[A-Z]/,
  /^label(SingleLine|Font)Contours$/,
]

/**
 * The two ways a parameter can be silently inert, checked at module load.
 *
 * Exported and taking its inputs as arguments so the specs can hand it a
 * synthetic parameter space and assert that it actually fires — a guard nothing
 * ever proves catches anything is indistinguishable from no guard.
 *
 * Runs at import, like the GROUP_OF collision guard above and for the same
 * reason: failing there is the cheapest possible place to learn that a slider
 * will never do anything.
 *
 * 1. **Swallowed by a prefix.** A key ending in a draw-mode id may only be
 *    render-side if it matches MODE_SUFFIX_RENDER_SIDE. `fillTruss` and
 *    `rotationBitplane` otherwise match an unanchored family pattern, get
 *    classified render-side, and produce a control that moves while nothing
 *    happens — the same failure the hand-written dependency array used to have.
 * 2. **Not representable as a string.** `geometryKey` concatenates values, so an
 *    array or object stringifies to `[object Object]` however it is edited.
 */
export function auditParamSpace(groups, modeIds) {
  const swallowed = []
  const nonScalar = []
  for (const [group, def] of Object.entries(groups)) {
    for (const [k, v] of Object.entries(def)) {
      const geom = isGeometry(k)
      if (!geom && modeIds.some((m) => k.endsWith(m)) &&
          !MODE_SUFFIX_RENDER_SIDE.some((re) => re.test(k))) swallowed.push(k)
      if (geom && v !== null && typeof v === 'object') nonScalar.push(`${group}.${k}`)
    }
  }
  const problems = []
  if (swallowed.length) problems.push(
    `${swallowed.map((k) => `"${k}"`).join(', ')} name a draw mode but match a ` +
    `RENDER_SIDE prefix, so they are excluded from the rebuild key and will never ` +
    `rebuild geometry. Rename them, or — if they really are style resolved by ` +
    `layerStyle() — add the pattern to MODE_SUFFIX_RENDER_SIDE.`)
  if (nonScalar.length) problems.push(
    `${nonScalar.map((k) => `"${k}"`).join(', ')} are geometry parameters with ` +
    `non-scalar defaults. geometryKey() stringifies, so edits inside them would ` +
    `never trigger a rebuild. Flat-name them (gain0…gain5) or declare them in ` +
    `GEOMETRY_NON_SCALAR and depend on them by identity.`)
  if (problems.length) throw new Error('[params] ' + problems.join('  '))
}

auditParamSpace(GROUPS, DRAW_MODE_IDS)

/**
 * Every parameter that can move a vertex, sorted so the key below is stable.
 *
 * Computed once at module load — this is a property of the parameter space, not
 * of any particular render.
 */
export const GEOMETRY_KEYS = [...GROUP_OF.keys()].filter(isGeometry).sort()

/**
 * The rebuild contract as one comparable value.
 *
 * Replaces the hand-written dependency array. A new draw mode's params are
 * covered the moment they exist in `defaults.js`; a param that should *not*
 * rebuild is excluded by naming it in RENDER_SIDE above, which is a statement
 * about that parameter rather than an omission from a list nobody can audit.
 *
 * A string rather than a hash: it is built from ~172 short values once per
 * render and compared by React as a single dependency, against a worker round
 * trip measured in tens of milliseconds. ` ` separates the value from the
 * next key so no pair of values can spell another pair.
 */
export function geometryKey(p) {
  let s = ''
  for (const k of GEOMETRY_KEYS) s += k + ' ' + p[k] + ' '
  return s
}
