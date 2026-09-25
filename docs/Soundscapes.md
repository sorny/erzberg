# Soundscapes

Soundscapes turns an audio file into terrain. The track is analysed once into a
spectrogram. Playback streams a window of it into the heightmap slot that a PNG
or GeoTIFF uses, so every draw mode, overlay and exporter works unchanged.

---

## Pipeline

```
 .mp3 ──decodeAudioData──> mono PCM ──STFT (worker)──> spectrogram
                                                          │
              ┌───────────────────────────┬───────────────┤
              │                           │               │
   sidebar canvas (whole track)   sliceWindow()   projection.build()
                                   per tick        on freeze
                                        │               │
                                        └──> setHeightmap() ──> terrain
```

Seeking, restyling and tone controls re-slice the stored result. Only FFT size,
frequency spacing and bin count re-analyse.

---

## STFT

The track is mixed to mono and cut into frames of `fftSize` samples with a hop
of `fftSize / 4` (75% overlap). Each frame gets a periodic Hann window:

$$w[n] = \tfrac{1}{2}\left(1 - \cos\frac{2\pi n}{N}\right)$$

A radix-2 Cooley–Tukey FFT (`src/utils/fft.js`) gives half-spectrum magnitudes,
scaled by $2 / \sum_n w[n]$ so a full-scale sine reads 0 dBFS.

`MAX_FRAMES = 24000` caps the frame count. Longer tracks stretch the hop.

### Binning

| Mode | Bin edges |
|---|---|
| Linear | $f_i = \dfrac{i}{B}\, f_\text{Nyquist}$ |
| Logarithmic (default) | $f_i = f_\text{min}\left(\dfrac{f_\text{Nyquist}}{f_\text{min}}\right)^{i/B}$, $f_\text{min} = 30\ \text{Hz}$ |

Each band keeps its **peak** magnitude, because a mean washes out the narrow
partials that read as ridges. Edges are forced to increase, so the sparse low
end maps 1:1 with no empty rows.

### Storage

Values are stored in dB over a fixed $[-110, 0]$ range:

$$v = \operatorname{clamp}\left(\frac{20\log_{10}(|X_k| \cdot g) - \text{DB}_\text{MIN}}{-\text{DB}_\text{MIN}},\ 0,\ 1\right)$$

So **dB Floor** and **Contrast** apply at stream time without a new analysis.

---

## Streaming

Each tick takes the frame at the playhead:

$$f = \left\lfloor \frac{t \cdot f_s}{\text{hop}} \right\rceil$$

`sliceWindow()` copies columns $[f - W + 1,\ f]$ into a `windowFrames × bins`
heightmap: time along X, frequency along Y, bass at the bottom. Columns before
the start stay silent, so the track scrolls in from the right. Then the tone
map:

$$v' = \left(\operatorname{clamp}\frac{v - \text{floor}}{1 - \text{floor}}\right)^{\gamma}$$

### Pacing

Each push is a full geometry rebuild, so pushes run at the **Rate** setting. A
deadline advances by exactly one interval, so the average rate matches the
request even though ticks land on rAF boundaries. It resyncs after a stall
instead of bursting.

At the default 512 × 512 grid:

| Requested | Achieved |
|---|---|
| 12/s | 11.9/s |
| 30/s (default) | 30.0/s |
| 45/s | 44.6/s |
| 60/s | 55.4/s |

At 60/s the build (16.7 ms) is just over the frame budget. A smaller grid
reaches 60.

---

## Freeze Whole Track

Erosion, STL and SVG need terrain that holds still. **Freeze Whole Track**
pauses playback and writes the whole track as one heightmap. The **projection**
selector picks the shape. Each projection is a pure function of the spectrogram
that returns `{ pixels, width, height }`.

**Terrain → Raw terrain view** shows a projection's raster directly, which is a
quick way to judge a setting.

### Spectrogram

Time across, frequency up, peak-held to at most 1024 columns.

### Disc

