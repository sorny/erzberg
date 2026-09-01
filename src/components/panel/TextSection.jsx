/**
 * Free text placed in the scene.
 *
 * A contour letters its own height and a peak letters its own name. Both are
 * derived: the string comes from the data and the position comes from the
 * feature. Neither can put a title on a plate, name a valley the survey never
 * named, or sign it.
 *
 * This is the same lettering with the derivation removed, and the panel says so
 * by offering the same controls a point label has — the faces, the fill, the
 * plane, the ink — plus the two a derived label never needs: what it says, and
 * where it stands.
 *
 * The list is a stack read the way every other stack in this panel is read: the
 * top row is the front of the scene. Text layers are appended last to `lineGeo`,
 * so they draw in front of the drawing they annotate.
 */

import { useState } from 'react'
import {
  BORDER, DIM, MUTED, SURF, TEXT,
  Btn, ColorRow, GripIcon, InlineSl, Section, Sub, Tog,
} from './ui'
import { useStackDrag } from './stackDrag'
import { makeTextLayer, textLayerName } from '../../utils/textLayers'

const rowBtn = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: MUTED, fontSize: 11, lineHeight: 1, flexShrink: 0,
}

export function TextSection({
  open, onToggle, layers, setLayers, overflowed, singleLineFonts, viewTilt, viewSpin,
}) {
  const [expanded, setExpanded] = useState(null)
  const list = layers ?? []

  const patch = (id, next) =>
    setLayers((cur) => cur.map((l) => (l.id === id ? { ...l, ...next } : l)))

  const reorder = (id, to) => setLayers((cur) => {
    const from = cur.findIndex((l) => l.id === id)
    if (from < 0 || to < 0 || to >= cur.length || to === from) return cur
    const out = [...cur]
    out.splice(to, 0, out.splice(from, 1)[0])
    return out
  })

  const drag = useStackDrag(list, reorder)

  const add = () => {
    const t = makeTextLayer({ text: 'erzberg' })
    setLayers((cur) => [t, ...cur])
    setExpanded(t.id)
  }

  return (
    <Section title="Text" open={open} onToggle={onToggle} enabled={list.length > 0}>
      <Btn block onClick={add} data-testid="text-add"
        style={{ padding: '6px 0', marginBottom: list.length ? 8 : 0 }}>+ Add text</Btn>

      {!list.length && (
        <div style={{ fontSize: 10, color: MUTED, lineHeight: 1.5, marginTop: 8 }}>
          Titles, notes, a signature — anything the data does not already say. Each
          one is a layer of its own, drawn in front of the plate and exported as
          real <code>&lt;text&gt;</code> in the SVG.
        </div>
      )}

      {list.map((l, i) => {
        const isOpen = expanded === l.id
        const held = drag.dragging === l.id
        const set = (next) => patch(l.id, next)
        const over = overflowed?.includes(l.id)
        return (
          <div key={l.id} data-testid={`text-layer-${l.id}`} ref={drag.bindRow(l.id)}
            style={{
              borderTop: `1px solid ${BORDER}`, paddingTop: 4, marginBottom: 4,
              opacity: held ? 0.55 : 1, background: held ? SURF : 'transparent',
            }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button data-testid={`text-grip-${l.id}`}
                title={`Drag to reorder — ${i === 0 ? 'top of the stack, drawn in front' : `#${i + 1} of ${list.length}`}`}
                aria-label={`Reorder ${textLayerName(l)}`}
                onPointerDown={(e) => drag.start(e, l.id)}
                onPointerMove={drag.move}
                onPointerUp={drag.end}
                onPointerCancel={drag.end}
                onKeyDown={(e) => {
                  const step = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0
                  if (!step) return
                  e.preventDefault()
                  reorder(l.id, i + step)
                }}
                style={{
                  background: 'none', border: 'none', padding: 0, display: 'flex',
                  color: held ? TEXT : BORDER, cursor: held ? 'grabbing' : 'grab',
                  touchAction: 'none', flexShrink: 0,
                }}><GripIcon /></button>

              <span aria-hidden="true" style={{
                width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                background: l.color, border: `1px solid ${BORDER}`,
              }} />

              <button onClick={() => setExpanded(isOpen ? null : l.id)}
                data-testid={`text-open-${l.id}`}
                style={{
                  ...rowBtn, flex: 1, minWidth: 0, textAlign: 'left', color: TEXT,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  opacity: l.visible === false ? 0.45 : 1,
                }}>{textLayerName(l)}</button>

              <button onClick={() => set({ visible: l.visible === false })}
                data-testid={`text-eye-${l.id}`}
                aria-label={l.visible === false ? 'Show this text' : 'Hide this text'}
                title={l.visible === false ? 'Show' : 'Hide'}
                style={rowBtn}>{l.visible === false ? '◌' : '●'}</button>

              <button onClick={() => setLayers((cur) => cur.filter((x) => x.id !== l.id))}
                data-testid={`text-remove-${l.id}`}
                aria-label={`Remove ${textLayerName(l)}`} title="Remove"
                style={rowBtn}>✕</button>
            </div>

            {over && (
              <div style={{ fontSize: 10, color: MUTED, margin: '4px 0 0', lineHeight: 1.4 }}>
                Too much lettering to draw. Shorten it, or set it smaller.
              </div>
            )}

            {isOpen && (
              <Sub>
                <textarea value={l.text} rows={2}
                  data-testid={`text-body-${l.id}`}
                  onChange={(e) => set({ text: e.target.value })}
                  placeholder="Type something"
                  style={{
                    width: '100%', boxSizing: 'border-box', resize: 'vertical',
                    background: SURF, color: TEXT, border: `1px solid ${BORDER}`,
                    borderRadius: 3, fontSize: 11, padding: 5, fontFamily: 'inherit',
                    marginBottom: 8,
                  }} />

                <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>PLACE</div>
                {/* Fractions of the plate rather than world units, so a text
                    stays where it was put when the resolution slider moves the
                    grid under it. */}
                <InlineSl label="Across" min={-1} max={1} step={0.01} value={l.x}
                  onChange={(v) => set({ x: v })} fmt={(v) => v.toFixed(2)}
                  testId={`text-x-${l.id}`}
                  help="Left to right across the plate, as a fraction of its half-width. Stays put when the resolution changes the grid under it." />
                <InlineSl label="Along" min={-1} max={1} step={0.01} value={l.z}
                  onChange={(v) => set({ z: v })} fmt={(v) => v.toFixed(2)}
                  testId={`text-z-${l.id}`}
                  help="Front to back across the plate." />
                <InlineSl label="Lift" min={-100} max={400} step={1} value={l.lift}
                  onChange={(v) => set({ lift: v })} testId={`text-lift-${l.id}`}
                  help="Height above the ground under it. The terrain is sampled at the point, so a text on a summit rises with the summit when the exaggeration changes." />
                <Btn size="xs" onClick={() => set({ x: 0, z: 0 })}
                  style={{ width: '100%', padding: 4, marginTop: 2, color: DIM }}>Centre</Btn>

                <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: 1, margin: '10px 0 4px' }}>TYPE</div>
                <Tog label="Use single-line font" small checked={!!l.singleLine}
                  onChange={(v) => set({ singleLine: v })}
                  help="Letters drawn as a single stroke down the middle of each stem, the way plotter fonts have worked since the 1960s. An outline face plots the *edge* of the letter, so the pen goes round every glyph twice." />

                {l.singleLine ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '2px 0 8px' }}>
                    <span style={{ fontSize: 10, color: DIM, width: 54 }}>Font</span>
                    <select value={l.font ?? 'HersheySans1'}
                      onChange={(e) => set({ font: e.target.value })}
                      data-testid={`text-font-${l.id}`}
                      style={{
                        flex: 1, minWidth: 0, background: SURF, color: DIM,
                        border: `1px solid ${BORDER}`, borderRadius: 3,
                        fontSize: 10, padding: '4px 4px', cursor: 'pointer', fontFamily: 'inherit',
                      }}>
                      {Object.entries((singleLineFonts ?? []).reduce((g, f) => {
                        (g[f.group] ??= []).push(f); return g
                      }, {})).map(([group, faces]) => (
                        <optgroup key={group} label={group}>
                          {faces.map((f) => <option key={f.id} value={f.id}>{f.family}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '2px 0 4px' }}>
                    <span style={{ fontSize: 10, color: DIM, width: 54 }}>Face</span>
                    <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                      {[['bold', 'Bold'], ['italic', 'Italic']].map(([k, lbl]) => (
                        <Btn key={k} block variant="toggle" on={!!l[k]}
                          onClick={() => set({ [k]: !l[k] })}
                          style={{ fontSize: 10, padding: '2px 0', borderRadius: 2 }}>{lbl}</Btn>
                      ))}
                    </div>
                  </div>
                )}

                <InlineSl label="Size" min={2} max={80} step={0.5} value={l.size}
                  onChange={(v) => set({ size: v })} testId={`text-size-${l.id}`} />
                <InlineSl label="Offset ↔" min={-200} max={200} step={1} value={l.dx}
                  onChange={(v) => set({ dx: v })}
                  help="Moves the text across its own plane, without moving where it stands." />
                <InlineSl label="Offset ↕" min={-200} max={200} step={1} value={l.dy}
                  onChange={(v) => set({ dy: v })}
                  help="Moves the text up its own plane." />

                <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '4px 0' }}>
                  <span style={{ fontSize: 10, color: DIM, width: 54 }}>Align</span>
                  <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                    {[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']].map(([k, lbl]) => (
                      <Btn key={k} block variant="toggle" on={(l.align ?? 'center') === k}
                        onClick={() => set({ align: k })}
                        style={{ fontSize: 10, padding: '2px 0', borderRadius: 2 }}>{lbl}</Btn>
                    ))}
                  </div>
                </div>

                <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: 1, margin: '10px 0 4px' }}>INK</div>
                <ColorRow label="Colour" value={l.color} testId={`text-color-${l.id}`}
                  onChange={(v) => set({ color: v })} />
                <InlineSl label="Width" min={0.25} max={8} step={0.25} value={l.weight}
                  onChange={(v) => set({ weight: v })} testId={`text-weight-${l.id}`} />
                <InlineSl label="Opacity" min={0} max={1} step={0.01} value={l.opacity}
                  fmt={(v) => Math.round(v * 100) + '%'}
                  onChange={(v) => set({ opacity: v })} />
                {/* A stroke face has no interior to fill: its glyphs are centre
                    lines, not contours, so a fill would triangulate an open path
                    into a smear. Hidden rather than disabled, and the setting is
                    kept so switching back to an outline face restores it. */}
                {!l.singleLine && (
                  <>
                    <Tog label="Fill" small checked={!!l.fill}
                      onChange={(v) => set({ fill: v })}
                      help="Draws the lettering solid, with the counters of the letters cut out. Switch it off for outlined type, which is what a pen plotter draws and what the SVG carries either way." />
                    {l.fill && (
                      <Sub>
                        <ColorRow label="Fill colour" value={l.fillColor ?? l.color}
                          onChange={(v) => set({ fillColor: v })} />
                        <InlineSl label="Fill op." min={0} max={1} step={0.01}
                          value={l.fillOpacity ?? l.opacity}
                          fmt={(v) => Math.round(v * 100) + '%'}
                          onChange={(v) => set({ fillOpacity: v })} />
                        <Tog label="Stroke outside" small checked={!!l.strokeOutside}
                          onChange={(v) => set({ strokeOutside: v })}
                          help="Puts the whole stroke outside the letterform instead of straddling its edge, so the shape keeps the weight the face was drawn with." />
                      </Sub>
                    )}
                  </>
                )}

                <div style={{ fontSize: 9, color: MUTED, fontWeight: 700, letterSpacing: 1, margin: '10px 0 4px' }}>PLANE</div>
                <Tog label="Face camera" small checked={!!l.faceCamera}
                  onChange={(v) => set({ faceCamera: v })}
                  help="Keeps the text square to the view as you orbit. Switch it off to aim it by hand — useful when you are composing one frame to export." />
                {!l.faceCamera && (
                  <Sub>
                    <InlineSl label="Tilt" min={0} max={90} step={1} value={l.tilt}
                      fmt={(v) => `${Math.round(v)}°`} onChange={(v) => set({ tilt: v })} />
                    <InlineSl label="Spin" min={-180} max={180} step={1} value={l.spin}
                      fmt={(v) => `${Math.round(v)}°`} onChange={(v) => set({ spin: v })} />
                    <Btn size="xs" onClick={() => set({ tilt: viewTilt, spin: viewSpin })}
                      style={{ width: '100%', padding: 4, marginTop: 2, color: DIM }}>Match view</Btn>
                  </Sub>
                )}
              </Sub>
            )}
          </div>
        )
      })}
    </Section>
  )
}
