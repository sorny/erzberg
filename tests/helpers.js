import { PANEL_MODES } from '../src/components/panel/sectionSummary.js'

/**
 * Shared test preconditions.
 *
 * The app opens on a style preset, which is what a visitor should meet and what
 * `discovery.spec.js` asserts. Every *other* spec wants a known, neutral
 * baseline — white paper, Lines on, nothing else — and used to get one only
 * because that happened to be what the app opened with. Depending on it was
 * invisible until the opening look changed; declaring it is the fix.
 */

/** Returns the app to bare defaults and clears the toast that offers an undo. */
export async function resetToDefaults(page) {
  // Wait for the opening preset to land first. It is gated on 56 preset files
  // downloading, so resetting before it arrives resets nothing — the preset then
  // applies on top and the baseline is silently the opening look after all.
  await page.waitForSelector('[data-testid="jump-to-presets"]', { timeout: 20000 })
    .catch(() => {})   // a restored session means no opening preset is coming

  /*
   * Wait for the control before pressing it, rather than letting `click()`
   * auto-wait against whatever is left of the test budget.
   *
   * This has twice ended a run with `Test timeout of 60000ms exceeded — waiting
   * for locator('button')…`, in different specs, which reads as though the app
   * failed to render. It is worth knowing what that log did *not* say: there was
   * no `locator resolved to` line and no `attempting click action`. A button
   * covered by the computing overlay produces both of those, so the panel was
   * genuinely not in the DOM yet — the app was still booting, twenty seconds
   * after the preset wait above had already given up on it.
   *
   * Waiting here buys no extra budget; it makes the failure say which precondition
   * was not met instead of blaming the click, and it fails fifteen seconds sooner.
   */
  const reset = page.locator('button', { hasText: /^Reset all$/ })
  await reset.waitFor({ state: 'visible', timeout: 45_000 })
  await reset.click()
  // The toast sits bottom-centre at a high z-index for nine seconds and would
  // swallow clicks aimed at anything under it.
  await page.locator('[data-testid="toast"] button[aria-label="Dismiss"]')
    .click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(900)

  /*
   * The Presets grid used to be collapsed here, and no longer needs to be.
   *
   * Specs reach controls with force-clicks at measured coordinates, and 56
   * tiles added roughly 3 000 px to the panel — enough that a section at y≈1000
   * was at y≈3800 and the click landed on whatever sat at the old spot. So the
   * baseline shut it.
   *
   * The grid has a pane to itself now and shares it with nothing, so it adds no
   * height to any pane a spec works in. Worse than unnecessary: it was actively
   * breaking every spec that called this. Presets opens expanded, so the
   * `aria-expanded` test passed and the click went to a button in a pane nobody
   * had selected — hidden, unclickable, sixty seconds to time out, and it took
   * most of the suite with it.
   */
  await page.locator('#hm-panel-body').evaluate((el) => { el.scrollTop = 0 })
}

/**
 * Brings a stage pane on screen.
 *
 * The panel shows one of six stages at a time, so a section in a pane you have
 * not selected is in the DOM and hidden — `toHaveCount` and `toHaveAttribute`
 * still see it, and `click` does not. Any spec that operates a control outside
 * Source has to say which pane it is in.
 *
 * Named rather than numbered: `openStage(page, 'frame')` survives a stage being
 * inserted in front of it, and the tab's own handle is its name.
 */
export async function openStage(page, name) {
  const tab = page.locator(`[data-testid="stage-tab-${name}"]`)
  await tab.waitFor({ state: 'visible', timeout: 15_000 })
  await tab.click()
  // A stage switch replaces the whole body — Marks alone is 34 tiles — and the
  // rail resets the scroll to the top. Clicking into the new pane before that
  // settles lands on whatever moved under the pointer: the run that found this
  // hit the stats block at the foot of the panel. Wait for the layout, not for
  // a guess at how long it takes.
  await page.locator(`[data-testid="stage-${name}"]`).waitFor({ state: 'visible', timeout: 15_000 })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await page.waitForTimeout(250)
}

/**
 * A mark, however a spec happens to name it.
 *
 * Specs identify a mark three ways and all three are reasonable: by the id the
 * handles carry (`ShadowLine`), by its section slug (`mode:-shadow-line`), or by
 * the tail of that slug (`shadow-line`). The two spellings differ because a
 * mode's id comes from `enabled<Id>` while its slug comes from its title, and
 * `Mode: Stipple Dots` is `Stipple`. Asked of `PANEL_MODES`, which is where both
 * are already written down.
 */
