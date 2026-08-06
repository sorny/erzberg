# Soundscapes

Soundscapes turns an audio file into terrain. The track is analysed once into a
spectrogram, and playback then *streams* a window of that spectrogram into the
heightmap store — the same slot a PNG or GeoTIFF occupies. Every existing tool
therefore applies unchanged: all fourteen draw modes, hillshade, erosion, and
the SVG / PNG / STL exporters.

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

Analysis happens **once**, on upload. Seeking, restyling and every tone-mapping
control re-slice the stored result rather than re-running the FFT.

---

## Short-Time Fourier Transform

The decoded track is mixed to mono and cut into overlapping frames of
`fftSize` samples, advancing by a hop of `fftSize / 4` (75 % overlap). Each
frame is multiplied by a periodic Hann window

$$w[n] = \tfrac{1}{2}\left(1 - \cos\frac{2\pi n}{N}\right)$$

and transformed with a radix-2 Cooley–Tukey FFT (`src/utils/fft.js`).
Magnitudes are taken over the half-spectrum (DC … Nyquist) and scaled by the
window's coherent gain, $2 / \sum_n w[n]$, so a full-scale sinusoid lands at
0 dBFS.

Frames are capped at `MAX_FRAMES = 24000`. Past that the hop is stretched, so a
long track loses time resolution instead of exhausting memory — a 12-minute
file at 44.1 kHz would otherwise allocate ~52k frames.

### Frequency binning

The half-spectrum is reduced to `bins` rows. Two spacings are available:

| Mode | Bin edges |
|---|---|
| Linear | $f_i = \dfrac{i}{B}\, f_\text{Nyquist}$ |
| Logarithmic (default) | $f_i = f_\text{min}\left(\dfrac{f_\text{Nyquist}}{f_\text{min}}\right)^{i/B}$, $f_\text{min} = 30\ \text{Hz}$ |

Log spacing is the musically meaningful one — an octave is a constant distance,
so bass detail is not crushed into the bottom few rows. Within a band the
**peak** magnitude is kept rather than the mean: averaging washes out narrow
partials, which are exactly the ridges that read as terrain.

Edges are forced strictly increasing, so when many output bins map into the
sparse low end the mapping degrades to 1:1 rather than producing empty rows.

### Storage

Values are stored as dB normalised over a **fixed** range, $[-110, 0]$ dB:

$$v = \operatorname{clamp}\left(\frac{20\log_{10}(|X_k| \cdot g) - \text{DB}_\text{MIN}}{-\text{DB}_\text{MIN}},\ 0,\ 1\right)$$

Keeping the storage range fixed — rather than baking in the user's floor and
contrast — is what lets **dB Floor** and **Contrast** apply per frame at
streaming time instead of forcing a re-analysis on every slider tick.

---

## Streaming

On each tick the frame index for the current playback position is

$$f = \left\lfloor \frac{t \cdot f_s}{\text{hop}} \right\rceil$$

and `sliceWindow()` copies columns $[f - W + 1,\ f]$ into a
`windowFrames × bins` heightmap: time on X, frequency on Y, low frequencies at
the bottom. Columns before the start of the track stay silent, so a track
scrolls in from the right rather than starting mid-stream.

Tone mapping is applied here:

$$v' = \left(\operatorname{clamp}\frac{v - \text{floor}}{1 - \text{floor}}\right)^{\gamma}$$

### Pacing

Each push replaces the heightmap and therefore costs a full geometry rebuild,
so the tick is throttled to the **Rate** setting rather than running at rAF
speed.

Pacing is deadline-based, not "has `interval` elapsed since the last push".
Ticks only arrive on rAF boundaries (~16.7 ms), so an elapsed test can only
produce rates of 60/n — asking for 45/s would silently give 30/s, because the
frame at 16.7 ms is always short of a 22.2 ms interval. Advancing a deadline by
exactly `interval` instead lets the gap alternate between one and two frames so
the *average* matches the request. The deadline resyncs when it falls more than
an interval behind, so a stall is absorbed rather than repaid as a burst.