The track wound into a record: time around, frequency from label to rim.
**Turns** sets the laps. Match it to the bar or phrase count, and repeats line
up as sectors.

Each pixel takes its parameter from the nearest groove:
$k = \operatorname{round}(u \cdot \text{turns} - \theta)$, then
$t = (k + \theta) / \text{turns}$. A turn from radius alone tears at the seam
where $\theta$ wraps. **Groove** below 100% leaves gaps between laps.

### Similarity

Every moment compared with every other. A repeated chorus is a diagonal stripe.
A steady section is a block.

- **Timbre** uses 24 log-spaced band energies. **Harmony** uses 12 pitch
  classes. Vectors are L2-normalised, so similarity is a dot product.
- **Enhance** averages along the diagonal, turning dotted repeats into ridges.
- **Layout → Lag** plots $(i, j)$ at $(i,\ j - i)$, so repeats become
  horizontal ledges.
- **Sparsity** drops the weakest share, cut with a 256-bucket histogram.
- The matrix is renormalised to its own range, because cosine similarity of
  non-negative spectra sits near the top.

### Weave

The track folded onto its bar grid: one bar per row, so repeated patterns stack
into vertical ridges and fills break them.

Tempo comes from autocorrelating the onset envelope (half-wave-rectified
spectral flux) over 60–200 BPM, then folding into 70–160 BPM. **BPM** overrides
it. **Phase** moves the downbeat. Above 512 rows, laps are peak-folded.

### Strata

Measured qualities, each in its own band over one timeline: loudness,
brightness, onset density, spectral spread, rolloff, noisiness, low, mid and
high energy, and a 12-row chromagram. **Profile** fills up to the curve.
**Terrace** fills the band at the curve's value. Each curve is normalised to its
own range. Frequency features use a log axis.

### Cost

Projections run on the main thread during a freeze.

| Projection | Default output | Time |
|---|---|---|
| Spectrogram | 1024 × bins | ~2 ms |
| Disc | 768² | ~20 ms |
| Similarity | 512² | ~17 ms |
| Similarity (768², enhance 32) | 768² | ~90 ms |
| Weave | 256 × bars | ~2 ms |
| Strata | 512 × 304 | ~10 ms |

`fitSoundscape` picks the terrain resolution from `width × height` against a
cell budget. Only the larger projections step up to resolution 2.

---

## Controls

| Control | Re-analyses? | Notes |
|---|---|---|
| FFT Size (1024 / 2048 / 4096) | yes | Larger = finer frequency, coarser time |
| Log / Linear frequency | yes | See binning |
| Bins | yes | Frequency rows = heightmap height |
| Window | no | Time columns = heightmap width |
| Rate | no | Pushes per second |
| dB Floor | no | Noise gate |
| Contrast | no | Gamma after the gate. Above 1 sharpens ridges |
| Projection and its controls | no | Freeze only. Re-renders in place while frozen |

dB Floor and Contrast apply to projections too. The sidebar canvas renders the
whole track once offscreen and blits it per frame with the playhead. Click or
drag it to seek.

---

## Source

| File | Role |
|---|---|
| `src/utils/fft.js` | Radix-2 FFT and Hann window |
| `src/utils/spectrogram.js` | STFT, binning, `sliceWindow`, `resampleTime`, tone map |
| `src/utils/spectrogram.worker.js` | STFT off the main thread |
| `src/utils/trackProjections.js` | Projections and their param schemas |
| `src/hooks/useSoundscape.js` | Decode, transport, streaming, freeze |
| `src/components/SpectrogramView.jsx` | Sidebar canvas and playhead |

### Adding a projection

Add an entry to `TRACK_PROJECTIONS` in `src/utils/trackProjections.js` with an
`id`, a `label`, a one-line `blurb`, a `params` schema, and
`build(spec, params, tone)` that returns `{ pixels, width, height }`. The
sidebar renders the schema: a bare descriptor is a slider, `type: 'seg'` a
segmented row, `type: 'tog'` a switch, and a shared `group` a chip grid.
