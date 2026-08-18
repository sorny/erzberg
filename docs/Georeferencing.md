# Georeferencing

A PNG heightmap is just a grid of numbers. A GeoTIFF also says *where on Earth*
that grid sits and in which coordinate system, and `erzberg` uses that for four
things: draping vector features on the terrain, asking OpenStreetMap what is
inside the extent, suggesting a vertical exaggeration that is proportional rather
than arbitrary, and reporting the elevation range in real metres.

All four depend on reading the file's metadata correctly, and the failure mode
when that goes wrong is silence — features that do not appear, a mountain that
renders flat. So the sidebar states what it found rather than leaving you to
infer it.

---

## The projection readout

Under the mesh statistics at the bottom of the sidebar, a GeoTIFF reports its
coordinate reference system:

```
Elevation: 641 – 2350 m  (Δ 1708 m)
Projection: WGS 84 / UTM zone 33N (EPSG:32633)
```

The name comes from the file's own citation geokey where it has one, otherwise
from a built-in table; the EPSG code is always shown. The line appears **only**
for a GeoTIFF — a PNG heightmap and a frozen soundscape have no projection to
report, and both clear the field rather than inheriting a stale one.

Where the reading rests on an assumption, the line says so instead of implying a
precision it does not have:

| Suffix | Meaning |
|---|---|
| `· assumed UTM` | The file is projected but records no EPSG code. The UTM zone is inferred from the track's own longitude, which is right for a UTM tile and wrong for anything else. |
| `· datum shift not applied` | A geographic CRS on an older datum (NAD27, ED50, MGI, DHDN). Usable, but ignoring the shift costs 100–400 m. |
| `· GPX overlay unsupported` | The grid cannot be projected into at all. The raster still renders normally; only the track overlay is affected. |
| `Not georeferenced` | The file carries no tie point, pixel scale or transformation. Its "bounding box" is only the pixel grid. |

---

## Coordinate systems

A GPX file has no projection to declare — the format defines its coordinates as
WGS84 lon/lat, full stop. All the variety is on the GeoTIFF side, so placing a
track means projecting WGS84 *forward* into whatever grid the raster's bounding
box is stated in. `classifyCRS` in `src/utils/geoCoords.js` decides whether that
step can be made.

### Transformable

| Family | Codes | Accuracy |
|---|---|---|
| Geographic (lon/lat) | 4326 WGS84, 4258 ETRS89, 4269 NAD83, 4283 GDA94, 7844 GDA2020, … | exact |
| Geographic, older datums | 4267 NAD27, 4230 ED50, 4312 MGI, 4314 DHDN, … | flagged, 100–400 m |
| Web Mercator | 3857 and its aliases 3785, 900913, 102100, 102113 | exact |
| UTM — WGS84 | 326xx north, 327xx south, zones 1–60 | exact |
| UTM — ETRS89 | 258xx, zones 28–38 | exact |
| UTM — NAD83 | 269xx, zones 1–23 | exact |
| UTM — NAD27 | 267xx, zones 3–22 | flagged, datum shift |

Modern datums sit within a metre or two of each other, so no datum shift is
applied to them. The older ones are accepted but flagged, because ignoring their
shift is a visible error at raster resolution and that is worth saying rather
than hiding.

UTM uses the standard Transverse Mercator series on the WGS84 ellipsoid,
accurate to sub-metre within a zone. Zone ranges are bounded per family, so a
neighbouring code such as EPSG:32661 (UPS North) is not read as "zone 61".

The longitude difference feeding that series is wrapped into ±180° first. Two
longitudes subtract to a number, and that number is only an angular separation
once it is wrapped: zone 1's central meridian is −177°, so a point at +179° — 4°
to its *west* — subtracts to +356°. The series is a small-angle expansion, and A⁵
of 6.2 radians is not small, so the easting came back as −9.7 × 10⁸, the point
landed outside every raster, and it was dropped as ordinary out-of-bounds
clipping. The wrap is a no-op for every zone that does not meet the dateline.

### Not transformable

National grids — Austria Lambert (31287), the Austrian Gauss-Krüger meridian
strips (31254–31259), Swiss LV95 (2056), OSGB (27700), Lambert-93 (2154), LAEA
Europe (3035), World Mercator (3395) — are identified by name and declined.

