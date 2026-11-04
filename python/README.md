# erzberg for Python

This package renders erzberg plates from Python and Jupyter. It calls the
erzberg command-line tool, so the pictures are the same as in the app. It has
no renderer of its own and no dependencies.

## Install

You need Node.js and a clone of erzberg with `npm install` done.

```sh
uv pip install -e path/to/erzberg/python
```

The package finds the tool in this order:

1. The `ERZBERG_CLI` variable, which holds a path to `scripts/erzberg.js`.
2. The repository that holds this package.
3. An `erzberg` command on your `PATH`.

## Use

```python
import erzberg

plate = erzberg.render("dem.tif", preset="Swiss Contours", modes=["Contours"])
plate                      # a notebook shows the PNG
plate.save("dem.svg")      # render the same plate again as SVG
erzberg.presets()          # the bundled preset names
erzberg.modes()            # {id: label} for every draw mode
```

`render` takes the options of `erzberg render`: `preset`, `modes`, `only`,
`set` (a dict of parameters), `size`, `frame`, `pen_order`, `alpha`, `stats`
and `timeout`. With `out`, it writes those files and returns the plate. With
`stats=True`, `plate.stats` holds the plot figures.

`erzberg.atlas("peaks.geojson", out="sheets/{name}.png", ...)` runs the atlas
and returns one JSON record per sheet.
