/**
 * Lights up one vector feature on the terrain.
 *
 * This is the "which one is this" half of the panel, and it works in both
 * directions from the same state: hovering a row in the sidebar writes
 * `vectorHover`, and so does the picker when the cursor rests over a feature in
 * the viewport. Whichever wrote it, the same segments light up.
 *
 * The geometry is built here on the main thread rather than in the worker,
 * because the worker's answer would arrive a rebuild later — far too slow to
 * follow a cursor — and because it does not need one: the layer's draped
 * `positions` are already in the scene, and `featureOfSegment` says which of
 * them belong to the feature. Extracting a subset is a memcpy over an array
 * that is already the right shape.
 *
 * `userData.viewportOnly` marks it excluded from the high-resolution PNG
 * capture (Scene.jsx hides those before rendering), which is the same bargain
 * the elevation-profile pins take. A hover highlight is an affordance, not part
 * of the picture.
 */
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js'
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { useThree } from '@react-three/fiber'
import { useStore } from '../store/useStore'

// Bright enough to find on any terrain, and the same accent the panel uses for
// a selected control, so the row and the line read as the same thing.
const HOVER_COLOR = '#3b82f6'
const SELECT_COLOR = '#f97316'

/** The segments of one feature, copied out of a layer's draped positions. */
function extractFeature(layer, feature) {
  const { positions, featureOfSegment } = layer
  if (!positions?.length || !featureOfSegment?.length) return null

  let n = 0
  for (let i = 0; i < featureOfSegment.length; i++) if (featureOfSegment[i] === feature) n++
  if (!n) return null

  const out = new Float32Array(n * 6)
  let w = 0
  for (let i = 0; i < featureOfSegment.length; i++) {
    if (featureOfSegment[i] !== feature) continue
    out.set(positions.subarray(i * 6, i * 6 + 6), w)
    w += 6
  }
  return out
}

function Highlight({ layer, feature, color, weight, resolution }) {
  const invalidate = useThree((s) => s.invalidate)

  const positions = useMemo(() => extractFeature(layer, feature), [layer, feature])

  const geometry = useMemo(() => {
    if (!positions) return null
    const g = new LineSegmentsGeometry()
    g.setPositions(positions)
    return g
  }, [positions])

  // depthTest off so a feature behind a ridge still answers "this one" — the
  // point of the highlight is to locate something, which it cannot do while
  // hidden by the terrain it is draped on.
  const material = useMemo(() => new LineMaterial({
    color: new THREE.Color(color),
    linewidth: weight,
    resolution,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  }), [color, weight, resolution])

  const lines = useMemo(() => {
    if (!geometry) return null
    const l = new LineSegments2(geometry, material)
    l.renderOrder = 1500
    l.userData.viewportOnly = true
    return l
  }, [geometry, material])

  useEffect(() => { invalidate() }, [lines, invalidate])
  useEffect(() => () => { geometry?.dispose(); material?.dispose() }, [geometry, material])

  return lines ? <primitive object={lines} /> : null
}

/**
 * Both highlights at once: the selected feature stays lit while the cursor
 * wanders, and the hovered one is drawn over it. Two entries rather than one
 * because "the one I clicked" and "the one I am pointing at" are different
 * questions, and losing the first while asking the second is what makes a list
 * of 621 tracks impossible to work through.
 */
export function VectorHighlight({ lineGeo, resolution }) {
  const hover = useStore((s) => s.vectorHover)
  const selected = useStore((s) => s.vectorSelected)

  const byId = useMemo(() => {
    const m = new Map()
    for (const l of lineGeo ?? []) if (l.featureOfSegment) m.set(l.id, l)
    return m
  }, [lineGeo])

  const pick = (h) => (h && byId.has(h.layerId) ? { layer: byId.get(h.layerId), feature: h.feature } : null)
  const sel = pick(selected)
  const hov = pick(hover)
  // The same feature both selected and hovered is one line, not two stacked.
  const showSel = sel && !(hov && hov.layer === sel.layer && hov.feature === sel.feature)

  return (
    <group>
      {showSel && <Highlight layer={sel.layer} feature={sel.feature}
                             color={SELECT_COLOR} weight={5} resolution={resolution} />}
      {hov && <Highlight layer={hov.layer} feature={hov.feature}
                         color={HOVER_COLOR} weight={6} resolution={resolution} />}
    </group>
  )
}
