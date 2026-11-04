/**
 * My presets, as React state over `utils/presetShelf.js`.
 *
 * Every change is written to the browser at once. If the browser refuses (its
 * storage is full), the shelf on screen keeps the change and the user is told,
 * so nothing vanishes without a word.
 */
import { useCallback, useState } from 'react'
import { presetToText } from '../utils/presetFile'
import {
  addToShelf, freeName, mergeShelf, readShelf, removeFromShelf, shelfFromText,
  shelfPreset, shelfToText, thumbnailOf, writeShelf,
} from '../utils/presetShelf'

export function usePresetShelf({ exportPreset, paper, canvasRef, applyPreset, notify }) {
  const [shelf, setShelf] = useState(() => readShelf())

  const commit = useCallback((next) => {
    setShelf(next)
    if (!writeShelf(next)) notify('The browser would not store the shelf. It may be full: remove a preset, or save the shelf to a file.')
  }, [notify])

  const keep = useCallback((name) => {
    const canvas = canvasRef.current
    const entry = {
      name: (name || '').trim() || freeName(shelf, 'My preset'),
      text: presetToText(exportPreset),
      thumb: canvas ? thumbnailOf(canvas, paper) : null,
      saved: new Date().toISOString(),
    }
    commit(addToShelf(shelf, entry))
    notify(`Kept as “${entry.name}” in My presets.`)
    return entry.name
  }, [shelf, exportPreset, paper, canvasRef, commit, notify])

  const apply = useCallback((entry) => {
    const d = shelfPreset(entry)
    if (!d) { notify(`“${entry.name}” could not be read.`); return }
    applyPreset(d, entry.name)
  }, [applyPreset, notify])

  const remove = useCallback((name) => {
    const before = shelf
    commit(removeFromShelf(shelf, name))
    notify(`“${name}” removed from My presets.`, { action: 'Undo', onAction: () => commit(before) })
  }, [shelf, commit, notify])

  const saveFile = useCallback(() => {
    const url = URL.createObjectURL(new Blob([shelfToText(shelf)], { type: 'application/json' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'erzberg-presets.json' })
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [shelf])

  const openFile = useCallback(() => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' })
    input.onchange = async (e) => {
      const file = e.target.files[0]; if (!file) return
      const incoming = shelfFromText(await file.text())
      if (!incoming) { notify('That file is not an erzberg preset shelf. Open the file written by Shelf ⬇.'); return }
      const next = mergeShelf(shelf, incoming)
      commit(next)
      notify(`${next.length - shelf.length} preset${next.length - shelf.length === 1 ? '' : 's'} added to My presets.`)
    }
    input.click()
  }, [shelf, commit, notify])

  return { shelf, keep, apply, remove, saveFile, openFile }
}
