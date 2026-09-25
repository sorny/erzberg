/**
 * The canonical draw-mode list.
 *
 * The ids already exist twice — `MODES_CONFIG` in geometryBuilders.js binds them
 * to builder functions, and the sidebar listed them again to know which layers
 * carry a hypsometric toggle. Anything that wants to *reason* about the modes
 * rather than run them — the randomiser and the panel — reads this instead, so
 * teaching the tool about a new mode is one edit here.
 *
 * `cost` is a rough rebuild expense, 1 = cheap. The randomiser spends a budget
 * rather than counting modes, so it will happily roll three cheap layers but
 * rarely stacks Stipple on Swiss on Curvature and hands back something that
 * takes a second per frame.
 *
 * `pick` holds the ranges the *randomiser* draws from — deliberately narrower
 * than the sliders. Spacing runs to 100 in the UI, which is a legitimate thing
 * to ask for by hand and an almost-empty canvas to be handed at random.
 *
 * `mark` names the glyph in `panel/modeMarks.jsx` that shows what this mode puts
 * on paper. It lives here rather than in the panel because it is a fact about
 * the mode and not about one view of it — the section header draws it, and so
 * does the index that shows all thirty-four at once.
 *
 * `needsData` marks a mode that draws nothing without a file the app cannot roll
 * — today only the cover plate. Such a mode carries no `pick` block and the
 * randomiser skips it, because a roll has to stay a pure function of its seed.
 */
