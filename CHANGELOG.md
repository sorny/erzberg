# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.12.0] — 2026-09-04

### Added

- **A shut panel section now states its own setting.** The panel has fifty
  sections and 371 controls over 6 577 px of scroll, against a viewport that
  shows 880 px of it. A closed section used to say its name and nothing else, so
  the tidiest possible panel was also the blindest one: the only way to learn
  that Hillshade was lit at 315° was to open it, and the only way to learn which
  four of the thirty-one draw modes were drawing was to scroll past all
  thirty-one.

  Each header now carries a readout on the right, read off the same state the
  controls inside it are bound to. Hillshade says `315° · 60%`. Terrain Style
  says `hypso · mesh`. Vector Layers says `2 of 3`. Off is an em dash rather
  than the word, because the eye skips a dash and lands on the values, which is
  what turns fifty rows into the handful that are doing something. Close
  everything and the panel is 2 337 px and describes the whole plate.

  A draw mode shows its dial as a bare number. `MODE: CROSSHATCH` and
  `every 10` do not fit in a 272 px panel together, and the half that got cut
  was the section's own name. The label the number lost comes back on hover.

  Export, Analysis and Hydraulic Erosion say nothing at all. They are actions
  rather than settings and hold nothing that survives being closed, and a dash
  there would say that they were switched off, which is a different thing.

  No control moved, no control changed shape, and no section changed position.
  The strings ride the same context that already carries each section's search
  vocabulary, so `Section` looks its own line up by title and not one of the
  fifty call sites in `Sidebar.jsx` was touched.

  Fifty hand-written strings are fifty things that can drift when a parameter is
  renamed, which is the same failure the search index carries and has hit once
  already. `tests/unit/section-summary.test.js` checks the two indexes against
  each other in both directions — a section with no readout, and a readout with
  no section — and asserts that each string moves when the parameter under it
  moves.

- **Export says what the SVG will contain.** One line above the buttons: *SVG
  writes the full canvas*, or *SVG cuts at the frame ↑*. The export cuts at the
  paper frame rather than hiding what falls outside it, so a switch two stages
  away in Frame decides what you get, and nothing else in the panel said so.

  It carries no count. The stats block prints the segment total a few rows
  below, and one number in two places is one number that can look like two.

- **Three sections that could be switched on now say so.** Terrain Style,
  Texture and Mirror all had a value in their header and no green dot beside the
  name, while every other section that can be on had one. The dot is lit by the
  section's own readout now rather than by a second expression next to it, so
  what the header shows and what the dot claims cannot disagree.

- **The head counts what you have composed.** One standing line under the
  wordmark: `4 marks · 3 inks · 2 layers`. Thirty-one draw modes compose
  freely, and nothing on screen ever said how many were drawing — you counted
  green dots down 2 239 px of scroll, or you did not know.

  The ink count is a count of pens rather than of settings. Two modes in the
  same black are one pen. A separation carries a lettered set and contributes
  all of it, and where a mode has both a lettered set and a base colour only
  the lettered ones reach `geometryBuilders`, so the base is not counted as a
  pen nothing draws with. Watershed generates one ink per basin while the
  geometry is built, so there is nothing to name and `inksShed` is the count.

  It is a readout and not a set of links. Every token would want a different
  target and "3 inks" has no single one. The panel already has a filter for
  going somewhere; this is for knowing where you are.

- **Thirty-one draw modes now fit on one screen.** The modes were the largest
  thing in the panel and the least visible: thirty-one sections over 2 239 px,
  each a header that says a noun. The new Draw Modes index is a grid of the
  marks themselves, 188 px for all thirty-one, at the head of the Marks stage.
  The glyphs are not new — `panel/modeMarks.jsx` has drawn every one of them
  since the section headers got icons, one per header, where only one is ever on
  screen at a time. `mark` moved onto `DRAW_MODES` so both views read the same
  fact.

  It is not a layer stack. Nothing reorders, nothing is dragged, and no mode
  becomes a record in a store: a tile reads `style.enabled<Id>` and writes
  `style.enabled<Id>`. The tile and the section's own switch are two views of one
  boolean, which is what separates this from a duplicate control — there is no
  second piece of state that can drift.

  Switching a mode on also opens its section and scrolls to it, because turning
  one on is the first half of tuning it. Switching one off does not: you are
  done with it, and jumping to a section you just dismissed would be the tool
  arguing.

### Changed

- **The panel is in pipeline order, under six stage rules.** *Source, Surface,
  Marks, Overlay, Frame, Output* — each a heavy line that sticks to the top of
  the panel while you are inside that stage. Every section belongs to exactly
  one, and the order is the order the renderer runs them in.

  The order it replaces was the order the sections were written. View and Camera
  sat between Levels and Terrain Style. Mirror sat after Texture. Hydraulic
  Erosion — a source operation — sat at position 48, immediately before Export.
  Nothing was wrong with any one of them, and there was no way to predict where
  the next one would be. Now there is: jitter changes the source, so jitter is
  in Source, and that reasoning works for a control you have never opened.

  A stage rule names its stage and nothing else. A count there would be the
  third counter in the panel — a shut section already states its own setting,
  the Draw Modes header already counts the modes, and the standing line already
  counts the plate.

  Six `position: sticky` siblings in one scroll container do not hand over to
  each other: each stays pinned until its own containing block leaves, and with
  one container that is the whole panel. Measured, Source, Surface and Marks
  were pinned at the top together. Each stage is its own block now, which is
  what makes the next rule push the last one out of the way.

- **Presets is first, and closed.** It is the front door, so it opened by
  default — from tenth place, where 2 346 px of thumbnails sat between the
  surface sections and the draw modes and everything after it had to be scrolled
  past. It is now the first thing under the loaded file, shut, with the style it
  applied named on a permanent line in the head. That is the same
  discoverability for sixteen pixels instead of two thousand.

  Together with the stage rules, the panel opens at **4 678 px** rather than
  6 577 px, with more of it legible: fifty readouts, a plate line, thirty-one
  marks in a grid, and six headings that say where you are.

## [1.11.1] — 2026-09-02

### Fixed

- **A test, not the app.** Nothing here changes what erzberg draws or exports.

  `contour-labels.spec.js` looked for "Labels" in the *display* name of the pen
  layer that carries the elevation numbers. That name is `Contours · Heights`,
  because the control is called "Label heights" and "Labels" reads as a layer of
  labels rather than as the heights themselves. The assertion went red when the
  pen layers gained human names in 1.10.0, and it stayed red for two releases. It
  read as a missing layer the whole time, while the export was correct:
  `layer-Contours-Labels` was there, with 29 `<text>` elements in it.

  Both names are pinned now. The id is what a script matches on. The label is
  what a person sorting a plot by pen reads.

  Nothing pinned the display names at all, which is how a rename reached an
  end-to-end regex before anything nearer the change caught it.
  `tests/unit/layer-names.test.js` covers `layerDisplayName`, so the next rename
  fails against a name rather than against a layer that looks gone.

## [1.11.0] — 2026-09-02

### Fixed

- **The SVG wrote inks that the screen never showed.** The `<Canvas>` comes from
  React Three Fiber, which gives it ACES filmic tone mapping and an sRGB output
  encode, and neither is overridden. Every fragment the renderer draws passes
  through both. The exporter wrote the raw number, so the file and the viewport
  disagreed. They disagreed most where a colour was bright and saturated, because
  that is where the tone curve does the most work. Jet's top stop is `#800000`, and the screen
  shows it as `#ca0006`: a deep red in the tool, a brown in the file.

  `screenInk` applies the same two steps to every ink that the file carries.
  Measured against the running app, exact on every channel:

  | picked | on screen | SVG before | SVG now |
  |---|---|---|---|
  | `#800000` | `#ca0006` | `#800000` | `#ca0006` |
  | `#00cce6` | `#85dcde` | `#00cce6` | `#85dcde` |
  | `#66cf00` | `#c3db50` | `#66cf00` | `#c3db50` |
  | `#ffffff` | `#e2e2e2` | `#ffffff` | `#e2e2e2` |

  Black maps to black, so plain black-on-white line art is unchanged. That is why
  this stood for so long. The background is written raw, because it arrives
  through `setClearColor` and is not tone mapped: white paper stays `#ffffff`
  while white geometry renders `#e2e2e2`.

### Added

- **The area modes export filled polygons.** Indexed, Mineral and Watershed paint
  blocks of colour, and a fill is not a stroke. They left the SVG as unordered
  boundary edges: enough to look at, and nothing to plot, because Inkscape had no
  closed shape to select and its hatch-fill tools had nothing to work on.

  `fillCells` now also ships the lattice that it painted, and `traceAreaRings`
  walks that into closed rings by boundary following. Each ink gets its own
  Inkscape pen layer, named with its hex — `Watershed · ink 03 #e04f2a` — holding
  one closed `<path>`. The line layer for that mode is dropped, because a traced
  ring is the same boundary edges in order.

  The lattice is keyed by **ink**, not by the region that the mode counts by.
  Watershed deals ten inks to the catchments that survive the fold, so two
  neighbouring basins often hold the same colour. Keyed by region they traced as
  two shapes with a shared seam and a doubled stroke: 31 189 of them on the
  reference plate, against the ten flat areas that the screen shows.

  A catchment with a lake in it keeps the lake. The winding puts the region on
  the right of every edge. An outer ring comes out clockwise and a hole
  counter-clockwise, and both are subpaths of one `<path>`. The path carries
  `fill-rule="evenodd"`.

  The fills follow the **Occlusion** switch rather than a new control. With it
  on, a cell whose centre fails the same depth test the lines use is dropped, and
  the ring closes along the silhouette. With it off, every area comes out whole —
  a map rather than a view, which is the file to plot from. The cut edge is a
  cell boundary, so it steps at the lattice pitch.

  A mirrored scene has no lattice, because the lattice describes one octant. Such
  a scene falls back to the boundary lines, which are mirrored with everything
  else.

  Measured on the reference plate: Indexed 6 pen layers and 0.33 MB, Mineral 5,
  Watershed 10. The export takes 0.4 s.

## [1.10.1] — 2026-09-02

### Fixed

- **The panel header.** Five things shared one row 248 px wide inside its
  padding, and they did not fit: "Reset all" wrapped onto two lines, which is
  what made the header look broken rather than tight. Undo and redo tipped it
  over, but the row was already carrying a name, a version, a link and a
  destructive button.

  Identity now has a line and the actions have another. Undo and redo share one
  border, because they are a pair and read as one control. The two glyphs became
  drawn arrows: `↶` and `↷` render as thin hooks, at whatever size and baseline
  the font decides. In a bordered box that looks like a stray pen mark. The new
  header is the height that the wrapped one had already reached.

- **A fresh load offered an undo of the look that it opened on.** The app applies
  its opening preset from an effect on mount, and that is a state change like any
  other. The history recorded it, and the first press of undo left bare defaults. `clear()` now carries its intent across the commit that prompted it.
  A clear on its own empties the stack a moment before the entry that it is meant
  to disown gets pushed.

## [1.10.0] — 2026-09-02

### Added

- **Undo and redo.** Two hundred and fifty parameters and no way back: a slider
  nudged past the good value was gone. `⌘Z` and `⌘⇧Z` now work anywhere outside a
  text box. The buttons sit beside *Reset all*, because a shortcut that nobody is
  told about is a feature only its author has.

  It covers everything that the panel can change: the four parameter objects,
  both gradients, the text layers, the vector layers and the coordinates that
  those layers point at.

  A drag is one step. The panel emits a change per frame, and one entry per frame
  means forty presses to cross one slider. Changes that arrive inside the
  coalescing window thus belong to the same gesture.

  `⌘Z` is the one chord that the app takes, against the rule that every shortcut
  is a bare key. Undo is where that reasoning runs the other way: `⌘Z` means undo
  *in the application* on every platform and in every editor. Inside a text box
  it still belongs to the browser, so a typo in a text layer is taken back on its
  own.

### Fixed

- **Pen layers in the SVG were named after the internal ids.** A stream network
  exported as "Dag", reticulation as "Retic", a watershed as "Shed". Every
  multi-pen mode also carried a stray separator from the regex that spaced out
  the capitals: "Contours- Minor", "Swiss- Scree", "Riso- A".

  The names now come from the mode registry, with the separator that the vector
  layers already used: "Contours · Minor", "Rock & scree · Scree", "Riso · Ink
  A". The label on a pen layer is the only thing that the person at the plotter
  reads, so it is worth being a name.

### Changed

- **The hidden pass is a pen layer of its own.** It used to be a second group
  inside the layer of the visible pass, which reads as one pen with two
  opacities. It is not one: a hidden stroke carries its own colour and its own
  opacity by definition. On paper it is a different pen, or a pass to delete
  before plotting, and either decision needs it separable.

## [1.9.2] — 2026-09-01