This is deliberate. Placing them correctly needs Lambert or Gauss-Krüger maths
*plus* a datum shift, and for the MGI-based Austrian grids an unshifted overlay
would sit a few hundred metres off while looking entirely plausible. A wrong
overlay that looks right is worse than a message saying what to do:

```sh
gdalwarp -t_srs EPSG:4326 in.tif out.tif
```

Reprojecting does not change how the terrain renders — see *Vertical
exaggeration* below.

---

## Vector layers

With a georeferenced GeoTIFF loaded, the **Vector Layers** section drapes WGS84
features on the terrain from three sources:

| Source | What arrives |
|---|---|
| **OpenStreetMap** | A checklist of categories, then one Overpass query over the raster's own extent. |
| **GeoJSON** | One file, bucketed by geometry class. RFC 7946 fixes the coordinates as WGS84 lon/lat. |
| **GPX** | Track points (`<trk><trkseg><trkpt>`) first, route points (`<rte><rtept>`) as a fallback. Waypoints are not collected — they are unordered, and a track is what the overlay draws. |

Every source normalises to the same packed form (`utils/vectorLayers.js`), and
every bucket becomes one **layer** with its own colour, weight, opacity, dash,
hypsometric tint, visibility and — for areas — an optional fill. Layers are
`lineGeo` entries in every respect, so they inherit the live renderer, ghost
occlusion, hidden-line removal and the SVG, PNG and video exporters without any
of those knowing that OpenStreetMap exists.

### Asking OpenStreetMap

The extent has to leave the raster's grid before it can be a query, so this is
the one feature that needs the **inverse** projection, and the inverse is
narrower than the forward one. `EPSG:projected-unknown` is the interesting case:
the forward path guesses a UTM zone from the point's own longitude, and a
coordinate already in that grid has no longitude to guess from. Uploads still
work for such a raster; the OSM query is refused rather than aimed at the wrong
hemisphere.

`bboxToWgs84` samples nine points, not four corners. A projected extent is not a
rectangle in WGS84 — a line of constant northing peaks in latitude at the central
meridian — so an extent straddling its own CM has all four corners *below* its
true top edge, by a few kilometres on a wide tile.

Overpass is a volunteer service. One query per fetch, `out geom` so no second
pass is needed to resolve node references, identical queries answered from an
in-memory cache, and exactly one mirror tried on a 429 or 504. OSM data is ODbL:
`© OpenStreetMap contributors` appears in the panel whenever OSM layers are
loaded, and as a comment in every SVG export that carries them.

### Draping

Each vertex is projected into the raster's CRS, converted to fractional pixel
coordinates, and lifted onto the terrain by bilinear elevation sampling. Two
steps sit either side of that, and both exist because OSM data is *drawn* rather
than *recorded*:

- **Simplify** — Douglas–Peucker at half a pixel, before anything else. A
  digitised riverbank carries far more detail than a 30 m DEM can express.
- **Densify** — every edge is cut down to one grid step afterwards. A GPX track
  is sampled every few seconds and needs none of this; a straight motorway can
  run 400 m between nodes, and joining those two nodes with a single 3D segment
  puts the road through the ridge between them.

A vertex outside the extent, or over NoData, *breaks* the run rather than ending
it, so a road crossing a clipped corner reappears on the far side instead of
diving to the base plate.

A vector layer is drawn in **one colour**, with no per-vertex colour buffer, which
is what keeps recolouring one a frame rather than a worker rebuild. There is no
hypsometric tint: a feature has no elevation of its own — OSM carries none and a
GPX `<ele>` would disagree with the raster it is drawn on — so the tint could
only read the ground underneath, which is a different thing from what the
fourteen draw modes mean by it.

### Individual features

A layer is not the smallest thing. Expanding one reveals its features, each with
a checkbox, so five peaks can be kept out of twenty-nine. Named features sort
first; the rest get a stable `Track #118`, because a real alpine fetch names 52
of 621 tracks and none of 245 scrub polygons, and a blank row is nothing to point
at. A filter box and a cap on rendered rows keep a 621-feature layer from
becoming 621 DOM nodes inside a scrolling panel.

**Identifying one on the terrain.** Resting the pointer over a feature names it
in a tooltip and lights it up; clicking selects it, opens its layer, and scrolls
its row into view. Hovering a row does the same thing from the other end — both
write one piece of state, so neither knows about the other.

Three things make that work:

