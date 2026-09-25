# Edit Mode

Edit Mode clips the loaded raster before it becomes terrain: a crop rectangle,
a lasso, a polygon, an ellipse, or the outline of a map feature. It works on
PNG, GeoTIFF and Soundscapes, and it is non-destructive.

Press `E`, or the ✂ button under the loader.

---

## Source and derived

The store holds the raster twice:

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

Everything downstream reads only the derived fields. With no clip, they are the
source arrays, so the feature costs nothing until you use it. Keeping the source
means:

- Edit Mode reopens on the full raster with the selection still live.
- **Clear** restores the whole heightmap without a reload.
- A streaming Soundscape keeps its clip. Each frame is a new source, clipped on
  the way through.

An edit uses source pixel coordinates only:

```js
{ rect: {x, y, w, h}, shape: Shape | null, feather: px }

// a Shape is a ring of points, an ellipse, or a map feature:
{ type: 'lasso'|'polygon', points: [x0,y0,x1,y1,…] }
{ type: 'ellipse', cx, cy, rx, ry }
{ type: 'rings', rings: [[x0,y0,…], …], name }
```

`setHeightmap` clears the edit when the source changes. The one exception is
`opts.keepEdit` at unchanged dimensions, which only `pushFrame` in
`useSoundscape` passes. A freeze or a window-width change alters the dimensions
and drops the clip by the same rule.

---

## Centring

`buildTerrain` takes the mesh origin from the bounding box of the valid cells:

$$\text{halfW} = \frac{(c_{\min} + c_{\max}) \cdot \text{scl}}{2}, \qquad
  \text{halfH} = \frac{(r_{\min} + r_{\max}) \cdot \text{scl}}{2}$$

So a selection that becomes a NoData mask is centred by existing code. Note that
`halfW` and `halfH` are **midpoint offsets** ($x = c \cdot \text{scl} - \text{halfW}$),
not half-extents. On a full grid the two are equal, so only a crop shows the
difference. For sizes, use `spanHalfW` and `spanHalfH`:

$$\text{spanHalfW} = \frac{(c_{\max} - c_{\min}) \cdot \text{scl}}{2}, \qquad
  \text{spanHalfH} = \frac{(r_{\max} - r_{\min}) \cdot \text{scl}}{2}$$

