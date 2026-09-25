import { useMemo } from 'react'
import { buildImageryBackdrop, buildRasterBackdrop, resolveBackdrop } from '../utils/rasterBackdrop'

/**
 * The backdrop canvas for Edit Mode and the Mask Studio. Builds only the one
 * that is shown, once per source; the per-frame draw is a single blit of it.
 */
export function useBackdrop({ srcPixels, srcMask, srcWidth, srcHeight, imagery, tone, choice }) {
  const photo = useMemo(() => buildImageryBackdrop(imagery, tone), [imagery, tone])
  const mode = resolveBackdrop(choice, !!photo)
  const raster = useMemo(
    () => (mode === 'imagery' ? null : buildRasterBackdrop(srcPixels, srcMask, srcWidth, srcHeight, mode)),
    [mode, srcPixels, srcMask, srcWidth, srcHeight],
  )
  return { canvas: mode === 'imagery' ? photo : raster, mode, hasPhoto: !!photo }
}