- `packBucket` keeps each feature's `name`, a short `note` (a peak's height, a
  road's route number) and its OSM id. The tags used to be read to choose a
  bucket and then dropped, which is what made a feature impossible to name.
- `buildVectorGeometry` emits `featureOfSegment`, one entry per drawn segment.
  `LineSegments2.raycast` reports the segment index it hit, and this turns that
  into a feature — the single link between a pixel and a row.
- The picker owns its raycaster rather than using R3F's event system, which would
  raycast every line layer on every pointer move. Raycasting a `LineSegments2` is
  O(segments) and the bounding-sphere early-out never helps here, since every
  layer's sphere covers the whole raster. So hovering is debounced to
  pointer-rest, a click picks immediately, and a drag stays an orbit because the
  click path measures how far the pointer travelled. **Identify on hover** turns
  the whole thing off for a fetch dense enough to make even that too expensive.

**Pick radius.** Three does not take one: it tests
`distance < (material.linewidth + threshold) / 2` in CSS pixels, so the threshold
is worked backwards from the radius wanted and depends on how thick each layer is
drawn — which means setting it *per layer* rather than once for the raycaster. A
point gets the larger radius, because a peak is a single dot with no length to
catch a passing cursor: at a fixed threshold of 6 a weight-5 peak had a 5 px
target, measured at a 0.5% hit rate across a sweep of the viewport against 9.5%
at the current 20 px. Points also win ties, so a summit sitting near a road it
does not belong to is still what you get when you point at the summit.

Hiding a feature never renumbers the rest — `hidden` names indices in the source,
not in whatever is currently drawn — so the checkbox under the cursor stays the
one that moves.

**Area fills** are rasterised into a lattice in pixel space rather than
triangulated. Every lattice corner takes its own elevation sample, so the fill
follows the slope instead of hanging over it as a flat lid, and holes and
multi-part polygons come free from the even-odd rule instead of needing a
triangulator. The step is chosen per layer from the area its polygons cover, so
a valley full of forest coarsens rather than truncating.

### When the features do not appear

Different failures all end as "points dropped for being out of bounds", and they
need different fixes, so they are reported separately:

| Report | Cause |
|---|---|
| *…is not one this tool can place WGS84 features in* | Untransformable CRS. Reproject the raster. |
| *This GeoTIFF carries no georeferencing* | No tie point / pixel scale / transformation in the file. |
| *…its extent cannot be turned into an OpenStreetMap query* | Forward-only CRS. Uploads still work. |
| *None of the N loaded vertices fall inside this GeoTIFF* | The projection worked. The features are simply somewhere else. |
| *N of M vertices fall inside* | Partial overlap; the rest are clipped. Not an error. |

A GPX point needs its `lat` and `lon` attributes to be *present*, not merely
numeric. `getAttribute` returns null for a missing one and `+null` is 0, so a
numeric test alone accepted a malformed `<trkpt>` as a point at (0, 0) — which is
not a sentinel but a real place in the Gulf of Guinea. Such a point counted in
the coverage report's total and never in its inside count, so a track that landed
perfectly on the raster reported back as only *partially* covered, blaming a
raster that was fine. An `<ele>` of exactly 0 m is likewise kept rather than read
as absent: sea level is data. Track segments are kept apart, because a `<trkseg>`
boundary is the recording pausing and joining two of them draws a line through
whatever lies between.

A GeoJSON carrying the old spec's top-level `crs` member naming anything other
than WGS84 is refused with the `ogr2ogr` command that fixes it, rather than drawn
in the wrong place.

### Exports

| Export | Vector layers |
|---|---|
| SVG | Yes — one Inkscape layer per vector layer, named, so a plot is separable by pen. Area *fills* are omitted: correct output would need painter-order depth sorting of thousands of triangles against the software Z-buffer, and this is a line-art format. Every filled area's outline is still there. |
| PNG / PNG α / WebM | Yes — they capture the rendered scene. |
| STL | Only for layers with **STL ribbon** on, written as `<base>-vectors.stl`. Default on for GPX layers, off for OSM and GeoJSON. |
| Heightmap PNG | No. It writes the elevation raster, not a picture. |

---

## Vertical exaggeration

On load, a GeoTIFF gets a suggested `elevScale` so the terrain starts at roughly
true proportions instead of an arbitrary height. The mesh lays one grid step per
pixel *column* and spans `100 × elevScale` world units vertically, so the figure
that has to be right is the **east–west ground size of one pixel**:

