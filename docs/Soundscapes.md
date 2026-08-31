# Soundscapes

Soundscapes turns an audio file into terrain. The app analyses the track once
into a spectrogram. During playback it then *streams* a window of that
spectrogram into the heightmap store. This is the same slot that a PNG or a
GeoTIFF uses. Thus every existing tool works without a change: every draw mode,
hillshade, erosion, and the SVG, PNG and STL exporters.

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

The app analyses the track **once**, at upload. When you seek, restyle, or move
a tone-mapping control, the app re-slices the stored result. It does not run the
FFT again.

---

## Short-Time Fourier Transform

The app mixes the decoded track to mono. It then cuts the track into frames of
`fftSize` samples that overlap. The hop between frames is `fftSize / 4`, which
gives an overlap of 75 %. It multiplies each frame by a periodic Hann window:

$$w[n] = \tfrac{1}{2}\left(1 - \cos\frac{2\pi n}{N}\right)$$

It then transforms the frame with a radix-2 Cooley–Tukey FFT
(`src/utils/fft.js`). It takes the magnitudes over the half-spectrum, from DC to
Nyquist. It scales them by the coherent gain of the window, $2 / \sum_n w[n]$.
Thus a full-scale sinusoid lands at 0 dBFS.

The frame count has a limit of `MAX_FRAMES = 24000`. Above that limit the app
stretches the hop. Thus a long track loses time resolution and does not exhaust
the memory. Without the limit, a file of 12 minutes at 44.1 kHz allocates about
52 000 frames.

### Frequency binning

The app reduces the half-spectrum to `bins` rows. There are two spacings:

| Mode | Bin edges |
|---|---|
| Linear | $f_i = \dfrac{i}{B}\, f_\text{Nyquist}$ |
| Logarithmic (default) | $f_i = f_\text{min}\left(\dfrac{f_\text{Nyquist}}{f_\text{min}}\right)^{i/B}$, $f_\text{min} = 30\ \text{Hz}$ |

Log spacing is the one with a musical meaning. An octave is a constant distance
on that axis, so the bottom rows do not crush the bass detail.

Inside a band the app keeps the **peak** magnitude and not the mean. A mean
washes out narrow partials, and those partials are the ridges that read as
terrain.

The app forces the edges to increase strictly. Thus when many output bins map
into the sparse low end, the mapping degrades to 1:1 and gives no empty rows.

### Storage

The app stores values in dB, normalised over a **fixed** range of $[-110, 0]$ dB:

$$v = \operatorname{clamp}\left(\frac{20\log_{10}(|X_k| \cdot g) - \text{DB}_\text{MIN}}{-\text{DB}_\text{MIN}},\ 0,\ 1\right)$$

The storage range stays fixed. It does not bake in the floor and the contrast of
the user. Thus **dB Floor** and **Contrast** apply per frame at stream time. A
move of either slider costs no new analysis.

---

## Streaming

On each tick the app gets the frame index for the current playback position:

$$f = \left\lfloor \frac{t \cdot f_s}{\text{hop}} \right\rceil$$

`sliceWindow()` then copies the columns $[f - W + 1,\ f]$ into a heightmap of
`windowFrames × bins`. Time runs along X and frequency along Y. The low
frequencies are at the bottom. Columns before the start of the track stay
silent. Thus a track scrolls in from the right and does not start in the middle.

The app applies the tone map here:

$$v' = \left(\operatorname{clamp}\frac{v - \text{floor}}{1 - \text{floor}}\right)^{\gamma}$$

### Pacing

Each push replaces the heightmap, so each push costs a full geometry rebuild.
Thus the tick runs at the **Rate** setting and not at rAF speed.

The pacing uses a deadline. It does not measure the time from the last push
against `interval`. Ticks arrive only on rAF boundaries, about every 16.7 ms. An
elapsed test can thus give only the rates 60/n. A request for 45/s gives 30/s in
silence, because the frame at 16.7 ms is always short of an interval of 22.2 ms.
The app advances a deadline by exactly `interval` instead. The gap then
alternates between one frame and two frames, so the *average* matches the
request. The deadline resyncs when it falls more than one interval behind. Thus
the app absorbs a stall and does not repay it as a burst.