See [Murmurations](Murmurations.md#scaling) for the bug this caused.

Masked cells store $0$, the lowest ground. Bilinear taps, blur windows and
stencils that reach into a hole are corrected by the builders. See
[NoData and clipped edges](Draw-Modes.md#nodata-and-clipped-edges).

The output raster is cropped to the selection's bounding box, so a quarter
selection gives a quarter of the cells and faster rebuilds. After Apply, the
view refits with `autoZoom` and `autoResolution`.

---

## How a selection becomes a mask

### Rings

A lasso and a polygon both become a closed ring, filled even-odd. For each row,
the edges are intersected with the row centre $y_c = y + \tfrac{1}{2}$:

$$x = x_i + \frac{y_c - y_i}{y_j - y_i}\,(x_j - x_i) \quad \text{for every edge across } y_c$$

Crossings are sorted and filled in pairs. Sampling at pixel centres avoids a
half-pixel fringe, and pairs handle concave shapes.

A lasso is thinned to about one vertex per 3 screen pixels while drawing, then
simplified with Douglas–Peucker at about 1.5 px (`simplifyFlat`). That usually
cuts the vertex count 5 to 10 times.

### Rings from a map feature

Pick a loaded OSM or GeoJSON layer and press **Clip to this** to cut the
heightmap to a municipality, district, lake or park. It is its own shape kind,
`rings`, because:

- **A feature has holes.** `fillRings` scans all rings in one pass, so even-odd
  cuts enclaves.
- **A feature can be several pieces.**
- **It has no editable vertices.** `isPointShape` excludes `rings`, and the
  outline draws without handles.

Rings are simplified on the way in (Douglas–Peucker at a third of a pixel,
iterative, so long borders cannot overflow the stack). Only layers whose
features enclose something are offered, tested on the geometry after ring
stitching. See [Masks](Masks.md#a-mask-from-features). A feature clip resets the
crop rectangle to the whole raster.

### Ellipses

Stored as `{cx, cy, rx, ry}`, not as a polygon, and filled from the implicit
form:

$$\left(\frac{x - c_x}{r_x}\right)^2 + \left(\frac{y - c_y}{r_y}\right)^2 \le 1$$

Solving for $x$ gives each row's span directly.

Raster voids (GeoTIFF NoData, transparent PNG pixels) go into the same mask, so
they feather like any other edge.

---

## Feather

The geometry mask is binary, so feather acts on the value:

$$d = \text{distance to the nearest unselected cell}, \qquad
  t = \min\!\left(1, \frac{d}{f}\right), \qquad
  w = t^2(3 - 2t)$$

$$v' = v_{\text{floor}} + (v - v_{\text{floor}})\, w$$

$v_{\text{floor}}$ is the lowest value in the selection. The edge melts down to
the base, which also keeps a clipped STL flat. $d$ comes from a two-pass chamfer
transform (1 straight, $\sqrt{2}$ diagonal). The crop border counts as
unselected. At `feather: 0` the transform is skipped.

`buildEditMask` depends only on the shape and the raster dimensions, and the
store memoises it. A Soundscape streaming 30 frames a second under one selection
pays only the pixel copy.

---

## Georeferencing

The derived bbox is the source bbox interpolated over the crop rectangle
(north-up, as `geoToPixel` assumes):

$$x'_{\min} = x_{\min} + \frac{r_x}{W}\,\Delta x, \qquad
  y'_{\max} = y_{\max} - \frac{r_y}{H}\,\Delta y$$

Without it, vector layers land in the wrong place without an error. A crop does
not renormalise pixel values, so the elevation readout, cuts and STL scale stay
true to the file.

---

## Erosion under a clip

Erosion runs on the clipped raster, and the result is scattered back into the
source at the clip position. The clip stays editable. Cells in the feather ramp
are skipped, so the ramp is not baked in twice.

---

## Interaction

- **Crop.** Drag to draw, drag inside to move, and use eight handles to resize.
  Aspect locks: Free, 1:1, 4:3, 16:9 and source. Numeric X, Y, W and H fields.
  While the rectangle covers the whole raster, a drag draws a new one. Shift
  forces a new rectangle.
- **Ellipse.** Drag out its box. **Shift** makes a circle, read on every move.
  Drag inside to move. The eight handles work here too.
- **Polygon.** Click each vertex. Close with a click on the first vertex,
  `Enter`, or a double-click. `Backspace` removes the last vertex.
- **Editing a ring.** Drag a vertex to move it. Drag an edge to add a vertex.
  Right-click a vertex to remove it (three remain at least).
- **Cursor.** The cursor shows what a press will do: `grab` on a vertex, `copy`
  on an edge, a resize arrow on a box grip, `move` inside a selection, `pointer`
  on the closing vertex, and `crosshair` elsewhere. One `pick()` hit test serves
  both the cursor and `onPointerDown`. The cursor is written to `canvas.style`
  directly and is left alone during a gesture.
- **View.** Scroll to zoom about the cursor. Alt-drag or middle-drag to pan.
  `Fit` resets.
- **Keys.** `Esc` cancels a half-drawn shape, or leaves Edit Mode without
  applying. `Enter` closes a shape, or applies the edit.

The backdrop comes from `utils/rasterBackdrop.js`, shared with the Mask
Studio, with the same choice: Auto, Sat, Relief or Height. It is capped at
2048 px on the long side. A drag is drawn from a
ref and committed to React state on release.

---

## Files

| File | Role |
|---|---|
| `src/utils/heightmapEdit.js` | Bounds, scanline fill, feather, `applyEdit`, `cropBbox` |
| `src/store/useStore.js` | Source and derived split, mask memo, `setEdit`, `keepEdit`, erosion scatter-back |
| `src/components/HeightmapEditor.jsx` | The 2D canvas and pointer tools |
| `src/components/EditPanel.jsx` | The panel during an edit |
| `src/components/panel/FeaturePicker.jsx` | `useFeaturePick`, shared with Masks |
| `src/utils/maskFromVector.js` | `featureRings`, `simplifyRing`, ring stitching |
| `tests/edit.spec.js`, `tests/clip-to-feature.spec.js` | End-to-end |
| `tests/unit/heightmapEdit.test.js` | The `rings` shape |
