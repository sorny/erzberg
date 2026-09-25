import { test, expect } from '@playwright/test'
import { openMark, openStage, resetToDefaults } from './helpers.js'
import { SECTION_TERMS } from '../src/components/panel/sectionTerms.js'
import { PANEL_MODES } from '../src/components/panel/sectionSummary.js'
import { STAGE_OF } from '../src/components/panel/stages.js'

/** Every section the filter index knows about should be on the panel. */
const SECTION_COUNT = Object.keys(SECTION_TERMS).length

/**
 * How many sections are on screen when the panel is at rest.
 *
 * The panel shows one pane at a time, so this is Terrain's own count and not all
 * sixty. Asked of the stage index rather than written down, for the reason the
 * mode count is asked of `PANEL_MODES`: a section moved into Terrain would
 * otherwise collect this number silently.
 */
const TERRAIN_COUNT = [...STAGE_OF.values()].filter((n) => n === 1).length

/**
 * How many draw modes there are, asked rather than remembered.
 *
 * It was written down here as thirty-one, and the thirty-second mode collected
 * it — in the test's *name* as well as in two assertions. `PANEL_MODES` is the
 * one place the panel's own order and count are stated, and it is what the index
 * renders from, so asking it is the same question the index answers.
 */
const MODE_COUNT = PANEL_MODES.length

/**
 * The control panel itself — the filter, the typed values, the shortcut.
 *
 * These cover the seams the panel grew when it stopped being purely a list of
 * sliders: a filter that decides what renders, a readout that is also an input,
 * and a disclosure that is now a button. Each one broke something adjacent that
 * looked unrelated, which is why they are asserted rather than assumed.
 */
async function openApp(page) {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('[data-testid="section-shape"]', { timeout: 30000 })
  await page.waitForTimeout(2500)
  await resetToDefaults(page)
}

