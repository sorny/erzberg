# Edit Mode

Edit Mode clips the loaded raster before it becomes terrain: a crop rectangle,
a free-hand lasso, a polygon, or an ellipse. It applies to every source — PNG,
GeoTIFF and Soundscapes — because all three write the same store slot, and it is
non-destructive: the raster as loaded is kept, so the clip can be adjusted or
dropped at any time.

Press `E`, or use the ✂ button under the loader.

---

## Source vs. derived

The store holds the raster twice.

```
  loader ──> srcPixels / srcMask / srcWidth / srcHeight     (exactly as loaded)
                        │
                        ├── edit === null ──> the same arrays, untouched
                        │
                        └── applyEdit() ──> heightmapPixels / nodataMask
                                            heightmapWidth / heightmapHeight
                                            geoTiffBbox
                                                    │
                                                    └──> useTerrainGeometry ──> worker
```

Everything downstream — the geometry worker, all fifteen draw modes, hillshade,
erosion, the exporters, the elevation profile — reads only the derived names and
knows nothing about clipping. With no clip the derived fields *are* the source
arrays, so the feature costs nothing until a selection exists.

Keeping the source is what makes three things work:

- **Re-entering** Edit Mode shows the full raster with the selection still live.
- **Clear** restores the whole heightmap, with no reload.
- A **streaming Soundscape** keeps its clip. Each pushed frame is a new *source*,
  re-clipped on the way through.

An `edit` is expressed entirely in source pixel coordinates, so it is
independent of zoom, window size and device pixel ratio:

```js
{ rect: {x, y, w, h}, shape: Shape | null, feather: px }

// a Shape is a ring of points, or an ellipse:
{ type: 'lasso'|'polygon', points: [x0,y0,x1,y1,…] }
{ type: 'ellipse', cx, cy, rx, ry }
```

### When the clip is dropped

`setHeightmap` clears the edit whenever the source is replaced, because a
rectangle in the old raster's coordinates means nothing in a new one. The single
exception is `opts.keepEdit` at *unchanged dimensions*, which only
`useSoundscape`'s `pushFrame` passes: consecutive windows are the same picture at
the same size. Freezing a whole track, or changing the window width, changes the
dimensions and so drops the clip through the same rule — the store needs no
knowledge of soundscapes to get that right.

---

## Centring is free

`buildTerrain` already derives the mesh's origin from the bounding box of
*valid* cells, not from the raster's dimensions:

$$\text{halfW} = \frac{(c_{\min} + c_{\max}) \cdot \text{scl}}{2}, \qquad
  \text{halfH} = \frac{(r_{\min} + r_{\max}) \cdot \text{scl}}{2}$$

where $c_{\min} \ldots r_{\max}$ span the cells whose mask is 1. A selection
expressed as a NoData mask is therefore centred by code that already exists, and
every draw mode already skips masked cells — the same machinery a GeoTIFF's voids
have always used.

Note what those two are, because the names invite the wrong reading: they are the
**midpoint** of the valid range, an offset that puts its centre at the origin via
$x = c \cdot \text{scl} - \text{halfW}$. They are not half-extents. On the full
grid the distinction is invisible, since $c_{\min} + c_{\max}$ and
$c_{\max} - c_{\min}$ both come to $\text{cols} - 1$ — which is exactly why a crop
is the only thing that can expose code confusing the two. `buildTerrain` also
returns the genuine half-extents as `spanHalfW`/`spanHalfH`:

$$\text{spanHalfW} = \frac{(c_{\max} - c_{\min}) \cdot \text{scl}}{2}, \qquad
  \text{spanHalfH} = \frac{(r_{\max} - r_{\min}) \cdot \text{scl}}{2}$$

Anything that wants a *size* — a radius, a containment bound — wants these. The
murmuration read `halfW` as a size and, on an off-centre crop, flew off the data;
see [Murmurations.md § Two scales](Murmurations.md).

