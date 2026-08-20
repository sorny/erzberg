/**
 * Identifying a vector feature by pointing at it.
 *
 * Deliberately outside R3F's event system. Attaching `onPointerMove` to the line
 * objects would add them to R3F's interaction list, and every pointer move would
 * then raycast all of them — which is exactly the cost this file exists to
 * control. Instead it owns a raycaster, listens on the canvas itself, and
 * decides for itself when a pick is worth paying for.
 *
 * Three things it has to get right:
 *
 *  • **Cost.** `LineSegments2` raycasting is O(segments) per object, and its
 *    bounding-sphere early-out does not help here: every layer's sphere covers
 *    the whole raster, so pointing at the terrain means pointing at all of them.
 *    A real fetch is ~228 000 segments, tens of milliseconds — fine once, ruinous
 *    per frame. So hovering is **debounced to pointer-rest**, which is the normal
 *    tooltip idiom anyway: you stop moving in order to read the label. A click
 *    picks immediately, because by then the user has asked.
 *
 *  • **Not fighting OrbitControls.** Nothing disables the orbit while picking, so
 *    a press-and-drag has to stay a rotation. The click path therefore measures
 *    how far the pointer travelled between down and up and ignores anything that
 *    moved — the elevation profile's picker, which fires on `pointerdown`, has
 *    the opposite behaviour and registers a point every time you start to orbit.
 *
 *  • **`frameloop="demand"`.** R3F's event system never invalidates, and this is
 *    not even in it. Every state change here has to ask for a frame itself.
 */
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'
import { useStore } from '../store/useStore'

// How long the pointer must hold still before a hover pick is paid for.
const REST_MS = 120

// How close the cursor has to come, in CSS pixels, to count as pointing at
// something. Three does not take a radius: it tests
// `distance < (material.linewidth + threshold) / 2`, so the threshold is worked
// backwards from these and depends on how thick the layer is drawn.
//
// Points get the larger figure because they are the hardest thing on screen to
// hit — a peak is a single dot with no length to catch a passing cursor, and at
// the old fixed slop of 6 a weight-4 peak had a 5 px target.
const PICK_RADIUS_PX = 14
const POINT_PICK_RADIUS_PX = 20

// Pointer travel between down and up beyond which the gesture was an orbit.
const CLICK_SLOP_PX = 4

