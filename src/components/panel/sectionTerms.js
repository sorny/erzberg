/**
 * What each panel section answers to in the filter.
 *
 * A leaf module with no imports, for two reasons. It is the panel's *index* and
 * not part of any component, so it belongs beside the filter rather than inside
 * a three-thousand-line file; and `panel.spec.js` asserts the rendered panel
 * against it, which it can only do cheaply if importing the index does not drag
 * in React and three.js behind it.
 *
 * The index is stated rather than scraped from the rendered tree, because a
 * mode's parameters only mount once the mode is on — a section that cannot be
 * found while it is switched off is unfindable exactly when someone is looking
 * for it.
 *
 * The two must agree in both directions: a section missing from here is
 * unfindable, and an entry with no section is a search result that goes nowhere.
 * The spec checks the count both ways, which a hard-coded number only ever did
 * in one direction — and then went stale the next time a mode was added.
 */
export const SECTION_TERMS = {
  'Terrain':          'resolution elevation scale blur jitter min max cut hypsometric integral raw greyscale heightmap',
  'Levels':           'shadows highlights histogram black white point contrast',
  'View':             'tilt zoom rotation supersampling auto-rotate spin guides paper frame page sheet margin aspect portrait landscape a4 letter',
  'Camera':           'orthographic perspective focal length lens pan dolly',
  'Terrain Style':    'fill mesh occlusion ghost x-ray background gradient sky paper colour color',
  'Hillshade':        'sun azimuth altitude shadows relief lambert penumbra softness multidirectional light almanac ephemeris date time clock solstice equinox sunrise sunset latitude longitude timezone solar',
  'Slope Shading':    'steepness gradient two-colour incline',
  'Water Fill':       'flood level sea lake opacity',
  'Aspect Map':       'slope direction hue wheel compass facing',
  'Presets':          'styles looks surprise me random roll seed thumbnails',
  'Draw Modes':       'index grid overview marks glyphs which modes are on thirty-four all',
  'Mode: Lines':      'ridgelines parallel spacing shift angle bearing unknown pleasures dash weight opacity',
  'Mode: Crosshatch': 'hatch two directions perpendicular angle spacing',
  'Mode: Pillars':    'extrusion cuboid cylinder columns pins bars',
  'Mode: Contours':   'isolines marching squares interval chaikin smoothing form lines closing metres labels heights elevation numbers annotate',
  'Mode: Hachure':    'slope strokes ticks direction swiss',
  'Mode: Flow':       'drainage euler streamlines water paths',
  'Mode: Network':    'strahler stream order flow accumulation rivers',
  'Mode: Pencil':     'laplacian curvature shading sketch graphite',
  'Mode: Ridge':      'hessian crest eigenvalue peaks arete',
  'Mode: Valley':     'topographic position index tpi troughs gully',
  'Mode: Stipple Dots': 'dots density stochastic seed slope elevation pointillism',
  'Mode: Isophotes':  'illumination contours constant light reflection lines sun isophote',
  'Mode: Engraving':  'copperplate illumination cross-hatch shadows stacked directions',
  'Mode: Curvature':  'streamlines principal direction field wrap shape',
  'Mode: Rock & Scree': 'swisstopo cliff hachures debris dots talus seed',
  'Mode: Bitplane':   'tilemap quantise plateaus tiers steps staircase dither bayer screen pixel voxel isometric arcade 16-bit retro',
  'Mode: Flashbulb':  'point light bulb flash inverse square falloff cast shadow ray march blue noise grain film emulsion photograph solarise sabattier contrast exposure',
  'Mode: Halation':   'bloom glow halo bleed highlight edge blown emulsion film red orange flare light spill',
  'Mode: Fall Line':  'snowboard ski descent momentum mass inertia carve yaw gravity friction runout track downhill bike',
  'Mode: Berms':      'banking lateral load cornering g-force turn ticks camber',
  'Mode: Air':        'jump kicker launch ballistic parabola flight convex lip gap send',
  'Mode: Race Line':  'braid fan drop-in fastest descent variants spread choices',
  'Mode: Section':    'cutting plane cut face hatch 45 drafting convention material below beyond slice',
  'Mode: Shadow Line': 'shadow line terminator edge of the sun lit unlit boundary solstice hour clock dawn dusk cast',
  'Mode: Sun Hours':  'sun hours insolation solar aspect shade shadow year solstice latitude hut siting ski snow direct sunlight duration',
  'Mode: Crossings':  'zero crossings sign change pitch detrend roughness scree dots',
  'Mode: Sprite Blocks': 'isometric voxel blocks cubes tiles arcade quantise tiers minecraft populous risers',
  'Mode: Reticulation': 'worley voronoi cellular crazing emulsion cracks gelatin film network cells',
  'Mode: Indexed':    'palette lookup index 2d table quantise tiers slope bands bayer dither 16-bit retro gameboy arcade sky ramp swatches',
  'Mode: Outrun':     'neon glow additive synthwave retrowave vaporwave magenta cyan halo bloom filament emit light dark 80s',
  'Mode: Riso':       'risograph spot colour overprint separation screens halftone angles misregistration registration fluorescent pink aqua duplicator print zine multiply total area coverage tac ink limit cap press cmyk',
  'Mode: Mineral':    'geology rock type field map material classification survey sheet ochre lichen scree grain texture',
  'Mode: Land cover':  'landcover land use vegetation forest water rock alphaearth embedding satellite class plate material parcels',
  'Mode: Watershed':  'catchment basin drainage divide d8 flood label flat colour blocking pop art ridgelines',
  'Text':             'annotation title caption note signature words type lettering free text label place sign headline credit inscription typography',
  'Vector Layers':    'openstreetmap osm overpass roads water rail landuse buildings lifts peaks gpx geojson track labels icons names heights stacking order dash ribbon',
  'Particles':        'hologram point cloud murmurations boids flock birds predator roost scan noise audio',
  'Texture':          'image overlay blend mode scale offset',
  'Mirror':           'symmetry kaleidoscope reflect octants axis',
  'Soundscapes':      'audio mp3 wav spectrogram fft playback freeze disc similarity weave strata noise gate music',
  'Hydraulic Erosion':'droplets rain simulation inertia capacity deposition evaporation weathering',
  'Export':           'svg png stl webm plotter print heightmap preset save load download video recording metadata reopen embedded settings project file preflight pen order route travel ink sheet width millimetres estimate',
  'Fetch Terrain':    'download dem elevation place name search geocode nominatim openstreetmap mountain summit valley town tiles terrarium aws online',
  'Satellite':        'satellite imagery aerial photo sentinel copernicus true colour drape backdrop scene cloud esa',
  'Masks':            'mask masks paint brush draw stencil region select restrict layer studio import png jpg',
  'Land Cover':       'landcover land use class classes mask stencil vegetation forest water rock alphaearth embedding satellite plate ink by class',
  'Anaglyph':         'anaglyph stereo 3d red cyan glasses depth parallax two pen eyes stereoscopic',
  'Scale and North':  'scale bar ruler distance metres kilometres north arrow compass bearing grid convergence ratio legend annotation',
  'Analysis':         'elevation profile cross-section transect chart a b pins',
}
