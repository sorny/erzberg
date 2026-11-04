/**
 * The view lock: every setting can change, and the camera stays where it is.
 *
 * Several exports of one view, to be layered later, need the same camera in
 * each. A preset, an undo, Reset all and a new terrain all write `view`, and
 * each one moved the camera. With the lock on, one guard on `setView` keeps
 * the pose from before, so no path can move it. The rest of `view` (the frame,
 * the guides, the plot settings) still changes.
 */

/** The `view` keys that place the camera, auto-rotate included because it turns it. */
export const CAMERA_POSE = [
  'tilt', 'rotation', 'zoom', 'fov', 'orthographic', 'planOblique', 'obliqueAngle',
  'panX', 'panY', 'panZ', 'autoRotate',
]

/** `next` with the camera pose of `prev`. `next` itself when nothing would change. */
export function holdCamera(prev, next) {
  if (!prev || !next || prev === next) return next
  if (CAMERA_POSE.every((k) => next[k] === prev[k])) return next
  const out = { ...next }
  for (const k of CAMERA_POSE) out[k] = prev[k]
  return out
}