### Fixed

- **Reset all now resets everything.** It meant six state objects: terrain,
  style, particles, view and the two gradients. The vector layers and the free
  text were not among them. A reset thus left a fetched province of roads, an
  uploaded track and a typed title on top of bare defaults. That is the
  one state the label of the button says it does not produce.

  The Undo puts all of it back, and for the vectors that means both halves: the
  style records *and* the coordinates that they point at. One without the other
  is a layer list that draws nothing.

  The Overpass response cache is deliberately kept. That is where this differs
  from the clear that runs when a new raster is loaded: there the cached
  responses are keyed to an extent that can never be asked for again, while here
  the raster has not moved. Keeping them makes fetching the same layers back
  instant.

## [1.9.1] — 2026-09-01

### Fixed

- **A high-severity `browserslist` advisory.** 4.28.2 to 4.28.8, with the five
  data packages that come with it. Nothing user-facing changed: the declared
  ranges in `package.json` are untouched, so this is a lock-file move inside them.

  The advisory never reached anybody. `browserslist` arrives only through
  `autoprefixer` and `eslint-plugin-react-hooks`, both of which are build-time,
  and it appears in no file in `dist/`. Both reports also need input that a local
  build does not have: a hostile `browserslist-stats.json`, or an unbounded
  stream of distinct queries.

  It is fixed anyway. A known advisory in the tree is a thing to answer, rather
  than to explain every time somebody runs an audit. `caniuse-lite` feeds
  autoprefixer, so the emitted CSS was the one thing at risk of moving. Every
  one of the 19 built files is byte for byte what it was before.

## [1.9.0] — 2026-09-01

### Added

- **A fetch says how far along it is.** The wait has three phases and only two of
  them can be measured, so the panel reports each one for what it is.

  Between the POST and the first byte there is nothing at all: no length, no
  bytes, not even a status. Overpass withholds response headers until the query
  has finished running. On a province that stretch is most of the wait. It
  reports as indeterminate, with the elapsed time against the budget of the
  server. A bar that sits at 0% for ninety seconds and then races to the end says
  the wrong thing about which part is slow.

  Once bytes arrive they are real progress. The body now reads through a stream
  reader rather than in one call. Overpass sends chunked and rarely declares a
  length, so the count pre-flight supplies the denominator instead, at about
  1.1 kB an element. `JSON.parse` after it is one blocking call that cannot be
  subdivided, so its label is set before it runs rather than animated through it.

### Changed

- **A roll never turns on a murmuration.** A flock is a decision about the scene
  rather than about the drawing. A hundred thousand animated boids with a roost,
  an updraft and an optional predator is not a look that you arrive at by dice.
  Rolled at random it was the one thing that people switched off again. The
  hologram still rolls: a static point cloud in the shape of the terrain is the
  same kind of decision as the rest of a roll.

  No seed changed. The particle draws were the last consumers of the random
  stream. The drawing, the palette and the background of every previously rolled
  seed are thus identical. Checked over 600 seeds: 26 of them used to roll a
  flock, and each one now rolls a hologram instead.

- **Race Line reaches 250 drop-ins.** It stopped at 20. Measured on a 512×512
  grid, 250 drop-ins cost 85 ms, which is the same band as the screened ink
  modes. Each drop-in blanks a radius of Spacing around itself, so that the braids
  do not all start on one summit. A high count thus needs a low Spacing to have
  anywhere to put them. Ask for more than the terrain has room for and you get
  what fits.

### Removed

- **Exploded Frame.** The lattice and the bracing rule went with it, because
  nothing else used them. A comment claimed that Section shared the lattice, and
  the call sites said otherwise. Section is unaffected and now stands on its own in
  the mode documentation.

  A preset that enabled it draws nothing for that layer. No bundled preset did.

## [1.8.0] — 2026-09-01

### Added

- **Text layers.** A contour letters its own height and a peak letters its own
  name. Both are derived: the string comes from the data and the place comes
  from the feature. Neither can put a title on a plate, name a valley that the
  survey never named, or sign it.

  A text layer is that same lettering with the derivation removed. You supply
  the words and the place. Everything else is what a point label already had,
  because it is the same code. That is the four Space Mono faces or any of the
  49 stroke faces, bold and italic, size and alignment. It is also the two
  offsets, the fill with its own colour and opacity, and the outside stroke.
  The plane that it stands in follows the camera, or takes a Tilt and a Spin of
  your own.

  Add as many as you want. Each one is a layer with its own ink, so a recolour
  costs a frame rather than a rebuild. They stack and reorder by drag, exactly
  as the vector layers do. The app appends them last, which is what draws them
  in front of the plate that they annotate. Each one leaves the SVG as real
  `<text>` in its own named pen layer. A plot thus stays separable by pen, and
  the words stay editable in Inkscape.

  Two decisions worth knowing. Placement is a fraction of the plate rather than
  a world coordinate, and the app samples the ground under it. A title placed on
  a summit thus stays on that summit when the resolution or the exaggeration
  moves. A text also restores with the session, but is deliberately absent from
  a *preset*. A preset is a look and travels to the rasters of other people,
  while the words that you typed are content. That is the same line the app already
  draws for hidden features and uploaded icons.

### Changed

- **The pipeline documentation names the lettering pass.** Four passes run
  between the worker and the renderer, and none of them was in the diagram. They
  are on the main thread because a face is fetched rather than computed, and the
  worker has no fonts. An SVG icon also needs a rendered document to flatten. That placement is also what makes size, lift and orientation cost a
  frame rather than a rebuild.

- **`useStackDrag` and `GripIcon` moved out of `Sidebar.jsx`.** Two stacks use
  them now, and a shared control imported from the file that renders both is a
  cycle. The hook lives in `panel/stackDrag.js` rather than beside the
  components, because a hook in a components file breaks fast refresh.

## [1.7.0] — 2026-09-01

Colour. Every draw mode until now took its colour the same way: one scalar, into
one shared gradient, sampled once per vertex. These five break that in five
different places.

### Added

- **Five colour modes.**

  **Indexed** makes colour a lookup rather than a sample. Two terrain quantities
  index one small palette: elevation tier by slope class. A snowfield and the
  cliff beside it thus get different inks. A one-dimensional ramp cannot do that,
  because both of them are high. Between two adjacent entries there is no blend but a
  4×4 Bayer screen, and the checkerboard reads as a colour the palette does not
  contain. It is the dual of Bitplane: that mode quantises geometry and leaves
  colour continuous, this quantises colour and leaves geometry continuous.

  **Outrun** is the first thing in the tool that adds light instead of ink. A
  wide dim halo composites additively under a near-white filament, so where
  contours crowd the halos sum and the ground between them lifts. The two halves
  must be two layers: `layerStyle` resolves one width per layer, so a fat halo
  under a thin core is impossible in one. The halo needs a dark background,
  because additive light cannot darken anything. The filament composites
  normally, so the mode is still legible on paper.

  **Riso** is three spot inks, each carrying a different reading of the terrain,
  each screened at its own angle and multiplied together. Every colour past the
  first three is one the machine never held. Two controls decide which machine
  you are printing on. **Registration** above zero is a duplicator and at zero is
  a press. **Coverage cap** drops the weakest ink per cell once the three of
  them want more than it allows. That is why an overloaded press goes flat in
  the shadows.

  **Mineral** classifies the ground into five materials by slope and curvature,
  and gives each one a flat colour and its own grain. Colour means a rock type
  rather than a height, the way a geological sheet reads.

  **Watershed** labels every cell with the sink that it drains to, and gives each
  catchment one flat ink. The divides are ridgelines, which is why they look
  drawn rather than imposed. Stream Network already walks this graph to
  accumulate flow. This reads the same walk for identity instead of for volume.

- **Speed, as a hypsometric axis.** The descent family carries a velocity that
  nothing outside it can reach. It is a fourth choice beside Elevation, Slope
  and Aspect. Every other mode passes no speed. There the axis falls back to
  slope, rather than a draw of the whole layer at one end of the ramp.

- **Blending on line layers.** `AdditiveBlending` appeared exactly once in the
  whole codebase before this, on the sun indicator. Line layers now take a
  blending mode, which is what Outrun and Riso are built on.

### Fixed

- **The descent family drew a speed ramp and called it Slope.** Fall Line, Berms,
  Air and Race Line filled the second slot of `computeVertexColor` with velocity.
  The button marked Slope thus inked those four modes by speed, and only those
  four.
  Speed has its own name and its own slot now, and Slope in those modes is slope.
  A preset that uses one of the four with a hypsometric Slope tint looks
  different after this change.

- **A layer with fills and no strokes was dropped in silence.** The sub-layer
  dispatch skipped anything with an empty `positions` array, which was correct
  while every layer had strokes. The renderer dropped it a second time. Three of
  the new modes are area and no line, and produced nothing at all.

- **Area-fill cells fought the terrain surface in the depth buffer.** A cell is
  flat at its own elevation while the surface between cells is interpolated, so
  its corners are inside the hill. The lid material carried a positive depth
  bias. That is right for a pillar cap above the ground and wrong for a cell in
  it. Turning Occ. Dist up appeared to fix it because that control
  pushes the *terrain* back, not the cells forward. Surface-hugging fills take
  the bias an area fill takes, so they are correct at any Occ. Dist.

- **Occ. Dist reaches 50.** It was capped at 25.

- **The area modes exported an empty SVG.** The exporter reads strokes and never
  looks at fills. Each cell edge where the ink changes is now a real stroke. The
  plot is thus the outline of each region rather than of each square, and each
  stroke carries the base ink of its region. Measured on the sample plate: Indexed
  plots 6 inks, Mineral 5 and Watershed 10.

- **Surprise me moved under the cursor.** A roll is a preset, and applying one
  opens and shuts every mode section to match. That changes the height of the
  panel, and near the end of the scroll the browser clamps `scrollTop` and the
  whole column slides. Measured before the fix: 60 px of drift on half the rolls,
  which is a whole button. A scroll anchor holds the button still, and the
  sections still track the look.

## [1.6.3] — 2026-08-31

### Changed

- **The documentation is rewritten in Simplified Technical English.** Eleven
  Markdown files now follow ASD-STE100: `README.md`, the seven files in `docs/`,
  `docs/images/README.md`, `public/PROVENANCE.md` and `tests/testdata/README.md`.

  The rules are structural, not cosmetic. A descriptive sentence takes at most 25
  words, and an instruction at most 20. Every sentence is active voice in a
  simple tense. There is no `should`, `would`, `may`, `might` or `could` — only
  `can`, `must`, or the action stated directly. A condition comes before its
  command, and one instruction goes in one sentence.

  The vocabulary is fixed across all eleven files, and one word carries one
  meaning. **parameter**, never `config` or `settings` or `options`. **make sure
  that**, never `check` or `verify` or `ensure` or `confirm`. **show** for the
  interface, and **render** only for 3D geometry. **but** for `however`, **thus**
  for `therefore`, **because** for `since`.

  The facts are unchanged: the rewrite moves style, not content. Every measured
  number, file name and stated reason is the one that was there before. Code
  blocks, math blocks, tables and every internal anchor are unchanged too.

  Two things are deliberately out of scope. The licence files keep their exact
  text, because their own terms require it. British spelling stays. Rule 1.14
  asks for American spelling, but spelling affects nothing that the other rules
  exist to fix.

  This file is untouched. It records what shipped, written at the time that each
  version shipped. A rewrite of a released entry changes the record rather than
  the documentation.

### Fixed

- **`package-lock.json` recorded version 1.4.0.** Each version bump from 1.5.0 to
  1.6.2 changed `package.json` alone. The lock file thus went four releases out of
  date about the version that it locks.

  `npm install --package-lock-only` corrects the two fields, and it changes no
  dependency. That the diff is two lines is the evidence: the tree itself was
  already in sync, and only the version had drifted.

## [1.6.2] — 2026-08-31

### Fixed

- **The logo never rendered in its own typeface.** `logo.svg` asked a browser to
  fetch Space Mono from Google, and the README embeds it as
  `<img src="public/logo.svg">` — a context in which browsers refuse every
  external load, fonts included. Measured: opened as a document the file made two
  requests to Google and rendered correctly; inside an `<img>` it made none and
  fell back to `'Courier New'`. The wordmark has been a slab serif everywhere it
  is actually used.

  `npm run logo` flattens the text to outlines, from the same
  `space-mono-*.json` the 3D labels are lettered with. Nothing to fetch, nothing
  to fall back to, identical in a README, a browser tab and an editor — and
  *more* faithful than the text was: the browser hinted the `b` ascender to
  0.639 em where the font draws it at 0.700, which is where the outlines put it,
  to within a twentieth of a pixel. Run widths are unchanged.

  `og-image.svg` had the same dead import and gets the same treatment. The social
  card itself is `og-image.png`, a separate composition with the wordmark already
  rasterised into it, and is untouched.

