/**
 * Where the elevation profile was taken, drawn on the terrain.
 *
 * The profile used to be a chart with no anchor in the scene: you clicked two
 * points, the popup appeared, and nothing on the model said which two. This
 * draws the section line itself — draped over the surface rather than chorded
 * through it, so it reads as a cut across the landscape — with a pin at each
 * end, green for A and red for B to match the chart's axis labels.
 *
 * Purely a viewport aid: it is DOM-free but also export-free, since both
 * exporters work from geometry the worker built and this is neither in `lineGeo`
 * nor in the surface. Composition aids do not belong in a print.
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { sampleBilinear } from '../utils/terrain'

export const PROFILE_A = '#22c55e'
export const PROFILE_B = '#ef4444'

/** How many points the draped line is sampled at — the same count as the chart. */
const N = 200

/**
 * Surface point for a raycast UV.
 *
 * The surface mesh's UVs run `u = c/(cols-1)`, `v = 1 - r/(rows-1)` (see
 * buildSurfaceUvs), and its vertices sit at `c*scl - halfW` / `r*scl - halfH`
 * with the elevation the grid holds — so this is that mapping, backwards.
 */
function uvToWorld(terrain, u, v) {
  const { grid, gridMask, rows, cols, scl, halfW, halfH, elevScale } = terrain
  const c = Math.max(0, Math.min(cols - 1, u * (cols - 1)))
  const r = Math.max(0, Math.min(rows - 1, (1 - v) * (rows - 1)))
  const b = sampleBilinear(grid, gridMask, rows, cols, r, c)
  return [c * scl - halfW, (b - 0.5) * 100 * elevScale, r * scl - halfH]
}

/**
 * A drei <Line> that ignores the depth buffer.
 *
 * Set through a ref rather than as `material-depthTest`: drei builds the Line2's
 * material itself, so at the moment R3F applies pierced props there is nothing
 * to pierce and the whole Canvas throws. The effect runs on every render because
 * drei rebuilds the material when the viewport resolution changes.
 */
function Overlay2D({ points, color, width, opacity = 1, order }) {
  const ref = useRef(null)
  const invalidate = useThree((s) => s.invalidate)
  useLayoutEffect(() => {
    const m = ref.current?.material
    if (!m) return
    m.depthTest = false
    // Always transparent, even at full opacity: three draws the opaque queue
    // first and the transparent queue after it, so an opaque core would be
    // painted over by its own translucent halo whatever the render order says.
    m.transparent = true
    m.opacity = opacity
    invalidate()
  })
  return <Line ref={ref} points={points} color={color} lineWidth={width} renderOrder={order} />
}

/** A pin: a stalk out of the surface with a bead on top, so it reads at any tilt. */
function Anchor({ position, color, height, radius }) {
  const [x, y, z] = position
  return (
    <group>
      <Overlay2D points={[[x, y, z], [x, y + height, z]]} color={color} width={2} order={999} />
      <mesh position={[x, y + height, z]} renderOrder={999}>
        <sphereGeometry args={[radius, 16, 12]} />
        <meshBasicMaterial color={color} depthTest={false} />
      </mesh>
    </group>
  )
}

export function ProfileOverlay({ terrain, anchors }) {
  const shape = useMemo(() => {
    if (!terrain?.grid || !anchors?.length) return null
    const [a, b] = anchors
    // Sized against the terrain's footprint rather than its relief: relief is
    // a couple of units on a flat spectrogram and a hundred on an alpine plate,
    // so a pin scaled to it is either invisible or a mast. The span is stable.
    const span = Math.max(terrain.halfW, terrain.halfH) * 2
    const height = span * 0.06
    const radius = span * 0.009
    // Lifted off the surface: drawn at the sampled elevation exactly, the line
    // z-fights with the very triangles it follows.
    const lift = span * 0.002

    const pinA = uvToWorld(terrain, a.x, a.y)
    if (!b) return { path: null, pinA, pinB: null, height, radius }

    const path = []
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      const p = uvToWorld(terrain, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
      path.push([p[0], p[1] + lift, p[2]])
    }
    return { path, pinA, pinB: uvToWorld(terrain, b.x, b.y), height, radius }
  }, [terrain, anchors])

  if (!shape) return null

  return (
    // Flagged for the PNG capture to skip: see the traverse in Scene.jsx.
    <group userData={{ viewportOnly: true }}>
      {/* Two passes: a white halo under a blue core. The plate background is the
          user's to choose, so neither colour alone survives it — on paper the
          halo disappears and the core carries, on an inked plate the halo is
          what makes the core visible. Blue is the chart's own line colour, which
          is what ties the section on the terrain to the section in the popup. */}
      {shape.path && <Overlay2D points={shape.path} color="#ffffff" width={6} opacity={0.85} order={997} />}
      {shape.path && <Overlay2D points={shape.path} color="#3b82f6" width={2.5} order={998} />}
      <Anchor position={shape.pinA} color={PROFILE_A} height={shape.height} radius={shape.radius} />
      {shape.pinB && (
        <Anchor position={shape.pinB} color={PROFILE_B} height={shape.height} radius={shape.radius} />
      )}
    </group>
  )
}
