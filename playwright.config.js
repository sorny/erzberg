import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  /**
   * One worker, deliberately — and it is not a tax.
   *
   * Playwright defaults to half the CPU count, which on a 28-core machine is 14
   * *headed* Chrome windows, each holding a real WebGL context and, for the audio
   * specs, an AudioContext, all against one GPU. Only one window can be in the
   * foreground; Chrome throttles requestAnimationFrame in the other thirteen and
   * can stop compositing them altogether. 15 of the 18 specs read canvas pixels,
   * drive rAF, or wait seconds for state to settle, so there is no small subset to
   * isolate — this suite exists to look at what the renderer drew.
   *
   * What that cost: a warm parallel run failed four tests, and the failures read as
   * feature regressions rather than as starvation. The SVG occlusion spec reported
   * 255 105 marks — precisely the *unoccluded* total, its depth buffer empty
   * because the surface geometry had not finished building. The murmuration beat
   * spec reported a reaction of 0.0 with a noise floor of 0.0, which is not a flock
   * ignoring the music but a canvas that never redrew. Both pass alone.
   *
   * Measured, so the trade is known rather than assumed: 14 workers cold 16.3 min
   * (94 tests), 14 workers warm 4.6 min with 4 failures, one worker 4.7 min with
   * 99 passing. Serial costs about six seconds against the fastest parallel run,
   * because workers contending for a single GPU were never buying throughput.
   *
   * Note the cold/warm gap before raising this again: a cold Vite server staggers
   * test starts and hides the contention, so a green parallel run is evidence about
   * the compile cache, not about concurrency being safe.
   */
  /*
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
   */
  retries: 1,
  workers: 1,
  use: {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      /*
       * The last three are about *focus*, not the GPU.
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
