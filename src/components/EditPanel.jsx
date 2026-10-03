/**
 * Right-hand panel while Edit Mode is on — replaces <Sidebar> for the duration.
 *
 * A separate panel rather than one more <Section> in the sidebar: editing is a
 * mode, not a setting, and every other control in the sidebar describes a
 * terrain that is not on screen while it is running.
 */
import { useEffect, useState } from 'react'
import { effectiveBounds, shapeRings } from '../utils/heightmapEdit'
import { featureRings } from '../utils/maskFromVector'
import { BackdropBlock } from './panel/BackdropBlock'
import { useFeaturePick } from './panel/FeaturePicker'
import { ACCENT, BG, BORDER, Btn, DANGER_TEXT, DIM, FONT, HelpBox, InlineSl, MUTED, PanelStyles, STRONG, SUNK, SegGroup, SegRow, TEXT, W } from './panel/ui'

/** Total vertices across every ring of a shape. */
const ringPoints = (shape) => shapeRings(shape).reduce((n, r) => n + (r.length >> 1), 0)

/** The same glyphs as the Mask Studio's, one per tool across both views. */
const TOOLS = [
  ['⬚ Crop',    'crop'],
  ['⬭ Ellipse', 'ellipse'],
  ['⌇ Lasso',   'lasso'],
  ['⬡ Polygon', 'polygon'],
  ['⌖ Features', 'features'],
]

const HINTS = {
  crop:    'Drag on the image to draw a crop, or grab a handle to resize it. The terrain is rebuilt from the crop, so a smaller one also rebuilds faster.',
  ellipse: 'Drag to draw an ellipse — hold Shift for a perfect circle. Drag inside it to move it, or use the eight handles to resize.',
  lasso:   'Drag to trace a free-hand outline. Afterwards the points stay editable: drag one to move it, drag an edge to add one there, right-click one to remove it.',
  polygon: 'Click to place corners; click the first one again, press Enter, or double-click to close. Once closed, drag its points to reshape it — or drag an edge to add a point.',
  features: 'Clip to the outline of loaded map features. The outline shows on the image while you pick, before you clip.',
}

/** Integer field that only publishes a parseable value. */
function NumField({ label, value, min, max, onChange, testId }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const publish = (raw) => {
    const n = parseInt(raw, 10)
    if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)))
    else setText(String(value))
  }
  return (
    <label style={{ display: 'block' }}>
      <span style={{ fontSize: 10, color: MUTED, display: 'block', marginBottom: 2 }}>{label}</span>
      <input
        className="hmnum" data-testid={testId} value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => publish(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); publish(e.currentTarget.value) } }}
      />
    </label>
  )
}

