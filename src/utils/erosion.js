/**
 * Droplet-based hydraulic erosion, after Hans Beyer, "Implementation of a Method
 * for Hydraulic Erosion" (2015).
 *
 * Thousands of independent droplets are dropped at random, each carrying water,
 * velocity and dissolved sediment downhill until it evaporates. Where a droplet
 * is under-loaded for its speed and slope it cuts; where it is over-loaded it
 * drops what it cannot carry. Valleys and alluvial fans emerge from the sum of
 * those two rules — nothing in here models either directly.
 *
 * The choices worth knowing, because they are stability constraints rather than
 * physics and changing them tends to produce spikes or holes:
 *
 *  - **Droplets die after `maxDropletLifetime` steps** (30). A droplet caught in
 *    a shallow basin will otherwise circle indefinitely, eroding one spot into a
 *    pit. The cap makes it give up instead.
 *  - **Uphill motion deposits, and only up to the height of the step**
 *    (`min(deltaH, sediment)`). This is the pit-filling rule: a droplet that has
 *    run into a wall fills the hollow it is sitting in rather than climbing out,
 *    and capping at `deltaH` stops it from building a mound above the rim.
 *  - **Erosion is capped at the terrain that is actually there**
 *    (`min(map[i], …)`), so a heavily-eroded cell cannot go negative and leave a
 *    hole the brush then spreads outward.
 *  - **Sampling and both brushes are bilinear / distance-weighted.** Point
 *    sampling on an integer grid makes droplets follow the axes and etch a
 *    visible cross-hatch.
 *
 * Not non-destructive, despite what this header used to say: the result is
 * clamped back into 0…1 at the end, which flattens anything a droplet pushed
 * past either end of the range. The caller keeps the original for undo.
 */

