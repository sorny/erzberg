/**
 * SVG export — projects current line segment geometry through the active camera
 * into screen-space pixel coordinates, computes a tight bounding box around all
 * visible segments, and triggers a download.
 *
 * The viewBox is derived from the actual geometry extent (not a fixed paper size),
 * so the file opens correctly in any browser / vector editor without clipping.
 *
 * Occlusion note: depth-buffer occlusion is NOT reproduced in SVG (background
 * lines will show through mountains). Use PNG export for a pixel-perfect capture.
 */
import * as THREE from 'three'

const MARGIN = 20   // px padding around the geometry bounding box

export function exportSVG({ positions, colors, camera, width, height, bgColor, lineColor, strokeWeight }) {
  if (!positions || positions.length === 0) {
    console.warn('[SVG] No geometry to export.')
    return
  }

  // Project 3D vertex → pixel coords in [0, width] × [0, height]
  const project = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera)
    return [
      ( v.x + 1) * 0.5 * width,
      (-v.y + 1) * 0.5 * height,
    ]
  }

  // First pass — collect projected segments and compute bounding box
  const segments = []
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity

  const segCount = positions.length / 6
  for (let s = 0; s < segCount; s++) {
    const i = s * 6
    const [x0, y0] = project(positions[i],     positions[i + 1], positions[i + 2])
    const [x1, y1] = project(positions[i + 3], positions[i + 4], positions[i + 5])

    // Skip degenerate segments
    if (Math.hypot(x1 - x0, y1 - y0) < 0.01) continue

    let stroke = lineColor
    if (colors && colors.length > s * 6 + 2) {
      const si = s * 6
      const r  = Math.round(colors[si]     * 255)
      const g  = Math.round(colors[si + 1] * 255)
      const b  = Math.round(colors[si + 2] * 255)
      stroke = `rgb(${r},${g},${b})`
    }

    segments.push({ x0, y0, x1, y1, stroke })

    minX = Math.min(minX, x0, x1)
    minY = Math.min(minY, y0, y1)
    maxX = Math.max(maxX, x0, x1)
    maxY = Math.max(maxY, y0, y1)
  }

  if (segments.length === 0) {
    console.warn('[SVG] All segments were degenerate.')
    return
  }

  // Derive viewBox from geometry extent + margin
  const vx = minX - MARGIN
  const vy = minY - MARGIN
  const vw = (maxX - minX) + MARGIN * 2
  const vh = (maxY - minY) + MARGIN * 2

  // Second pass — emit lines with coordinates offset so (minX,minY) → (MARGIN,MARGIN)
  const lines = segments.map(({ x0, y0, x1, y1, stroke }) =>
    `    <line x1="${(x0 - vx).toFixed(2)}" y1="${(y0 - vy).toFixed(2)}" ` +
    `x2="${(x1 - vx).toFixed(2)}" y2="${(y1 - vy).toFixed(2)}" stroke="${stroke}"/>`
  )

  const sw = (strokeWeight * 0.5).toFixed(3)

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     width="${vw.toFixed(0)}" height="${vh.toFixed(0)}"`,
    `     viewBox="0 0 ${vw.toFixed(2)} ${vh.toFixed(2)}">`,
    `  <rect width="100%" height="100%" fill="${bgColor}"/>`,
    `  <g stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">`,
    ...lines,
    `  </g>`,
    `</svg>`,
  ].join('\n')

  download(svg, 'heightmap.svg', 'image/svg+xml')
}

function download(content, filename, mime) {
  const blob = new Blob([content], { type: mime })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
