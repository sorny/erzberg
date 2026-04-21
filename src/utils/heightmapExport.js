/**
 * Heightmap Export — saves the processed terrain grid as a trimmed greyscale PNG.
 * 
 * Automatically crops empty (black) borders to ensure the resulting image
 * contains only the relevant terrain data.
 */

export function exportHeightmap(terrainData, filename = 'heightmap_processed.png') {
  if (!terrainData || !terrainData.grid) return

  const { grid, rows, cols } = terrainData
  
  // 1. Find bounding box of non-zero data
  let minR = rows, maxR = 0, minC = cols, maxC = 0
  let hasData = false

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r * cols + c] > 0) {
        if (r < minR) minR = r
        if (r > maxR) maxR = r
        if (c < minC) minC = c
        if (c > maxC) maxC = c
        hasData = true
      }
    }
  }

  // If map is entirely empty, export the full thing (or abort)
  if (!hasData) {
    minR = 0; maxR = rows - 1; minC = 0; maxC = cols - 1
  }

  const exportW = (maxC - minC) + 1
  const exportH = (maxR - minR) + 1

  // 2. Create canvas for the trimmed area
  const canvas = document.createElement('canvas')
  canvas.width = exportW
  canvas.height = exportH
  const ctx = canvas.getContext('2d')
  const imgData = ctx.createImageData(exportW, exportH)

  // 3. Fill image data from the bounding box
  for (let r = 0; r < exportH; r++) {
    for (let c = 0; c < exportW; c++) {
      const sourceIdx = (minR + r) * cols + (minC + c)
      const v = Math.round(grid[sourceIdx] * 255)
      const destIdx = (r * exportW + c) * 4
      
      imgData.data[destIdx]     = v   // R
      imgData.data[destIdx + 1] = v   // G
      imgData.data[destIdx + 2] = v   // B
      imgData.data[destIdx + 3] = 255 // A
    }
  }

  ctx.putImageData(imgData, 0, 0)

  // 4. Trigger download
  const link = document.createElement('a')
  link.download = filename
  link.href = canvas.toDataURL('image/png')
  link.click()
  
  console.log(`Heightmap exported: ${exportW}x${exportH} (Trimmed from ${cols}x${rows})`)
}
