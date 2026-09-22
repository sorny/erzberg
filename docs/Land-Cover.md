# Land cover

Every draw mode in this app reads the shape of the ground. Slope, curvature,
aspect, how the light falls on it — that is the whole vocabulary. Two pieces of
ground at the same gradient therefore get the same mark, whatever is standing on
them.

A cover plate adds one fact the heightmap does not contain: what each pixel *is*.

---

## The pipeline

```
                      ┌─ --dem your.tif ─→  <name>.landcover.json ─┐
AlphaEarth tiles  →───┤                                            ├─→  the app
   64 bands, 10 m     └─ --place "…"   ─→  <name>.tif              │    masks, ink
                                        +  <name>.landcover.json ──┘
```

Two ways in. `--dem` cuts the plate to a raster you already have. `--place`
cuts the raster as well, for when you do not have one.

### 1. Cut a window

**If you already have a GeoTIFF**, point the script at it. The extent and the
projection come from the file, so the plate covers the same ground in the same
projection and no terrain is fetched:

```bash
node scripts/embed-window.js --dem my-terrain.tif --classes 6
```

**If you do not**, name a place and the script writes the terrain as well:

```bash
node scripts/embed-window.js --place "Eisenerz" --km 4 --classes 6
```

| Flag | Meaning | Default |
|---|---|---|
| `--dem` | Match a GeoTIFF you already have. Writes only the plate | — |
| `--place` | Or a place to centre on, resolved by OpenStreetMap | — |
| `--bbox` | Or an explicit `lon,lat,lon,lat` box | — |
| `--km` | Window side in kilometres, for `--place` | 4 |
| `--year` | Embedding year, 2017 to 2024 | 2024 |
| `--classes` | How many cover classes to cut, 2 to 32 | 6 |
| `--out` | Where to write | `.` |
| `--name` | Output file stem | from the file or the place |

`--dem` is the one to reach for whenever a raster exists, because the extent is
already stated in the one place that cannot disagree with the pixels. Typing a
place name back in by hand is how a plate ends up describing ground a few
hundred metres from the ground it is laid over — and a plate that is slightly
wrong still renders, and still looks deliberate.

The raster does not have to be in UTM. The embeddings are, so the script reads
the UTM window that covers your extent and carries it onto your grid, going
backwards per output pixel: your pixel → your projection → WGS84 → UTM →
nearest embedding. Any projection `geoCoords.js` can invert works, which is a
geographic CRS, Web Mercator, and the UTM zone blocks. Anything else is refused
rather than guessed at.

Without `--dem`, the script writes the terrain **and** the plate from one window
in one run, so the two are aligned by construction for the same reason.

### 2. Load both

With `--dem`, your raster is already loaded — just drop `<name>.landcover.json` on
the window. Otherwise load `<name>.tif` as terrain first, then drop the plate.

The panel does this arithmetic for you: open **Land Cover** with no plate loaded
and it prints the exact command for whatever is on screen — `--dem` with the
filename when the raster came from a georeferenced file, `--bbox` with the real
extent when it came from a fetch.

---

## Why the fetch is not a button

The app promises that it contacts no third party without a press, and that it
asks with no key and no account. The embeddings break the second promise on both
routes that exist.

| Route | Anonymous read | Works in a browser |
|---|---|---|
| Earth Engine API | No — account, OAuth, Cloud project | No |
| `gs://alphaearth_foundations` | Yes — a ranged `GET` returns `206` with no credential | **No — the bucket sends no `access-control-*` header** |

The second line is the whole reason this is a script. The data is genuinely open
and a browser still cannot read it, because CORS is a property of the response
rather than of the data. Only a proxy would fix that, and a proxy is a server.

So the reduction happens on a machine with no origin to be checked against, and
the app loads the result. That also keeps the download honest: one byte per
pixel instead of the sixty-four it was derived from.

---

## The file format

`kind: "erzberg.landcover/1"`.

| Field | Meaning |
|---|---|
| `crs`, `bbox` | The ground this plate covers, in its own projection |
| `width`, `height` | Its own grid |
| `classes[]` | `index`, `name`, `color`, `share`, `note` |
| `labels` | One byte per pixel, the class index. Deflated, then base64 |
| `plate` | Three bytes per pixel, the imagery colour. Deflated, then base64 |
| `variance` | How much of the embedding variance the three colour axes hold |
| `attribution` | The credit the CC-BY licence requires |
| `osmCredit` | The ODbL credit, when the names came from OpenStreetMap |

