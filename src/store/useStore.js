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
  clearTextureImage: () => set({ textureImage: null }),

  setGeoTiffMeta: (elevMin, elevMax) =>
    set({ geoTiffElevMin: elevMin, geoTiffElevMax: elevMax }),

  clearGeoTiffMeta: () =>
    set({ geoTiffElevMin: null, geoTiffElevMax: null }),

  clearHeightmap: () =>
    set({ heightmapPixels: null, nodataMask: null, heightmapWidth: 0, heightmapHeight: 0, heightmapFilename: '',
          textureImage: null, geoTiffElevMin: null, geoTiffElevMax: null }),
}))