export function VectorPicker({ enabled = true }) {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)
  const invalidate = useThree((s) => s.invalidate)

  const setHover = useStore((s) => s.setVectorHover)
  const setSelected = useStore((s) => s.setVectorSelected)

  // Everything per-gesture lives in refs: a hover must not re-render this
  // component, only the two that read the store.
  const restRef = useRef(null)
  const downRef = useRef(null)
  const hoverRef = useRef(null)

  useEffect(() => {
    if (!enabled) return
    const canvas = gl.domElement

    const raycaster = new THREE.Raycaster()
    raycaster.params.Line2 = { threshold: 0 }
    const ndc = new THREE.Vector2()

    /** Every pickable, visible vector layer currently in the scene. */
    const targets = () => {
      const out = []
      scene.traverse((o) => {
        if (o.visible && o.userData.vectorLayerId) out.push(o)
      })
      return out
    }

    /**
     * The feature under (clientX, clientY), or null.
     *
     * `faceIndex` on a LineSegments2 intersection is the segment's instance
     * index, and `featureOfSegment` turns that into the feature it was built
     * from — the one link between a pixel and a row in the panel.
     */
    const pick = (clientX, clientY) => {
      const objs = targets()
      if (!objs.length) return null

      const r = canvas.getBoundingClientRect()
      ndc.x = ((clientX - r.left) / r.width) * 2 - 1
      ndc.y = -((clientY - r.top) / r.height) * 2 + 1
      raycaster.setFromCamera(ndc, camera)

      // One object at a time, because the threshold is per layer: it has to
      // cancel out however thick that layer happens to be drawn, or a hairline
      // road would be unhittable while a fat one grabbed the cursor from
      // 10 px away.
      const hits = []
      for (const o of objs) {
        const want = o.userData.vectorIsPoints ? POINT_PICK_RADIUS_PX : PICK_RADIUS_PX
        raycaster.params.Line2.threshold = Math.max(0, want * 2 - (o.material?.linewidth ?? 1))
        const found = raycaster.intersectObject(o, false)
        for (const hit of found) { hit.isPoints = !!o.userData.vectorIsPoints; hits.push(hit) }
      }
      if (!hits.length) return null

      // Points win ties. They are deliberate marks on named things and the
      // smallest targets on screen, so a summit sitting near a road it does not
      // belong to should still be what you get when you point at the summit.
      hits.sort((a, b) => (b.isPoints - a.isPoints) || (a.distance - b.distance))

      for (const hit of hits) {
        // An icon layer's geometry is tagged `vec:7#icons`, but hover and
        // selection name a *layer* — the panel row, the tooltip and the
        // highlight all look records up by `vec:7`. Reporting the geometry's own
        // id instead left a picked icon nameless and its row unmarked.
        const layerId = hit.object.userData.vectorLayerId?.split('#')[0]
        const map = hit.object.userData.featureOfSegment
        const feature = map?.[hit.faceIndex]
        if (layerId && feature !== undefined) return { layerId, feature }
      }
      return null
    }

    const setHoverIfChanged = (next, x, y) => {
      const prev = hoverRef.current
      const same = prev && next && prev.layerId === next.layerId && prev.feature === next.feature
      // Position still has to travel even when the feature has not, or the
      // tooltip would stick where it first appeared.
      if (same) { hoverRef.current = next; setHover({ ...next, x, y }); return }
      hoverRef.current = next
      setHover(next ? { ...next, x, y } : null)
      canvas.style.cursor = next ? 'pointer' : ''
      invalidate()
    }

    const onMove = (e) => {
      if (downRef.current) {
        downRef.current.moved = Math.max(
          downRef.current.moved,
          Math.hypot(e.clientX - downRef.current.x, e.clientY - downRef.current.y))
      }
      clearTimeout(restRef.current)
      // Dropping the highlight the moment the pointer leaves is what makes it
      // read as tracking rather than lagging, and it costs no raycast.
      if (hoverRef.current) setHoverIfChanged(null)
      // A drag is an orbit; picking mid-rotation would be answering a question
      // nobody asked, at the worst possible moment for the frame budget.
      if (downRef.current) return
      restRef.current = setTimeout(() => {
        setHoverIfChanged(pick(e.clientX, e.clientY), e.clientX, e.clientY)
      }, REST_MS)
    }

    const onLeave = () => {
      clearTimeout(restRef.current)
      setHoverIfChanged(null)
    }

    const onDown = (e) => {
      downRef.current = { x: e.clientX, y: e.clientY, moved: 0 }
      clearTimeout(restRef.current)
    }

    const onUp = (e) => {
      const down = downRef.current
      downRef.current = null
      if (!down || down.moved > CLICK_SLOP_PX) return
      const hit = pick(e.clientX, e.clientY)
      // A click on empty terrain clears the selection, which is the only way
      // back out of one without hunting for the row again.
      setSelected(hit)
      setHoverIfChanged(hit, e.clientX, e.clientY)
      invalidate()
    }

    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointerup', onUp)
    return () => {
      clearTimeout(restRef.current)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointerup', onUp)
      canvas.style.cursor = ''
    }
  }, [enabled, gl, camera, scene, invalidate, setHover, setSelected])

  // Turning identification off has to clear what it left behind, or the last
  // highlight stays lit with no way to dismiss it.
  useEffect(() => {
    if (enabled) return
    hoverRef.current = null
    setHover(null)
    invalidate()
  }, [enabled, setHover, invalidate])

  return null
}
