import { create } from 'zustand'

/**
 * Global store — only holds data that cannot live in plain React state:
 *  - loaded heightmap pixel data
 *  - GeoTIFF NoData mask
 *  - filename display
 *  - overlay texture image
 *
 * All tweakable visual / terrain params live in React state in App.jsx.
 */
export const useStore = create((set) => ({
  // Raw pixel brightness extracted from the loaded image (Float32Array, values 0–1)
  heightmapPixels: null,
  // Mask for GeoTIFF NoData pixels (Uint8Array, 1=valid, 0=nodata)
  nodataMask: null,
  heightmapWidth: 0,
  heightmapHeight: 0,
  heightmapFilename: '',
  
  // Overlay texture
  textureImage: null, // Image data (base64 or blob URL)

  // Real-world elevation metadata — only populated when a GeoTIFF is loaded
  geoTiffElevMin: null,   // metres (or native unit)
  geoTiffElevMax: null,
  geoTiffBbox: null,      // [minX, minY, maxX, maxY] in native CRS
  // 'EPSG:<code>' | 'EPSG:projected-unknown' | 'EPSG:geographic-unknown' | 'EPSG:none'.
  // classifyCRS() in utils/geoCoords.js is the only thing that interprets these.
  geoTiffCRS: null,
  geoTiffCRSName: null,   // the CRS name the file states about itself, if any

  setHeightmap: (pixels, mask, width, height, filename) =>
    set({
      heightmapPixels: pixels,
      nodataMask: mask,
      heightmapWidth: width,
      heightmapHeight: height,
      heightmapFilename: filename
    }),

  setPixels: (pixels) => set({ heightmapPixels: pixels }),

  setTextureImage: (img) => set({ textureImage: img }),

  setGeoTiffMeta: (elevMin, elevMax, bbox, crs, crsName) =>
    set({ geoTiffElevMin: elevMin, geoTiffElevMax: elevMax, geoTiffBbox: bbox ?? null,
          geoTiffCRS: crs ?? null, geoTiffCRSName: crsName ?? null }),

  clearGeoTiffMeta: () =>
    set({ geoTiffElevMin: null, geoTiffElevMax: null, geoTiffBbox: null,
          geoTiffCRS: null, geoTiffCRSName: null }),
}))
