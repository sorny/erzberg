# Land cover

Every draw mode reads the shape of the ground: slope, curvature, aspect, light.
A cover plate adds what each pixel *is*.

---

## The pipeline

```
                      ┌─ --dem your.tif ─→  <name>.landcover.json ─┐
AlphaEarth tiles  →───┤                                            ├─→  the app
   64 bands, 10 m     └─ --place "…"   ─→  <name>.tif              │    masks, ink
                                        +  <name>.landcover.json ──┘
```

### 1. Cut a window

If you have a GeoTIFF, use `--dem`. The extent and projection come from the
file, so the plate cannot drift from the pixels:

```bash
node scripts/embed-window.js --dem my-terrain.tif --classes 6
```

If you do not, name a place. The script writes terrain and plate from one
window:

```bash
node scripts/embed-window.js --place "Eisenerz" --km 4 --classes 6
```

| Flag | Meaning | Default |
|---|---|---|
| `--dem` | Match an existing GeoTIFF. Writes only the plate | — |
| `--place` | A place to centre on, via OpenStreetMap | — |
| `--bbox` | An explicit `lon,lat,lon,lat` box | — |
| `--km` | Window side for `--place` | 4 |
| `--year` | Embedding year, 2017–2024 | 2024 |
| `--classes` | Number of classes, 2–32 | 6 |
| `--out` | Output directory | `.` |
| `--name` | Output file stem | from the file or place |
| `--no-osm` | Skip OSM class names | — |

The raster does not need to be UTM. The script maps each output pixel through
your projection, WGS84 and UTM to the nearest embedding. Any projection that
`geoCoords.js` can invert works: geographic, Web Mercator and the UTM blocks.

### 2. Load both

With `--dem`, drop `<name>.landcover.json` on the window. Otherwise load
`<name>.tif` first, then the plate. With no plate loaded, the **Land Cover**
section prints the exact command for the raster on screen.

---

## Why a script, not a button

| Route | Anonymous read | Works in a browser |
|---|---|---|
| Earth Engine API | No: account, OAuth, Cloud project | No |
| `gs://alphaearth_foundations` | Yes: a ranged `GET` returns `206` | **No: no `access-control-*` header** |

The data is open, but the bucket sends no CORS header, so a browser cannot read
it. Only a proxy could fix that, and a proxy is a server. The script reduces the
data on your machine: one byte per pixel instead of 64.

---

## The file format

`kind: "erzberg.landcover/1"`

| Field | Meaning |
|---|---|
| `crs`, `bbox` | The ground covered, in its own projection |
| `width`, `height` | Its own grid |
| `classes[]` | `index`, `name`, `color`, `share`, `note` |
| `labels` | One byte per pixel, the class index. Deflated, then base64 |
| `plate` | Three bytes per pixel, the imagery colour. Deflated, then base64 |
| `variance` | Share of embedding variance held by the three colour axes |
| `attribution` | The CC-BY credit |
| `osmCredit` | The ODbL credit, when OSM named the classes |

Payloads are raw deflate, not PNG, so row order cannot be ambiguous.

The app refuses a plate that does not cover the raster's ground. Alignment is
re-derived when the raster changes, so an Edit Mode crop re-cuts the plate.

---

## How masking works

Every builder in `geometryBuilders.js` already checks `gridMask`, because a
GeoTIFF can have voids. A class filter is the same check on a mask with more
zeros:

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

No draw mode needed a change.

**Only `gridMask` changes.** `halfW`, `minElev`, `maxElev` and `maxSlope` stay,
because they are the frame every layer is drawn against. Re-measuring per class
would shift layers apart and give each its own colour ramp.

### Thirty-two classes

A layer's class selection is one signed 32-bit integer, one bit per class, so it
travels as one number through the parameter bus, presets, history and the
rebuild key. `fullMask` handles both edges: `(1 << 31) - 1` goes negative, and
`1 << 32` is 1. `decodeCover` refuses a plate with more than 32 classes.