The payloads are deflated bytes rather than a PNG. Both sides of the wire
already have a deflate implementation, the payload has no image semantics worth
preserving, and skipping the container removes the only part of the format that
could disagree about row order.

A plate states its own extent and projection so it can be **checked** rather than
trusted. One that does not cover the same ground as the raster is refused with a
reason. A misaligned cover still renders and still looks deliberate, which is
exactly why it is not allowed to load.

The alignment is re-derived whenever the raster changes, so an Edit Mode crop
re-cuts the plate to the crop instead of quietly switching the masks off.

---

## How masking works

This is the part worth understanding, because it explains why the feature covers
every mode rather than the few it was written for.

Every builder in `geometryBuilders.js` already asks `gridMask` whether a cell
carries data. It has to: a GeoTIFF with a void in it has always been possible,
and a mode that ignored the mask would draw across the hole. Descent runs,
isoline marching, lattice fills — all of them gate on it.

A class filter is therefore not a new question to ask at every mark. It is the
**same question, asked of a mask with more zeros in it**:

```js
function maskedTerrain(terrain, mask) {
  if (!mask || mask === ALL_CLASSES || !terrain.gridClass) return terrain
  const out = new Uint8Array(terrain.gridMask.length)
  for (let i = 0; i < out.length; i++) {
    if (terrain.gridMask[i] && maskHasClass(mask, terrain.gridClass[i])) out[i] = 1
  }
  return { ...terrain, gridMask: out, hasNoData: true }
}
```

Thirty-four draw modes, and not one of them needed changing. The next one will
inherit masking too, without knowing land cover exists.

### Thirty-two classes, and why exactly that many

A layer's whole class selection is one signed 32-bit integer, one bit per class.
That is what lets it travel as a single number through the parameter bus, the
preset file, the history stack and the rebuild key without a special case
anywhere. Thirty-two bits, thirty-two classes.

The arithmetic at the two ends is worth stating, because the obvious way to
write it is wrong at both and wrong in opposite directions. `(1 << count) - 1`
goes negative at 31, and `&` coerces that to int32 while `===` goes on comparing
the uncoerced number — so ticking every class stopped registering as "all of
them". At 32 the shift count wraps modulo 32, `1 << 32` is 1, the mask comes out
as 0, and *every* selection read as unfiltered: picking one class turned the
filter off. Both edges are named outright in `fullMask` and pinned by tests.

`decodeCover` refuses a plate carrying more than 32 classes rather than loading
it, because past the ceiling the bit for class 32 is the bit for class 0 — a
wrapped mask stencils the wrong ground and looks entirely deliberate doing it.

Two softer limits sit well below that. **Ink by land class** has eight marks to
deal, so it names the eight steepest classes and leaves the rest unassigned. And
a legend of thirty-two swatches is four rows of a 244 px panel — legible, but
past the point where a reader can hold the classes apart. Six to eight is the
useful range; the ceiling is there so nothing breaks if you want more.

### What is deliberately not recomputed

Only `gridMask` changes. `halfW`, `minElev`, `maxElev` and `maxSlope` carry over
untouched, and that is load-bearing rather than lazy. They are the frame every
layer is drawn against. Re-measuring them over one class's cells would re-centre
that layer on its own bounding box and re-stretch its hypsometric ramp over its
own elevation range — so two masked layers over the same terrain would drift
apart on the page and disagree about what colour 1 200 m is.

The picture has one coordinate system. Only the stencil moves.

---

## Seeing where they are

The legend says what the classes are called and how much of the window each one
covers. It cannot say *where* any of them is, which is the question you ask
immediately afterwards and the one that decides what to mask a layer to. Six
swatches in a column is a list of six unknowns until you have seen their shapes.

So the Land Cover section draws the plate flat, at its own grid, before any draw
mode or the camera gets near it — the raw classes in their own colours and
nothing else in the picture. Pointing at the map names the class under the
cursor; pointing at a row of the legend lights that class up on the map. One
piece of state drives both directions, so the two halves are one instrument
rather than two views that happen to sit near each other.