## [1.6.1] — 2026-08-31

A licence-compliance pass over what the project ships and what it exports.
Nothing here is a feature; every item corrects something that was already
wrong.

### Fixed

- **The OFL text did not ship with the fonts it covers.**
  `public/fonts/single-line/LICENSE.txt` carried the copyright notices for the
  EMS, Relief SingleLine, Relief Pendot and DearPlotter faces and then pointed
  at somebody else's repository for the licence itself. OFL 1.1 condition 2
  requires each copy of the Font Software to contain "the above copyright notice
  **and this license**", and a pointer is neither. Space Mono's own copy was
  already correct and is unchanged — and, checked while in there: its copyright
  line reserves no font name, so the derived `space-mono-*.json` are free to keep
  the name.

- **No third-party notice survived into the bundle.** `dist/` is published to
  Pages, so it is a distribution of React, three.js, zustand, geotiff, lerc,
  pako and eighty others — every one of which asks that its notice travel with a
  copy. MIT says "included in all copies", BSD and ISC say it in their own
  words, Apache-2.0 §4 wants a copy of the licence. Minification strips all of
  them; measured, exactly one incidental match survived across every chunk.
  `dist/THIRD-PARTY-NOTICES.txt` collects them, and `build` generates it, so a
  `dist` without notices cannot be produced by accident.

  Six packages declare a licence and ship no copy of it, and for one that is not
  merely untidy: `lerc` is Apache-2.0 and does reach the bundle, and §4(a)
  requires giving recipients a copy of the licence — an SPDX identifier is a
  reference, not a copy. The text is taken from a sibling declaring the same
  identifier, which keeps the generator self-maintaining rather than carrying
  licence blobs that drift out of date.

- **Only the SVG credited OpenStreetMap.** OSM data is ODbL, and §4.3 attaches
  its notice to the *Produced Work* rather than to the application — so a plate
  posted as a PNG carried no indication of where its roads came from. Every
  export that can carry the credit now does: a `tEXt` chunk after `IHDR` in the
  PNG, the 80-byte header of the binary STL, a Matroska `Tags` element in the
  WebM. Nothing is drawn into the picture; a credit burned into the pixels is a
  change to the artwork, which is not something a licence obligation gets to
  make on the user's behalf.

  Two are narrower than the rest, deliberately. The STL **plate** is the terrain
  surface and never contains OSM data, so only the ribbons file is credited, and
  only when a layer that actually contributed a ribbon came from OpenStreetMap —
  which is not the same as an OSM layer being visible, since ribbons default to
  GPX. And the WebM says it out loud as well as writing it down: a container tag
  is read by `ffprobe` and by very little a viewer would open.

  The WebM's placement had to be measured, and the obvious answer was wrong.
  Chrome writes the Segment with an unknown size, so nothing records a length an
  insertion would invalidate — but that also means a demuxer has no length to
  seek against and no SeekHead to consult, and parses header elements only until
  the first Cluster. A `Tags` element appended to the end of the file is
  well-formed Matroska that **nothing reads**: ffprobe reported no tag at all
  until the element moved ahead of the first Cluster. A notice nothing reads is
  worse than no notice, because it looks like the obligation was met.

- **The app fetched a webfont from Google on every load.** Space Mono sets two
  words in the panel — the wordmark and Edit Mode's label — and came from
  fonts.googleapis.com. Licence-wise that was fine; it sat badly beside the
  promise that everything runs locally. The claim is about the user's *files* and
  stayed true, but "no server, no upload, no account" reads more broadly, and a
  request to Google reveals a visitor's IP whatever it is fetching. Self-hosted
  now, 9.6 kB, and a spec asserts the property rather than the implementation:
  loading the app issues no request to any host but its own.

### Added

- `npm run licenses`, which `build` runs. Scope is the production dependency
  closure; the dev tooling is not distributed and is not listed.
- `public/PROVENANCE.md`. `Heightmap.png` was the one asset with no stated
  origin — added in the first commit with no note, and its own metadata says
  only that Photoshop created it. A 1024×1024 16-bit greyscale plate is exactly
  what a real DEM export looks like, so an auditor cannot tell an original from
  something traced off Copernicus or swisstopo, both of which require
  attribution. It is original work. Recorded now, because the answer was only
  available by asking.

## [1.6.0] — 2026-08-31

### Added

- **Twelve new draw modes, from fifteen to twenty-seven.** The fifteen that
  existed were all a cartographer's marks — hachures, isophotes, Swiss rock,
  form lines. These read the same scalar field as something else: an arcade
  tilemap, a bare flashbulb, a snowboard, a braced steel frame.

  Twenty were built; seven were cut after being looked at in the app, and the
  pattern in what went is worth recording. Nothing was cut for being slow or for
  failing a test — every one of them worked. They were cut for describing
  something other than the ground: a signal, a display, a structure standing
  where the terrain is. The twelve that stayed all draw the mountain.

  - **Bitplane** — marching squares with the interpolation taken out. Where two
    cells land on different elevation tiers the shared cell *edge* is emitted
    whole and axis-aligned at the higher tier's height, so a curve becomes a
    pixel staircase; that refusal to interpolate is the entire difference from
    Contours. Between the plateaus, a 4×4 Bayer screen over the residual.
    Ordered dither is the wrong screen for a photograph and the right one here:
    a visible regular pattern is what a 16-colour ramp looks like shading a sky.

  - **Sprite Blocks** — the same quantiser drawn as blocks rather than as
    boundaries. Risers go to the *neighbour's* tier, not to a common floor:
    dropping every block to the base plate buries the stack in one mass of
    vertical lines, and what makes a voxel landscape legible is seeing exactly
    one riser per step, its height being the step.

  - **Flashbulb** — the first light in the tool that is not at infinity. Every
    other lit mode shares one convention (azimuth around, altitude pinned at
    45°, parallel rays), and parallel rays have no falloff. This puts a point
    light inside the scene, marches its shadows on the CPU at the same step
    count the surface shader uses, and grains the result with a 64×64
    void-and-cluster blue-noise tile — which carries a tone without printing a
    screen, the one thing that would kill a photograph. **Solarise** folds the
    tone curve for the Sabattier reversal.

  - **Halation** — blown highlights bleeding into the shadow beside them. What
    scatters is the *overexposure*, not the exposure gradient: on real terrain
    every ridge and gully is an edge, so a gradient-sourced bloom covers the
    picture instead of pooling beside the bright parts of it. Two inks — the
    grain with the bloom subtracted from it, and the halo itself — reading the
    blue-noise tile at a half-tile offset so they do not land on the same cells.

  - **Reticulation** — crazed emulsion. Worley cell *walls*, since the mark is
    the boundary between islands and not the islands: F₂ − F₁ < w over jittered
    feature points is nine bucket lookups per sample and yields an edge with
    thickness, which is what a crack has. A tone gate keeps it out of the
    highlights, which is what stops it being wallpaper.

  - **Fall Line, Berms, Air, Race Line** — descent with mass. Flow steps
    `p ← p − α∇H`: a massless particle that points exactly downhill, so it
    cannot overshoot, cannot bank, and stops when the gradient does. These
    integrate a *velocity*, under a yaw limit that means a fast rider physically
    cannot take a tight line. Fall Line draws the track and puts speed in the
    ink; Berms draw only the lateral load, so the straights vanish; Air draws
    the spans where the ballistic path clears the surface, on their true
    parabola; Race Line fans one drop-in into a braid and inks the fastest line
    heavier.

  - **Exploded Frame** — a braced space frame, pulled apart along Y with leaders
    back to place. A pin-jointed rectangular panel is a mechanism: it needs one
    diagonal, and *which* one depends on how it is being racked. The terrain's
    rack is its twist, so the bracing is placed by |h_xy| and oriented by its
    sign — a genuine reading of the ground rather than a texture over it. Three
    pens (chords, bracing, posts), so the SVG export separates by weight for
    free.

  - **Section** — the cut `elevMinCut`/`elevMaxCut` already performs, rendered
    as a drawing: heavy cut face in the plane, 45° hatch over the material
    below, faint outline for the ground beyond.

  - **Zero Crossings** — sign changes of the scanline after its own running mean
    is taken out. The density is the terrain's local *pitch*, which is neither
    slope nor curvature: dense on scree, empty on a glacier, however steep
    either is.

- **Seven new specs, thirty-one tests**, and the fields they run on were most of
  the work. A cone is the obvious test terrain and the wrong one for half of
  these — it is radially symmetric, so every descent runs straight down a fall
  line and Berms, Air and the carve slider all correctly do nothing on it.
  Ramp-then-flat isolates momentum; a rough field gives turns; a sharp step
  gives one lip and a plane gives none. The saddle that proves the frame's
  bracing had to be *H* ∝ (c−c₀)(r−r₀), because the saddle everyone reaches for
  first, x² − y², has h_xy = 0 and braces nothing at all.

### Changed

- **`SECTION_TERMS` moved out of `Sidebar.jsx`** into `panel/sectionTerms.js`, a
  leaf module with no imports, and `panel.spec.js` derives its expected section
  count from it instead of hard-coding one. The number was 33; adding modes made
  it 45, and a magic number was the weaker assertion anyway — it only ever
  caught a section that failed to render, never an index entry pointing at a
  section that does not exist. The leaf has to be import-free for the spec to
  use it at all, or importing the index would drag React and three.js into a
  Node-side test file.

- **`Sub` takes an optional label.** Flashbulb's bulb, tone, grain and shadow
  are four different questions, and thirteen unbroken sliders read as one.
  Existing call sites pass none and render exactly as before.

### Fixed

- **The architecture doc described a dependency list that no longer exists.**
  "Adding things" still named `useTerrainGeometry`'s hand-written array as step
  six and called forgetting it "the classic bug"; `src/params.js` had already
  replaced it with a key derived from `defaults.js`. Three places pointed at
  that array and now point at `GEOMETRY_KEYS`.

- **Both traps that replaced it are now guarded at import.** The rebuild key is
  built by *excluding* render-side params by regex, and several of those
  patterns are unanchored prefixes (`fill`, `point`, `pan`, `rotation`, `frame`,
  `texture`) because they must cover a whole family. A draw mode named
  afterwards can collide with one — `fillLines`, `rotationLines` and
  `pointSizeStipple` all match, all get classified render-side, and all give a
  control that moves while nothing happens. Separately, `geometryKey`
  concatenates into a string, so a non-scalar default stringifies to
  `[object Object]` however it is edited; that is why `gradientStops` is in
  `GEOMETRY_NON_SCALAR`, and nothing stopped a second one being added without
  it. `auditParamSpace` catches both at module load and is exported rather than
  inlined, so the specs can hand it a synthetic parameter space and prove it
  fires — a guard nothing ever proves catches anything is indistinguishable from
  no guard. It earned its place immediately: the render-side prefix list needed
  widening seven times as these modes arrived.

## [1.5.1] — 2026-08-28

### Fixed
- **Reset all is no longer overwritten by the preset the app opens on.** Reported
  against the deployed build: a reset gave bare defaults and then Alpine Survey
  a moment later. The opening preset is applied by an effect that waits for the
  preset files to arrive, guarded so it cannot land on input that got there
  first — but the guard was only set by *parameter* changes. The three paths
  that establish a whole look set neither of the two flags involved: Reset all
  cleared the preset tiles and left them alone, and Surprise me and loading a
  preset file both went through `applyPreset`, which deliberately does not mark
  its own work as an edit. The two flags were one question asked twice, which is
  how three call sites came to miss both; they are now one, spent by every path
  that establishes a look.

  It only showed once deployed because the 56 preset files were fetched in a
  sequential loop — one round trip each, imperceptible on a dev server and
  several seconds on Pages, all of it with a fully usable panel and the opening
  still in flight. That is the window being clicked through. They now load in
  parallel, which collapses it to roughly one round trip, and one unreadable
  preset costs its own tile instead of the other fifty-five.

## [1.5.0] — 2026-08-28

### Added
- **Erosion can be cancelled.** Hydraulic erosion is the third operation long
  enough to need a progress bar — 50 000 droplets by default, two million at the
  top of the slider — and it was the only one of the three with no way out. SVG
  and STL have shared an overlay, a progress channel and a Cancel all along.
  Cancel takes Undo's place while a run is live, since the two are never useful
  at the same moment. Abandoning is not reported as a failure and it disarms
  Undo: nothing was written, and offering to restore an identical raster is a
  promise about nothing.

- **A unit-test layer.** 87 tests over the modules that are just arithmetic — the
  box blur, area resampling, the bilinear tap, Douglas–Peucker, the projections,
  the layer-style cascade and the parameter registry — running in Node in about a
  third of a second. The end-to-end suite is right about what it covers, but it
  meant a deviation bound or a projection was only ever checked through a GPU, a
  dev server and a headed Chrome, eleven seconds into a spec. `npm run test:unit`;
  Playwright keeps `*.spec.js` and these are `*.test.js`, so neither runner can
  pick up the other's files.

