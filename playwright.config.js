import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  /*
   * `.spec.js` only, so `tests/unit/*.test.js` stays with Vitest.
   *
   * Playwright's default testMatch takes both extensions, and handing it a file
   * that imports `vitest` fails in a way that reads as a broken spec rather than
   * as the wrong runner. The two suites are separated by extension as well as by
   * directory so neither can pick up the other's files by accident.
   */
  testMatch: /.*\.spec\.js$/,
  timeout: 60_000,
  /**
   * One retry, for the machine rather than for the code.
   *
   * Three runs of this suite have failed on infrastructure in a single sitting,
   * with three different signatures: twice the panel had not rendered inside the
   * budget, once the browser process went away mid-`evaluate` (`Target page,
   * context or browser has been closed`). None reproduced — each passed alone
   * immediately afterwards — and no code change addresses a renderer that dies,
   * which is why this is a retry and not a longer timeout.
   *
   * It does not hide regressions. A real one fails both attempts and the run is
   * red; a retried pass is reported as **flaky**, not as green, so the count is
   * still visible in the summary. If that number climbs, the answer is to look
   * at the machine, not to raise this.
   *
   * Kept after the move to headless even though the run that proved it needed
   * none: the signatures above are a renderer dying and a machine under load,
   * and neither is something a window has anything to do with.
   */
  retries: 1,
  /**
   * Headless, and serial.
   *
   * ── Headless ─────────────────────────────────────────────────────────────
   * This suite ran *headed* for a long time, for two reasons that were true
   * when they were written. Fifteen of its specs read canvas pixels or drive
   * requestAnimationFrame, and Chrome throttles rAF hard — often to a stop — in
   * a window it considers backgrounded or occluded. A headed run whose window
   * drifted behind anything failed four audio specs with one signature: the
   * transport never advanced and the flock heard nothing, while the
   * AudioContext itself was perfectly healthy.
   *
   * That made the suite's greenness depend on which window happened to be in
   * front, and it made a run take the machine hostage — a headed Chrome grabs
   * focus and the pointer, so a thirty-minute suite is thirty minutes of not
   * being able to use the computer.
   *
   * Both are gone with no window at all, and the measurement says so rather
   * than the reasoning: the full suite headless is 327 passed in 30.1 min *with
   * retries disabled*, against 31.2 min headed which needed a retry and still
   * finished red. `the flock hears bands, onsets and silence` — the spec that
   * went flaky twice on the same afternoon headed — passes headless in 719 ms.
   * Nothing to drift behind is a stronger guarantee than three flags asking
   * Chrome not to throttle a window that has.
   *
   * The flags below stay anyway. They cost nothing and they are the reason a
   * `HEADED=1` run is still worth having: watching a spec drive the app is the
   * fastest way to understand a failure, and that run should behave like the
   * headless one rather than like a fourth environment.
   *
   * ── Serial ───────────────────────────────────────────────────────────────
   * Playwright defaults to half the CPU count. Measured on the headed suite,
   * 14 workers cold took 16.3 min (94 tests), 14 workers warm 4.6 min with four
   * failures, and one worker 4.7 min with 99 passing — so parallelism bought
   * about six seconds and cost four false regressions, because workers
   * contending for a single GPU were never buying throughput. The failures read
   * as feature regressions rather than as starvation: the SVG occlusion spec
   * reported 255 105 marks, precisely the *unoccluded* total, its depth buffer
   * empty because the surface geometry had not finished building.
   *
   * Headless removes the compositing half of that contention, so the trade was
   * re-measured rather than assumed to carry over. It does not hold up. Four
   * workers headless run the full suite in 12.5 min against 30.1 serial — a
   * real 2.4× — and finish with two failures that both pass alone: the flock
   * listening to its own track, and the profile's standalone SVG export. Same
   * shape as before, an audio spec and an export spec starved of frames, and
   * the same objection: a suite that reports starvation as a feature
   * regression is worth less than the eighteen minutes it saves.
   *
   * So this stays at one. If it is ever raised, raise it for the specs that do
   * not read pixels or drive rAF and leave the rest serial, rather than for the
   * whole suite — the figures above say which half is which.
   */
  workers: 1,
  use: {
    // `HEADED=1 npx playwright test` to watch it drive the app, which is the
    // fastest way to understand a failure. Everything else about the run is
    // identical, deliberately — see the note above.
    headless: process.env.HEADED !== '1',
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      /*
       * The last three are about *focus*, not the GPU, and they matter only to
       * a `HEADED=1` run now — a headless Chrome has no window to background.
       *
       * Soundscape playback and the flock's audio meter are driven by
       * requestAnimationFrame, and Chrome throttles rAF hard — often to a stop —
       * in a window it considers backgrounded or occluded. A headed run whose
       * window drifts behind anything therefore fails four audio specs with the
       * same signature: the transport never advances, no terrain rebuilds
       * arrive, and the flock hears nothing, while the AudioContext itself is
       * perfectly healthy and its clock is ticking.
       *
       * That made the suite's greenness depend on which window happened to be in
       * front, which is not a property a test suite should have.
       */
      args: [
        '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
