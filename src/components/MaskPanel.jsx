/**
 * Right-hand panel while the Mask Studio is open — replaces <Sidebar> for the
 * duration, exactly as <EditPanel> does for Edit Mode.
 *
 * The two views were built at different times and drifted: Edit Mode put its
 * controls in a panel and left the canvas clear, the Studio crammed everything
 * into one floating bar over the picture. They are the same kind of thing —
 * a full-window direct-manipulation mode over the source raster — so they now
 * share a shape, a set of primitives and a set of gestures. A person who has
 * learned one has learned the other.
 *
 * Deliberately a sibling of EditPanel rather than a generalisation of it. The
 * two hold different controls and will keep diverging in content; what has to
 * stay identical is the frame, and that is what `panel/ui` already provides.
 */
import { maskCoverage } from '../utils/maskLayers'
import { BackdropBlock } from './panel/BackdropBlock'
import { ACCENT, BG, BORDER, DIM, HelpBox, InlineSl, MUTED, ON_ACCENT, PanelStyles, STRONG, SUNK, SURF, SegRow, TEXT, Tog, W } from './panel/ui'

const TOOLS = [
  ['✎ Brush',   'brush'],
  ['▣ Rectangle', 'rect'],
  ['⬭ Ellipse', 'ellipse'],
  ['⌇ Lasso',   'lasso'],
  ['▤ Level',   'level'],
  ['⌖ Features', 'features'],
]

const COMBINE = [['Replace', 'replace'], ['Add', 'add'], ['Subtract', 'subtract'], ['Intersect', 'intersect']]

const HINTS = {
  brush:   'Drag to paint. [ and ] resize the brush, and the ring under the cursor is its true size on the raster. Hold Alt and drag to pan, scroll to zoom.',
  rect:    'Drag a rectangle. It is committed when you let go, so several drags build up one region.',
  ellipse: 'Drag an ellipse from corner to corner of its bounding box. Hold Shift for a perfect circle.',
  lasso:   'Drag to trace a free-hand outline. It closes itself when you let go.',
  level:   'The ground between two heights. The wash shows the mask as Apply to mask will leave it, while you drag.',
  features: 'The outline of loaded map features. A line becomes a corridor, a point a disc. The wash shows the result before you apply it.',
}