### Changed
- **Clicking a control's label now works it.** Every row built a `<span>` for its
  label and handed the input an `aria-label`, so a screen reader was served but a
  pointer was not: clicking the visible word did nothing, on 10 px text. The
  label is a real `<label>` now. It deliberately wraps the text and not the help
  button beside it — wrapping the whole row would have made "what does this do?"
  also do it. Sliders also carry `aria-valuetext`, so a control the panel prints
  as `315°` is announced as `315°` rather than as `315`.

- **The rebuild contract is derived rather than transcribed.** Which parameters
  cost a worker rebuild was a ~180-entry array written out by hand, while the
  worker reads half of them through computed keys — so nothing could reconcile
  the two, and a draw mode added without touching the array got a knob that moved
  and changed nothing. It is now derived from the same registry that routes a
  parameter to its state object and asserts the four groups share no key. The
  derived set was verified identical to the array it replaces, 172 keys either
  way, before it was wired in.

- **The OpenStreetMap response cache is bounded.** It was a module-level Map with
  no cap holding raw Overpass elements — up to 400 000 each, the JSON of a whole
  valley — and every distinct query in a session stayed resident for as long as
  the tab lived. Responses now cap at three and counts at thirty-two, and both
  are dropped when a new raster makes them unreachable anyway.

- **GeoTIFF ingest reads one band and walks rows.** `readRasters()` decoded and
  allocated every band in the file when only the first is ever read — free on a
  single-band DEM, three times the peak on an RGB-packed one. The normalisation
  pass also computed a modulo and a division per pixel, before the branch that
  was their only consumer: 128 M integer divisions on an 8k raster, to maintain a
  bounding box.

### Fixed
- **A failed worker says so.** None of the four workers installed an `onerror`
  handler, so one that threw out rather than posting an error never reached
  `onmessage`. In the geometry hook that left the busy flag set for ever: the
  "Computing geometry…" overlay latched on, and only an unrelated parameter
  change tripping the cancel budget could clear it. Erosion sat on
  "Eroding… 0%" with no way back but a reload. The quieter half is that a failed
  rebuild leaves the *previous* picture on screen, which is exactly what a
  successful-but-subtle one looks like — so the two were indistinguishable.

- **A float DEM using −3.4e38 for voids no longer flattens the terrain.** The
  sentinel list held the positive float maximum but not the negative, and the
  other tests are `!isFinite` and equality with the file's declared
  `GDAL_NODATA`. A raster marking voids with the negative one and carrying no
  such tag read them as real ground 3.4e38 metres down; that single cell then set
  the normalisation range and flattened everything to a plateau. Magnitude is now
  the test, which covers both signs and every writer's variant at once.

- **A panel section header set `style` twice.** JSX keeps the last one and drops
  the rest silently, so a filtering-only cursor override never applied and the
  header went on offering a pointer over a control the filter had already made
  inert. The rule that catches this — `jsx-no-duplicate-props` — is now in the
  lint config, written out rather than installed, since the plugin that owns it
  stops at ESLint 9 and this project is on 10.

## [1.4.0] — 2026-08-25

### Added
- **OpenStreetMap over a whole province.** Fetching an extent the size of Styria
  did not work and could not have: the panel asked for every road class down to
  `footway` and every waterway down to `ditch`, over 16 000 km². Measured against
  the live API, that is about 1.2 million elements and a gigabyte of inlined
  geometry — past Overpass's own 180 s budget, past the 400 000 this can drape,
  and past what a tab can hold. It failed after minutes of waiting, and said only
  that it had failed.

  The extent now picks a **detail tier** by area (a 200 × 5 km valley is a small
  fetch, so area rather than the longer side). Under 2 500 km² nothing changes.
  Between that and 22 500 km² the footways, tracks, ditches and drains go, and
  only woods and lakes with more than a kilometre of shore are asked for. Above
  it, the trunk network, the rivers, the large woods and lakes, the peaks. Styria
  at that tier is 56 000 elements and 72 MB, which arrives in under a minute —
  and is the better sheet anyway, since every footpath in a province plots as a
  black smear. The tier is named in the panel, and one click overrides it.

  Two levers do the narrowing and both are server-side, because what matters is
  what is never sent: fewer tag values, and `(if:length() > n)` to drop small
  polygons and stubs by perimeter. 43 048 forest ways over Styria become 342 at a
  10 km perimeter, and the ones that survive are the forests you would draw.

- **A large fetch is measured before it is downloaded.** `out count;` runs the
  same search and answers with a number instead of a gigabyte, so an extent that
  cannot be draped is refused in seconds instead of after four minutes. Only when
  the answer is no does a second, per-category count run — it buys a refusal that
  names the offender, which is rarely the one you would guess: over Styria the
  heaviest category is not Buildings, which is already off by default, but
  Landuse & natural at 317 758 elements. Below 2 500 km² no count is run at all;
  a fetch that size has never been too large, and Overpass is a volunteer
  service.

## [1.3.3] — 2026-08-24

### Fixed
- **Contour levels are anchored to the ground, not to round world elevations.**
  The ladder started at the first multiple of the interval at or above the
  terrain's floor. World elevation is centred on zero and stretched by the
  exaggeration slider, so where that multiple lands has nothing to do with the
  terrain: on a full-range raster at exaggeration 1 the ground runs −50…50, and a
  30-unit interval put its lowest line 20 units up — two thirds of an interval of
  valley floor with no contour in it. Change the interval, or nudge the
  exaggeration, and the offset jumped to some other fraction of a step, so the
  lines reshuffled instead of subdividing, and the labels — documented as
  multiples of the interval climbing from 0 — read 1, 5, 9.

  Levels now sit at `min + k · interval`. The bottom band is exactly one interval
  thick whatever the interval and whatever the exaggeration, and the numbers are
  the slider's own. Level 0 is the floor itself: on solid ground it draws
  nothing, every corner being at or above it, and on a raster with NoData it
  draws the shoreline. Its threshold is tested a millionth of an interval below
  the floor, because *on* the floor a rounding error either way decides between
  nothing and a hairline traced around every cell at the minimum — which is
  exactly where a lake bed or a quarry floor is.

- **The contour interval slider says "(m)" and now means it.** It passed its
  number through as world elevation units, and a world unit is worth a metre only
  by coincidence: it is the raster's elevation range, clipped by the
  Shadows/Highlights handles, spread over 100 × the vertical exaggeration. On a
  641–2350 m alpine tile the slider's "4.0 m" was drawing contours 40 m apart —
  out by a factor of ten, and by a different factor on the next file.

  The metres are now converted, both ways: displayed from the stored value and
  divided back out of whatever is set. The interval itself is still stored in
  world units — what the marching squares threshold against, and what a preset
  written on a PNG means — so presets, sessions and the worker are untouched. The
  slider's range follows the raster as well, from about a thousand contours down
  to two, which is a usable slider on a 40 m quarry and on a 3000 m mountain.

  The exaggeration is part of that conversion, so moving it changes what the
  interval is worth on the ground and the readout follows the lines rather than
  pinning them. That is the existing behaviour of the interval, now legible
  instead of silent.

- **A contour label ignored the Shadows and Highlights handles.** The printed
  elevation mapped brightness back through the file's full range, but those
  handles clip and restretch it first — brightness 0 is wherever Shadows sits,
  not the file's lowest ground. Every number on a raster with the handles moved
  was wrong, and wrong by a different amount at each end of the range, which is
  precisely the error a reader cannot catch. Slider and labels now share one
  conversion (`metresPerWorldUnit` / `gridValueToMetres`), so they cannot drift
  apart.

- **An inverted terrain lost the contours on its steep ground.** The cell-major
  scan maps a cell's value range to a range of level indices, and read the low
  index off the low value. A negative exaggeration runs the levels *down* the
  brightness range, so the two came out crossed for any cell spanning more than
  one level: gentle ground still drew, cliffs drew nothing, and a full-range
  scarp drew nothing at all. The bounds are now ordered by index.

## [1.3.2] — 2026-08-24

### Fixed
- Dropped an unused loop binding in the single-line font build script, which
  `eslint` flagged; `respace` only ever touched the glyph values, never the
  character keys.

## [1.3.1] — 2026-08-24

### Fixed
- **A square-degree pixel is not square on the ground.** `gdalwarp -t_srs
  EPSG:4326 -tr 0.0005 0.0005` on an Austrian DEM gives a cell 55 m north–south
  and 37 m east–west, because a degree of longitude at 47°N is two thirds of a
  degree of latitude. Nothing about the file is wrong — every GIS draws it
  correctly — which is what makes it the renderer's job to notice.

  The mesh lays one world unit per pixel on *both* axes, so the country came out
  48% too wide, and the surface normals hillshade reads were tilted by the same
  factor. Contours, the STL and the SVG all inherit that grid.

  The correction therefore goes at the raster, before anything measures it. The
  cell's real shape is worked out from the CRS — degrees through cos(lat) for
  longitude and a near-constant 110 574 for latitude, projected units through the
  file's declared linear unit, so a US survey foot grid does not read as oblong
  — and the raster is resampled to whatever shape squares it up. Web Mercator
  needs no special case: its 1/cos(lat) inflation applies to both axes at once,
  so its cell stays square and only the ratio matters here. A 1% tolerance keeps
  already-square files off the resample path entirely.

  The *finer* axis is the one that shrinks. Stretching the coarser one instead
  would keep every sample, at the price of inventing detail along the other and
  paying up to 1/cos(lat) more memory for it — 1.5× in the Alps, 3× at 70°N —
  and nothing isotropic downstream could use resolution that axis does not have.

  The resample is an area mean rather than a nearest sample, because the Alpine
  ratio is 1.474 and divides nothing evenly: rounding to whole rows steps visibly
  on a ramp. NoData is kept out of the mean rather than averaged in — one -9999
  folded into a neighbour drags a real 1000 m cell to -4500 and takes the whole
  normalisation range with it — and a cell with no valid source at all comes out
  NaN, which every NoData test in the loader already rejects.

  The elevation-scale suggestion now reads the resampled column size rather than
  the file's, since squaring the pixel changed how much ground a column covers
  and that is the figure the suggestion turns on.

## [1.3.0] — 2026-08-24

### Changed
- **Isophote smoothing goes to 25 passes.** Worth knowing what that buys: the
  curve converges. Chaikin approaches a quadratic B-spline and each pass halves
  the remaining distance to it, so on the reference terrain total drawn length
  falls 16.4% between 0 and 2 passes and then by under half a percent all the way
  to 25, while cost climbs linearly — 32 ms at 4 against 343 ms at 25. Renders at
  4 and 25 are indistinguishable.

  The between-pass decimation holds segment count flat across the whole range, so
  nothing runs away; the extra passes are simply redundant rather than dangerous.
  **Detail** (`radiusIso`) is the control that actually makes a line broader,
  because it smooths the field before the light is measured off it rather than
  smoothing the trace afterwards. The help text now says so.

- **The SVG and STL exporters load on demand.** Both are pure opt-in paths and
  both are already called behind a deferred boundary with the progress overlay
  up, so there is no user gesture to lose. Entry chunk 1 447 → 1 427 kB raw,
  418 → 410 kB gzipped.

  That is a smaller win than expected, and the reason is worth writing down so it
  is not re-investigated. Measured from a sourcemap build: of 3 493 kB of source
  reaching the bundle, **three is 2 058 kB — 59%** — and React's runtime another
  12%. Both are needed on first paint, because the app is a canvas.

  three also cannot be trimmed from here. Since 0.16x it ships as two prebuilt
  files rather than per-class modules, and its exports map offers only `"."`, so
  the 725 modules under its `src/` are unreachable. As one enormous module it
  barely tree-shakes — `AnimationMixer`, `AudioListener`, `PositionalAudio` and
  `CubeCamera` are all in the output and nothing here uses any of them.

  Which puts the ceiling on splitting app code at roughly 4%. The flock and the
  audio pipeline are therefore left eager on purpose: a Suspense boundary inside
  the canvas and a ref through `React.lazy` is real risk in the most
  timing-sensitive code in the project, and it would buy two or three percent.
  The reasoning now lives in `vite.config.js` beside the raised warning limit,
  which says "this is expected" rather than silencing a problem.

