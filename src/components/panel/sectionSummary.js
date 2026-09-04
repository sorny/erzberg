/**
 * What each panel section says about itself while it is shut.
 *
 * A closed section used to say its name and nothing else, so a tidy panel was a
 * blind one: fifty headers, and the only way to learn that Hillshade was lit at
 * 315° was to open it. Every one of these strings is read off the same state the
 * section's own controls are bound to, so the header and the controls cannot
 * disagree — there is no second copy of anything here.
 *
 * A leaf module beside `sectionTerms.js`, and for the same reasons. It is an
 * index over the panel rather than part of a component, and `panel.spec.js`
 * asserts it against `SECTION_TERMS` in both directions, which it can only do
 * cheaply if importing the index does not drag React and three.js in behind it.
 *
 * ── Three conventions ────────────────────────────────────────────────────────
 * **Off is a dash.** `—`, never the word. The eye skips a dash and lands on the
 * values, which is what turns fifty rows into the handful that are doing
 * something. Spelling it out makes every idle section as loud as a working one.
 *
 * **One fact, two at most.** A header has room for roughly fourteen characters
 * beside a short title and about three beside a long one. A fact too many does
 * not truncate gracefully — it pushes the section's own name out of view, and
 * `MODE: CROSSHA…` costs more than the value it bought. Where the value had to
 * lose its label to fit, the label comes back on hover as `hint`.
 *
 * **Silence means there is nothing to report.** Export, Analysis and Hydraulic
 * Erosion are actions, not settings: they hold no state that survives being
 * closed, so they are absent from the map below and their headers stay bare. A
 * dash there would claim they were switched off, which is a different thing.
 */

// ── Formatters ───────────────────────────────────────────────────────────────
/** The panel writes 4 as `4` and 0.5 as `0.5`, never as `4.0`. */
const num = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100))
const pct = (v) => `${Math.round((v ?? 0) * 100)}%`
const deg = (v) => `${Math.round(v ?? 0)}°`
const OFF = '—'

/** `on ? value : OFF`, so the call sites below read as one line each. */
const when = (on, value) => (on ? value : OFF)

/**
 * The draw modes, in panel order.
 *
 * Exported, because it is the only place that order is written down and the
 * Draw Modes index has to agree with the list of sections below it — a grid
 * whose fourth tile is not the fourth section is a grid you cannot trust.
 *
 * Each is a title, the `style` key that switches it on, and the one parameter
 * that says most about what it is drawing — as a bare number, plus the label it
 * carries inside the section.
 *
 * The number is bare because a mode's title is already long: `MODE: CROSSHATCH`
 * fills most of a 244 px header on its own, and `every 10` beside it truncated
 * the section's own name to `MODE: CROSSHA…`. Two characters do not. Read down
 * the column the bare numbers are unambiguous enough — every row is the same
 * kind of thing, that mode's own dial — and the label comes back on hover, which
 * is what `hint` is for.
 */
export const PANEL_MODES = [
  ['Mode: Lines',          'enabledLines',     'Spacing',   (s) => num(s.spacingLines)],
  ['Mode: Crosshatch',     'enabledCross',     'Spacing',   (s) => num(s.spacingCross)],
  ['Mode: Pillars',        'enabledPillars',   'Spacing',   (s) => num(s.spacingPillars)],
  ['Mode: Contours',       'enabledContours',  'Interval',  (s) => num(s.intervalContours)],
  ['Mode: Hachure',        'enabledHachure',   'Spacing',   (s) => num(s.spacingHachure)],
  ['Mode: Flow',           'enabledFlow',      'Spacing',   (s) => num(s.spacingFlow)],
  ['Mode: Network',        'enabledDag',       'Min order', (s) => num(s.thresholdDag)],
  ['Mode: Pencil',         'enabledPencil',    'Spacing',   (s) => num(s.spacingPencil)],
  ['Mode: Ridge',          'enabledRidge',     'Spacing',   (s) => num(s.spacingRidge)],
  ['Mode: Valley',         'enabledValley',    'Spacing',   (s) => num(s.spacingValley)],
  ['Mode: Stipple Dots',   'enabledStipple',   'Spacing',   (s) => num(s.spacingStipple)],
  ['Mode: Isophotes',      'enabledIso',       'Levels',    (s) => num(s.levelsIso)],
  ['Mode: Engraving',      'enabledEngrave',   'Spacing',   (s) => num(s.spacingEngrave)],
  ['Mode: Curvature',      'enabledCurv',      'Spacing',   (s) => num(s.spacingCurv)],
  ['Mode: Rock & Scree',   'enabledSwiss',     'Spacing',   (s) => num(s.spacingSwiss)],
  ['Mode: Bitplane',       'enabledBitplane',  'Tiers',     (s) => num(s.tiersBitplane)],
  ['Mode: Indexed',        'enabledIndexed',   'Tiers',     (s) => num(s.tiersIndexed)],
  ['Mode: Outrun',         'enabledOutrun',    'Levels',    (s) => num(s.levelsOutrun)],
  // Riso and Mineral are separations rather than one mark: the ink count is the
  // fact, and the algorithm fixes it rather than a slider. Both titles are short
  // enough to carry the word.
  ['Mode: Riso',           'enabledRiso',      'Inks',      () => '3 inks'],
  ['Mode: Mineral',        'enabledMineral',   'Inks',      () => '5 inks'],
  ['Mode: Watershed',      'enabledShed',      'Inks',      (s) => `${num(s.inksShed)} inks`],
  ['Mode: Flashbulb',      'enabledFlashbulb', 'Azimuth',   (s) => deg(s.azimuthFlashbulb)],
  ['Mode: Halation',       'enabledHalation',  'Azimuth',   (s) => deg(s.azimuthHalation)],
  ['Mode: Fall Line',      'enabledFallLine',  'Spacing',   (s) => num(s.spacingFallLine)],
  ['Mode: Berms',          'enabledBerm',      'Spacing',   (s) => num(s.spacingBerm)],
  ['Mode: Air',            'enabledAir',       'Spacing',   (s) => num(s.spacingAir)],
  ['Mode: Race Line',      'enabledRaceLine',  'Fan',       (s) => num(s.fanRaceLine)],
  ['Mode: Section',        'enabledSection',   'Cut',       (s) => pct(s.cutSection)],
  ['Mode: Zero Crossings', 'enabledZeroCross', 'Spacing',   (s) => num(s.spacingZeroCross)],
  ['Mode: Sprite Blocks',  'enabledSprite',    'Tiers',     (s) => num(s.tiersSprite)],
  ['Mode: Reticulation',   'enabledRetic',     'Cells',     (s) => num(s.cellRetic)],
]

