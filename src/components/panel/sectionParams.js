/**
 * Which parameters each panel section owns.
 *
 * The third index over the panel, beside `sectionTerms.js` (what a section
 * answers to in the filter) and `sectionSummary.js` (what it says while shut).
 * This one answers *what would a reset of this section put back*, and it is the
 * only one where being wrong is destructive rather than merely unhelpful: a
 * section that resets a key it does not own throws away work in a part of the
 * panel the user was not looking at.
 *
 * ── Two thirds of it is derived ──────────────────────────────────────────────
 * Every draw mode's parameters end in that mode's id — `spacingLines`,
 * `colorLines`, `hypsoIntervalLines` — which is the same convention the worker
 * reads them by. So 503 of the 672 keys need no table at all: the id comes from
 * `PANEL_MODES`, and the keys are every default ending in it.
 *
 * Longest suffix wins, and that is load-bearing. `enabledZeroCross` ends in both
 * `Cross` and `ZeroCross`, so a first-match rule hands twelve of Crossings'
 * parameters to Crosshatch — and resetting Crosshatch would then silently
 * flatten a mode three sections further down.
 *
 * ── The rest is stated ───────────────────────────────────────────────────────
 * The remaining 169 predate the convention or belong to sections that are not
 * modes. They are listed below by hand, and `sectionParams.test.js` holds the
 * list to two things at once: every key in the four defaults is owned by exactly
 * one section, and each section's list matches the parameters that section's own
 * JSX actually renders. The second check is what catches a control moved from
 * one section to another, which is the way this table would really go stale.
 *
 * A section reads other sections' values all the time — Anaglyph prints the
 * background colour in a note, Export prints the frame orientation — so the test
 * cannot simply take the rendered set. Where the two disagree the *owner* is
 * listed here and the reader is named in `ALSO_READS`.
 */
import { PANEL_MODES } from './sectionSummary'

/** `Mode: Crosshatch` → `Cross`. The ids live in `enabled…` and nowhere else. */
export const MODE_ID = new Map(PANEL_MODES.map(([title, enabled]) => [title, enabled.slice(7)]))

/**
 * Sections that are not draw modes, and the mode parameters that predate the
 * suffix convention.
 *
 * A `RegExp` stands in for a family too long to be worth typing out — the
 * thirty-nine flocking parameters and the seven hologram ones. It is anchored,
 * so it is a prefix rule and not a search.
 */
export const SECTION_PARAMS = {
  'Shape': ['resolution', 'elevScale', 'blurRadius', 'gridOffsetX', 'gridOffsetY',
    'elevMinCut', 'elevMaxCut', 'jitterAmt', 'showRawTerrain'],
  'Levels': ['blackPoint', 'whitePoint'],
  'Terrain Style': ['showFill', 'fillColor', 'fillHypsometric', 'fillBanded',
    'fillHypsoInterval', 'fillHypsoWeight', 'fillHypsoMode', 'showMesh', 'meshColor',
    'bgColor', 'bgGradient', 'depthOcclusion', 'occlusionBias', 'occlusionColor',
    'occlusionOpacity', 'gradientStops'],
  'Hillshade': [/^hillshade/, 'showHillshade', 'showSun', 'showAO', 'aoStrength', 'aoRays'],
  'Slope Shading': ['showSlopeShade', 'slopeShadeOpacity', 'slopeColorLow', 'slopeColorHigh'],
  'Water Fill': ['showWaterFill', 'waterLevel', 'waterColor', 'waterOpacity'],
  'Aspect Map': ['showAspectMap', 'aspectMapOpacity'],
  'Satellite': ['showImagery', 'imageryOpacity', 'imageryAutoLevels',
                'imageryBrightness', 'imageryContrast', 'imagerySaturation'],
  'Texture': [/^texture/, 'showTexture'],
  'Mirror': [/^showMirror/],
  'Particles': ['showPoints', 'pointColor', 'pointSize', 'pointOpacity',
    'particleMode', 'particleSpacing', 'animateParticles', /^holo/, /^flock/],
  // `View` split in two. Everything that aims the camera is Camera's, and
  // everything that describes the sheet is Paper's — the two subjects the one
  // section used to carry between them.
  'Camera': ['tilt', 'rotation', 'zoom', 'renderScale', 'showGuides', /^autoRotate/,
    'fov', 'orthographic', 'panX', 'panY', 'panZ'],
  'Paper': ['showFrame', 'framePaper', 'frameLandscape', 'frameCustomRatio',
    'frameScale', 'frameOffsetX', 'frameOffsetY', 'frameMargin'],
  'Anaglyph': [/^anaglyph/],
  'Scale and North': ['frameScaleBar', 'frameNorth', 'frameMarkScale', 'frameMarkColor'],
  'Export': ['plotWidthMm', 'plotPenOrder'],
  // Older than the suffix rule, and left alone rather than renamed: the keys are
  // in every saved preset and every exported plate, and a rename is a migration.
  'Mode: Pillars': ['pillarGap', 'pillarDepth', 'pillarStyle', 'pillarSize',
    'pillarSegments', 'pillarLidColor'],
  'Mode: Stipple Dots': ['stippleDensityMode', 'stippleGamma', 'stippleJitter'],
  // Tanaka is the contour section's illumination — the relief shading that
  // lights each contour by its own bearing — so it resets with Contours.
  'Mode: Contours': ['tanakaSunAzimuth', 'tanakaWeightBright', 'tanakaWeightDark'],
}

