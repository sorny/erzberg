/**
 * The OpenStreetMap catalogue — what can be asked for, and what it should look
 * like when it arrives.
 *
 * "Everything OSM has for this extent" is not a query anyone actually wants: an
 * alpine valley holds a few hundred roads and a few hundred *thousand* building
 * outlines, and the two want opposite defaults. So the panel offers this curated
 * set as a checklist, and each ticked category contributes its selectors to one
 * Overpass query.
 *
 * Each category then splits its features into **buckets**, and a bucket is what
 * becomes a layer. Splitting by tag value rather than by category is what makes
 * the panel readable — "Roads · Motorway" and "Roads · Track" are two things a
 * cartographer wants to draw differently, and merging them into one "Roads"
 * layer would mean recolouring both or neither. Buckets with nothing in them are
 * never created, so a tile with no railways grows no rail rows.
 *
 * Default styles are the modest half of a topographic palette: weights that read
 * at a plotter's pen sizes, and colours dark enough to sit on pale terrain.
 * They are only seeds — every one of them is editable per layer afterwards.
 */

/**
 * A tag value, but only if the category owns it.
 *
 * OSM tags overlap heavily and the Overpass selectors only constrain what is
 * *downloaded* — one query brings back every ticked category's elements mixed
 * together, and `classify` then hands each element to the first category that
 * claims it. A category that claims too much therefore steals from the ones
 * after it, silently and with a plausible-looking layer name.
 */
const pick = (value, allowed) => (value && allowed.has(value) ? value : null)

const LANDUSE_VALUES = new Set([
  'forest', 'meadow', 'farmland', 'orchard', 'vineyard', 'quarry', 'residential',
  'industrial', 'cemetery', 'wood', 'scrub', 'grassland', 'heath', 'glacier',
  'scree', 'bare_rock', 'sand', 'wetland',
])
const WATER_VALUES = new Set(['lake', 'pond', 'river', 'reservoir', 'basin'])
const WATERWAY_VALUES = new Set(['river', 'stream', 'canal', 'ditch', 'drain'])
const HIGHWAY_VALUES = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified',
  'residential', 'living_street', 'service', 'track', 'path', 'footway',
  'cycleway', 'bridleway', 'steps',
])
const RAILWAY_VALUES = new Set([
  'rail', 'narrow_gauge', 'light_rail', 'tram', 'subway', 'funicular', 'monorail',
])
const PEAK_VALUES = new Set(['peak', 'saddle', 'volcano'])
const ADMIN_LEVELS = new Set(['2', '4', '6', '8'])

/**
 * DETAIL TIERS — how much to ask for at what size.
 *
 * "Everything OSM has for this extent" stops being a query anyone wants long
 * before the servers refuse it. Measured over 1 250 km² around Graz: 97 092 road
 * ways, of which 6 152 are motorway…tertiary; 13 828 waterways, of which the
 * rivers and canals are 162. Over the whole of Styria the same tick boxes ask
 * for about 1.2 million elements and a gigabyte of inlined geometry — past
 * Overpass's own 180 s budget, past `MAX_ELEMENTS`, and past what a tab can
 * hold. The same extent asked for at `broad` is 56 000 elements and 72 MB, which
 * arrives in under a minute.
 *
 * And it is the better drawing. Every footpath and drainage ditch in Styria,
 * plotted at that scale, is a black smear — generalising is what a cartographer
 * does to a small-scale sheet anyway, not a compromise forced by the transport.
 *
 * Two levers, both server-side, because what matters is what is never sent:
 *  • **Fewer classes.** Coarser tiers name fewer tag values.
 *  • **Bigger features only.** `(if:length() > n)` drops small polygons and
 *    stubs by perimeter in metres — 43 048 forest ways over Styria become 342 at
 *    10 km, and the ones that survive are the forests you would draw.
 *
 * Relations are never length-filtered: they are the few hundred large
 * multipolygons in any extent, and they are what the coarse tiers are for.
 */
export const OSM_DETAIL_TIERS = ['full', 'mid', 'broad']

/** What each tier is called where a user can see it. */
export const OSM_DETAIL_LABEL = {
  full:  'everything',
  mid:   'main features',
  broad: 'major features only',
}

