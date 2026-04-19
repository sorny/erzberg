/**
 * Keyboard controls — navigation and view only.
 *
 * W A S D  → pan OrbitControls target
 * Y / X    → tilt up / down (5° steps)
 * E / R    → rotate +45° / −45°
 * Q        → toggle auto-rotate
 * T        → reset camera
 * G        → toggle center guides
 *
 * Export shortcuts (1/2/3/4) are handled in App.jsx.
 */
import { useEffect, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'

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
        case 'KeyY': levaSet({ tilt: Math.max(-90, (v.tilt ?? 0) - TILT_STEP) }); break
        case 'KeyX': levaSet({ tilt: Math.min( 90, (v.tilt ?? 0) + TILT_STEP) }); break

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

        // ── Toggles ──────────────────────────────────────────────────────────
        case 'KeyG': levaSet({ showGuides: !(v.showGuides) }); break

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
