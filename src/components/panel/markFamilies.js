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
 * The families, and which marks are in each.
 *
 * Eighty tiles in one grid is a catalogue you read by scanning. The families
 * were always there in the marks themselves and nothing on screen said so:
 * Fall Line, Berms, Air and Race Line are one idea — something with mass went
 * down this slope — and they sat among unrelated neighbours.
 *
 * A family is the idea a mark draws, not how its builder works: Flow Time is
 * a level set and sits with the water, because water is what it shows. Where
 * a mark has two ideas, the one a reader would look for wins. Watershed is a
 * fill, but it is found by looking for water.
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
  ['Line',     'long lines laid across the ground',
    ['Lines', 'Contours', 'Crossings', 'Wiggle Traces', 'Curvature', 'Loxodromes']],
  ['Form',     'the skeleton of the ground: crests, troughs, breaks and summits',
    ['Ridges', 'Valleys', 'Breaklines', 'Surface Network', 'Spines', 'Prominence', 'Bedding']],
  ['Water',    'where the water goes',
    ['Flow Lines', 'Network', 'Flow Time', 'Venation', 'Watershed']],
  ['Tone',     'many small marks add up to a grey',
    ['Crosshatch', 'Hachure', 'Engraving', 'Pencil', 'Stipple Dots', 'Sediment', 'Rock & Scree', 'Slope Classes', 'Reticulation', 'Roughness Mesh', 'TIN Facets', 'Single Line', 'Coral', 'Hair']],
  ['Glyph',    'one sign per cell of a grid, chosen or sized by the ground',
    ['Louvres', 'Line Printer', 'Tally', 'Cross-Stitch', 'Truchet']],
  ['Relief',   'the ground given thickness',
    ['Pillars', 'Bitplane', 'Sprite Blocks', 'Stems', 'Summit Envelope']],
  ['Light',    'a lamp, a sun, or a year of one',
    ['Isophotes', 'Shadow Line', 'Shadow Hatch', 'Sun Hours', 'Light Shafts', 'Flashbulb', 'Halation', 'Radar']],
  ['Weather',  'wind, rain, frost and ice at work on the ground',
    ['Wind', 'Orographic Rain', 'Sand Ripples', 'Hoarfrost', 'Glacier']],
  ['Momentum', 'something with mass went down this slope',
    ['Fall Line', 'Berms', 'Air', 'Race Line', 'Runout']],
  ['Station',  'measured from a point you pick on the ground',
    ['Route', 'Isochrones', 'Viewshed', 'Panorama', 'Geodesic Fan']],
  ['Plate',    'colour rather than mark-making',
    ['Indexed', 'Riso', 'Mineral', 'Landforms', 'Land Cover', 'Outrun']],
  ['Symbol',   'map signs: trees, stars, fronts and the sheet grid',
    ['Tree Line', 'Constellation', 'Weather Fronts', 'Map Grid']],
  ['Chart',    'the ground as a diagram, laid flat above it',
    ['Waveform', 'Profile Sheet', 'Swath Profile', 'Hypsometry', 'Aspect Rose', 'Stereonet']],
]
