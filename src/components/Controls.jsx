/**
 * Keyboard controls — all mapped to Leva setters so state stays in sync.
 *
 * W A S D      → pan OrbitControls target
 * Y / X        → tilt up / down  (via levaSet tilt)
 * Q            → toggle auto-rotate
 * E            → rotate +45°
 * R            → rotate -45°
 * T            → reset camera
 * I / K        → resolution −/+
 * J / L        → line spacing −/+
 * B / N        → stroke weight +/−
 * F            → cycle draw mode
 * O            → toggle mesh stroke (showMesh)
 * P            → toggle fill
 * M            → toggle mesh
 * G            → toggle center guides
 * ↑ ↓          → shift lines
 * ← →          → shift peaks
 *
 * Export shortcuts (1/2/3/4) are handled in App.jsx to avoid needing
 * camera/canvas access inside the Canvas context.
 */
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

const DRAW_MODES = ['lines-x', 'lines-y', 'curves', 'crosshatch', 'hachure', 'contours']

export function Controls({ levaGet, levaSet, orbitRef }) {
  const { camera } = useThree()
  const panTarget = useRef(new THREE.Vector3(0, 0, 0))

  useEffect(() => {
    const PAN_SPEED   = 20
    const TILT_STEP   = 5    // degrees
    const ROT_STEP    = 45   // degrees

    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      const v = levaGet()

      switch (e.code) {
        // ── Pan ──────────────────────────────────────────────────────────────
        case 'KeyW': movePan(0, 0, -PAN_SPEED); break
        case 'KeyS': movePan(0, 0,  PAN_SPEED); break
        case 'KeyA': movePan(-PAN_SPEED, 0, 0); break
        case 'KeyD': movePan( PAN_SPEED, 0, 0); break

        // ── Tilt ─────────────────────────────────────────────────────────────
        case 'KeyY': levaSet({ tilt: Math.max(0,   (v.tilt ?? 60) - TILT_STEP) }); break
        case 'KeyX': levaSet({ tilt: Math.min(180, (v.tilt ?? 60) + TILT_STEP) }); break

        // ── Rotation ─────────────────────────────────────────────────────────
        case 'KeyE': levaSet({ rotation: (v.rotation ?? 0) + ROT_STEP }); break
        case 'KeyR': levaSet({ rotation: (v.rotation ?? 0) - ROT_STEP }); break

        // ── Reset camera ─────────────────────────────────────────────────────
        case 'KeyT':
          camera.position.set(0, 400, 500)
          panTarget.current.set(0, 0, 0)
          if (orbitRef?.current) {
            orbitRef.current.target.set(0, 0, 0)
            orbitRef.current.update()
          }
          break

        // ── Auto-rotate ──────────────────────────────────────────────────────
        case 'KeyQ': levaSet({ autoRotate: !(v.autoRotate) }); break

        // ── Resolution ───────────────────────────────────────────────────────
        case 'KeyI': levaSet({ resolution: Math.max(1,  (v.resolution ?? 4) - 1) }); break
        case 'KeyK': levaSet({ resolution: Math.min(20, (v.resolution ?? 4) + 1) }); break

        // ── Line spacing ─────────────────────────────────────────────────────
        case 'KeyJ': levaSet({ lineSpacing: Math.max(1,   (v.lineSpacing ?? 8) - 1) }); break
        case 'KeyL': levaSet({ lineSpacing: Math.min(100, (v.lineSpacing ?? 8) + 1) }); break

        // ── Stroke weight ────────────────────────────────────────────────────
        case 'KeyB': levaSet({ strokeWeight: Math.min(10,  (v.strokeWeight ?? 1) + 0.5) }); break
        case 'KeyN': levaSet({ strokeWeight: Math.max(0.5, (v.strokeWeight ?? 1) - 0.5) }); break

        // ── Draw mode ────────────────────────────────────────────────────────
        case 'KeyF': {
          const idx = DRAW_MODES.indexOf(v.drawMode ?? 'lines-x')
          levaSet({ drawMode: DRAW_MODES[(idx + 1) % DRAW_MODES.length] })
          break
        }

        // ── Toggles ──────────────────────────────────────────────────────────
        case 'KeyO': levaSet({ showMesh:   !(v.showMesh) });   break
        case 'KeyP': levaSet({ showFill:   !(v.showFill) });   break
        case 'KeyM': levaSet({ showMesh:   !(v.showMesh) });   break
        case 'KeyG': levaSet({ showGuides: !(v.showGuides) }); break

        // ── Sub-pixel offsets ────────────────────────────────────────────────
        case 'ArrowUp':    levaSet({ shiftLines: ((v.shiftLines ?? 0) + 1) % Math.max(1, v.resolution ?? 4) }); break
        case 'ArrowDown':  levaSet({ shiftLines: (((v.shiftLines ?? 0) - 1) + Math.max(1, v.resolution ?? 4)) % Math.max(1, v.resolution ?? 4) }); break
        case 'ArrowRight': levaSet({ shiftPeaks: ((v.shiftPeaks ?? 0) + 1) % Math.max(1, v.resolution ?? 4) }); break
        case 'ArrowLeft':  levaSet({ shiftPeaks: (((v.shiftPeaks ?? 0) - 1) + Math.max(1, v.resolution ?? 4)) % Math.max(1, v.resolution ?? 4) }); break

        default: return
      }
      e.preventDefault()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera, levaGet, levaSet, orbitRef])

  function movePan(dx, dy, dz) {
    panTarget.current.x += dx
    panTarget.current.y += dy
    panTarget.current.z += dz
    if (orbitRef?.current) {
      orbitRef.current.target.copy(panTarget.current)
      orbitRef.current.update()
    }
  }

  return null
}
