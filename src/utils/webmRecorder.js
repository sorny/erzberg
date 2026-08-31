/**
 * WebM video capture using the browser's MediaRecorder API.
 * Captures frames directly from the Three.js WebGL canvas.
 *
 * ── Why there is EBML in here ────────────────────────────────────────────────
 *
 * The other exporters can put the ODbL credit somewhere the format provides for:
 * an XML comment in the SVG, a `tEXt` chunk in the PNG, the 80-byte header of a
 * binary STL. `MediaRecorder` hands back a finished Matroska stream and takes no
 * metadata at all, so the credit has to be written into the container after the
 * fact.
 *
 * That is cheaper than it sounds, because of one measured property of what
 * Chrome produces: **the Segment is written with an unknown size** — an 8-byte
 * VINT of all ones — as live recording requires, since the length is not known
 * when the header is written. Nothing anywhere in the file records a length
 * that an insertion would invalidate, so a `Tags` element can be spliced in
 * without rewriting a single size field.
 *
 * **Where** it goes is the part that had to be measured rather than reasoned
 * about. Appending after the last Cluster is well-formed Matroska and is what
 * this did first; ffmpeg reads nothing of it. For an unknown-size Segment a
 * demuxer has no length to seek against and no SeekHead to consult — Chrome
 * writes none — so it parses header elements only until the first Cluster and
 * then switches to reading packets. Everything past that point is frames as far
 * as it is concerned. Verified with ffprobe: appended, the tag is invisible;
 * spliced in before the first Cluster, it reads.
 *
 * A notice nothing reads is worse than no notice, because it looks like the
 * obligation was met.
 *
 * This is metadata, not a watermark. Nothing is drawn into the picture: a
 * credit burned into the frames would be a change to the artwork, which is not
 * something a licence obligation gets to make on the user's behalf.
 */

let recorder  = null
let chunks    = []
let stopTimer = null

// ── Minimal EBML writer ───────────────────────────────────────────────────────

/**
 * EBML variable-length integer, in the narrowest width that fits.
 *
 * The leading bits mark the width: `1xxxxxxx` is one byte, `01xxxxxx xxxxxxxx`
 * two, and so on. The all-ones value at each width is reserved to mean "unknown"
 * — which is exactly what the Segment above uses — so a size that would encode
 * as all ones has to move up a width rather than collide with it.
 */
function vint(n) {
  for (let len = 1; len <= 8; len++) {
    const max = Math.pow(2, 7 * len) - 1
    if (n < max) {
      const out = new Uint8Array(len)
      let v = n
      for (let i = len - 1; i >= 0; i--) { out[i] = v % 256; v = Math.floor(v / 256) }
      out[0] |= 1 << (8 - len)
      return out
    }
  }
  return null
}

/** One EBML element: its id bytes, its size as a VINT, then the payload. */
function elem(id, payload) {
  const size = vint(payload.length)
  if (!size) return null
  const out = new Uint8Array(id.length + size.length + payload.length)
  out.set(id, 0)
  out.set(size, id.length)
  out.set(payload, id.length + size.length)
  return out
}

const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}

const ID = {
  Tags:      [0x12, 0x54, 0xC3, 0x67],
  Tag:       [0x73, 0x73],
  Targets:   [0x63, 0xC0],
  SimpleTag: [0x67, 0xC8],
  TagName:   [0x45, 0xA3],
  TagString: [0x44, 0x87],
}

/**
 * A `Tags` element carrying one global tag, ready to append to the Segment.
 *
 * `Targets` is present and empty, which is what Matroska means by "this applies
 * to the whole file" — it is required even when it says nothing. `COPYRIGHT` is
 * one of the specification's own tag names rather than something invented here,
 * so the readers that display tags already know to show it.
 */
function tagsElement(name, value) {
  const utf8 = new TextEncoder()
  const simple = elem(ID.SimpleTag,
    cat(elem(ID.TagName, utf8.encode(name)), elem(ID.TagString, utf8.encode(value))))
  if (!simple) return null
  const tag = elem(ID.Tag, cat(elem(ID.Targets, new Uint8Array(0)), simple))
  return tag ? elem(ID.Tags, tag) : null
}

