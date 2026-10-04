/**
 * The Colour row's choices. A leaf module, so the row's rules can be unit
 * tested and the panel file exports components only.
 */
// The modes whose builders integrate a speed: the descent family. Every other
// mode passes none, so Speed would be slope under another name.
const SPEED_MODES = new Set(['FallLine', 'Berm', 'Air', 'RaceLine'])

/**
 * The Colour row's choices, for one style block.
 *
 * One row for every mode: the line colour, a gradient by height, slope or
 * aspect (and speed for the descent family), the landform under the stroke
 * (in the Landforms mode's inks), or the land cover class or plate colour. The data is unchanged: `hypso<Id>` is whether a source is on, and
 * `hypsoMode<Id>` which. `classSource` is false where the mode inks by class
 * itself (Land cover) or has no grid under it (a vector layer).
 */
export function colourOptions({ prefix, current, classSource, hasPlate }) {
  const need = { disabled: !hasPlate, title: hasPlate ? undefined : 'Needs a land cover plate. Open one under Land Cover.' }
  return [
    ['Line', 'line'], ['Height', 'elevation'], ['Slope', 'slope'], ['Aspect', 'aspect'],
    ...(SPEED_MODES.has(prefix) || current === 'speed' ? [['Speed', 'speed']] : []),
    ...(classSource ? [['Form', 'form'], ['Class', 'class', need], ['Plate', 'plate', need]] : []),
  ]
}