Skipping masked cells turned out not to be the whole story, though. The raster
stores $0$ in them, and $0$ is the *darkest* ground rather than absent ground, so
anything that read a masked cell without meaning to — a bilinear tap straddling
the edge, a blur window overlapping it, a finite-difference stencil reaching into
it — pulled the terrain toward the bottom of the scene and drew the border of the
selection instead of the landscape. That is fixed in the builders themselves;
see [Draw-Modes.md § NoData and clipped edges](Draw-Modes.md#nodata-and-clipped-edges).

The output raster is additionally **cropped to the selection's bounding box**
(the crop rect narrowed to the shape's extent), so the geometry grid shrinks with
the selection rather than carrying a mostly-empty raster: a clip to a quarter of
the image is a quarter of the cells, and rebuilds get proportionally faster.
After Apply the view refits exactly as a fresh load does — `autoZoom` plus
`autoResolution` — because a crop is a different picture.

---

## Rasterizing a selection

### Rings

Lasso and polygon differ only in how their vertices are collected; both end as a
closed ring filled with the even-odd rule. For each row, the ring's edges are
intersected with the row's centre line $y_c = y + \tfrac{1}{2}$:

$$x = x_i + \frac{y_c - y_i}{y_j - y_i}\,(x_j - x_i) \quad \text{for every edge straddling } y_c$$

The crossings are sorted and filled in pairs. Sampling at pixel *centres* rather
than corners is what keeps a hand-drawn rectangle from gaining a half-pixel
fringe, and the pair-wise fill handles concave and horseshoe shapes (four or more
crossings on one row) without a special case.

A lasso emits a vertex per pointer move, thinned to one per ~3 screen pixels
while drawing and then run through Douglas–Peucker (`simplifyFlat`, shared with
the contour smoother) at ~1.5 screen pixels when the stroke is released. The
decimation is invisible on screen and typically cuts the count by 5–10×, which
matters twice over: the scanline fill has fewer edges to cross, and what comes
back is few enough vertices to edit by hand.

### Ellipses

An ellipse is stored as an ellipse — `{cx, cy, rx, ry}` — not as a ring of
sampled points. A 128-gon shows visible flats once the raster is a few thousand
pixels wide, and the implicit form is both exact and cheaper: solving

$$\left(\frac{x - c_x}{r_x}\right)^2 + \left(\frac{y - c_y}{r_y}\right)^2 \le 1$$

for $x$ gives the filled span of each row directly, so the fill touches only the
pixels it sets rather than testing the $4/\pi$ of the bounding box it does not.

The raster's own voids (GeoTIFF NoData, transparent PNG pixels) are folded into
the same mask, so a void's edge feathers like any other edge.

---

## Feather as an elevation ramp

The geometry pipeline's mask is binary — a cell is ground or it is not — so a
partial selection weight has nowhere to live in it. Feathering therefore acts on
the *value*:

$$d = \text{distance to the nearest unselected cell}, \qquad
  t = \min\!\left(1, \frac{d}{f}\right), \qquad
  w = t^2(3 - 2t)$$

$$v' = v_{\text{floor}} + (v - v_{\text{floor}})\, w$$

where $v_{\text{floor}}$ is the lowest value inside the selection. The clipped
edge melts down to the terrain's own base level instead of ending in a cliff —
which is what a feathered cut should look like, and what keeps a clipped STL
sitting flat.

$d$ comes from a two-pass chamfer distance transform (straight step 1, diagonal
step $\sqrt{2}$), with everything past the edge of the crop counted as
unselected, so a plain crop feathers against its own border. The approximation is
well under a pixel of error, which is invisible in a gradient at least a few
pixels wide. At `feather: 0` the transform is skipped entirely.

### Caching

`buildEditMask` — the rasterized ring, the distance field and the derived weights
— depends only on the *shape* of the edit and the raster's dimensions, never on
the pixel values. It is memoised in the store, so a Soundscape streaming 30 new
rasters a second under an unchanged selection pays only the per-pixel copy.

---

## Georeferencing

Cropping moves the raster's corners, and `geoToPixel` reads the bounding box as
the extent of the *whole* raster. The derived bbox is therefore the source bbox
interpolated linearly over the crop rectangle (north up, matching the mapping
that function already assumes):

$$x'_{\min} = x_{\min} + \frac{r_x}{W}\,\Delta x, \qquad
  y'_{\max} = y_{\max} - \frac{r_y}{H}\,\Delta y$$

Without it vector layers would keep being projected against an extent that no
longer exists, and would land in the wrong part of the terrain — silently, since
points outside the raster are dropped as ordinary clipping.

Pixel values are **not** renormalised by a crop. They were normalised against the
file's own min/max at load, so the elevation readout, the elevation cuts and the
STL's vertical scale all stay true to the file rather than drifting with each
selection.

---

## Erosion under a clip

Hydraulic erosion runs on what is on screen — the derived, clipped raster — and
its result is scattered back into the source at the clip's position, so the clip
stays live and editable afterwards. Cells inside the feather ramp are skipped, so
the ramp is not baked into the source and re-ramped on the next run.

---

## Interaction notes

- **Crop**: drag to draw, drag inside to move, eight handles to resize, aspect
  locks (Free / 1:1 / 4:3 / 16:9 / source) and numeric X/Y/W/H fields. While the
  rect still covers the whole raster, a drag inside it draws a new one — there is
  no outside to start from, and moving it could not go anywhere. Shift forces a
  new rect at any size.
- **Ellipse**: drag out its bounding box; hold **Shift** for a perfect circle,
  which works while drawing *and* while resizing because the modifier is read on
  every pointer move rather than latched at the start of the drag. Drag inside to
  move it, or use the same eight handles the crop has.
- **Polygon**: click to place vertices; close with the first vertex, `Enter`, or a
  double-click. `Backspace` removes the last vertex.
- **Editing a committed ring**: a lasso or polygon stays editable after it is
  closed, so a selection that came out nearly right does not have to be redrawn.
  Drag a vertex to move it, drag an *edge* to split it and pull the new vertex
  out in the same gesture, right-click a vertex to remove it (never below the
  three that still enclose something). The vertex handles are drawn whenever a
  ring exists and a ring tool is selected — the crop and ellipse tools have their
  own handles in the same places, so they take over the pointer instead.
- **The cursor names the grab.** A handle is 7–8 screen pixels on a busy
  greyscale raster, which is not much to aim at, so the pointer says what a press
  would do before you commit to it: `grab` over a ring vertex (`grabbing` while
  it moves), `copy` over an edge — where a press *adds* a vertex — a directional
  `↖↘`/`↕`/`↔` resize over each of the eight box grips, `move` inside a movable
  selection, `pointer` over the vertex that would close a polygon, and `crosshair`
  everywhere a press starts something new.

  This is one hit test, not two: `pick()` returns the gesture a press would
  start, and `onPointerDown` and the cursor both read it. Two copies of that
  decision tree would drift, and a cursor promising a grab where the press
  actually draws a new shape is worse than no cursor at all. The cursor is
  written straight to `canvas.style` — a hover must not re-render the panel — and
  is left alone mid-gesture, since pointer capture lets the pointer wander off the
  handle it grabbed and re-picking under it would flicker.
- **View**: scroll to zoom about the cursor, alt-drag or middle-drag to pan, `Fit`
  to reset. Holding alt shows `grab`, since that is what the press would do
  regardless of what is underneath.
- `Esc` cancels a half-drawn shape, and otherwise leaves Edit Mode without
  committing. `Enter` closes a shape, and otherwise applies.

The preview bitmap is downscaled so its long side is at most 2048 px: an 8k DEM
held as full-resolution RGBA would be 256 MB for a picture no screen can resolve.
Drags are drawn imperatively from a ref and committed to React state only on
release — a lasso emits a point per pointer move, and re-rendering the panel
60×/s to show a half-finished path is work nobody sees.

---

## Files

| File | Role |
|---|---|
| `src/utils/heightmapEdit.js` | Pure maths: bounds, scanline fill, distance-transform feather, `applyEdit`, `cropBbox` |
| `src/store/useStore.js` | Source/derived split, mask memo, `setEdit`, the `keepEdit` rule, erosion scatter-back |
| `src/components/HeightmapEditor.jsx` | The 2D canvas: preview, overlays, pointer tools |
| `src/components/EditPanel.jsx` | The right-hand panel while editing |
| `tests/edit.spec.js` | End-to-end clip, clear, cancel, lasso, polygon, ellipse, ring editing, soundscape and GeoTIFF coverage |
