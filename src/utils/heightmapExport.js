/**
 * Heightmap Export — saves the processed terrain grid as a 1:1 greyscale PNG.
 * 
 * This allows you to use the processed terrain (with erosion, etc.) in other
 * tools like Blender, Unreal Engine, or Unity.
 */

export function exportHeightmap(terrainData, filename = 'heightmap_processed.png') {
  if (!terrainData || !terrainData.grid) return

  const { grid, rows, cols } = terrainData
  
  // Create a canvas to draw the pixels
  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d')
  const imgData = ctx.createImageData(cols, rows)

  // Fill image data with greyscale values from the grid (0-1 range)
  for (let i = 0; i < grid.length; i++) {
    const v = Math.round(grid[i] * 255)
    const idx = i * 4
    imgData.data[idx]     = v   // R
    imgData.data[idx + 1] = v   // G
    imgData.data[idx + 2] = v   // B
    imgData.data[idx + 3] = 255 // A (Opaque)
  }

  ctx.putImageData(imgData, 0, 0)

  // Trigger download
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
}