// Area rather than the longer side: a 200 × 5 km river valley is a small fetch
// and must not be generalised as though it were a province.
const MID_ABOVE_KM2   = 2_500      // 50 × 50 km
const BROAD_ABOVE_KM2 = 22_500     // 150 × 150 km

/** Which tier an extent of this many square kilometres asks for. */
export function detailTierFor(areaKm2) {
  if (!(areaKm2 > 0)) return 'full'
  if (areaKm2 > BROAD_ABOVE_KM2) return 'broad'
  if (areaKm2 > MID_ABOVE_KM2) return 'mid'
  return 'full'
}

/**
 * A category's selectors at one tier.
 *
 * A category with nothing to say at a tier keeps the next finer one's list, so
 * `coarse` only has to name what actually changes — Peaks and Admin boundaries
 * are a few thousand elements over a whole province and are the same at every
 * size.
 */
export function selectorsFor(category, tier) {
  const coarse = category.coarse
  if (!coarse) return category.selectors
  if (tier === 'broad') return coarse.broad ?? coarse.mid ?? category.selectors
  if (tier === 'mid') return coarse.mid ?? category.selectors
  return category.selectors
}

// Ordering is load-bearing twice over: it is the order layers appear in the
// panel, and the order they are drawn in, so ground cover has to come before the
// things that sit on top of it.
export const OSM_CATEGORIES = [
  {
    id: 'landuse',
    label: 'Landuse & natural',
    short: 'Land',
    geom: 'area',
    heavy: false,
    selectors: [
      'way["landuse"~"^(forest|meadow|farmland|orchard|vineyard|quarry|residential|industrial|cemetery)$"]',
      'relation["landuse"~"^(forest|meadow|farmland|orchard|vineyard|quarry|residential|industrial|cemetery)$"]',
      'way["natural"~"^(wood|scrub|grassland|heath|glacier|scree|bare_rock|sand|wetland)$"]',
      'relation["natural"~"^(wood|scrub|grassland|heath|glacier|scree|bare_rock|sand|wetland)$"]',
    ],
    // 317 758 elements over Styria at full detail — the single heaviest thing on
    // the panel, ahead of roads. By perimeter: 43 087 above 1 km, 8 328 above 3.
    coarse: {
      mid: [
        'way["landuse"~"^(forest|meadow|farmland|orchard|vineyard|quarry|residential|industrial|cemetery)$"](if:length()>1000)',
        'relation["landuse"~"^(forest|meadow|farmland|orchard|vineyard|quarry|residential|industrial|cemetery)$"]',
        'way["natural"~"^(wood|scrub|grassland|heath|glacier|scree|bare_rock|sand|wetland)$"](if:length()>1000)',
        'relation["natural"~"^(wood|scrub|grassland|heath|glacier|scree|bare_rock|sand|wetland)$"]',
      ],
      broad: [
        'way["landuse"~"^(forest|meadow|farmland|orchard|vineyard|quarry|residential|industrial|cemetery)$"](if:length()>3000)',
        'relation["landuse"~"^(forest|meadow|farmland|orchard|vineyard|quarry|residential|industrial|cemetery)$"]',
        'way["natural"~"^(wood|scrub|grassland|heath|glacier|scree|bare_rock|sand|wetland)$"](if:length()>3000)',
        'relation["natural"~"^(wood|scrub|grassland|heath|glacier|scree|bare_rock|sand|wetland)$"]',
      ],
    },
    // Strict: a category must claim only the values it actually lists. The
    // permissive version (`t.landuse || t.natural`) swallowed `natural=water`
    // and `natural=peak` before Water bodies and Peaks ever saw them, and the
    // panel filled with rows called "Land · peak".
    bucketOf: (t) => pick(t.landuse, LANDUSE_VALUES) ?? pick(t.natural, LANDUSE_VALUES),
    labels: {
      forest: 'Forest', wood: 'Wood', meadow: 'Meadow', farmland: 'Farmland',
      orchard: 'Orchard', vineyard: 'Vineyard', quarry: 'Quarry',
      residential: 'Built-up', industrial: 'Industrial', cemetery: 'Cemetery',
      scrub: 'Scrub', grassland: 'Grassland', heath: 'Heath', glacier: 'Glacier',
      scree: 'Scree', bare_rock: 'Bare rock', sand: 'Sand', wetland: 'Wetland',
    },
    styles: {
      forest:    { color: '#2f6b3a', fillColor: '#2f6b3a', fillOpacity: 0.30 },
      wood:      { color: '#2f6b3a', fillColor: '#2f6b3a', fillOpacity: 0.30 },
      glacier:   { color: '#7fb8d8', fillColor: '#cfe8f5', fillOpacity: 0.55 },
      scree:     { color: '#8a8578', fillColor: '#c8c2b2', fillOpacity: 0.35 },
      bare_rock: { color: '#7a7368', fillColor: '#b9b1a3', fillOpacity: 0.35 },
      quarry:    { color: '#8b5e34', fillColor: '#c99c6b', fillOpacity: 0.35 },
      wetland:   { color: '#4b8f8f', fillColor: '#8fc4c4', fillOpacity: 0.35 },
    },
    style: { color: '#5c7a4a', weight: 1, fillColor: '#8fae74', fillOpacity: 0.25 },
  },
  {
    id: 'water',
    label: 'Water bodies',
    short: 'Water',
    geom: 'area',
    heavy: false,
    selectors: [
      'way["natural"="water"]',
      'relation["natural"="water"]',
      'way["landuse"~"^(reservoir|basin)$"]',
      'relation["landuse"~"^(reservoir|basin)$"]',
    ],
    // 21 149 lakes over Styria, 773 of them with a shore over 2 km. A pond that
    // plots as three pixels is not a lake anyone loses.
    coarse: {
      mid: [
        'way["natural"="water"](if:length()>1000)',
        'relation["natural"="water"]',
        'way["landuse"~"^(reservoir|basin)$"](if:length()>1000)',
        'relation["landuse"~"^(reservoir|basin)$"]',
      ],
      broad: [
        'way["natural"="water"](if:length()>2000)',
        'relation["natural"="water"]',
        'way["landuse"~"^(reservoir|basin)$"](if:length()>2000)',
        'relation["landuse"~"^(reservoir|basin)$"]',
      ],
    },
    // The `|| 'lake'` this used to end with was unconditional, so every element
    // that reached this category — every road, every stream — came back a lake.
    // The default now applies only to something already tagged as water.
    bucketOf: (t) => {
      if (t.landuse === 'reservoir' || t.landuse === 'basin') return t.landuse
      if (t.natural !== 'water') return null
      return pick(t.water, WATER_VALUES) ?? 'lake'
    },
    labels: { lake: 'Lake', pond: 'Pond', river: 'River area', reservoir: 'Reservoir', basin: 'Basin' },
    style: { color: '#1a5f9e', weight: 1, fillColor: '#4a9fd8', fillOpacity: 0.5, fill: true },
  },
  {
    id: 'waterways',
    label: 'Waterways',
    short: 'Water',
    geom: 'line',
    heavy: false,
    selectors: ['way["waterway"~"^(river|stream|canal|ditch|drain)$"]'],
    // Ditches and drains are field drainage: thousands of them, none of them a
    // feature of the landscape at 1:250 000.
    coarse: {
      mid:   ['way["waterway"~"^(river|stream|canal)$"]'],
      broad: ['way["waterway"~"^(river|canal)$"]'],
    },
    bucketOf: (t) => pick(t.waterway, WATERWAY_VALUES),
    labels: { river: 'River', stream: 'Stream', canal: 'Canal', ditch: 'Ditch', drain: 'Drain' },
    styles: {
      river:  { color: '#1a5f9e', weight: 2.5 },
      stream: { color: '#3a86c8', weight: 1.5 },
    },
    style: { color: '#5a9fd0', weight: 1 },
  },
  {
    id: 'roads',
    label: 'Roads & paths',
    short: 'Roads',
    geom: 'line',
    heavy: false,
    selectors: [
      'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|' +
      'service|track|path|footway|cycleway|bridleway|steps|living_street|' +
      'motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]',
    ],
    // 97 092 road ways in 1 250 km² around Graz; 6 152 of them motorway…tertiary.
    // The link classes stay with their parents at every tier — a ramp with no
    // motorway to belong to is a stub hanging in a field.
    coarse: {
      mid: [
        'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|' +
        'motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]',
      ],
      broad: [
        'way["highway"~"^(motorway|trunk|primary|secondary|' +
        'motorway_link|trunk_link|primary_link|secondary_link)$"]',
      ],
    },
    // Link roads are ramps of their parent class, not a class of their own; a
    // panel row called "Roads · Secondary link" is noise.
    bucketOf: (t) => pick((t.highway || '').replace(/_link$/, ''), HIGHWAY_VALUES),
    labels: {
      motorway: 'Motorway', trunk: 'Trunk', primary: 'Primary', secondary: 'Secondary',
      tertiary: 'Tertiary', unclassified: 'Minor', residential: 'Residential',
      living_street: 'Living street', service: 'Service', track: 'Track', path: 'Path',
      footway: 'Footway', cycleway: 'Cycleway', bridleway: 'Bridleway', steps: 'Steps',
    },
    styles: {
      motorway:  { color: '#b03030', weight: 3 },
      trunk:     { color: '#c0522d', weight: 2.5 },
      primary:   { color: '#c07a2d', weight: 2.5 },
      secondary: { color: '#a08a2d', weight: 2 },
      tertiary:  { color: '#7a7a3a', weight: 1.5 },
      track:     { color: '#8a6a3a', weight: 1, dash: 'dashed' },
      path:      { color: '#6a5a4a', weight: 1, dash: 'dotted' },
      footway:   { color: '#6a5a4a', weight: 1, dash: 'dotted' },
      cycleway:  { color: '#4a5a7a', weight: 1, dash: 'dotted' },
      steps:     { color: '#6a5a4a', weight: 1.5, dash: 'dashed' },
    },
    style: { color: '#4a4a4a', weight: 1 },
  },
  {
    id: 'rail',
    label: 'Railways',
    short: 'Rail',
    geom: 'line',
    heavy: false,
    selectors: ['way["railway"~"^(rail|narrow_gauge|light_rail|tram|subway|funicular|monorail)$"]'],
    // Trams and subways are a city's internals: at province scale they draw as a
    // blot over one town and nothing anywhere else.
    coarse: { broad: ['way["railway"~"^(rail|narrow_gauge)$"]'] },
    bucketOf: (t) => pick(t.railway, RAILWAY_VALUES),
    labels: {
      rail: 'Rail', narrow_gauge: 'Narrow gauge', light_rail: 'Light rail',
      tram: 'Tram', subway: 'Subway', funicular: 'Funicular', monorail: 'Monorail',
    },
    style: { color: '#3a3a3a', weight: 1.5, dash: 'dashed' },
  },
  {
    id: 'aerialway',
    label: 'Aerialways & pistes',
    short: 'Aerial',
    geom: 'line',
    heavy: false,
    selectors: ['way["aerialway"]', 'way["piste:type"]'],
    // Pistes are the dense half — every marked run in every ski area. The lifts
    // themselves are few enough to keep until the very coarsest tier, where only
    // the big cable cars and gondolas survive.
    coarse: {
      mid:   ['way["aerialway"]', 'way["piste:type"](if:length()>1000)'],
      broad: ['way["aerialway"~"^(cable_car|gondola|chair_lift)$"]'],
    },
    bucketOf: (t) => t.aerialway ?? (t['piste:type'] ? 'piste' : null),
    // Hyphens, not underscores: OSM spells these `t-bar`, `j-bar`, `magic_carpet`.
    labels: {
      cable_car: 'Cable car', gondola: 'Gondola', chair_lift: 'Chairlift',
      drag_lift: 'Drag lift', 't-bar': 'T-bar', 'j-bar': 'J-bar', platter: 'Platter',
      rope_tow: 'Rope tow', magic_carpet: 'Magic carpet', 'mixed_lift': 'Mixed lift',
      zip_line: 'Zip line', goods: 'Goods lift', piste: 'Piste',
    },
    style: { color: '#7a3a7a', weight: 1.5, dash: 'dashed' },
  },
  {
    id: 'buildings',
    label: 'Buildings',
    short: 'Buildings',
    geom: 'area',
    // The one category that can turn a query into tens of megabytes, so it is
    // flagged and off by default rather than quietly included.
    heavy: true,
    selectors: ['way["building"]', 'relation["building"]'],
    // Ticked deliberately, so it is not silently dropped at size — but a
    // province of house footprints is millions of elements, and what survives by
    // perimeter is the halls, churches and blocks that are landmarks anyway.
    coarse: {
      mid:   ['way["building"](if:length()>200)', 'relation["building"]'],
      broad: ['way["building"](if:length()>500)', 'relation["building"]'],
    },
    bucketOf: (t) => (t.building ? 'building' : null),
    labels: { building: 'Buildings' },
    style: { color: '#5a4a3a', weight: 0.5, fillColor: '#a89880', fillOpacity: 0.6 },
  },
  {
    id: 'peaks',
    label: 'Peaks & summits',
    short: '',
    geom: 'point',
    heavy: false,
    selectors: [
      'node["natural"~"^(peak|saddle|volcano)$"]',
      'node["mountain_pass"="yes"]',
      'node["tourism"="alpine_hut"]',
    ],
    bucketOf: (t) => pick(t.natural, PEAK_VALUES) ??
                     (t.mountain_pass === 'yes' ? 'pass' : null) ??
                     (t.tourism === 'alpine_hut' ? 'hut' : null),
    labels: { peak: 'Peaks', saddle: 'Saddles', volcano: 'Volcanoes', pass: 'Passes', hut: 'Alpine huts' },
    // `suggestedIcon` is not applied — it only sorts to the front of the icon
    // picker, so a peak layer is one click from looking like a peak while a
    // point layer still arrives as the dot every preset and test expects.
    //
    // A triangle for a summit is the surveyor's own convention, not a
    // second-best: it is what a trig point is drawn as on every topographic
    // sheet, and it is the cleanest mark in the bundled set.
    styles: {
      peak:    { color: '#7a2020', weight: 5, suggestedIcon: 'triangle' },
      volcano: { color: '#7a2020', weight: 5, suggestedIcon: 'volcano' },
      saddle:  { suggestedIcon: 'mountain' },
      pass:    { suggestedIcon: 'arrow' },
      hut:     { color: '#7a4a10', weight: 4, suggestedIcon: 'shelter' },
    },
    style: { color: '#3a3a3a', weight: 4 },
  },
  {
    id: 'boundaries',
    label: 'Admin boundaries',
    short: 'Boundary',
    geom: 'line',
    heavy: false,
    selectors: ['relation["boundary"="administrative"]["admin_level"~"^(2|4|6|8)$"]'],
    bucketOf: (t) => (t.boundary === 'administrative' && ADMIN_LEVELS.has(t.admin_level)
      ? `level${t.admin_level}` : null),
    labels: { level2: 'Country', level4: 'State', level6: 'District', level8: 'Municipality' },
    style: { color: '#8a3a8a', weight: 1.5, dash: 'long-dash' },
  },
]

/** Ticked by default: everything cheap and legible on a mountain raster. */
export const DEFAULT_OSM_CATEGORIES = OSM_CATEGORIES
  .filter((c) => !c.heavy && c.id !== 'boundaries')
  .map((c) => c.id)

export const osmCategory = (id) => OSM_CATEGORIES.find((c) => c.id === id) ?? null

/**
 * The layer name for one bucket.
 *
 * Prefixed with the category so a list of twenty rows sorts and scans by what
 * kind of thing each is — "Roads · Motorway", "Water · Stream". Categories whose
 * single bucket already says it ("Buildings") and those with no useful prefix
 * ("Peaks", "Alpine huts") skip it rather than stuttering.
 */
export function bucketLabel(category, value) {
  // A value with no entry in the table still has to read as a label rather than
  // as a raw tag — OSM adds values faster than any catalogue tracks them.
  const fallback = value.replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase())
  const leaf = category.labels?.[value] ?? fallback
  if (!category.short || leaf === category.short) return leaf
  return `${category.short} · ${leaf}`
}

/** Default style for one bucket — the category's, overridden per tag value. */
export function bucketStyle(category, value) {
  return { ...category.style, ...(category.styles?.[value] ?? {}) }
}
