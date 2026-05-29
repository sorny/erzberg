/**
 * Keyboard controls.
 *
 * Q  → toggle auto-rotate
 *
 * Export shortcuts (1–5) are handled in App.jsx.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

export function Controls({ getParams, setParams, orbitRef }) {
  const { camera } = useThree()

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      const v = getParams()

      switch (e.code) {
        case 'KeyQ': setParams({ autoRotate: !(v.autoRotate) }); break
        default: return
      }
      e.preventDefault()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera, getParams, setParams, orbitRef])

  return null
}
