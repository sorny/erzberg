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
| `-o, --out <file>` | `.svg`, `.png` or `.stl`. Repeat it to write several files of one plate. |
| `-p, --preset <name>` | A bundled preset (`Blueprint`, any case), or a `.json`, `.svg` or `.png` that carries one. |
| `-m, --mode <ids>` | Switch draw modes on, by id (`Contours`) or label (`Stream network`). Comma list, repeatable. |
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

# The look of an earlier plate, on A3 landscape with a scale bar
node scripts/erzberg.js render graz.tif -p old-plate.svg --frame iso \
  -s frameLandscape=true -s frameScaleBar=true -o graz-a3.svg
```

`npm run cli -- render …` runs the same command. After `npm link`, the command
is `erzberg`.
