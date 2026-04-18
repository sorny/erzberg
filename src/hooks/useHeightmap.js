/**
 * Loads a heightmap image (File or URL string) and extracts per-pixel brightness
 * into a Float32Array stored in the Zustand store.
 *
 * Brightness = (r + g + b) / (3 × 255), matching the original sketch's logic.
 */
import { useCallback } from 'react'
import { useStore } from '../store/useStore'

export function useHeightmap() {
  const setHeightmap = useStore((s) => s.setHeightmap)

  const load = useCallback((source) => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'

      img.onload = () => {
        const { naturalWidth: w, naturalHeight: h } = img
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0)
        const { data } = ctx.getImageData(0, 0, w, h)

        const pixels = new Float32Array(w * h)
        for (let i = 0; i < w * h; i++) {
          const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]
          pixels[i] = (r + g + b) / (3 * 255)
        }

        const filename = typeof source === 'string'
          ? source.split('/').pop()
          : source.name

        setHeightmap(pixels, w, h, filename)
        resolve({ pixels, width: w, height: h })
      }

      img.onerror = reject

      if (typeof source === 'string') {
        img.src = source
      } else {
        img.src = URL.createObjectURL(source)
      }
    })
  }, [setHeightmap])

  /** Open a file picker and load the chosen image */
  const loadFromPicker = useCallback(() => {
    const input = Object.assign(document.createElement('input'), {
      type: 'file',
      accept: 'image/*',
    })
    input.onchange = (e) => {
      const file = e.target.files[0]
      if (file) load(file)
    }
    input.click()
  }, [load])

  return { load, loadFromPicker }
}