const MARK_ID = new Map(PANEL_MODES.map(([title, key]) => [
  title.toLowerCase().replace(/\s+/g, '-'), key.slice('enabled'.length),
]))
/** The ids themselves — `ZeroCross`, `Stipple` — which callers also pass. */
const MARK_IDS = new Set(PANEL_MODES.map(([, key]) => key.slice('enabled'.length)))
const markId = (mark) => {
  // An id passes through unchanged. Checking the id set rather than returning
  // the name untouched is the whole point: `ZeroCross` is real and `stipple
  // dots` is a typo, and the old fallback could not tell them apart.
  if (MARK_IDS.has(mark)) return mark
  const id = MARK_ID.get(mark) ?? MARK_ID.get(`mode:-${mark}`)
  if (id) return id
  /*
   * An unknown name fails here, not fifteen seconds later.
   *
   * Returning the name unchanged built `mode-tile-stipple dots` — a selector
   * that matches nothing — and the caller waited out its timeout on a locator
   * that could never resolve. The failure said "not visible", which sends you
   * looking at panes and hidden elements rather than at the typo.
   */
  throw new Error(
    `Unknown mark "${mark}". Use a mode id (Stipple), a section slug ` +
    `(mode:-stipple-dots) or its tail (stipple-dots).`)
}

/**
 * Puts a mark into a definite state from the sheet, without going into it.
 *
 * The pip is the switch, and it is one click from the pane — which is what a
 * spec that only wants the mark drawing, or not drawing, should use. Going in
 * and finding the section's own Enabled switch is two more clicks to write the
 * same boolean.
 *
 * A state and not a toggle. The helper this replaced switched a mark *on* and
 * did nothing when it already was, which silently turned a spec that toggled
 * Sun Hours twice into one that left it on — and the rebuild readout it was
 * measuring never came back down.
 */
export async function setMark(page, mark, on = true) {
  await openStage(page, 'marks')
  const pip = page.locator(`[data-testid="mode-tile-${markId(mark)}"]`)
  await pip.waitFor({ state: 'visible', timeout: 15_000 })
  if ((await pip.getAttribute('aria-pressed')) === String(on)) return
  await pip.scrollIntoViewIfNeeded()
  await pip.click()
  await page.waitForTimeout(900)
}

/** `setMark(page, mark, true)`, for the specs that only ever switch one on. */
export const switchMarkOn = (page, mark) => setMark(page, mark, true)

/**
 * Opens one draw mode's section from the sheet.
 *
 * Marks is a sheet of thirty-seven tiles, and a mode's own section is behind the
 * tile's name. This is the two clicks that get to it: the pane, then the mark.
 * `id` is the mode's id — `Contours`, `ZeroCross` — the same one `mode-tile-`
 * and `enabled<Id>` use.
 */
export async function openMark(page, mark) {
  const id = markId(mark)
  await openStage(page, 'marks')
  /*
   * The sheet lives inside the `Draw Modes` section, so a shut one collapses
   * all thirty-seven tiles to a zero-height row. They stay in the tree and stay
   * "visible" to a locator — the row is `0fr` and `overflow:hidden`, not
   * `display:none` — so a click on a tile silently lands on the header above
   * it instead. Open it first.
   */
  /*
   * Come back out of whatever was open before.
   *
   * A drilled-in mark hides the sheet *and* the section that holds it, so a
   * second call to this would wait on a tile inside a hidden sheet until the
   * test timed out. Any spec that opens two marks in one run hits it.
   */
  const back = page.locator('[data-testid="mode-back"]')
  if (await back.count()) {
    await back.click()
    await page.waitForTimeout(300)
  }
  const sheetSection = page.locator('[data-testid="section-draw-modes"]')
  // Asked too early this returns null, which is not 'false', and the sheet then
  // stays shut while the tile it holds is waited on until the test times out.
  await sheetSection.waitFor({ state: 'visible', timeout: 15_000 })
  if ((await sheetSection.getAttribute('aria-expanded')) === 'false') {
    await sheetSection.click()
    await page.waitForTimeout(350)
  }
  const open = page.locator(`[data-testid="mode-open-${id}"]`)
  await open.waitFor({ state: 'visible', timeout: 15_000 })
  // The sheet is twelve rows deep, so a mark near the bottom needs bringing up
  // before it can be clicked at all.
  await open.scrollIntoViewIfNeeded()
  await open.click()
  await page.waitForTimeout(300)
}

/**
 * Waits for the app to have rendered, by its wordmark.
 *
 * Twenty specs used `text=erzberg` for this, which is a bet that the app's own
 * name appears exactly once in the DOM. It does not have to: a line of panel
 * copy naming the app collected the two that used a *strict* locator, and the
 * other forty-one survived only because `waitForSelector` takes the first match
 * and the heading happens to come first.
 *
 * None of them asserts anything about the wordmark — it is a "the app has
 * rendered" sentinel — so the heading is what they all actually mean.
 */
export async function waitForApp(page, timeout = 30_000) {
  await page.getByRole('heading', { name: 'erzberg' }).waitFor({ state: 'visible', timeout })
}
