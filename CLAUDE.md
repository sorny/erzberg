# erzberg — notes for Claude Code

erzberg is a desktop web app (React, three.js, Vite) that turns elevation data
into line art for screens and pen plotters. `docs/Architecture.md` describes the
pipeline. This file holds only the rules and traps that the code does not show.

## Commands

| Task | Command |
| --- | --- |
| Dev server (port 5173) | `npm run dev` |
| Lint | `npm run lint` |
| Unit tests (Vitest, `tests/unit/*.test.js`) | `npm run test:unit` |
| Browser tests (Playwright, `tests/*.spec.js`) | `npm test` |
| Build | `npm run build` |
| Command-line renderer | `npm run cli` |
| Rebuild bundled presets | `npm run update-presets` |

`npm test` runs the `light` project with 4 workers, then the `heavy` project
with 1 worker. The full run takes more than 10 minutes. Run it in the
background. A spec that reads pixels, the GPU, a download or audio goes in the
`heavy` half. The `LIGHT` list in `playwright.config.js` names the others.

## Layout

- `src/components/` — React components. The panel lives in `src/components/panel/`.
- `src/utils/` — pure functions. `geometry.worker.js` builds all geometry off the main thread.
- `src/params.js` — every parameter, its default and its help text.
- `src/store/useStore.js` — the Zustand store.
- `src/utils/presetFile.js` — preset parse, `PRESET_FORMAT` and migrations.
- `public/presets/` — bundled presets, applied directly (not through `parsePreset`).
- `scripts/` — CLI, preset, font and data tools.
- `docs/` — user guides.

## Rules

- **Desktop only.** Do not add media queries or a phone layout.
- **Panel shape.** The shell is 312 px: a 40 px stage rail plus a 272 px body. Do not take the rail out of the body.
- **Labels use GIS and survey terms** (occluder, chainage, depth bias). Put the plain explanation in the `help` text.
- **A preset must reopen unchanged.** If a change alters how an existing setting renders, add a legacy switch, bump `PRESET_FORMAT`, add a migration and update the bundled preset files. Render the bundled presets before and after, and compare them.
- **Docs stay compact.** State what exists and how to use it. Put rationale and measurements in `CHANGELOG.md`.
- **No plotter code.** Do not write G-code, HPGL or features that plotter tools own.
- **Licence is MIT.** Do not propose a change.

## Releases

1. Bump `version` in `package.json` and `package-lock.json`.
2. Add a `## [x.y.z] — YYYY-MM-DD` entry to `CHANGELOG.md` (Keep a Changelog format).
3. Run lint, unit tests and `npm test`.
4. Commit with a conventional message that ends in `(vX.Y.Z)`, and push `main`.

Do not tag releases. `main` is always the latest version.

## Traps

- **One Playwright run at a time.** The specs reuse the server on port 5173. A second run tests the wrong tree.
- **Stale dev servers.** Vite takes the next free port, so old servers stay alive. Before you debug a render fault, check `lsof -nP -iTCP:5173 -sTCP:LISTEN`. After a dependency change, stop all servers and delete `node_modules/.vite`.
- **Worktrees lack test data.** `tests/testdata/benchmark.tif` and `geotiff.tif` are gitignored. Link them and `node_modules` from the main tree before a test run. Do not commit a worktree with `git add -A`.
- **`src/params.js` contains NUL bytes.** `grep` treats it as binary and finds nothing. Use `grep -a`.
- **Wait loops.** `pgrep -f "playwright test"` matches its own loop. Use `pgrep -f "[p]laywright test"`.
- **Local Overpass.** `scripts/overpass-austria.sh` runs an Overpass server on port 12345. `.env.development.local` points the dev server at it.
