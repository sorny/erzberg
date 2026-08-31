# Where the bundled assets came from

Everything in this directory goes to the browser. Thus everything in it needs an
answer to the question "whose is this?". Three of the four groups have their own
licence file. This file records the fourth group and points at the others.

## `Heightmap.png` — original

Gerald Reisinger painted this file by hand in Photoshop. He did not trace,
sample or derive it from an elevation dataset. Thus it owes attribution to
nobody, and the usual DEM terms do not apply to it. These are the DEM terms that
do not apply: Copernicus, SRTM, swisstopo and ALOS. The repository's MIT licence
covers this file with the rest of the work.

This file has a record because a real DEM export looks exactly the same: a
greyscale plate of 1024×1024 px at 16 bits. The file's own metadata cannot tell
the two apart, because its XMP says only that Photoshop created it. Without this
record, a person who audits the repository must ask. The answer disappears when
there is nobody left to ask.

## `logo.svg`, `favicon.svg`, `og-image.svg`, `og-image.png` — original

Drawn for this project. The MIT licence covers them with the rest.

The wordmark in `logo.svg` and in `og-image.svg` is Space Mono. `npm run logo`
flattens it to outlines, so the files need no font. Before that the files asked
a browser to fetch the face from Google. That request cannot work in the one
context that matters, because an SVG used as an `<img>` loads nothing external.
Thus the wordmark rendered in a fallback face everywhere it was in use. The
outlines are the curves of the face itself. The OFL exempts a document made with
a font from the terms of that font, so nothing here carries an obligation.

## `presets/` — original

Each preset is a set of parameter values of this application, saved from the
app. The MIT licence covers them with the rest.

## `icons/` — Maki 8.2.0, CC0 1.0

Public domain, unmodified. They need no attribution. See `icons/LICENSE`, which
records where they came from anyway.

## `fonts/` — one licence per face

Space Mono is under the SIL Open Font License 1.1. See `fonts/OFL.txt`. The 49
single-line faces are under the OFL, the Hershey licence, the public domain, the
WTFPL or MIT. The licence depends on the face. See
`fonts/single-line/LICENSE.txt`, which carries the full OFL text as the OFL
requires.

`fonts/space-mono-700-latin.woff2` is the Latin subset, as Google Fonts serves
it. We downloaded it once and now serve it from this origin. It sets two words
in the panel: the wordmark and the label of Edit Mode. Before this, the app
fetched it from fonts.googleapis.com on every load, which gave the IP address of
each visitor to a third party. The OFL permits this bundling, and the licence
ships beside the file.

A font keeps its own licence, whatever licence this repository uses. The OFL
also exempts a document made *with* a font from the terms of that font. Thus an
SVG that erzberg exports with lettering in it carries no obligation.
