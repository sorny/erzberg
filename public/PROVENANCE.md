# Where the bundled assets came from

Everything in this directory ships to the browser, so everything in it needs an
answer to "whose is this?". Three of the four have their own licence file; this
records the fourth, and points at the others.

## `Heightmap.png` — original

Painted by hand in Photoshop by Gerald Reisinger. Not traced, sampled or derived
from any elevation dataset, so no attribution is owed to anyone and none of the
usual DEM terms — Copernicus, SRTM, swisstopo, ALOS — apply to it. It is covered
by the repository's MIT licence along with the rest of the work.

Recorded because a 1024×1024 16-bit greyscale plate is exactly what a real DEM
export looks like, and the file's own metadata cannot tell the two apart: its
XMP says only that Photoshop created it. Anyone auditing this repository would
otherwise have to ask, and the answer would be lost the moment there was nobody
left to ask.

## `logo.svg`, `favicon.svg`, `og-image.svg`, `og-image.png` — original

Drawn for this project. MIT with the rest.

The wordmark in `logo.svg` and `og-image.svg` is Space Mono, flattened to
outlines by `npm run logo` so the files carry no font dependency. They asked a
browser to fetch the face from Google before that, which cannot work in the one
context that matters — an SVG used as an `<img>` loads nothing external — so the
wordmark rendered in a fallback everywhere it was actually used. The outlines
are the face's own curves, and the OFL exempts a document made with a font from
the font's terms, so nothing here is encumbered by it.

## `presets/` — original

Each preset is a set of this application's own parameter values, saved from the
app. MIT with the rest.

## `icons/` — Maki 8.2.0, CC0 1.0

Public domain, unmodified, no attribution required. See `icons/LICENSE`, which
records provenance anyway.

## `fonts/` — several licences, per face

Space Mono under the SIL Open Font License 1.1 (`fonts/OFL.txt`); the 49
single-line faces under the OFL, the Hershey licence, the public domain, the
WTFPL and MIT depending on the face (`fonts/single-line/LICENSE.txt`, which
carries the full OFL text as the OFL requires).

`fonts/space-mono-700-latin.woff2` is the Latin subset as Google Fonts serves
it, downloaded once and served from this origin. It sets two words in the panel
— the wordmark and Edit Mode's label — and used to be fetched from
fonts.googleapis.com on every load, which handed each visitor's IP to a third
party. The OFL expressly permits bundling, and the licence ships beside it.

Fonts keep their own licences whatever this repository is licensed under, and
the OFL explicitly exempts documents made *with* a font from the font's terms —
so an SVG erzberg exports with lettering in it is unencumbered.