export const DRAW_MODES = [
  {
    id: 'Lines', label: 'Lines', cost: 1, mark: 'lines',
    pick: { spacing: [2, 14], angle: [0, 180], shift: [0, 6] },
  },
  {
    id: 'Cross', label: 'Crosshatch', cost: 1.5, mark: 'crosshatch',
    pick: { spacing: [3, 16], angle: [0, 90] },
  },
  {
    id: 'Pillars', label: 'Pillars', cost: 2, mark: 'pillars',
    pick: { spacing: [4, 20], pillarGap: [0, 0.4], pillarDepth: [0, 20], pillarSize: [0.3, 1] },
  },
  {
    id: 'Contours', label: 'Contours', cost: 1.5, mark: 'contours',
    pick: { interval: [2, 12], majorInterval: [4, 12], smoothing: [0, 3] },
  },
  {
    id: 'Hachure', label: 'Hachure', cost: 1.5, mark: 'hachure',
    pick: { spacing: [2, 12], length: [0.5, 2.5] },
  },
  {
    id: 'Flow', label: 'Flow lines', cost: 2.5, mark: 'flow',
    pick: { spacing: [4, 20], step: [0.5, 2], maxLen: [40, 200] },
  },
  {
    id: 'Dag', label: 'Stream network', cost: 2.5, mark: 'network',
    pick: { threshold: [1, 6] },
  },
  {
    id: 'Pencil', label: 'Pencil shading', cost: 1.5, mark: 'pencil',
    pick: { spacing: [2, 10], threshold: [0.2, 0.8] },
  },
  {
    id: 'Ridge', label: 'Ridges', cost: 2, mark: 'ridge',
    pick: { spacing: [1, 4], radius: [1, 4], threshold: [0.05, 0.4] },
  },
  {
    id: 'Valley', label: 'Valleys', cost: 2, mark: 'valley',
    pick: { spacing: [1, 5], radius: [1, 5], threshold: [0.2, 0.9] },
  },
  {
    id: 'Stipple', label: 'Stipple dots', cost: 3.5, mark: 'stipple',
    pick: { spacing: [0.3, 1.2], gamma: [0.6, 2.2], jitter: [0.2, 1] },
  },
  {
    id: 'Iso', label: 'Isophotes', cost: 2, mark: 'isophotes',
    pick: { levels: [4, 12], gamma: [0.7, 1.8], smoothing: [0, 2], radius: [4, 9] },
  },
  {
    id: 'Engrave', label: 'Engraving', cost: 3, mark: 'engraving',
    pick: { spacing: [2, 8], angle: [0, 180], levels: [2, 4], gamma: [0.8, 2.2] },
  },
  {
    id: 'Curv', label: 'Curvature', cost: 3.5, mark: 'curvature',
    pick: { spacing: [2, 10], length: [20, 120], threshold: [0.05, 0.4] },
  },
  {
    id: 'Swiss', label: 'Rock & scree', cost: 3.5, mark: 'swiss',
    pick: { spacing: [1, 6], threshold: [0.25, 0.7], length: [0.5, 2], scree: [0, 1] },
  },
  {
    id: 'Bitplane', label: 'Bitplane', cost: 1.5, mark: 'bitplane',
    pick: { tiers: [5, 18], dither: [0.4, 1], spacing: [1.5, 5] },
  },
  {
    id: 'Flashbulb', label: 'Flashbulb', cost: 4.5, mark: 'flashbulb',
    pick: { azimuth: [0, 360], distance: [0.5, 1.6], height: [1.2, 2.8],
            falloff: [1, 2.2], exposure: [1.4, 2.6], contrast: [1, 1.7], spacing: [1.5, 4] },
  },
  {
    id: 'FallLine', label: 'Fall line', cost: 3, mark: 'fallline',
    pick: { spacing: [6, 20], carve: [0.2, 0.85], drag: [0.06, 0.2], maxLen: [120, 400] },
  },
  {
    id: 'Berm', label: 'Berms', cost: 3, mark: 'berm',
    pick: { spacing: [5, 16], carve: [0.4, 0.9], length: [1, 4] },
  },
  {
    id: 'Air', label: 'Air', cost: 3, mark: 'air',
    pick: { spacing: [5, 14], carve: [0.15, 0.6], drag: [0.04, 0.12], runIn: [4, 18] },
  },
  {
    id: 'RaceLine', label: 'Race line', cost: 3.5, mark: 'raceline',
    pick: { spacing: [25, 70], carve: [0.4, 0.9], fan: [7, 17], spread: [60, 180], drops: [2, 6] },
  },
  {
    id: 'Sprite', label: 'Sprite blocks', cost: 2, mark: 'sprite',
    pick: { tiers: [4, 14], spacing: [3, 12], size: [0.6, 1] },
  },
  {
    id: 'Retic', label: 'Reticulation', cost: 4, mark: 'retic',
    pick: { cell: [5, 26], spacing: [1, 4], width: [0.2, 1], gamma: [0.6, 2] },
  },
  {
    // Cheap, because the expensive half was already built. It is one call to the
    // shadow sweep Sun Hours sums over a year, traced at the single level where
    // lit meets unlit.
    id: 'ShadowLine', label: 'Shadow line', cost: 1.5, mark: 'shadowline',
    pick: { hour: [7, 17], smoothing: [0, 4], radius: [0, 3] },
  },
  {
    // The most expensive mode here by a distance: a few hundred shadow sweeps
    // over the whole grid per rebuild. The randomiser spends a budget rather
    // than counting modes, so this cost is what keeps it from rolling a look
    // that takes a second a frame.
    id: 'SunHours', label: 'Sun hours', cost: 7, mark: 'sunhours',
    pick: { levels: [4, 10], days: [6, 12], perDay: [8, 16], smoothing: [0, 3], radius: [0, 3] },
  },
  {
    // 'Crossings', not 'Zero crossings': the longer name was the one title in
    // the panel that could not fit its own header beside a readout. The id is
    // untouched, so every `*ZeroCross` parameter and every saved preset is too.
    id: 'ZeroCross', label: 'Crossings', cost: 1.5, mark: 'zerocross',
    pick: { detrend: [2, 16], spacing: [1, 6] },
  },
  {
    id: 'Section', label: 'Section', cost: 2, mark: 'section',
    pick: { cut: [0.2, 0.7], hatch: [2, 9], hatchAngle: [0, 180], beyond: [4, 16] },
  },
  {
    id: 'Halation', label: 'Halation', cost: 5, mark: 'halation',
    pick: { azimuth: [0, 360], height: [1.2, 2.8], falloff: [1, 2.2],
            exposure: [1.4, 2.6], bloom: [3, 14], bleed: [0.5, 1.4], glow: [0.4, 1.2],
            spacing: [1.5, 4] },
  },
  {
    id: 'Indexed', label: 'Indexed', cost: 2, mark: 'indexed',
    pick: { tiers: [4, 12], slopeBands: [1, 3], steepShift: [0.15, 0.6],
            dither: [0.4, 1], spacing: [1.5, 5] },
  },
  {
    id: 'Outrun', label: 'Outrun', cost: 2, mark: 'outrun',
    pick: { levels: [8, 26], whiten: [0.5, 0.9] },
  },
  {
    id: 'Riso', label: 'Riso', cost: 4, mark: 'riso',
    pick: { pitch: [1.5, 4], offset: [0, 2.4], limit: [0.7, 3], gammaA: [1.2, 3.2],
            gammaB: [1, 2.6], gammaC: [1.2, 3] },
  },
  {
    id: 'Mineral', label: 'Mineral', cost: 3, mark: 'mineral',
    pick: { spacing: [1.5, 5], radius: [1, 4], steep: [0.45, 0.8],
            broken: [0.25, 0.65], grain: [0.1, 0.5] },
  },
  {
    /*
     * `needsData` keeps this out of the randomiser, and it is the seed contract
     * that decides it rather than taste. A roll is reproducible because
     * `randomPreset` is a pure function of its seed — so it cannot be told
     * whether a cover plate happens to be loaded, and a mode that draws nothing
     * without one would come back as an empty layer on the same seed that gave
     * a picture yesterday. No `pick` ranges either, for the same reason: nothing
     * rolls this.
     */
    id: 'Cover', label: 'Land cover', cost: 3, mark: 'cover', needsData: true,
  },
  {
    id: 'Shed', label: 'Watershed', cost: 3, mark: 'shed',
    pick: { spacing: [1.5, 5], inks: [5, 16], minBasin: [0.1, 1.5], shade: [0.1, 0.55] },
  },
]

