import { test } from '@playwright/test'
import { resetToDefaults } from './helpers.js'

test('sweep', async ({ page }) => {
  await page.goto('http://localhost:5173')
  await page.waitForSelector('text=Grid:', { timeout: 30000 })
  await resetToDefaults(page)
  const rows = await page.evaluate(async () => {
    const { buildLineGeometry } = await import('/src/utils/geometryBuilders.js')
    const { buildTerrain } = await import('/src/utils/terrain.js')
    const { TERRAIN_DEF, STYLE_DEF } = await import('/src/defaults.js')
    const px = window.__erzPixels
    const N = 220
    // A ridged synthetic massif, so the sweep is reproducible.
    const g = new Float32Array(N * N)
    const h2 = (x, y, s) => { let n = (Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(s,1442695041))|0
      n = Math.imul(n ^ (n>>>13), 1274126177); return ((n ^ (n>>>16))>>>0)/4294967295 }
    const vn = (x,y,s) => { const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy
      const u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy)
      return h2(ix,iy,s)*(1-u)*(1-v)+h2(ix+1,iy,s)*u*(1-v)+h2(ix,iy+1,s)*(1-u)*v+h2(ix+1,iy+1,s)*u*v }
    let mn=1e9,mx=-1e9
    for (let r=0;r<N;r++) for (let c=0;c<N;c++) {
      let a=0,amp=1,f=1/70,sum=0
      for (let o=0;o<6;o++){ a+=amp*(1-Math.abs(vn(c*f,r*f,11+o*37)*2-1)); sum+=amp; amp*=0.52; f*=2.03 }
      a=Math.pow(a/sum,2.15)
      const dx=(c/(N-1)-0.48)*2, dy=(r/(N-1)-0.52)*2
      a*=Math.pow(1-Math.min(1,Math.sqrt(dx*dx*0.82+dy*dy*0.88))**2,0.85)
      g[r*N+c]=a; if(a<mn)mn=a; if(a>mx)mx=a
    }
    for (let i=0;i<g.length;i++) g[i]=(g[i]-mn)/(mx-mn)
    const mask = new Uint8Array(N*N).fill(1)
    void px

    const out = []
    for (const [height, falloff, exposure, contrast] of [
      [1.2, 1.0, 1.15, 1.35],
      [1.6, 1.3, 1.4,  1.3],
      [1.6, 1.3, 1.8,  1.25],
      [2.0, 1.6, 2.0,  1.2],
      [2.0, 1.6, 2.4,  1.15],
      [2.4, 2.0, 2.8,  1.1],
    ]) {
      const p = { ...TERRAIN_DEF, ...STYLE_DEF, resolution: 1, elevScale: 1, blurRadius: 0,
                  enabledLines: false, enabledFlashbulb: true, spacingFlashbulb: 1,
                  heightFlashbulb: height, falloffFlashbulb: falloff,
                  exposureFlashbulb: exposure, contrastFlashbulb: contrast }
      const t0 = performance.now()
      const t = buildTerrain(g, mask, N, N, p)
      const layers = buildLineGeometry(t, p)
      const ms = Math.round(performance.now() - t0)
      const l = layers.find(x => x.id === 'Flashbulb')
      const dots = l ? l.positions.length / 6 : 0
      out.push({ height, falloff, exposure, contrast, dots, coverage: +(100*dots/(N*N)).toFixed(1), ms })
    }
    return out
  })
  console.log(JSON.stringify(rows, null, 0).replace(/},/g, '},\n'))
})
