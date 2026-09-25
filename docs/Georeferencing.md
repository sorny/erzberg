# Georeferencing

A PNG heightmap is a grid of numbers. A GeoTIFF also says where on Earth the
grid sits, and in which coordinate system. erzberg uses that to:

- drape vector features on the terrain,
- query OpenStreetMap for the extent,
- suggest a proportional vertical exaggeration,
- report elevations in metres,
- put the sun where it really was,
- draw a measured scale bar and north arrow,
- and fetch terrain by place name.

A wrong metadata read fails silently: features do not appear, or a mountain
renders flat. The panel therefore states what it found.

---

## The projection readout

Under the mesh statistics, a GeoTIFF reports its CRS:

```
Elevation: 641 – 2350 m  (Δ 1708 m)
Projection: WGS 84 / UTM zone 33N (EPSG:32633)
```

The name comes from the file's citation geokey, or from a built-in table. A PNG
or a frozen soundscape clears the line. Where the read rests on an assumption,
the line says so:

| Suffix | Meaning |
|---|---|
| `· assumed UTM` | Projected, with no EPSG code. The UTM zone is inferred from the track longitude. |
| `· datum shift not applied` | Geographic CRS on an older datum (NAD27, ED50, MGI, DHDN). Off by 100–400 m. |
| `· GPX overlay unsupported` | The app cannot project into this grid. The raster renders normally. |
| `Not georeferenced` | No tie point, pixel scale or transformation. |

---

## Coordinate systems

GPX and GeoJSON coordinates are always WGS84 lon/lat. The app projects them
forward into the raster's grid. `classifyCRS` in `src/utils/geoCoords.js`
decides if that is possible.

### Supported

| Family | Codes | Accuracy |
|---|---|---|
| Geographic | 4326 WGS84, 4258 ETRS89, 4269 NAD83, 4283 GDA94, 7844 GDA2020, … | exact |
| Geographic, older datums | 4267 NAD27, 4230 ED50, 4312 MGI, 4314 DHDN, … | flagged, 100–400 m |
| Web Mercator | 3857, 3785, 900913, 102100, 102113 | exact |
| UTM — WGS84 | 326xx north, 327xx south, zones 1–60 | exact |
| UTM — ETRS89 | 258xx, zones 28–38 | exact |
| UTM — NAD83 | 269xx, zones 1–23 | exact |
| UTM — NAD27 | 267xx, zones 3–22 | flagged, datum shift |

Modern datums agree within a metre or two, so no shift is applied. UTM uses the
Transverse Mercator series on the WGS84 ellipsoid. Zone ranges are bounded per
family, so EPSG:32661 (UPS North) is not read as zone 61. The longitude
difference is wrapped to ±180° before the series, so zones at the dateline
project correctly.

### Not supported

The app names and declines national grids: Austria Lambert (31287), the Austrian
Gauss-Krüger strips (31254–31259), Swiss LV95 (2056), OSGB (27700), Lambert-93
(2154), LAEA Europe (3035) and World Mercator (3395). They need Lambert or
Gauss-Krüger maths plus a datum shift. An unshifted overlay sits hundreds of
metres off and still looks right. Reproject instead:

```sh
gdalwarp -t_srs EPSG:4326 in.tif out.tif
```

