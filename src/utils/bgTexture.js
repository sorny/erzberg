/**
 * The gradient paper as a texture, for a scene that has to draw on it.
 *
 * The paper is normally CSS behind a transparent canvas. A multiplied layer
 * (Riso's overprint, an anaglyph on paper) can only darken what is under it,
 * and over a transparent clear there is nothing, so on a gradient it drew
 * nothing at all. With this as `scene.background` the paper is in the frame
 * and the layer has something to darken. Top to bottom over the whole frame,
 * as the CSS gradient and the PNG export lay it.
 */
import * as THREE from 'three'

export function gradientTexture(stops) {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height)
  for (const s of stops) grad.addColorStop(s.pos, s.color)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Whether a multiplied layer is on the plate, so the paper must be in the frame. */
export function multipliesOnPaper(style, view, dark) {
  if (view?.anaglyph && !dark) return true
  if (style?.enabledRiso && style.overprintRiso !== false) return true
  return !!style?.modeCopies?.some((c) => c.mode === 'Riso' && c.values?.enabledRiso !== false && c.values?.overprintRiso !== false)
}
