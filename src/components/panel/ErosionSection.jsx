/**
 * Hydraulic erosion, whole.
 *
 * Lifted out of Sidebar.jsx, which is not a layout change — the section renders
 * exactly where it did and looks exactly as it did. What moved is that eleven
 * pieces of state, a worker lifecycle and three handlers used to sit in the
 * middle of a 2 986-line component alongside the preset roller, the OSM fetch
 * and thirty other sections, none of which has anything to do with droplets.
 *
 * It takes `open` and `onToggle` and nothing else: everything it works on comes
 * from the store, so there is no prop surface to keep in step. The seven
 * simulation parameters are deliberately local rather than in `defaults.js` —
 * they describe one run of a tool, not the look of the plate, and nothing
 * outside this file has ever read them (they are not in a preset, not in the
 * session, and not on the param bus).
 *
 * The algorithm is Hans Beyer's droplet method; see docs/Hydraulic-Erosion.md.
 */
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore'
import ErosionWorker from '../../utils/erosion.worker?worker'
import { ACCENT, BORDER, DIM, InlineSl, Section, SURF, Sub } from './ui'

export function ErosionSection({ open, onToggle }) {
  const [eIters,     setEIters]     = useState(50000)
  const [eRadius,    setERadius]    = useState(3)
  const [eInertia,   setEInertia]   = useState(0.1)
  const [eCapacity,  setECapacity]  = useState(4)
  const [eErode,     setEErode]     = useState(0.3)
  const [eDeposit,   setEDeposit]   = useState(0.3)
  const [eEvap,      setEEvap]      = useState(0.01)
  const [isEroding,       setIsEroding]       = useState(false)
  const [erosionProgress, setErosionProgress] = useState(0)
  const [lastPixels,      setLastPixels]      = useState(null)
  // Erosion's own failure line. A run that dies used to clear its progress bar
  // and say nothing, which is indistinguishable from a run that did nothing —
  // and erosion is subtle enough that "nothing happened" is a plausible result.
  const [erosionError,    setErosionError]    = useState(null)
  const erosionWorkerRef = useRef(null)

  const heightmapPixels = useStore((s) => s.heightmapPixels)
  const heightmapWidth  = useStore((s) => s.heightmapWidth)
  const heightmapHeight = useStore((s) => s.heightmapHeight)
  const setPixels       = useStore((s) => s.setPixels)

  const handleRunErosion = () => {
    if (!heightmapPixels || isEroding) return
    setLastPixels(new Float32Array(heightmapPixels))
    setIsEroding(true)
    setErosionProgress(0)
    setErosionError(null)

    const worker = new ErosionWorker()
    erosionWorkerRef.current = worker

    worker.onmessage = (e) => {
      const { progress, result, error } = e.data
      if (progress !== undefined) { setErosionProgress(progress); return }
      if (result) setPixels(result)
      if (error) {
        console.error('[ErosionWorker]', error)
        setErosionError(error)
      }
      setIsEroding(false)
      setErosionProgress(0)
      worker.terminate()
      erosionWorkerRef.current = null
    }

    // A droplet simulation that throws out — an allocation the raster is too
    // large for, most likely — never reaches onmessage, so without this the
    // button stayed stuck on "Eroding… 0%" with no way back but a reload.
    const die = (msg) => {
      console.error('[ErosionWorker]', msg)
      setErosionError(msg)
      setIsEroding(false)
      setErosionProgress(0)
      worker.terminate()
      if (erosionWorkerRef.current === worker) erosionWorkerRef.current = null
    }
    worker.onerror = (ev) => die(ev.message || 'the worker stopped.')
    worker.onmessageerror = () => die('the result could not be read.')

    worker.postMessage({
      pixels: heightmapPixels,
      width: heightmapWidth,
      height: heightmapHeight,
      iterations: eIters,
      params: {
        erosionRadius: eRadius,
        inertia: eInertia,
        sedimentCapacityFactor: eCapacity,
        erodeSpeed: eErode,
        depositSpeed: eDeposit,
        evaporateSpeed: eEvap,
      },
    })
  }

  /**
   * Abandon a run in progress.
   *
   * Terminating is safe here in a way it is not for the geometry worker: the
   * droplet simulation posts progress and then one final result, and `setPixels`
   * is only ever called with that result — so a run killed part-way has written
   * nothing, and the raster is exactly as it was. There is no partial state to
   * roll back and no cached raster to lose.
   */
  const handleCancelErosion = () => {
    if (!erosionWorkerRef.current) return
    erosionWorkerRef.current.terminate()
    erosionWorkerRef.current = null
    setIsEroding(false)
    setErosionProgress(0)
    // No error line: abandoning a run is the user's own decision, and the
    // "Erosion failed" box would be reporting their click back to them.
    setErosionError(null)
    // The pre-run snapshot is dropped too. Undo means "put back what erosion
    // changed", and nothing changed — leaving it armed would offer to restore a
    // raster identical to the one on screen.
    setLastPixels(null)
  }

  const handleUndoErosion = () => {
    if (!lastPixels) return
    setPixels(lastPixels)
    setLastPixels(null)
  }

  useEffect(() => () => { erosionWorkerRef.current?.terminate() }, [])

  return (
    <Section title="Hydraulic Erosion" open={open} onToggle={onToggle}>
      <Sub>
        <InlineSl label="Iterations" help="Total number of raindrops to simulate." min={1000} max={2000000} step={1000} value={eIters} onChange={v => setEIters(v)} fmt={v => (v/1000).toFixed(0)+'k'} />
        <InlineSl label="Radius" help="The width of the erosion brush." min={2} max={10} value={eRadius} onChange={v => setERadius(v)} />
        <InlineSl label="Inertia" help="Droplet momentum." min={0.01} max={0.5} step={0.01} value={eInertia} onChange={v => setEInertia(v)} fmt={v => v.toFixed(2)} />
        <InlineSl label="Capacity" help="Multiplier for sediment carry speed." min={1} max={20} step={0.5} value={eCapacity} onChange={v => setECapacity(v)} />
        <InlineSl label="Erosion" help="Aggressiveness of soil removal." min={0.01} max={1} step={0.01} value={eErode} onChange={v => setEErode(v)} fmt={v => v.toFixed(2)} />
        <InlineSl label="Deposition" help="Speed of sediment drop." min={0.01} max={1} step={0.01} value={eDeposit} onChange={v => setEDeposit(v)} fmt={v => v.toFixed(2)} />
        <InlineSl label="Evaporation" help="Droplet shrinkage rate." min={0.001} max={0.1} step={0.001} value={eEvap} onChange={v => setEEvap(v)} fmt={v => v.toFixed(3)} />
      </Sub>
      <div style={{ display:'flex', gap:4 }}>
        <button onClick={handleRunErosion} disabled={!heightmapPixels || isEroding} style={{ flex:2, padding:'8px 0', background: ACCENT, color:'#fff', border:'none', borderRadius:5, cursor: (heightmapPixels && !isEroding) ? 'pointer' : 'default', fontSize:11, fontWeight:600, opacity: (heightmapPixels && !isEroding) ? 1 : 0.5 }}>{isEroding ? `Eroding… ${erosionProgress}%` : 'Run Erosion'}</button>
        {/* Cancel takes Undo's place while a run is live — the two are never
            useful at the same moment, and the row keeps its shape. */}
        {isEroding ? (
          <button onClick={handleCancelErosion} data-testid="erosion-cancel"
            style={{ flex:1, padding:'8px 0', background: SURF, color: DIM, border:`1px solid ${BORDER}`, borderRadius:5, cursor:'pointer', fontSize:11, fontWeight:600 }}>Cancel</button>
        ) : (
          <button onClick={handleUndoErosion} disabled={!lastPixels} style={{ flex:1, padding:'8px 0', background: SURF, color: DIM, border:`1px solid ${BORDER}`, borderRadius:5, cursor: lastPixels ? 'pointer' : 'default', fontSize:11, fontWeight:600, opacity: lastPixels ? 1 : 0.5 }}>Undo</button>
        )}
      </div>
      {erosionError && (
        <div data-testid="erosion-error" role="status" style={{
          marginTop: 6, fontSize: 10, lineHeight: 1.45, color: '#fca5a5',
          background: 'rgba(153,27,27,0.18)', border: '1px solid #7f1d1d',
          borderRadius: 4, padding: '5px 7px',
        }}>Erosion failed — {erosionError}</div>
      )}
    </Section>
  )
}
