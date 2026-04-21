/**
 * Hydraulic Erosion Simulation based on Hans Beyer's Thesis.
 * 
 * This implementation uses a droplet-based approach with bilinear sampling, 
 * inertia-driven movement, and weighted erosion brushes to create smooth, 
 * realistic drainage patterns.
 */

export function simulateErosion(pixels, width, height, iterations = 50000, params = {}) {
  // Create a working copy to avoid mutating the original until finished
  const map = new Float32Array(pixels)
  
  const {
    inertia = 0.1,
    sedimentCapacityFactor = 4,
    minSedimentCapacity = 0.01,
    erodeSpeed = 0.3,
    depositSpeed = 0.3,
    evaporateSpeed = 0.01,
    gravity = 4,
    maxDropletLifetime = 30,
    erosionRadius = 3
  } = params

  // --- Precompute Erosion Brush ---
  // A circular weight map that distributes erosion over multiple pixels
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
  // Normalise weights
  for (let i = 0; i < brushWeights.length; i++) brushWeights[i] /= weightSum

  // --- Helpers ---
  function getGradientAndHeight(x, y) {
    const posX = Math.floor(x)
    const posY = Math.floor(y)
    const u = x - posX
    const v = y - posY

    const idx00 = posY * width + posX
    const idx10 = idx00 + 1
    const idx01 = idx00 + width
    const idx11 = idx01 + 1

    const h00 = map[idx00]
    const h10 = map[idx10]
    const h01 = map[idx01]
    const h11 = map[idx11]

    const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v
    const gy = (h01 - h00) * (1 - u) + (h11 - h10) * u
    const height = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v

    return { height, gx, gy }
  }

  // --- Main Loop ---
  for (let i = 0; i < iterations; i++) {
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
      const { height: hOld, gx, gy } = getGradientAndHeight(posX, posY)

      // Calculate direction with inertia
      dirX = dirX * inertia - gx * (1 - inertia)
      dirY = dirY * inertia - gy * (1 - inertia)

      // Normalize
      const len = Math.sqrt(dirX * dirX + dirY * dirY)
      if (len !== 0) { dirX /= len; dirY /= len }

      posX += dirX
      posY += dirY

      // Boundary check
      if (posX < 0 || posX >= width - 1 || posY < 0 || posY >= height - 1) break

      const { height: hNew } = getGradientAndHeight(posX, posY)
      const deltaH = hNew - hOld

      // Calculate capacity
      const capacity = Math.max(-deltaH * speed * water * sedimentCapacityFactor, minSedimentCapacity)

      if (sediment > capacity || deltaH > 0) {
        // Deposition
        const depositAmt = (deltaH > 0) ? Math.min(deltaH, sediment) : (sediment - capacity) * depositSpeed
        sediment -= depositAmt

        const u = posX - nodeX, v = posY - nodeY
        map[nodeY * width + nodeX] += depositAmt * (1 - u) * (1 - v)
        map[nodeY * width + nodeX + 1] += depositAmt * u * (1 - v)
        map[(nodeY + 1) * width + nodeX] += depositAmt * (1 - u) * v
        map[(nodeY + 1) * width + nodeX + 1] += depositAmt * u * v
      } else {
        // Erosion
        const erodeAmt = Math.min((capacity - sediment) * erodeSpeed, -deltaH)
        
        // Distribute erosion over brush radius
        for (let b = 0; b < brushOffsets.length; b++) {
          const targetIdx = (nodeY * width + nodeX) + brushOffsets[b]
          if (targetIdx >= 0 && targetIdx < map.length) {
            map[targetIdx] -= erodeAmt * brushWeights[b]
          }
        }
        sediment += erodeAmt
      }

      // Update velocity and water
      speed = Math.sqrt(speed * speed + deltaH * gravity)
      water *= (1 - evaporateSpeed)
    }
  }

  return map
}