### Fixed
- **The flock's beat impulse no longer scales with frame rate.** `burst` is an
  envelope rather than an event — it stays above zero for several frames after an
  onset — so a fixed kick on each of them added up in proportion to how many
  frames the machine happened to draw. Measured over one onset envelope:

  |            |  30 Hz |  60 Hz | 144 Hz |
  |------------|-------:|-------:|-------:|
  | before     | 1074.3 | 1995.2 | 4574.4 |
  | after      | 2148.7 | 1995.2 | 1906.0 |

  A 144 Hz display hit the flock 2.29× as hard as a 60 Hz one for the same music,
  against the 2.4× this was estimated at when it was first written down.

  The impulse is now scaled by the frame time, normalised to 60 Hz so the tuned
  values keep their meaning: 60 fps is unchanged and every other rate matches it.
  The remaining spread is discretisation — a rectangle sum of a decaying ramp
  sampled six times at 30 Hz against twelve at 60 — and shrinks as the rate
  rises. Edge-triggering would also have removed the dependence, but it turns a
  swell into a pop and would have meant retuning every burst value.

- **`detectBpm` no longer scores long lags on almost no evidence.** The
  autocorrelation divides by the overlap so long and short lags compare fairly,
  which stops being true once the overlap is small: the ceiling of
  `flux.length - 1` meant the longest lag averaged a *single* product and called
  it a correlation, so a clip barely longer than one beat period was handed a
  tempo decided by its own length. Every lag now correlates over at least half
  the signal. A clean 120 BPM pulse still reads 120.

- **Weave's Bands control no longer fights itself on the Onsets source.** An
  onset envelope is one number per frame, so every frequency sub-row of a lap was
  handed the identical value — and because the row budget is split
  `WEAVE_MAX_ROWS / bands`, asking for more of them bought duplicate rows at the
  price of laps. It did not merely do nothing there; it made the output worse.
  Pinned to one for that source, with the help text saying so. Unchanged for
  Energy, where bands are real.

### Added
- **Contour labels.** Each contour's height, printed *into* the line: the contour
  stops, the number sits in the gap at the line's own angle, and the contour
  resumes. Setting the number beside the line is what makes a page of nested
  curves unreadable, and it is the one thing this app's contours have never done.

  Placement runs in arclength along the chained stroke rather than per vertex, so
  labels do not bunch where marching squares happened to emit points closely, and
  each is nudged to the straightest spot in a window around it. A stretch still
  bent at its best is left unlabelled rather than mislabelled — the number sits
  on one baseline, and on a hairpin it would float off the curve it names.

  The work is split across the worker boundary because it has to be. Placing a
  label needs the contour as one chained stroke and breaking the line for it
  moves geometry, both worker work; naming the level needs the raster's real
  elevation range and drawing it needs a font, and neither exists in the worker.
  So the worker emits placements in world coordinates and `useContourLabels`
  letters them, the same division `useVectorLabels` already makes.

  With a GeoTIFF the label is metres. With a PNG it is height above the lowest
  ground — the world elevation is centred on zero, so using it would label half
  of an ordinary hill negative.

  Every contour at the label's level is erased inside the box the digits occupy,
  not just the one the label sits on. Reserving room by cutting the label's own
  chain *by arclength* leaves two ways for a line to end up across the number: a
  contour that hairpins comes back within a few units of the digits while being a
  long way off along the curve, and a different chain at the same level — the far
  side of a narrow ridge, the next ring in a tight nest — was never considered at
  all. On the reference terrain that put a line through 14 of 182 labels; it is
  now 0 of 182, with no placements lost.

  The numbers carry their own **colour**, resolved at draw time like any other
  layer's ink and defaulting to the contours' so they match their lines until
  told otherwise. This is the only draw-mode layer with a flat colour — every
  other is coloured per vertex from the hypsometric buffer, and lettering has no
  such buffer, because a number is not at an elevation the way the line it sits
  on is. Without one it fell through to `color || '#000000'` and came out black
  whatever the contours were set to.

  **Clearance** sets how much blank space each side gets, in the same world units
  as Size, replacing what was a hard-coded fudge factor. 0 lets the line run up to
  the digits; wider costs placements, because a contour that cannot hold the
  number plus its margin is left unlabelled rather than mislabelled — 182 labels
  at the default 4, 93 at 20.

  Outline faces export as editable `<text>` in their own pen layer; a stroke face
  letters its digits as strokes, the same bargain the vector labels take.

- **Isophotes — a fifteenth draw mode.** Lines of constant *illumination*. A
  contour joins points of equal height; an isophote joins points of equal light,
  which is the same construction over a different field and reads nothing like it
  on paper: the lines wrap the terrain the way a reflection wraps a polished
  object, bunching where the surface turns away from the sun and opening out
  where it faces it. Turning the Sun moves every line, which no other isoline in
  this app does.

  The Lambert field it traces is the one Engraving already hatches by, now shared
  rather than written twice. Where Engraving *thresholds* that field, this
  *traces its level set*.

  Two things the mode needs that Contours does not, both consequences of
  illumination being a **slope** rather than a height:

  - **A Detail radius.** A normal is a derivative of elevation, so the field
    inherits every cell-scale bump the DEM has and magnifies it — the same reason
    Ridge and Curvature blur before differentiating. Measured on the reference
    terrain, the level set runs to **1 386 994** segments at radius 0 and
    **87 372** at 6: the difference between a solid black mass and a drawing.
    The default is 6, and the control is exposed because crags and broad forms
    want different answers.
  - **A unit-cell drape.** An isophote is not level, so every vertex is draped
    onto the surface. Smoothing ends in a Douglas–Peucker pass which may replace
    a curve with a chord up to nineteen cells long, and such a chord is
    horizontally faithful while saying nothing about the ground beneath it — its
    two ends land on the surface and the segment cuts through the relief between
    them. Contours may decimate safely because a chord stays on the line. The
    walk now takes unit-cell steps: max span 18.79 cells → 1.41, one diagonal
    grid edge, and no plunging strokes at a clipped edge.

  NoData is a hole rather than a shoreline. Contours deliberately close isolines
  along the edge of the data, which is right for a coastline; there is no
  illumination where there is no ground, so an isophote drawn around a selection
  would be describing the selection rather than the terrain.


## [1.2.0] — 2026-08-23

