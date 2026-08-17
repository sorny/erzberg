# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.19] - 2026-08-17

No new features. This one went looking for what was already wrong, and the honest
summary is that the bugs were not where a reading would have found them.

Sixteen and a half thousand lines of React had never been checked by a linter. The
`// eslint-disable-line` sitting in App.jsx was the tell: it suppressed a rule that
had never once run, which makes it decoration rather than a decision. What a linter
finds in a codebase this careful is not sloppiness — it is the residue of refactors
that landed correctly and left something behind.

Then a file-by-file sweep of the five densest modules. What it turned up were seven
faults sharing one shape: a quantity that is *correct in the ordinary case and
wrong in the exceptional one*, so no fixture could see it. `halfW` is a centring
offset that equals the half-extent on any full grid, and only an off-centre crop
tells them apart. Two longitudes subtract to an angular separation everywhere
except across the dateline. `+null` is 0, which is a real place. A frame is inside
the canvas until someone nudges it out. Each was invisible precisely where it was
tested, which is the argument for sweeping rather than waiting for a bug report.

Two of the four things that looked like regressions along the way were the test
harness starving itself, and one of those had been reporting a frozen canvas as a
feature failure. Both now say what they mean.

### Added
- **ESLint, correctness rules only** (`eslint.config.js`, `npm run lint`). Four
  blocks for the four environments already in the tree: browser for `src`, worker
  globals for `*.worker.js`, Node for the build and tooling, and Node *plus*
  browser for specs and scripts — the bodies of `page.evaluate()` run in the page,
  and pretending otherwise was 44 of the first run's reports.
- No stylistic rules, and none are coming. The house style is settled and a
  formatter would produce a 16.5k-line diff that buries the findings this exists
  to surface.
- The worker block is self-contained rather than an override, because flat config
  *merges* `languageOptions.globals` across every block a file matches: listing
  workers under `src/**` as well left `document` and `window` defined inside them,
  which is the one thing that block exists to forbid. Excluding the workers from
  the app block makes reaching for the DOM in a worker the lint error it should be
  — verified both ways with a throwaway worker.

### Fixed
- **Two mirror handlers that no button had called since `38c3ee8`.** ~45 lines
  implementing a destructive "double the heightmap" transform, orphaned when that
  commit replaced the image-data buttons with the live 3D symmetry arrows. The
  feature was not lost, it was superseded; removing them also orphaned two store
  selectors, which the linter then found in turn.
- Dead bindings elsewhere: an unused `gridMask` in the STL exporter (left over
  from before the NoData sentinel replaced it), two elevation-unit converters and
  the `elevRange` feeding only them, `innerH` in the profile chart, `size` in
  Scene, `devices` in the Playwright config, and a `React` import that the
  automatic JSX runtime made unnecessary.
- A dead store in the flow-field builder: `b0` was written on every step of every
  path walk and read only once, before the loop.
- `uvToWorld` was exported from ProfileOverlay and imported by nobody.
- The popup chart's `PAD` was a fresh object on every render, so the chart
  `useMemo` could not honestly depend on it. Hoisted to module scope beside the
  print sizes it is the counterpart to.
- Both empty `catch` blocks say why they are empty now, rather than reading as
  something forgotten.
- **A murmuration spec that blamed the flock for what the renderer did.** "The
  beat is visible in the flock" failed once in a full-suite run reporting
  `reacting 0.0 (floor 0.0)` while passing alone at its usual ~230. Zero at *every*
  probed frequency is the signature of a flat sample, not of a flock ignoring the
  music: the amplitude is measured on the pixel series minus its mean, so a
  canvas that never changes reads as zero everywhere. Under `frameloop="demand"`
  an occluded window is exactly that — the scene stops redrawing while
  `preserveDrawingBuffer` keeps handing `drawImage` the last frame. The capture
  now reports how many frames it sampled and how many were distinct (421 and
  ~340 in a healthy run) and asserts both before the beat ratios are believed, so
  a throttled window says so instead of accusing the feature.

- **A UTM zone that meets the dateline projected to nonsense.** `wgs84ToUtm`
  subtracted its central meridian from the point's longitude and fed the result
  straight into the Transverse Mercator series. Those are two longitudes, and
  their difference is not yet an angular separation: zone 1's central meridian is
  −177°, so a point at +179° — 4° to its *west* — came out as +356°. The series is
  a small-angle expansion, and A⁵ of 6.2 radians is not small; the easting was
  −9.7e8, which put the point outside any raster and got it dropped as ordinary
  out-of-bounds clipping. Silent point loss is the exact failure the null returns
  in this file exist to prevent. `dlam` is now wrapped into ±180°, which is a
  no-op for every zone that does not touch the antimeridian — the mid-zone control
  is bit-identical either way, and the fixed result matches the same point written
  as −181°, where the question never arises.
- **The GPX parser invented a point at (0, 0) from a `<trkpt>` with no
  coordinates.** `getAttribute` returns null for a missing attribute, `+null` is 0,
  and the `isNaN` guard passed it — so a malformed point became the Gulf of Guinea
  rather than being dropped. It counted in the coverage report's `total` and never
  in `inside`, which is how a track that landed perfectly well reported back as
  'partial' with a warning about a raster that was fine. The coverage tests use
  (0, 0) as their own example of a track in the wrong place, so a fabricated point
  was indistinguishable from a real one.
- A GPX elevation of exactly 0 m read as "no elevation recorded", because the
  parser ended in `|| null`. Sea level is data, and a coastal track starts there.
  Nothing consumes `ele` yet, which is the reason to fix it now rather than after
  something does.
- **The flock sized itself from a midpoint, not an extent, and flew off any
  off-centre crop.** `buildTerrain` returns `halfW = (minC + maxC)·scl / 2`, which
  is where the valid cells' *centre* sits — world X of cell c is `c·scl − halfW`,
  and every other consumer uses it that way. `makeTerrainField` read it as a size.
  For a full grid the two are the same number, since `minC + maxC` and
  `maxC − minC` both come to `cols − 1`, so nothing caught it; a lasso crop of
  columns 800…1000 of 1024 makes the offset 900·scl against a terrain 200·scl
  wide. Every horizontal radius in the simulation is a fraction of that span, and
  `BOUND_SOFT` — whose own comment reads "×the terrain half-extent" — placed the
  containment wall ten times too far out. Measured on a 20×20-cell crop: 32% of
  birds over data before, 96% after. `buildTerrain` now also returns the real
  half-extents as `spanHalfW`/`spanHalfH`, and the offsets are documented as
  offsets so the two cannot be confused again.
- **A new flock track reacted to the previous track's audio.** `loadFile` swapped
  the `<audio>` source and started a fresh analysis without clearing the old
  spectrogram, so for the length of that analysis the flock danced to the last
  track sampled at the new one's playhead — and if the spectrogram worker failed,
  it never stopped, while `source()` reported `'own'` throughout.
- Loading a track over a playing one left the transport showing it as playing:
  `loadFile` paused the element without saying so, and there is no `'pause'`
  listener, only `'ended'`. The first click of the play button then paused
  something already paused, so starting the track you had just loaded took two
  clicks. `release()` had always paired the two; `loadFile` was the outlier.
- **A frame nudged off the canvas exported hidden-line results computed from
  garbage.** With framing on, geometry was culled against the paper rather than
  against the paper ∩ the canvas, and Offset X/Y reach ±50% at Scale 100%. The
  depth sampler clamps its lookup into the buffer, so out there it returned the
  *edge* column's depth — strokes were kept or hidden according to terrain
  somewhere else entirely, with a seam at the boundary. The crop is now
  intersected with the canvas, so overhang is blank paper. The `frame` itself is
  deliberately *not* trimmed: it is the viewBox, and a page that quietly stops
  being the shape you chose would be the worse bug.
- The SVG's `width`/`height` were rounded to whole pixels against a one-decimal
  `viewBox`, which non-uniformly scales the sheet. An ISO 1500 × 1060.66 frame
  emitted `height="1061"` and came out at 1:1.4147 rather than 1:1.41421 — a
  rounding `frame.js` avoids on purpose by storing ratios exactly instead of as
  millimetres.
- `addSeg`, the funnel every segment of every draw mode passes through, allocated
  a rect and recomputed a length it already had on the framing-*off* path, which
  is the default. Verified unchanged by output rather than by inspection: the same
  fixture still exports 33636 and 27178 marks.
- **The suite ran itself 14 ways parallel and starved its own tests.** Playwright
  defaults to half the CPU count, so on a 28-core machine the suite opened 14
  *headed* Chrome windows, each with a real WebGL context and — for the audio specs
  — an AudioContext, against one GPU. Only one window can hold the foreground;
  Chrome throttles `requestAnimationFrame` in the rest and can stop compositing
  them. A warm run failed four tests, and none of them read as starvation: the SVG
  occlusion spec reported 255 105 marks, which is exactly the *unoccluded* total
  because its depth buffer was empty, and the beat spec reported a reaction of 0.0
  against a noise floor of 0.0, which is a canvas that never redrew rather than a
  flock ignoring the music. Two of the four were in behaviour no change here
  touches, which is what identified the harness as the cause.
  `workers: 1` now, and the trade is measured rather than assumed: 14 cold was
  16.3 min, 14 warm was 4.6 min with four failures, one worker is 4.7 min with 99
  passing. Serial costs about six seconds, because workers queueing for a single
  GPU were never buying throughput. The cold/warm gap is the trap — a cold Vite
  server staggers test starts and hides the contention, so the long-standing green
  parallel baseline was evidence about the compile cache, not about concurrency.

### Security
- **`nanoid` 3.3.17 → 3.3.18**, clearing the one advisory `npm audit` reported
  (GHSA-2v37-7h3g-55p8: a custom generator can loop indefinitely at size zero).
  It arrives as a transitive dependency of `postcss`, which allows `^3.3.16`, so
  the fix is a lockfile bump inside the existing range — `postcss` itself stays at
  8.5.25 and `package.json` is untouched. Build-time only: nothing here reaches the
  browser, and the app never calls nanoid with a custom generator. `npm audit` now
  reports 0 vulnerabilities.
- Confirmed inert rather than assumed: Vite content-hashes its assets, and a clean
  rebuild emitted the same `index-BtBz-PVY.css` and `index-pB-hHpda.js` as before
  the bump, so the shipped bundles are byte-identical.

### Notes
- The dateline, GPX-parser and off-centre-crop fixes carry regression tests, and
  each was checked against the unfixed code first — a test that passes either way
  is not a test. Where possible the assertion is an identity rather than a copied
  constant: +179° and −181° name the same meridian, so they must project alike.
- Fixture blind spot worth knowing about: every murmuration fixture built its
  terrain on a full grid, where `halfW` coincides with the half-extent. The new
  test uses an off-centre valid region, which is the only shape that can tell the
  two apart.
- `eslint-plugin-react-hooks` v7 ships the React Compiler ruleset — 16 rules, not
  the 2 this needed. Three of them (`immutability`, `refs`, `set-state-in-effect`)
  are structurally incompatible with react-three-fiber: driving three.js *is*
  mutating material uniforms in an effect, and the audio and worker hooks keep
  latest-value handles in refs read during render. Measured on this tree those
  three produce 47 findings and every one describes working code, so the config
  takes `rules-of-hooks` and `exhaustive-deps` and leaves the rest. The reasoning
  is written into `eslint.config.js` so the next person does not re-derive it.
- The 16 remaining `exhaustive-deps` sites are suppressed individually, each with
  its reason, because in this architecture a narrow dependency list is usually the
  design: a material is built once by a `useMemo` and kept live by a companion
  effect, so depending on the values it seeds would recompile a shader on every
  slider tick. Nothing was auto-fixed. ESLint 10 reports unused disable
  directives by default, so a suppression that stops being true will say so.
- `HeightmapLines`' `resolution` memo is the case that proves the point: ESLint
  calls `size.width/height` unnecessary, but they are the change-signal for an
  imperative `gl.getSize()` read. "Fixing" it would have frozen every line's
  thickness at its mount value.
- **The geometry rebuild contract was audited and is complete.** The 165-entry
  dependency list in `useTerrainGeometry` was diffed against every `p.*` the
  worker actually reads. The 21 apparent gaps are all accounted for: the
  weight/opacity/dash families are resolved render-side by `layerStyle`, and the
  fill switches reach the effect through the precomputed `p.needsSurfaceShading`.
  No knob is silently inert.

### Known, not fixed
Three findings from the same sweep are left as they are, because each is a
decision about how the tool should behave rather than a defect with one right
answer:
- **The beat reaction scales with frame rate.** `heard.burst` is a windowed
  continuous value, not an edge-triggered pulse, so `applyBurst` fires on every
  frame an onset stays above threshold and adds to velocity without a `dt` term.
  A 144 Hz display therefore delivers roughly 2.4× the impulse of a 60 Hz one for
  the same music. Either scaling by `dt` or triggering on the rising edge fixes
  it, and the two feel different — the impulse timing here was tuned across five
  releases, so which one is wanted is a taste call, not a bug fix.
- **Weave's Bands control fights itself when Source is Onset.** Every sub-row gets
  the same scalar `flux[frame]`, yet `bands` still divides the row budget
  (`maxUnits = 512 / bands`), so raising it quarters the lap resolution to
  produce duplicate rows; `bandLo`/`bandHi` are inert on that path too. Whether
  Bands should be disabled there or mean something else is a design question.
- **`detectBpm` scores long lags on very little evidence.** `acc /= flux.length - lag`
  normalises by a support that shrinks toward a single sample, so a clip just over
  the length guard gets a tempo set by `maxLag` rather than by its content. A
  minimum-support floor is the obvious fix; what it should be depends on the
  shortest clip worth reporting a tempo for.

## [0.9.18] - 2026-08-17

The elevation profile answered a question without saying what it was asked
about: two clicks went into the terrain, a chart came out, and nothing in the
scene said which two points it described. Orbit once and the section was
anonymous — a curve you had to take on trust, sitting over a landscape it no
longer pointed at.

### Added
- **The section is drawn on the terrain.** A pin at each end — green for A, red
  for B — and the line between them draped over the surface at the same 200
  samples the chart is built from, so it follows the ground instead of chording
  through it. The pins appear as they are placed: A stands on the terrain while
  you are still hunting for B.
- The line is drawn twice, a white halo under a blue core. The plate background
  is the user's to choose and neither colour survives it alone: on paper the
  halo disappears and the core carries, on an inked plate the halo is what makes
  the core visible. Blue is the chart's own line colour, and the popup's A and B
  labels now carry the pin colours, which is what ties the two together.
- Anchors live as long as the chart does, not as long as the picking mode —
  leaving profile mode is not the same as being done with the result. Closing the
  popup clears both.
- **The profile exports as a standalone SVG**, named after the source like every
  other export (`graz-profile.svg`). Ink on paper rather than the popup's dark
  card: the file exists to sit beside a plotted plate or inside a document, and
  both of those are white. It carries its own background rect so it does not
  composite onto whatever is behind it, plus the axis, the elevation range, the
  sample count and both ends labelled in the pin colours.
- Screen and file are drawn from one `chartGeometry()`, parameterised by size.
  Two copies of that arithmetic would be two charts that disagreed about where
  the line goes.

### Fixed
- Viewport aids stay out of exports. The section is scene geometry, so unlike
  the DOM frame overlay it *would* have been captured by the PNG pass, which
  renders the scene itself — it now carries `userData.viewportOnly` and that
  pass hides it, and it is suppressed during WebM recording as the frame overlay
  already was. SVG and STL never saw it: they read worker geometry.

### Notes
- `material-depthTest` cannot be pierced onto drei's `<Line>`: it builds the
  Line2's material itself, so at the moment R3F applies pierced props there is
  nothing to pierce and the whole Canvas throws. The overlay sets depth state
  through a ref instead.
- The overlay's lines are transparent even at full opacity. Three renders the
  opaque queue before the transparent one, so an opaque core is painted over by
  its own translucent halo whatever the render order says.
- Markers are sized against the terrain's footprint, not its relief: relief is a
  couple of units on a flat spectrogram and a hundred on an alpine plate, and a
  pin scaled to it is either a single pixel or a mast.

## [0.9.17] - 2026-08-14

The tool's main use is plotting, and an SVG export came out as whatever happened
to be on screen: the page was the content's own bounding box, so its shape was
an accident of where the geometry landed, and marks straddling the canvas edge
were written whole — the file already carried strokes outside its own viewBox,
which then had to be deleted by hand in Inkscape.

### Added
- **Paper framing.** A frame overlay showing where a sheet falls over the scene,
  with Scale, Offset X/Y and an inner Margin, and an SVG export that contains
  only what lands inside it. The page becomes the shape you composed for rather
  than the one the geometry happened to occupy.