/** id → the label the panel and the plot both use. */
export const MODE_LABEL = Object.fromEntries(DRAW_MODES.map((m) => [m.id, m.label]))

/**
 * What each *part* of a multi-pen mode is called.
 *
 * A mode that returns sub-layers gets one pen layer each, and the name on that
 * layer is what makes a plot separable — it is the only thing the person at the
 * plotter reads. It used to be the raw id with a regex spacing out the capitals,
 * which produced "Contours- Minor", "Swiss- Scree" and "Riso- A", and left the
 * internal ids showing on any mode whose label differs from its id: "Dag" for a
 * stream network, "Retic" for reticulation, "Shed" for a watershed.
 *
 * Keyed by the whole id rather than the suffix, because the suffix is not always
 * unique or self-explanatory — "Face" means the cut face in a Section and would
 * mean something else anywhere else.
 */
export const SUB_LAYER_LABEL = {
  'Contours-Minor':          'Minor',
  'Contours-Major':          'Major',
  'Contours-Labels':         'Heights',
  'Contours-Tanaka-Bright':  'Tanaka, lit',
  'Contours-Tanaka-Dark':    'Tanaka, shaded',
  'Swiss-Rock':              'Cliff hachures',
  'Swiss-Scree':             'Scree',
  'Bitplane-Step':           'Staircase',
  'Bitplane-Screen':         'Dither screen',
  'Halation-Grain':          'Grain',
  'Halation-Bloom':          'Bloom',
  'Air-Flight':              'Flight',
  'Air-RunIn':               'Run-in',
  'RaceLine-Field':          'Field',
  'RaceLine-Best':           'Best line',
  'Section-Face':            'Cut face',
  'Section-Hatch':           'Hatch',
  'Section-Beyond':          'Beyond',
  'Outrun-Core':             'Filament',
  'Outrun-Glow':             'Halo',
  'Riso-A':                  'Ink A',
  'Riso-B':                  'Ink B',
  'Riso-C':                  'Ink C',
}

/**
 * What a layer is called on the plot.
 *
 * `Mode · Part`, with the same separator the vector layers already use for
 * "Roads · Motorway" and "Peaks · labels" — so one convention covers every pen
 * layer in the file whatever produced it.
 */
export function layerDisplayName(id) {
  if (!id) return 'Lines'
  if (MODE_LABEL[id]) return MODE_LABEL[id]
  const cut = id.indexOf('-')
  if (cut < 0) return id
  const base = MODE_LABEL[id.slice(0, cut)] ?? id.slice(0, cut)
  const part = SUB_LAYER_LABEL[id] ?? id.slice(cut + 1).replace(/([A-Z])/g, ' $1').trim()
  return `${base} · ${part}`
}

/** Draw-mode ids in pipeline order. */
export const DRAW_MODE_IDS = DRAW_MODES.map((m) => m.id)

/**
 * Every layer carrying a per-mode `hypso<Id>` toggle.
 *
 * The draw modes and only the draw modes: vector layers are hypsometric too, but
 * theirs is a field on a layer record rather than a `hypso<Id>` param, because
 * there is no fixed set of them to name here.
 */
export const HYPSO_LAYER_IDS = [...DRAW_MODE_IDS]