export function MaskPanel({
  mask, srcWidth, srcHeight,
  tool, setTool, brush, setBrush, erase, setErase,
  backdrop, setBackdrop, hasPhoto, imagery, style, ss,
  onFill, onInvert, onClear, onDone, region,
  onUndo, onRedo, canUndo, canRedo,
}) {
  // maskCoverage answers a fraction, not a percentage — the mask rows in the
  // sidebar scale it the same way.
  const covered = mask ? maskCoverage(mask) * 100 : 0

  const btn = (label, onClick, kind, testId, disabled = false) => (
    <button onClick={onClick} data-testid={testId} disabled={disabled} style={{
      flex: 1, padding: '8px 0', borderRadius: 5, cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      fontSize: 11, fontWeight: 600,
      background: kind === 'primary' ? ACCENT : SURF,
      color: kind === 'primary' ? ON_ACCENT : DIM,
      border: `1px solid ${kind === 'primary' ? ACCENT : BORDER}`,
    }}>{label}</button>
  )

  return (
    <>
      <PanelStyles />
      <div data-testid="mask-panel" style={{
        position: 'fixed', right: 0, top: 0, width: W, height: '100%',
        background: BG, color: TEXT, zIndex: 1000,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-3px 0 16px rgba(0,0,0,.4)',
        fontFamily: 'system-ui,-apple-system,sans-serif',
      }}>
        <div style={{ padding: '12px 12px 12px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, color: STRONG }}>mask</span>
            <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>Make a stencil</span>
          </div>
          {mask && (
            <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6,
                          fontSize: 10, color: MUTED, overflow: 'hidden' }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, flexShrink: 0,
                             background: mask.color, border: '1px solid rgba(255,255,255,0.3)' }} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mask.name}</span>
            </div>
          )}
        </div>

        <div id="hm-panel-body" style={{ flex: 1, overflowX: 'hidden', overflowY: 'auto', padding: '12px 12px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2, marginBottom: 12 }}>
            {TOOLS.map(([label, id]) => (
              <button key={id} data-testid={`studio-tool-${id}`} onClick={() => setTool(id)} style={{
                fontSize: 10, padding: '8px 0', borderRadius: 5, cursor: 'pointer',
                background: tool === id ? ACCENT : SURF,
                color: tool === id ? ON_ACCENT : MUTED,
                border: `1px solid ${tool === id ? ACCENT : BORDER}`,
              }}>{label}</button>
            ))}
          </div>

          <HelpBox text={HINTS[tool]} />

          {region && (tool === 'level' || tool === 'features')
            ? <RegionControls tool={tool} r={region} total={srcWidth * srcHeight} btn={btn} />
            : <>
          <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>Paint</div>
          <SegRow
            label="Mode"
            testIdPrefix="studio-mode"
            help="Erase takes the same tool and the same shape and subtracts it instead. E toggles."
            options={[['Paint', 'paint'], ['Erase', 'erase']]}
            value={erase ? 'erase' : 'paint'}
            onChange={(v) => setErase(v === 'erase')}
          />
          {tool === 'brush' && (
            <InlineSl
              label="Size" testId="studio-brush"
              help="The brush radius in raster pixels, so it stays the same size on the ground however far the view is zoomed. [ and ] step it."
              min={1} max={400} value={brush} onChange={setBrush} fmt={(v) => v + 'px'}
            />
          )}
            </>}

          <BackdropBlock prefix="studio" backdrop={backdrop} setBackdrop={setBackdrop}
            hasPhoto={hasPhoto} imagery={imagery} style={style} ss={ss} />

          <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>Whole mask</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {btn('Fill', onFill, 'ghost', 'studio-fill')}
            {btn('Invert', onInvert, 'ghost', 'studio-invert')}
            {btn('Clear', onClear, 'ghost', 'studio-clear')}
          </div>
          <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>History</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {btn('↶ Undo', onUndo, 'ghost', 'studio-undo', !canUndo)}
            {btn('↷ Redo', onRedo, 'ghost', 'studio-redo', !canRedo)}
          </div>

          <div style={{
            marginTop: 12, padding: '8px 8px', background: SUNK,
            border: `1px solid ${BORDER}`, borderRadius: 5, fontSize: 10, color: MUTED, lineHeight: 1.6,
          }}>
            <div>Source <span style={{ color: DIM, fontVariantNumeric: 'tabular-nums' }}>{srcWidth}×{srcHeight}</span></div>
            <div>Covered <span data-testid="studio-coverage" style={{
              color: covered > 0 ? ACCENT : '#ef4444', fontVariantNumeric: 'tabular-nums',
            }}>{covered > 0 && covered < 1 ? '<1' : Math.round(covered)}%</span></div>
          </div>
        </div>

        <div style={{ padding: '8px 12px', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex' }}>
            {btn('Done', onDone, 'primary', 'studio-done')}
          </div>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            Strokes are kept as you make them, and Done keeps a Level or
            Features preview too. ⌘Z
            steps back through the last ten changes while it is open. Re-open
            it with the mask's Edit button any time.
          </div>
        </div>
      </div>
    </>
  )
}

const heading = (text) => (
  <div style={{ fontSize: 11, color: DIM, fontWeight: 600, margin: '12px 0 4px' }}>{text}</div>
)
const note = (text, color = MUTED) => (
  <div style={{ fontSize: 10, color, lineHeight: 1.6, marginBottom: 6 }}>{text}</div>
)

/**
 * Level and Features: the controls that compute a region, how it combines with
 * the mask, and Apply.
 *
 * The buffer is one number with three meanings, so it is labelled for the
 * geometry selected. For an area, or a line that closes, it may be negative:
 * "the forest, but not its first twenty metres".
 */
function RegionControls({ tool, r, total, btn }) {
  const { level, setLevel, fmtLevel, pick } = r
  const set = (k) => (v) => setLevel((o) => ({ ...o, [k]: v }))
  const geom = pick.chosen?.geom ?? 'area'
  const distLabel = r.filling ? 'Buffer' : geom === 'line' ? 'Half-width' : 'Radius'
  const share = r.preview ? (100 * r.preview.on) / total : null

  return (
    <>
      {tool === 'level' && (
        <>
          {heading('Level')}
          <InlineSl label="From" testId="studio-level-from" min={0} max={1} step={0.005}
            value={level.lo} onChange={set('lo')} fmt={fmtLevel} />
          <InlineSl label="To" testId="studio-level-to" min={0} max={1} step={0.005}
            value={level.hi} onChange={set('hi')} fmt={fmtLevel} />
          <InlineSl label="Smooth" testId="studio-level-smooth"
            help="Blurs the heights before the cut, so the edge follows the landform and not every notch in the data."
            min={0} max={12} step={1} value={level.smooth}
            onChange={(v) => set('smooth')(Math.round(v))} fmt={(v) => `${Math.round(v)} px`} />
        </>
      )}

      {tool === 'features' && (
        <>
          {heading('Features')}
          {!pick.usable.length
            ? note('No features are loaded. Add a GeoJSON or GPX file, or OpenStreetMap features, in the Vector section.')
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 6 }}>
                {pick.element}
                {pick.closes && (
                  <Tog label="Fill the enclosed area" checked={r.fillClosed} small
                    onChange={r.setFillClosed} testId="mask-from-fill" />
                )}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <span style={{ fontSize: 10, color: MUTED, flex: 1 }}>{distLabel}</span>
                  <input type="number" value={r.dist} step={10} min={r.filling ? -500 : 0} max={2000}
                    data-testid="mask-from-dist"
                    onChange={(e) => r.setDist(Number(e.target.value) || 0)}
                    style={{ width: 62, background: SURF, color: DIM, border: `1px solid ${BORDER}`,
                             borderRadius: 5, fontSize: 10, padding: '2px 4px', textAlign: 'right' }} />
                  <span style={{ fontSize: 10, color: MUTED }}>m</span>
                </div>
                {!r.featureOk && note('A mask from features needs a georeferenced raster and features with coordinates.', '#ef4444')}
              </div>
            )}
        </>
      )}

      {heading('Into the mask')}
      <SegRow label="Combine" testIdPrefix="studio-combine"
        help="How the region meets the mask. Replace takes the region. Add joins it, Subtract cuts it out, and Intersect keeps only the overlap."
        options={COMBINE} value={r.combine} onChange={r.setCombine} />
      {note(share == null
        ? 'Nothing to preview yet.'
        : <>The mask after you apply: <span data-testid="studio-preview-coverage" style={{ color: DIM, fontVariantNumeric: 'tabular-nums' }}>
            {share > 0 && share < 1 ? '<1' : Math.round(share)}%</span> of the raster.</>)}
      <div style={{ display: 'flex' }}>
        {btn('Apply to mask', r.onApply, 'primary', 'studio-apply', !r.preview)}
      </div>
    </>
  )
}
