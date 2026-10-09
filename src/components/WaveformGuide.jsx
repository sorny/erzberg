/**
 * Where Waveform reads, drawn on the terrain while its section is open.
 *
 * The mode draws a column somewhere else on the plate, so nothing on the
 * ground said which line it was read along: *Through* and *Direction* could
 * only be judged by the shape they produced. This drapes that line over the
 * surface, with a bead at each end, a pin where it passes through, and
 * chevrons that point the way it is read. Where *Chainage* keeps only a part
 * of the line, the rest is drawn faint, so the cut shows. The last chevron is at the end, but
 * the end is often off screen, nearest the camera, so three more stand along
 * the line. The column reads from the bead at its top (or a row from its left
 * end) to the end at its bottom (or its right end).
 *
 * A viewport aid like the profile line: never in an export.
 */
import { useMemo } from 'react'
import { sampleBilinear } from '../utils/terrain'
import { waveformLine } from '../utils/builders/signal'
import { Anchor, Overlay2D } from './ProfileOverlay'

/** The panel's accent, so the line on the ground and the open section match. */
export const WAVEFORM_GUIDE = '#E8823A'
const N = 240

export function WaveformGuide({ terrain, p }) {
  const shape = useMemo(() => {
    if (!terrain?.grid) return null
    const o = { line: p.lineWaveform, originX: p.originXWaveform, originY: p.originYWaveform, angle: p.angleWaveform }
    const full = waveformLine(terrain, o)
    const line = waveformLine(terrain, { ...o, from: p.fromWaveform, to: p.toWaveform })
    if (!full || !line) return null
    const { grid, gridMask, rows, cols, scl, halfW, halfH, elevScale } = terrain
    const { c0, r0, dc, dr, t0, t1 } = line
    const span = Math.max(halfW, halfH) * 2
    const lift = span * 0.002
    const at = (c, r) => {
      const cc = Math.max(0, Math.min(cols - 1, c)), rr = Math.max(0, Math.min(rows - 1, r))
      const b = sampleBilinear(grid, gridMask, rows, cols, rr, cc)
      return [cc * scl - halfW, (b === b ? (b - 0.5) * 100 * elevScale : 0) + lift, rr * scl - halfH]
    }
    const trace = (a, b) => {
      const out = []
      for (let i = 0; i < N; i++) {
        const t = a + (b - a) * i / (N - 1)
        out.push(at(c0 + t * dc, r0 + t * dr))
      }
      return out
    }
    const path = trace(t0, t1)
    // The whole line, faint, when Chainage keeps only a part of it.
    const whole = t1 - t0 < (full.t1 - full.t0) * 0.999 ? trace(full.t0, full.t1) : null
    // Chevrons, in grid units, as two strokes back from each tip: one pair of
    // points per stroke, for a segments line.
    const head = Math.min((t1 - t0) * 0.06, span * 0.03 / scl)
    const arrows = []
    for (const f of [0.25, 0.5, 0.75, 1]) {
      const t = t0 + (t1 - t0) * f
      const ce = c0 + t * dc, re = r0 + t * dr
      const barb = (s) => at(ce - head * dc + s * head * 0.55 * dr, re - head * dr - s * head * 0.55 * dc)
      const tip = at(ce, re)
      arrows.push(barb(1), tip, tip, barb(-1))
    }
    return {
      path, whole, arrows, start: path[0], end: path[N - 1],
      pin: at(c0, r0), height: span * 0.06, radius: span * 0.009, bead: span * 0.006,
    }
  }, [terrain, p.lineWaveform, p.originXWaveform, p.originYWaveform, p.angleWaveform, p.fromWaveform, p.toWaveform])

  if (!shape) return null
  return (
    // Flagged for the PNG capture to skip: see the traverse in Scene.jsx.
    <group userData={{ viewportOnly: true }}>
      {/* A white halo under the accent core, as the profile line does, so it
          shows on paper and on an inked plate alike. */}
      {shape.whole && <Overlay2D points={shape.whole} color={WAVEFORM_GUIDE} width={1.5} opacity={0.35} order={996} />}
      <Overlay2D points={shape.path} color="#ffffff" width={6} opacity={0.85} order={997} />
      <Overlay2D points={shape.path} color={WAVEFORM_GUIDE} width={2.5} order={998} />
      <Overlay2D points={shape.arrows} segments color="#ffffff" width={7} opacity={0.85} order={997} />
      <Overlay2D points={shape.arrows} segments color={WAVEFORM_GUIDE} width={3.5} order={998} />
      {[shape.start, shape.end].map((at, i) => (
        <mesh key={i} position={at} renderOrder={999}>
          <sphereGeometry args={[shape.bead, 12, 8]} />
          <meshBasicMaterial color={WAVEFORM_GUIDE} depthTest={false} transparent />
        </mesh>
      ))}
      <Anchor position={shape.pin} color={WAVEFORM_GUIDE} height={shape.height} radius={shape.radius} />
    </group>
  )
}
