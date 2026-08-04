# Soundscapes

Soundscapes turns an audio file into terrain. The track is analysed once into a
spectrogram, and playback then *streams* a window of that spectrogram into the
heightmap store — the same slot a PNG or GeoTIFF occupies. Every existing tool
therefore applies unchanged: all thirteen draw modes, hillshade, erosion, and
the SVG / PNG / STL exporters.

---

## Pipeline

```
 .mp3 ──decodeAudioData──> mono PCM ──STFT (worker)──> spectrogram
                                                          │
                        ┌─────────────────────────────────┤
                        │                                 │
             sidebar canvas (whole track)      sliceWindow() per tick
                                                          │
                                                  setHeightmap() ──> terrain
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
static heightmap, peak-holding the time axis down to at most 1024 columns so the
result stays in the same size class as a normal raster.

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

The sidebar canvas renders the whole analysed track once into an offscreen
buffer and blits it per frame, overlaying the playhead and the slice currently
feeding the terrain. Click or drag it to seek.

---

## Source

| File | Role |
|---|---|
| `src/utils/fft.js` | Radix-2 FFT + Hann window |
| `src/utils/spectrogram.js` | STFT, binning, `sliceWindow`, `resampleTime` |
| `src/utils/spectrogram.worker.js` | Runs the STFT off the main thread |
| `src/hooks/useSoundscape.js` | Decode, transport, streaming tick |
| `src/components/SpectrogramView.jsx` | Sidebar canvas + playhead |
