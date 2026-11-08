/**
 * The line of a set of guides: width, opacity, colour and dash.
 *
 * Shared by the centre guides (Camera) and the paper guides (Paper). `keys`
 * names the four view keys, and `prefix` the test ids.
 */
import { Btn, ColorRow, InlineSl, SegRow } from './ui'

export function GuideStyle({ view, sv, keys, prefix, opacity, dark }) {
  const color = view[keys.color] || ''
  return (
    <>
      <InlineSl label="Weight" testId={`${prefix}-weight`} min={0.5} max={4} step={0.25}
        help="Line width of the guides, in screen pixels."
        value={view[keys.weight] ?? 1} onChange={(v) => sv({ [keys.weight]: v })} fmt={(v) => `${v.toFixed(2)} px`} />
      <InlineSl label="Opacity" testId={`${prefix}-opacity`} min={0.05} max={1} step={0.05}
        value={view[keys.opacity] ?? opacity} onChange={(v) => sv({ [keys.opacity]: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      <SegRow label="Dash" testIdPrefix={`${prefix}-dash`}
        options={[['Solid', 'solid'], ['Dashed', 'dashed'], ['Dotted', 'dotted']]}
        value={view[keys.dash] ?? 'solid'} onChange={(v) => sv({ [keys.dash]: v })} />
      <ColorRow label="Colour" testId={`${prefix}-color`} value={color || (dark ? '#ffffff' : '#000000')}
        help="The guide colour. Auto takes black or white, whichever reads on the background."
        onChange={(v) => sv({ [keys.color]: v })} />
      {color && (
        <Btn size="xs" data-testid={`${prefix}-color-auto`} onClick={() => sv({ [keys.color]: '' })} style={{ marginTop: -4, marginBottom: 8 }}>
          Auto colour
        </Btn>
      )}
    </>
  )
}
