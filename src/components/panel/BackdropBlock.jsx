/**
 * What the raster is drawn as, in Edit Mode and in the Mask Studio.
 *
 * One component, because the two views make the same choice against the same
 * state, and two copies had already drifted: one had a heading, the imagery
 * line and the exposure controls, and the other had none of them.
 *
 * The exposure controls sit here as well as in the Satellite section. Aiming at
 * a boundary is exactly when you need them, and the sidebar that carries them
 * is hidden while either view is open.
 */
import { BACKDROP_OPTIONS } from '../../utils/rasterBackdrop'
import { DIM, InlineSl, MUTED, SegRow } from './ui'

export function BackdropBlock({ prefix, backdrop, setBackdrop, hasPhoto, imagery, style, ss }) {
  if (!setBackdrop) return null
  return (
    <>
      <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>Backdrop</div>
      <SegRow
        label="Show"
        testIdPrefix={`${prefix}-backdrop`}
        help="What you aim at. Satellite is a photograph and shows the boundary between worked ground and forest, which shaded relief cannot. Auto takes it when there is some. Edit Mode and the Mask Studio share this choice."
        options={BACKDROP_OPTIONS}
        value={backdrop}
        onChange={setBackdrop}
      />
      {imagery?.date ? (
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
          Sentinel-2 · {imagery.date} · {Math.round(imagery.cloud)}% cloud
        </div>
      ) : (
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
          No imagery fetched. Auto shows the relief.
        </div>
      )}
      {!hasPhoto && backdrop === 'imagery' && (
        <div style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.6 }}>
          Nothing to show. Fetch imagery in the Satellite section first.
        </div>
      )}
      {hasPhoto && style && ss && (
        <div style={{ marginTop: 6 }}>
          <SegRow
            label="Levels"
            testIdPrefix={`${prefix}-levels`}
            help="Sentinel-2 is exposed for cloud and snow, so ordinary ground arrives near black. Auto stretches this window's own histogram and lifts its midtones."
            options={[['Auto', 'auto'], ['Raw', 'raw']]}
            value={style.imageryAutoLevels ? 'auto' : 'raw'}
            onChange={(v) => ss({ imageryAutoLevels: v === 'auto' })}
          />
          <InlineSl label="Bright" testId={`${prefix}-bright`}
            min={0.2} max={2.5} step={0.01} value={style.imageryBrightness}
            onChange={(v) => ss({ imageryBrightness: v })} fmt={(v) => v.toFixed(2) + '×'} />
          <InlineSl label="Contrast" testId={`${prefix}-contrast`}
            min={0.4} max={2.2} step={0.01} value={style.imageryContrast}
            onChange={(v) => ss({ imageryContrast: v })} fmt={(v) => v.toFixed(2) + '×'} />
        </div>
      )}
    </>
  )
}