export function simulateErosion(pixels, width, height, iterations = 50000, params = {}, onProgress = null) {
  const map = new Float32Array(pixels)
  
  const {
    erosionRadius = 3,
    inertia = 0.05,
    sedimentCapacityFactor = 4,
    minSedimentCapacity = 0.01,
    erodeSpeed = 0.3,
    depositSpeed = 0.3,
    evaporateSpeed = 0.01,
    gravity = 4,
    maxDropletLifetime = 30
  } = params

  // --- Precompute Erosion Brush ---
  // dx and dy are kept separately rather than pre-folded into a flat offset.
  // A flat offset cannot be bounds-checked: `dy*width + dx` for a droplet near
  // column 0 lands on the far side of the previous row, which is inside the
  // array and so passes an index test while eroding a completely unrelated part
  // of the map. That showed up as mirrored streaks down both borders.
  const brushWeights = []
  const brushDx = []
  const brushDy = []
  let weightSum = 0

  for (let dy = -erosionRadius; dy <= erosionRadius; dy++) {
    for (let dx = -erosionRadius; dx <= erosionRadius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist <= erosionRadius) {
        const weight = 1 - dist / erosionRadius
        brushWeights.push(weight)
        brushDx.push(dx)
        brushDy.push(dy)
        weightSum += weight
      }
    }
  }
  for (let i = 0; i < brushWeights.length; i++) brushWeights[i] /= weightSum

  // --- Core Simulation Helpers ---
  function getGradientAndHeight(x, y) {
    const posX = Math.floor(x)
    const posY = Math.floor(y)
    const u = x - posX
    const v = y - posY

    const idx = posY * width + posX
    const h00 = map[idx]
    const h10 = map[idx + 1]
    const h01 = map[idx + width]
    const h11 = map[idx + width + 1]

    const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v
    const gy = (h01 - h00) * (1 - u) + (h11 - h10) * u
    const height = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v

    return { height, gx, gy }
  }

  // --- Main Simulation Loop ---
  const progressChunk = onProgress ? Math.max(1000, Math.floor(iterations / 20)) : 0
  for (let i = 0; i < iterations; i++) {
    if (onProgress && i > 0 && i % progressChunk === 0) onProgress(Math.round((i / iterations) * 100))
    let posX = Math.random() * (width - 1)
    let posY = Math.random() * (height - 1)
    let dirX = 0
    let dirY = 0
    let speed = 1
    let water = 1
    let sediment = 0

    for (let lifetime = 0; lifetime < maxDropletLifetime; lifetime++) {
      const nodeX = Math.floor(posX)
      const nodeY = Math.floor(posY)
      const u = posX - nodeX
      const v = posY - nodeY
      const { height: hOld, gx, gy } = getGradientAndHeight(posX, posY)

      // Steer downhill, but blend with the previous heading: with inertia at 0
      // a droplet turns instantly and traces the gradient exactly, which on a
      // discrete grid means it snakes along cell boundaries. Momentum lets it
      // cut across them and carve something that reads as a channel.
      dirX = dirX * inertia - gx * (1 - inertia)
      dirY = dirY * inertia - gy * (1 - inertia)

      // Unit step, so speed is carried by `speed` alone rather than by slope.
      const len = Math.sqrt(dirX * dirX + dirY * dirY)
      if (len !== 0) { dirX /= len; dirY /= len }

      const nextX = posX + dirX
      const nextY = posY + dirY

      if (nextX < 0 || nextX >= width - 1 || nextY < 0 || nextY >= height - 1) {
        // Drop any remaining sediment at current location before exiting
        if (sediment > 0) {
          const depositAmt = sediment
          map[nodeY * width + nodeX] += depositAmt * (1 - u) * (1 - v)
          map[nodeY * width + nodeX + 1] += depositAmt * u * (1 - v)
          map[(nodeY + 1) * width + nodeX] += depositAmt * (1 - u) * v
          map[(nodeY + 1) * width + nodeX + 1] += depositAmt * u * v
        }
        break
      }

      const { height: hNew } = getGradientAndHeight(nextX, nextY)
      const deltaH = hNew - hOld

      // How much this droplet can hold right now: steeper, faster and wetter
      // all raise it. The minSlope floor is what keeps a droplet crossing flat
      // ground from having zero capacity and dumping its whole load in one cell.
      const capacity = Math.max(-deltaH, minSedimentCapacity) * speed * water * sedimentCapacityFactor

      if (sediment > capacity || deltaH > 0) {
        // CASE A: Moving uphill or over capacity -> Deposition
        // If moving uphill, fill the pit up to hNew. Otherwise, drop a fraction of surplus.
        const depositAmt = (deltaH > 0) ? Math.min(deltaH, sediment) : (sediment - capacity) * depositSpeed
        sediment -= depositAmt

        // Distribute sediment bilinearly to the 4 nodes
        map[nodeY * width + nodeX] += depositAmt * (1 - u) * (1 - v)
        map[nodeY * width + nodeX + 1] += depositAmt * u * (1 - v)
        map[(nodeY + 1) * width + nodeX] += depositAmt * (1 - u) * v
        map[(nodeY + 1) * width + nodeX + 1] += depositAmt * u * v
      } else {
        // CASE B: Moving downhill and has capacity -> Erosion
        const erodeAmt = Math.min((capacity - sediment) * erodeSpeed, -deltaH)
        
        // Distribute erosion weighted by brush. Both axes are checked — see the
        // note on the brush construction above for why the flat index alone is
        // not enough.
        for (let b = 0; b < brushWeights.length; b++) {
          const tx = nodeX + brushDx[b]
          const ty = nodeY + brushDy[b]
          if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue
          const targetIdx = ty * width + tx
          // Subtract weighted erosion, but ensure we don't go below absolute zero
          const actualErode = Math.min(map[targetIdx], erodeAmt * brushWeights[b])
          map[targetIdx] -= actualErode
        }
        sediment += erodeAmt
      }

      // v = sqrt(v^2 + deltaH * gravity)
      speed = Math.sqrt(Math.max(0, speed * speed + deltaH * gravity))
      water *= (1 - evaporateSpeed)

      posX = nextX
      posY = nextY
    }
  }

  // Final Pass: Ensure everything is clamped to 0..1 range for the shader
  for (let i = 0; i < map.length; i++) {
    map[i] = Math.max(0, Math.min(1, map[i]))
  }

  return map
}