Two details are deliberate. Everything not being pointed at drops to a low
**alpha** rather than being mixed toward a background colour — transparency is
the same effect without reading `--hm-surf` out of the DOM and re-reading it
whenever the theme moves, and it cannot disagree with the panel it sits on. And
the canvas is `image-rendering: pixelated`, because interpolating between two
class colours invents a third that stands for no class at all, and at the
panel's width there would be a fringe of those along every boundary in the
picture — precisely the boundaries this exists to show.

---

## What the classes are called

A cluster cannot say what it is. The embedding will not say either: its axes are
unsigned and unnamed, so "the green one" means nothing and a label invented from
the colour would be a guess wearing the clothes of a fact.

OpenStreetMap has been answering this question for twenty years. The script asks
which landcover polygons cover the window, paints them onto the same grid, and
tallies which one each class mostly falls inside:

```
#d89f96   17%  Quarry · gentle    — OpenStreetMap: 90% quarry
#16b865   21%  Forest · moderate  — OpenStreetMap: 87% forest
#6b2552   16%  Forest · steep     — OpenStreetMap: 54% forest, 36% quarry
#849c50    9%  Built-up           — OpenStreetMap: 36% built-up, 19% quarry
#4d5dd5   24%  Quarry · steep     — OpenStreetMap: 51% quarry, 27% forest
#70db9b   13%  Quarry · moderate  — OpenStreetMap: 66% quarry, 16% grassland
```

Three rules hold it honest:

**A name needs a majority.** Below 30% there is no dominant anything, and
printing a word anyway would make the panel confidently wrong exactly where a
reader most needs to doubt it. Such a class keeps its letter and is described by
its terrain instead — always available, since the elevation is in hand either
way.

**Names that collide get parted.** Over a mine, three of six classes come back
"Quarry". All true, and useless in a legend whose whole job is telling them
apart, so a repeated name takes the terrain word that distinguishes it.

**The runner-up is shown.** A class that is 54% forest and 36% quarry is a real
mixture, and saying so tells the reader which boundary to distrust.

`--no-osm` skips the lookup entirely. The classes are then described by slope
and height alone.

### The trap in this

The Erzberg is a `type=multipolygon` **relation**, not a way. A way-only query
came back with 93 polygons over the window and not one of them the mine, so
every class was named after the forest around it — 7% to 61% of each class
mapped, and the pit invisible. Including relations, and stitching their member
ways back into closed rings, took coverage to 81–99% and found the quarry.

Overpass returns a relation's geometry one member way at a time, in no
particular order and with no consistent direction. Filling each segment as
though it were a closed ring paints a dozen slivers where one crater belongs.

---

## Ink by land class

One press deals a mark to each class, masks each layer to its own class, and
gives it that class's colour.

The ordering is by **measured mean slope** and nothing else. It would be easy to
label the classes "forest" and "water" and assign marks from that, and it would
be a guess: the plate's classes are unnamed and the sign of a principal axis
carries no fixed meaning. Slope is a number the app already computed, and it is
the ordering a survey sheet actually uses — broken rock at the top, tone and
stipple at the bottom.

Every assignment is a starting point. Re-point any of them afterwards.

---

## The reduction, in detail

**Normalising.** The published values are quantised to `Int8` on a scale the
dataset does not state, so the stored norm is a constant well away from 1. Every
use here is angular, so normalising is both the correct reading of the model and
the thing that makes the scale irrelevant.

**Classes.** Spherical k-means — cosine rather than Euclidean, because the
embedding is defined on a sphere and two vectors mean the same cover when they
point the same way. The seeding is deterministic, so the same window always cuts
the same classes and a preset built on one is not a one-off.

**Colour.** The window's own three strongest principal axes, inked as red, green
and blue, with the ends of each ramp at the 2nd and 98th percentiles. Fixed axes
would be comparable between windows and useless inside one: the variance that
separates a quarry from a spruce stand is not the variance that separates ocean
from ice.

**Class swatches** are the mean plate colour of each class, so the swatch in the
panel already looks like the ground it stands for.

---

## What resolution the plate is cut at

The embeddings are 10 m and nothing makes them finer. So the plate is cut on its
own grid — the raster's extent and projection, at the resolution the data
actually has — and the app upsamples it back to the raster on load.