export function EditPanel({
  filename, srcWidth, srcHeight,
  edit, onChange,
  tool, setTool,
  aspect, setAspect,
  onApply, onCancel, onReset,
  vectorLayers, vectorSources, bboxSrc, crs, onError,
  backdrop = 'auto', setBackdrop, hasImagery = false, imagery, style, ss,
  onPreview, onUndo, onRedo, canUndo = false, canRedo = false,
}) {
  const rect = edit?.rect ?? { x: 0, y: 0, w: srcWidth, h: srcHeight }
  const bounds = effectiveBounds(edit, srcWidth, srcHeight)
  const feather = edit?.feather ?? 0

  const setRect = (patch) => {
    const next = { ...rect, ...patch }
    // Position first, then size, so typing a width that would run off the right
    // edge shrinks the width rather than silently sliding the crop left.
    next.x = Math.max(0, Math.min(next.x, srcWidth - 1))
    next.y = Math.max(0, Math.min(next.y, srcHeight - 1))
    next.w = Math.max(1, Math.min(next.w, srcWidth - next.x))
    next.h = Math.max(1, Math.min(next.h, srcHeight - next.y))
    onChange({ rect: next, shape: edit?.shape ?? null, feather })
  }

  const btn = (label, onClick, kind, testId, disabled = false) => (
    <Btn size="lg" block variant={kind === 'primary' ? 'primary' : 'quiet'}
      onClick={onClick} data-testid={testId} disabled={disabled}>{label}</Btn>
  )

  return (
    <>
      <PanelStyles />
      <div data-testid="edit-panel" style={{
        position: 'fixed', right: 0, top: 0, width: W, height: '100%',
        background: BG, color: TEXT, zIndex: 1000,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-3px 0 16px var(--hm-shadow)',
        fontFamily: FONT,
      }}>
        <div style={{ padding: '12px 12px 12px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, color: STRONG }}>edit</span>
            <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>Clip heightmap</span>
          </div>
          {filename && (
            <div style={{ marginTop: 4, fontSize: 10, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filename}
            </div>
          )}
        </div>

        <div id="hm-panel-body" style={{ flex: 1, overflowX: 'hidden', overflowY: 'auto', padding: '12px 12px' }}>
          <SegGroup label="Tool" columns={2} options={TOOLS} value={tool} onChange={setTool}
            testIdOf={(id) => `edit-tool-${id}`} style={{ marginBottom: 12 }} />

          <HelpBox text={HINTS[tool]} />

          {/* Each tool shows its own controls, as in the Mask Studio. The
              selection below applies to every tool, so it always shows. */}
          {tool === 'crop' && (
            <>
          <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>Crop</div>
          <SegRow
            label="Aspect"
            testIdPrefix="edit-aspect"
            help="Locks the crop's proportions while you drag a handle. Src keeps the heightmap's own ratio."
            options={[['Free', 'free'], ['1:1', '1:1'], ['4:3', '4:3'], ['16:9', '16:9'], ['Src', 'src']]}
            value={aspect}
            onChange={setAspect}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 8 }}>
            <NumField label="X" testId="edit-x" value={rect.x} min={0} max={srcWidth - 1}  onChange={(v) => setRect({ x: v })} />
            <NumField label="Y" testId="edit-y" value={rect.y} min={0} max={srcHeight - 1} onChange={(v) => setRect({ y: v })} />
            <NumField label="Width"  testId="edit-w" value={rect.w} min={1} max={srcWidth}  onChange={(v) => setRect({ w: v })} />
            <NumField label="Height" testId="edit-h" value={rect.h} min={1} max={srcHeight} onChange={(v) => setRect({ h: v })} />
          </div>
          <Btn size="md" data-testid="edit-full-extent" onClick={() => setRect({ x: 0, y: 0, w: srcWidth, h: srcHeight })}
            style={{ width: '100%', marginBottom: 12 }}>Full extent</Btn>
            </>
          )}
          {tool === 'features' && (
            <ClipFromFeatures
              layers={vectorLayers} sources={vectorSources}
              bboxSrc={bboxSrc} crs={crs} srcWidth={srcWidth} srcHeight={srcHeight}
              btn={btn} onPreview={onPreview}
              onShape={(shape) => onChange({
                // The whole raster, so the clip is the feature and nothing else.
                // A crop left over from a previous selection would silently cut
                // a municipality in half.
                rect: { x: 0, y: 0, w: srcWidth, h: srcHeight }, shape, feather,
              })}
              onError={onError}
            />
          )}

          <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>Selection</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: MUTED, marginBottom: 8 }}>
            <span>Shape</span>
            <span style={{ color: edit?.shape ? DIM : MUTED }}>
              {!edit?.shape ? 'none'
                : edit.shape.type === 'ellipse'
                  ? `ellipse · ${Math.round(edit.shape.rx * 2)}×${Math.round(edit.shape.ry * 2)}`
                  : edit.shape.type === 'rings'
                    // Named, and counted across every ring — a feature with an
                    // enclave in it has more than one and `points` is not there
                    // at all. Reading `shape.points.length` here is what took
                    // the whole panel down the first time a clip came from a map.
                    ? `${edit.shape.name ?? 'feature'} · ${ringPoints(edit.shape)} pts`
                    : `${edit.shape.type} · ${edit.shape.points.length / 2} pts`}
            </span>
          </div>
          {edit?.shape && (
            <Btn size="md" data-testid="edit-clear-shape" onClick={() => onChange({ rect, shape: null, feather })}
              style={{ width: '100%', marginBottom: 8 }}>Clear shape</Btn>
          )}

          <InlineSl
            label="Feather" testId="edit-feather"
            help="Softens the cut: within this many pixels of the edge the terrain ramps down to its own lowest point instead of ending in a cliff. Also what makes a clipped STL sit flat."
            min={0} max={64} value={feather}
            onChange={(v) => onChange({ rect, shape: edit?.shape ?? null, feather: v })}
            fmt={(v) => v + ' px'}
          />

          <BackdropBlock prefix="edit" backdrop={backdrop} setBackdrop={setBackdrop}
            hasPhoto={hasImagery} imagery={imagery} style={style} ss={ss} />

          <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>History</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {btn('↶ Undo', onUndo, 'ghost', 'edit-undo', !canUndo)}
            {btn('↷ Redo', onRedo, 'ghost', 'edit-redo', !canRedo)}
          </div>

          <div style={{
            marginTop: 12, padding: '8px 8px', background: SUNK,
            border: `1px solid ${BORDER}`, borderRadius: 5, fontSize: 10, color: MUTED, lineHeight: 1.6,
          }}>
            <div>Source <span style={{ color: DIM, fontVariantNumeric: 'tabular-nums' }}>{srcWidth}×{srcHeight}</span></div>
            <div>Result <span style={{ color: bounds ? ACCENT : DANGER_TEXT, fontVariantNumeric: 'tabular-nums' }} data-testid="edit-result">
              {bounds ? `${bounds.w}×${bounds.h}` : 'empty'}
            </span></div>
          </div>
        </div>

        <div style={{ padding: '8px 12px', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            {btn('Apply', onApply, 'primary', 'edit-apply')}
            {btn('Cancel', onCancel, 'ghost', 'edit-cancel')}
          </div>
          <div style={{ display: 'flex' }}>
            {btn('Reset to full heightmap', onReset, 'ghost', 'edit-reset')}
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            Applying keeps the original raster — re-open Edit Mode any time to adjust or drop the clip.
            ⌘Z steps back through this session's changes.
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * Clip the heightmap to a map feature.
 *
 * The same choosing the Mask Studio does, spent differently: there a feature
 * becomes a stencil over the whole raster, here it becomes the raster's own
 * outline. "Cut this to the municipality" is the request, and tracing a border
 * by hand with the lasso was the only way to answer it.
 *
 * Only layers whose features enclose something are offered — a road network
 * cannot clip anything — and the shape it produces is deliberately not
 * vertex-editable. It came from a survey.
 */
function ClipFromFeatures({ layers, sources, bboxSrc, crs, srcWidth, srcHeight, btn, onPreview, onShape, onError }) {
  const { usable, chosen, bucket, picked, closes, label, element } =
    useFeaturePick(layers ?? [], sources ?? [], 'edit-from')

  const areaLike = chosen?.geom === 'area' || closes
  const ready = !!bboxSrc && !!crs && areaLike && picked.size > 0
  const pickedKey = [...picked].sort((a, b) => a - b).join(',')

  // The outline on the image while you pick, as the Studio previews its
  // region. Rings are cheap next to a raster, so only a short pause is kept for
  // a burst of ticks.
  useEffect(() => {
    if (!ready) { onPreview?.(null); return undefined }
    const t = setTimeout(() => {
      const only = pickedKey ? pickedKey.split(',').map(Number) : []
      const rings = featureRings(bucket, { bbox: bboxSrc, crs, width: srcWidth, height: srcHeight }, { only })
      onPreview?.(rings.length ? rings : null)
    }, 80)
    return () => clearTimeout(t)
  }, [ready, bucket, pickedKey, bboxSrc, crs, srcWidth, srcHeight, onPreview])
  useEffect(() => () => onPreview?.(null), [onPreview])

  if (!usable.length) {
    return (
      <>
        <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>Features</div>
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
          No features are loaded. Add a GeoJSON or GPX file, or OpenStreetMap features, in the Vector section.
        </div>
      </>
    )
  }

  const apply = () => {
    const rings = featureRings(bucket, { bbox: bboxSrc, crs, width: srcWidth, height: srcHeight },
      { only: [...picked] })
    if (!rings.length) {
      onError?.(`Nothing from ${label} encloses ground inside this raster.`)
      return
    }
    onShape({ type: 'rings', rings, name: label })
  }

  return (
    <>
      <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>Features</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
        {element}
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
          {!areaLike
            ? 'These features do not enclose anything, so there is nothing to clip to.'
            : 'The crop is reset to the whole raster and the outline becomes the selection. Feather still applies.'}
        </div>
        <div style={{ display: 'flex' }}>
          {btn('Clip to this', apply, 'primary', 'edit-from-apply', !ready)}
        </div>
      </div>
    </>
  )
}