/**
 * Values a section shows without owning.
 *
 * Each of these is read for a note, a disabled state or a derived readout —
 * Anaglyph names the background to say which way the filters combine, Export
 * says whether the SVG will cut at the frame. Listed so the drift test can tell
 * a legitimate read from a control that quietly moved house.
 */
export const ALSO_READS = {
  'Anaglyph': ['bgColor', 'orthographic'],
  'Export': ['frameLandscape', 'showFrame', 'plotWidthMm'],
  'Scale and North': ['orthographic', 'plotWidthMm', 'tilt'],
  'Texture': ['showFill'],
  'Vector Layers': ['rotation', 'tilt'],
  'Camera': ['resolution'],
  'Text': ['fillColor', 'resolution', 'tilt'],
  'Particles': ['hillshadeAzimuth', 'hillshadeAltitude'],
  'Mode: Sun Hours': ['elevScale', 'resolution'],
}

/**
 * Parameters with no control anywhere in the panel.
 *
 * All three are real: the worker reads them, `defaults.js` gives them values,
 * and nothing has ever drawn a slider for any of them. They still need an owner
 * — a preset can carry them, so a reset has to be able to put them back — but
 * the source check below cannot find them in a section's JSX because they are
 * not in anyone's JSX.
 */
export const UNEXPOSED = ['gridOffsetX', 'gridOffsetY', 'autoRotateAxis']

/**
 * What every draw mode section reads without owning.
 *
 * The hypsometric ramp: each mode can colour its marks by height, and each one
 * previews the ramp beside that switch. Thirty-three identical entries in
 * `ALSO_READS` would say the same thing at thirty-four times the length.
 */
export const MODE_READS = ['gradientStops']

/**
 * Memo for `paramsForSection`, which is a pure function of two fixed values.
 *
 * `allKeys` is a module-level array in all three callers and the section titles
 * are a fixed list, so the answer is a constant. It was rebuilt on every call,
 * and `modifiedSections` calls it once per section.
 *
 * That put it on the camera's path. An orbit writes tilt, rotation and zoom into
 * `view` at the throttled sync rate. The Sidebar's `modified` memo lists `view`
 * among its dependencies, so every section was re-derived about seven times a
 * second while the scene turned. Measured in a CPU profile of a 5 s auto-rotate:
 * 92 ms here and 67 ms in `modifiedSections`, against a 16.7 ms frame budget.
 *
 * The inner loop is why it costs that much. For a mode section it tests every
 * parameter key against every mode suffix to find the longest match, which is
 * about 172 x 34 string comparisons per section.
 *
 * Keyed on the `allKeys` array by identity, so a caller with a different key
 * list gets its own entry and nothing goes stale. The cached arrays are frozen
 * because every caller reads and none writes.
 */
const SECTION_KEYS = new WeakMap()

/**
 * Every parameter one section owns.
 *
 * The mode suffix and the table above, unioned — a mode can appear in both, and
 * Pillars, Stipple and Contours do. Returns an empty array for a section with no
 * settings of its own: Presets, Analysis, Fetch and Hydraulic Erosion
 * are actions, and there is nothing there to put back.
 */
export function paramsForSection(title, allKeys) {
  let cached = SECTION_KEYS.get(allKeys)
  if (!cached) { cached = new Map(); SECTION_KEYS.set(allKeys, cached) }
  const hit = cached.get(title)
  if (hit) return hit

  const out = new Set()
  const id = MODE_ID.get(title)
  if (id) {
    for (const k of allKeys) {
      // Longest suffix wins — see the note at the top about ZeroCross.
      let best = null
      for (const [, enabled] of PANEL_MODES) {
        const other = enabled.slice(7)
        if (k.endsWith(other) && (!best || other.length > best.length)) best = other
      }
      if (best === id) out.add(k)
    }
  }
  for (const rule of SECTION_PARAMS[title] ?? []) {
    if (rule instanceof RegExp) {
      for (const k of allKeys) if (rule.test(k)) out.add(k)
    } else if (allKeys.includes(rule)) {
      out.add(rule)
    }
  }
  const result = Object.freeze([...out])
  cached.set(title, result)
  return result
}

/** Sections that hold no settings, so no reset control is drawn on them. */
export function sectionHasParams(title, allKeys) {
  return paramsForSection(title, allKeys).length > 0
}

/**
 * The sections that currently differ from their defaults.
 *
 * The reset control is drawn from this rather than on every header, which is
 * the difference between a row of fifty-five identical icons and a panel that
 * says where the work is. Scrolling past a shut section and seeing the mark is
 * how you find the three sections you touched an hour ago.
 *
 * Compared by value, and `JSON.stringify` for the one parameter that is not a
 * scalar: `gradientStops` is an array of `{pos, color}` and `!==` on it is true
 * the moment the array is rebuilt, which a colour picker does on every drag.
 */
export function modifiedSections(state, defaults, titles, allKeys) {
  const out = new Set()
  for (const title of titles) {
    for (const k of paramsForSection(title, allKeys)) {
      const now = state[k], was = defaults[k]
      const same = (now && typeof now === 'object')
        ? JSON.stringify(now) === JSON.stringify(was)
        : now === was
      if (!same) { out.add(title); break }
    }
  }
  return out
}
