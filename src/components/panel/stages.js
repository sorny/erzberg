/**
 * Which stage each panel section belongs to.
 *
 * The fourth index over the panel, beside `sectionTerms.js` (what a section
 * answers to in the filter), `sectionSummary.js` (what it says while shut) and
 * `sectionParams.js` (what a reset of it puts back). This one answers *which of
 * the six panes holds it*, and it exists because the rail has to answer two
 * questions the rendered tree cannot:
 *
 *  • How many live sections are in a stage you are not looking at? The rail
 *    badges say so, and a hidden pane's sections are exactly the ones you cannot
 *    count by looking.
 *
 *  • Where did the filter find its hits? A search crosses all six panes, so a
 *    result in Frame has to be reachable from Marks.
 *
 * ── Two thirds of it is derived ──────────────────────────────────────────────
 * Every draw mode is in Marks, and `PANEL_MODES` already states the modes in
 * panel order. So 34 of the 60 need no table: they are stage 3 by construction,
 * and a mode added to `PANEL_MODES` lands in the right pane with no edit here.
 *
 * The other 26 are stated below. `panel.spec.js` holds the two together: every
 * key in `SECTION_TERMS` is owned by exactly one stage, and every stage owns at
 * least one section. A section missing from here would render in no pane at all,
 * which is a control that exists and cannot be reached.
 *
 * A leaf module with no React import, for the reason its three siblings give:
 * the specs assert it against `SECTION_TERMS`, and that is only cheap if
 * importing the index does not drag three.js in behind it.
 */
import { PANEL_MODES } from './sectionSummary'

/**
 * The six stages, in pipeline order.
 *
 * Each is its number, its name, and the abbreviation the 40 px rail can fit.
 * The short form is stated rather than sliced: `Frame` fits whole, `Overlay`
 * truncates to something that reads as a word, and `title.slice(0, 4)` would
 * give `Outp` for Output and `Sour` for Source — both worse than a chosen pair
 * of syllables. The full name is still on screen: the rail carries the short
 * form, and the stage rule at the top of the pane carries the whole word.
 */
export const STAGES = [
  [1, 'Source',  'Src'],
  [2, 'Surface', 'Surf'],
  [3, 'Marks',   'Mark'],
  [4, 'Overlay', 'Over'],
  [5, 'Frame',   'Frame'],
  [6, 'Output',  'Out'],
]

/** The stage the panel opens on. Source, because that is where a drawing starts. */
export const FIRST_STAGE = 1

/**
 * The 26 sections that are not draw modes.
 *
 * `Presets` and the load block are in Source with them. That is not a
 * relocation for its own sake: the block sat at the top of the body, and with
 * one pane on screen at a time "the top of the body" had to become the top of
 * *some* pane. Source is the one a drawing starts in, and it is the pane the
 * panel opens on, so a first visit sees exactly the order it saw before.
 */
const STATED = {
  'Presets': 1,
  'Fetch Terrain': 1,
  'Satellite': 1,
  'Masks': 1,
  'Land Cover': 1,
  'Terrain': 1,
  'Levels': 1,
  'Hydraulic Erosion': 1,
  'Soundscapes': 1,

  'Terrain Style': 2,
  'Hillshade': 2,
  'Slope Shading': 2,
  'Water Fill': 2,
  'Aspect Map': 2,

  'Draw Modes': 3,

  'Vector Layers': 4,
  'Text': 4,
  'Particles': 4,
  'Texture': 4,

  'View': 5,
  'Anaglyph': 5,
  'Scale and North': 5,
  'Camera': 5,
  'Mirror': 5,

  'Export': 6,
  'Analysis': 6,
}

/**
 * Sections that always carry a value, and so are never "on".
 *
 * The rail badge counts lit sections, and "lit" is what the green dot means: a
 * section whose on/off state the panel can see. These five always state a
 * setting — a resolution, a black point, a paper size, a lens, a mode count —
 * so they pass no `enabled`, carry no dot, and would otherwise make Source read
 * `2` and Frame read `1` on a panel where nothing at all is switched on.
 *
 * The same five are named in the panel's own shape note for the same reason.
 * `panel.spec.js` holds this to the rendered panel: every title here must be a
 * section that renders no dot.
 */
export const ALWAYS_VALUED = new Set([
  'Terrain', 'Levels', 'View', 'Camera', 'Draw Modes',
])

/** Section title → stage number. Built once at module load. */
export const STAGE_OF = new Map([
  ...Object.entries(STATED),
  ...PANEL_MODES.map(([title]) => [title, 3]),
])

/** The stage that holds a section, or `undefined` for a title with no pane. */
export function stageOf(title) {
  return STAGE_OF.get(title)
}