Reprojection does not change how the terrain renders. See
[Vertical exaggeration](#vertical-exaggeration).

---

## Vector layers

With a georeferenced raster, **Vector Layers** drapes WGS84 features from three
sources:

| Source | What arrives |
|---|---|
| **OpenStreetMap** | A checklist of categories, then one Overpass query over the extent. |
| **GeoJSON** | One file, bucketed by geometry class (RFC 7946, WGS84). |
| **GPX** | Track points, or route points as a fallback. Waypoints are ignored. |

Every source becomes the same packed form (`utils/vectorLayers.js`). Each bucket
becomes a **layer** with colour, weight, opacity, dash, visibility and an
optional area fill. Layers are ordinary `lineGeo` entries, so they get the
renderer, ghost occlusion and every exporter for free.

### The stack

The top row is the front of the scene. Drag a row by its grip, or focus the grip
and press ↑ or ↓. A fetch arrives with peaks and roads on top and landuse at the
bottom. An upload lands on top.

Reordering is not a rebuild. The worker's key for the stack is sorted
(`vectorBuildSignature`), so it stays a cache hit. The main thread turns the
stack into paint order (`merged` in `hooks/useTerrainGeometry.js`) and then
`renderOrder`. Inside a layer, fill sits under outline, and outline over its
ghost. An opaque fill stays in the blended pass, so it still obeys the stack.

A preset writes styles in stack order with `vectorStackOrder: true`. Older
presets without the flag apply styles but not order.

### Asking OpenStreetMap

The query needs the **inverse** projection. `EPSG:projected-unknown` cannot be
inverted (the forward path guesses a zone from each point's longitude), so the
app refuses the query but still accepts uploads.

`bboxToWgs84` samples nine points, not four corners, because a projected extent
bows in WGS84.

The app sends one query per fetch with `out geom`, caches identical queries, and
tries the next mirror on a 429 or 504.

#### Detail tiers

A large extent holds far too much. 1 250 km² around Graz holds 97 092 road ways.
All of Styria at default settings is about 1.2 million elements and 1 GB. The
extent area picks a tier:

| Tier | Extent | What narrows |
|---|---|---|
| `full` | under 2 500 km² | nothing |
| `mid` | 2 500 – 22 500 km² | no footways, tracks, ditches or drains. Woods and lakes over 1 km perimeter |
| `broad` | over 22 500 km² | trunk roads, rivers and canals, woods and lakes over 3 km, no trams or pistes |

Both levers run on the server: fewer tag values, and `(if:length() > n)` to drop
small polygons. Relations are never length-filtered. The panel shows the tier,
and one click forces `full`.

Above 2 500 km², the fetch runs `out count;` first, and refuses an undrapeable
extent in seconds. A second count per category names the heaviest one.

Each attempt has one deadline over headers and body, above the server's
`[timeout:180]`. Overpass sends headers only when the query finishes, so a
separate header timeout would kill legitimate slow queries.

#### Progress

- **Before the first byte**, nothing is measurable. The panel shows elapsed time
  against the server budget.
- **During download**, the body is read as a stream. The total is a declared
  length, or the pre-flight count at about 1.1 kB per element. The bar is
  clamped below its end, so an estimate that runs short stalls rather than
  overshoots.
- **`JSON.parse`** blocks. Its label is set before it runs.

OSM data is ODbL. The credit shows in the panel and in every export that
carries OSM data.

### Draping

Each vertex is projected into the raster CRS, converted to fractional pixels,
and lifted by bilinear sampling.

- **Simplify** with Douglas–Peucker at half a pixel first.
- **Densify** every edge to one grid step, so a straight road follows a ridge
  instead of cutting through it.

A vertex outside the extent or over NoData breaks the run, and the line resumes
on the far side.

A vector layer has one flat colour, so a recolour costs a frame. There is no
hypsometric tint, because a feature has no elevation of its own.

### Individual features

Expand a layer to see its features, each with a checkbox. Named features sort
first. Others get a stable label such as `Track #118`. A filter box and a row
cap keep large layers fast.

Rest the pointer on a feature to name it and light it up. A click selects it
and scrolls to its row. Hovering a row does the same from the panel.

- `packBucket` keeps each feature's `name`, a short `note` (a peak's height, a
  road number) and its OSM id.
- `buildVectorGeometry` emits `featureOfSegment`, which turns a raycast segment
  index into a feature.
- The picker owns its raycaster, instead of R3F events that would raycast every
  line layer on every pointer move. Hover waits for pointer rest. A drag stays
  an orbit. **Identify on hover** turns picking and both highlights off. Click a
  selected row to clear it.

**Pick radius.** three.js tests
`distance < (material.linewidth + threshold) / 2`, so the threshold is set per
layer. Points get 20 px and win ties. At a fixed threshold of 6, a peak had a
0.5% hit rate, against 9.5% now.

`hidden` stores source indices, so hiding a feature never renumbers the rest.

**Area fills** are a lattice in pixel space, not a triangulation. Each corner
has its own elevation, so fills follow the slope. The even-odd rule gives holes
and multi-part polygons for free. The step is chosen per layer from its area.

### Point features as icons

An icon replaces a point's dot, in the viewport and in every export. The set is
sixteen [Maki](https://labs.mapbox.com/maki-icons) marks (CC0): summit,
mountain, volcano, viewpoint, refuge, campsite, tree, water, map pin, waypoint,
danger, cross, star, circle, square and x. They live in `public/icons/` as
unmodified upstream files. Each is normalised to a unit box and drawn at the
layer weight. You can also upload your own SVG.

- **Fill is on by default**, in the layer colour and opaque, on the first pick
  only. The SVG writes outlines only.
- **Holes are cut.** Rings are sorted by containment, not winding. A ring inside
  an odd number of rings is a hole of the smallest ring that contains it.
  Triangulation is `ShapeUtils.triangulateShape` (earcut with holes).
- Use solid Maki variants, not `-stroked`. A stroked ring flattens to two rings.
- Glyphs cost 10 (`star`) to 111 (`danger`) segments. Past
  `MAX_ICON_SEGMENTS`, a layer keeps its dots and says so.

**Orientation.** The icon plane comes from azimuth θ and elevation φ:

$$R = (\cos θ,\; 0,\; -\sin θ) \qquad
  U = (-\cos φ \sin θ,\; \sin φ,\; -\cos φ \cos θ)$$

With **Face camera** on, θ and φ are the camera's `rotation` and `tilt`. Off,
they are sliders, and **Match view** copies the camera. **Lift** raises the icon
on a leader line.

The icon layer keeps a rebuilt `featureOfSegment` and the point pick radius. Its
geometry has `isPoints: false`, so the SVG writes strokes.

### Labels

A point can show its `name` and its `ele` height as labels. They are real
geometry in the layer's `positions`, with their own pen layer in the SVG (for
example `Peaks · labels`). A feature without a name or height gets no label, and
the panel shows the count ("18 of 29 named").

- **Space Mono**, the logo face (SIL OFL 1.1), in regular, bold, italic and bold
  italic. Each face loads only when used.
- `scripts/build-font.js` converts the TTF with `opentype.js` into path data
  (`public/fonts/space-mono-*.json`, 213 glyphs, about 68 kB). It refuses a
  proportional font, because layout is a monospace cursor.
- **Single-line faces** come pre-flattened from
  `scripts/build-single-line-fonts.js`. See the README.
- **Size**, **Offset ↔ / ↕** and **Align** place the text on the label plane,
  which is the icon plane. A second line sits 1.25 em below.
- **Fill** draws solid type with counters cut out.
- A layer whose labels exceed 80 000 segments draws none and says so.

Text that the data does not supply is a **text layer** instead.

### Ink

An icon and a label each have their own **Colour**, **Stroke**, **Opacity**,
**Fill**, **Fill Colour** and **Fill Op.** `layerStyle` resolves `vec:7#icons`
and `vec:7#labels` through the same cascade. The layer's own values do not fit:
a point layer's `weight` is its dot diameter. Everything but stroke width starts
`null` (inherit the layer). **Match layer** resets them. A mark's fill falls
back to its own stroke colour first.

**Stroke: Outside or Centred.** `LineMaterial` only strokes centred, in screen
pixels. For Outside, the app draws the line at twice the width and draws the
fill over the inner half. The control appears only with a fill.

A mark's fill writes no depth, and `renderOrder` decides. Fill and stroke share
one `polygonOffset`, deeper than an area fill's, so the terrain cuts both in the
same place. The SVG writes the width the slider says.

### Flattening SVG

`utils/svgFlatten.js` has no path parser. Every drawable SVG element is an
`SVGGeometryElement`, so `getTotalLength()`, `getPointAtLength()` and `getCTM()`
handle all shapes and transforms. Samples then go through `simplifyFlat`.

- Subpaths are split by spatial discontinuity, not by parsing `d`. A genuine
  segment sampled at step `s` never moves more than `s`.
- These APIs need a rendered document, so icons are built on the main thread.
  This also makes size, lift and orientation cost a frame.

### What a preset carries

`vectorStyles` holds each layer's style, keyed by `bucket`. Three things are
left out, because they are data, not look:

- `hidden` (feature indices).
- `iconCustom` (typed arrays that JSON cannot round-trip). `icon` falls back.
- Stack order, unless `vectorStackOrder: true` is set.

### When the features do not appear

| Report | Cause |
|---|---|
| *…is not one this tool can place WGS84 features in* | Unsupported CRS. Reproject. |
| *This GeoTIFF carries no georeferencing* | No tie point, pixel scale or transformation. |
| *…its extent cannot be turned into an OpenStreetMap query* | Forward-only CRS. Uploads still work. |
| *None of the N loaded vertices fall inside this GeoTIFF* | The features are somewhere else. |
| *N of M vertices fall inside* | Partial overlap. Not an error. |

- A GPX point needs `lat` and `lon` to be present. `+null` is 0, which is a real
  place.
- An `<ele>` of 0 is kept.
- `<trkseg>` boundaries are kept apart.
- A GeoJSON with a non-WGS84 `crs` member is refused, with the `ogr2ogr`
  command to fix it.

### Exports

| Export | Vector layers |
|---|---|
| SVG | One named Inkscape layer per vector layer. Icons in their own `· icons` layer. Area fills are omitted, outlines stay. |
| PNG / PNG α / WebM | Yes, as rendered. |
| STL | Layers with **STL ribbon** on, as `<base>-vectors.stl`. Default on for GPX, off for OSM and GeoJSON. |
| Heightmap PNG | No. |

---

## Terrain by name

*Fetch*, in the Terrain stage, turns a place name into terrain with two
requests.

**The place.** Nominatim turns a name into a bounding box, on submit only, as
its usage policy asks. `geocodePlace` reorders its
`[minLat, maxLat, minLon, maxLon]` box once.

**The ground.** Terrain Tiles on AWS Open Data, terrarium encoding:

$$h = 256R + G + \frac{B}{256} - 32768$$

Tiles are EPSG:3857, so a fetched raster is georeferenced like a GeoTIFF.
Terrarium includes bathymetry, so the ocean is data.

### Placing the box

Picking a result aims a box on a map. Drag the middle to move it, a corner to
resize it. **Wider** and **Closer** zoom the map.

The map is not a basemap. `utils/extentPreview.js` draws it from the same
terrarium tiles, hillshaded at 315°/45° over a hypsometric tint. That adds no
host and no pan-time requests (`tests/no-third-party.spec.js`), and it shows
exactly the data that the fetch will get. The preview uses up to nine tiles.

Four figures sit under the map, from `describeFetch`, the same function the
fetch runs:

```
Zoom     14 · deepest
Tiles    12 / 36
Raster   1024 × 768 px
Ground   6.4 m / px
```

A smaller box gives a sharper raster, not a smaller one. On one drag,
931 × 937 at 13 m/px became 1 230 × 821 at 6.4 m/px.

### Budget

One fetch pulls at most 36 tiles (about a 1 536 px raster). The zoom is the
finest that fits, capped at 14, because the data is about 30 m at best. Tiles
are fetched one at a time, so progress is real and Cancel works between any
two.

`padBbox` grows a small box (a summit node) to at least 6 km, padded separately
per axis so it is square on the ground.

### Provenance

Each tile reports its survey in `x-amz-meta-x-imagery-sources`. The panel
prints the surveys that produced the ground on screen, for example
`eudem/eudem_dem_5deg_n45e010.tif`.

### Extent readout

*Source → Extent* states the ground that all layers share: place, degrees
(`bboxToWgs84`), size (`wgs84ExtentKm`), CRS (`crsDisplayName`) and metres per
pixel (`groundPixelMetres`), then one row per layer:

```
Eiger
7.927° E – 8.084° E · 46.523° N – 46.632° N
12.0 × 12.0 km · Web Mercator (EPSG:3857) · 13 m/px

● Elevation      915 × 921
  Terrain Tiles · eudem/eudem_dem_5deg_n45e005.tif
○ Imagery        none    Not fetched · Surface › Imagery
○ Map features   none    Not fetched · Overlay › Vector Layers
○ Land cover     offline only
```

Both loaders set `terrainProvenance`. The readout is read-only. Land cover says
*offline only*, because its bucket sends no CORS header. See
[Land cover](Land-Cover.md).

### Web Mercator scale

Web Mercator inflates distance by 1/cos(lat) on both axes. Ratios are
unaffected. Measurements are corrected in two places:

- `useHeightmap.loadDem` passes the true ground size to the exaggeration
  suggestion. Without it, an alpine DEM is a third too flat.
- `groundPixelMetres` measures through WGS84.

---

## The sun

Hillshade's default 315°/45° is the cartographic convention, and a position the
real sun never reaches at the Erzberg's latitude (it turns back at about 307°).
The convention stays the default, and **Almanac** mode sits beside it.

`src/utils/solar.js` implements the NOAA solar position polynomials (Meeus,
*Astronomical Algorithms*, ch. 25), with no dependency. Unit tests check it
against solstice declinations, the equation of time and a real sunrise.

$$\text{TST} = 60t + E + 4\lambda - 60z$$

$t$ is the clock in hours, $E$ the equation of time in minutes, $\lambda$ the
longitude and $z$ the zone offset. The hour angle is $\text{TST}/4 - 180$.
Atmospheric refraction is applied to the altitude.

The computed pair overrides `hillshadeAzimuth` and `hillshadeAltitude` on the
parameter bus in `App.jsx`. It is never written into `style`, so the sliders
keep their values and undo is not flooded. Below the horizon, the altitude
clamps to zero and the panel says *below the horizon*. A PNG has no location, so
the panel asks for one.

**Sun Hours** and **Shadow Line** use the same solar code. Their maths is in
[Draw modes](Draw-Modes.md#34-sun-hours). Two limits are stated in the panel:

- Every azimuth is a true bearing.
- Shadows follow the exaggerated terrain. At the exaggeration a GeoTIFF
  suggests, the hours are real. A raised relief lengthens them. The panel
  prints the current exaggeration.

---

## Scale and north

`measureScale` projects the origin and both ground axes, then solves for the
world displacement whose screen image is one pixel to the right:

$$\begin{bmatrix} \Delta x_x & \Delta z_x \\ \Delta x_y & \Delta z_y \end{bmatrix}
\begin{bmatrix} a \\ b \end{bmatrix} = \begin{bmatrix} 1 \\ 0 \end{bmatrix}$$

The result is $\sqrt{(a g_x)^2 + (b g_y)^2}$ metres, with $g$ the ground size of a
raster pixel. It is exact for an orthographic camera and correct at the centre
for a perspective one. An edge-on view returns null.

- The panel states the tilt, because a tilted plate has no single scale.
- The **ratio** (1:25 000) needs the sheet width in mm, set in Export.
- `sheetMarks` returns shapes (segments, rectangles, text runs) in screen
  pixels. The viewport, SVG and PNG each draw them in their own pixels.
- The PNG compositor draws the marks into the trim mask too, or the trim would
  crop them.

---

## Vertical exaggeration

A GeoTIFF gets a suggested `elevScale`, so terrain starts at roughly true
proportions. The mesh lays one step per pixel column and spans
`100 × elevScale` units vertically:

$$\text{elevScale} = \frac{\text{elevation range}}{100 \cdot \text{ground pixel width}}$$

clamped to 0.1 … 50.

A projected CRS reports pixel size in linear units (`ProjLinearUnitsGeoKey`,
including international and US survey feet). A geographic CRS reports degrees,
converted at the raster's latitude. The decision is by CRS, never by magnitude,
because sub-metre lidar is legitimately below 1.

A 10 m UTM raster and its `gdalwarp -t_srs EPSG:4326` copy give relief
(`elevScale / columns`) within 0.4%:

| | CRS | columns | elevScale | relief |
|---|---|---|---|---|
| original | EPSG:32633 | 1200 | 1.71 | 1.4250 |
| reprojected | EPSG:4326 | 1297 | 1.84 | 1.4187 |

---

## NoData

The app reads the void value from `GDAL_NODATA`. Rasters that declare nothing
fall back to −9999, −32767, −32768 and the positive float maximum. The negative
float maximum (`-3.4028235e+38`, GDAL's float default) is not in that set, so
the tag must be read. One unmasked void sets the normalisation floor and flattens
the terrain.

Masked pixels are excluded from the surface, the auto-zoom framing and the STL
base plate.

---

## Cover plates

A cover plate states its extent and projection, and `alignCover` refuses one
that does not match.

- **Same dimensions**: copied pixel for pixel.
- **Different grids**: resampled through the extents, nearest-neighbour, because
  a class index has no average. This is the usual case for rasters finer than
  10 m. See [Land cover](Land-Cover.md#what-resolution-the-plate-is-cut-at).

Alignment is derived on each change, so an Edit Mode crop cannot leave a stale
plate. `scripts/embed-window.js --dem` goes the other way, mapping each output
pixel back through WGS84 and UTM to the nearest embedding.

## Satellite imagery

A Sentinel-2 scene is in its own UTM zone. `mapperFor` in `imageryFetch.js`
maps linearly when both grids share a projection, and through WGS84 otherwise
(about 40 times the cost). The scene window uses the output's corners and edge
midpoints. Output is capped at 2048 px on the long side.

---

## Implementation

| File | Role |
|---|---|
| `src/utils/geoCoords.js` | `classifyCRS`, forward and inverse projection, `bboxToWgs84`, `geoToPixel`, `featureCoverage`, `suggestElevScale`, `groundPixelMetres` |
| `src/utils/demFetch.js` | Geocoding, tile budget, terrarium decoding, stitch and crop |
| `src/utils/extentPreview.js` | The Fetch map |
| `src/utils/solar.js` | Solar position, sunrise and sunset, zone guess, sun-path sampling |
| `src/utils/sunHours.js` | Shadow sweep, hours field, lit field, fitted levels |
| `src/utils/sheetMarks.js` | `measureScale`, scale bar and north arrow shapes |
| `src/hooks/useHeightmap.js` | GeoTIFF decode, geokeys, NoData, CRS detection |
| `src/utils/vectorLayers.js` | Packed source and layer records |
| `src/utils/gpxParser.js`, `geoJsonParser.js` | File → vector source |
| `src/utils/osmCategories.js` | OSM catalogue: selectors, buckets, styles |
| `src/utils/osmFetch.js` | Overpass query, fetch, cache, bucketing |
| `src/utils/vectorGeometry.js` | Draping, simplification, densification, fills, `featureOfSegment` |
| `src/components/VectorPicker.jsx`, `VectorHighlight.jsx` | Pick and highlight |
| `src/utils/svgFlatten.js` | SVG → polylines |
| `src/utils/textGeometry.js` | Text → polylines |
| `src/utils/iconCatalogue.js`, `src/hooks/useVectorIcons.js` | Icon set, placement and orientation |
| `src/utils/stlExport.js` | Ribbon solids |

Main specs: `projection`, `vector`, `osm-detail`, `terrain-fetch`,
`sun-almanac`, `sun-hours`, `shadow-line` and `sheet-marks` in `tests/`.

### geotiff.js

`image.fileDirectory` is lazy. Tags are reachable only through `hasTag()` and
`getValue()`. A plain property read returns `undefined` without an error. All
tag access goes through one accessor that handles both this and the older
plain-object shape.

### Adding a CRS

Add the code to `GEOGRAPHIC_EXACT`, `GEOGRAPHIC_APPROX`, `MERCATOR` or a
`UTM_FAMILIES` block in `classifyCRS`. New maths also needs a branch in
`projectWgs84` with an honest `accuracy`, and one in `unprojectWgs84`, or the
OpenStreetMap query stays refused.