/** Read an EBML id at `i`; its own leading bits give its width. */
function readId(bytes, i) {
  const b = bytes[i]
  let len = 1
  for (let m = 0x80; m && !(b & m); m >>= 1) len++
  if (len > 4 || i + len > bytes.length) return null
  let id = 0
  for (let k = 0; k < len; k++) id = id * 256 + bytes[i + k]
  return { id, len }
}

/** Read an EBML size VINT at `i`, flagging the reserved all-ones "unknown". */
function readSize(bytes, i) {
  const b = bytes[i]
  let len = 1
  for (let m = 0x80; m && !(b & m); m >>= 1) len++
  if (len > 8 || i + len > bytes.length) return null
  let v = b & (0xFF >> len)
  let unknown = v === (0xFF >> len)
  for (let k = 1; k < len; k++) {
    v = v * 256 + bytes[i + k]
    if (bytes[i + k] !== 0xFF) unknown = false
  }
  return { v, len, unknown }
}

const SEGMENT = 0x18538067
const CLUSTER = 0x1F43B675

/**
 * Splice the credit into a recorded WebM, or hand back the original untouched.
 *
 * The tag goes immediately before the first Cluster — see the note at the top of
 * this file for why the end of the file does not work. Every check here is a
 * refusal rather than a repair: an input this does not fully understand comes
 * back as it arrived, because a recording that saves without its metadata is a
 * compliance gap and a recording that will not play is a broken feature.
 */
export async function withWebmTag(blob, name, value) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (bytes.length < 40) return blob
    if (bytes[0] !== 0x1A || bytes[1] !== 0x45 || bytes[2] !== 0xDF || bytes[3] !== 0xA3) return blob

    // Step over the EBML header to the Segment.
    const ebmlSize = readSize(bytes, 4)
    if (!ebmlSize) return blob
    let i = 4 + ebmlSize.len + ebmlSize.v

    const seg = readId(bytes, i)
    if (!seg || seg.id !== SEGMENT) return blob
    const segSize = readSize(bytes, i + seg.len)
    if (!segSize) return blob
    i += seg.len + segSize.len

    // Walk the Segment's children to the first Cluster. Every child before it
    // carries a real size, so this is a straight walk rather than a search.
    let insertAt = -1
    while (i < bytes.length) {
      const id = readId(bytes, i)
      if (!id) break
      const size = readSize(bytes, i + id.len)
      if (!size) break
      if (id.id === CLUSTER) { insertAt = i; break }
      if (size.unknown) break
      i += id.len + size.len + size.v
    }
    if (insertAt < 0) return blob

    const tags = tagsElement(name, value)
    if (!tags) return blob
    return new Blob([bytes.subarray(0, insertAt), tags, bytes.subarray(insertAt)],
                    { type: blob.type || 'video/webm' })
  } catch {
    return blob
  }
}

export function startWebM(canvas, durationSecs, onStateChange, baseName, attribution = null) {
  if (recorder) return

  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
    .find(m => MediaRecorder.isTypeSupported(m)) ?? ''

  try {
    const stream = canvas.captureStream(30)
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunks = []

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data) }
    recorder.onstop = async () => {
      let blob = new Blob(chunks, { type: 'video/webm' })
      // ODbL: the credit goes into the container, not into the picture.
      if (attribution) blob = await withWebmTag(blob, 'COPYRIGHT', attribution)
      const url = URL.createObjectURL(blob)
      Object.assign(document.createElement('a'), {
        href: url, download: `${baseName ?? 'heightmap'}.webm`,
      }).click()
      URL.revokeObjectURL(url)
      recorder = null
      chunks   = []
      onStateChange?.(false)
    }

    recorder.start(100)
    onStateChange?.(true)

    if (durationSecs > 0) {
      stopTimer = setTimeout(() => stopWebM(onStateChange), durationSecs * 1000)
    }
    return true
  } catch (err) {
    console.error('[WebM] Failed to start recording:', err)
    recorder = null
    // Reported rather than swallowed: the caller puts a "recording…" message on
    // screen, and a browser whose captureStream throws would otherwise be told
    // it had started something it had not.
    return false
  }
}

export function stopWebM(onStateChange) {
  clearTimeout(stopTimer)
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop()
  }
  onStateChange?.(false)
}

export function isRecording() {
  return recorder !== null && recorder.state === 'recording'
}