$$\text{elevScale} = \frac{\text{elevation range}}{100 \cdot \text{ground pixel width}}$$

clamped to 0.1 … 50.

A projected CRS already reports pixel size in linear units, converted to metres
via `ProjLinearUnitsGeoKey` (the international and US survey foot are handled).
A geographic CRS reports **degrees**, and converting those needs the latitude:
a degree of longitude is 111 320 m at the equator but only ~75 km at 47°N.

This is why reprojecting is safe. Measured on a 10 m UTM raster against
`gdalwarp -t_srs EPSG:4326` of itself — same terrain, same elevation range:

| | CRS | columns | elevScale | relief |
|---|---|---|---|---|
| original | EPSG:32633 | 1200 | 1.71 | 1.4250 |
| reprojected | EPSG:4326 | 1297 | 1.84 | 1.4187 |

Relief is `elevScale / columns`, the two agreeing to 0.4%.

The classification is by **CRS, never by magnitude**. A "value < 1 must be
degrees" test would mis-scale sub-metre lidar — legitimately < 1 in metres — by
~111320× and flatten it to the clamp floor.

---

## NoData

Voids are common in real elevation data: clipped catchments, SRTM holes, the
border a rotated footprint leaves after reprojection. A GeoTIFF declares its
void value in `GDAL_NODATA`, and that value is read from the file rather than
guessed. A small sentinel set — −9999, −32767, −32768 and the *positive* float
maximum — is a fallback for rasters that declare nothing.

That set is deliberately not a substitute for reading the tag. It does not
contain the **negative** float maximum, which is exactly what GDAL writes into
float DEMs (`-3.4028235e+38`), so a raster whose declared value went unread had
its voids treated as real ground 3.4e38 metres down. Masked pixels set the
min/max that normalises the heightmap, so a single unmasked void drags the floor
down and collapses the whole terrain into a plateau.

Masked pixels are also excluded from the rendered surface, the auto-zoom
framing, and the STL base plate.

---

## Implementation

| File | Role |
|---|---|
| `src/utils/geoCoords.js` | `classifyCRS`, forward and inverse projection, `bboxToWgs84`, `geoToPixel` / `geoToWorld`, `featureCoverage`, `suggestElevScale` |
| `src/hooks/useHeightmap.js` | GeoTIFF decode, geokey reading, NoData, CRS detection |
| `src/utils/vectorLayers.js` | The packed source / layer-record model shared by all three sources |
| `src/utils/gpxParser.js` | GPX → segments → a vector source |
| `src/utils/geoJsonParser.js` | GeoJSON → a vector source |
| `src/utils/osmCategories.js` | The OSM catalogue: selectors, buckets, default styles |
| `src/utils/osmFetch.js` | Overpass query, fetch, cache, bucketing |
| `src/utils/vectorGeometry.js` | Draping, simplification, densification, area fills, `featureOfSegment` |
| `src/components/VectorPicker.jsx` | Pointing at the terrain to identify a feature |
| `src/components/VectorHighlight.jsx` | Lighting up the hovered / selected feature |
| `src/utils/stlExport.js` | Ribbon solids for layers that ask for one |
| `tests/projection.spec.js` | CRS classification, projection maths, round-trips, coverage, load path |
| `tests/vector.spec.js` | Fetch → layers, hide/remove, fills, uploads, SVG export |

### A note on geotiff.js

`image.fileDirectory` is a **lazy object**: its own enumerable keys are
bookkeeping, and tags are reachable only through `hasTag()` / `getValue()`.
Reading a tag as a plain property returns `undefined` *without throwing*, so
every unit test passes while a georeferenced file reads as unreferenced and a
declared NoData value reads as absent. All tag access goes through one accessor
that handles both that shape and the older plain-object one.

### Adding a CRS

Add the code to the relevant table in `classifyCRS` — `GEOGRAPHIC_EXACT`,
`GEOGRAPHIC_APPROX`, `MERCATOR`, or a `UTM_FAMILIES` block — and it is picked up
by the renderer, the STL exporter and the sidebar readout together, since all
three ask the same classifier. A projection needing new maths also needs a
branch in `projectWgs84`, and should carry an honest `accuracy` if its datum
shift is unimplemented. Add the matching branch to `unprojectWgs84` too, or the
raster will drape uploads correctly and still refuse the OpenStreetMap query.
