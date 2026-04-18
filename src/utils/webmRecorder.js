/**
 * WebM video capture using the browser's MediaRecorder API.
 * Captures frames directly from the Three.js WebGL canvas.
 */

let recorder  = null
let chunks    = []
let stopTimer = null

export function startWebM(canvas, durationSecs, onStateChange) {
  if (recorder) return

  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) ?? ''

  try {
    const stream = canvas.captureStream(30)
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunks = []

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const url  = URL.createObjectURL(blob)
      Object.assign(document.createElement('a'), {
        href: url, download: 'heightmap.webm',
      }).click()
      URL.revokeObjectURL(url)
      recorder = null
      chunks   = []
      onStateChange?.(false)
    }

    recorder.start(100)
    onStateChange?.(true)

    if (durationSecs > 0) {
      stopTimer = setTimeout(() => stopWebM(onStateChange), durationSecs * 1000)
    }
  } catch (err) {
    console.error('[WebM] Failed to start recording:', err)
    recorder = null
  }
}

export function stopWebM(onStateChange) {
  clearTimeout(stopTimer)
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop()
  }
  onStateChange?.(false)
}

export function isRecording() {
  return recorder !== null && recorder.state === 'recording'
}