Measured effective rates at the 512 × 512 default:

| Requested | Achieved |
|---|---|
| 12/s | 11.9/s |
| 30/s (default) | 30.0/s |
| 45/s | 44.6/s |
| 60/s | 55.4/s |

60/s falls slightly short because the 16.7 ms build just exceeds the 16.67 ms
frame budget at that grid size; smaller grids reach a full 60.

---

## Freeze Whole Track

Streaming terrain is a moving target, which erosion, STL and SVG cannot work
with. **Freeze Whole Track** pauses playback and writes the entire track as one
static heightmap.

*Which shape* the track takes is chosen by the **projection** selector above the
button. Every projection is a pure function of the spectrogram returning the
same pixels/width/height the store takes, so none of them needs anything
downstream to know which one ran.

---

## Whole-track projections

A four-minute STFT squeezed into 1024 columns is the literal answer and a poor
portrait: mostly noise with a loud middle. The other projections fold the track
so its *structure* becomes relief.

Each one lands in the heightmap slot as a plain raster, so **Terrain → Raw
terrain view** shows exactly what a projection produced — flat, greyscale, with
the draw modes out of the way. That is usually the quickest way to judge whether
a setting did what you wanted before styling anything on top of it.

### Spectrogram

Time across, frequency up, peak-held down to at most 1024 columns. The original
freeze view, unchanged.

### Disc

The track wound into a record: time runs around the circle, frequency from the
label out to the rim.

**Turns** is where it gets interesting. At 1 the track makes a single lap. Above
1 it becomes an Archimedean groove — and setting the turn count to the track's
bar or phrase count makes every repeat land at the same angle, so verse/chorus
structure resolves into visible sectors.

The spiral is parameterised by nearest groove, not by ring index: for the groove
centred at radius $u = t$ and angle $2\pi t \cdot \text{turns}$, a pixel's turn
is $k = \operatorname{round}(u \cdot \text{turns} - \theta)$ and its position
along the groove is $t = (k + \theta) / \text{turns}$. Deriving the turn from
radius alone would tear the image along the seam where $\theta$ wraps — exactly
where the groove is supposed to run on into its next lap.

**Groove** below 100 % leaves a gap between laps so they read as separate ridges
rather than one smear.

### Similarity

Every moment of the track compared against every other. A repeated chorus is a
stripe parallel to the main diagonal; a section that holds still is a block.
This is the projection that makes song *form* visible rather than sound.

Moments are reduced to feature vectors — 24 log-spaced band energies
(**Timbre**) or 12 pitch classes (**Harmony**, which folds octaves together so
it tracks chords rather than production) — then L2-normalised, so similarity is
a plain dot product and a loud passage cannot look more similar to everything
than a quiet one.

Two settings carry most of the visual weight:

- **Enhance** averages along the diagonal direction. A single frame-to-frame
  comparison is noisy; a genuine repeat is precisely the case where *consecutive*
  moments match consecutive moments, so this is what turns a dotted repeat into a
  continuous ridge.
- **Layout → Lag** re-plots cell $(i, j)$ at $(i,\ j - i)$, straightening repeat
  diagonals into horizontal ledges. Section boundaries become anti-diagonals.
  The empty upper corner is the honest consequence of long lags having fewer
  moments to compare.

**Sparsity** drops the weakest share of the matrix to flat ground, using a
256-bucket histogram for the cut point rather than sorting ~590k cells.

Cosine similarity between non-negative spectra clusters in the top of its range,
so the matrix is renormalised to its observed min/max before output — without
that it is a plateau with faint marks on it rather than terrain.

### Weave

The track folded onto its own bar grid. Time runs across one bar and then wraps
to the next row, so anything the drummer repeats stacks into a vertical ridge
and the places where the pattern breaks — a fill, a dropped beat, a section
change — appear as interruptions in an otherwise woven surface.

