/**
 * Heightmap Export — saves the processed terrain grid as a trimmed greyscale PNG.
 * 
 * Automatically crops empty (black) borders to ensure the resulting image
 * contains only the relevant terrain data.
 */

export function exportHeightmap(terrainData, baseName) {
  const filename = `${baseName ?? 'export'}-heightmap.png`
  // Returns the name it wrote, or null — the caller reports which one happened.
  if (!terrainData || !terrainData.grid) return null

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
  return filename
}

// Written for cells outside the data, and named in GDAL_NODATA so GIS tools
// and this app's own loader read them as holes.
const GEOTIFF_NODATA = -9999

/**
 * The current raster as a 32-bit GeoTIFF in metres, with its projection and
 * extent, so an edited or eroded terrain can go back to a GIS tool or reopen
 * here unchanged.
 *
 * It writes the raster the app holds, at full size: Edit Mode's crop and the
 * erosion are in it. The render settings (levels, blur, grid step) are not,
 * because they are choices about the picture, not about the ground.
 *
 * A projection given as a code is written as that code. One the file defined
 * itself (`PROJ4:`) has no code to write, so the file says only whether it is
 * projected or geographic. Returns the name it wrote and that caveat, or null
 * when there is nothing in metres to write.
 */
export async function exportGeoTiff(raster, baseName) {
  const { pixels, mask, width, height, bbox, crs, elevMin, elevMax } = raster ?? {}
  if (!pixels || !(width > 0) || !(height > 0) || elevMin == null || elevMax == null || !bbox) return null

  const range = elevMax - elevMin
  const values = new Float32Array(width * height)
  for (let i = 0; i < values.length; i++)
    values[i] = mask && mask[i] === 0 ? GEOTIFF_NODATA : elevMin + pixels[i] * range

  const [minX, minY, maxX, maxY] = bbox
  const keys = geoKeysFor(crs)
  const metadata = {
    width, height,
    ModelPixelScale: [(maxX - minX) / width, (maxY - minY) / height, 0],
    ModelTiepoint: [0, 0, 0, minX, maxY, 0],
    GTRasterTypeGeoKey: 1,   // PixelIsArea: the bbox is the outer edge of the cells
    GDAL_NODATA: `${GEOTIFF_NODATA}`,
    ...keys.keys,
  }
  const { writeArrayBuffer } = await import('geotiff')
  const buffer = writeArrayBuffer(values, metadata)

  const filename = `${baseName ?? 'export'}-heightmap.tif`
  const url = URL.createObjectURL(new Blob([buffer], { type: 'image/tiff' }))
  const link = document.createElement('a')
  link.download = filename
  link.href = url
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { filename, codeless: keys.codeless }
}

/** The geokeys that name a CRS string, and whether it had no code to name. */
export function geoKeysFor(crs) {
  const m = /^EPSG:(\d+)$/.exec(crs ?? '')
  if (m) {
    const code = +m[1]
    return code >= 4000 && code <= 4999
      ? { keys: { GTModelTypeGeoKey: 2, GeographicTypeGeoKey: code }, codeless: false }
      : { keys: { GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: code }, codeless: false }
  }
  const geographic = crs === 'EPSG:geographic-unknown' || /\+proj=longlat\b/.test(crs ?? '')
  // 32767 is GeoTIFF's "user-defined": the writer's default of WGS84 would be a lie.
  return geographic
    ? { keys: { GTModelTypeGeoKey: 2, GeographicTypeGeoKey: 32767 }, codeless: true }
    : { keys: { GTModelTypeGeoKey: 1, ProjectedCSTypeGeoKey: 32767 }, codeless: true }
}
