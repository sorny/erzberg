/**
 * What the screen does to an ink, and why the exporter has to do it too.
 *
 * The renderer is a React Three Fiber `<Canvas>`, which comes with ACES filmic
 * tone mapping and an sRGB output encode and is never told otherwise. So an ink
 * does not reach the eye as the number it was written as. The exporter wrote the
 * raw number, and the SVG therefore disagreed with the viewport — worst where a
 * colour was bright and saturated, which is where the tone curve does the most
 * work.
 *
 * The pairs below are not derived from the shader source. They were measured off
 * the running app: a flat colour set on Mode: Lines at weight 12, screenshotted,
 * and the dominant pixel read back. That is what makes them a test rather than a
 * restatement of the implementation.
 */
import { describe, it, expect } from 'vitest'
import { screenInk, screenInkHex } from '../../src/utils/svgExport'

describe('screenInk', () => {
  it('reproduces what the renderer put on screen', () => {
    // picked → measured on the canvas.
    const measured = {
      '#800000': '#ca0006',   // Jet's top stop: a deep red on screen, and the
                              // brown in the old export that started all this
      '#00cce6': '#85dcde',
      '#66cf00': '#c3db50',
      '#ffffff': '#e2e2e2',
    }
    for (const [picked, onScreen] of Object.entries(measured)) {
      expect(screenInkHex(picked), picked).toBe(onScreen)
    }
  })

  it('leaves black alone, so plain line art is untouched', () => {
    // Most plates are black on white. The tone curve maps 0 to 0, so this whole
    // change is invisible to them — which is the reason it is safe to apply to
    // every ink rather than only to the colour modes.
    expect(screenInkHex('#000000')).toBe('#000000')
    expect(screenInk(0, 0, 0)).toBe('#000000')
  })

  it('takes floats and hex to the same place', () => {
    expect(screenInk(0x80 / 255, 0, 0)).toBe(screenInkHex('#800000'))
  })

  it('defaults a missing ink to black rather than to NaN', () => {
    expect(screenInkHex(undefined)).toBe('#000000')
    expect(screenInkHex(null)).toBe('#000000')
  })

  it('is not idempotent, which is why it must be applied exactly once', () => {
    /*
     * The trap this file exists to mark. The transform is a tone curve, so
     * running it twice is not a no-op — it washes the colour out again. A text
     * layer captures `flatStroke`, which has already been through here, and the
     * writer put it through a second time: a label set to #00ff00 went out as
     * #d0dfb9 instead of #93e459.
     */
    const once = screenInkHex('#00ff00')
    expect(once).toBe('#93e459')
    expect(screenInkHex(once)).toBe('#d0dfb9')
    expect(screenInkHex(once)).not.toBe(once)
  })

  it('clamps rather than writing a channel out of range', () => {
    // Vertex colours are built by arithmetic — a relief multiply, a grain — and
    // nothing upstream promises they landed inside 0–1.
    expect(screenInk(2, -1, 0.5)).toMatch(/^#[0-9a-f]{6}$/)
  })
})