For a 10 m raster that is 1:1 and nothing happens. For a finer one it is not:
a 4.2 m city raster of Graz is 3804 × 2558 and its plate is 1902 × 1279.

**This replaced a pixel cap that refused the work.** Cutting at the raster's own
grid meant a fine raster asked for tens of millions of embedding pixels, so the
script carried a ceiling and told the user to crop. That is a refusal to do
arithmetic dressed as a limit: at 10 m there was never that much data to read.
Graz needed 9.7 million pixels under the old rule and reads 2.4 million now,
which is the same answer at the resolution it was always available in.

Nothing is lost. Upsampling a nearest-neighbour class map restores every
boundary exactly, and `alignCover` already did it — this is the same path a
plate cut for a *different* raster has always taken.

**The bug this opened.** OpenStreetMap polygons are painted to name the classes,
and the projection that places them answers in the *raster's* pixels. Once the
plate was allowed to be coarser, painting at raster scale put every polygon in
the top-left quadrant of the plate.

It did not fail loudly. It produced a tally, and the tally was *the same for
every class*: six classes over Graz, each 40% forest and 26% built-up, each
therefore named "Forest". Uniform output is the signature — a class that draws
its name from a region uncorrelated with itself gets the window's average, and
every class gets the same average. With the scale corrected the same window
gives meadow, three grades of forest and two of built-up.

---

## Traps in the source data

Five of these cost real time, and all five are silent.

**An export's name says nothing about where it is, and its corner tile may not
exist.** The obvious index probes `<hash>-0000000000-0000000000.tiff` and skips
the export when that 404s. Thirty-one of the 208 exports in zone 33N have no
such tile, so fifteen per cent of the archive was invisible — and invisible in
the way that matters, because a window over one of them reported that the
dataset does not cover that ground. The bucket listing states exactly which
tiles exist, so the probe targets one that is there.

**Exports are not all the same size.** Most are a 2 × 2 grid of 8192-pixel
tiles, and in zone 33N alone there are 50 of two tiles, six of one and one of
three. Crediting an export with ground it does not have is the same failure
wearing the opposite face: the window is selected, the read comes back empty,
and the zone that really holds the data is never tried. An export's extent is
the union of the tiles it actually has.

**A raster's UTM zone is not always the zone its longitude names.** Tre Cime
sits at 12.28°E — eight hundredths of a degree inside zone 33's band — and is
distributed as ETRS89 / UTM 32N, which is what a surveyor working in the Alps
uses for the whole region. The script therefore tries the raster's own zone
first, then the zone the longitude names, then the neighbours, and the *read*
decides: a zone whose exports reach the lattice cell but not the window itself
reads back empty and the next candidate is tried.

**The tiles are south-up.** Their `ModelTransformation` carries a *positive*
north-south step, so raster row 0 is the southern edge and the row index climbs
northward. `gdalbuildvrt` refuses such files outright; `gdalwarp` handles them.
Worse, `geotiff.js` hardcodes the usual negation into `getResolution()`, so it
reports `−10` for a file whose real step is `+10` — while `getBoundingBox()`
reads the matrix and is correct. Read the matrix.

**The export grid is anchored at the false easting.** Export origins lie on a
163 840 m lattice anchored at 500 000, not at zero. Every arithmetic shortcut
that assumes a zero anchor picks the tile one column to the west. The script
intersects real extents instead, and caches what it probed under
`scripts/.ae-index/`.

**One tile is 3.65 GB**, carrying all 64 bands at 8192 × 8192. The app's GeoTIFF
loader reads the whole file into memory and then takes band 0, so opening one
directly is impossible — and opening a *small* embedding cube would be worse
than impossible, because band `A00` rendered as terrain is a confident landscape
made from one arbitrary axis of a machine-learned description. The loader now
refuses a file of that shape and says which script to run.

---

## Licence

The Satellite Embedding dataset is CC-BY 4.0 and requires this credit:

> The AlphaEarth Foundations Satellite Embedding dataset is produced by Google
> and Google DeepMind.

The string travels inside the plate file, so the app can show it without knowing
where the file came from. `utils/attribution.js` puts it into any export that
actually draws from the plate — the Land cover mode, or any layer with a class
mask set. A loaded plate that nothing draws from earns no credit, for the same
reason a hidden OpenStreetMap layer does not: it is not in the file.