These are the measured rates at the default grid of 512 × 512:

| Requested | Achieved |
|---|---|
| 12/s | 11.9/s |
| 30/s (default) | 30.0/s |
| 45/s | 44.6/s |
| 60/s | 55.4/s |

60/s comes out a little short. The build takes 16.7 ms at that grid size, which
is a little more than the frame budget of 16.67 ms. A smaller grid reaches a full
60/s.

---

## Freeze Whole Track

Streamed terrain moves. Erosion, STL and SVG cannot work with a moving target.
**Freeze Whole Track** pauses the playback and writes the whole track as one
static heightmap.

The **projection** selector above the button decides *which shape* the track
takes. Every projection is a pure function of the spectrogram. Each one returns
the same pixels, width and height that the store takes. Thus nothing downstream
needs to know which projection ran.

---

## Whole-track projections

A four-minute STFT in 1024 columns is the literal answer. It is also a poor
portrait: mostly noise, with a loud middle. The other projections fold the track
so that its *structure* becomes relief.

Each projection lands in the heightmap slot as a plain raster. Thus **Terrain →
Raw terrain view** shows exactly what the projection produced: flat, greyscale,
with the draw modes out of the way. This is usually the quickest way to judge a
setting before you style anything on top of it.

### Spectrogram

Time across, frequency up, peak-held down to 1024 columns at most. This is the
original freeze view, unchanged.

### Disc

The track wound into a record. Time runs around the circle. Frequency runs from
the label out to the rim.

**Turns** sets how many laps the track makes. At 1 the track makes a single lap.
Above 1 the track becomes an Archimedean groove. Set the turn count to the bar
count or the phrase count of the track. Every repeat then lands at the same
angle, so the verse and chorus structure resolves into sectors you can see.

The spiral takes its parameter from the nearest groove and not from a ring
index. The groove has its centre at radius $u = t$ and angle
$2\pi t \cdot \text{turns}$. The turn of a pixel is
$k = \operatorname{round}(u \cdot \text{turns} - \theta)$. Its position along
the groove is $t = (k + \theta) / \text{turns}$. A turn derived from the radius
alone tears the image at the seam where $\theta$ wraps. That seam is exactly
where the groove must run on into its next lap.

**Groove** below 100 % leaves a gap between the laps. The laps then read as
separate ridges and not as one smear.

### Similarity

Every moment of the track, compared against every other moment. A repeated
chorus gives a stripe parallel to the main diagonal. A section that holds still
gives a block. This projection makes the *form* of a song visible, and not its
sound.

The app reduces each moment to a feature vector. **Timbre** gives 24 log-spaced
band energies. **Harmony** gives 12 pitch classes, which folds the octaves
together, so it tracks the chords and not the production. The app then
L2-normalises each vector. Thus the similarity is a plain dot product, and a
loud passage cannot look more similar to everything than a quiet one.

Two controls carry most of the visual weight:

- **Enhance** averages along the direction of the diagonal. One frame-to-frame
  comparison is noisy. A genuine repeat is the case where *consecutive* moments
  match consecutive moments. Thus this control turns a dotted repeat into a
  continuous ridge.
- **Layout → Lag** re-plots the cell $(i, j)$ at $(i,\ j - i)$. Repeat diagonals
  become horizontal ledges. Section boundaries become anti-diagonals. The upper
  corner is empty because a long lag has fewer moments to compare.

**Sparsity** drops the weakest share of the matrix to flat ground. It finds the
cut point with a histogram of 256 buckets. It does not sort about 590 000 cells.

Cosine similarity between non-negative spectra clusters in the top of its range.
Thus the app renormalises the matrix to its measured minimum and maximum before
output. Without that step the result is a plateau with faint marks on it, and
not terrain.

### Weave

The track folded onto its own bar grid. Time runs across one bar and then wraps
to the next row. Thus anything the drummer repeats stacks into a vertical ridge.
The places where the pattern breaks appear as interruptions in a woven surface.
A fill, a dropped beat or a section change makes such a break.

