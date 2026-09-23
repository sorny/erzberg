/**
 * Which stage each panel section belongs to.
 *
 * The fourth index over the panel, beside `sectionTerms.js` (what a section
 * answers to in the filter), `sectionSummary.js` (what it says while shut) and
 * `sectionParams.js` (what a reset of it puts back). This one answers *which of
 * the rail's destinations holds it*, and it exists because the rail has to
 * answer two questions the rendered tree cannot:
 *
 *  • How many live sections are in a stage you are not looking at? The rail
 *    badges say so, and a hidden pane's sections are exactly the ones you cannot
 *    count by looking.
 *
 *  • Where did the filter find its hits? A search crosses every pane, so a
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
 * The rail, in order: the Presets slot, then the six pipeline stages.
 *
 * Each is its number, its name, and the abbreviation the 40 px rail can fit.
 * The short form is stated rather than sliced: `Frame` fits whole, `Overlay`
 * truncates to something that reads as a word, and `title.slice(0, 4)` would
 * give `Outp` for Output and `Grou` for Ground — both worse than a chosen pair
 * of syllables. The full name is still on screen: the rail carries the short
 * form, and the stage rule at the top of the pane carries the whole word.
 */
export const STAGES = [
  [0, 'Presets', 'PRST'],
  [1, 'Terrain', 'Terr'],
  [2, 'Surface', 'Surf'],
  [3, 'Marks',   'Mark'],
  [4, 'Overlay', 'Over'],
  [5, 'Frame',   'Frame'],
  [6, 'Output',  'Out'],
]

/**
 * Presets is a destination, not a step.
 *
 * It writes style, particles and view in one act, so it belongs to every pane
 * downstream and to none of them — it sat in Source only because the load block
 * did. A slot above the pipeline, set apart by a rule and numbered with a
 * lozenge rather than a digit, says plainly that it is somewhere you go rather
 * than a stage the renderer runs.
 *
 * Named for the one section it holds, and abbreviated `PRST` because the rail
 * has about 29 px once the badge lane is taken out. The alternative was a
 * second word for the same thing, and the panel already carries two — the line
 * under the load block reads `Style  Alpine Survey`, and the grid inside says
 * `STYLES (56)`.
 */
export const PRESETS_STAGE = 0

/** The stage the panel opens on. Terrain, because that is where a drawing starts. */
export const FIRST_STAGE = 1

/**
 * The 26 sections that are not draw modes.
 *
 * The load block stays at the top of Ground, which is the pane the panel opens
 * on: it was the top of the body, and with one pane on screen at a time that had
 * to become the top of some pane. Presets left with the move to Looks, because a
 * configuration applied all at once is not a step in the pipeline.
 */
const STATED = {
  'Presets': 0,   // its own destination, above the pipeline

  // Terrain, in one list: the ways a plate arrives, the controls that rewrite
  // it, then what the ground is made of. It was built with three headings over
  // those and they came out again — seven sections on one screen do not need
  // to be told apart.
  //
  // `Shape` rather than `Terrain`, because the stage took that word. It is the
  // honest name for what the section holds: resolution, elevation scale, blur,
  // jitter and the two cuts all change the shape of the ground before anything
  // draws it. `Fetch` needs no noun — the stage supplies it.
  'Fetch': 1,
  'Soundscapes': 1,
  'Shape': 1,
  'Levels': 1,
  'Hydraulic Erosion': 1,
  'Land Cover': 1,
  'Masks': 1,

  // Surface. Satellite is here because six of its nine controls paint an image
  // onto the ground — a drape is a surface treatment, whatever fetched it.
  'Terrain Style': 2,
  'Satellite': 2,
  // Texture composites one line after Satellite in the same surface shader, so
  // it colours the ground rather than sitting over it. It was in Overlay, two
  // panes from the thing it is drawn beside.
  'Texture': 2,
  'Hillshade': 2,
  'Slope Shading': 2,
  'Water Fill': 2,
  'Aspect Map': 2,

  'Draw Modes': 3,

  // Overlay is separate geometry, drawn after the surface finishes.
  'Vector Layers': 4,
  'Text': 4,
  'Particles': 4,

  // Frame: the camera, then the page. `View` used to hold both and `Camera`
  // held the rest of the first one, so framing a shot meant two sections that
  // were not adjacent. The order carries that now — no heading does.
  'Camera': 5,
  'Mirror': 5,
  'Anaglyph': 5,
  'Paper': 5,
  'Scale and North': 5,

  'Export': 6,
  'Analysis': 6,
}

/**
 * Sections that always carry a value, and so are never "on".
 *
 * The rail badge counts lit sections, and "lit" is what the green dot means: a
 * section whose on/off state the panel can see. These four always state a
 * setting — a resolution, a black point, a lens, a mode count — so they pass no
 * `enabled`, carry no dot, and would otherwise make Ground read `2` and Frame
 * read `1` on a panel where nothing at all is switched on.
 *
 * Paper is not among them: it says `—` until the frame is switched on, which is
 * exactly what a dot is for.
 * `panel.spec.js` holds this to the rendered panel: every title here must be a
 * section that renders no dot.
 */
export const ALWAYS_VALUED = new Set([
  'Shape', 'Levels', 'Camera', 'Draw Modes',
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
