/**
 * DXF export — projects line geometry through the camera and outputs
 * an AutoCAD-compatible DXF file with 2D LINE entities on A4 landscape.
 */
import * as THREE from 'three'

const A4_W = 277   // usable mm (297 - 2×10 margin)
const A4_H = 190   // usable mm (210 - 2×10 margin)
const OFFSET_X = 10
const OFFSET_Y = 10

export function exportDXF({ positions, camera }) {
  if (!positions || positions.length === 0) return

  const project = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera)
    return [
      ((v.x + 1) * 0.5 * A4_W + OFFSET_X).toFixed(4),
      ((- v.y + 1) * 0.5 * A4_H + OFFSET_Y).toFixed(4),
    ]
  }

  const rows = [
    '0', 'SECTION', '2', 'HEADER',
    '9', '$ACADVER', '1', 'AC1009',
    '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
  ]

  const segCount = positions.length / 6
  for (let s = 0; s < segCount; s++) {
    const i = s * 6
    const [x0, y0] = project(positions[i],     positions[i + 1], positions[i + 2])
    const [x1, y1] = project(positions[i + 3], positions[i + 4], positions[i + 5])
    rows.push(
      '0', 'LINE',
      '8', '0',
      '10', x0, '20', y0, '30', '0.0',
      '11', x1, '21', y1, '31', '0.0',
    )
  }

  rows.push('0', 'ENDSEC', '0', 'EOF')

  const content = rows.join('\n')
  const blob = new Blob([content], { type: 'application/dxf' })
  const url  = URL.createObjectURL(blob)
  Object.assign(document.createElement('a'), { href: url, download: 'heightmap.dxf' }).click()
  URL.revokeObjectURL(url)
}
