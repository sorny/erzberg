/**
 * Plan oblique relief, after Jenny and Patterson (2007), "Introducing Plan
 * Oblique Relief", Cartographic Perspectives 57.
 *
 * The camera looks straight down through a parallel projection, and every point
 * moves up the sheet by its height over tan(inclination). Mountains stand up and
 * lean over the ground behind them, as on the hand-drawn maps of Imfeld, Raisz
 * and Berann; the ground plane through the orbit target keeps its true shape and
 * scale, so the scale bar and the grid stay right.
 *
 * It is one shear in view space, folded into the orthographic camera's
 * projection matrix:
 *
 *     y' = y + k · (z + d),   k = 1 / tan(inclination)
 *
 * `z + d` is the height over the target plane, because the camera sits `d` above
 * it looking down. Depth is untouched, so the Z-buffer still hides the ground a
 * mountain leans over. Everything that projects through the camera — the
 * viewport, the PNG, the SVG exporter — follows without knowing about it.
 */
import * as THREE from 'three'

const shear = new THREE.Matrix4()

/** The view-space shear for an inclination in degrees and a camera distance. */
export function obliqueShear(inclinationDeg, dist) {
  const k = 1 / Math.tan(THREE.MathUtils.degToRad(inclinationDeg))
  return shear.set(
    1, 0, 0, 0,
    0, 1, k, k * dist,
    0, 0, 1, 0,
    0, 0, 0, 1,
  )
}

/**
 * Switches plan oblique on or off for an orthographic camera.
 *
 * The camera's `updateProjectionMatrix` is wrapped once, so every later call —
 * a resize, a zoom from the orbit controls — rebuilds the ordinary matrix and
 * applies the shear again, rather than silently dropping it.
 */
export function setPlanOblique(camera, on, inclinationDeg, dist) {
  if (!camera?.isOrthographicCamera) return
  if (!camera.userData.planObliqueWrapped) {
    const base = camera.updateProjectionMatrix
    camera.updateProjectionMatrix = function updateProjectionMatrix() {
      base.call(this)
      const o = this.userData.planOblique
      if (o) {
        this.projectionMatrix.multiply(obliqueShear(o.angle, o.dist))
        this.projectionMatrixInverse.copy(this.projectionMatrix).invert()
      }
    }
    camera.userData.planObliqueWrapped = true
  }
  camera.userData.planOblique = on ? { angle: inclinationDeg, dist } : null
  camera.updateProjectionMatrix()
}

/*
 * Picking. Three's raycaster gives an orthographic camera a ray straight along
 * its view axis, which under the shear points at the wrong ground: a click on a
 * summit would land on whatever lies north of it. Unprojecting the near and far
 * points through the sheared matrix gives the slanted ray the picture was
 * actually drawn along.
 */
const near = new THREE.Vector3()
const far = new THREE.Vector3()
const setFromCamera = THREE.Raycaster.prototype.setFromCamera
THREE.Raycaster.prototype.setFromCamera = function setFromCameraOblique(coords, camera) {
  if (!camera?.userData?.planOblique) return setFromCamera.call(this, coords, camera)
  near.set(coords.x, coords.y, -1).unproject(camera)
  far.set(coords.x, coords.y, 1).unproject(camera)
  this.ray.origin.copy(near)
  this.ray.direction.copy(far).sub(near).normalize()
  this.camera = camera
}