### Added
- **Single-line fonts for vector labels.** 49 stroke faces, behind a **Use
  single-line font** toggle and a grouped picker on any point layer that letters
  its features.

  Every label face this app had was an *outline* font — Space Mono flattened to
  contours — so a plotted letter is the edge of the letter and the pen goes round
  each glyph twice, laying two lines down every stem and doubling them where
  strokes meet. A single-line face is the skeleton instead: the Hershey 'A' is
  three strokes to the outline 'A''s two closed contours. On the same pair of
  labels the SVG's label layer comes out **4.07× smaller** (14.7 kB against
  60.0 kB).

  The faces are the Hershey originals and Evil Mad Scientist's EMS conversions
  from [oskay/svg-fonts](https://gitlab.com/oskay/svg-fonts), plus the
  [Relief SingleLine](https://github.com/isdat-type/Relief-SingleLine) family —
  the last of these drawn as single-line from the start rather than converted,
  and carrying 423 glyphs against the collection's 216, which is the difference
  between labelling *Präbichl* and not. Relief ships in two cuts: the original,
  and Simon Cozens' **Pendot** fork, which redraws every dot in the font —
  periods, colons, i and j tittles, the accents built on them — as a single short
  stroke a pen can dab rather than a small circle it has to trace.

  Two more groups sit alongside them. **ISO 3098** — regular and italic — is the
  lettering standard for technical drawings, adopted in 1974: the only face here
  that was specified for exactly the kind of drawing this app produces, rather
  than drawn for something else and pressed into service. And three faces that
  were born on a plotter: the **Commodore 1520**, the four-colour ballpoint
  plotter sold for the C64, and the **Apple 410**, whose glyphs sit on a 16×16
  lattice — both recovered from the machines' own ROMs, so their letterforms were
  shaped by the same constraint this app exports for — together with
  **DearPlotter**, which was drawn for pen plotters on purpose rather than by
  necessity.

  Licences travel with the data in `public/fonts/single-line/LICENSE.txt`: the
  Hershey use-restriction requires its acknowledgement be distributed with the
  font data; the EMS, Relief and DearPlotter faces are SIL OFL 1.1; ISO 3098 is
  public domain; the Commodore 1520 is WTFPL and the Apple 410 MIT.

  Two faces needed work beyond reformatting. ISO 3098 is built from elliptical
  arcs — the standard defines the letterforms that way — so the build-time path
  parser learned SVG's `A` command, endpoint parameterisation and all. And its
  metrics had to be rebuilt rather than copied: the face reaches us from a
  specimen sheet on Wikimedia Commons, so all 319 glyphs share one inherited
  advance of 1100 units, which is the pitch of that sheet's grid. Against a mean
  ink width of 437 that set text as `E r z b e r g`. The standard specifies its
  own spacing in terms of cap height — letters `0.2h` apart, words `0.6h` — so
  that is what the advances are now, and the strokes are untouched.

  Unlike the outline faces, these are flattened at build time by
  `npm run fonts:single-line` rather than sampled at runtime. The runtime sampler
  would resample dead-straight strokes into hundreds of points only for
  Douglas–Peucker to throw them away, and would have to *guess* where subpaths
  break — which is the one thing a stroke font states outright, since every `M`
  in it is the pen lifting.

  Label fill is withdrawn while a stroke face is selected, and hidden in the
  panel: `labelFill` triangulates a closed contour, and a centre line encloses
  nothing.

- **Outline labels export as editable `<text>`.** Exporting an SVG with labels on
  used to write the lettering as paths, so a name could be re-coloured in
  Inkscape but never retyped or respelled. Each label now leaves as a single
  `<text>` element, in the face it was lettered in, positioned by an affine built
  from three projected world points — so a perspective label keeps its
  foreshortening without the size being computed twice.

  It is still stroked and unfilled, like every other layer in this export: the
  paths it replaces were the glyph outlines drawn in the label's own ink, and
  filling instead would drop the stroke colour and weight and turn a stroke-only
  label solid.

  Two honest losses against the strokes it replaces. A run is depth-tested at its
  origin only, so a name behind a ridge is present or absent rather than
  disappearing letter by letter — the same bargain the flock's streaks take. And
  a run whose origin falls off the page is dropped whole, where a stroke would
  have been cut at the boundary.

  This applies to outline faces only. A single-line face has no outline to
  reconstruct and no installed font to set it in, so it keeps exporting strokes —
  which is what a plotter wanted from it in the first place.

### Changed
- **The panel's spacing lands on a 4 px rhythm.** Twelve distinct margin values,
  seven gaps and twelve paddings, none of them chosen against the others — 6 px
  next to 8 px next to 5 px, because they were written months apart.

  Rounded to the nearest multiple of four, ties down, with 2 kept as a sub-step
  for hairline gaps. Ties round down because this panel's problem is length
  rather than airiness: thirty-two sections over three and a half thousand
  pixels, so where the scale was ambiguous the tighter step is the better
  default. Margins go from twelve values to five, gaps from seven to three, and
  the panel tightens by 48 px.

  The injected CSS is deliberately untouched: it carries control geometry — a
  3 px track inside a 19 px box, a 20 px help target, the thumb's −5 px margin —
  which is mechanism rather than rhythm.

## [1.1.1] — 2026-08-22

### Fixed
- **A clicked slider now shows that it is armed.** The focus ring was on
  `:focus-visible`, which withholds it until the first keypress — but clicking a
  slider already arms it for the arrow keys, so the state was real from the click
  and simply invisible. The moment you most need to know which of thirty-one
  sliders an arrow will move is the moment right after clicking one, which was
  exactly when the panel would not say. The original reasoning — that a pointer
  user dragging does not need a ring — is true of a drag and false of a click,
  and the click is the one that leaves state behind. Clicking anywhere else
  clears it, as before.

  The colour wells and section headers stay on `:focus-visible`: neither arms
  anything for the keyboard the way a slider does, so the original argument still
  holds for them.

## [1.1.0] — 2026-08-22

*Released together with 1.1.1; 1.1.0 was tagged in the
working branch but never deployed on its own.*

A UI pass over the panel and the picture it frames. The panel's shape is
unchanged — same 272 px column, same thirty-two sections, same order — and
nothing here touches GIS, projection, worker, rendering or export logic.

### Added
- **The app opens on a look rather than on bare defaults.** A monochrome line
  drawing on white is correct and is the least interesting thing this tool does,
  and a first-time visitor decides in about two seconds. Alpine Survey costs no
  more to draw — no particles, no ray-marched shadows, no sky-view pass — and it
  puts the Presets grid's selected tile on screen, which is how anyone learns the
  grid is there. One line under the file name names the current style and jumps
  to the grid. The defaults are untouched: *Reset all* and the randomiser still
  start from them, and a restored session still wins.
- **A `Btn` primitive.** Fifty-seven of the panel's sixty-three buttons carried
  their own font size, padding, radius, border, colour, background and cursor —
  one element, seven decisions, fifty-seven times, which is how one panel came to
  hold four button font sizes and four button radii. `Btn` owns appearance by
  state — quiet, ghost, primary, toggle — and leaves geometry overridable,
  because a full-width export tile and a two-character *all* are not one button
  in different padding. Nine call sites so far; the rest are genuinely bespoke.

### Changed
- **The picture is composed for the part of the window you can see.** The canvas
  spanned the whole window with the panel floating over its right-hand 272 px, so
  every scene was centred in 1440 while only 1168 was visible — the plate ran
  under the panel and off the edge. The canvas is inset now rather than the camera
  offset, which leaves the projection alone and lets every exporter keep reading
  its dimensions from `gl.domElement`. The paper frame follows the canvas too; it
  had been drawing the crop guide half a panel right of where the SVG would cut.
- **Design tokens are CSS custom properties.** One palette, published on `:root`,
  with the JavaScript exports as `var()` references — so all 407 call sites kept
  working untouched while the values became reachable from CSS. Six consumers
  cannot use a custom property (two 2D canvases, one hex-alpha suffix) and take
  the literal palette instead.
- **Thirteen font sizes become four roles.** 7, 8 and 9 px all collapse into
  micro 10; 11, 12 and 13 stay as body, label and display. Forty-seven sites. The
  9 px text was carrying section titles, every hint and every slider readout, and
  at that size on this ground it was a squint. It costs eighteen pixels of panel
  height, measured like for like.
- **Nine radii become three** — 2 for dense inline controls, 3 for small ones, 5
  for buttons, tiles and surfaces. Only 4 and 6 had to move. The Switch's 9 px
  track stays: that is a pill, not a radius on the scale.
- **Every toggle button passes AA.** White on `#3b82f6` is 3.68:1 and these
  labels are 9 and 10 px uppercase; `#2f6fe0` reads 4.7:1 under white and still
  3.77:1 against the panel. The segmented rows have been on the deeper fill since
  v1.0.0 — this is the rest of the panel catching up with a decision that was
  only ever half applied.

### Fixed
- **`Reset all` restored the style but left the section disclosures where the
  previous look had put them.** A style that switched Lines off collapsed that
  section, and the reset then turned Lines back on behind a shut disclosure.
- **The opening preset could overwrite work already in progress.** It is gated on
  fifty-six preset files downloading, so on a slow connection it arrived after
  the panel was usable. It now stands down once anything has been touched.
- **A one-pixel viewport/buffer disagreement at 2× supersampling.** The narrower
  canvas put the DPR clamp on an irrational ratio that three.js and GL rounded
  differently; the clamp is quantised to quarter steps so the buffer lands on
  whole pixels.

### Testing
- `tests/helpers.js` — `resetToDefaults()`, which states the baseline fifteen
  specs had been inheriting from the opening look rather than declaring. Setup
  only; no assertion was weakened. `discovery.spec.js` asserts the shipped
  opening state so that coverage did not disappear with it.

## [1.0.2] — 2026-08-21

### Fixed
- **Auto-rotate lurched before it started turning.** The canvas renders on
  demand, so a still scene draws nothing — but the clock behind `useFrame` keeps
  running, and the first frame after a quiet spell arrives with a `delta`
  covering the whole spell. Integrating that raw spent all of it in one step:
  after nine seconds of stillness the camera swung 96° before the second frame
  ever ran, against a steady rate of 7.8°/s. The frame delta is clamped to 50 ms
  now, so a stall can only ever cost motion rather than add it. The particle
  field had guarded against this all along with its own `Math.min(delta, 0.05)`;
  the clamp is one shared helper rather than two magic numbers.

## [1.0.1] — 2026-08-21

A multi-agent review of the 1.0.0 diff found fourteen defects, most of them in
what 1.0.0 had just added. Four were in the release's headline feature: settings
that survive a reload did not survive an auto-rotating plate, and a first visit
was announced as a restored one. They are fixed here, with regression tests for
the cases the original tests were too agreeable to try.

### Fixed
- **Auto-rotate stopped anything being saved at all.** The camera syncs into
  `view` every 150 ms while the plate spins and the save debounce was 400 ms, so
  every re-run cleared the pending write and scheduled another — it was postponed
  forever. The unattended hour with the scene turning is exactly the one the
  feature exists to protect. The debounce now has a ceiling: a continuous stream
  of changes can hold the write off for at most two seconds.
- **A first visit was reported as a restored one.** Opening the app loads its
  sample plate, which sets `terrain.resolution` — a real state change, so the
  settings were written even though nobody had touched anything, and the *second*
  visit announced that a session had been restored when all that came back were
  the defaults it would have used anyway. A stored set that says nothing the
  defaults do not is now no session at all.
- **Reset all cleared the session and then wrote it straight back.** The six
  state changes in the reset re-ran the save effect 400 ms later, so
  `clearSession()` was dead code.
- **A stored resolution was carried onto a raster it was never measured
  against.** `terrain.resolution` comes from `autoResolution(width, height)`
  exactly as zoom and pan do, and those were already excluded. Ending a session
  on a 12 000 px GeoTIFF and reopening put the ~1024 px sample plate on an 85×85
  grid, with nothing on screen to say why.
- **A restored mode came back drawing with its controls hidden.** `applyPreset`
  calls `syncSectionsToStyle` so that a look's own sections are open when it
  lands; seeding the same style straight into React state at mount skipped it.
- **The transparent-PNG toast named a file that did not exist.** The table said
  `alpha.png` where the writer produces `-alpha.png`, so the one message whose
  entire job is to name what was written said `Heightmap.alpha.png`.
- **A recording that ran its course said nothing.** The duration timer lives
  inside the recorder and calls `stopWebM` with the callback it was handed at the
  start, so wrapping the notification around the *manual* stop meant the ordinary
  case — letting it run out — wrote a file in silence. And `startWebM` swallowed
  a failed `captureStream`, so a browser that refused the canvas was still told a
  recording had begun.
- **A failed PNG capture reported success.** `finally { onPngDone('done') }`
  could not tell a completed export from a thrown one, so a lost context
  announced a file that was never written — and skipped the restore at the end of
  the capture, leaving the live viewport rendering at the capture's dimensions
  with every hairline the wrong width until the page was reloaded.
- **Filtering the panel unmounted sections instead of hiding them.** A collapsed
  section has always kept its children mounted behind a zero-height row, so a
  running Overpass fetch, the controller that could cancel it, the OSM category
  ticks and a layer's feature filter all survived being closed. Typing in the new
  filter threw them away and orphaned the request.
- **A typed value could miss the slider's own step grid.** Only sub-1 steps
  snapped, so 37 typed into a step-5 Azimuth was stored as 37 while the thumb —
  which cannot represent it — sat at 35: two controls for one value, disagreeing
  on screen.
- **A section header click while filtering silently collapsed it.** The filter
  forces every survivor open, so the click looked like it did nothing, and the
  section reappeared collapsed once the field was cleared.
- **A gradient change did not mark the preset as edited.** `applyPreset` writes
  both gradients, so changing one by hand is as much a departure as moving a
  slider — but the panel's gradient controls bypassed the check.
- **`\` stopped working after clicking a section header.** Headers became buttons
  in 1.0.0, and the handler skipped `BUTTON` — a guard `Controls.jsx` needs
  because Space activates a focused button, and backslash activates nothing. The
  shortcut stayed dead until focus moved elsewhere.
- **A section missing from the filter's index would render uncounted.** It is
  reported in development now, rather than showing "No section matches" beside a
  section that plainly matches.

## [1.0.0] — 2026-08-21

The drawing engine has been further along than the interface wrapped around it
for a while. This release is that gap closed: a UX review drove the running app
and came back with seventeen findings, and sixteen of them are here. Nothing in
the panel moved — it is the same 272 px column of collapsible sections, in the
same order — and every change below is additive to something that already
existed.

### Added
- **Settings survive a reload.** Terrain, style, particles, view and both
  gradients are written to the browser as you work and restored on the next
  visit. A look here is built over an hour of nudging a few hundred parameters,
  and a stray ⌘R used to return all of it to defaults with no prompt and no way
  back — the escape hatch existed, *Preset ⬇* writes the same object as JSON, but
  it sits in the Export section and nothing suggested it until after something
  had been lost. The raster is deliberately not stored: it can be a 256 MB typed
  array against a synchronous ~5 MB string store, and the app opens on its sample
  plate anyway. Zoom and pan are left out too — they are derived from the loaded
  image's dimensions, so a zoom carried over from a session that had a 12 000 px
  GeoTIFF open would frame the sample wrongly *and* make the panel's "75%" read
  against a base it was never measured from.
- **Find a control.** One field at the top of the panel narrows thirty-one
  sections to the ones that answer to what you typed, opened, with the control
  inside. Sections answer to a stated vocabulary rather than only their titles,
  because a mode's parameters are only mounted once the mode is on — so a filter
  built from what happens to be rendered could never find `azimuth` while
  Hillshade is off, which is exactly when someone is looking for it. Clearing the
  field puts the panel back exactly as it was.
- **Every draw mode shows its mark.** Thirteen rows reading MODE: ⟨cartographic
  noun⟩ were interchangeable to anyone who did not already know what a
  Strahler-order stream network looks like — which is most people, and exactly
  the people browsing. Each header now carries a 22×13 sample of the mode's
  defining gesture: the direction, rhythm and density of its strokes. Drawn
  rather than rendered, because a shrunk screenshot of the real output is mud at
  that size.
- **Vector Layers is always in the panel.** The section used to be conditionally
  rendered on a georeferenced raster, so the app's largest feature — OpenStreetMap,
  GPX, GeoJSON, labels, icons — was simply absent from the default session. That
  reads as "this tool doesn't do that" rather than "this tool needs a different
  file first". It now shows a disabled state naming the requirement, with the
  GeoTIFF loader in it.
- **The viewport says what it can do.** `grab` at rest, `grabbing` mid-drag,
  `crosshair` while it waits to be told where to cut a section — it was the
  default arrow in all three, which is the cursor a picture has. A hint bar names
  orbit, zoom and pan on first load and goes for good the first time you orbit.
  Edit Mode has had a bar like this all along; the main view is now held to the
  standard the app already set for itself.
- **Exports say what they wrote.** Every export ends with the file name it chose
  — `Wrote graz.svg` — which is the app finally mentioning a genuinely careful
  touch it has always had and never got to show. PNG, PNG α and the heightmap
  writer also put up the overlay while they work: the 4K capture is a synchronous
  render, a pixel read and a trim, long enough to feel like nothing happened,
  which is how three clicks became three queued captures.
- **Slider values can be typed.** A 69 px track spends about 1.4 units of a
  0–100 range on every pixel, and the output is a plot: spacing 4, angle 30°,
  weight 1 are values you set, not values you approach. Click the number, type,
  Enter — clamped to the slider's own range, Escape backs out. Edit Mode's crop
  fields have done this all along.
- **`\` shows and hides the panel.** "Show me the plate with nothing over it" is
  the most-wanted action in a tool that makes pictures, and it used to mean
  aiming at an unlabelled 22 px glyph.

### Changed
- **The panel header's Reset is now *Reset all*, and it offers an Undo.** Three
  other controls use the word for something harmless — the camera preset row, the
  mirror block, the crop — which taught that Reset is harmless, and then the
  fourth one replaced terrain, style, points, view and both gradients with
  defaults on one unconfirmed click. The scope is in the label now, and the whole
  previous state is captured before anything moves, so the toast that follows can
  hand it back. An Undo beats a confirm dialog here: a dialog taxes the deliberate
  case to protect the accidental one.
- **A preset tile says when you have left it.** `lastPreset` was cleared only by
  a *Surprise me* roll, so the highlight survived every slider you moved and every
  reset — in a wall of 56 thumbnails, the one piece of orientation the grid offers
  was also the least trustworthy. The tile keeps its border, because where a look
  started is worth knowing, and adds an *edited* tag rather than claiming the
  settings still match.
- **The panel's secondary text passes AA at the size it is set.** `MUTED` carried
  section titles, every hint and every slider readout at 9–11 px while measuring
  3.67:1 on the panel and 3.08:1 on a surface; it is now 5.53 and 4.65. White on
  the accent was 3.68:1 under 8 px uppercase — the dash-pattern selector, which
  decides how a line reaches paper, was a control you squinted at — so a filled
  accent under white text is two steps deeper at 4.7:1, and the 8 px labels are
  10 px.
- **Every shortcut is a bare key.** A chord belongs to the browser or the OS and
  now passes through untouched. See below for what that was costing.

### Fixed
- **⌘1 silently wrote an SVG, and ⌘5 started a screen recording.** The export
  shortcuts tested the physical key and nothing else: there was a guard for
  typing into a field and none for modifiers, so every accelerator built on
  `1`–`5` or `E` fired the app's handler too. On macOS ⌘1–⌘9 switches browser
  tabs — one of the most-pressed chords there is — so switching to your first tab
  wrote a file to Downloads, and ⌘5 began a WebM capture whose only sign is a
  badge at the top of a screen you have just navigated away from.
- **Turning Identify on hover off left a highlight that could not be dismissed.**
  The teardown cleared the hover but not the selection, and the only way out of a
  selection is a click on empty terrain — through the very listener that teardown
  had just removed. The orange highlight then stayed on the plate for the rest of
  the session: visible, permanent, and absent from every export, so nothing but
  the screen ever showed it was wrong. Clicking an already-selected row in the
  feature list now clears it too, which is the same escape by the other door —
  the list is how a selection is made while Identify is off, so it has to be how
  one is undone.
- **The keyboard could not open a section, so it could not reach what was
  inside.** Section headers were `div`s with an `onClick` — no `tabindex`, no
  `role`, no `aria-expanded` — and a collapsed section is a zero-height grid row.
  A keyboard user could reach the controls in the three sections open by default
  and never any of the rest. They are buttons now.
- **A focused slider looked exactly like an unfocused one.** `.hmr` set
  `outline: none` with nothing replacing it, while arrow-key nudging worked
  perfectly — and it is the only way to set a precise value from the keyboard. In
  a column of 31 identical sliders you pressed an arrow and watched the terrain to
  find out which one had it.
- **89 buttons and 31 sliders had no accessible names between them.** No
  `aria-label`, no `<label for>`, no landmarks, no headings, an unlabelled canvas.
  Voice control had nothing to match on and a screen reader got 31 anonymous
  sliders in a row. The six panel primitives already receive the label string;
  they now pass it on.
- **The inline help was behind the smallest target in the interface.** A 12×12
  `<span>` with an `onClick` — not a button, not focusable, well under any pointer
  minimum — gating some of the best writing in the app. It is a button in a 20 px
  hit box now, the ring unchanged. Sliders got the same treatment: the 3 px track
  left the thumb's overflow as the entire target, and the band is 19 px without
  the hairline moving.
- **A bad preset file arrived as a browser alert.** Every other failure in the app
  goes through a designed banner with a dismiss and a message built by
  `friendlyError()`; this one broke the frame with a system dialog and said only
  that you were wrong. It now names what to check.

## [0.10.1] — 2026-08-20

### Added
- **Vector layers are a stack you can drag.** There was no way to say what covers
  what: a fetch drew in the order OpenStreetMap's catalogue happened to be
  written in, and that was that. The list is now read the way every layer list is
  read — top row is the front of the scene — and a row moves by its grip, or by
  ↑/↓ with the grip focused. What changes with it is the whole picture: which ink
  is on top on screen, and which pen draws last in the SVG.
  A layer's own parts keep their order inside its slot, so a filled area now
  covers the layers below it instead of only tinting them, and a fill at 100%
  stays in the blended pass where the stack decides rather than in the opaque
  one, which would draw it before every line in the scene wherever you dragged
  it. Order travels with a preset. Uploads land on top, where you were looking.
  None of this reaches the worker — the stack is sorted out of its build key, so
  a drag across forty layers of a dense fetch is a frame rather than a re-drape
  of a valley of roads per step.
- **Point features can be drawn as an SVG icon instead of a dot.** Twenty-nine
  summits were twenty-nine identical dots; now they can be twenty-nine triangles,
  which is the surveyor's own symbol for one. Sixteen map-and-terrain marks ship
  in `public/icons/`, all from [Maki](https://labs.mapbox.com/maki-icons) (CC0),
  Mapbox's own POI set — so they are the marks a Mapbox style addresses by name,
  `danger` being the skull and crossbones a style calls `danger-15`. The grid is the whole set at a glance, with the
  category's own suggestion first; anything else is an upload of your own SVG.
  A Lift slider raises a marker off its point with a leader line down to it,
  which is what stops a summit icon being half-buried in the slope behind it.
- **Icons are drawn solid, with their holes cut out.** These are silhouettes, so
  a solid mountain is the mark Maki drew and the hollow outline of one is a
  wireframe of it — Fill is on by default, in the icon's own colour at its own
  opacity, since a summit going solid should not go the blue an area fill starts
  at, and 45% is right for a lake seen through contours and not for a glyph.
  The rings are sorted by containment before triangulation — a ring
  inside an odd number of others is a hole, belonging to the smallest ring that
  contains it — so the skull keeps its eye sockets and the mountain its inner
  peak. Triangulation is three's `ShapeUtils` (earcut with hole bridging) rather
  than the hand-rolled ear clipper this started with, which had no hole support
  at all. Switching Fill off leaves the outline, which is what a plotter draws.
  Viewport and raster exports only: the SVG is a line-art format and a fill is
  triangles.
- **Point features can be labelled with their name and their height.** A peak
  fetched from OpenStreetMap already carries both — its `name` tag, and the
  "1910m" the feature list shows from its `ele` — and they can now go on the
  terrain. The lettering is geometry like everything else here, so it takes the
  layer's colour and weight, the ghost occlusion and every exporter, and lands
  in the SVG as strokes in a pen layer of its own (`Peaks · labels`) — the
  lettering can be a different pen from the marks it labels. A feature with no
  name is left unlabelled rather than numbered, and the panel prints the counts
  ("18 of 29 named") so the gap reads as data rather than as a bug. Size, offset
  across and up, alignment and fill are all live, and the type is inked apart
  from the marks it labels — see the ink entry below. The label does share the
  icon's *plane*, because a name lying flat beside an upright summit triangle
  reads as a bug.
  The face is **Space Mono**, the one the erzberg logo is set in (SIL OFL 1.1),
  in regular, **bold**, *italic* and bold-italic — two switches, with regular as
  neither, each a separate file rather than a slant applied to one of them.
  Outlines cannot come from a browser — nothing hands back the curves of a glyph
  — so `scripts/build-font.js` converts the TTFs ahead of time into ~70 kB of
  path data each, covering ASCII, Latin-1 and the Latin Extended-A letters that
  Austrian, Slovene and Czech place names need, and a face is fetched only when
  a layer asks for it. `npm run font <ttf…>` regenerates them, and refuses a
  proportional face: the layout is a cursor and an addition.
- **An icon and a label each carry their own ink** — colour, stroke width and
  opacity, then fill with its own colour and opacity, and whether that stroke
  sits **outside** the shape or centred on its edge — independent of each other
  and of the layer's. A mark drawn *from* a layer is not the layer: a point
  layer's weight is its dot's **diameter**, 5 for a peak, and five units of
  stroke on a 25-unit mountain is a blob, while the weight that draws that
  mountain well closes up the counters of nine-point type. Amber summits under
  grey lettering is an ordinary thing to want from one layer.
  Everything but the stroke width starts as "the layer's own" and stays that way
  until touched, with a *Match layer* button to put it back; a mark's fill falls
  back through its own stroke colour first, so colouring an icon colours all of
  it. This removed two hacks: choosing an icon — or uploading one — used to write
  into the layer, thinning its weight and claiming its fill colour and opacity,
  because the glyph had no ink of its own. Picking an icon now changes the icon.
- **Strokes on filled marks sit outside the shape**, which is new — a line
  renderer only knows centred, and half a stroke width taken out of every edge is
  what closes up a glyph's counters. There is no geometric fix, since the width is
  in CSS pixels and the offset would be a world distance that moves with the
  camera; paint order does it instead, drawing the line at twice the width and the
  fill over its inner half from a slot after this layer's lines and before the
  next layer's anything. *Centred* is still there per mark. The SVG export writes
  the width the slider says either way: a plotter draws one pass along the
  outline, and doubling the pen would be a lie about the drawing.
- **Icons can be turned in 3D.** *Face camera* keeps them square to the view as
  you orbit; switching it off exposes Tilt and Spin, with a **Match view** button
  that snaps them to the camera — the same drawing, pinned, for composing a frame
  to export.

### Changed
- **A height reads `1910m`, not `1910 m`.** One string serves the feature list,
  the tooltip and the label drawn on the terrain, and at the sizes a plot uses
  the space was a gap as wide as a digit.
- **Hiding a layer is its own control.** The row's colour swatch used to double
  as the visibility toggle, which put "hide" and "delete" at opposite ends and
  left the swatch doing two jobs. There is now an eye beside the ✕, and the
  swatch is a colour chip that dims when the layer is hidden.
- **Each OpenStreetMap request carries a deadline.** One budget per endpoint,
  covering headers and body, set above the server's own `[timeout:180]`. A
  socket that accepted the connection and went quiet used to park the panel for
  ever — and, worse, defeat the mirror fallback, since the loop only advanced on
  a rejection or a bad status. One budget rather than a short connect timeout
  and a long transfer one, because Overpass withholds headers until the query has
  finished running: a tight header deadline would kill the legitimate slow
  queries this tool exists to make.

### Notes
- **The icon set is [Maki](https://labs.mapbox.com/maki-icons/) (CC0), a map set
  drawn filled — which sounds wrong for a line renderer and is not.** Twenty
  open-source sets were flattened through this very pipeline and compared, and
  the first pick was a *stroke* UI set on the reasoning that a stroke flattens
  straight into polylines while a filled glyph arrives as a hollow outline of
  itself. It does arrive as a hollow outline of itself. That is the point: for a
  map symbol the outline of the silhouette *is* the line drawing — the fill
  boundary of a skull and crossbones is a skull and crossbones, and its eye
  sockets are holes in the fill that come out as their own closed marks. The
  stroke set bought a lighter line (`danger` is 111 segments where a stroke skull
  was 52) and paid in vocabulary: no mountain, no volcano, no shelter, no
  viewpoint, and fourteen kinds of arrow instead. Prefer Maki's solid variants to
  its `-stroked` ones — a stroked ring is a filled band, so flattening traces
  both its edges and draws two rings where one was meant.
- **There is no path parser.** Every drawable SVG element is an
  `SVGGeometryElement`, so `<path>`, `<circle>`, `<rect>`, `<ellipse>`, `<line>`,
  `<polyline>` and `<polygon>` all go through `getTotalLength()` +
  `getPointAtLength()` — arcs and béziers exact — and `getCTM()` folds in whatever
  nesting and `transform` an uploaded file carries.
- **Subpaths have to be split, and not by parsing the `d` attribute.**
  `getPointAtLength` walks a multi-subpath path as one continuous
  parameterisation and a move between subpaths has no length, so walking it end
  to end draws a segment from where one subpath stopped to where the next began.
  Splitting `d` is the obvious fix and is wrong: a subpath starting with a
  relative `m` is relative to the previous subpath's end. Detecting the spatial
  discontinuity cannot be fooled — a real segment sampled at step `s` never
  advances more than `s`.
- **Icon geometry is built on the main thread**, because those APIs only answer
  inside a rendered document. That is where it belongs anyway: size, lift and
  orientation become render-side like colour, so dragging them is a frame rather
  than a rebuild, and it is what lets the icons follow the camera at all.
- Choosing an icon also thins an untouched dot weight. A point layer's weight is
  its dot's *diameter* — 5 for a peak — and the same number is the stroke width of
  the glyph replacing it. Five pixels of stroke on a 25-pixel mountain is a red
  blob, which is what the first working version looked like.

### Fixed
- **A query OpenStreetMap refused was then put to every other mirror.** 429 and
  504 are about the server and are worth asking elsewhere; a 400 is about the
  query and asking again only wastes a volunteer's bandwidth. The `throw` that
  said so landed in the same function's own `catch`, which files anything that is
  not an abort as "that endpoint failed" and moves on — so a malformed query was
  re-POSTed down the whole list before the error ever surfaced.
- **A preset saved before the stack existed came back inside out.** `vectorStyles`
  used to be written ground-cover first, and reading one of those arrays as a
  stack order puts landuse in front of roads. New presets carry a
  `vectorStackOrder` flag and only a preset that sets it has its order applied;
  an older one contributes its styles and says nothing about arrangement.
- **A preset that carried an uploaded glyph made its layer vanish.**
  `iconCustom` holds flattened geometry whose polylines are typed arrays, and
  `JSON.stringify` writes those as `{"0":…}` objects with no `length` — so on
  reload every loop over them ran zero times and the layer drew neither its icon
  nor its dots, having been told it had an icon. A preset no longer carries the
  upload, and `icon` falls back with it.
- **An icon whose `viewBox` did not start at `0 0` was drawn off-centre.** The
  origin was subtracted twice — once by `getCTM`, which carries the viewBox's own
  translate, and once by hand — so an uploaded `viewBox="-12 -12 24 24"` file
  landed half its own width out of place and could fall outside the unit box.
  Every bundled icon starts at `0 0`, which is why nothing shipped looked wrong.
- **Labels drew in front of the whole scene.** They are appended to the geometry
  rather than substituted into it, and `renderOrder` comes from the array index,
  so a layer dragged to the bottom of the stack sent its marks behind everything
  and left its lettering on top of everything. A label now sits in its own
  layer's slot, directly behind the marks it belongs to.
- **A second uploaded glyph with the same file name kept drawing the first.** The
  geometry memo told two custom icons apart by name alone, so replacing
  `icon.svg` with a different `icon.svg` changed nothing until some unrelated
  field was touched.
- **A mark came apart into patches of fill and patches of stroke.** An icon or a
  label is a flat drawing planted on a rough surface, so the terrain cuts through
  its plane — and the two halves of it were being cut in different places,
  because the fill carried a `polygonOffset` toward the camera and the stroke
  carried none. Along that intersection the fill survived where the stroke was
  rejected, and which of the two you saw changed with the camera. Both now take
  the same bias, deeper than the one an area fill uses: an area fill is *of* the
  surface and wants to hug it, while a marker stands a whole glyph's worth of
  geometry through the ground it is planted in. Lift is still what stops a marker
  being half-buried; this is what stops it being half-*eaten*.
- **A mark's fill no longer writes depth**, so which of the fill and the stroke
  covers the other is decided by the stroke's Outside/Centred setting rather than
  per-pixel by the depth buffer. Exactly coplanar geometry plus a stroke that is
  really a screen-space quad — its depth interpolated across its width — is a
  coin toss, and it read as one. Area fills are unchanged: they still write
  depth, which is what lets a lake at 100% cover the contours under it.
- The picker reported the *geometry's* id for an icon layer (`vec:7#icons`) where
  hover and selection name a layer, so a picked icon appeared nameless and its
  row unmarked.
- **The flattener sampled invisible geometry.** Icon sets pin their bounds with
  `<path stroke="none" fill="none" d="M0 0h24v24H0z"/>`, and hit areas and
  spacers are the same trick — each one drew a square around the icon it was
  meant to size. It now asks for the *computed* paint, which also catches
  `display:none` and a zero opacity.
- **A fill at 100% opacity was still see-through.** The fill material was
  permanently `transparent` with `depthWrite` off, so it stayed in the blended
  pass no matter what the slider said, and the terrain surface and every layer
  drawn after it composited over the top. At full opacity it is now genuinely
  opaque, which puts it in the depth-sorted pass where it covers what is behind
  it.
- **The flattener scaled by the rendered size, not the viewBox.** `getCTM()`
  includes the viewport transform, so an SVG sized in `em` or `%` — which is
  most of them, and everything an icon CDN serves — came out shrunk by the ratio
  between its CSS size and its viewBox. A 256-unit icon at the default 16 px
  arrived at one sixteenth scale.

## [0.10.0] - 2026-08-18

A GeoTIFF says where on Earth it sits. Until now the only thing that used that
was a single GPX track — one file, one line, one colour. Everything else about a
place, the roads and streams and forest and summits, had to be somewhere else.

This release makes the raster's extent a question you can ask OpenStreetMap, and
turns the answer into layers you can style, filter and point at. A live fetch
over a 12 × 7 km alpine tile came back as 3 476 elements and 112 662 coordinates
in 169 ms, sorted into 41 named layers: *Roads · Track (621)*, *Water · Stream
(558)*, *Landuse · Forest (135)*, *Peaks (29)*.

### Added
- **Vector layers.** With a georeferenced raster loaded, a checklist of OSM
  categories — roads, rail, waterways, water bodies, landuse, buildings,
  aerialways, peaks, boundaries — becomes one Overpass query over the raster's own
  extent. Each tag class that is actually present becomes its own layer, named
  *category · subtype*, with its own colour, weight, opacity, dash, visibility and
  removal. GeoJSON and GPX uploads join the same list.
- **Areas can carry a fill that follows the ground.** Rasterised into a lattice in
  pixel space rather than triangulated, so every corner takes its own elevation
  sample and the fill hugs the slope instead of hanging over it as a flat lid.
  Holes and multi-part polygons fall out of the even-odd rule rather than needing
  a triangulator, which is why this adds no dependency.
- **Per-feature selection.** A layer is no longer the smallest thing: expanding
  one lists its features with a checkbox each, so five peaks can be kept out of
  twenty-nine. Named features sort first, the rest get a stable `Track #118`, and
  a filter box plus a cap on rendered rows keeps a 621-feature layer from becoming
  621 DOM nodes.
- **Pointing at the terrain names what is under the cursor.** Resting on a feature
  shows its name and lights it up; clicking selects it, opens its layer and
  scrolls its row into view. Hovering a row does the same from the other end —
  both write one piece of state, so neither knows about the other.
- **Inverse projection.** `unprojectWgs84`, `isInvertible` and `bboxToWgs84` in
  `utils/geoCoords.js`, which is what lets the extent leave the raster's grid and
  become a query at all.
- Vector layers carry into the SVG export as one named Inkscape layer each — so a
  plot is separable by pen — and into PNG, PNG α and WebM. STL writes a ribbon
  solid for layers that ask for one, `<base>-vectors.stl`, default on for GPX and
  off for everything else.
- GPX track segments are kept apart rather than joined. A `<trkseg>` boundary is
  the recording pausing, and joining two of them draws a straight line across
  whatever lies between — on a mountain, a line through the mountain.

### Changed
- **The GPX Track section is now Vector Layers**, and a GPX file is one source
  among three. Its `colorGpx` / `weightGpx` / `opacityGpx` / `dashGpx` params are
  gone; presets written against them still work, applied to any GPX layer.
- Presets carry `vectorStyles` — the layers' styling and nothing else. Coordinates
  stay out, and so does the per-feature selection: `hidden` holds feature
  *indices*, which mean nothing against a different fetch of the same area, so
  re-applying them would hide five arbitrary peaks rather than the five chosen.
- `trackCoverage` is now `featureCoverage` and reads the flat ring form every
  source normalises to; `isTrackProjectable` is `isProjectable`.
- The stats footer counts area-fill triangles, because they are drawn triangles
  like the surface is.

### Fixed
- **A partial-coverage warning that cried wolf on every OSM fetch.** Overpass
  returns whole ways that cross the bbox edge, so partial coverage is the normal
  outcome there rather than a mismatch. It is now reported only when an upload is
  loaded, where it means something.
- **Peaks were nearly impossible to hover.** Three does not take a pick radius: it
  tests `distance < (linewidth + threshold) / 2` in CSS pixels, so a weight-5 peak
  at the original fixed threshold had a **5 px** target. The threshold is now
  worked backwards from a wanted radius, per layer, so it cancels out however
  thick each one is drawn. Measured across the same sweep of 440 pointer stops:
  **0.5% → 9.5%** hit rate, and peaks reachable **2 of 29 → 22 of 29**.
- **The hover tooltip truncated the names it existed to show.** It wraps now, and
  flips to the other side of the cursor near an edge instead of sliding under the
  sidebar. `Steinfeldspitze-Südwest-Gipfel` renders in full.
- OSM category classification was permissive enough to steal from itself: Water
  bodies ended with an unconditional `|| 'lake'` and swallowed every road and
  stream that reached it, while Landuse claimed `natural=water` and `natural=peak`
  before Water bodies or Peaks ever saw them. Every category now claims only the
  tag values it lists.
- `aerialway=t-bar` is spelled with a hyphen, not an underscore, and read back as
  "Aerial · t-bar".
- The STL exporter returned `undefined` on success rather than `'done'`.

### Notes
- **`bboxToWgs84` samples nine points, not four corners.** A projected extent is
  not a rectangle in WGS84 — a line of constant northing peaks in latitude at the
  central meridian — so an extent straddling its own CM has all four corners
  *below* its true top edge, by a few kilometres on a wide tile.
- **Simplify, then densify.** OSM geometry is drawn rather than recorded, and both
  directions need correcting: a digitised riverbank carries more detail than a
  30 m DEM can express, and a straight motorway can run 400 m between nodes, which
  as one 3D segment puts the road through the ridge between them.
- **Vector layers carry no per-vertex colour buffer.** One colour, resolved at
  render time, so recolouring is a frame rather than a rebuild of all fourteen
  draw modes — pinned by a test that counts worker rebuilds during a colour change
  and expects zero. This is also why they have no hypsometric tint: a feature has
  no elevation of its own, so it could only read the ground underneath, which is a
  different thing from what the draw modes mean by it.
- **The picker stays out of R3F's event system.** Attaching handlers to the line
  objects would put them in its interaction list and raycast every one on every
  pointer move. Raycasting a `LineSegments2` is O(segments) and the
  bounding-sphere early-out never helps here, since every layer's sphere covers
  the whole raster — so hovering is debounced to pointer-rest, a click picks
  immediately, and a drag stays an orbit because the click path measures how far
  the pointer travelled.
- **Three Overpass endpoints, not two.** Both of the first pair were serving
  504 "server is probably too busy" on the day this was written, on a query a
  third instance answered in seconds. Two is not redundancy.
- OpenStreetMap data is ODbL. `© OpenStreetMap contributors` appears in the panel
  whenever OSM layers are loaded, and as a comment in every SVG that carries them.
- Area fills are not exported to SVG. Correct output would need painter-order
  depth sorting of thousands of triangles against the software Z-buffer, and this
  is a line-art format; every filled area's outline is still there.

## [0.9.20] - 2026-08-17

A dense plate could lock the tab hard enough that Chrome offered to kill the page.
Not because the export is slow in any surprising way — a few hundred milliseconds
on an ordinary plate, seconds on a heavy one — but because all of it ran as one
unbroken block. Timestamping every frame during an export showed the shape
exactly: a single 242 ms gap on the *default* scene, with every other frame at a
healthy 17 ms. There was already an "Exporting SVG…" overlay; it simply froze the
instant it appeared, which is why it never seemed to do anything.

### Added
- **The SVG export reports progress and can be cancelled.** It hands the main
  thread back roughly every 24 ms, so the overlay paints, the bar advances through
  its three phases — depth buffer, hiding lines behind terrain, assembling — and
  there is a Cancel button on it. Longest unbroken stretch on the default plate:
  **242 ms → 39 ms**, with no change in wall time. The work was never the problem;
  doing it without pause was.
- **The STL export gets the same, and an overlay it never had at all.** It was the
  quieter version of the same bug: a fine-resolution plate blocked for 122 ms on
  the default heightmap — proportional to raster size, so seconds on a real DEM —
  with nothing on screen to say the app was doing anything rather than broken.
  Now **122 ms → 47 ms**, with a bar and a Cancel. An overlay without the pacing
  would have been the frozen overlay the SVG export already had.
- Cancel unwinds at the next yield and writes nothing. For SVG the download is
  simply the last statement; for STL the ordering is load-bearing, since the plate
  is written before the optional GPX ribbon — the ribbon path takes no pacer, so
  there is no yield after the first file exists and therefore no way to abandon a
  half-written pair.
- `utils/pacing.js`, shared by both writers, so there is one answer to "how does a
  long export stay responsive" rather than two that drift.

### Fixed
- Triggering an export while one is running would previously have been impossible
  — a synchronous block cannot overlap itself — and became possible the moment it
  learned to yield. There is now a single export slot, and the `1` and `4`
  shortcuts and both panel buttons are inert while it is taken. The slot is
  claimed through a ref rather than state: a state updater runs on the next
  render, so two triggers in the same tick would both find it empty and both
  start.

### Notes
- **`scheduler.yield()` is the wrong primitive here, despite being the modern
  one.** It resumes the caller as a *continuation*, ahead of rendering, so the
  work interleaves but the frame never lands. Paced entirely through it the page
  still froze for 121 ms at a stretch; through an ordinary `MessageChannel` task
  boundary, 39 ms. What this needs is not a prompt resumption but a repaint. The
  reasoning is in the code, because it is exactly the sort of thing someone
  optimises back.
- **A time budget is only kept as finely as it is checked.** The first cut
  consulted the clock every 256th item to avoid allocating a promise per
  iteration — but 256 segments carrying 64 occlusion samples each is 100 ms, so a
  24 ms budget was producing 122 ms stalls. The pacer now splits into a cheap
  synchronous `due()` asked on every 16th item and an `async yield()` that
  allocates only when it really yields.
- The flock loops are deliberately left unpaced. They read the *live* particle
  buffers — handed out uncopied so an export catches the frame on screen — so a
  yield mid-pass would splice two moments of the animation into one picture. They
  are small beside the segment walk.
- Output is unchanged, and checked rather than assumed: the same fixture still
  exports 33636 marks with no fill layer and 27178 with hillshade, and the same
  STL still carries 25209 triangles over the same Z range.
- Every new test was confirmed to fail against the unpaced code first — SVG at
  237 ms and STL at 147 ms against a 120 ms threshold, with progress collapsing
  from a smooth `[0, 8, 17, 25, 43, 63, 85, 96]` to `[0, 0, 85]` and `[0]`.
- PNG is deliberately left alone. It is one GPU render and readback at up to 8K,
  so there is no loop to pace — it could gain an overlay to stop the freeze being
  a mystery, but never a truthful progress bar.

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
