# Command line

`scripts/erzberg.js` renders a plate without the panel. It opens the built app in
headless Chrome and drives it through `window.erzberg`
(`src/automation.js`). The modes, labels and exporters are the ones the UI
uses, so a file from the CLI matches a file from the UI.

The CLI needs Chrome, or the Chromium that Playwright installs. If `dist/` is
missing or older than `src/`, the CLI builds the app first.

---

## Render

```
node scripts/erzberg.js render <heightmap> -o <file> [-o <file>…] [options]
```

| Option | Effect |
|---|---|
| `-o, --out <file>` | `.svg`, `.png`, `.stl`, `.glb`, `.3mf` or `.geojson`. Repeat it to write several files of one plate. |
| `-p, --preset <name>` | A bundled preset (`Blueprint`, any case), or a `.json`, `.svg` or `.png` that carries one. |
| `-m, --mode <ids>` | Switch draw modes on, by id (`Contours`) or label (`Flow lines`). Comma list, repeatable. |
| `--only` | Switch every other draw mode off first. |
| `-s, --set <key=value>` | Any parameter. The type comes from the default: `tilt=35`, `labelContours=on`, `bgColor=#fff`. |
| `--size <W>x<H>` | Canvas pixels. The default is `1600x1131`. |
| `--frame <paper>` | Show the paper frame. The SVG is cut at the frame. |
| `--pen-order` | Re-order strokes for less pen-up travel. |
| `--alpha` | PNG with a transparent background. |
| `--stats` | Print the preflight figures as JSON. |
| `--timeout <s>` | Stop after this many seconds. The default is 300. |
| `--no-build` | Use `dist/` as it is. |
| `--headed` | Show the browser. |
| `-q, --quiet` | No progress on stderr. |

The input is a GeoTIFF, PNG, JPG or WebP, as in the UI.

### Order

1. The defaults. A run never reads a stored session or the opening preset.
2. `--preset`.
3. The heightmap, with its own fit: zoom, grid stride and elevation scale.
4. `--only`, then `--mode`.
5. `--frame`, `--pen-order`, then `--set`. An explicit `--set` wins over a
   shortcut.

The heightmap comes after the preset. A preset carries the zoom and the grid
stride of the plate it was made on, and they are wrong for a different raster.
To keep a preset value, give it again with `--set`.

### Output

Progress goes to stderr. Stdout gets only the path of each written file, or the
`--stats` JSON. The exit codes are:

| Code | Meaning |
|---|---|
| 0 | Done. |
| 1 | An error, for example a raster that does not decode. |
| 2 | A bad argument: an unknown mode, an unknown key, or a value of the wrong type. |
| 3 | Nothing to draw. |

## Atlas

```
node scripts/erzberg.js atlas <features.geojson> -o 'sheets/{name}.svg' [-o …] [options]
```

The atlas renders one plate per feature, all with the same preset, modes and
values. Use it for a series of matching sheets, for example the peaks of a
range or the cells of a grid.

| Option | Effect |
|---|---|
| `-o, --out <file>` | Must hold `{name}`. Each sheet writes its own file. |
| `--box <km>` | The square around a point feature. The default is 10. |
| `--dem <file>` | Cut each sheet from this GeoTIFF. Without it, each sheet fetches Terrain Tiles, as Fetch in the panel does. |

All render options also apply, to every sheet.

- A point gets a square of `--box` km around it. Any other geometry uses its
  own extent.
- The sheet name comes from the `name`, `title` or `id` property, else
  `sheet-01`. A name that repeats gets `-2`.
- The features must be in longitude and latitude, as GeoJSON is.
- `--dem` takes a GeoTIFF in any projection that the app can place. Only the
  window of each sheet is read.
- Each sheet takes its own fit and elevation scale, then the run's modes and
  `--set` values.
- If a sheet fails, for example because it lies outside the `--dem` file, the
  CLI names it, skips it and exits with 1 at the end.
- With a PNG output, the run also writes `atlas.html`, an index of all sheets,
  next to the first PNG.

## Day

`day` renders one plate per hour of one date, with the real sun at the plate's
centre. It sets the hillshade almanac, Shadow Line and Shadow Hatch to each
hour. The look must use one of the three, or every frame is the same. Silver
Gelatin casts shadows, Solstice draws the shadow line, and First Light hatches
the shade.

```
node scripts/erzberg.js day <heightmap> -o 'frames/{hour}.png' [options]
```

| Option | Meaning |
|---|---|
| `--date <YYYY-MM-DD>` | The day. The default is 2026-06-21. |
| `--hours <from-to>` | Clock hours to step through. The default is `5-21`. |
| `--step <h>` | Hours between frames. The default is 1. |
| `--zone <h>` | The clock's offset from UTC. The default is the plate's own. |

Each `-o` must hold `{hour}`, which becomes the time, for example `06-30`. With
PNG outputs, `day.html` shows the frames in a row. Every render option applies.

## Tiles

`tiles` writes the plate as XYZ web map tiles in Web Mercator, 256 pixels a
side, for Leaflet, MapLibre or QGIS. The plate is drawn once from above and each
tile is traced back into it, so a plate in any projection lands in place.

```
node scripts/erzberg.js tiles <heightmap> -o tiles/ [--zoom 10-14] [options]
```

The folder gets `z/x/y.png` and an `index.html` that shows the tiles on a plain
ground. Empty tiles are left out. It needs a georeferenced raster. To see the
tiles over a base map, add the folder as an XYZ layer in QGIS, or point a
Leaflet or MapLibre page at it.

## Python

The `python/` folder holds a package for notebooks. It calls this command line
and returns the picture. Install it with `uv pip install -e python`.

```python
import erzberg
erzberg.render("graz.tif", preset="Blueprint")        # shows in a notebook
```

## List

```
node scripts/erzberg.js list modes      # id and label of each draw mode
node scripts/erzberg.js list presets    # the bundled presets
node scripts/erzberg.js list params     # key, group and default of each parameter
```

---

## Examples

```sh
# A bundled look on your own terrain, as SVG and PNG
node scripts/erzberg.js render graz.tif -p "Swiss Topo" -o graz.svg -o graz.png

# Labelled contours only, for a plotter, with the plot figures
node scripts/erzberg.js render graz.tif -m Contours --only \
  -s intervalContours=6 -s labelContours=on --pen-order --stats -o graz.svg

# Six peaks in one style, from Terrain Tiles, with an index page
node scripts/erzberg.js atlas peaks.geojson -p "Swiss Contours" \
  -o 'sheets/{name}.svg' -o 'sheets/{name}.png'

# Shadows from sunrise to sunset in winter, every half hour
node scripts/erzberg.js day graz.tif -p "Silver Gelatin" --date 2026-12-21 \
  --hours 7-17 --step 0.5 -o 'winter/{hour}.png'

# The plate as web map tiles, and a coloured model
node scripts/erzberg.js tiles graz.tif -p "Swiss Topo" --zoom 11-15 -o tiles/
node scripts/erzberg.js render graz.tif -p "Swiss Topo" -o graz.glb -o graz.3mf

# The look of an earlier plate, on A3 landscape with a scale bar
node scripts/erzberg.js render graz.tif -p old-plate.svg --frame iso \
  -s frameLandscape=true -s frameScaleBar=true -o graz-a3.svg
```

`npm run cli -- render …` runs the same command. After `npm link`, the command
is `erzberg`.