The tempo comes from an autocorrelation of the onset envelope over the lag range
for 60–200 BPM. The envelope is the half-wave-rectified spectral flux, so only
*rising* energy counts. A sum of the signed difference cancels the attacks
against the decays.

The app folds the result into 70–160 BPM, because raw autocorrelation locks onto
half the tempo or double the tempo as readily. To override the result, set
**BPM** by hand. To move the downbeat until the ridges stand upright, set
**Phase**.

A short track makes a thin weave. One row per bar means that a clip of
6 seconds gives three rows. Above 512 rows the app peak-folds the laps together.
Thus a long track loses resolution and is not cut short.

### Strata

Measured qualities of the track, each in its own horizontal band over one shared
timeline. These are the qualities: loudness, brightness, onset density, spectral
spread, rolloff, noisiness, low, mid and high energy, and a chromagram of 12
rows.

**Profile** fills each band up to its curve, which gives a silhouette.
**Terrace** fills the whole band at the value of the curve.

The app normalises each curve to its own range over the track. Spectral flatness
lives in a very different numeric range from loudness. A shared scale flattens
most of the strata into straight lines. What matters is how each quality moves
across *this* track.

The app measures the frequency-derived features on a log axis. The perceptual
distance from 200 Hz to 400 Hz is the same as the distance from 2 kHz to 4 kHz.
A linear centroid spends its whole range in the top octave.

### Cost

All projections run on the main thread and block it. A freeze is a one-shot
action that already pauses the playback.

| Projection | Default output | Time |
|---|---|---|
| Spectrogram | 1024 × bins | ~2 ms |
| Disc | 768² | ~20 ms |
| Similarity | 512² | ~17 ms |
| Similarity (768², enhance 32) | 768² | ~90 ms |
| Weave | 256 × bars | ~2 ms |
| Strata | 512 × 304 | ~10 ms |

The cell count drives the render cost downstream, and the longest side does not.
Thus `fitSoundscape` picks the terrain resolution from `width × height` against
a budget. That budget sits a little above the frozen spectrogram, which has always
rendered without decimation. Only the larger projections step up to resolution 2.

---

## Controls

| Control | Re-analyses? | Notes |
|---|---|---|
| FFT Size (1024 / 2048 / 4096) | yes | Larger = finer frequency, coarser time |
| Log / Linear frequency | yes | See the binning section above |
| Bins | yes | Frequency rows, and also the heightmap height |
| Window | no | Time columns, and also the heightmap width |
| Rate | no | Heightmap pushes per second |
| dB Floor | no | Noise gate. Drops quiet detail to flat ground |
| Contrast | no | Gamma after the gate. Above 1 it sharpens peaks into ridges |
| Projection and its controls | no | Affects only the freeze. Re-renders in place while frozen |

dB Floor and Contrast feed every projection as well. Thus the two sliders behave
the same way for a streamed window and for a frozen disc.

The sidebar canvas renders the whole analysed track once into an offscreen
buffer. It then blits that buffer per frame and draws the playhead and the
current slice over it. To seek, click the canvas or drag on it.

---

## Source

| File | Role |
|---|---|
| `src/utils/fft.js` | Radix-2 FFT and Hann window |
| `src/utils/spectrogram.js` | STFT, binning, `sliceWindow`, `resampleTime`, tone map |
| `src/utils/spectrogram.worker.js` | Runs the STFT off the main thread |
| `src/utils/trackProjections.js` | Whole-track projections and their param schemas |
| `src/hooks/useSoundscape.js` | Decode, transport, streaming tick, freeze |
| `src/components/SpectrogramView.jsx` | Sidebar canvas and playhead |

### Adding a projection

Add one entry to `TRACK_PROJECTIONS` in `src/utils/trackProjections.js`. The
entry needs these fields:

- An `id`.
- A `label`.
- A `blurb` of one line.
- A `build(spec, params, tone)` that returns `{ pixels, width, height }`.
- A `params` schema.

The sidebar renders the schema itself. A bare descriptor gives a slider.
`type: 'seg'` gives a segmented row. `type: 'tog'` gives a switch. A shared
`group` collapses several switches into a chip grid. Nothing else needs a change.
