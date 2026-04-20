/**
 * Hydraulic Erosion Simulation.
 * Ported/inspired by Hans Beyer's hydraulic erosion implementation.
 * 
 * Modifies the heightmap in-place to simulate rainfall, sediment carry, 
 * and deposition. O(iterations * max_lifetime).
 */

export function simulateErosion(pixels, width, height, iterations = 50000) {
  const map = new Float32Array(pixels)
  
  // Parameters
  const inertia = 0.05
  const sedimentCapacityFactor = 4
  const minSedimentCapacity = 0.01
  const erodeSpeed = 0.3
  const depositSpeed = 0.3
  const evaporateSpeed = 0.01
  const gravity = 4
  const maxDropletLifetime = 30
  const initialWaterVolume = 1
  const initialVelocity = 1

  // Pre-compute gradient and height at fractional positions
  function calculateHeightAndGradient(x, y) {
    const posX = Math.floor(x)
    const posY = Math.floor(y)
    const u = x - posX
    const v = y - posY

    const offset00 = posY * width + posX
    const offset10 = offset00 + 1
    const offset01 = offset00 + width
    const offset11 = offset01 + 1

    const h00 = map[offset00]
    const h10 = map[offset10]
    const h01 = map[offset01]
    const h11 = map[offset11]

    const gx = (h10 - h00) * (1 - v) + (h11 - h01) * v
    const gy = (h01 - h00) * (1 - u) + (h11 - h10) * u
    const height = h00 * (1 - u) * (1 - v) + h10 * u * (1 - v) + h01 * (1 - u) * v + h11 * u * v

    return { height, gx, gy }
  }

  for (let i = 0; i < iterations; i++) {
    // Spawn droplet at random position
    let posX = Math.random() * (width - 1)
    let posY = Math.random() * (height - 1)
    let dirX = 0
    let dirY = 0
    let speed = initialVelocity
    let water = initialWaterVolume
    let sediment = 0

    for (let lifetime = 0; lifetime < maxDropletLifetime; lifetime++) {
      const nodeX = Math.floor(posX)
      const nodeY = Math.floor(posY)
      const { height: hOld, gx, gy } = calculateHeightAndGradient(posX, posY)

      // Calculate new direction
      dirX = dirX * inertia - gx * (1 - inertia)
      dirY = dirY * inertia - gy * (1 - inertia)

      // Normalize direction
      const len = Math.sqrt(dirX * dirX + dirY * dirY)
      if (len !== 0) {
        dirX /= len
        dirY /= len
      }

      // Move droplet
      const newX = posX + dirX
      const newY = posY + dirY

      // Stop if out of bounds
      if (newX < 0 || newX >= width - 1 || newY < 0 || newY >= height - 1) break

      const { height: hNew } = calculateHeightAndGradient(newX, newY)
      const deltaH = hNew - hOld

      // Calculate sediment capacity
      const capacity = Math.max(-deltaH * speed * water * sedimentCapacityFactor, minSedimentCapacity)

      if (sediment > capacity || deltaH > 0) {
        // Deposit sediment
        const depositAmt = (deltaH > 0) ? Math.min(deltaH, sediment) : (sediment - capacity) * depositSpeed
        sediment -= depositAmt
        
        // Add to map using bilinear distribution
        const u = posX - nodeX, v = posY - nodeY
        map[nodeY * width + nodeX] += depositAmt * (1 - u) * (1 - v)
        map[nodeY * width + nodeX + 1] += depositAmt * u * (1 - v)
        map[(nodeY + 1) * width + nodeX] += depositAmt * (1 - u) * v
        map[(nodeY + 1) * width + nodeX + 1] += depositAmt * u * v
      } else {
        // Erode terrain
        const erodeAmt = Math.min((capacity - sediment) * erodeSpeed, -deltaH)
        
        // Remove from map
        const u = posX - nodeX, v = posY - nodeY
        map[nodeY * width + nodeX] -= erodeAmt * (1 - u) * (1 - v)
        map[nodeY * width + nodeX + 1] -= erodeAmt * u * (1 - v)
        map[(nodeY + 1) * width + nodeX] -= erodeAmt * (1 - u) * v
        map[(nodeY + 1) * width + nodeX + 1] -= erodeAmt * u * v
        
        sediment += erodeAmt
      }

      speed = Math.sqrt(speed * speed + deltaH * gravity)
      water *= (1 - evaporateSpeed)
      posX = newX
      posY = newY
    }
  }

  return map
}