**Ink by land class** names only the eight steepest classes. Six to eight
classes is the useful range.

---

## Seeing where they are

The Land Cover section draws the plate flat, at its own grid, in class colours.
Point at the map to name a class. Point at a legend row to light up its class.
One piece of state drives both. Other classes drop to low alpha, and the canvas
is `image-rendering: pixelated`, so no blended colour suggests a false class.

---

## Class names

The embedding axes have no names. The script asks OpenStreetMap which landcover
polygons cover the window, paints them onto the same grid, and tallies what each
class falls inside:

```
#d89f96   17%  Quarry · gentle    — OpenStreetMap: 90% quarry
#16b865   21%  Forest · moderate  — OpenStreetMap: 87% forest
#6b2552   16%  Forest · steep     — OpenStreetMap: 54% forest, 36% quarry
#849c50    9%  Built-up           — OpenStreetMap: 36% built-up, 19% quarry
#4d5dd5   24%  Quarry · steep     — OpenStreetMap: 51% quarry, 27% forest
#70db9b   13%  Quarry · moderate  — OpenStreetMap: 66% quarry, 16% grassland
```

- **A name needs 30% or more.** Otherwise the class is described by its terrain.
- **Repeated names get a terrain word** (gentle, steep) to tell them apart.
- **The runner-up is shown**, so you see which boundary to doubt.

The query includes `type=multipolygon` relations and stitches their member ways
into closed rings. The Erzberg mine is a relation. Without relations, no class
was named after it.

---

## Ink by land class

One press gives each class a mark, a class mask and the class colour. Marks are
ordered by the measured mean slope of each class: broken rock at the top, tone
and stipple at the bottom. Change any of them afterwards.

---

## The reduction

- **Normalise.** Values are `Int8` on an unstated scale. Every use is angular,
  so the scale does not matter.
- **Classes.** Spherical (cosine) k-means with deterministic seeding. The same
  window always gives the same classes.
- **Colour.** The window's three strongest principal axes as RGB, stretched at
  the 2nd and 98th percentiles.
- **Swatches** are the mean plate colour of each class.

---

## What resolution the plate is cut at

The embeddings are 10 m. The plate is cut on the raster's extent and projection
at 10 m, and `alignCover` upsamples it nearest-neighbour on load. A 4.2 m Graz
raster of 3804 × 2558 gets a 1902 × 1279 plate. Nothing is lost, because
nearest-neighbour upsampling keeps every class boundary.

OSM polygons are painted at plate scale, not raster scale. At the wrong scale,
every class got the same tally, which is the sign of this bug.

---

## Traps in the source data

All five fail silently.

- **Corner tiles may not exist.** 31 of the 208 exports in zone 33N have no
  `<hash>-0000000000-0000000000.tiff`. The script probes a tile that the bucket
  listing says exists.
- **Exports differ in size.** Most are 2 × 2 tiles of 8192 px. Some have one,
  two or three. An export's extent is the union of its real tiles.
- **A raster's UTM zone may not match its longitude.** Tre Cime (12.28°E) is
  distributed in UTM 32N. The script tries the raster's zone, the longitude's
  zone, then the neighbours, and the read decides.
- **The tiles are south-up.** `ModelTransformation` has a positive north-south
  step. `geotiff.js` `getResolution()` reports `−10` anyway. Read the matrix.
- **The export grid is anchored at the false easting**: a 163 840 m lattice from
  500 000. The script intersects real extents and caches probes in
  `scripts/.ae-index/`.

One tile is 3.65 GB with all 64 bands. The GeoTIFF loader refuses an embedding
cube and names the script to run.

---

## Licence

The dataset is CC-BY 4.0:

> The AlphaEarth Foundations Satellite Embedding dataset is produced by Google
> and Google DeepMind.

The credit travels inside the plate file. `utils/attribution.js` adds it to any
export that draws from the plate: the Land cover mode, or a layer with a class
mask.
