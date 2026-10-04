/**
 * Plan oblique relief: a point moves up the screen by its height over
 * tan(inclination), the ground plane through the target does not move, and a
 * pick through the sheared camera finds the point that was drawn there.
 */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { setPlanOblique } from '../../src/utils/planOblique'

function topCamera() {
  const cam = new THREE.OrthographicCamera(-200, 200, 200, -200, 1, 5000)
  cam.position.set(0, 800, 0.001)
  cam.lookAt(0, 0, 0)
  cam.updateMatrixWorld()
  return cam
}

describe('plan oblique', () => {
  it('lifts a point up the screen by its height over tan(inclination)', () => {
    const cam = topCamera()
    setPlanOblique(cam, true, 45, 800)
    const ground = new THREE.Vector3(30, 0, 40).project(cam)
    const raised = new THREE.Vector3(30, 100, 40).project(cam)
    // 100 units at 45° is 100 units up the screen; the view is 400 units tall.
    expect(raised.y - ground.y).toBeCloseTo(100 / 200, 3)
    expect(raised.x).toBeCloseTo(ground.x, 6)

    setPlanOblique(cam, true, 60, 800)
    const steeper = new THREE.Vector3(30, 100, 40).project(cam)
    expect(steeper.y - ground.y).toBeCloseTo(100 / Math.tan(Math.PI / 3) / 200, 3)
  })

  it('leaves the ground plane where it was, and switches off cleanly', () => {
    const cam = topCamera()
    const before = new THREE.Vector3(30, 0, 40).project(cam)
    setPlanOblique(cam, true, 45, 800)
    const during = new THREE.Vector3(30, 0, 40).project(cam)
    expect(during.x).toBeCloseTo(before.x, 6)
    expect(during.y).toBeCloseTo(before.y, 4)
    setPlanOblique(cam, false, 45, 800)
    expect(new THREE.Vector3(30, 100, 40).project(cam).y).toBeCloseTo(before.y, 4)
  })

  it('keeps the shear through a later projection update', () => {
    const cam = topCamera()
    setPlanOblique(cam, true, 45, 800)
    cam.zoom = 2
    cam.updateProjectionMatrix()
    const g = new THREE.Vector3(0, 0, 0).project(cam)
    const r = new THREE.Vector3(0, 50, 0).project(cam)
    expect(r.y - g.y).toBeCloseTo(50 * 2 / 200, 3)
  })

  it('picks along the slanted ray, so a click lands on the raised point', () => {
    const cam = topCamera()
    setPlanOblique(cam, true, 45, 800)
    const p = new THREE.Vector3(30, 100, 40)
    const ndc = p.clone().project(cam)
    const ray = new THREE.Raycaster()
    ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam)
    expect(ray.ray.distanceToPoint(p)).toBeLessThan(1e-3)
  })
})
