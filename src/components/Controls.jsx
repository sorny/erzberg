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
        // ── Auto-rotate ──────────────────────────────────────────────────────
        case 'KeyQ': levaSet({ autoRotate: !(v.autoRotate) }); break

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