/**
 * The plate, in one line, for the top of the panel.
 *
 * The section readouts answer "what is this control set to". This answers the
 * question above them: *what am I looking at*. Thirty-one draw modes compose
 * freely and nothing on screen ever said how many were drawing — you counted
 * green dots down 2 239 px of scroll, or you did not know.
 *
 * The ink count is the one a plotter user actually needs, so it counts pens and
 * not settings. Most modes carry a single `color*`, and a set of those is what
 * they need between them — two modes in the same black are one pen. A few are
 * separations and carry a lettered set instead, and where a mode has both, only
 * the lettered ones reach the geometry: `geometryBuilders` is handed
 * `colorAMineral`…`colorEMineral` and never `colorMineral`, so counting the
 * base as a sixth pen would be counting a value nothing draws with.
 *
 * Watershed is the exception to all of it. It generates one ink per basin while
 * the geometry is built, so there is nothing here to name and `inksShed` is the
 * count itself.
 *
 * @returns {{marks: number, inks: number, layers: number, text: number}}
 */
export function buildPlateLine({ style = {}, vectorLayers = [], textLayers = [] } = {}) {
  const inks = new Set()
  let marks = 0
  let generated = 0
  for (const [, key] of PANEL_MODES) {
    if (!style[key]) continue
    marks++
    // The suffix on `enabled*` is the suffix on `color*`, which is what makes
    // this a lookup rather than a second table to keep in step.
    const suffix = key.slice('enabled'.length)
    if (suffix === 'Shed') { generated += style.inksShed ?? 0; continue }
    const lettered = ['A', 'B', 'C', 'D', 'E']
      .map((l) => style[`color${l}${suffix}`]).filter(Boolean)
    const used = lettered.length ? lettered : [style[`color${suffix}`]].filter(Boolean)
    for (const ink of used) inks.add(String(ink).toLowerCase())
  }
  return {
    marks,
    inks: inks.size + generated,
    layers: vectorLayers.filter((l) => l.visible !== false).length,
    text: textLayers.length,
  }
}

/**
 * The sections that say nothing, and why each one is silent.
 *
 * Export, Analysis and Hydraulic Erosion are actions rather than settings: they
 * hold nothing that survives being closed. Presets is the one deliberate
 * omission — the applied style already has a permanent line at the top of the
 * panel, above the filter, and a header that repeats it costs a row and adds no
 * fact.
 *
 * Exported because `panel.spec.js` checks this file against `SECTION_TERMS` in
 * both directions. Without the list, "every section has a summary" could only be
 * asserted by hard-coding a number, which is what went stale last time.
 */
export const SECTIONS_WITHOUT_SUMMARY = ['Presets', 'Hydraulic Erosion', 'Export', 'Analysis']