test.describe('panel', () => {
  test('the filter narrows to the sections that answer to it', async ({ page }) => {
    await openApp(page)
    await page.fill('[data-testid="panel-filter"]', 'azimuth')
    await page.waitForTimeout(400)

    const visible = page.locator('[data-testid^="section-"]:visible')
    await expect(visible).toHaveCount(1)
    await expect(visible.first()).toHaveAttribute('data-testid', 'section-hillshade')
    // Found while switched off: the index is stated, not scraped from whatever
    // happens to be mounted, and Hillshade's controls only exist once it is on.
    await expect(visible.first()).toHaveAttribute('aria-expanded', 'true')

    await page.fill('[data-testid="panel-filter"]', '')
    await page.waitForTimeout(400)
    // Back to one pane, not to all sixty sections: clearing the field returns
    // the panel to the stage it was on, which is the one it opened on.
    await expect(page.locator('[data-testid^="section-"]:visible')).toHaveCount(TERRAIN_COUNT)
  })

  test('a filtered-out section is hidden, not unmounted', async ({ page }) => {
    // A collapsed section has always kept its children mounted behind a
    // zero-height row, so the panel's local state — a running Overpass fetch and
    // the controller that can cancel it, the category ticks, a feature filter —
    // survived being closed. Returning null on a keystroke threw all of it away.
    await openApp(page)
    await page.fill('[data-testid="panel-filter"]', 'azimuth')
    await page.waitForTimeout(400)
    const inDom = await page.locator('[data-testid^="section-"]').count()
    const onScreen = await page.locator('[data-testid^="section-"]:visible').count()
    expect(inDom).toBe(SECTION_COUNT)
    expect(onScreen).toBe(1)
  })

  test('a header click while filtering changes nothing behind it', async ({ page }) => {
    // The filter forces every survivor open, so the click had no visible effect
    // — and the section it silently collapsed came back that way once the field
    // was cleared.
    await openApp(page)
    const hillshade = page.locator('[data-testid="section-hillshade"]')
    await expect(hillshade).toHaveAttribute('aria-expanded', 'false')

    await page.fill('[data-testid="panel-filter"]', 'azimuth')
    await page.waitForTimeout(400)
    await hillshade.click({ force: true })
    await page.waitForTimeout(300)
    await page.fill('[data-testid="panel-filter"]', '')
    await page.waitForTimeout(400)
    await expect(hillshade).toHaveAttribute('aria-expanded', 'false')
  })

  test('a typed value lands on the slider’s own step grid', async ({ page }) => {
    // Only sub-1 steps used to snap, so 37 on a step-5 Azimuth was stored as 37
    // while the thumb — which cannot represent it — sat at 35: two controls for
    // one value, disagreeing on screen.
    await openApp(page)
    await openStage(page, 'surface')
    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(300)
    await page.locator('input[type=checkbox][aria-label="Enabled"]').first().click()
    await page.waitForTimeout(1200)

    const slider = page.locator('input.hmr[aria-label="Azimuth"]')
    const field  = page.locator('input.hmval[aria-label="Azimuth value"]')
    await expect(slider).toHaveAttribute('step', '5')

    await field.fill('37')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(slider).toHaveValue('35')
    await expect(field).toHaveValue('35°')

    // And still clamped to the range.
    await field.fill('999')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(slider).toHaveValue('360')
  })

  test('the panel shortcut survives a click on a section header', async ({ page }) => {
    // Headers became buttons, and the handler skipped BUTTON — which Controls.jsx
    // does because Space activates a focused one. Backslash activates nothing, so
    // the exclusion only killed the shortcut until focus moved.
    await openApp(page)
    const toggle = page.locator('[data-testid="sidebar-toggle"]')
    await openStage(page, 'frame')
    await page.click('[data-testid="section-camera"]')
    await page.waitForTimeout(300)
    await page.keyboard.press('Backslash')
    await page.waitForTimeout(400)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Backslash')
    await page.waitForTimeout(400)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  })

  test('the transparent PNG toast names the file that was written', async ({ page }) => {
    await openApp(page)
    const download = page.waitForEvent('download', { timeout: 60000 })
    await page.keyboard.press('3')
    const written = (await download).suggestedFilename()
    await page.waitForTimeout(700)
    const toast = await page.textContent('[data-testid="toast"]')
    expect(written).toBe('Heightmap-alpha.png')
    expect(toast, 'the message exists to name the file').toContain(written)
  })
  test('a formatted slider announces what the panel prints', async ({ page }) => {
    // aria-label gave a screen reader the name and the raw number, so a control
    // reading "315°" was announced as "315" and one reading "100%" as "1" — the
    // value heard and the value beside it disagreed.
    await openApp(page)
    await openStage(page, 'surface')
    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(300)
    await page.locator('input[type=checkbox][aria-label="Enabled"]').first().click()
    await page.waitForTimeout(1200)

    const slider = page.locator('input.hmr[aria-label="Azimuth"]')
    await expect(slider).toHaveValue('315')
    await expect(slider).toHaveAttribute('aria-valuetext', '315°')

    // And it tracks the value rather than being a one-off at mount.
    await page.locator('input.hmval[aria-label="Azimuth value"]').fill('90')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(slider).toHaveAttribute('aria-valuetext', '90°')
  })

  test('clicking a control’s label focuses the control', async ({ page }) => {
    // Every row used to build a <span> for its label and hand the input an
    // aria-label, so a screen reader was served but the pointer was not:
    // clicking the visible word did nothing, on 10px text.
    await openApp(page)
    await openStage(page, 'surface')
    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(300)
    await page.locator('input[type=checkbox][aria-label="Enabled"]').first().click()
    await page.waitForTimeout(1200)

    const slider = page.locator('input.hmr[aria-label="Azimuth"]')
    const id = await slider.getAttribute('id')
    expect(id, 'the slider must carry an id to be pointed at').toBeTruthy()

    const label = page.locator(`label[for="${id}"]`)
    await expect(label).toHaveText('Azimuth')
    await label.click()
    await expect(slider).toBeFocused()
  })

  test('the help button does not toggle the control it explains', async ({ page }) => {
    // The `?` sits inside the same row as the label. Wrapping the whole row in a
    // <label> would have made every click on it flip the switch beside it, so
    // the association deliberately covers the text and nothing else.
    await openApp(page)
    await openStage(page, 'surface')
    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(300)
    const enabled = page.locator('input[type=checkbox][aria-label="Enabled"]').first()
    await enabled.click()
    await page.waitForTimeout(1200)
    await expect(enabled).toBeChecked()

    // Cast shadows carries both a switch and a help button.
    const help = page.locator('button.hmi[aria-label="What Cast Shadows does"]')
    const shadows = page.locator('input[type=checkbox][aria-label="Cast Shadows"]')
    const before = await shadows.isChecked()
    await help.click()
    await page.waitForTimeout(300)
    expect(await shadows.isChecked(), 'asking what it does must not do it').toBe(before)
  })

  test('a shut section states its own setting, and an open one does not', async ({ page }) => {
    // A closed section used to say its name and nothing else, so a tidy panel
    // was a blind one. The readout is deliberately absent while the section is
    // open: the controls are on screen saying the same thing in full, and a
    // second shorter copy would sit under the cursor on the way to the header.
    await openApp(page)
    await openStage(page, 'surface')
    const header  = page.locator('[data-testid="section-hillshade"]')
    const readout = page.locator('[data-testid="summary-hillshade"]')

    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(readout).toHaveText('—')

    await header.click()
    await page.waitForTimeout(300)
    await expect(readout).toHaveCount(0)
  })

  test('the readout follows the control rather than repeating a default', async ({ page }) => {
    // The point of the header line is that it cannot disagree with the section
    // under it, so it is read off the same state the controls are bound to.
    // A string that survives moving the slider it claims to report is a string
    // that was written down twice.
    await openApp(page)
    await openStage(page, 'surface')
    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(300)
    await page.locator('input[type=checkbox][aria-label="Enabled"]').first().click()
    await page.waitForTimeout(1200)

    const azimuth = page.locator('input.hmr[aria-label="Azimuth"]')
    await azimuth.fill('120')
    await page.waitForTimeout(600)

    await page.click('[data-testid="section-hillshade"]')
    await page.waitForTimeout(400)
    await expect(page.locator('[data-testid="summary-hillshade"]')).toHaveText('120° · 60%')
  })

  test('nothing reads out while filtering, because every survivor is open', async ({ page }) => {
    await openApp(page)
    await expect(page.locator('[data-testid="summary-water-fill"]')).toHaveText('—')

    await page.fill('[data-testid="panel-filter"]', 'flood')
    await page.waitForTimeout(400)
    await expect(page.locator('[data-testid="summary-water-fill"]')).toHaveCount(0)

    await page.fill('[data-testid="panel-filter"]', '')
    await page.waitForTimeout(400)
    await expect(page.locator('[data-testid="summary-water-fill"]')).toHaveText('—')
  })

  test('a section that holds no state stays silent instead of claiming to be off', async ({ page }) => {
    // Export and Analysis are actions, not settings. A dash there would say
    // they were switched off, which is a different thing from having nothing
    // to report.
    await openApp(page)
    await openStage(page, 'output')
    await expect(page.locator('[data-testid="summary-analysis"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="summary-export"]')).toHaveCount(0)

    // Against a section that is shut and does have something to say — silence
    // has to mean "nothing to report", not "readouts are broken". Levels is the
    // control, and it has to be shut first: it opens at defaults now, beside
    // Shape, because a black point means little without its histogram.
    await openStage(page, 'terrain')
    await page.click('[data-testid="section-levels"]')
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="summary-levels"]')).toHaveText('0 – 255')
  })

  test('every export button is in the Export section, and nowhere else', async ({ page }) => {
    // A pinned foot carrying the four file buttons was built and taken out
    // again — see the CHANGELOG. What matters now is that there is one place
    // to write a file and it is the section named after doing so.
    await openApp(page)
    await expect(page.locator('[data-testid="panel-foot"]')).toHaveCount(0)
    for (const id of ['export-svg', 'export-png', 'export-png-alpha', 'export-stl']) {
      await expect(page.locator(`[data-testid="${id}"]`)).toHaveCount(1)
      await expect(page.locator(`[data-section="Export"] [data-testid="${id}"]`)).toHaveCount(1)
    }
  })

  test('Export says what the SVG will contain, and says it once', async ({ page }) => {
    // SVG export cuts at the paper frame rather than hiding what falls outside
    // it, so a switch two stages away in Frame decides what you get.
    await openApp(page)
    await openStage(page, 'output')
    const extent = page.locator('[data-testid="export-extent"]')
    await expect(extent).toHaveText('SVG writes the full canvas')

    // The switch is in Frame and the readout is in Output, which is the whole
    // point of the assertion — and now also two clicks of the rail.
    await openStage(page, 'frame')
    // Paper is shut at defaults: it was the second half of `View`, which opened
    // because its camera half is the one you reach for. A sheet is not.
    await page.click('[data-testid="section-paper"]')
    await page.waitForTimeout(300)
    await page.locator('input[type=checkbox][aria-label="Paper frame"]').click()
    await page.waitForTimeout(600)
    await openStage(page, 'output')
    await expect(extent).toHaveText(/^SVG cuts at the frame/)

    // The segment total is the stats block's, and only the stats block's.
    await expect(extent).not.toContainText('segment')
    await expect(page.locator('#hm-panel-body')).toContainText('Segments:')
  })

  test('a section that can be switched on has a dot when it is', async ({ page }) => {
    // Terrain Style, Texture and Mirror could all be on and none of them said
    // so: a value in the header and no dot to the left of it. The dot is lit by
    // the readout now, so the two cannot disagree.
    // Both scoped to the header, which is the only place either can appear.
    const head = '[data-testid="section-terrain-style"]'
    const readout = page.locator(`${head} [data-testid="summary-terrain-style"]`)
    const lamp = page.locator(`${head} span[style*="border-radius: 50%"]`)
    await openApp(page)
    await openStage(page, 'surface')

    // Terrain Style opens open, and an open section states nothing.
    await page.click(head)
    await page.waitForTimeout(400)
    // Bare defaults: fill and mesh are both off.
    await expect(readout).toHaveText('—')
    await expect(lamp).toHaveCount(0)

    await page.click(head)
    await page.waitForTimeout(300)
    await page.locator('input[type=checkbox][aria-label="Fill"]').first().click()
    await page.waitForTimeout(900)
    await page.click(head)
    await page.waitForTimeout(400)

    await expect(readout).toHaveText('fill')
    await expect(lamp).toHaveCount(1)
  })

  test('the standing line counts the marks that are drawing', async ({ page }) => {
    // Thirty-one draw modes compose freely, and counting the lit ones used to
    // mean scrolling 2 239 px past the thirty that were off.
    await openApp(page)
    const line = page.locator('[data-testid="standing-line"]')
    await expect(line).toHaveText('1 mark, 1 ink')

    await page.fill('[data-testid="panel-filter"]', 'crosshatch')
    await page.waitForTimeout(400)
    // `:visible` because a filtered-out section is hidden rather than
    // unmounted, so every other mode's Enabled switch is still in the DOM.
    await page.locator('input[type=checkbox][aria-label="Enabled"]:visible').first().click()
    await page.waitForTimeout(900)
    await page.fill('[data-testid="panel-filter"]', '')
    await page.waitForTimeout(400)

    // Two marks, still one pen: both draw in the same black.
    await expect(line).toHaveText('2 marks, 1 ink')
  })

  test('the index shows every draw mode, and which are drawing', async ({ page }) => {
    // Thirty-odd sections over 2 239 px, each a header that says a noun. Which
    // ones were drawing was a question you answered by scrolling past the ones
    // that were not.
    await openApp(page)
    await openStage(page, 'marks')
    await expect(page.locator('[data-testid^="mode-tile-"]')).toHaveCount(MODE_COUNT)
    // Every tile carries its full name, because the sheet ellipsises the long
    // ones — an abbreviated label must still be readable somewhere.
    for (const open of await page.locator('[data-testid^="mode-open-"]').all()) {
      expect(await open.getAttribute('title')).toBeTruthy()
    }
    const lines = page.locator('[data-testid="mode-tile-Lines"]')
    await expect(lines).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-testid="mode-tile-Stipple"]')).toHaveAttribute('aria-pressed', 'false')

    // And the header counts them while the index itself is shut.
    await page.click('[data-testid="section-draw-modes"]')
    await page.waitForTimeout(300)
    await expect(page.locator('[data-testid="summary-draw-modes"]')).toHaveText(`1 of ${MODE_COUNT}`)
  })

  test('no section header truncates its own name', async ({ page }) => {
    /*
     * A header is at its tightest when the section is **shut**: that is when its
     * readout appears and takes width out of the title. Three headers were
     * silently clipped before this existed — `Mode: Zero Crossings` by 11 px,
     * `Mode: Shadow Line` by 10, `Mode: Watershed` by 4.
     *
     * ── What the sheet changed ───────────────────────────────────────────────
     * The thirty-four mode headers used to be the tightest thing in the panel,
     * because a lit mode showed a dot *and* a readout beside a long title. They
     * are now behind the sheet, and a mark is only on screen while it is drilled
     * into — which forces it open, so it carries no readout at all. The tight
     * state those three failed in no longer exists for them.
     *
     * That does not retire the check, it moves it. The body is still 272 px, the
     * twenty-six sections outside Marks still shut with readouts, and the marks'
     * names moved to the sheet, where they ellipsise on purpose and must carry
     * their full name somewhere — asserted with the sheet, above.
     *
     * Every pane is walked, because five of the six are hidden at any moment and
     * a hidden header measures zero. The count is asserted first so that this
     * cannot quietly pass by measuring nothing, which is exactly how hiding the
     * mode sections would otherwise have defeated it.
     */
    test.setTimeout(300_000)
    await openApp(page)

    const measure = () => page.evaluate(() => {
      const out = []
      for (const sec of document.querySelectorAll('[data-section]')) {
        // Hidden panes measure zero, which is not the same as fitting.
        if (sec.getBoundingClientRect().height === 0) continue
        const btn = sec.querySelector('button.hmsec')
        if (!btn) continue
        // The innermost span holding the title — the one with overflow:hidden.
        // The outer flex container carries the same text and sizes to content,
        // so measuring that one finds nothing however badly the name is clipped.
        const all = [...btn.querySelectorAll('span')].filter(
          (el) => el.textContent.trim() === sec.dataset.section && !el.querySelector('span'))
        const t = all[all.length - 1]
        if (!t) continue
        out.push({
          name: sec.dataset.section,
          over: Math.round(t.scrollWidth - t.clientWidth),
        })
      }
      return out
    })

    const clipped = []
    let measured = 0
    for (const stage of ['presets', 'terrain', 'surface', 'marks', 'overlay', 'frame', 'output']) {
      await openStage(page, stage)
      // Shut everything, which is the state a readout appears in.
      await page.evaluate(() => {
        for (const b of document.querySelectorAll('[data-testid^="section-"]')) {
          if (b.getAttribute('aria-expanded') === 'true' && b.offsetParent !== null) b.click()
        }
      })
      await page.waitForTimeout(700)
      for (const row of await measure()) {
        measured += 1
        if (row.over > 0) clipped.push(`${row.name} (cut by ${row.over}px)`)
      }
    }

    // Twenty-six sections outside Marks, plus Draw Modes. Anything far below
    // that means the walk stopped finding headers rather than finding them fit.
    expect(measured, 'the walk must actually measure headers').toBeGreaterThanOrEqual(25)
    expect(clipped, `headers clipping their own name: ${clipped.join(', ')}`).toEqual([])

    // The one place a mark's own name is still set in a header: the back bar of
    // a drilled-in mode, which carries the longest title in the panel.
    await openMark(page, 'ZeroCross')
    const back = page.locator('[data-testid="mode-back"]')
    await expect(back).toBeVisible()
    const backOver = await back.evaluate((el) => {
      const t = el.querySelector('span:last-child')
      return Math.round(t.scrollWidth - t.clientWidth)
    })
    expect(backOver, 'the back bar clips the mark it names').toBeLessThanOrEqual(0)
  })

  test('a tile and the section switch are two views of one boolean', async ({ page }) => {
    // Not a layer stack and not a duplicate control: the tile reads and writes
    // the same `enabled<Id>` the section's own Enabled switch does, so there is
    // no second piece of state that can drift out of step with it.
    await openApp(page)
    await openStage(page, 'marks')
    const tile = page.locator('[data-testid="mode-tile-Contours"]')
    await expect(tile).toHaveAttribute('aria-pressed', 'false')

    // The pip, which is the only target on a tile that switches anything.
    await tile.click()
    await page.waitForTimeout(1500)
    await expect(tile).toHaveAttribute('aria-pressed', 'true')
    // Switching one on leaves you on the sheet, so a second and a third are one
    // click each. Its section opens underneath, ready for when you go in.
    await expect(page.locator('[data-testid="mode-sheet"]')).toBeVisible()
    await expect(page.locator('[data-testid="section-mode:-contours"]'))
      .toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('[data-testid="standing-line"]')).toContainText('2 marks')

    // The card is the other target: it opens the mark, alone, with a way back.
    await page.click('[data-testid="mode-open-Contours"]')
    await page.waitForTimeout(400)
    await expect(page.locator('[data-testid="mode-back"]')).toBeVisible()
    await expect(page.locator('[data-testid="mode-sheet"]')).toBeHidden()

    // And the section's own switch agrees, because there is only one switch.
    const enabled = page.locator('[data-testid="section-mode:-contours"] ~ div input[type=checkbox][aria-label="Enabled"]')
    await expect(enabled).toBeChecked()

    // Off from the section, and the tile follows.
    await enabled.click()
    await page.waitForTimeout(1200)
    await expect(tile).toHaveAttribute('aria-pressed', 'false')
  })

  test('the panel is in pipeline order, under six stage rules', async ({ page }) => {
    // The order used to be the order the sections were written: View and Camera
    // between Levels and Terrain Style, Hydraulic Erosion at position 48
    // immediately before Export. Pinned here because the value of the rules is
    // that the order under them is predictable — a stage heading over the wrong
    // sections is worse than no heading.
    await openApp(page)
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('#hm-panel-body [data-testid^="section-"],#hm-panel-body [data-testid^="stage-"]')]
        .map((n) => n.dataset.testid))

    const stages = order.filter((t) => t.startsWith('stage-'))
    expect(stages).toEqual([
      'stage-presets', 'stage-terrain', 'stage-surface', 'stage-marks',
      'stage-overlay', 'stage-frame', 'stage-output',
    ])

    const at = (t) => order.indexOf(t)
    // Presets has a destination of its own, named for the one section it holds.
    // It writes style, particles and view in one act, so it belongs to every
    // pane downstream and to none of them.
    expect(at('section-presets')).toBeGreaterThan(at('stage-presets'))
    expect(at('section-presets')).toBeLessThan(at('stage-terrain'))
    // Source: the two operations that were filed at the far end are in it.
    expect(at('section-hydraulic-erosion')).toBeGreaterThan(at('stage-terrain'))
    expect(at('section-soundscapes')).toBeLessThan(at('stage-surface'))
    // Frame: the camera and the mirror, together, after the thing they frame.
    // `View` split: the camera half joined Camera, the page half became Paper.
    expect(at('section-camera')).toBeGreaterThan(at('stage-frame'))
    expect(at('section-paper')).toBeGreaterThan(at('section-camera'))
    expect(at('section-mirror')).toBeLessThan(at('stage-output'))
    // Satellite is a drape, so it sits in Surface with the other surface tones.
    expect(at('section-satellite')).toBeGreaterThan(at('stage-surface'))
    expect(at('section-satellite')).toBeLessThan(at('stage-marks'))
    expect(at('section-draw-modes')).toBeGreaterThan(at('stage-marks'))
  })

  test('the rail shows one pane, and the filter crosses them all', async ({ page }) => {
    // Six stickies in one scroll container never handed over to each other, and
    // each stage got its own block to fix it. The rail makes that stronger: one
    // pane is on screen, so one rule is, and the other five are hidden rather
    // than unmounted — a click on the rail must not throw away a running fetch
    // or a half-set feature filter.
    await openApp(page)
    const shownStages = () => page.locator('[data-testid^="stage-tab-"] , [data-testid^="stage-"]')
      .evaluateAll((els) => els
        .filter((n) => n.dataset.testid.startsWith('stage-') &&
                       !n.dataset.testid.startsWith('stage-tab') &&
                        n.dataset.testid !== 'stage-rail' &&
                        n.getBoundingClientRect().height > 0)
        .map((n) => n.dataset.testid))

    expect(await shownStages()).toEqual(['stage-terrain'])
    await openStage(page, 'frame')
    expect(await shownStages()).toEqual(['stage-frame'])

    // Hidden, never unmounted: all six rules are still in the tree.
    await expect(page.locator('[data-testid^="stage-"]'))
      .toHaveCount(7 + 7 + 1)   // seven rules, seven tabs, the rail itself

    // A search is flat and crosses every pane, so there are no rules at all
    // while one is typed — a stage heading over none of its own sections is
    // furniture pointing nowhere. The rail becomes a tally instead.
    await page.fill('[data-testid="panel-filter"]', 'azimuth')
    await page.waitForTimeout(400)
    expect(await shownStages()).toEqual([])
    await expect(page.locator('[data-testid="stage-tab-surface"]')).toHaveAttribute('title', /1 match/)
    await expect(page.locator('[data-testid="stage-tab-marks"]')).toHaveAttribute('title', /0 matches/)

    // Clearing the field puts the panel back on the pane it was on.
    await page.fill('[data-testid="panel-filter"]', '')
    await page.waitForTimeout(400)
    expect(await shownStages()).toEqual(['stage-frame'])
  })
})