- The picker lists **shapes, not sheet names**, grouped ISO / US / Ratio: ISO
  A (which is also B and C), US Letter, Legal and Tabloid, square, 4:3, 3:2,
  golden, 16:9, and a custom ratio. Naming A3, A4 and A5 separately — as the
  first cut did — gave three entries that drew an identical frame, because the
  whole point of the ISO series is that halving the long side reproduces the
  1:√2 shape. Since the export carries pixel dimensions rather than millimetres,
  the ratio is genuinely all there is to choose, so each entry shows it. Old
  `a3`/`a4`/`a5` ids in saved presets still resolve to that shape.
- Ratios are stored exactly rather than derived from rounded sheet dimensions:
  ISO is 1:√2 by definition and 297 × 420 mm is itself a rounding of it, so
  going via the millimetres baked in an error of 1e-4 — and rounded to three
  places it made US Letter read 1:1.292 instead of its true 1:1.294.
- **Cut at the boundary, not hidden behind it.** Lines are split at the page
  edge by a Liang–Barsky clip in `addSeg`, the single funnel every segment from
  all fourteen draw modes and the GPX track passes through; dots, particles and
  flock shadows are kept or dropped by their centre, since a pen cannot
  half-draw a dot. Verified by the test: 319 274 coordinates in a framed export,
  none outside the page.
- Dash phase survives the crop. Phase accumulates along a chain of segments, so
  a clipped stroke carries `tHead × length` added to its offset — without that
  the pattern restarts at the paper edge and stutters all along the frame.
- The overlay is DOM (`position: fixed`, `pointerEvents: none`, z-index 500,
  following `CenterGuides`), so it cannot reach either exporter, and it hides
  during WebM recording as the gizmo does. It works in CSS pixels while the
  exporter works in buffer pixels; both go through one `frameRect` that never
  sees a device pixel, which is what keeps them agreeing across DPR and
  supersampling changes.

Framing is off by default and PNG and STL are untouched, so every existing
export path is unchanged.

## [0.9.16] - 2026-08-14

### Fixed
- **Particles are no longer far bigger in an SVG export than on screen.**
  `gl_PointSize` is silently clamped to `ALIASED_POINT_SIZE_RANGE` — 511 on one
  machine here, as little as 63 on others — while the exporter projected the
  unclamped size. Both compute `size · 300 / −z`, so they agreed until that
  product passed the ceiling and then diverged by however far past it the maths
  went: at a close zoom with a large Size the viewport showed a sprite pinned at
  the ceiling and the SVG showed one many times bigger. Measured at a 400% zoom
  with Size 250: 579 px exported against a 511 px ceiling, and proportionally
  far worse on hardware that stops at 63. The exporter now inherits the limit,
  and the median sprite is untouched, so only the ones that were wrong change.
- Applies to the hologram field, the flock and its shadows alike — all three are
  point sprites and all three were clamped on screen but not on paper.

## [0.9.15] - 2026-08-13

### Added
- **A transport for the flock's track.** Play, restart, ±5 s, a scrub bar, a
  loop toggle and a time readout — getting back to the beginning previously
  meant loading the file again. Skipping wraps rather than clamping, so stepping
  back from the first second of a looping track lands near its end.
- Scrubbing seeks on `input` rather than on release, so the flock reacts while
  you drag, which is how you find the bar you are looking for. Nothing
  downstream needs resynchronising: the features are a function of time taken
  from the precomputed spectrogram, not of a running stream, so the next frame
  simply reads a different column.
- The playhead is read in an animation frame and written straight to the DOM —
  the range input's value and one text node. A scrubber backed by React state
  would re-render the whole sidebar several times a second, which for a panel
  this size is the most expensive thing on the page.

## [0.9.14] - 2026-08-13

### Added
- **A range per audio channel**, under its amount: the slice of that signal's
  0…1 which is stretched across the whole response. An amount slider could not
  do this job — the band envelopes are auto-gained against the track's own
  recent peak, so a track that is loud from end to end sits pinned near the top
  and barely moves, and scaling something that is not varying only scales a
  constant. On a synthetic envelope oscillating between 0.86 and 0.94:
  unwindowed it swings 0.08 of its available range; windowed to that slice it
  swings the full 1.0.
- Each channel windows separately, because each is after something different in
  the same track. Burst ships windowed at 0.15–0.90, since raw onset values sit
  low and dense music produces a wall of small ones that disperses the flock;
  Pulse and Size both read bass but are usually wanted at different thresholds.
- The meter draws each window as a bracket behind its band's envelope cap, so
  setting one is a matter of seeing where the track sits and putting the window
  around it rather than guessing.
### Fixed
- **A rolled seed now describes the particle field completely.** `randomPreset`
  seeded `style` from `STYLE_DEF` but `points` from a bare `{ showPoints: false }`,
  and `applyPreset` merges over the previous state — so any particle key a roll
  did not happen to set survived from the roll before it. Stepping back through
  the roll history restored a seed and its style but kept the *later* roll's
  particle colour, which makes the seed not quite the look. Latent since the
  randomiser shipped and rare while that block set three keys; considerably less
  rare since 0.9.9 put a dozen in it.

### Added
- `RangeSl`, a two-handle range control for the panel. Built from two stacked
  native inputs with inert tracks and live thumbs, which keeps keyboard control
  and the native feel a hand-rolled widget would lose. The handles cannot cross.

## [0.9.13] - 2026-08-13

### Added
- **A live meter for the audio reaction.** The spectrum at the playhead with the
  three bands tinted behind it and each band's envelope drawn as a cap, over one
  bar per channel showing its current contribution. The envelope caps are the
  useful half: they are smoothed and auto-gained, so they sit nowhere near the
  raw spectrum, and seeing both is how you tell a kick landing in the bass band
  from one smearing into the mid. The channel bars make the sliders tunable by
  eye — raise Pulse and watch its bar answer every kick, rather than raising it
  and squinting at the flock.
- The bars are derived by running the real `applyAudio` and `audioVisuals` over
  neutral parameters and reading the result, not by restating their formulas in
  the drawing code: a meter that drifts from what it meters is worse than none.
- It draws in one `requestAnimationFrame` loop on a canvas and never re-renders
  React, and an `IntersectionObserver` stops that loop when the section is
  collapsed or scrolled out of view — a collapsed `Section` still renders its
  children, so it would otherwise sample and repaint for a widget nobody sees.

## [0.9.12] - 2026-08-13

### Fixed
- **The flock's reaction to music was both faint and late.** Every mapping went
  through a steering *force*, and a force changes velocity at `acc·dt` bounded
  by the turn-rate limit before it changes position — so the integrator low-pass
  filtered the beat into a vague swell a few hundred milliseconds after it. Two
  new channels bypass it entirely: **Size** is a shader uniform, so sprites
  swell and streaks lengthen on the exact frame the beat lands; **Burst** writes
  velocity directly, throwing the flock outward from its own centre the instant
  an onset arrives, and it re-forms on its own because no flocking rule was
  touched. Envelope attack is down from 35 ms to 10 ms.
- **Startle did nothing in the default configuration.** It acted only by
  widening the predator's fear radius, and the predator is off by default — so
  the most percussive control in the panel was a no-op unless you had found an
  unrelated toggle. Onsets now always drive Burst; Startle is the extra on top
  when a hawk is present.
- Onsets fire on the *rise* of the flux envelope rather than its level, so one
  attack is one trigger instead of a sustain for as long as the transient decays.
- **Sync** reads the spectrogram slightly ahead of the playhead (40 ms by
  default) to cancel the lag the force channels still carry. Lookahead is
  possible only because the whole track is analysed before it plays.

Measured against the test fixture, which bursts once a second: the flock's
on-screen footprint now carries a 1 Hz component of amplitude 358 against a
neighbouring-frequency floor of 41, where the silent flock manages 61 against
34. The beat is a line in the flock's motion rather than a wobble — and there is
a test asserting exactly that, since "is it visible" is otherwise a matter of
opinion.

## [0.9.11] - 2026-08-13

### Fixed
- **Making the flock react to audio no longer replaces your terrain.** 0.9.10
  wired the Particles panel's track loader to `useSoundscape`, and that hook's
  entire purpose is to *become* the landscape — it pushes every analysed frame
  into the heightmap store. So asking the birds to fly to a track silently threw
  away the raster you were working on and put a spectrogram there instead, which
  is not what anyone means by "react to audio". The flock now has its own audio
  (`useFlockAudio`): it decodes, analyses and plays, and touches no store at all.
  A loaded Soundscape is still used as a fallback, so the same file never has to
  be uploaded twice, and the panel says which source it is listening to.
- The flock's own analysis runs at 128 bins rather than the 512 a terrain needs —
  three bands and a flux figure cannot use that resolution, and it analyses in a
  fraction of the time.
- Its track loops by default: a backdrop the flock reacts to should not silently
  stop reacting partway through a session.

## [0.9.10] - 2026-08-13

The flock could be steered by the landscape but not by anything happening in
time. Soundscapes already decodes a track into a full spectrogram and plays it;
this points the murmuration at the same analysis.

