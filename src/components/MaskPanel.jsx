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
import {
  ACCENT, BG, BORDER, DIM, MUTED, SURF, TEXT, W,
  HelpBox, InlineSl, PanelStyles, SegRow,
} from './panel/ui'

const TOOLS = [
  ['✎ Brush',   'brush'],
  ['▣ Rectangle', 'rect'],
  ['⬭ Ellipse', 'ellipse'],
  ['⌇ Lasso',   'lasso'],
]

const HINTS = {
  brush:   'Drag to paint. [ and ] resize the brush, and the ring under the cursor is its true size on the raster. Hold Alt and drag to pan, scroll to zoom.',
  rect:    'Drag a rectangle. It is committed when you let go, so several drags build up one region.',
  ellipse: 'Drag an ellipse from corner to corner of its bounding box.',
  lasso:   'Drag to trace a free-hand outline. It closes itself when you let go.',
}

export function MaskPanel({
  mask, srcWidth, srcHeight,
  tool, setTool, brush, setBrush, erase, setErase,
  backdrop, setBackdrop, hasPhoto, imagery, style, ss,
  onFill, onInvert, onClear, onDone,
}) {
  // maskCoverage answers a fraction, not a percentage — the mask rows in the
  // sidebar scale it the same way.
  const covered = mask ? maskCoverage(mask) * 100 : 0

  const btn = (label, onClick, kind, testId) => (
    <button onClick={onClick} data-testid={testId} style={{
      flex: 1, padding: '8px 0', borderRadius: 5, cursor: 'pointer',
      fontSize: 11, fontWeight: 600,
      background: kind === 'primary' ? ACCENT : SURF,
      color: kind === 'primary' ? '#fff' : DIM,
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
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, color: '#F0EBE3' }}>mask</span>
            <span style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>PAINT A STENCIL</span>
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
                color: tool === id ? '#fff' : MUTED,
                border: `1px solid ${tool === id ? ACCENT : BORDER}`,
              }}>{label}</button>
            ))}
          </div>

          <HelpBox text={HINTS[tool]} />

          <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, margin: '12px 0 4px', letterSpacing: 1 }}>PAINT</div>
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

          <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, margin: '12px 0 4px', letterSpacing: 1 }}>BACKDROP</div>
          <SegRow
            label="Show"
            testIdPrefix="studio-backdrop"
            help="What you aim at. Satellite is a photograph and shows the boundary between worked ground and forest, which shaded relief cannot. Auto takes it when there is some."
            options={[['Auto', 'auto'], ['Sat', 'imagery'], ['Relief', 'relief']]}
            value={backdrop}
            onChange={setBackdrop}
          />
          {imagery ? (
            <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
              Sentinel-2 · {imagery.date} · {Math.round(imagery.cloud)}% cloud
            </div>
          ) : (
            <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.6 }}>
              No imagery fetched — the backdrop is the hillshade.
            </div>
          )}
          {!hasPhoto && backdrop === 'imagery' && (
            <div style={{ fontSize: 10, color: '#ef4444', lineHeight: 1.6 }}>
              Nothing to show. Fetch imagery in the Satellite section first.
            </div>
          )}
          {/* The exposure controls live here as well as in the Satellite
              section, against the same state. Aiming at a boundary is exactly
              when you need them, and the sidebar that carries them is hidden
              for the duration — a control you cannot reach while doing the one
              job it is for may as well not exist. */}
          {hasPhoto && style && ss && (
            <div style={{ marginTop: 6 }}>
              <SegRow
                label="Levels"
                testIdPrefix="studio-levels"
                help="Sentinel-2 is exposed for cloud and snow, so ordinary ground arrives near black. Auto stretches this window's own histogram and lifts its midtones."
                options={[['Auto', 'auto'], ['Raw', 'raw']]}
                value={style.imageryAutoLevels ? 'auto' : 'raw'}
                onChange={(v) => ss({ imageryAutoLevels: v === 'auto' })}
              />
              <InlineSl label="Bright" testId="studio-bright"
                min={0.2} max={2.5} step={0.01} value={style.imageryBrightness}
                onChange={(v) => ss({ imageryBrightness: v })} fmt={(v) => v.toFixed(2) + '×'} />
              <InlineSl label="Contrast" testId="studio-contrast"
                min={0.4} max={2.2} step={0.01} value={style.imageryContrast}
                onChange={(v) => ss({ imageryContrast: v })} fmt={(v) => v.toFixed(2) + '×'} />
            </div>
          )}

          <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, margin: '12px 0 4px', letterSpacing: 1 }}>WHOLE MASK</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {btn('Fill', onFill, 'ghost', 'studio-fill')}
            {btn('Invert', onInvert, 'ghost', 'studio-invert')}
            {btn('Clear', onClear, 'ghost', 'studio-clear')}
          </div>

          <div style={{
            marginTop: 12, padding: '8px 8px', background: 'rgba(0,0,0,0.2)',
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
            Strokes are kept as you make them — Done just closes the view. Re-open
            it from the mask's Paint button any time.
          </div>
        </div>
      </div>
    </>
  )
}
