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
 */
export const DRAW_MODES = [
  {
    id: 'Lines', label: 'Lines', cost: 1,
    pick: { spacing: [2, 14], angle: [0, 180], shift: [0, 6] },
  },
  {
    id: 'Cross', label: 'Crosshatch', cost: 1.5,
    pick: { spacing: [3, 16], angle: [0, 90] },
  },
  {
    id: 'Pillars', label: 'Pillars', cost: 2,
    pick: { spacing: [4, 20], pillarGap: [0, 0.4], pillarDepth: [0, 20], pillarSize: [0.3, 1] },
  },
  {
    id: 'Contours', label: 'Contours', cost: 1.5,
    pick: { interval: [2, 12], majorInterval: [4, 12], smoothing: [0, 3] },
  },
  {
    id: 'Hachure', label: 'Hachure', cost: 1.5,
    pick: { spacing: [2, 12], length: [0.5, 2.5] },
  },
  {
    id: 'Flow', label: 'Flow lines', cost: 2.5,
    pick: { spacing: [4, 20], step: [0.5, 2], maxLen: [40, 200] },
  },
  {
    id: 'Dag', label: 'Stream network', cost: 2.5,
    pick: { threshold: [1, 6] },
  },
  {
    id: 'Pencil', label: 'Pencil shading', cost: 1.5,
    pick: { spacing: [2, 10], threshold: [0.2, 0.8] },
  },
  {
    id: 'Ridge', label: 'Ridges', cost: 2,
    pick: { spacing: [1, 4], radius: [1, 4], threshold: [0.05, 0.4] },
  },
  {
    id: 'Valley', label: 'Valleys', cost: 2,
    pick: { spacing: [1, 5], radius: [1, 5], threshold: [0.2, 0.9] },
  },
  {
    id: 'Stipple', label: 'Stipple dots', cost: 3.5,
    pick: { spacing: [0.3, 1.2], gamma: [0.6, 2.2], jitter: [0.2, 1] },
  },
  {
    id: 'Iso', label: 'Isophotes', cost: 2,
    pick: { levels: [4, 12], gamma: [0.7, 1.8], smoothing: [0, 2], radius: [4, 9] },
  },
  {
    id: 'Engrave', label: 'Engraving', cost: 3,
    pick: { spacing: [2, 8], angle: [0, 180], levels: [2, 4], gamma: [0.8, 2.2] },
  },
  {
    id: 'Curv', label: 'Curvature', cost: 3.5,
    pick: { spacing: [2, 10], length: [20, 120], threshold: [0.05, 0.4] },
  },
  {
    id: 'Swiss', label: 'Rock & scree', cost: 3.5,
    pick: { spacing: [1, 6], threshold: [0.25, 0.7], length: [0.5, 2], scree: [0, 1] },
  },
  {
    id: 'Bitplane', label: 'Bitplane', cost: 1.5,
    pick: { tiers: [5, 18], dither: [0.4, 1], spacing: [1.5, 5] },
  },
  {
    id: 'Flashbulb', label: 'Flashbulb', cost: 4.5,
    pick: { azimuth: [0, 360], distance: [0.5, 1.6], height: [1.2, 2.8],
            falloff: [1, 2.2], exposure: [1.4, 2.6], contrast: [1, 1.7], spacing: [1.5, 4] },
  },
]

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

/** Style keys belonging to one mode, used for block-level crossover. */
export function modeKeys(id, style) {
  return Object.keys(style).filter((k) => k.endsWith(id))
}
