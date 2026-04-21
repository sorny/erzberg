/**
 * Advanced Hydraulic Erosion Simulation.
 * Based on Hans Beyer's "Implementation of a Method for Hydraulic Erosion" (2015).
 * 
 * This version is non-destructive and physically stable, using:
 * - Bilinear gradient and height sampling.
 * - Inertia-driven droplet movement.
 * - Dynamic sediment capacity based on velocity, slope, and water volume.
 * - Distance-weighted erosion/deposition brushes.
 * - Automatic pit-filling for stability.
 */

export function simulateErosion(pixels, width, height, iterations = 50000, params = {}) {
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
  const brushWeights = []
  const brushOffsets = []
  let weightSum = 0

  for (let dy = -erosionRadius; dy <= erosionRadius; dy++) {
    for (let dx = -erosionRadius; dx <= erosionRadius; dx++) {
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist <= erosionRadius) {
        const weight = 1 - dist / erosionRadius
        brushWeights.push(weight)
        brushOffsets.push(dy * width + dx)
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
  for (let i = 0; i < iterations; i++) {
    // 1. Spawn droplet at random location
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

      // 2. Calculate new direction (negative gradient + inertia)
      dirX = dirX * inertia - gx * (1 - inertia)
      dirY = dirY * inertia - gy * (1 - inertia)

      // 3. Normalize direction
      const len = Math.sqrt(dirX * dirX + dirY * dirY)
      if (len !== 0) { dirX /= len; dirY /= len }

      // 4. Move droplet
      const nextX = posX + dirX
      const nextY = posY + dirY

      // 5. Boundary check
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

      // 6. Sediment Capacity calculation
      // c = max(-deltaH, minSlope) * speed * water * capacityFactor
      const capacity = Math.max(-deltaH, minSedimentCapacity) * speed * water * sedimentCapacityFactor

      // 7. Erosion and Deposition
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
        
        // Distribute erosion weighted by brush
        for (let b = 0; b < brushOffsets.length; b++) {
          const targetIdx = (nodeY * width + nodeX) + brushOffsets[b]
          if (targetIdx >= 0 && targetIdx < map.length) {
            // Subtract weighted erosion, but ensure we don't go below absolute zero
            const weight = brushWeights[b]
            const actualErode = Math.min(map[targetIdx], erodeAmt * weight)
            map[targetIdx] -= actualErode
          }
        }
        sediment += erodeAmt
      }

      // 8. Update velocity and water volume
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
