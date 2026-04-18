/**
 * SVG export — projects current line segment geometry through the active camera,
 * scales to fit A4 landscape (297 × 210 mm), and triggers a download.
 *
 * Occlusion note: depth-buffer occlusion is NOT reproduced in SVG (background
 * lines will show through mountains). Use PNG export for a pixel-perfect capture.
 */
import * as THREE from 'three'

// A4 landscape in mm — SVG user units map 1:1 to mm when width/height carry units.
const A4_W_MM = 297
const A4_H_MM = 210
// Margin inside the A4 frame so lines don't touch the edge
const MARGIN_MM = 10

export function exportSVG({ positions, colors, camera, width, height, bgColor, lineColor, strokeWeight }) {
  if (!positions || positions.length === 0) {
    console.warn('[SVG] No geometry to export.')
    return
  }

  const usableW = A4_W_MM - MARGIN_MM * 2
  const usableH = A4_H_MM - MARGIN_MM * 2

  // Project 3D vertex → NDC [-1,1] then to mm inside the A4 frame
  const project = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera)
    // NDC to [0, usableW] / [0, usableH] then offset by margin
    const px = ( v.x + 1) * 0.5 * usableW + MARGIN_MM
    const py = (-v.y + 1) * 0.5 * usableH + MARGIN_MM
    return [px, py]
  }

  const lines = []
  const segCount = positions.length / 6

  for (let s = 0; s < segCount; s++) {
    const i = s * 6
    const [x0, y0] = project(positions[i],     positions[i + 1], positions[i + 2])
    const [x1, y1] = project(positions[i + 3], positions[i + 4], positions[i + 5])

    // Discard degenerate or fully out-of-frame segments
    if (Math.hypot(x1 - x0, y1 - y0) < 0.01) continue
    if ((x0 < 0 && x1 < 0) || (x0 > A4_W_MM && x1 > A4_W_MM)) continue
    if ((y0 < 0 && y1 < 0) || (y0 > A4_H_MM && y1 > A4_H_MM)) continue

    let stroke = lineColor
    if (colors && colors.length > s * 6 + 2) {
      const si = s * 6
      const r  = Math.round(colors[si]     * 255)
      const g  = Math.round(colors[si + 1] * 255)
      const b  = Math.round(colors[si + 2] * 255)
      stroke = `rgb(${r},${g},${b})`
    }

    lines.push(
      `<line x1="${x0.toFixed(3)}" y1="${y0.toFixed(3)}" ` +
      `x2="${x1.toFixed(3)}" y2="${y1.toFixed(3)}" stroke="${stroke}"/>`
    )
  }

  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    `     width="${A4_W_MM}mm" height="${A4_H_MM}mm"`,
    `     viewBox="0 0 ${A4_W_MM} ${A4_H_MM}">`,
    `  <rect width="${A4_W_MM}" height="${A4_H_MM}" fill="${bgColor}"/>`,
    `  <g stroke-width="${(strokeWeight * 0.35).toFixed(3)}mm" stroke-linecap="round" stroke-linejoin="round">`,
    ...lines.map(l => '    ' + l),
    `  </g>`,
    `</svg>`,
  ].join('\n')

  download(svg, 'heightmap_A4.svg', 'image/svg+xml')
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
