/**
 * Deterministic hash-based 2D value noise — no external dependencies.
 * Identical algorithm used in the original p5 sketch's Web Worker.
 */
export function valueNoise2D(x, y) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy

  // Quintic smoothstep
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)

  const h = (a, b) => {
    let n = ((a * 1031 + b * 2999) | 0)
    n = (((n ^ (n >>> 13)) * 0x45d9f3b) | 0)
    return (((n ^ (n >>> 16)) & 0xffff) / 0xffff)
  }

  return (
    h(ix, iy) * (1 - ux) * (1 - uy) +
    h(ix + 1, iy) * ux * (1 - uy) +
    h(ix, iy + 1) * (1 - ux) * uy +
    h(ix + 1, iy + 1) * ux * uy
  )
}
