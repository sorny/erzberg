/**
 * Keyboard controls.
 *
 * Q      → toggle auto-rotate
 * Space  → pause/resume the particle field
 *
 * Export shortcuts (1–5) are handled in App.jsx. Both of these appear on the
 * `?` card, which reads `utils/shortcuts.js`; a unit test checks that list
 * against the `e.code` values this switch tests for, so adding a case here
 * without adding a row there fails the suite.
 */
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'

export function Controls({ getParams, setParams, orbitRef }) {
  const { camera } = useThree()

  useEffect(() => {
    const onKey = (e) => {
      // BUTTON as well as the text fields: Space is this component's pause key
      // and also the browser's "press the focused button", so without it a
      // click on any panel button leaves Space toggling that button instead.
      const tag = e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return
      // Bare keys only — see the same guard in App.jsx.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const v = getParams()

      switch (e.code) {
        case 'KeyQ': setParams({ autoRotate: !(v.autoRotate) }); break
        // Only when there is a field to freeze — otherwise Space should keep
        // whatever meaning the page would normally give it.
        case 'Space':
          if (!v.showPoints) return
          setParams({ animateParticles: !v.animateParticles })
          break
        default: return
      }
      e.preventDefault()
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [camera, getParams, setParams, orbitRef])

  return null
}
