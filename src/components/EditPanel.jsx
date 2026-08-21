/**
 * Right-hand panel while Edit Mode is on — replaces <Sidebar> for the duration.
 *
 * A separate panel rather than one more <Section> in the sidebar: editing is a
 * mode, not a setting, and every other control in the sidebar describes a
 * terrain that is not on screen while it is running.
 */
import { useEffect, useState } from 'react'
import { effectiveBounds } from '../utils/heightmapEdit'
import {
  ACCENT, BG, BORDER, DIM, MUTED, SURF, TEXT, W,
  HelpBox, InlineSl, PanelStyles, SegRow,
} from './panel/ui'

const TOOLS = [
  ['▣ Crop',    'crop'],
  ['⬭ Ellipse', 'ellipse'],
  ['✎ Lasso',   'lasso'],
  ['⬡ Polygon', 'polygon'],
]

const HINTS = {
  crop:    'Drag on the image to draw a crop, or grab a handle to resize it. The terrain is rebuilt from the crop, so a smaller one also rebuilds faster.',
  ellipse: 'Drag to draw an ellipse — hold Shift for a perfect circle. Drag inside it to move it, or use the eight handles to resize.',
  lasso:   'Drag to trace a free-hand outline. Afterwards the points stay editable: drag one to move it, drag an edge to add one there, right-click one to remove it.',
  polygon: 'Click to place corners; click the first one again, press Enter, or double-click to close. Once closed, drag its points to reshape it — or drag an edge to add a point.',
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
      <span style={{ fontSize: 9, color: MUTED, display: 'block', marginBottom: 2 }}>{label}</span>
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

  const btn = (label, onClick, kind, testId) => (
    <button onClick={onClick} data-testid={testId} style={{
      flex: 1, padding: '9px 0', borderRadius: 5, cursor: 'pointer',
      fontSize: 11, fontWeight: 600,
      background: kind === 'primary' ? ACCENT : SURF,
      color: kind === 'primary' ? '#fff' : DIM,
      border: `1px solid ${kind === 'primary' ? ACCENT : BORDER}`,
    }}>{label}</button>
  )

  return (
    <>
      <PanelStyles />
      <div data-testid="edit-panel" style={{
        position: 'fixed', right: 0, top: 0, width: W, height: '100%',
        background: BG, color: TEXT, zIndex: 1000,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-3px 0 16px rgba(0,0,0,.4)',
        fontFamily: 'system-ui,-apple-system,sans-serif',
      }}>
        <div style={{ padding: '12px 14px 11px', borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 13, fontWeight: 700, color: '#F0EBE3' }}>edit</span>
            <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>CLIP HEIGHTMAP</span>
          </div>
          {filename && (
            <div style={{ marginTop: 5, fontSize: 10, color: MUTED, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {filename}
            </div>
          )}
        </div>

        <div id="hm-panel-body" style={{ flex: 1, overflowX: 'hidden', overflowY: 'auto', padding: '12px 14px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 3, marginBottom: 12 }}>
            {TOOLS.map(([label, id]) => (
              <button key={id} data-testid={`edit-tool-${id}`} onClick={() => setTool(id)} style={{
                fontSize: 10, padding: '7px 0', borderRadius: 4, cursor: 'pointer',
                background: tool === id ? ACCENT : SURF,
                color: tool === id ? '#fff' : MUTED,
                border: `1px solid ${tool === id ? ACCENT : BORDER}`,
              }}>{label}</button>
            ))}
          </div>

          <HelpBox text={HINTS[tool]} />

          <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, margin: '12px 0 6px', letterSpacing: 1 }}>CROP</div>
          <SegRow
            label="Aspect"
            testIdPrefix="edit-aspect"
            help="Locks the crop's proportions while you drag a handle. Src keeps the heightmap's own ratio."
            options={[['Free', 'free'], ['1:1', '1:1'], ['4:3', '4:3'], ['16:9', '16:9'], ['Src', 'src']]}
            value={aspect}
            onChange={setAspect}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
            <NumField label="X" testId="edit-x" value={rect.x} min={0} max={srcWidth - 1}  onChange={(v) => setRect({ x: v })} />
            <NumField label="Y" testId="edit-y" value={rect.y} min={0} max={srcHeight - 1} onChange={(v) => setRect({ y: v })} />
            <NumField label="Width"  testId="edit-w" value={rect.w} min={1} max={srcWidth}  onChange={(v) => setRect({ w: v })} />
            <NumField label="Height" testId="edit-h" value={rect.h} min={1} max={srcHeight} onChange={(v) => setRect({ h: v })} />
          </div>
          <button data-testid="edit-full-extent" onClick={() => setRect({ x: 0, y: 0, w: srcWidth, h: srcHeight })} style={{
            width: '100%', padding: '6px 0', background: SURF, color: MUTED,
            border: `1px solid ${BORDER}`, borderRadius: 4, cursor: 'pointer', fontSize: 10, marginBottom: 12,
          }}>Full extent</button>

          <div style={{ fontSize: 10, color: MUTED, fontWeight: 700, margin: '12px 0 6px', letterSpacing: 1 }}>SELECTION</div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: MUTED, marginBottom: 8 }}>
            <span>Shape</span>
            <span style={{ color: edit?.shape ? DIM : MUTED }}>
              {!edit?.shape ? 'none'
                : edit.shape.type === 'ellipse'
                  ? `ellipse · ${Math.round(edit.shape.rx * 2)}×${Math.round(edit.shape.ry * 2)}`
                  : `${edit.shape.type} · ${edit.shape.points.length / 2} pts`}
            </span>
          </div>
          {edit?.shape && (
            <button data-testid="edit-clear-shape" onClick={() => onChange({ rect, shape: null, feather })} style={{
              width: '100%', padding: '6px 0', background: SURF, color: MUTED,
              border: `1px solid ${BORDER}`, borderRadius: 4, cursor: 'pointer', fontSize: 10, marginBottom: 8,
            }}>Clear shape</button>
          )}
          <InlineSl
            label="Feather" testId="edit-feather"
            help="Softens the cut: within this many pixels of the edge the terrain ramps down to its own lowest point instead of ending in a cliff. Also what makes a clipped STL sit flat."
            min={0} max={64} value={feather}
            onChange={(v) => onChange({ rect, shape: edit?.shape ?? null, feather: v })}
            fmt={(v) => v + 'px'}
          />

          <div style={{
            marginTop: 14, padding: '8px 10px', background: 'rgba(0,0,0,0.2)',
            border: `1px solid ${BORDER}`, borderRadius: 4, fontSize: 10, color: MUTED, lineHeight: 1.6,
          }}>
            <div>Source <span style={{ color: DIM, fontVariantNumeric: 'tabular-nums' }}>{srcWidth}×{srcHeight}</span></div>
            <div>Result <span style={{ color: bounds ? ACCENT : '#ef4444', fontVariantNumeric: 'tabular-nums' }} data-testid="edit-result">
              {bounds ? `${bounds.w}×${bounds.h}` : 'empty'}
            </span></div>
          </div>
        </div>

        <div style={{ padding: '10px 14px', borderTop: `1px solid ${BORDER}`, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            {btn('Apply', onApply, 'primary', 'edit-apply')}
            {btn('Cancel', onCancel, 'ghost', 'edit-cancel')}
          </div>
          <div style={{ display: 'flex' }}>
            {btn('Reset to full heightmap', onReset, 'ghost', 'edit-reset')}
          </div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 8, lineHeight: 1.5 }}>
            Applying keeps the original raster — re-open Edit Mode any time to adjust or drop the clip.
          </div>
        </div>
      </div>
    </>
  )
}
