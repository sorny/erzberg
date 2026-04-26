import { simulateErosion } from './erosion'

self.onmessage = (e) => {
  const { pixels, width, height, iterations, params } = e.data
  try {
    const result = simulateErosion(pixels, width, height, iterations, params, (pct) => {
      self.postMessage({ progress: pct })
    })
    self.postMessage({ result }, [result.buffer])
  } catch (err) {
    self.postMessage({ error: err.message })
  }
}
