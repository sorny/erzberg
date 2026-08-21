/**
 * The frame delta, made safe for an on-demand render loop.
 *
 * The canvas runs `frameloop="demand"`: a static scene draws nothing at all,
 * which is what keeps the GPU idle between edits. The clock behind `useFrame`
 * does not stop with it, so the first frame after a quiet spell arrives with a
 * `delta` covering the whole quiet spell — seconds, not milliseconds.
 *
 * Anything integrating that delta then takes one enormous step. Enabling
 * auto-rotate after nine seconds of stillness swung the camera 96° before the
 * second frame, against a steady rate of 7.8°/s: it read as the scene lurching
 * rather than starting to turn.
 *
 * Clamping to 50 ms means a stall can only ever cost motion, never add it — a
 * loop that misses frames runs slow instead of teleporting. 50 ms is a 20 fps
 * floor, below which a delta is a report about the machine rather than about
 * how much time the animation should advance.
 */
export const MAX_FRAME_DT = 0.05

/** `delta`, clamped. Use this anywhere a frame delta is integrated. */
export function frameDelta(delta) {
  return Math.min(delta, MAX_FRAME_DT)
}
