# Test fixtures

## `sweep.mp3` (committed)

This file drives `tests/soundscape.spec.js`. It is 6 s, mono, 44.1 kHz,
128 kbps. The signal is synthetic on purpose, so the spectrogram has a structure
that a test can assert on:

| Component | Appears as |
|---|---|
| Exponential sweep, 120 Hz → 8 kHz | A diagonal ridge |
| Steady 300 Hz tone | A horizontal ridge |
| 1.5 kHz bursts, 120 ms once a second | Vertical spikes at an even pitch |

We made the file in two steps. First we wrote a 16-bit PCM WAV of that signal.
Then we encoded the WAV with a LAME port. The macOS tool `afconvert` decodes MP3
but cannot encode it. The file is committed because the Soundscapes specs cannot
run without it, and because it is small.

The file also drives the whole-track projection specs. Its length has two
consequences. Read them before you read a result as a bug:

- **The weave is three rows.** The weave uses one row per bar, and 6 s at the
  detected tempo gives a small number of bars. A real track gives hundreds.
- **The similarity matrix defaults to 512², which is also the column count of
  the streaming window.** Thus the grid readout alone cannot tell a frozen
  matrix from the window that it replaced. That spec moves the Size control
  first, which gives the freeze a shape you can tell apart.

This fixture does not test the projection *maths* at all. A sweep has no repeats
and no beat grid to find. The spec `projections satisfy their structural
invariants` does that work instead. It imports the module through the dev server
and feeds it a synthetic 120 BPM signal with a chord cycle of four bars. Thus it
checks symmetry, tempo detection and the heightmap contract against a signal
with known answers.

## `geotiff.tif` (NOT committed)

This file drives the `GeoTIFF load path` block in `tests/projection.spec.js`. It
is 1200×700 px, EPSG:32633 (WGS 84 / UTM zone 33N), with 10 m pixels and Float32
values. Its elevation range is 641.36–2349.51 m. It declares a NoData value of
`-3.4028235e+38` but contains no NoData pixels.

Git ignores this file, so that block skips on a clean checkout. It does not
fail, because a missing fixture is not a regression. The block reports itself as
skipped, so the lost coverage stays visible.

To run the block, put any georeferenced GeoTIFF at `tests/testdata/geotiff.tif`.
The assertions name the CRS and the elevation range of this file. For a
different raster, update those values from its own `gdalinfo` output.

This fixture catches a class of bug that no unit test can catch. geotiff.js
gives `fileDirectory` as a lazy object. Its tags are reachable only through
`hasTag` and `getValue`. A read of a tag as a plain property returns `undefined`
and throws nothing. Thus every unit test passes while a georeferenced file reads
as unreferenced.

The CRS of this file is projected, and that is also the point. An EPSG:4326
raster still passes when CRS detection collapses back to its old lon/lat
default.

The reprojection-invariance case in the same spec needs no fixture, on purpose.
It pins `suggestElevScale` against numbers measured from this file, and against
numbers measured from `gdalwarp -t_srs EPSG:4326` of it. Thus the regression
stays covered even on a clean checkout.

## `benchmark.tif` (NOT committed)

`tests/benchmark.spec.js` needs a real GeoTIFF. Git ignores this file, as
`.gitignore` states, so that spec fails on any clean checkout. This is a missing
fixture and not a regression. To run the spec, put any GeoTIFF at
`tests/testdata/benchmark.tif`.

## Vector layers

`tests/vector.spec.js` needs `geotiff.tif` and nothing else. It never calls
Overpass. The spec routes `**/api/interpreter` to a small inline fixture. Thus
the suite does not depend on a volunteer service, and it costs that service no
query per run.

The fixture takes its coordinates from the bounding box of the raster at run
time. Thus a different GeoTIFF at that path still gives features that land on
the raster.
