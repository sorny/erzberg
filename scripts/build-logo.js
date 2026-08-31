/**
 * Flattens the `<text>` in the brand SVGs to outlines.
 *
 * `logo.svg` asked a browser to fetch Space Mono from Google, and the README
 * embeds it as `<img src="public/logo.svg">` — a context where browsers refuse
 * every external load, fonts included. Measured: opened as a document the file
 * makes two requests to Google and renders in Space Mono; inside an `<img>` it
 * makes none and falls back to `'Courier New'`. So the wordmark has never once
 * rendered in its own typeface where it is actually used.
 *
 * Outlines fix both halves of that at once. There is nothing to fetch, so the
 * last external reference in the shipped output goes; and there is nothing to
 * fall back to, so it looks the same in a README, a browser tab, an editor and
 * a plotter.
 *
 * The glyphs come from `public/fonts/space-mono-{bold,regular}.json`, which
 * `npm run font` already generates for the 3D labels — the same outlines the
 * app letters contours with. Space Mono is monospaced and carries one advance
 * for the whole face, so setting a run is an accumulate rather than a shaping
 * problem.
 *
 * Idempotent: it converts whatever `<text>` it finds and leaves everything else
 * byte for byte. Run it again and there is nothing left to convert. If the
 * wordmark ever changes, put a `<text>` back and re-run.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['public/logo.svg', 'public/og-image.svg']

const faces = {
  700: JSON.parse(readFileSync(join(ROOT, 'public/fonts/space-mono-bold.json'), 'utf8')),
  400: JSON.parse(readFileSync(join(ROOT, 'public/fonts/space-mono-regular.json'), 'utf8')),
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))
  return m ? m[1] : null
}

/**
 * One text run as a group of outlines.
 *
 * The glyph paths are already in the orientation SVG wants — y down, baseline at
 * zero, which is what `getPath()` produces — so the whole run needs one
 * `translate` to the baseline and one `scale` from font units, and each glyph
 * needs only its own offset along x. Nothing is rewritten inside a `d`
 * attribute: the curves are the ones the designer drew, moved by a transform.
 */
function runToPaths(text, { x, y, size, weight, spacing, fill, anchor }) {
  const face = faces[weight] ?? faces[400]
  const scale = size / face.unitsPerEm
  // Letter-spacing is in user units; everything inside the group is in font
  // units, so it has to be divided back out before it can be added to an advance.
  const step = face.advance + spacing / scale
  const width = text.length * step * scale

  let originX = x
  if (anchor === 'middle') originX = x - width / 2
  else if (anchor === 'end') originX = x - width

  const round = (n) => Number(n.toFixed(4)).toString()
  const glyphs = []
  text.split('').forEach((ch, i) => {
    const d = face.glyphs[ch]
    if (!d) return                        // a space has no outline, only an advance
    const dx = i * step
    glyphs.push(dx === 0
      ? `      <path d="${d}"/>`
      : `      <path transform="translate(${round(dx)} 0)" d="${d}"/>`)
  })

  return [
    `    <g fill="${fill}" transform="translate(${round(originX)} ${round(y)}) scale(${round(scale)})">`,
    ...glyphs,
    '    </g>',
  ].join('\n')
}

let total = 0
for (const rel of FILES) {
  const path = join(ROOT, rel)
  let svg = readFileSync(path, 'utf8')
  let converted = 0

  svg = svg.replace(/[ \t]*<text\b([^>]*)>([^<]*)<\/text>/g, (whole, attrs, text) => {
    const size = parseFloat(attr(attrs, 'font-size'))
    if (!Number.isFinite(size)) return whole
    converted++
    return runToPaths(text, {
      x: parseFloat(attr(attrs, 'x') || '0'),
      y: parseFloat(attr(attrs, 'y') || '0'),
      size,
      weight: parseInt(attr(attrs, 'font-weight') || '400', 10),
      spacing: parseFloat(attr(attrs, 'letter-spacing') || '0'),
      fill: attr(attrs, 'fill') || '#000',
      anchor: attr(attrs, 'text-anchor') || 'start',
    })
  })

  // With no text left, the webfont import has nothing to serve.
  svg = svg.replace(/[ \t]*<defs>\s*<style>\s*@import url\('https:\/\/fonts\.googleapis[^']*'\);?\s*<\/style>\s*<\/defs>\n?/g, '')

  writeFileSync(path, svg)
  console.log(`[logo] ${rel}: ${converted} text run(s) flattened`)
  total += converted
}
if (!total) console.log('[logo] nothing to convert — already outlines')
