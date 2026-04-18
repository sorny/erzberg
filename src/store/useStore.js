import { create } from 'zustand'

/**
 * Global store — only holds data that cannot live inside Leva:
 *  - loaded heightmap pixel data
 *  - computed terrain grid (brightness samples)
 *  - filename display
 *
 * All tweakable visual / terrain params live in Leva (see App.jsx).
 */
export const useStore = create((set) => ({
  // Raw pixel brightness extracted from the loaded image (Float32Array, values 0–1)
  heightmapPixels: null,
  heightmapWidth: 0,
  heightmapHeight: 0,
  heightmapFilename: '',

  setHeightmap: (pixels, width, height, filename) =>
    set({ heightmapPixels: pixels, heightmapWidth: width, heightmapHeight: height, heightmapFilename: filename }),

  clearHeightmap: () =>
    set({ heightmapPixels: null, heightmapWidth: 0, heightmapHeight: 0, heightmapFilename: '' }),
}))
