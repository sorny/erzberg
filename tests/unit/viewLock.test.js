import { describe, expect, it } from 'vitest'
import { CAMERA_POSE, holdCamera } from '../../src/utils/viewLock'
import { VIEW_DEF } from '../../src/defaults'

describe('holdCamera', () => {
  const prev = { ...VIEW_DEF, tilt: 63.9, rotation: -51.7, zoom: 1.2, panX: 40 }

  it('keeps the pose and takes everything else', () => {
    const next = { ...VIEW_DEF, showFrame: true, plotWidthMm: 420 }
    const out = holdCamera(prev, next)
    for (const k of CAMERA_POSE) expect(out[k]).toBe(prev[k])
    expect(out.showFrame).toBe(true)
    expect(out.plotWidthMm).toBe(420)
  })

  it('returns the same object when the pose is unchanged', () => {
    const next = { ...prev, showGuides: true }
    expect(holdCamera(prev, next)).toBe(next)
  })

  it('names only keys the view has', () => {
    for (const k of CAMERA_POSE) expect(VIEW_DEF).toHaveProperty(k)
  })
})
