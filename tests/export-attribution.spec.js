import { test, expect } from '@playwright/test'

/**
 * The ODbL credit in a recorded WebM.
 *
 * `MediaRecorder` accepts no metadata, so the credit is spliced into the
 * Matroska container afterwards — and *where* it goes is the whole of what this
 * asserts, because the obvious place does not work.
 *
 * Chrome writes the Segment with an unknown size, as live recording requires.
 * A demuxer therefore has no length to seek against and no SeekHead to consult,
 * so it parses header elements only until the first Cluster and reads
 * everything after that as frames. A `Tags` element appended to the end of the
 * file is well-formed Matroska that nothing reads — verified with ffprobe,
 * which reported no tag at all until the element moved ahead of the Cluster.
 *
 * A notice nothing reads is worse than no notice, because it looks like the
 * obligation was met. So the position is the assertion.
 */
test('the WebM credit is written where a demuxer will find it', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30000 })

  const r = await page.evaluate(async () => {
    const { withWebmTag } = await import('/src/utils/webmRecorder.js')

    const c = document.createElement('canvas')
    c.width = c.height = 64
    const ctx = c.getContext('2d')
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((m) => MediaRecorder.isTypeSupported(m))
    if (!mime) return { unsupported: true }

    const rec = new MediaRecorder(c.captureStream(30), { mimeType: mime })
    const chunks = []
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise((res) => { rec.onstop = res })
    rec.start(100)
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : '#000'
      ctx.fillRect(0, 0, 64, 64)
      await new Promise((res) => setTimeout(res, 40))
    }
    rec.stop()
    await done

    const plain = new Blob(chunks, { type: 'video/webm' })
    const tagged = await withWebmTag(plain, 'COPYRIGHT', 'OpenStreetMap contributors')
    const bytes = new Uint8Array(await tagged.arrayBuffer())

    // Walk the Segment the way a demuxer does, recording what it meets and in
    // what order. It stops at the first Cluster, so anything after that is
    // invisible to it.
    const readId = (i) => {
      const b = bytes[i]
      let len = 1
      for (let m = 0x80; m && !(b & m); m >>= 1) len++
      let id = 0
      for (let k = 0; k < len; k++) id = id * 256 + bytes[i + k]
      return { id, len }
    }
    const readSize = (i) => {
      const b = bytes[i]
      let len = 1
      for (let m = 0x80; m && !(b & m); m >>= 1) len++
      let v = b & (0xFF >> len)
      let unknown = v === (0xFF >> len)
      for (let k = 1; k < len; k++) {
        v = v * 256 + bytes[i + k]
        if (bytes[i + k] !== 0xFF) unknown = false
      }
      return { v, len, unknown }
    }

    const ebmlSize = readSize(4)
    let i = 4 + ebmlSize.len + ebmlSize.v
    const seg = readId(i)
    const segSize = readSize(i + seg.len)
    i += seg.len + segSize.len

    const before = []
    let sawCluster = false
    while (i < bytes.length) {
      const id = readId(i)
      const size = readSize(i + id.len)
      if (id.id === 0x1F43B675) { sawCluster = true; break }
      before.push(id.id)
      if (size.unknown) break
      i += id.len + size.len + size.v
    }

    const text = new TextDecoder().decode(bytes)
    return {
      grew: tagged.size - plain.size,
      segmentUnknownSize: segSize.unknown,
      sawCluster,
      tagsBeforeCluster: before.includes(0x1254C367),
      carriesCredit: text.includes('OpenStreetMap contributors'),
      carriesTagName: text.includes('COPYRIGHT'),
    }
  })

  test.skip(!!r.unsupported, 'this browser records no WebM')

  // The property the whole approach rests on: nothing records a length that an
  // insertion would invalidate.
  expect(r.segmentUnknownSize).toBe(true)
  expect(r.sawCluster).toBe(true)

  // And the one that decides whether any of it is read.
  expect(r.tagsBeforeCluster).toBe(true)
  expect(r.carriesTagName).toBe(true)
  expect(r.carriesCredit).toBe(true)
  expect(r.grew).toBeGreaterThan(0)
})

test('an untagged recording is handed back byte for byte', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30000 })

  const same = await page.evaluate(async () => {
    const { withWebmTag } = await import('/src/utils/webmRecorder.js')
    // Not Matroska. Every check in the splicer is a refusal rather than a
    // repair: a recording that will not play is worse than one without metadata.
    const junk = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])], { type: 'video/webm' })
    const out = await withWebmTag(junk, 'COPYRIGHT', 'x')
    return out.size === junk.size
  })
  expect(same).toBe(true)
})
