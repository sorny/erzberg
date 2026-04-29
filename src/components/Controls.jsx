/**
 * Keyboard controls.
 *
 * Q  → toggle auto-rotate
 *
 * Export shortcuts (1–5) are handled in App.jsx.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

export function Controls({ levaGet, levaSet, orbitRef }) {
  const { camera } = useThree()

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      const v = levaGet()

      switch (e.code) {
        case 'KeyQ': levaSet({ autoRotate: !(v.autoRotate) }); break
        default: return
      }
      e.preventDefault()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera, levaGet, levaSet, orbitRef])

  return null
}
