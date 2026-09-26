/**
 * Which family each mark belongs to, and the order the sheet draws them in.
 *
 * The fifth index over the panel, and the only one that is a judgement rather
 * than a fact: `sectionTerms.js` says what a section answers to,
 * `sectionSummary.js` what it says while shut, `sectionParams.js` what a reset
 * restores and `stages.js` which pane holds it. This one says *what kind of
 * mark it is*, which nothing in the code can derive — `Bitplane` and `Sprite
 * Blocks` share a builder with neither of their neighbours here.
 *
 * A leaf module with no React import, for the reason the other four give: the
 * specs assert it against `PANEL_MODES`, and that is only cheap if importing
 * the index does not drag three.js in behind it.
 */
/**
 * The six families, and which marks are in each.
 *
 * Thirty-four tiles in one grid is a catalogue you read by scanning. The
 * families were always there in the marks themselves and nothing on screen said
 * so: Fall Line, Berms, Air and Race Line are one idea — something with mass
 * went down this slope — and they sat among thirty-three unrelated neighbours.
 *
 * Headings only. They do not collapse and they carry no state, because the pane
 * is already one screen and a disclosure here would be a click that saves no
 * scrolling. The names are the part most likely to want changing; the grouping
 * underneath them is the part that has to be right.
 *
 * Stated rather than derived. A mode's family is a judgement about what it puts
 * on paper, and nothing in `drawModes.js` records it — `Bitplane` and `Sprite
 * Blocks` share a builder with neither of their neighbours here.
 *
 * Every mark must appear exactly once. `ModeSheet.test.js` holds this against
 * `PANEL_MODES`, so a mode added to the panel and forgotten here fails at the
 * unit level rather than by quietly vanishing from the sheet.
 */
export const FAMILIES = [
  ['Line',     'the pen leaves the paper and comes back',
    ['Lines', 'Contours', 'Flow', 'Network', 'Ridge', 'Valley', 'Curvature', 'Isophotes', 'Crossings', 'Isochrones', 'Route']],
  ['Tone',     'many small marks add up to a grey',
    ['Crosshatch', 'Hachure', 'Pencil', 'Engraving', 'Stipple Dots', 'Rock & Scree', 'Reticulation', 'Single Line', 'Roughness Mesh', 'Truchet']],
  ['Relief',   'the ground given thickness',
    ['Pillars', 'Bitplane', 'Sprite Blocks', 'Section']],
  ['Plate',    'colour rather than mark-making',
    ['Indexed', 'Riso', 'Mineral', 'Land cover', 'Watershed', 'Outrun']],
  ['Light',    'a lamp, a sun, or a year of one',
    ['Flashbulb', 'Halation', 'Shadow Line', 'Shadow Hatch', 'Sun Hours', 'Viewshed']],
  ['Momentum', 'something with mass went down this slope',
    ['Fall Line', 'Berms', 'Air', 'Race Line']],
]
