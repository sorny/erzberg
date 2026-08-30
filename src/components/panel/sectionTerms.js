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
  'Hillshade':        'sun azimuth altitude shadows relief lambert penumbra softness multidirectional light',
  'Slope Shading':    'steepness gradient two-colour incline',
  'Water Fill':       'flood level sea lake opacity',
  'Aspect Map':       'slope direction hue wheel compass facing',
  'Presets':          'styles looks surprise me random roll seed thumbnails',
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
  'Mode: Exploded Frame': 'assembly diagram displaced members leaders apart layers exploded view',
  'Mode: Section':    'cutting plane cut face hatch 45 drafting convention material below beyond slice',
  'Mode: Zero Crossings': 'sign change pitch crossings detrend roughness scree dots',
  'Mode: Sprite Blocks': 'isometric voxel blocks cubes tiles arcade quantise tiers minecraft populous risers',
  'Mode: Reticulation': 'worley voronoi cellular crazing emulsion cracks gelatin film network cells',
  'Vector Layers':    'openstreetmap osm overpass roads water rail landuse buildings lifts peaks gpx geojson track labels icons names heights stacking order dash ribbon',
  'Particles':        'hologram point cloud murmurations boids flock birds predator roost scan noise audio',
  'Texture':          'image overlay blend mode scale offset',
  'Mirror':           'symmetry kaleidoscope reflect octants axis',
  'Soundscapes':      'audio mp3 wav spectrogram fft playback freeze disc similarity weave strata noise gate music',
  'Hydraulic Erosion':'droplets rain simulation inertia capacity deposition evaporation weathering',
  'Export':           'svg png stl webm plotter print heightmap preset save load download video recording',
  'Analysis':         'elevation profile cross-section transect chart a b pins',
}
