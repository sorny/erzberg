/**
 * The order to walk a layer's segments in, so that each stroke is walked end to
 * end: `order[k]` is a segment index, `flip[k]` says to walk it backwards, and
 * `start[k]` marks the first segment of a new stroke. `dim` is 3 for world
 * positions and 2 for screen ones; `grid` is how finely endpoints must agree.
 *
 * Builders emit segments in whatever order they find them — marching squares in
 * scan order, one cell at a time — so consecutive segments are rarely
 * neighbours. Joined by shared endpoints instead, a contour is one stroke again.
 */
export function chainSegments(pos, dim = 3, grid = 64) {
  const stride = dim * 2
  const n = pos.length / stride
  const key = dim === 3
    ? (o) => `${Math.round(pos[o] * grid)},${Math.round(pos[o + 1] * grid)},${Math.round(pos[o + 2] * grid)}`
    : (o) => `${Math.round(pos[o] * grid)},${Math.round(pos[o + 1] * grid)}`
  const at = new Map()
  const add = (k, v) => { const l = at.get(k); if (l) l.push(v); else at.set(k, [v]) }
  const keys = new Array(n * 2)
  for (let i = 0; i < n; i++) {
    keys[2 * i] = key(i * stride); keys[2 * i + 1] = key(i * stride + dim)
    add(keys[2 * i], 2 * i); add(keys[2 * i + 1], 2 * i + 1)
  }
  const used = new Uint8Array(n)
  // The unused segment end touching endpoint key `k`, or -1.
  const next = (k) => {
    for (const e of at.get(k) ?? []) if (!used[e >> 1]) return e
    return -1
  }
  const order = new Int32Array(n), flip = new Uint8Array(n), start = new Uint8Array(n)
  let w = 0
  for (let s = 0; s < n; s++) {
    if (used[s]) continue
    // Walk back from the seed's start to the stroke's first segment, then
    // forward from there, so an open stroke is walked from one end.
    let head = s, headFlip = 0
    used[s] = 1
    const back = []
    for (let k = keys[2 * s]; ;) {
      const e = next(k)
      if (e < 0) break
      used[e >> 1] = 1
      // Entered at its start → walking backwards it ends there, so it is flipped.
      back.push([e >> 1, (e & 1) === 0 ? 1 : 0])
      k = keys[e ^ 1]
    }
    for (let b = back.length - 1; b >= 0; b--) {
      order[w] = back[b][0]; flip[w] = back[b][1]; start[w] = b === back.length - 1 ? 1 : 0; w++
    }
    order[w] = head; flip[w] = headFlip; start[w] = back.length ? 0 : 1; w++
    for (let k = keys[2 * s + 1]; ;) {
      const e = next(k)
      if (e < 0) break
      used[e >> 1] = 1
      order[w] = e >> 1; flip[w] = (e & 1) === 1 ? 1 : 0; start[w] = 0; w++
      k = keys[e ^ 1]
    }
  }
  return { order, flip, start }
}