/**
 * Build the whole map, keyed by section title.
 *
 * One object per render of the panel rather than a closure per section: the
 * `Section` component reads its own line out of the filter context by title, the
 * same way it already reads its search terms, so none of the fifty call sites
 * has to pass anything.
 *
 * @param {object} src              everything the summaries read
 * @param {object} src.terrain      TERRAIN_DEF-shaped params
 * @param {object} src.style        STYLE_DEF-shaped params
 * @param {object} src.view         VIEW_DEF-shaped params
 * @param {object} src.points       POINTS_DEF-shaped params
 * @param {number} src.zoomPercent  the zoom the View section itself displays
 * @param {Array}  src.vectorLayers vector layer records
 * @param {Array}  src.textLayers   text layer records
 * @param {object} src.soundscape   the soundscape hook's state
 * @returns {Record<string, string | {text: string, hint: string}>}
 *   title → what that section says while shut, and for the draw modes the label
 *   the number lost, which `Section` hangs on the readout as a tooltip
 */
export function buildSectionSummaries({
  terrain = {}, style = {}, view = {}, points = {},
  zoomPercent = 100, vectorLayers = [], textLayers = [], soundscape = null,
} = {}) {
  const out = {}

  // ── Source ────────────────────────────────────────────────────────────────
  // Raw terrain view replaces the resolution rather than joining it: it bypasses
  // every draw mode, so the stride it would have used is not what you are
  // looking at.
  out['Terrain'] = view.showRawTerrain
    ? 'raw'
    : `res ${num(terrain.resolution ?? 1)}` +
      (terrain.elevScale ? ` · ${terrain.elevScale > 0 ? '+' : ''}${terrain.elevScale.toFixed(1)}` : '')
  out['Levels'] = `${Math.round(terrain.blackPoint ?? 0)} – ${Math.round(terrain.whitePoint ?? 255)}`
  out['Soundscapes'] = soundscape?.fileName
    ? (soundscape.active ? 'playing' : 'loaded')
    : OFF

  // ── Surface ───────────────────────────────────────────────────────────────
  // A list of what is switched on, not a count: two of these are visually
  // nothing alike, and "2 on" would not tell you which two.
  const surface = []
  if (style.showFill) surface.push(style.fillHypsometric ? 'hypso' : 'fill')
  if (style.showMesh) surface.push('mesh')
  out['Terrain Style'] = surface.length ? surface.join(' · ') : OFF

  out['Hillshade'] = when(style.showHillshade,
    style.hillshadeMultiDir
      ? `multi · ${pct(style.hillshadeOpacity)}`
      : `${deg(style.hillshadeAzimuth)} · ${pct(style.hillshadeOpacity)}`)
  out['Slope Shading'] = when(style.showSlopeShade, pct(style.slopeShadeOpacity))
  out['Water Fill']    = when(style.showWaterFill,  `level ${pct(style.waterLevel)}`)
  out['Aspect Map']    = when(style.showAspectMap,  pct(style.aspectMapOpacity))

  // ── Marks ─────────────────────────────────────────────────────────────────
  // The index says how many of the thirty-one are drawing. It is the one header
  // whose readout is about the sections under it rather than about itself.
  out['Draw Modes'] = `${PANEL_MODES.filter(([, k]) => style[k]).length} of ${PANEL_MODES.length}`
  for (const [title, key, label, fact] of PANEL_MODES) {
    out[title] = style[key]
      ? { text: fact(style), hint: `${label} ${fact(style)}` }
      : OFF
  }

  // ── Overlay ───────────────────────────────────────────────────────────────
  const vis = vectorLayers.filter((l) => l.visible !== false).length
  out['Vector Layers'] = vectorLayers.length
    ? `${vis} of ${vectorLayers.length}`
    : OFF
  out['Text'] = textLayers.length ? `${textLayers.length} block${textLayers.length === 1 ? '' : 's'}` : OFF
  out['Particles'] = when(points.showPoints,
    (points.particleMode ?? 'hologram') === 'murmuration'
      ? `${num(points.flockCount ?? 0)} birds`
      : `every ${num(points.particleSpacing ?? 1)}`)
  out['Texture'] = when(style.showTexture, pct(style.textureOpacity))

  // ── Frame ─────────────────────────────────────────────────────────────────
  out['View'] = `${deg(view.tilt)} · ${Math.round(zoomPercent)}%` +
    (view.showFrame ? ' · frame' : '')
  out['Camera'] = (view.orthographic ? 'ortho' : `${Math.round(view.fov ?? 60)} mm`) +
    (view.panX || view.panY || view.panZ ? ' · panned' : '')
  // The three plus axes are the terrain as loaded, so only a minus axis is a
  // mirror. Naming them beats counting them — which side it was thrown to is the
  // whole question.
  const mirrored = [
    style.showMirrorMinusX && '−X',
    style.showMirrorMinusY && '−Y',
    style.showMirrorMinusZ && '−Z',
  ].filter(Boolean)
  out['Mirror'] = mirrored.length ? mirrored.join(' ') : OFF

  return out
}