Tempo comes from autocorrelating the onset envelope (half-wave-rectified
spectral flux — only *rising* energy counts, since summing the signed difference
would cancel attacks against decays) over the lag range for 60–200 BPM. The
result is folded into 70–160 BPM, because raw autocorrelation locks onto half or
double the tempo just as happily. Set **BPM** manually to override it, and
**Phase** to move the downbeat until the ridges stand upright.

Short tracks make thin weaves: one row per bar means a 6-second clip is three
rows. Past 512 rows the laps are peak-folded together, so a long track loses
resolution rather than being truncated.

### Strata

Measured qualities of the track — loudness, brightness, onset density, spectral
spread, rolloff, noisiness, low/mid/high energy, and a 12-row chromagram — each
given its own horizontal band over one shared timeline.

**Profile** fills each band up to its curve, giving a silhouette; **Terrace**
fills the whole band at the curve's value. Each curve is normalised to its own
range over the track: spectral flatness lives in a very different numeric range
from loudness, and a shared scale would flatten most of the strata into straight
lines. What matters is how each quality moves across *this* track.

Frequency-derived features are measured on a log axis — the perceptual distance
from 200 Hz to 400 Hz is the same as 2 kHz to 4 kHz, and a linear centroid would
spend its whole range in the top octave.

### Cost

All projections run synchronously on the main thread; freezing is a one-shot
action that already pauses playback.

| Projection | Default output | Time |
|---|---|---|
| Spectrogram | 1024 × bins | ~2 ms |
| Disc | 768² | ~20 ms |
| Similarity | 512² | ~17 ms |
| Similarity (768², enhance 32) | 768² | ~90 ms |
| Weave | 256 × bars | ~2 ms |
| Strata | 512 × 304 | ~10 ms |

Cell count, not the longest side, drives the render cost downstream, so
`fitSoundscape` picks the terrain resolution from `width × height` against a
budget set just above the frozen spectrogram — which has always rendered
undecimated. Only the genuinely larger projections step up to resolution 2.

---

## Controls

| Control | Re-analyses? | Notes |
|---|---|---|
| FFT Size (1024 / 2048 / 4096) | yes | Larger = finer frequency, coarser time |
| Log / Linear frequency | yes | See binning above |
| Bins | yes | Frequency rows; also the heightmap height |
| Window | no | Time columns; also the heightmap width |
| Rate | no | Heightmap pushes per second |
| dB Floor | no | Noise gate — drops quiet detail to flat ground |
| Contrast | no | Gamma after the gate; >1 sharpens peaks into ridges |
| Projection + its settings | no | Only affects freezing; re-renders in place while frozen |

dB Floor and Contrast feed every projection too, so the two sliders behave the
same whether the terrain is a streamed window or a frozen disc.

The sidebar canvas renders the whole analysed track once into an offscreen
buffer and blits it per frame, overlaying the playhead and the slice currently
feeding the terrain. Click or drag it to seek.

---

## Source

| File | Role |
|---|---|
| `src/utils/fft.js` | Radix-2 FFT + Hann window |
| `src/utils/spectrogram.js` | STFT, binning, `sliceWindow`, `resampleTime`, tone map |
| `src/utils/spectrogram.worker.js` | Runs the STFT off the main thread |
| `src/utils/trackProjections.js` | Whole-track projections + their param schemas |
| `src/hooks/useSoundscape.js` | Decode, transport, streaming tick, freeze |
| `src/components/SpectrogramView.jsx` | Sidebar canvas + playhead |

### Adding a projection

One entry in `TRACK_PROJECTIONS` (`src/utils/trackProjections.js`): an `id`, a
`label`, a one-line `blurb`, a `build(spec, params, tone)` returning
`{ pixels, width, height }`, and a `params` schema. The sidebar renders the
schema itself — a bare descriptor is a slider, `type: 'seg'` a segmented row,
`type: 'tog'` a switch, and a shared `group` collapses several toggles into a
chip grid. Nothing else needs touching.