### Added
- **The murmuration reacts to live playback.** Load a Soundscape — from the
  Particles panel now, as well as its own section — and the flock flies to it:
  bass opens it out on the kick, highs make it restless through the busy parts,
  overall loudness sets the pace, and onsets widen the hawk's fear radius so an
  accented beat tears the same hole through the flock that a strike does. Four
  amounts plus a master Drive. → [Murmurations](docs/Murmurations.md#listening-to-a-track)
- It reads the *precomputed spectrogram at the playhead*, not an `AnalyserNode`.
  There is no second FFT and no Web Audio graph, which buys three things: the
  flock and the terrain are two readings of one analysis at one instant and
  cannot drift apart; scrubbing works, because the features are a function of
  time rather than of a running stream; and it costs a few hundred array reads
  per frame. The trade is that this is what the file contains, not what the
  speakers emit — the volume slider does not reach it.
- Loudness is auto-gained against a running peak that halves every four seconds,
  so a quiet track still moves the flock and a loud one does not pin every
  slider. Onsets come from spectral flux measured against the last analysis
  frame actually read — the analysis runs at ~86 fps and the renderer at 60, and
  comparing against the last *render* reports zero on the frames where the
  playhead has not reached a new column, which chops every onset into a flicker.
- Audio is a parameter transform on the way into the simulation rather than a
  new set of forces, so `murmuration.js` never learns audio exists and every
  mapping is something that could have been dialled by hand.

## [0.9.9] - 2026-08-13

The Particles section could draw one thing, and that thing did not move —
"animated" meant a noise field displacing each particle around a home cell it
never left. This adds a second field that actually goes somewhere, and fixes
three things found while building it: the draw modes were painting over the
particle field entirely, a mouse pan was writing unrepresentable floats into
integer sliders, and the flock ran at half the speed it needed to.

### Added
- **Murmurations.** A boids flock over the terrain, selected by a new `Field`
  switch in the Particles section. Separation, alignment and cohesion make it a
  flock; four more forces make it a flock *over this landscape*: it holds a
  clearance above the ground (sampled through the NoData-safe bilinear tap, so a
  lasso crop does not pull it into a floor that is not there), orbits a roost
  above the highest cell, rides updraft on steep ground and sinks over the flats
  — reading the slope field `buildTerrain` already produces — and stays inside a
  flight envelope around the roost height. An optional predator pursues the
  flock and tears the waves and holes through it that a smooth boids blob never
  produces on its own. Drawn as points with velocity streaks, up to 100 000 of
  them at 60 fps. → [Murmurations](docs/Murmurations.md)
- Birds fly with their eight nearest neighbours rather than with everything
  inside the perception radius — the topological rule
  [Ballerini et al. (PNAS 2008)](https://www.pnas.org/doi/10.1073/pnas.0711437105)
  measured in real starlings, and the reason a murmuration stays cohesive as it
  compresses and a predator's strike travels through it as a wave. It is also
  what keeps the cost linear in population.
- **The flock exports.** Its positions live on the CPU, so `getPositions()`
  hands the exporter the live flock rather than a snapshot at rest — pause it
  and the SVG is the frame on screen. Birds become `<circle>`
  elements, depth-tested against the same software Z-buffer as the line layers;
  streaks get their own Inkscape layer, `layer-flock`, since a plotter run is
  sorted by layer. PNG and WebM needed no changes. STL still carries no
  particles of any kind.
- Every murmuration control carries a `?` explaining what it does and what
  happens at the ends of its range, and `ColorRow` learned the same `help`
  affordance the other panel primitives already had.
- Rolling a preset can now produce a murmuration. The draw is appended after
  every existing one so the RNG ordering — and therefore every previously rolled
  seed's *style* — is unchanged.
- **The flock casts shadows.** Each bird drops a soft dark disc onto the
  terrain, grown and faded by how high it is flying — which is the whole depth
  cue, and the difference between a flock that reads as airborne and one pasted
  onto the landscape. Not a shadow map: this scene has no lights at all, so the
  shadow is solved analytically, walking from the bird along the sun ray until
  it meets the ground in exactly two terrain taps. The direction is the
  *hillshade* sun, so the flock is lit the way the ground under it is and the
  shadows swing when the azimuth moves. Strength, size, growth-with-altitude and
  colour are all configurable, and the shadows export to SVG as their own
  `layer-flock-shadow` plotter layer. A shadow is drawn only where there is
  ground to receive it: the flock's own height sampler clamps to the grid edge
  (right for a bird, which should not fall off the world), so shadows needed a
  stricter one that reports no-ground outside the raster and inside any hole cut
  from it — otherwise a low sun hung them in mid-air beside the terrain and
  across lasso'd-out gaps. They cost about a third on top of the
  simulation — free at the default 2 000 birds, and the reason the 100 000
  ceiling is a 60 fps flock without them and an 18 fps one with.
- **A Pause button, and `Space`.** Freezing the flock — to study a shape, or to
  export the frame you are looking at — was buried in an `Animate` switch among
  fifteen others. It is now a transport button at the top of the block, and
  `Space` does it from the keyboard. The steering controls no longer fold away
  while paused, since a pause you cannot adjust anything during is a worse pause.
  `setParams` gained a `points` branch, without which the hotkey had nowhere to
  write.
- **Particles have an opacity.** The sprite's alpha was hard-coded in the
  fragment shader — a fixed core-plus-halo falloff with nothing to turn, so the
  only way to make a field fainter was to make it smaller. `Opacity` scales the
  whole falloff, core and halo together, so particles thin out instead of
  hard-edging, and it reaches the murmuration's streaks and the SVG export's
  fill opacity as well. Both fields get it.
- **Pan Z.** The camera panned across the ground plane but never off it. The
  orbit target's height is now a slider alongside Pan X and Y. This also fixes a
  latent bug: OrbitControls pans in *screen space*, so a mouse drag was already
  moving the target vertically — and the state sync threw that away on the next
  tick, snapping the view back to ground level mid-gesture.

### Performance
- **The flock runs 2.2× faster**, which is what makes 100 000 birds a 60 fps
  field rather than a 30 fps one. Two findings, both from profiling. `Math.hypot`
  was **27% of the entire step**: it guards against intermediate overflow that
  cannot arise for three coordinates of a bird, and there were about ten per bird
  per substep. And Reynolds' per-force clamp *provably never fired* — the
  steering delta cannot exceed 2.35·cruise while `maxForce` is 2.5·cruise — so
  removing it was bit-identical output for another 12%.
- Neighbour cells are scanned nearest-first, which is the difference between
  linear and quadratic scaling: a flock occupies a fixed volume however many
  birds are in it, so the naive −1…+1 order walked twenty low-yield corner and
  edge cells before reaching the bird's own. At 50 000 that was ~2 000 rejected
  candidates before the neighbour cap could fire, and 114 ms per substep.
- Cells are built by counting sort rather than a head/next linked list, so a cell
  is walked as a contiguous slice instead of chasing pointers across a 600 KB
  buffer. As a side-effect the update became simultaneous: no bird now sees some
  of its neighbours already moved this substep.
- The hologram's home buffer is released when the mode switches away from it —
  ~25 MB at a 1024² grid, previously held until the next rebuild — and its
  per-cell scan is skipped entirely in murmuration mode.
- Dropped an inert `polygonOffset` from the new particle materials (WebGL exposes
  only `POLYGON_OFFSET_FILL`, so it does nothing for points and lines) and the
  `needsUpdate` flags from their uniform sync, which were rebuilding each
  material's program-cache entry on every slider tick for no reason.

### Fixed
- **A mouse pan no longer leaves the Pan fields showing `-247.38194837`, nor
  jumps the camera on the next click.** The camera is continuous and those
  sliders step by 1, and the orbit sync wrote the raw target straight into them.
  It read wrong, and it behaved wrong: `<input type=range step=1>` snaps its
  value to the step grid, so the thumb sat where the state was not and the first
  click jumped the camera to the snapped value instead of nudging it. The sync
  now rounds to each control's own granularity — 0.1° for tilt and rotation, 1
  unit for the pans — so state, thumb and camera always agree.
- **The draw modes no longer paint over the particle field.** Occlusion in this
  scene is decided by the depth-*writing* geometry — the fill surface and the
  per-layer occlusion curtains — while every layer that paints marks draws with
  `depthWrite: false`. Among those, order is settled entirely by `renderOrder`,
  and the particle field sat at the default `0` while every line layer sets
  `layerIndex + 1`. So the marks were painted over the field unconditionally: a
  flock plainly in the air in front of the terrain came out with the line
  pattern ruled straight across it. The field now paints last. It is still
  depth-tested against the surface and the curtains — which is what actually
  hides particles behind a mountain, and still culls ~39% of a hologram field on
  the default terrain — so this only settles the order against marks that never
  occluded anything in the first place. One bundled preset (Solar Wind) mixes
  particles with a draw mode and will render with the field on top.

### Changed
- The Particles toggle is labelled `Particles` rather than `Hologram`, and
  `Size`, `Opacity` and both colours are now shared by the two fields.
  `Spacing` is a hologram control and shows only in that mode.
- Particle `Size` reaches 250, up from 100.
- Panel sections carry a `data-testid`, since a collapsed section is a
  zero-height grid row and nothing inside it is reachable until it is opened.

## [0.9.8] - 2026-08-13

Edit Mode gained editable vertices and ellipse grips in 0.9.6, and then said
nothing about where any of them were. Every handle in the editor is 7–8 screen
pixels on a busy greyscale raster, and the pointer was a crosshair over all of
them and over the empty space between them alike.

### Changed
- **Edit Mode's cursor names the grab.** Whether a press would move a vertex, resize a box or start a whole new shape was something you found out by trying it. The cursor now answers first: `grab` over a ring vertex (`grabbing` while it moves), `copy` over an edge, where a press *adds* one, a directional resize over each of the eight crop and ellipse grips, `move` inside a movable selection, `pointer` over the vertex that closes a polygon, and `crosshair` wherever a press starts something new. Alt outranks all of them, since panning is what the press would actually do.
- The hit test moved out of `onPointerDown` into a `pick()` that names the gesture a press would start, which both the press and the cursor now read. Two copies of that decision tree would drift, and a cursor promising a grab where the press draws a new shape is worse than no cursor at all. The cursor is written straight to `canvas.style` — a hover must not re-render the panel — and is left alone mid-gesture, since pointer capture lets the pointer wander off the handle it grabbed.

## [0.9.7] - 2026-08-12

A bug-fix release about one mistake made in four places. `buildTerrain` stores
`0` in every cell the grid has no data for, and `0` is not "absent" — it is the
darkest possible ground, which `(b − 0.5)·100·elevScale` maps to the very bottom
of the scene. Anything that read one of those cells without meaning to drew the
edge of the selection instead of the landscape. Clipping with the ellipse and
lasso tools 0.9.6 added made it easy to hit; a GeoTIFF with NoData always could.

### Fixed
- **A clipped selection no longer fringes the draw modes with pillars.** Every mode that drapes itself on *fractional* grid coordinates takes a 2×2 bilinear tap, and a tap straddling the cut blended real ground against the NoData zeros — returning a height near the floor, so each mode drew a segment plunging from the terrain down to the base along the whole edge of the selection. Most visible in Engraving (which hatches at 45° at every setting) and in Lines and Crosshatch at an oblique bearing, where the samples fall between grid cells; at 0°/90° they land exactly on cells, which is why those two angles looked fine. Flow lines, Swiss rock hachures and scree, and GPX draping had the same fault. Sampling is now *normalized*: only the corners that carry data are weighted, and the tap is renormalised against them, so a stroke reaching the cut ends on the ground that is there. A tap with no data under it at all returns NaN, which ends the stroke rather than diving.
- **Blur no longer sags the terrain along a clipped edge.** The box blur averaged real ground against the zeros in NoData, so the last blur-radius' width of the selection ramped down toward the floor — a dark rim on the surface and a genuine slope in the geometry. It is now a normalized convolution (`Σ w·m·v / Σ w·m`) whenever the raster actually has holes; a solid raster keeps the old, cheaper path untouched.
- **Ridge, Curvature and Pencil Shading no longer trace the outline of the selection.** All three differentiate the height field, and a second difference taken against the NoData zeros is the strongest feature anywhere on the terrain — so the border of a crop was found first and drawn as a crest. Worse for Curvature, whose threshold is a fraction of the maximum strength on the terrain: the phantom rim set that maximum, and the mode fell to a handful of strokes clinging to the edge. Stencil taps now read NoData as flat, the convention `buildTerrain` already used for slopes and Engraving for its shading normals.
- **Valley/Ridge (TPI) measures against real ground.** The neighbourhood mean counted NoData as zero elevation, which dragged it down near a clipped edge and made the cells there read as ridges.

Output on a raster with no NoData is bit-identical to 0.9.6 for all fourteen modes.

## [0.9.6] - 2026-08-12

Two additions to Edit Mode, both about not having to start over. Circles and
ellipses previously had to be traced by hand with the lasso, and any selection
that came out slightly wrong had to be redrawn from scratch — the vertices were
thrown away the moment the ring closed.

### Added
- **An ellipse selection in Edit Mode**, with Shift for a perfect circle. It is stored as an ellipse rather than sampled into a polygon: a 128-gon shows visible flats once the raster is a few thousand pixels wide, and the implicit form is both exact and cheaper to fill — solving the ellipse equation for `x` gives each row's span directly, so the fill touches only the pixels it sets instead of testing the 4/π of the bounding box it does not. Shift is read on every pointer move rather than latched when the drag starts, so it snaps to a circle mid-drag and while resizing, not only at the outset.
- **Lasso and polygon selections stay editable after they are closed.** Getting a hand-drawn outline slightly wrong meant redrawing the whole thing. Now the vertices remain: drag one to move it, drag an *edge* to split it and pull the new vertex out in the same gesture, right-click one to remove it (never below the three that still enclose an area). Lassos are additionally decimated on release with the Douglas–Peucker pass already used for contour smoothing (`simplifyFlat`, now exported) — a stroke that emitted 200 near-duplicate vertices comes back as 20-odd editable ones, which also gives the scanline fill fewer edges to cross.

## [0.9.5] - 2026-08-11

A release about finding things. The app could already render 56 curated looks
and any point in a ~250-parameter space, and gave you almost no way to *find*
one: the Presets section was 56 identical grey buttons, and the only route to
anything not on that list was to know in advance what you wanted and go set it.
Presets are now pictures, and there is a button that rolls a look for you.

Also folds in the documentation rewrite that had been sitting unreleased.

### Added
- **Preset thumbnails.** The Presets section was 56 identical grey buttons — every look the app ships with, behind a name and nothing else. Each is now a picture. `npm run thumbs` (`scripts/generate-thumbs.js`, modelled on the existing `update-presets.js`) drives the dev server, applies each preset at the Iso camera and photographs it through the app's *own* 4K PNG exporter, so there is no sidebar and no orientation gizmo in frame, then scales it down in-browser — no image tooling needed on the host. WebP at 320×200: 434 KB for all 56, where PNG was 55 KB for a single stipple tile. A missing thumbnail falls back to the old text button rather than a broken image.
- **Surprise me.** A seeded randomiser. Blind randomness over ~250 parameters produces mud, so this is a recipe: paper or ink, one to three draw modes drawn against a *cost budget* (three cheap layers is a picture, three expensive ones is a slideshow), a palette from the built-in ramps or a generated one, and at most one surface overlay — they compete for the same pixels. Ink is checked against the background's luminance, because roughly a fifth of early dark rolls came back as a black line on a black field: a valid point in the space, and not a picture anybody wanted. Measured over 300 rolls: no empty canvases, no low-contrast layers, 2.1 modes on average. The seed is displayed and the arrow steps back through recent rolls — the seed *is* the look, so the history is a list of integers rather than a stack of 250-key snapshots.

### Documentation
- **The README was rewritten.** It had grown by accretion into a flat list of feature paragraphs — one of them 450 words in a single block — with no images, no usage, and no statement of what the app takes as input. It is now grouped by what someone actually wants to know in order (input → edit → draw → overlays → soundscapes → export → keyboard → performance), and the performance wall of text is a list of the specific claims it was already making.
- **A gallery.** A visual tool with no visuals was the largest gap: six of the bundled presets rendered from the same sample heightmap, plus a shot of Edit Mode. They are produced by the app's own 4K PNG exporter rather than by screenshotting the page, so there is no sidebar and no orientation gizmo in frame — see [docs/images/README.md](docs/images/README.md) for how to regenerate them.
- **[docs/Architecture.md](docs/Architecture.md)** — the map that the five per-feature documents did not have: the file → store → worker → renderer/exporter pipeline, why state lives in three different places, and the three-tier rule for what a change is allowed to cost (geometry rebuild / re-render / nothing). Includes the checklist for adding a draw mode, an overlay, a CRS or a projection, since forgetting to add a new mode's params to `useTerrainGeometry`'s dependency list is the classic silent bug.
- A keyboard-shortcut table, which had never been written down anywhere.

### Changed
- The four default parameter blocks moved out of `App.jsx` into `src/defaults.js`, and the canonical draw-mode list into `src/utils/drawModes.js` (id, label, rebuild cost, randomiser ranges). Both were previously reachable only by importing the root component or by copying the list, and the randomiser needs both to build on. `Sidebar.jsx` now reads its hypsometric-layer list from the same place, so a new draw mode is described once.

## [0.9.4] - 2026-08-11

A feature release: the loaded raster can now be clipped before it becomes
terrain. Until now a heightmap was used whole — the only way to work on part of
one was to crop it in another program and load it again, which cost the GeoTIFF's
georeferencing and could not be undone. Edit Mode does it in place, keeps the
original, and works the same on all three sources.

### Added
- **Edit Mode — clip the loaded heightmap before it becomes terrain.** `E`, or the ✂ button under the loader, switches the viewport to a flat greyscale view of the raster and the sidebar to an edit panel: a crop rectangle with handles, aspect locks and numeric fields, plus lasso and polygon selection for cutting out one massif, one catchment or one arbitrary shape. It applies to all three sources — PNG, GeoTIFF and Soundscapes — because all three write the same store slot. The clipped terrain is centred: `buildTerrain` already derives `halfW`/`halfH` from the bounding box of *valid* cells, so a selection expressed as a NoData mask lands in the middle of the view without any draw mode being taught about selections. Feather (0–64 px) softens the cut as an elevation ramp rather than mask opacity — the geometry mask is binary, so a partial weight has nowhere to live there; fading the value toward the selection's own lowest point instead makes the edge melt down to its base level, which is also what keeps a clipped STL printable.
- The clip is **non-destructive**. The store now holds the raster twice: the source exactly as loaded, and the derived raster everything downstream consumes. Re-opening Edit Mode shows the full original with the selection still live, Cancel costs nothing because nothing is committed until Apply, and Clear restores the whole raster. It is also what lets a *streaming* Soundscape keep its clip: each pushed frame is a new source, re-clipped on the way through, and the clip is dropped only when the raster's dimensions change (freezing a whole track, resizing the window).
- Cropping moves the georeferenced corners with the pixels. A GeoTIFF's bounding box is re-derived over the crop rectangle, so a GPX track stays on the terrain instead of being projected against the extent of a raster that no longer exists.

### Fixed
- **A resolution guard could leave the grid stuck at half the resolution asked for.** `useTerrainGeometry` clamps resolution when new pixels arrive, to stop a value chosen for a 1k raster from building an 8k one as a 64-megacell grid. It keyed on the pixel buffer's *identity* and used a stricter threshold (`/1000`) than `autoResolution` (`/1024`), so any buffer that changed without being a new picture — hydraulic erosion writing its result back, a Soundscape streaming, an Edit Mode clip being cleared — was clamped too, and a 1024² raster at resolution 1 clamped to 2 and stayed there, because nothing afterwards changes `p.resolution` to trigger the corrected rebuild. Now keyed on the raster's dimensions and aligned to the same 1024-cell budget, so the guard and the policy always agree on the value.

### Changed
- The panel's design tokens and control atoms (`Sl`, `InlineSl`, `Tog`, `Section`, …) moved out of `Sidebar.jsx` into `components/panel/ui.jsx` and are imported back. A pure move: Edit Mode's panel needs to look like it belongs to the same tool, and the alternative was a second copy of every control that would drift on the first tweak.
- **Presets moved below Aspect Map in the sidebar**, out of the block of camera and view controls and down to where the surface overlays end — a preset sets the whole look, so it belongs next to what it sets rather than above it.
- The Sidebar is hidden rather than unmounted while Edit Mode is open. Unmounting reset every section's open/closed state and the erosion settings, all of which live in the Sidebar's own state, so leaving Edit Mode silently collapsed the panel back to defaults.

### Documentation
- **[docs/Edit-Mode.md](docs/Edit-Mode.md)** — the source/derived split and when a clip is dropped, why centring falls out of `buildTerrain`'s existing valid-cell bounds, the even-odd scanline fill and why it samples pixel centres, the feather ramp and its chamfer distance transform, the bbox interpolation that keeps GPX tracks placed, how erosion writes back through a clip, and the interaction and memory notes for the canvas.

## [0.9.3] - 2026-08-10

A documentation and test-integrity release. Nothing changes about what the app
computes, draws or exports. 0.9.2 rebuilt how georeferenced input is read and
reported without documenting any of it; that gap is now closed. The one code
change is to a test that had been steering its camera with a key nothing has
listened for since v0.2.13.

### Added
- **[docs/Georeferencing.md](docs/Georeferencing.md)** — the projection readout and what each of its caveats means, the full table of transformable coordinate systems and why the national grids are declined rather than approximated, how a GPX track is placed and the three distinct reasons one fails to appear, the vertical-exaggeration formula with the measurement showing a reprojected DEM renders at the same relief, NoData handling, and the geotiff.js lazy-`fileDirectory` trap that makes a georeferenced file read as unreferenced without ever throwing. Also a note on adding a CRS: one table entry reaches the renderer, the STL exporter and the sidebar together, because all three ask the same classifier.
- **README** — a Features entry for georeferenced input and GPX overlay, which had no coverage at all, and the new document in the Documentation list.

### Fixed
- **Three export tests set their camera by pressing a key nothing listens for.** Each opened with `for (let i = 0; i < 80; i++) page.keyboard.press('KeyX')` and a comment about taking a steep tilt. `KeyX` stepped tilt by 0.5° up to a 90° clamp until v0.2.13 removed it (`hotkey trim`, alongside W/A/S/D, Y, E/R, T, G) — the tests were never updated, so for eleven releases the loop pressed a dead key and every one of them silently ran at the *default* tilt instead. They still passed, because occlusion does bite at 50°, but no test verified the angle it claimed to be testing at. Tilt is now set through the actual slider and asserted afterwards, since a silently ineffective camera control is the precise failure being repaired. Pinned at 50° — the value the thresholds and reference numbers were tuned against, so nothing moved: 255 105 SVG elements, 33 636 → 27 178 marks under Hillshade, both unchanged. Setting it explicitly also means a future change to the default camera fails these tests instead of quietly altering what they measure.

## [0.9.2] - 2026-08-10

A correctness release for georeferenced input. Every fix below is a silent
failure: nothing threw, nothing warned, and the app went on drawing something
plausible. A GPX track laid on a GeoTIFF in most projected coordinate systems
simply did not appear, a raster reprojected with `gdalwarp` came out a third
flatter than the file it was made from, and no GeoTIFF's declared NoData value
had ever been read. The through-line is that geographic metadata was being
trusted without being checked — so alongside the fixes, the sidebar now states
the projection it found and says plainly when a track and a raster do not
describe the same place.

### Fixed
- **A GeoTIFF reprojected to EPSG:4326 rendered visibly flatter than the projected original it was made from.** The vertical-exaggeration hint converted a geographic raster's degrees to metres with a flat `111_320` — metres per degree of longitude *at the equator*. Meridians converge, so at 47°N a degree of longitude is ~75 km, and using the equatorial figure overstated the east–west ground size of a pixel by 1/cos(lat): 1.48× in the Alps, 1.44× at the Matterhorn. The suggested exaggeration was understated by exactly that factor. Measured on `tests/testdata/geotiff.tif` (EPSG:32633, 10 m pixels) against `gdalwarp -t_srs EPSG:4326` of itself — same terrain, same 641.36–2349.51 m range — apparent relief came out at 0.67× the original before the fix and 0.9955× after. Where the projected file's hint was already at the clamp ceiling of 50 the slider could not close the gap either, since the reprojected file started ~11 lower and +10 is the most the offset adds. The latitude now comes from the raster's own bounding box.
- **The declared NoData value was never read.** `fileDirectory.GDAL_NODATA` was accessed as a plain property, but current geotiff.js exposes `fileDirectory` as a lazy object whose tags are reachable only through `hasTag`/`getValue` — plain access returns `undefined` *without throwing*, so every GeoTIFF was treated as declaring no NoData value at all. The sentinel list did not cover the gap: GDAL writes float DEMs with `-3.4028235e+38` and only the **positive** float max was a sentinel, so a void in such a raster was read as real ground 3.4e38 metres down. That sets the normalisation floor, which collapses the entire terrain to a plateau. Rasters with voids — clipped catchments, SRTM holes — are the app's headline input. Tags now go through one accessor that handles both the lazy and the plain-object shape.
- **A GPX track on a GeoTIFF in most projected CRS drew nothing, silently.** `geoToWorld` handled Web Mercator, the WGS84 UTM blocks (`326xx`/`327xx`) and the internal `projected-unknown` sentinel — and for everything else fell through to `bx = lon; by = lat`, feeding degrees into a bounding box measured in metres. Every point then failed the extent test, and points outside the extent are dropped as ordinary clipping (correct for a genuinely clipped track), so the failure produced no error, no warning and no line: identical on screen to a track that simply missed the tile. The worst case was **EPSG:25832 — ETRS89 / UTM zone 32N, the standard CRS for Austrian and German elevation data** — which is a UTM grid the maths already supported and which failed purely because the code lived in a `326xx` regex instead of a zone table. CRS handling is now one classifier, `classifyCRS`, and an unsupported CRS returns `null` from the projection step rather than plausible-looking degrees.
- **A plain TIFF claimed to be WGS84.** The loader defaulted `crs` to `EPSG:4326` before establishing that the file was georeferenced at all, so a TIFF with no tie point, pixel scale or transformation had its pixel grid read as a lon/lat bounding box — which no GPX track can ever fall inside. Georeferencing is now detected first and its absence recorded as `EPSG:none`, which also stops the vertical-exaggeration hint being derived from a pixel size that does not exist.
- **`crs?.startsWith('EPSG:')` was not a support check**, but it was the gate in front of the GPX layer in all three consumers (worker, geometry builder, STL exporter). It admitted `EPSG:none` and every unsupported grid, which is how those reached the fall-through above. All three now call `isTrackProjectable`, which tests the CRS *and* the bounding box for the degenerate and non-finite cases.
- **The sidebar's GPX warning could never fire.** It tested `geoTiffCRS?.startsWith('unsupported')`, a string the loader has never emitted; its text was also wrong, naming only EPSG:4326 and 3857 when UTM had been supported for some time.
- **UPS North (EPSG:32661) parsed as UTM zone 61.** The old `^EPSG:326(\d{2})$` regex accepted any two digits, giving a central meridian past the end of the world. Zone ranges are now bounded per family.

### Added
- **Projection readout in the sidebar metadata**, below the elevation range: the CRS name the file states about itself where it has one, otherwise a built-in name, always with the EPSG code — e.g. `WGS 84 / UTM zone 33N (EPSG:32633)`. It appears only for a GeoTIFF; a PNG heightmap and a frozen soundscape have no projection to report and both clear the field. Where the placement rests on an assumption the line says so rather than implying precision it does not have: `· assumed UTM` when the file records no code, `· datum shift not applied` on an older datum, `· GPX overlay unsupported` when the grid cannot be projected into at all.
- **Track-vs-raster diagnostics.** The three ways a GPX overlay comes up empty used to look identical and need different fixes, so they are now reported separately: the projection cannot be computed (with the `gdalwarp -t_srs EPSG:4326` line that fixes it), the raster is not georeferenced, or the track projected fine and lands somewhere else on Earth — the last reported as a count, `0 of 4 812 track points fall inside this GeoTIFF`, with partial overlap shown as a coverage figure instead of a warning. GPX parse failures and files holding only waypoints are surfaced in the panel too, rather than going to the console as before.
- **More transformable CRS**, all of them cases the previous code either mishandled or dropped: the ETRS89 (`258xx`), NAD83 (`269xx`) and NAD27 (`267xx`) UTM blocks alongside the WGS84 ones; Web Mercator's aliases (3785, 900913, the two ESRI codes); and geographic CRS beyond 4326 — ETRS89, NAD83, GDA94/2020 used unshifted, older datums (NAD27, ED50, MGI, DHDN) accepted but flagged, since ignoring their shift costs 100–400 m and that is worth saying rather than hiding.
- **Load-path cases driven by a real GeoTIFF**, because the lazy-`fileDirectory` bug above is invisible to any unit test — the read returns `undefined` rather than throwing, so only loading an actual file through the actual UI catches it. The fixture (`tests/testdata/geotiff.tif`, 1200×700, EPSG:32633, 10 m pixels) is gitignored like `benchmark.tif`, so these **skip** rather than fail on a clean checkout; unlike `benchmark.spec.js` they announce themselves as skipped instead of going red, since a missing fixture is not a regression. Its being in a projected CRS matters: an EPSG:4326 raster would still pass if CRS detection collapsed back to its old lon/lat default.
- **`tests/projection.spec.js`** — 27 cases over a module that had no coverage at all, including the regression above. Pins the UTM series against its two exactly-defined points (500 000 E on the central meridian, 0 N at the equator) and the standard 45°N check value, Web Mercator against its closed form, and each coverage verdict against a synthetic 10 km raster. The classification, gate and null-return cases fail against the previous code.

### Changed
- Named national grids are **rejected rather than approximated**. A GeoTIFF in Austria Lambert (31287), the Austrian Gauss-Krüger meridian strips (31254–31259), Swiss LV95 (2056), OSGB (27700), Lambert-93 (2154) or LAEA Europe (3035) is now identified by name in the sidebar and declined, because placing those correctly needs Lambert/Gauss-Krüger maths plus a datum shift — and for the MGI-based Austrian grids, an unshifted overlay would sit a few hundred metres off while looking entirely plausible.
- **Projected CRS in feet are no longer read as metres** for the vertical-exaggeration hint; `ProjLinearUnitsGeoKey` is honoured for the US survey foot and the international foot.

## [0.9.1] - 2026-08-09

A library release. The preset shelf triples in size, which is also why the
panel that holds it no longer opens by default.

### Added
- **Forty new style presets**, taking the shipped library from 16 to 56. The set is built to cover the range the draw modes can actually reach rather than to vary one knob forty times: engraving and hatching (Copper Plate, Woodcut, Etched Glass, Chalk Cliff), cartographic (Cartographer's Draft, Compass Rose, Dotted Survey, Contour Quilt, Lunar Survey), instrument readouts (X-Ray, Thermal Camera, Sonar Sweep, Circuit Board, Static), water and light (Bathymetric, Mirror Lake, Tide Line, Riverbed, Rainfall, Aurora, Solar Wind, Long Exposure, Blue Hour), and material studies (Obsidian, Iron Oxide, Bark, Scree Slope, Ceramic Glaze, Magma Chamber, Crystal Lattice, Moss & Granite). Each was round-tripped through the app by `scripts/update-presets.js`, so every file carries the complete current `STYLE_DEF` surface — a preset that omitted a param would silently inherit whatever the previous style had left there, which is how a preset stops being reproducible.

### Changed
- **The Presets section starts collapsed.** At 16 entries the open grid was a reasonable landing spot; at 56 it pushed Style, the draw modes and everything below them off the first screen of the sidebar, so the panel that is meant to be a shortcut became the thing you scroll past. It is the only section whose default changed — its own open/closed state is still remembered for the rest of the session once you toggle it.
- **Particle Size now goes to 100**, up from 20. The shader scales point size by distance (`size × 300 / −z`), so the previous ceiling capped the field well short of the dense, overlapping look large points give. The GPU's own limit is the real ceiling — measured at 511 px here — and 100 stays under it at any normal camera distance. SVG export uses the identical scaling, so exports still match the viewport.

## [0.9.0] - 2026-08-07

A maintenance release: no new features, but the largest correctness pass the
project has had. Two of the bugs below silently corrupted exported files, and
three of the performance items were costing every user something in the default
configuration.

### Fixed
- **Every GeoTIFF with a NoData region exported an unprintable STL.** `buildSurfaceGeometry` parks masked vertices at `y = -10000` as a hide-it sentinel — safe for rendering, because a quad is emitted only when all four corners are valid, so no index ever references them. But `stlExport` scanned the *raw position array*: one voided pixel anywhere set the base plate 10 000 units below the model, and the perimeter walk, which indexes the grid border arithmetically with no mask test, extruded matching side-wall spikes. Measured on a 128² heightmap with a transparent quadrant: Z spanned −10002…28 before, −52…28 after. DEMs with voids — clipped catchments, SRTM holes — are the app's headline input. The floor is now taken over indexed vertices only, the perimeter skips masked cells, and the sentinel is a named constant in `terrain.js` so the write site and its readers cannot drift apart again.
- **SVG export lost terrain occlusion unless *Fill* was on.** The exporter gated its depth buffer on `showFill` alone — the fourth copy of the predicate 0.8.3 consolidated into `hasFillLayer`, one file away and missed. Fill is off by default, so any scene styled with Hillshade, AO, Water, Slope shade or Raw view exported lines the viewport correctly hid behind the mountain. Measured with Stipple as the only draw mode (it produces no occlusion curtains of its own, so the surface is the only possible occluder): 33 636 marks exported both with and without Hillshade before the fix, 33 636 → 27 178 after.
- **The elevation cut meant two different things.** Draw modes cut on elevation normalised to the data's own range; the surface shader discarded on raw brightness. The two agreed only for a heightmap spanning exactly 0–1 — for anything narrower, including any raster with Blur on, the fill boundary and the lowest surviving contour sat at visibly different heights. The surface now uses the same normalisation, reusing bounds already plumbed in for Raw terrain view.
- **`||` swallowed legitimate zeroes in three elevation params.** Dragging *Elev max cut* to 0 fell back to 100, leaving the fill fully visible while every line layer was culled; `svgExport` had the identical bug, so its depth buffer kept triangles the viewport had discarded. Both now use `??`.
- **`elevScale` was unguarded at zero and below**, and both are reachable in a single drag (the effective value is `baseElevScale` plus a signed offset whose slider steps by 0.1 and reaches −10). At exactly 0 the contour builder computed `0/0` → NaN, which made its loop bound NaN so the layer vanished with no error; it now returns "no contours" deliberately, because a flat field has none. Below 0 the elevation bounds crossed, and every consumer's `maxZ > minZ` guard then degraded silently — hypsometric ramps collapsed to a single colour and any elevation cut above 0 culled the whole scene. The bounds are now ordered, so inverting the terrain stays a usable creative move. Separately, two uniforms 27 lines apart disagreed about the same value (`|| 1` versus `?? 1`), so at `elevScale === 0` cast shadows silently stopped while banding carried on at a different scale; both now read one guarded value.
- **Hydraulic erosion wrapped its brush across rows.** Only the flat index was bounds-checked, never the column, so a droplet near column 0 with radius 10 eroded the last ten columns of the *previous* row — both borders developed mirrored streaks unrelated to local slope. The brush now keeps `dx`/`dy` separately and checks both axes.
- **STL export wrote a corrupt file from empty geometry.** Clearing both mirrors on one axis leaves zero octants and so zero vertices; the exporter went on to download megabytes of `NaN` and `Infinity` floats. It now produces nothing, which is what the blank viewport already implied.
- **An object URL leaked on every PNG load** (`useHeightmap`) — never revoked on either the load or the error path, and it is the path every 8-bit PNG takes. It was the only unrevoked one in `src/`.
- Removed two props passed to `exportSVG` that it does not accept (`fillHypsometric`, `gradientStops`); they implied SVG export handles surface colouring, which it does not.

### Performance
- **Hidden particles stopped costing a rebuild.** `ParticleSystem`'s home-buffer memo omitted `showPoints`, and the early return that hides the field sits below every hook — so in the *default* configuration (points off, one particle per cell) every terrain rebuild still scanned the grid twice, allocated ~25 MB and seeded a random per particle for a field nobody could see. Under Soundscapes streaming that ran 30 times a second. The redundant `.slice()` of the home buffer is gone too: nothing writes to it, since all motion is computed from `uTime` in the vertex shader.
- **A quarter-gigabyte of VRAM freed in the default configuration.** The heightmap `DataTexture` — a full-resolution R32F copy of the raster, 268 MB at 8k — was uploaded unconditionally, but only the cast-shadow and AO branches sample it and both default off. It is now built only when one of them is on, and capped at 2048²: both consumers ray-march at most 128 steps with a stride growing to ~14 cells, so they cannot resolve more than that anyway.
- **SVG export is 3.9× faster** — 1042 ms → 265 ms on the reference terrain at a 40° tilt. The per-sample occlusion walk took a flat 64 depth samples per segment regardless of length, which at a typical grid cell of ~2.7 screen px is about 30 samples per *pixel*; it now scales with screen length at two samples per pixel, which is all a per-pixel depth buffer can represent. The projection itself did four mat4 transforms where one suffices (the group matrix, the view matrix for `viewZ`, then `.project()` re-applying the view matrix) and allocated two objects per sample; it is now a single folded MVP plus one dot product for `viewZ`, writing into reused scratch buffers. Output is 255 105 elements against 255 578 — 0.19% fewer, all of them occlusion transitions inside a single pixel that the depth buffer could not have placed accurately.
- **Occlusion curtains are no longer built when nothing will draw them.** They exist only to occlude, and both consumers gate on `depthOcclusion`, but the worker did not know it was off and shipped ~18 MB plus a per-segment loop every rebuild. Toggling that switch now costs one rebuild instead.
- **The full-resolution blur is cached in the worker.** It depends only on the raster and the radius, neither of which moves when a style slider does, yet it re-ran on every message — at 8k the single most expensive step in the pipeline, repeated on every drag tick. Also stopped allocating a third full-size buffer for fractional radii (the common case, since the slider steps by 0.1): the lerp writes back in place, saving 268 MB of peak at 8k.
- **Diagonal path enhancement is O(n²) instead of O(n²·r)** — the similarity matrix is really 2n−1 independent 1-D moving averages, so each diagonal is now walked once with a rolling sum. Bit-identical output, verified against the previous implementation across 64 shape/radius combinations; 59.2 ms → 3.0 ms at size 768 with enhance 32, taking a full Similarity build from 88 ms to 11 ms.
- **Strata skips the features it was told not to draw.** The enabled set is now resolved before the curves are computed rather than after, so noisiness (a `Math.log` per bin per frame — ~10M calls on a real track) and harmony (an entire second pass over the spectrogram) are no longer computed when off, which they are by default.

### Documentation
- **Corrected comments that were false.** Two places described "the 12 draw modes" when there are 14; `boxBlur`'s JSDoc claimed it uses an integral image, which the implementation note directly above it explains it deliberately avoids; and `buildSurfaceUvs` justified its behaviour by matching "the previous main-thread build", a path removed in 0.7.7.
- **Headers for the algorithms that lacked them**, bringing them up to the standard the rest of the file already sets: `buildContours` (the cell-major marching-squares pass and which of chaining, smoothing and ring-closing each option actually pays for), `buildContoursTanaka`, `buildSurfaceGeometry` (the all-four-corners quad rule, the NoData sentinel, and why indices are counted before being written — the three things the STL bug above turned on), `buildDagThinning`, `buildTpiFeatures`, and `buildPillars`.
- **`erosion.js`'s header rewritten.** It was a list of what the code does with none of the why, while `// 1.` … `// 8.` narrated the obvious inside the loop. It now records the constraints that are actually load-bearing — the droplet lifetime cap, the uphill deposition rule that fills pits, the erosion clamp that stops cells going negative — and drops the narration. It also claimed to be "non-destructive"; the result is clamped back into 0–1 at the end, so it is not, and now says so.
- **`minZ`/`maxZ` renamed to `minElev`/`maxElev`.** They hold Y-axis elevations in a Y-up scene where `z` is the row axis, across ~60 references — actively misleading, and directly adjacent to the crossed-bounds bug fixed above.

### Removed
- Dead code, each grep-verified: `lerpRgb` (no importers, sitting beside the pooled version that is used), `lineOpacity`/`baseOpacity` threaded through the layer context and never read by `computeVertexColor` (opacity is resolved render-side by `layerStyle`), and the `uOpacity` particle uniform — declared, initialised to 1.0, never assigned, a direct sibling of the `uOcclusionOnly` removed in 0.8.3.
- *Not* removed: the four `[Benchmark]` console logs. They look like debug leftovers but `tests/benchmark.spec.js` parses all four, so the two that were undocumented are now labelled as the test contract they are.

### Added
- **`tests/stl.spec.js`** — STL export had no content coverage at all. Asserts finite coordinates and sane bounds against a generated heightmap with a transparent quadrant, and that empty geometry produces no download. Both fail against the previous code.
- An SVG occlusion regression test driving the Stipple-only case described above.

## [0.8.3] - 2026-08-06

### Changed
- **"Raw terrain view" now shows the raw terrain.** It did not: the toggle added two hardcoded diffuse lights in the surface fragment shader and multiplied the fill or gradient colour by them, leaving the elevation, every draw mode and every overlay — texture, water, hillshade, AO, aspect, slope shade — untouched on top. The name promised a look at the source data and the feature delivered a differently-lit render. It is now what it claims: the loaded heightmap as a **flat greyscale plane with everything else hidden**, lowest point black and highest white. It draws the grid the pipeline actually works from — after resolution, blur, Levels and the elevation cuts, which still punch holes — so it doubles as a live preview while tuning those, and the greyscale is stretched across the data's real bounds so a raster occupying only the middle of 0–1 reads at full contrast instead of as flat mid-grey. The camera deliberately does not move.
- **Flattening happens in the vertex shader, not the geometry** — which is a correctness point, not a convenience one: `stlExport` builds from `surfaceGeo.positions`, so flattening upstream would have quietly exported a flat slab. Shader-side, the exporters all still see the real terrain and the toggle is a uniform flip. Hiding the rest falls out of a single early `return` in the fragment shader, placed above every overlay, rather than switching seven of them off by hand.
- **Toggling raw view no longer rebuilds geometry.** `needsSurfaceShading` listed `showRawTerrain`, so each toggle cost a full worker rebuild to produce normals and UVs — which the new flat, unlit view never reads. It now sits in `hasFillLayer` (the surface must still rasterize and write depth) but not in `needsSurfaceShading`, making the toggle free. Both predicates were previously the same expression written out three times across `SurfaceMesh.jsx` and `App.jsx`, which is exactly how they would have drifted apart; they are now one definition each in `geometryBuilders.js`. Because raw view can now be the *only* fill layer, the geometry may carry no normals at all — hence the early return sits above `normalize(vNormal)`, which would otherwise be NaN.
- Elevation-profile picking is disabled while raw view is on: the raycast target is the unflattened geometry, so a click would report an elevation from somewhere other than where it was aimed.

### Removed
- **The `uOcclusionOnly` shader uniform**, which never did anything. It was declared in the surface fragment shader, initialised to `false`, and read by an `if` block whose body was a comment explaining that the work happens elsewhere — nothing ever assigned it. The real occlusion-only mechanism is `surfMat.colorWrite = anyFill`, set from `hasFillLayer`. Left in place it reads as a second, parallel switch for surface visibility, which is exactly the wrong thing to believe while changing how that visibility is decided.

## [0.8.2] - 2026-08-06

### Added
- **Whole-track projections — four new ways to freeze a song.** *Freeze Whole Track* had exactly one answer: the spectrogram stretched end to end. That is the literal projection and a poor portrait of a *song* — a four-minute STFT squeezed into 1024 columns is mostly noise with a loud middle. A projection selector now sits above the button, and the other four fold the track so its structure becomes relief. **Disc** winds the track into a record (time around, frequency out to the rim); above one turn it becomes an Archimedean groove, and setting the turn count to the track's bar or phrase count makes every repeat land at the same angle, so verse/chorus structure resolves into visible sectors. **Similarity** compares every moment against every other over 24 log-spaced band energies or 12 pitch classes, so repeated choruses are stripes parallel to the main diagonal and sections are blocks; the **Lag** layout re-plots cell (i, j) at (i, j−i), straightening those diagonals into horizontal ledges. **Weave** folds the track onto its own bar grid — tempo from autocorrelating a half-wave-rectified spectral flux envelope — so repeated patterns stack into vertical ridges and fills and dropped beats read as interruptions. **Strata** gives nine measured qualities plus a chromagram their own horizontal bands over one timeline, drawn as silhouettes or terraces. Every projection is a pure function of the existing analysis returning the same pixels/width/height the store takes, so all fourteen draw modes, hillshade, erosion and every exporter apply unchanged, and **dB Floor** and **Contrast** feed all of them. Documented in [docs/Soundscapes.md](docs/Soundscapes.md#whole-track-projections).
- **Projection settings are a declarative schema, rendered generically.** Five projections carrying up to ten settings each would be several hundred lines of near-identical sidebar JSX, and every future projection would mean writing more of it. Descriptors map onto the existing control atoms — a bare one is a slider, `seg` a segmented row, `tog` a switch, and a shared `group` collapses several toggles into a chip grid rather than a wall of ten labelled switches. Adding a projection is one registry entry: an id, a label, a blurb, a `build()` and its params.
- **Playwright coverage for all five projections** — per-projection freeze shape and filename, the schema-rendered controls actually driving the output, re-rendering in place while frozen, plus a structural-invariants test that drives the projection module directly through the dev server and checks the heightmap contract, squareness of the disc, exact symmetry of the similarity matrix, and tempo detection against a known 120 BPM signal. The committed `sweep.mp3` fixture is a 6 s sweep with no repeats or beat grid to find, so the maths is tested against a synthetic signal generated in-page instead; [tests/testdata/README.md](tests/testdata/README.md) records both that split and the two length artefacts (a three-row weave, and a similarity matrix whose default size collides with the streaming window) that would otherwise read as bugs.

### Changed
- **Two subtleties that decide whether these read as terrain rather than as static.** Similarity gets diagonal *path enhancement* — averaging along the diagonal direction, since a genuine repeat is precisely the case where consecutive moments match consecutive moments, which turns a dotted repeat into a continuous ridge — and is renormalised to its observed min/max, because cosine similarity between non-negative spectra clusters in the top of its range and the raw matrix is a plateau with faint marks on it. The disc's spiral is parameterised by *nearest groove* rather than by ring index: deriving the turn from radius alone tears the image along the seam where the angle wraps, which is exactly where the groove should run on into its next lap.
- **`fitSoundscape` picks terrain resolution from cell count instead of hard-coding 1.** A streamed 512² window must render undecimated or frequency rows are thrown away, but a 1024² disc at resolution 1 is a million-cell grid that the line modes grind through slowly enough to look like a hang. Cell count is what costs — 1024×512 and 768×768 are the same work despite looking very different — so a threshold on the longest side would have decimated the frozen spectrogram, which has always rendered undecimated. The budget is set just above it, and only the genuinely larger projections step up.
- **The gate-then-gamma tone map is one function.** `sliceWindow`, `resampleTime` and every projection applied the same clamp-and-pow expression; it is now `toneMap()` in `spectrogram.js`, with a fast path for the `contrast === 1` case the projections hit tens of millions of times.

## [0.8.1] - 2026-08-05

### Added
- **Mode: Curvature — form-following engraving.** A fourteenth draw mode that traces streamlines through the terrain's principal-curvature direction field, so the strokes wrap the shape rather than the light: where Engraving hatches by illumination and Hachure follows the gradient, this follows form. The Hessian's eigen-decomposition gives the two principal directions per cell, and **Across form** runs along the strongest bending (lines hoop around a ridge) while **Along form** runs along the flattest (strokes comb out along ridges and valleys). Spacing uses the Jobard–Lefebvre criterion — each line claims territory as it advances and stops on reaching another's — so strokes stay evenly separated instead of clumping, with seeds ordered by descending curvature so structurally significant strokes are placed before filler. Documented in [docs/Draw-Modes.md](docs/Draw-Modes.md#14-curvature).

### Fixed
- **Raw terrain view rendered as a flat unlit slab.** The `needsSurfaceShading` optimisation added in 0.8.0 (which skips surface normals and UVs when nothing shades the surface) tested `style.showRawTerrain`, but `showRawTerrain` is the one flag of the seven that lives in the *view* state, not style — so it was permanently `undefined` and, with only raw terrain enabled, the worker shipped geometry with no normals for the shader to light. The flag is now derived from the merged param object rather than from hand-picked source blocks, which is also how `SurfaceMesh` computes the same condition, so a param moving between state blocks can no longer silently read as `undefined`.
- **Supersampling 2× rendered off-centre and cropped on large Retina displays.** A browser that cannot afford the requested WebGL drawing buffer clamps it silently: `canvas.width` keeps reporting the requested size while the real framebuffer is smaller, and Three goes on setting a viewport for the size it asked for, so the scene is drawn past the edge of the buffer that exists. Measured on a 2560×1440 window at devicePixelRatio 2, where 2× requests 10240×5760 and receives 7680×4320. The ceiling is not a constant that can be hardcoded — it depends on the live context's state, and an offscreen canvas with identical attributes probes clean well past where the displayed one clamps — so a guard now measures it when it bites and caps the pixel ratio to what the display will actually deliver. Supersampling degrades gracefully (here to ~1.5×) instead of breaking the view.
- **The sidebar spectrogram did not update after *Freeze Whole Track*.** Nothing in the soundscape state distinguished "streaming a moving window" from "the whole track is the heightmap", so the readout kept drawing the moving-window highlight at the playhead — describing streaming behaviour the terrain was no longer doing, and leaving the panel pixel-identical before and after a freeze. A `frozen` flag now drives the readout, which marks the entire track as the source, and the button reflects the state. Relatedly, changing **dB Floor** or **Contrast** while frozen silently dropped the terrain back to a moving window; those controls now rebuild the frozen heightmap instead.

### Changed
- **All 16 bundled presets regenerated against the current schema.** Presets are merged onto current state rather than replacing it, so a key a preset omits keeps whatever value it already had — meaning Curvature would have stayed on and bled into any preset applied after it. Every preset now carries the full Curvature block, with colour, weight, opacity and dash inherited from the first draw mode that preset actually uses (or, for presets that draw no lines at all, a stroke chosen to read against their background), so enabling the mode after applying one looks coherent rather than defaulting to black on a dark theme. The round-trip also picked up `view.renderScale`, added in 0.7.7 but never backfilled into the presets. Three dead keys were dropped: `style.showRawTerrain` in *Abyss* (the same style-vs-view confusion as the bug above, inert because the view value wins the merge), and five `particle*` keys from a retired particle system that no longer has a single reference in `src/` yet survived every round-trip, because merging them into state meant they were written straight back out on save.
- **`npm run update-presets` uses the same browser as the test suite** (`channel: 'chrome'`, as pinned in `playwright.config.js`) instead of Playwright's bundled Chromium, which is not installed by this project's setup — the script failed at launch before this.

## [0.8.0] - 2026-08-04

### Added
- **Soundscapes — audio as a terrain source.** A new sidebar section takes an MP3 (or WAV / OGG / M4A), decodes it, and analyses the whole track once into a spectrogram off the main thread: Hann-windowed STFT at 75% overlap over a dependency-free radix-2 FFT, with log or linear frequency binning and peak-hold within each band (averaging washes out the narrow partials that read as terrain). Playback then *streams* a scrolling window of that spectrogram into the heightmap store — the same slot a PNG or GeoTIFF occupies — so every existing tool applies unchanged: all thirteen draw modes, the overlays, erosion and every exporter. Transport is play/pause/stop with a seekable readout, and the raw spectrogram is drawn in the panel with a playhead plus a highlight marking the slice currently feeding the terrain (click or drag to seek). Analysis values are stored as dB over a *fixed* range, so **dB Floor** and **Contrast** re-slice the stored result per frame instead of re-running the FFT; only FFT size, frequency scale and bin count re-analyse. **Freeze Whole Track** pauses and writes the entire track as one static heightmap (time axis peak-held to ≤1024 columns) for the tools that need a terrain that holds still — erosion, STL and SVG. Loading a raster releases the soundscape so audio never drives a heightmap it no longer owns. Documented in [docs/Soundscapes.md](docs/Soundscapes.md).
- **Playwright coverage for the new path** — analysis-to-heightmap, playback driving rebuilds *and stopping on pause*, freeze, raster hand-off, and two throughput guards, driven by a generated 6 s MP3 fixture (sweep + drone + bursts) whose spectrogram has verifiable structure.

### Changed
- **Rebuild requests are now coalesced instead of cancelled.** The worker was terminated on every superseding request, which is right for a slider drag over a huge terrain but catastrophic when requests arrive faster than builds complete: streaming at 30/s into 44 ms builds killed every single build and completed **0.2 rebuilds/s**. A newer request now queues (newest wins) and is sent the moment the running build returns. Termination is kept for a build that is a genuine outlier against the current cadence — `max(150 ms, 3× the last completed build)` — so a fixed threshold cannot reintroduce the same collapse at a heavier setting. Measured 0.2/s → 30.0/s at a 512² grid.
- **Contour chaining rewritten around integer grid-edge identity.** Segments were joined by stringifying coordinates into a Map key (`"12.5,7"`), rebuilding two more strings per walk step just to compare tips, allocating a `{c,r}` object per point, and extending chain heads with `unshift()` — O(n) per insert, so quadratic on long rings. Every crossing lies on a specific grid edge and adjacent cells derive a shared edge's crossing from the same corner pair, so an integer id identifies a junction exactly, with adjacency in two flat `Int32Array`s. Worst case at 512² with a 1-unit interval: **Close contours 312 ms → 37 ms**, smoothing 4 529 ms → 92 ms. Output is bit-identical on realistic terrain.
- **Smoothed contours are decimated with Douglas–Peucker.** Chaikin doubles the point count per pass, so 4 passes turn 444k segments into 7.1M — almost all of them under a pixel from the chord through their neighbours. DP now runs between passes (so no pass blows up) and once at full tolerance at the end, over reused ping-pong scratch buffers rather than a fresh allocation per chain per pass. **7119k → 179k segments (40×)** for a measured maximum deviation of 0.031–0.057 grid units, about 0.07 px on a 512-unit terrain. A cheaper greedy flatness test was tried and rejected: it only bounds error against adjacent points, so a gently curving contour looks locally collinear everywhere, all of it gets dropped, and the line drifts — 547× "reduction" into straight chords.
- **Surface normals and UVs are skipped when nothing shades the surface.** They exist only for the terrain shader — STL export derives its own facet normals and SVG needs just positions and indices — so with no fill layer on they were ~8 ms of pure waste per rebuild. Note the trade: `needsSurfaceShading` is now a rebuild dependency, so toggling a fill layer (Fill, Hillshade, Slope, Water, AO, Aspect) triggers one geometry rebuild where it previously triggered none. Individual fill *styling* params remain render-side and still rebuild nothing.
- **Soundscapes streaming rate defaults to 30/s and reaches 60/s**, at a 512 bins × 512 window default. Pacing is deadline-based rather than elapsed-time: ticks only arrive on rAF boundaries, so an elapsed test can only produce rates of 60/n and a request for 45/s silently delivered 30/s. Measured 30.0, 44.6 and 55.4 per second for requests of 30, 45 and 60.

### Fixed
- **The "Computing geometry…" overlay latched on permanently while streaming.** It was keyed on `isComputing`, which under a continuous stream never falls because the rebuild queue never drains — so the overlay appeared after its 1 s delay and stayed, covering a terrain that was in fact updating 30× a second. It now keys on frames actually delivered, so it appears only when the terrain genuinely stops updating.

## [0.7.8] - 2026-08-04

### Fixed
- **Loading an overlay texture disposed the terrain shader material and the heightmap DataTexture.** A single `useEffect` cleanup released `surfMat`, `overlayTex` and the heightmap texture but was keyed on only `[surfMat, overlayTex]`, so every overlay-texture change ran it against still-live resources — forcing a full shader recompile and a re-upload of the (float, full-resolution) heightmap on a control that should touch neither. Split into one cleanup per resource, each keyed on what it actually owns.
- **A failed file pick threw a `TypeError` on top of the error banner.** `load()` / `loadGeoTiff()` swallow errors and resolve `undefined`, but the pickers passed that straight to `.then(onLoaded)` and every callback destructures its argument. Both loaders now resolve `null` explicitly and the pickers gate `onLoaded` on it.
- **Two high-severity npm audit findings.** `postcss` (arbitrary `.map` file disclosure via `sourceMappingURL`) and `vite` (`server.fs.deny` bypass on Windows alternate paths) bumped to patched versions within their existing `^` ranges — no breaking changes.
- **Sun indicator leaked three GPU materials per toggle.** R3F only auto-disposes objects it creates from JSX; materials passed via the `material` prop are the component's to release. The gradient texture was likewise never released on unmount.

### Changed
- **The geometry worker is now persistent and caches the source raster.** Every param change previously terminated the worker, spawned a fresh one (re-parsing the 32 kB worker chunk) and structured-cloned the entire heightmap through `postMessage` — a 256 MB copy per rebuild for an 8k GeoTIFF, on a raster that does not change when a style slider moves. The worker now caches the pixels and the main thread ships them only when the loaded file actually changes; an idle worker is reused instead of respawned. Terminate-to-cancel is kept for genuinely in-flight builds, so responsiveness during a drag is unchanged. Measured on the default 1024² heightmap over 8 consecutive rebuilds: worker round-trip 930 ms → 780 ms, with per-rebuild cost falling from a flat ~120 ms to ~65 ms once the worker is warm. The saving scales with raster size.
- **`useTerrainGeometry` subscribes per field instead of calling `useStore()` bare**, so unrelated store writes (overlay texture, GeoTIFF metadata) no longer re-render it.
- **fsevents install scripts explicitly approved** (`allowScripts` in `package.json`) so macOS dev builds keep native file-watching instead of falling back to polling under npm's install-script gate.

## [0.7.7] - 2026-07-02

### Added
- **Supersampling control (View → Supersampling, 1×–2×).** Dense 1px line fields are denser than the pixel grid can represent, so they "boil" (shimmer/flicker) while panning or rotating — most visibly where lines cross. Measured attribution showed ~99.8% of the hard per-frame pixel flips come from this temporal aliasing (the depth-occlusion curtains contribute ~0.2%, so depth-bias tweaks don't help). The new slider renders the canvas internally at up to 2× the device pixel ratio and cut hard pixel flips during slow rotation by ~93% in measurement. Render-side only: dragging it never triggers a geometry rebuild, and it round-trips through presets like any view param.
- **MSAA alpha-to-coverage on line materials** for (near-)opaque lines — smoothstep edge alpha instead of a hard shader discard, giving properly antialiased dash caps and line edges. Translucent lines keep plain blending (coverage would dither their body alpha).

### Changed
- **Surface mesh normals and UVs are now computed in the geometry worker** and transferred zero-copy, instead of `computeVertexNormals()` + a UV loop on the main thread after every rebuild. That was the largest remaining main-thread stall (~160 ms at a 1024² grid, scaling with mirror octants); the worker-side normals match three.js output to 1e-15. Slider drags that rebuild geometry no longer hitch the UI on dense terrain.
- **Box blur rewritten as a separable sliding-window mean** (horizontal prefix sums + vertical rolling column sums). Mathematically identical to the previous integral-image blur (max deviation ~1e-7) at the same speed, but without allocating a `Float64Array((W+1)×(H+1))` over the full-resolution image — ~512 MB for an 8k GeoTIFF, now ~40% less peak memory.
- **Flow Lines no longer pre-allocates two worst-case `rows×cols×6` buffers** (~48 MB per rebuild at a 1024² grid regardless of how many segments the mode actually emits) — it now uses the same growable typed-array writers as every other builder. Output is bit-identical.
- **Perspective camera near plane raised from 1 to 5** (with `minDistance` on the orbit controls so free scroll-zoom stays clear of it) — 5× finer depth-buffer precision for the line-occlusion curtain system. The zoom slider's maximum still keeps the camera ≥50 units out, so nothing clips.

### Fixed
- **4K PNG export could exceed the GPU texture limit on very large windows** — the 4× capture scale is now clamped to the renderer's `maxTextureSize`, so the export degrades to the largest possible resolution instead of failing.

## [0.7.6] - 2026-06-17

### Fixed
- **Projected (UTM) GeoTIFFs loaded almost flat, needing a large manual elevation-scale boost.** The auto vertical-exaggeration heuristic classified the pixel size as geographic *degrees* whenever it was `< 1.0`, then multiplied it by 111,320 to "convert" to metres. For a projected CRS (UTM, Web Mercator, …) the pixel size is *already* in metres, and high-resolution / lidar data legitimately has sub-metre pixels — so a 0.5 m pixel was inflated ~111,320× to ~55 km, collapsing the suggested elevation scale to the `0.1` clamp floor and rendering steep terrain as flat. Degrees-vs-metres is now decided by the **CRS** (via the same geokey detection used for GPX projection), not by pixel-size magnitude: a geographic CRS still converts degrees→metres, while a projected CRS uses the reported metre pixel size as-is. The `< 1.0 ⇒ degrees` test is gone.

## [0.7.5] - 2026-06-15

### Fixed
- **File pickers accepted the wrong formats.** The PNG heightmap picker used `image/*`, so you could select a GeoTIFF (or JPEG) that then failed to load on the PNG decode path; it is now restricted to PNG. The texture picker had the same latent issue — it loads via `THREE.TextureLoader` (an `<img>` element), which cannot decode TIFF — and is now limited to browser-decodable raster formats (PNG, JPEG, WebP, GIF, BMP, AVIF). The GeoTIFF picker now also offers the `image/tiff` MIME type alongside the `.tif`/`.tiff`/`.geotiff` extensions. GPX (`.gpx`) and preset import (`.json`) were already correct.

### Added
- **Contour smoothing ("form lines")** — a Smoothing control in the Contours mode (0–4 Chaikin corner-cutting passes) turns the crisp marching-squares staircase into soft, flowing illustrative isolines. 0 keeps the exact original lines; higher values round the corners progressively. When smoothing or *Close contours* is on, each level's segments are chained into polylines, smoothed, and optionally ring-closed in a shared pass (the default still emits segments inline, so nothing slows down when smoothing is off). Smoothing does not apply to the Tanaka path.

### Changed
- All bundled presets regenerated to carry the new `smoothingContours` param (default 0 — no visual change).

### Changed
- **Crosshatch rectangles now close on the grid boundary** — previously the lines started at one grid corner and stepped by a fixed spacing, leaving a variable partial gap at the far edges (half-open rectangles along the right and bottom). Each crosshatch family now pins its first and last line exactly to the grid edges and nudges the step so a whole number of intervals spans the grid, so the cells close flush on all four sides. The requested spacing is honoured as closely as an integer interval count allows. Single-direction Lines mode is unchanged.

### Fixed
- **Crosshatch border lines missing at axis-aligned angles** — with the boundary-closing above, the edge lines sit exactly on the grid border, where the march direction's floating-point drift (`cos 90°` is `6e-17`, not `0`) accumulated along each line and pushed its samples just outside the `[0, cols-1]` bounds. At Angle 0 this clipped the entire left border line and part of the right, varying with heightmap size. The march direction is now snapped to exact `0/±1` at multiples of 90°, so the boundary samples land precisely on the inclusive edge and the border lines render fully.

## [0.7.2] - 2026-06-13

### Fixed
- **Scarlet Relief / Stone Relief presets silently disabled all draw modes** — both presets carried `"showLines": false`, a hidden master visibility switch over every line layer that had no UI control anywhere. After applying either preset, enabling any draw mode built geometry but rendered nothing, with no way back except Reset or another preset. The `showLines` param has been removed entirely (app state, preset apply, renderer gate, SVG export, and all 17 bundled preset files) — line visibility is now governed solely by the per-mode Enabled toggles.
- **GeoTIFF CRS detection never read the projection geokey** — `image.geoKeys` is undefined in the bundled geotiff.js, so `ProjectedCSTypeGeoKey` was never picked up (now read via `image.getGeoKeys()`) and CRS detection always fell back to the bbox heuristic. GPX overlays only worked when the UTM zone inferred from the track's longitude happened to match the file's zone; for files whose coordinates lie outside their nominal zone (e.g. zone 32 with eastings near 1,000,000), every track point clipped and the GPX layer silently vanished.

## [0.7.1] - 2026-06-11

### Added
- **Particles preset** — a pure pointillist take: an animated black hologram particle field (one mote per terrain cell, warm glow) over a white background, no line work or fill at all.

### Changed
- **Preset lineup reworked** (16 presets):
  - **Dark Survey renamed to Embers** — the dotted ember-red flow trails on a dark navy night never looked like a survey.
  - **Burnt Paper redesigned** around the new Engraving mode: slope-driven sepia cross-hatch plus fine charcoal stipple grain on the aged-paper background, replacing the previous lines + contours + fill combination.
  - **Coral Relief, Magma, and Aurora removed.**
  - Stone Relief moved next to Scarlet Relief in the preset list.
  - All presets regenerated through the live app; stripped a stray `shiftCross` key that the X/Y→Lines migration had introduced (Crosshatch has no shift parameter).

## [0.7.0] - 2026-06-11

### Changed
- **X Lines + Y Lines merged into a single "Lines" mode with a bearing angle** (13 draw modes total). The new mode draws parallel terrain-draped ridgelines at any angle: 0° reproduces the old X Lines exactly, 90° the old Y Lines, and everything between unlocks diagonal compositions that previously required external rotation of the heightmap. Lines sit at perpendicular grid positions `k·spacing + shift` along the rotated normal and are sampled in unit-cell steps with bilinear elevation interpolation (exact grid samples at 0°/90°). Elevation jitter works at any angle.
- **Crosshatch gains the same angle control** — it now draws the Lines builder at `angle` and `angle + 90°`, so the cross-grid can be rotated as a whole.
- **Param schema change**: `enabledX`/`spacingX`/`shiftX`/`colorX`/… and the `*Y` equivalents are replaced by `*Lines` plus `angleLines`; Crosshatch adds `angleCross`. All bundled presets were migrated: X-only presets became Lines @ 0° (Blueprint, Dark Sun, Neon City, Unknown Pleasures, Burnt Paper), and Alpine Survey's identical X+Y pair became Crosshatch (visually unchanged). User-saved preset files containing the old X/Y keys load without error but those layers no longer render — re-save the preset after re-enabling Lines.

## [0.6.1] - 2026-06-11

### Fixed
- **Hypsometric gradient unreachable without fill** — every draw mode offers hypsometric colouring, but the gradient editor only appeared in Terrain Style when *hypsometric fill* was enabled (the alternative `lineHypsometric` condition was a dead legacy key), so styling a mode's hypso colours required enabling fill first. The shared gradient editor (presets + stop picker) now renders directly inside each mode's Hypsometric panel — labelled as shared, since one global gradient drives fill and all hypsometric layers — and the Terrain Style copy appears whenever *any* hypsometric consumer is active, fill or not.

## [0.6.0] - 2026-06-11

### Added
- **Engraving draw mode** — copperplate-style illumination cross-hatch. Per-cell darkness is computed as 1 − Lambert shading from a configurable sun azimuth; up to four hatch layers at the base angle, +90°, +45°, and +135° draw only where darkness exceeds each layer's threshold, so lit slopes carry sparse single-direction strokes while shadows accumulate dense stacked cross-hatching. Strokes are continuous polylines marched across the grid at any base angle, draped on the terrain, and break wherever the surface is too bright. Controls: spacing, base angle, levels, sun azimuth, and a contrast (tone-curve) exponent.
- **Rock & Scree draw mode** — swisstopo-style alpine rock depiction in two sub-layers: cliff hachures (short downslope strokes perpendicular to the contours on cells steeper than the cliff threshold, with seeded hand-drawn wobble) and slope-graded scree dots on the band below the cliffs, denser toward the rock faces. Controls: spacing, cliff threshold, stroke length, scree density, and scree dot size.
- **Seeded randomness** — Stipple and Rock & Scree each get a Seed slider in their mode section. All stochastic geometry (Stipple jitter/density, cliff-stroke wobble, scree placement) now runs on a seeded mulberry32 PRNG instead of `Math.random()`, so a given seed always reproduces the identical pattern — essential for reproducing prints.

### Changed
- All presets round-tripped to carry the new mode/feature params with defaults.

## [0.5.8] - 2026-06-10

### Added
- **Abyss preset** — a drowned mountain range as a deep-sea sonar chart: Tanaka contours (sun-facing rims bright, shadow strokes thin and dark) coloured by a bathymetric depth gradient (abyss blue → teal → pale cyan → white summits) over a dark slate fill with directional hillshade, translucent depth-darkened water flooding the basins, ghost contour rings behind ridges, and an abyssal blue-black sky. The first preset to use water fill and Tanaka contours.
- **Particles section activity dot** — the Particles section header now shows the same green indicator dot the draw modes use when the hologram field is enabled.

## [0.5.7] - 2026-06-10

### Added
- **Aurora Borealis preset** — a midnight terrain under a northern-lights sky: drainage flow lines coloured by an aurora gradient (deep teal valleys → spring green → mint → violet → pale magenta-white peaks) over a near-black fill with faint multi-directional hillshade, dim-violet ghost lines glowing behind ridges, a navy horizon-glow background gradient, and a sparse field of animated cyan hologram motes drifting above the surface. The first preset to use the hologram particles, ghost occlusion, and multi-directional hillshade.
- **Particle spacing control** — new "Spacing" slider in the Hologram section sets the grid-cell stride between particles (1 = one per terrain cell, as before). Previously the field always spawned one particle per cell, which on a typical grid meant a ~260 000-point carpet that read as static noise and was the only possible density; sparse fields (and far lighter GPU loads) are now a slider away.

### Changed
- **Preset buttons now apply particle settings** — `applyPreset` only merged the `style` block and gradient stops, so no preset could enable or configure the hologram field. The `points` block is now applied too; since every preset carries `showPoints`, switching presets also correctly turns the particles off again.

## [0.5.6] - 2026-06-10

### Fixed
- **SVG export broken when zoomed in** — exporting while zoomed in produced an effectively blank SVG. The exporter projected *every* line segment through the camera and sized the document around all of them: geometry outside the canvas inflated the bounding box, and geometry **behind the near plane** projected to mirrored garbage coordinates millions of pixels out (a perspective-divide artefact), exploding the viewBox to absurd dimensions (observed: 3 490 267 × 1 174 252 px) in which the actual content was a sub-pixel sliver. The same behind-camera projections were rasterised into the software z-buffer, stamping wrong depths that could cull even on-screen lines. The exporter now clips segments against the camera's near plane, drops segments/dots/particles entirely outside the canvas (which also skips their 64-sample occlusion tests — zoomed-in exports are much faster and roughly halve in file size), rejects behind-camera and off-canvas triangles from the z-buffer, and clamps the final viewBox to the canvas rect. The export now always mirrors exactly what the viewport shows; zoomed-out exports keep their tight content crop unchanged.

## [0.5.5] - 2026-06-10

### Changed
- **Locked 60 fps camera interaction** — zooming in and panning around on the default terrain previously dropped to ~23 fps (and ~34 fps for rotation) at Retina resolution; all three interactions now hold a solid 60 fps with no frame over 18 ms. Three independent causes were fixed:
  - **Occlusion curtains anchored to the terrain** — every line segment hangs an invisible depth-curtain for hidden-line occlusion, and each one extended a fixed 500 world-units down regardless of terrain size. A curtain only ever needs to reach the lowest rendered content (`minZ`, minus `pillarDepth` when pillars are enabled), so it now stops there — cutting depth-only GPU overdraw roughly 10× for a typical ±50-unit terrain. Rendered output is pixel-identical.
  - **Throttled camera ⇄ state sync** — OrbitControls moves the camera directly, but every change event also pushed camera values into React state, re-rendering the entire app (sidebar included) up to 60×/s during a drag. The orbit → state sync is now a trailing 150 ms tick plus a final sync on gesture end, and state updates that are pure echoes of an orbit sync no longer snap the camera back mid-gesture. Auto-rotate drives the camera through a ref each frame instead of `setParams`.
  - **No-op surface pass skipped** — with fill disabled (the default) the surface mesh still rasterised the full triangle mesh through the heavyweight hillshade/AO fragment shader every frame while writing neither colour nor depth. The mesh is now skipped entirely unless a fill layer is active (or profile mode needs it as a raycast target).
- **Geometry builders rewritten on growable typed-array writers** — all 12 draw modes (plus GPX and the surface mesh) previously accumulated geometry in plain JS arrays via `push(...spread)` and converted to `Float32Array` at the end: megabytes of boxed doubles, GC churn, and a final copy on every rebuild. They now append straight into doubling `Float32Array`/`Uint32Array` writers and return subarray views with no final copy. Differential-tested bit-identical against the previous output across all modes, masks, mirroring, and colour settings.
- **Single-pass marching-squares contours** — `buildContours` and `buildContoursTanaka` re-scanned the entire grid once per contour level (O(levels × cells)). They now visit each cell once and only test the levels that can cross its value range (O(cells + segments)): **18× faster** standard contours and **16× faster** Tanaka contours at a 1-unit interval on a ~1 Mcell grid (759 ms → 41 ms / 766 ms → 47 ms).
- **Faster surface + mirror geometry** — `buildSurfaceGeometry` pre-counts valid quads and fills exact-size buffers instead of growing JS index arrays and re-concatenating per mirror octant (6–7× faster; 645 ms → 89 ms for 8 octants), and both the line and surface paths skip the octant copy loop entirely when no mirroring is active (the default).
- **Render-side params no longer rebuild geometry** — `showLines` and all fill/surface styling params (`showFill`, `fillColor`, `fillBanded`, `fillHypso*`) were in the worker-rebuild dependency list although the worker never reads them; dragging the fill colour spawned a full terrain + 12-mode + surface recompute on every tick. They are excluded now: fill edits react in ~25 ms, and a Reset that only touches render-side params completes in ~45 ms with no recompute at all.
- **Per-vertex colour sampling without allocation** — interpolated gradient samples inside the worker now come from a small rotating scratch pool instead of allocating a fresh `[r,g,b]` per vertex.
- **Dashed-line distances computed lazily** — `computeLineDistances()` (O(segments) on the CPU plus a fresh GPU buffer) ran on every weight/opacity/dash slider tick, twice per layer on the same shared geometry. It now runs at most once per geometry and only when a dashed style actually needs it. Forced material recompiles (`needsUpdate`) on plain uniform/render-state changes were removed alongside.
- **Particle home positions** are written into a pre-sized `Float32Array` instead of a growing JS array (runs on the main thread on every terrain change).

### Fixed
- **Pan position now persists** — `setParams` silently dropped the `panX`/`panY` keys the orbit sync sends after a pan. State could never catch up to the camera, which both re-fired the sync (and a full app re-render) on every subsequent orbit event forever, and snapped the pan back to centre on the next tilt/rotation/zoom change.
- **`benchmark.spec.js` Phase 4** updated for the new reset behaviour: a Reset that only touches render-side params legitimately triggers no worker rebuild, so the test now measures reset completion via the UI instead of requiring a rebuild log.

## [0.5.4] - 2026-06-06

### Changed
- **On-demand rendering** — the canvas now uses `frameloop="demand"` instead of redrawing 60 times a second whether or not anything changed. Frames are only drawn in response to actual state changes; the continuous animations that still need a live loop (auto-rotate, the hologram particle field, and WebM capture) keep it alive by calling `invalidate()` each frame. The particle loop additionally gates on `showPoints`, so a hidden-but-"animated" field no longer pins the renderer at 60 fps doing nothing. The result is a near-idle GPU (and far less battery/fan) whenever the scene is static.
- **Faster geometry rebuilds** — the mirror/octant expansion in `buildLineGeometry()` was rewritten to write straight into pre-sized typed arrays instead of growing JS arrays with repeated `push()`/`concat()`. Curtain quads are now built once into sized `Float32Array`/`Uint32Array` buffers and the per-octant copy is a single sized allocation filled by offset — eliminating the O(octants²) reallocation churn and the millions of `push()` calls a dense layer previously made on every rebuild.
- **Zero-copy worker transfers** — the geometry worker now transfers the curtain, lid, and terrain-grid buffers (the largest arrays in the payload) as Transferables instead of structure-cloning them on every rebuild. A `Set` guards against transferring the same `ArrayBuffer` twice.

### Fixed
- **Depth-occluder render order** — clarified and preserved the curtain occluder's place in the transparent render queue (it writes depth but no colour). Keeping it transparent ensures it renders after the transparent fill surface; promoting it to opaque would punch depth holes through the fill where curtains hang in front of farther terrain.

## [0.5.3] - 2026-06-01

### Changed
- **Hologram particle system** — the particle layer has been reworked from a CPU spring/gravity simulation into a GPU-driven holographic point cloud, adapting the technique from [cortiz2894/hologram-particles](https://github.com/cortiz2894/hologram-particles) (a WebGPU/TSL project) to erzberg's WebGL/R3F renderer. The old per-frame loop mutated and re-uploaded a `Float32Array` every frame; all motion now lives in the vertex shader, driven by a single `uTime` uniform, so the position buffer is uploaded once and never touched again. An inline 3D simplex-noise helper drives per-particle float plus two-octave fractal-noise displacement gated by a moving "scan" mask; the soft-glow look (bright core, glow-tinted halo, travelling scanline shimmer) is faked entirely in the fragment shader, so no post-processing pass is added and the SVG/PNG/STL export paths are unaffected. New params: glow colour, shimmer, float, noise amount/scale, flow speed, and reveal contrast.

### Removed
- Classic particle controls that no longer apply to the hologram field: spring noise/damping, gravity (+ strength), the mouse-interaction push/glow, additive-blend toggle, and peaks-&-valleys-only sampling.

## [0.5.2] - 2026-05-29

### Changed
- **Line style changes no longer rebuild geometry** — `weight`, `opacity`, and `dash` are purely render-side, so they are now applied directly to the `LineMaterial` (and read from live params by the SVG exporter) instead of being baked into the worker geometry. Dragging these sliders previously terminated the worker and rebuilt the terrain grid + all 12 draw modes + surface mesh on every tick; they now update instantly with no recompute. Resolved via a single `layerStyle(id, p)` source of truth in `geometryBuilders.js`.
- **Faster per-vertex colouring** — the gradient sampler used once per vertex inside the geometry worker no longer re-sorts the gradient-stop array and re-parses `#rrggbb` strings on every call. Stops are sorted/parsed once per build and hex colours are cached, cutting redundant work across the hundreds of thousands of per-vertex colour computations a rebuild performs.

### Removed
- Dead code: the unused `noise.js` value-noise module, an unused `sampleGradient` import, the unused `DASH_SVG` export, two unused Zustand store actions (`clearTextureImage`, `clearHeightmap`), and leftover Leva panel CSS.

### Fixed
- Renamed the leftover Leva-era parameter bridge (`levaGet`/`levaSet` → `getParams`/`setParams`) and corrected stale documentation (`CLAUDE.md`, `README.md`, `GEMINI.md`, store CRS comment).
- **`grid.spec.js`** updated to the current 1024×1024 default heightmap (it had assumed an obsolete 500×500 image and asserted the wrong grid dimensions).

## [0.5.1] - 2026-05-27

### Fixed
- **Blur slider resolution** — the Blur slider now responds to every 0.1-step increment. Previously, fractional radii were rounded to the nearest integer via `Math.round`, so values like 0.6 were indistinguishable from 0.5. Fractional blur is now computed by linearly interpolating between the two adjacent integer-radius box-blur passes.
- **Stipple dots missing from SVG export** — stipple dots are modelled as near-zero-length segments in 3D; the SVG exporter's sub-0.1 px segment filter silently dropped all of them. The exporter now detects the stipple layer (`isPoints` flag) and emits each dot as an SVG `<circle>` element instead, with radius proportional to the layer's weight. Depth occlusion and ghost opacity are respected.

## [0.5.0] - 2026-05-27

### Added
- **Multi-directional hillshade** — new "Multi-direction" toggle in the Hillshade section averages lambert from 8 evenly-spaced azimuth directions (Swiss-style). Eliminates directional bias; azimuth slider and cast-shadow controls are hidden while active.
- **Sky View Factor** — ray-marches the sky hemisphere from each surface point to darken valleys, gullies, and other concavities where surrounding terrain blocks the sky. Controlled by Strength and Rays sliders, nested inside the Hillshade section alongside Cast Shadows.
- **Tanaka contours** — "Tanaka illumination" toggle inside the Contours mode. Splits contour lines into thick bright segments (sun-facing slopes) and thin dark segments (shadow slopes) based on a configurable sun azimuth. Separate Bright Weight and Dark Weight sliders.
- **Aspect map overlay** — circular HSL hue-wheel coloring by terrain facing direction. N-facing slopes one hue, E another, etc. Opacity slider; runs as a fragment shader pass after hillshade.
- **Water fill** — flood all terrain below a configurable level threshold with translucent, depth-darkened water. Separate Level, Opacity, and Color controls.
- **Elevation profile** — Analysis section at the bottom of the sidebar. Click "Elevation Profile", then click two points on the terrain canvas to sample a 200-point bilinear cross-section. Displays an SVG chart panel with real metre labels when a GeoTIFF is loaded.
- **Hypsometric Integral** — stat row in the Terrain section showing HI = (mean − min) / (max − min). Inline help panel explains the geomorphological interpretation (> 0.6 young/rugged, ≈ 0.5 equilibrium, < 0.4 mature/eroded). Updates live when hydraulic erosion is applied.

### Changed
- All 16 presets updated to include new param keys with defaults.

## [0.4.6] - 2026-05-27

### Added
- **Scarlet Relief preset** — slope-driven red shading on a neutral warm-gray base. Flat areas remain gray (`#c8c2ba`); steep slopes grade to vivid red (`#d61900`) via full-opacity slope shading. No line work, no hillshade.
- **Magma preset** — thermal-glow hypsometric with near-black valleys (`#030201`) graduating through deep crimson → burnt orange → amber → near-white peaks (`#fffbe8`). Paired with a dramatic low-angle hillshade (22 °, exaggeration ×9, full cast shadows) and thin golden ridge lines (`#f8c840`, Hessian detection) tracing the crests against the dark terrain.

### Changed
- **Default view on startup** — opening tilt changed from 40 ° to 50 °; default zoom set to 75 % (user-loaded heightmaps continue to auto-fit to the viewport).
- **Default heightmap** — replaced with a higher-resolution sample terrain.
- Updated Dark Survey preset (flow lines: wider spacing, longer paths, dotted dash, aspect-based hypsometric colouring).
- Updated Swiss Topo preset (banded fill enabled, hypsometric weight set to 0).

## [0.4.5] - 2026-05-27

### Added
- **16-bit PNG heightmap support** — PNG files with 16-bit depth are now decoded natively, bypassing the browser canvas (which silently downgrades all images to 8-bit). The raw PNG bytes are parsed directly: IDAT chunks are decompressed with the browser-native `DecompressionStream` API (no new dependency), all five PNG filter types are reconstructed, and 16-bit samples are extracted at full precision. Supports grayscale, RGB, gray+alpha, and RGBA colour types; transparent pixels become NoData. Raises elevation precision from 256 to 65 536 distinct levels. 8-bit PNGs, JPEGs, and other image formats continue to use the existing canvas path unchanged.

## [0.4.4] - 2026-05-27

### Added
- **Elev min/max cut in 0.1 % steps** — the elevation cut sliders now move in 0.1 % increments (previously 1 %), allowing precise isolation of narrow elevation bands.

### Fixed
- **Depth occlusion disabled in several presets** — Alpine Survey, Coral Relief, Dark Survey, Ink Atlas, Stone Relief, and Teal Matrix all had `depthOcclusion: false`; corrected to `true`.

## [0.4.3] - 2026-05-26

### Added
- **Coral Relief preset** — hypsometric relief shading inspired by Aerialod-style renders. Teal valleys (`#00b8a8`) transition through cream to coral and deep terracotta at peaks, with strong directional hillshading, cast shadows, and a white background. No line work.

### Fixed
- **Gradient stop colour pickers opening in top-left corner** — the single globally-positioned hidden `<input type="color">` was placed at `top: 0; left: 0`, causing the OS picker to anchor there on every click. Each gradient stop now has its own `<input type="color">` rendered in-place inside its bar handle and swatch, so the browser opens the picker at the correct element position on the first and every subsequent click.
- **Preset export missing trailing newline** — exported `.json` preset files now always end with a newline character.

### Changed
- Removed USGS Classic preset.
- Updated Alpine Survey, Burnt Paper, Dark Survey, Ink Atlas, Swiss Topo, and Teal Matrix presets.

## [0.4.2] - 2026-05-26

### Fixed
- **Flow Lines: incomplete coverage at small spacings** — seeds were processed in row-major order, so early rows' flow paths masked downstream cells before they could be seeded. At spacing ≤ 1 this produced large empty regions in the lower half of the terrain. Seeds are now sorted by descending elevation before tracing begins: ridges and peaks seed first, their paths fill the terrain naturally from high to low, and only genuinely uncovered cells become secondary seeds.
- **Flow Lines: spacing slider 0.5 increments had no effect** — `lineStep` was computed with `Math.round(spacing / scl)`, collapsing pairs of consecutive 0.5-step values (e.g. 1.5 and 2.0) to the same integer. Replaced with a floating-point seed accumulator so every 0.5-step increment produces a distinct seed grid.
- **Flow Lines: hard segment cap** — a fixed `MAX_TOTAL_SEGMENTS = 3 000 000` constant caused the outer seed loop to abort early on dense settings, cutting off large parts of the terrain. The cap is removed; the occupancy mask mathematically guarantees `totalSegments ≤ rows × cols`, so the buffer is sized exactly to that tight bound.

## [0.4.1] - 2026-05-26

### Added
- **Sun ray indicators** — 14 line segments radiate from the sun orb sphere in all spatial directions (6 axis-aligned + 8 cube-corner diagonals), creating a starburst effect. Rays start just outside the core sphere and extend to ~4.5× the core radius. Same amber colour as the core (`#ffcc00`), 70% opacity, `depthTest: false` so they are always visible regardless of terrain geometry.

## [0.4.0] - 2026-05-26

### Added
- **Hillshade: ray-march cast shadows** — ridgelines now physically occlude sunlight. From each surface fragment a ray is marched across the heightmap toward the sun using progressive step sizes (linear stride growth) that give far-field reach within a fixed step budget. The shadow test compares the maximum horizon angle along the ray against the sun altitude, expressed in degrees so that the penumbra width is camera-independent. Controls: Darkness (shadow floor), Softness (penumbra width in degrees), Quality (step count 16–128×). Requires a loaded heightmap image.
- **Sun indicator** — an amber sphere and orange glow halo placed in the scene at the configured hillshade azimuth/altitude, toggled independently via **Show Sun**. Visible regardless of terrain depth (depthTest: false) and correctly sized relative to the terrain's geographic extent. Renders consistently on both light and dark backgrounds (saturated `#ffcc00` core with additive halo).
- **Elevation scale slider range widened** — upper and lower bounds extended from ±5 to ±10, allowing more dramatic vertical exaggeration on low-relief terrain.

### Fixed
- **Hillshade lighting direction wrong for non-90° azimuths** — the vertex shader was transforming terrain normals to view space (`normalMatrix × normal`), while the fragment shader computed `lightDir` in world space from the azimuth angle. The X axis happens to be preserved between the two spaces when camera rotation is 0°, which is why azimuth 90° appeared correct while 0°/180°/270° were wrong. Since the terrain group never rotates (only the camera orbits), model space equals world space; changing the vertex shader to `vNormal = normal` aligns both vectors and makes all azimuths correct.
- **Cast shadow V-axis flipped in heightmap texture** — `DataTexture` defaults to `flipY = false`, placing image row 0 (North) at UV V = 0 in GPU texture space, while the surface mesh UV convention has North at V = 1. This caused the shadow ray to sample terrain from the geographically reversed North/South side. Setting `flipY = true` on the DataTexture corrects the alignment. The bug was masked on symmetric test terrain (cylinders) but would have produced incorrect shadow lengths on north/south-facing ridges.
- **Sun orb not visible** — three independent bugs caused it to be invisible: (1) placement distance `halfExtent × 2.5 + 60` put the orb ~42° off the camera's centre, outside the 30° half-FOV; corrected to `halfExtent × 1.1`. (2) Core material lacked `depthTest: false`, allowing terrain to occlude it from behind. (3) Near-white core colour `#fffbe8` plus additive blending on a white background rendered as white-on-white; changed to saturated amber `#ffcc00` with normal blending.

## [0.3.7] - 2026-05-14

### Fixed
- **SVG export: fill enabled causes bloated files and missing occlusion** — when the terrain fill was enabled, the SVG exporter was projecting the entire surface mesh as individual `<polygon>` elements (one per triangle), making exported files enormous on complex terrain. Fill is now used purely as a depth occluder: the surface geometry is rasterised into the software Z-buffer so that lines behind the terrain are culled, but no fill polygons are written to the SVG output. The Z-buffer is also now built unconditionally when fill is enabled, regardless of the separate *Depth Occlusion* toggle.

## [0.3.6] - 2026-05-14

### Changed
- **Export filenames derived from uploaded file** — all exporters now use the uploaded heightmap's filename as the base name (extension stripped). For example, uploading `graz.tif` produces `graz.svg`, `graz.png`, `graz-alpha.png`, `graz.stl`, `graz-gpx.stl`, `graz.webm`, and `graz-heightmap.png`. Previously every exporter used the hardcoded prefix `heightmap`.

## [0.3.5] - 2026-05-12

### Added
- **SVG export loading indicator** — a spinner overlay ("Exporting SVG…") is now shown while the SVG is being computed. The export runs synchronously on the main thread; without a visual cue the UI appeared frozen for complex scenes. A `setTimeout` in the export effect yields to the browser so the overlay renders before computation begins.

### Changed
- **SVG export: dashed / dotted / long-dash rendered as real segments** — instead of relying on `stroke-dasharray` / `stroke-dashoffset`, each SVG line segment is now split into actual sub-segments covering only the "on" portions of the dash cycle. The existing cumulative-length `dashOffset` tracking keeps the pattern phase continuous across connected terrain lines. The exported file now faithfully matches the LineMaterial dash rendering in the viewport and is fully editable in Inkscape / Illustrator without any special SVG dash knowledge.

## [0.3.4] - 2026-05-11

### Fixed
- **Viewport not updating after contour param change on large files** — the geometry worker queued every intermediate slider value and processed them all sequentially. On a large GeoTIFF with 1 m contours each rebuild could take several seconds, so the correct final result sat deep in a backlog and the viewport appeared frozen. The worker is now terminated and restarted on every param change, ensuring only the latest value is ever computed. A generation counter (`_gen`) echoed through the worker message discards any stale result that arrives after a restart.
- **Major Weight slider visible when major contours are disabled** — the slider is now hidden when *Major Every* is set to 0 (None), consistent with how *Major Offset* is already hidden in that state.

## [0.3.3] - 2026-05-11

### Fixed
- **SVG export: dash / dotted / long-dash modes rendered as solid lines** — SVG resets the `stroke-dasharray` phase at the start of each `<line>` element. Because terrain lines are stored as many short connected segments, every segment started within the first "on" portion of the dash cycle and appeared solid. The exporter now tracks cumulative screen-space length along each connected chain of segments and writes `stroke-dashoffset` on every `<line>`, making the dash pattern flow continuously across the full terrain line — matching the `LineMaterial` behaviour in the live viewport.

## [0.3.2] - 2026-05-04

### Added
- **Open Graph & Twitter meta tags** (`index.html`) — `og:type`, `og:title`, `og:description`, `og:image`, and the matching `twitter:card` / `twitter:title` / `twitter:description` / `twitter:image` tags. Also adds a standard `<meta name="description">` for search engines. All descriptions open with the tagline "Digital terrain artistry."

## [0.3.1] - 2026-05-04

### Fixed
- **PNG / SVG exports re-triggered after settings change** — `activeCamera` was listed as a dependency of the SVG, PNG, and PNG-α `useEffect` hooks in `Scene.jsx`. Because `activeCamera` is a plain local variable (`p.orthographic ? orthoRef.current : persRef.current`) it gets a new object reference on every render; any settings change that caused a re-render after a trigger counter had been incremented re-fired the export effect and downloaded an unexpected file. Removed `activeCamera` from all three dependency arrays — the closure already captures the correct camera from the render that incremented the trigger, so there is no staleness risk.

## [0.3.0] - 2026-05-04

### Added
- **GPX Track overlay** — load a `.gpx` file when a GeoTIFF is active to render the GPS track as a coloured line on the terrain. The "GPX Track" sidebar section appears only when a GeoTIFF is loaded (geographic extent is required). Controls follow the same style stack as every draw mode: colour, line weight, opacity, dash pattern, and full hypsometric colouring by elevation.
- **Geographic coordinate projection** (`src/utils/geoCoords.js`) — converts WGS84 lat/lon to terrain world-space for any of the common GeoTIFF coordinate systems: EPSG:4326 (geographic, pass-through), EPSG:3857 (Web Mercator), EPSG:326xx / EPSG:327xx (all 120 standard UTM zones, WGS84 Transverse Mercator formulas), and an `EPSG:projected-unknown` fallback that infers the UTM zone from the point's longitude. Includes bilinear terrain-elevation sampling for surface-snapping.
- **GPX parser** (`src/utils/gpxParser.js`) — browser-native `DOMParser`-based parser with no added dependencies. Collects `<trkpt>` elements from all `<trk>/<trkseg>` chains; falls back to `<rtept>` if the file contains only a route.
- **GPX in SVG export** — the track appears automatically as a named Inkscape layer in exported SVGs (it is a standard `lineGeo` layer and participates in the existing depth-occlusion pipeline).
- **GPX ribbon in STL export** — when a GPX track is present, a second file `heightmap_gpx.stl` is downloaded alongside `heightmap.stl` for multicolour 3D printing (Bambu Studio / PrusaSlicer: import both, assign different filaments). The ribbon is 2 world-units tall and 6 world-units wide. Each segment is an independent closed rectangular prism (12 triangles, all 6 faces) so the mesh is unconditionally manifold.

### Fixed
- **GeoTIFF CRS detection** — `ProjectedCSTypeGeoKey` is now read directly from `image.geoKeys` regardless of `GTModelTypeGeoKey`, which is absent or unreliable on many real-world files. A bbox-value heuristic (coordinates outside ±360° / ±90°) provides a further fallback for files that lack geokey metadata entirely. Previously, projected GeoTIFFs (e.g. Austrian/Alpine UTM files) were silently mis-classified as EPSG:4326, causing GPX coordinates to map to the wrong location.

## [0.2.14] - 2026-04-29

### Fixed
- **PNG export colours darker than viewport** — three.js r152+ no longer applies `outputColorSpace` (sRGB conversion) when rendering to a `WebGLRenderTarget`, so exported pixels were in linear colour space. Image viewers interpret PNG bytes as sRGB, making the result appear darker than the live view. Adding `colorSpace: THREE.SRGBColorSpace` to the render target opts back into the sRGB output conversion, matching the main canvas.

## [0.2.13] - 2026-04-29

### Fixed
- **Pan X / Pan Y sliders not updating viewport** — `p.panX` and `p.panY` were missing from the `updateCameraFromSliders` `useEffect` dependency array in `Scene.jsx`.
- **Camera reset incomplete** — Reset button now restores `zoom`, `fov`, `panX`, and `panY` in addition to `tilt` and `rotation`. `orthographic` mode is intentionally preserved.

### Changed
- **Keyboard shortcuts trimmed** — removed `W/A/S/D` (pan), `Y/X` (tilt), `E/R` (rotate), `T` (camera reset), `G` (guides). Remaining hotkeys: `Q` (toggle auto-rotate), `1` SVG, `2` PNG 4×, `3` PNG α, `4` STL, `5` WebM.

## [0.2.12] - 2026-04-29

### Fixed
- **PNG export: scene cropped at top** — replaced the `gl.setSize` / `gl.setPixelRatio` resize approach with a `WebGLRenderTarget`. The old approach created an intermediate framebuffer at `targetSize × devicePixelRatio` before resetting the DPR to 1, which on retina displays produced a buffer up to 2× the intended size that could be silently clamped by the GPU, cutting off the top of the scene.
- **PNG export: lines too bold** — `linewidth` is no longer scaled during capture. The LineMaterial shader formula `pixels_wide = linewidth × targetH / resolution.y` reproduces the same on-screen pixel width as the live viewport when only `resolution` is updated to match the render target dimensions. Previously scaling by `captureScale = 4` made lines 4× bolder at 100% zoom.
- **PNG export: particles blurry in live viewport after export** — removed `uSize` mutation during capture. The point-size shader already handles depth-based scaling; mutating the shared material reference caused visible size bleed into the next live frame.
- **PNG export: lines pixelated / no antialiasing** — added `samples: 4` MSAA to the `WebGLRenderTarget`. Three.js resolves the multisampled buffer to the target texture automatically at the end of `gl.render()`, so `readRenderTargetPixels` receives the antialiased result without an extra blit pass.
- **Default heightmap loads at resolution 2 instead of 1** — the mount-time load now calls `autoResolution` in its `.then()` callback, matching the behaviour of user-initiated loads.

## [0.2.11] - 2026-04-29

### Fixed
- **No UI feedback on broken / oversized GeoTIFF** — loading failures previously swallowed the error silently (console only). A dismissible red banner now appears at the bottom of the screen with a friendly message. Out-of-memory (`RangeError: Array buffer allocation failed`) shows "File is too large to load in the browser. Try a smaller or lower-resolution GeoTIFF."; invalid elevation data shows "GeoTIFF contains no valid elevation data."; all other errors surface the raw message as a fallback.

## [0.2.10] - 2026-04-29

### Added
- **Contours: Close contours** — new toggle in the Contours mode that closes open contour lines at the heightmap boundary. When enabled, the marching-squares segments for each elevation level are first chained into polylines, then any open endpoints on the grid border are paired by clockwise position and connected via a border-walking path (inserting grid corners where needed). Pairing is per-level and uses the planar winding argument — consecutive clockwise border endpoints at the same elevation always bound the same region, so the algorithm never connects endpoints from different elevation levels.

## [0.2.9] - 2026-04-29

### Added
- **Texture blend modes** — six GPU blend modes for the texture overlay: Normal (previous behaviour), Multiply, Screen, Overlay, Soft Light, and Add. Implemented as a `uniform int` branch in the surface fragment shader with no CPU overhead.
- **Texture opacity** — 0–100% opacity slider for the texture overlay. Multiplies the texture's own alpha channel so both controls compose correctly.
- **Texture scale extended** — minimum scale lowered from `0.1` to `0.01` (step `0.01`), allowing 10× more texture repetitions for high-res tiling.

## [0.2.8] - 2026-04-29

### Fixed
- **Rotation slider unresponsive after selecting Top view preset** — spherical coordinate singularity at `tilt = 0°` caused `setFromSphericalCoords` to collapse the azimuth term, placing the camera at `(0, dist, 0)` regardless of rotation. Clamping `phi` to `≥ 0.001°` keeps the `lookAt` cross product non-degenerate so rotation works correctly at top-down.
- **Main thread blocked during geometry rebuild** — geometry state updates from the Web Worker were applied as urgent React renders, blocking user input (e.g. rotation slider) for up to 8 s on heavy recomputes. Wrapping the worker `onmessage` state updates in `startTransition` marks them as low-priority background work, so React can interrupt and process user input immediately.
- **Auto-resolution grid target updated** from 1000 × 1000 to 1024 × 1024 cells, aligning with power-of-two texture sizes.

### Changed
- Upgraded `three-mesh-bvh` from `0.7.8` (deprecated) to `0.9.9` — the latest version compatible with three.js `0.184.0`.
- Added `data-testid="sidebar-toggle"` to the sidebar toggle button; performance test now uses attribute-based selectors instead of fragile text matchers.

## [0.2.7] - 2026-04-28

### Added
- **Brand identity** — new ErzbergMark: a terraced-mountain logo inspired by the real Erzberg open-pit mine profile, rendered as 12 horizontal line segments grouped into 4 terrace bands. Amber `#E8823A` on dark `#131210`.
- **Logo** (`public/logo.svg`) — horizontal lockup: ErzbergMark + "erzberg" wordmark in Space Mono 700 with tagline. Transparent background.
- **Favicon** (`public/favicon.svg`) — redesigned using the same ErzbergMark viewBox and strokeWidth as the logo so line proportions are identical at all sizes. Transparent background.

### Changed
- Sidebar "erzberg" wordmark updated to **Space Mono 700**, `-0.02em` letter-spacing, warm off-white `#F0EBE3` — matching the Dark/Iron logo variant.
- Texture section button renamed from "↑ Upload Image" to "↑ Load Image" to accurately reflect that files are opened locally, not sent to a server.
- README: added privacy statement (*everything runs locally in your browser — no server, no upload, no account*) and logo image.

## [0.2.6] - 2026-04-28

### Added
- **Slope Shading** — new surface overlay that tints the terrain by steepness. Blends a configurable two-colour gradient (flat → steep) over the existing fill with an opacity slider. Works standalone or combined with hillshade and fill.
- **SVG layer export** — exported SVGs now wrap each draw mode in a named `<g>` group with `inkscape:groupmode="layer"` metadata. Opening the file in Inkscape or Illustrator shows each mode as a separate, independently editable layer.

### Changed
- "Creative" section in the sidebar renamed to "Mirror".

### Fixed
- Suppressed spurious Vite chunk-size warning caused by Three.js and GeoTIFF libs exceeding the default 500 kB threshold. Raised `chunkSizeWarningLimit` to 1500 kB to reflect the expected bundle weight.
- Texture overlay now shows an amber warning in the sidebar when Fill is disabled, since the texture is not rendered without an active fill pass.

## [0.2.5] - 2026-04-28

### Added
- **Pillars: Cuboid and Cylinder shapes** — the Pillars draw mode now supports three shapes selectable per-mode: Line (original), Cuboid (rectangular prism with 12 wireframe edges), and Cylinder (N-gon prism, configurable polygon segments). Both 3D shapes include a closed solid lid on the top face rendered as a filled mesh. Size controls the cross-section as a fraction of spacing; Segments controls polygon resolution for cylinders.
- **Pillars: Lid Color** — independent colour picker for the solid top-face lid on Cuboid and Cylinder pillars, defaulting to white.

### Changed
- Stipple draw mode renamed to "Stipple Dots" in the sidebar.

### Fixed
- Resolution slider could not be set below the auto-safe minimum after loading a file wider than 1000 px. The safety clamp now applies only on the render where new pixels arrive (the race window), not on subsequent user-driven slider changes.

## [0.2.4] - 2026-04-27

### Added
- **Stipple draw mode** (mode #12): stochastic dot-density map driven by slope, elevation, or their inverses. Each dot is placed on a jittered grid and accepted with probability proportional to the chosen terrain attribute raised to a configurable gamma exponent. Exposed controls: Spacing, Gamma, Jitter, Density mode, plus the full per-mode colour / weight / opacity / dash / hypsometric stack.
- **Hillshade**: GPU surface shader that computes Lambertian illumination from a configurable sun direction (azimuth + altitude). Blends over the existing fill colour with adjustable intensity, opacity, and normal exaggeration. Separate colour pickers for highlights and shadows allow full tonal control (e.g. warm orange highlights + cool blue shadows for painted-relief aesthetics).

### Fixed
- Stipple mode parameters (`spacingStipple`, `stippleDensityMode`, `stippleGamma`, `stippleJitter`, and all hypsometric sub-params) were missing from the `useTerrainGeometry` dependency array, so the viewport did not update reactively when they changed.

## [0.2.3] - 2026-04-25

### Added
- Auto-resolution on file load: the geometry grid is capped at 1000×1000 cells automatically. Resolution is preserved across Reset.
- Benchmark test suite (`tests/benchmark.spec.js`): measures GeoTIFF parse time, display time, rotation responsiveness, colour reactivity, and full-reset recompute time, with per-phase screenshots.
- Timing instrumentation: `[Benchmark]` and `[Perf]` console logs in `useHeightmap`, `useTerrainGeometry`, and `SurfaceMesh` for test-driven performance measurement.

### Changed
- Elevation scale on GeoTIFF load: the GeoTIFF-derived scale is now applied internally. The UI slider shows an additive offset (default `+0.0`) rather than the raw multiplier, keeping the control range human-scale regardless of the file's intrinsic elevation ratio.
- Zoom on file load: the fit-to-screen zoom is stored as a baseline; the UI always shows 100% after loading any file. The zoom slider and OrbitControls both adjust relative to that baseline without interfering with each other.

### Fixed
- Race condition on large GeoTIFF load: the geometry worker could fire with the previous (uncapped) resolution before the terrain state update committed, causing an `Invalid array length` crash for images whose pixel dimensions exceed the default grid limit. The worker now derives a safe resolution directly from the pixel dimensions in the Zustand store before dispatching.

## [0.2.2] - 2026-04-22

### Fixed
- Contour interval anchoring: precisely identifies and renders 0.0 m elevation levels.
- Shoreline tracing: contours now accurately trace the boundary of terrain (NoData handling).

## [0.2.1] - 2026-04-22

### Fixed
- Line weights and particle sizes in 4K PNG exports now match the visual thickness seen in the viewport.

## [0.2.0] - 2026-04-22

### Added
- Dedicated camera section with orthographic projection, focal length (FOV) control, and precise X/Y target panning.
- Content-based centering and auto-zoom for GeoTIFFs and PNGs (ignoring NoData and transparent areas).
- Omnidirectional occlusion via refactored bi-directional curtain geometry (360° tilt support).
- Dynamic browser tab titles based on current filename.
- Terrain fill disabled by default.

## [0.1.0] - 2026-04-21

### Added
- Eleven algorithmic draw modes for topographic feature extraction.
- Curtain-based ghost occlusion for line-to-line depth ordering.
- Droplet-based hydraulic erosion simulation.
- Export suite: 4K PNG, SVG, STL, heightmap PNG.
