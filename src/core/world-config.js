import { spawnProfileAt } from './progression.js';
const freezeArea = (area) => Object.freeze({
  ...area,
  shape: Object.freeze({ ...area.shape })
});

function organicBoundary(shape, normalX, normalY) {
  const x2 = normalX * normalX;
  const y2 = normalY * normalY;
  const harmonic2 = x2 - y2;
  const harmonic3 = normalX * (x2 - 3 * y2);
  const x4 = x2 * x2;
  const y4 = y2 * y2;
  const harmonic5 = normalY * (5 * x4 - 10 * x2 * y2 + y4);
  const biteFacing = Math.max(0, normalX * shape.notchX + normalY * shape.notchY);
  const biteSquared = biteFacing * biteFacing;
  const bite = biteSquared * biteSquared;
  return Math.max(0.58, 1
    + shape.amplitude2 * harmonic2
    + shape.amplitude3 * harmonic3
    + shape.amplitude5 * harmonic5
    - shape.notchDepth * bite);
}

export function defenseAreaField(area, x, y, clearance = 0) {
  const shape = area.shape;
  const deltaX = x - shape.x;
  const deltaY = y - shape.y;
  const localX = deltaX * shape.cosRotation + deltaY * shape.sinRotation;
  const localY = -deltaX * shape.sinRotation + deltaY * shape.cosRotation;
  const normalizedX = localX / Math.max(1, shape.radiusX + clearance);
  const normalizedY = localY / Math.max(1, shape.radiusY + clearance);
  const radius = Math.hypot(normalizedX, normalizedY);
  if (radius <= 0.000001) return -1;
  const boundary = organicBoundary(shape, normalizedX / radius, normalizedY / radius);
  return radius / boundary - 1;
}

export function defenseAreaBounds(area, padding = 0, scale = 1) {
  const shape = area.shape;
  const maximumBoundary = 1
    + Math.abs(shape.amplitude2)
    + Math.abs(shape.amplitude3)
    + Math.abs(shape.amplitude5);
  const radiusX = shape.radiusX * scale + padding;
  const radiusY = shape.radiusY * scale + padding;
  const extentX = maximumBoundary * Math.hypot(
    radiusX * shape.cosRotation,
    radiusY * shape.sinRotation
  );
  const extentY = maximumBoundary * Math.hypot(
    radiusX * shape.sinRotation,
    radiusY * shape.cosRotation
  );
  return {
    left: shape.x - extentX,
    top: shape.y - extentY,
    right: shape.x + extentX,
    bottom: shape.y + extentY
  };
}

const freezeSpawn = (source) => Object.freeze({
  spreadX: 12,
  spreadY: 8,
  unlockSeconds: 0,
  weight: 1,
  ...source
});

function freezeMap(map) {
  // Southern-wall maps push perimeter rifts away from the bottom wall and out past the
  // camera-safe bounds. Arena maps author their rifts directly on every edge instead.
  const relocate = map.playable && !map.arena && !map.flow;
  return Object.freeze({
    ...map,
    menuLines: Object.freeze([...(map.menuLines || [])]),
    bounds: Object.freeze({ ...map.bounds }),
    camera: Object.freeze({ ...map.camera }),
    cameraBounds: Object.freeze({ ...(map.cameraBounds || map.bounds) }),
    base: Object.freeze({ ...map.base }),
    spawnCurve: Object.freeze({ ...map.spawnCurve }),
    defenseAreas: Object.freeze(map.defenseAreas.map(freezeArea)),
    spawnSources: Object.freeze(map.spawnSources.map((source) => freezeSpawn(
      relocate && source.y + (source.spreadY || 8) > map.bounds.bottom - 12
        ? { ...source, x: source.x < 0 ? -1690 : 1690, y: 720,
          spreadX: 34, spreadY: 140 }
        : source
    )).map((source) => freezeSpawn(relocate ? { ...source,
      x: Math.abs(source.x) >= 1500 ? source.x + Math.sign(source.x) * 1600 : source.x,
      y: source.y < -1000 ? source.y - 1600 : source.y
    } : source)))
  });
}

// three silhouette families: torn islands, angled wisps, and bitten hubs.
// every area is one star-shaped harmonic field, never a pile of circles.
const NEBULA_PROFILES = Object.freeze([
  Object.freeze({ family: 0, scaleX: 1.16, scaleY: 1.02, rotation: -0.12, amplitude2: 0.025, amplitude3: 0.095, amplitude5: 0.038, notchDepth: 0.025 }),
  Object.freeze({ family: 1, scaleX: 1.36, scaleY: 0.78, rotation: 0.54, amplitude2: -0.035, amplitude3: 0.052, amplitude5: 0.044, notchDepth: 0.055 }),
  Object.freeze({ family: 2, scaleX: 1.08, scaleY: 1.02, rotation: -0.42, amplitude2: 0.048, amplitude3: -0.078, amplitude5: 0.032, notchDepth: 0.17 }),
  Object.freeze({ family: 1, scaleX: 1.3, scaleY: 0.82, rotation: -0.58, amplitude2: 0.032, amplitude3: -0.058, amplitude5: 0.042, notchDepth: 0.05 }),
  Object.freeze({ family: 2, scaleX: 1.1, scaleY: 0.98, rotation: 0.25, amplitude2: -0.052, amplitude3: 0.072, amplitude5: -0.034, notchDepth: 0.135 })
]);

function hashLabel(label) {
  let hash = 2166136261;
  for (let index = 0; index < label.length; index += 1) {
    hash ^= label.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function nebulaArea(id, x, y, radiusX, radiusY, profileIndex = 0) {
  const profile = NEBULA_PROFILES[((profileIndex % NEBULA_PROFILES.length) + NEBULA_PROFILES.length) % NEBULA_PROFILES.length];
  const seed = hashLabel(id);
  const rotationJitter = ((seed & 1023) / 1023 - 0.5) * 0.58;
  const sizeJitterX = 0.95 + ((seed >>> 10) & 31) / 310;
  const sizeJitterY = 0.95 + ((seed >>> 15) & 31) / 310;
  const amplitudeJitter = 0.9 + ((seed >>> 20) & 15) / 75;
  const rotation = profile.rotation + rotationJitter;
  const notchAngle = ((seed >>> 8) & 4095) / 4095 * Math.PI * 2;
  return {
    id,
    shape: {
      x,
      y,
      radiusX: Math.max(24, Math.round(radiusX * profile.scaleX * sizeJitterX)),
      radiusY: Math.max(18, Math.round(radiusY * profile.scaleY * sizeJitterY)),
      cosRotation: Math.cos(rotation),
      sinRotation: Math.sin(rotation),
      amplitude2: profile.amplitude2 * ((seed & 0x10000000) ? -1 : 1) * amplitudeJitter,
      amplitude3: profile.amplitude3 * ((seed & 0x20000000) ? -1 : 1) * amplitudeJitter,
      amplitude5: profile.amplitude5 * ((seed & 0x40000000) ? -1 : 1) * amplitudeJitter,
      notchDepth: profile.notchDepth * (0.86 + ((seed >>> 24) & 15) / 52),
      notchX: Math.cos(notchAngle),
      notchY: Math.sin(notchAngle),
      styleSeed: (seed & 65535) / 65535,
      family: profile.family
    }
  };
}

function areasFromSpecs(prefix, firstNumber, specs) {
  return specs.map(([x, y, radiusX, radiusY, profile], index) => (
    nebulaArea(`${prefix}${firstNumber + index}`, x, y, radiusX, radiusY, profile)
  ));
}

// the seven original hub ids and centers stay stable for existing map 01 runs.
const MAP_01_HUBS = [
  nebulaArea('area_1', -610, 250, 190, 124, 2),
  nebulaArea('area_2', 275, 205, 165, 135, 0),
  nebulaArea('area_3', 660, 435, 184, 142, 4),
  nebulaArea('area_4', -175, 615, 188, 138, 2),
  nebulaArea('area_5', -740, 685, 166, 134, 3),
  nebulaArea('area_6', 730, 25, 176, 124, 0),
  nebulaArea('area_7', -50, -40, 170, 120, 4)
];

const MAP_01_AREAS = [
  ...MAP_01_HUBS,
  ...areasFromSpecs('area_', 8, [
    [-1120,-820,65,42,0],[-930,-710,52,36,3],[-720,-860,66,40,1],[-520,-690,48,34,4],
    [-310,-850,62,42,2],[-90,-720,50,35,0],[130,-880,56,40,3],[350,-740,68,42,1],
    [570,-860,52,36,4],[790,-700,62,42,2],[1030,-830,70,44,0],[1160,-610,50,36,3],
    [-1190,-430,70,44,1],[-980,-520,52,36,4],[-760,-400,60,40,2],[-540,-500,48,34,0],
    [-330,-390,64,40,3],[-130,-510,48,34,1],[90,-390,58,38,4],[300,-500,50,34,2],
    [520,-390,66,42,0],[760,-500,46,34,3],[990,-380,64,40,1],[1190,-250,52,36,4],
    [-1170,-80,62,42,2],[-960,-180,48,34,0],[-820,20,52,36,3],[-440,-120,52,36,1],
    [-320,70,44,32,4],[330,-140,52,36,2],[430,-250,44,32,0],[1180,140,48,34,1],
    [-1160,260,58,40,4],[-980,400,48,34,2],[-1050,620,52,36,0],
    [-650,-160,46,32,3],[70,390,46,32,1],[1040,300,52,36,4],[1170,560,58,40,2],
    [1030,720,48,34,0]
  ])
];

const MAP_02_AREAS = areasFromSpecs('shard_', 1, [
  [-1220,-850,48,34,2],[-1030,-690,42,31,0],[-810,-900,55,36,4],[-610,-740,44,32,1],
  [-390,-920,50,34,3],[-170,-690,42,30,0],[70,-840,52,35,2],[300,-700,46,31,4],
  [520,-910,54,36,1],[740,-730,43,31,3],[980,-880,56,37,0],[1190,-690,45,32,2],
  [-1160,-470,54,36,4],[-910,-540,43,30,1],[-700,-360,50,34,3],[-480,-500,45,31,0],
  [-260,-330,55,36,2],[-30,-520,42,30,4],[210,-380,50,34,1],[440,-540,44,31,3],
  [680,-340,54,36,0],[900,-500,43,30,2],[1130,-320,52,35,4],[-1240,-90,46,32,1],
  [-1020,-210,55,36,3],[-820,30,42,30,0],[-590,-140,52,35,2],[-370,70,44,31,4],
  [-140,-110,54,36,1],[90,90,43,30,3],[330,-130,50,34,0],[560,50,45,32,2],
  [790,-110,55,36,4],[1030,90,42,30,1],[1240,-120,50,34,3],[-1180,320,44,31,0],
  [-960,190,54,36,2],[-740,400,43,30,4],[-500,250,52,35,1],[-270,430,45,31,3],
  [-40,240,55,36,0],[190,450,42,30,2],[430,270,50,34,4],[670,430,44,31,1],
  [900,240,54,36,3],[1140,420,43,30,0],[-1050,650,52,35,2],[-600,620,45,31,4],
  [280,650,54,36,1],[1040,670,44,31,3]
]);

const MAP_03_AREAS = areasFromSpecs('continent_', 1, [
  [-1160,-820,126,76,0],[-710,-700,138,82,3],[-250,-850,118,74,1],[220,-680,142,86,4],
  [690,-840,124,78,2],[1140,-700,136,82,0],[-1210,-430,132,82,3],[-760,-300,116,74,1],
  [-300,-510,144,86,4],[200,-280,122,78,2],[650,-520,138,84,0],[1100,-350,120,76,3],
  [-1160,-70,124,78,1],[-710,60,142,86,4],[-250,-100,118,74,2],[230,70,136,84,0],
  [690,-90,122,78,3],[1140,40,140,84,1],[-1150,300,136,82,4],[-690,420,116,74,2],
  [-250,270,142,86,0],[240,430,122,78,3],[700,290,138,84,1],[1160,410,118,76,4],
  [-1120,650,126,78,2],[-610,620,122,74,0],[-250,690,112,72,3],[280,690,140,84,1],
  [720,680,120,76,4],[1060,650,120,74,2]
]);

// map 07: the base sits at the exact centre. three concentric, deliberately gapped
// nebula rings (6 / 10 / 14) plus four corner bastions give radial defence lines in every
// direction instead of a southern wall; every gap is at least 60 units so the flow never
// pockets, and every neighbouring ring sits inside relay link range.
const MAP_07_AREAS = areasFromSpecs('crucible_', 1, [
  [181,-299,94,64,4],[332,22,91,68,4],[203,305,89,61,3],[-170,324,82,61,0],[-331,-21,92,61,3],[-157,-294,91,59,2],
  [103,-680,109,73,0],[469,-453,98,73,0],[647,-112,100,70,0],[581,336,102,76,0],[255,595,97,76,4],
  [-95,676,100,76,0],[-509,481,99,78,3],[-653,102,99,69,2],[-595,-326,107,70,3],[-320,-587,102,71,4],
  [23,-1049,108,83,3],[418,-930,115,74,0],[751,-616,114,82,2],[930,-276,113,81,0],[969,232,108,77,1],
  [795,579,108,74,2],[480,863,116,78,3],[1,1008,116,83,4],[-413,887,111,73,1],[-790,722,118,83,3],
  [-992,247,106,80,3],[-997,-290,108,76,2],[-796,-641,103,73,2],[-500,-915,114,83,1],
  [-1050,-1040,96,70,0],[1040,-1050,96,70,1],[1000,985,96,70,2],[-1040,1050,96,70,3]
]);

const TEST_FIELD_AREAS = [
  nebulaArea('test_area', 0, 270, 210, 140, 2),
  nebulaArea('test_link_area', 560, 270, 168, 116, 1)
];

const PERIMETER_SLOTS = Object.freeze({
  n_core: { x: -110, y: -1280, spreadX: 250, spreadY: 30 },
  n_warm: { x: -610, y: -1370, spreadX: 190, spreadY: 34 },
  n_east: { x: 520, y: -1250, spreadX: 210, spreadY: 40 },
  n_far_w: { x: -1120, y: -1210, spreadX: 180, spreadY: 48 },
  n_far_e: { x: 1190, y: -1360, spreadX: 165, spreadY: 32 },
  w_high: { x: -1690, y: -900, spreadX: 34, spreadY: 220 },
  e_high: { x: 1710, y: -760, spreadX: 38, spreadY: 210 },
  n_slot_w: { x: -340, y: -1450, spreadX: 145, spreadY: 22 },
  n_slot_e: { x: 850, y: -1190, spreadX: 150, spreadY: 42 },
  w_upper: { x: -1740, y: -430, spreadX: 30, spreadY: 230 },
  e_upper: { x: 1670, y: -350, spreadX: 40, spreadY: 245 },
  nw_corner: { x: -1500, y: -1160, spreadX: 110, spreadY: 90 },
  ne_corner: { x: 1510, y: -1090, spreadX: 100, spreadY: 95 },
  w_mid_a: { x: -1720, y: -60, spreadX: 32, spreadY: 180 },
  e_mid_a: { x: 1740, y: 80, spreadX: 30, spreadY: 190 },
  n_gap_w: { x: -850, y: -1290, spreadX: 125, spreadY: 35 },
  n_gap_e: { x: 210, y: -1420, spreadX: 130, spreadY: 26 },
  w_mid_b: { x: -1680, y: 310, spreadX: 42, spreadY: 190 },
  e_mid_b: { x: 1690, y: 420, spreadX: 34, spreadY: 175 },
  w_low: { x: -1610, y: 680, spreadX: 55, spreadY: 160 },
  e_low: { x: 1640, y: 720, spreadX: 48, spreadY: 150 },
  sw_outer: { x: -1440, y: 1020, spreadX: 145, spreadY: 38 },
  se_outer: { x: 1480, y: 990, spreadX: 130, spreadY: 42 },
  sw_mid: { x: -1110, y: 1080, spreadX: 170, spreadY: 30 },
  se_mid: { x: 1160, y: 1090, spreadX: 165, spreadY: 28 },
  n_extreme_w: { x: -1410, y: -1320, spreadX: 115, spreadY: 38 },
  n_extreme_e: { x: 1430, y: -1260, spreadX: 110, spreadY: 44 },
  w_gap: { x: -1770, y: -650, spreadX: 26, spreadY: 145 },
  e_gap: { x: 1760, y: -590, spreadX: 28, spreadY: 150 },
  sw_inner: { x: -760, y: 1110, spreadX: 155, spreadY: 22 },
  se_inner: { x: 790, y: 1100, spreadX: 150, spreadY: 24 },
  s_last: { x: 520, y: 1130, spreadX: 100, spreadY: 18 }
});

function perimeterSpawns(prefix, order) {
  return order.map((slotId, index) => ({
    id: `${prefix}_${slotId}`,
    ...PERIMETER_SLOTS[slotId],
    unlockSeconds: index * 60
  }));
}

const MAP_01_SPAWN_ORDER = [
  'n_core','n_warm','n_east','n_far_w','n_far_e','w_high','e_high','n_slot_w',
  'n_slot_e','w_upper','e_upper','nw_corner','ne_corner','w_mid_a','e_mid_a','n_gap_w',
  'n_gap_e','w_mid_b','e_mid_b','w_low','e_low','sw_outer','se_outer','sw_mid',
  'se_mid','n_extreme_w','n_extreme_e','w_gap','e_gap','sw_inner','se_inner','s_last'
];

const MAP_02_SPAWN_ORDER = [
  'n_warm','n_east','n_far_w','n_core','n_far_e','e_high','w_high','n_slot_e',
  'w_upper','ne_corner','e_upper','nw_corner','n_gap_w','w_mid_a','n_gap_e','e_mid_a',
  'w_mid_b','e_mid_b','w_low','e_low','n_extreme_w','se_outer','n_extreme_e','sw_outer',
  'e_gap','sw_mid','w_gap','se_mid','sw_inner','n_slot_w','se_inner','s_last'
];

const MAP_03_SPAWN_ORDER = [
  'n_east','n_core','n_far_e','n_warm','n_far_w','w_high','n_slot_w','e_high',
  'nw_corner','n_slot_e','ne_corner','w_upper','n_gap_e','e_upper','n_gap_w','w_mid_a',
  'e_mid_a','w_mid_b','e_mid_b','w_low','sw_outer','e_low','se_outer','w_gap',
  'sw_mid','e_gap','se_mid','n_extreme_w','sw_inner','n_extreme_e','se_inner','s_last'
];

// thirty-two rift slots spaced evenly around the arena's outer frame, indexed clockwise
// from due north. slot 16 is due south.
const ARENA_RIFT_COUNT = 32;
function arenaRiftSlot(index, bounds) {
  const angle = index / ARENA_RIFT_COUNT * Math.PI * 2;
  const halfWidth = (bounds.right - bounds.left) * 0.5 - 110;
  const halfHeight = (bounds.bottom - bounds.top) * 0.5 - 110;
  const centerX = (bounds.left + bounds.right) * 0.5;
  const centerY = (bounds.top + bounds.bottom) * 0.5;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  // Project the direction onto the rectangular frame.
  const scale = Math.min(halfWidth / Math.max(0.0001, Math.abs(dx)), halfHeight / Math.max(0.0001, Math.abs(dy)));
  const x = Math.round(centerX + dx * scale);
  const y = Math.round(centerY + dy * scale);
  const onVertical = Math.abs(dx * scale) >= halfWidth - 0.5;
  const onHorizontal = Math.abs(dy * scale) >= halfHeight - 0.5;
  const corner = onVertical && onHorizontal;
  return {
    x, y,
    spreadX: corner ? 90 : onVertical ? 30 : 150,
    spreadY: corner ? 90 : onVertical ? 150 : 30
  };
}

// unlock order widens from the northern rift around both flanks until the two fronts
// meet in the south: manageable at first, unavoidable 360-degree pressure by the end.
const MAP_07_RIFT_ORDER = [
  0, 1, -1, 2, -2, 4, -3, 3, -4, 5, -5, 7, -6, 6, -7, 8,
  -8, 9, -9, 11, -10, 10, -11, 12, -12, 13, -13, 15, -14, 14, -15, 16
].map((offset) => (offset + ARENA_RIFT_COUNT) % ARENA_RIFT_COUNT);

function arenaSpawns(prefix, bounds, order, secondsPerRift) {
  return order.map((slot, index) => ({
    id: `${prefix}_rift_${String(slot).padStart(2, '0')}`,
    ...arenaRiftSlot(slot, bounds),
    unlockSeconds: index * secondsPerRift
  }));
}

const MAP_07_BOUNDS = Object.freeze({ left: -2000, right: 2000, top: -2000, bottom: 2000 });

const COMMON_MAP = Object.freeze({
  bounds: { left: -3600, right: 3600, top: -3300, bottom: 900 },
  cameraBounds: { left: -1340, right: 1340, top: -1050, bottom: 900 },
  spawnCurve: {
    basePerSecond: 2,
    linearPerMinute: 0.8,
    growthPerMinute: 1.22,
    // the growth exponent eases after twenty minutes; see progression.js
    taper: true
  }
});

export const MAP_DEFINITIONS = Object.freeze({
  map_01: freezeMap({
    ...COMMON_MAP,
    id: 'map_01',
    label: 'map 01 // clusters',
    menuLines: ['47 mixed areas', 'braided swarm flow'],
    playable: true,
    camera: { x: 0, y: 300, scale: 4 },
    base: { id: 'base_1', x: 0, y: 760, reachRadius: 30 },
    defenseAreas: MAP_01_AREAS,
    spawnSources: perimeterSpawns('cluster', MAP_01_SPAWN_ORDER)
  }),
  map_02: freezeMap({
    ...COMMON_MAP,
    id: 'map_02',
    label: 'map 02 // shards',
    menuLines: ['50 small islands', 'wide scattered flow'],
    playable: true,
    camera: { x: 40, y: 290, scale: 4 },
    base: { id: 'base_2', x: 100, y: 770, reachRadius: 30 },
    defenseAreas: MAP_02_AREAS,
    spawnSources: perimeterSpawns('shard', MAP_02_SPAWN_ORDER)
  }),
  map_03: freezeMap({
    ...COMMON_MAP,
    id: 'map_03',
    label: 'map 03 // continents',
    menuLines: ['30 large areas', 'broad heavy channels'],
    playable: true,
    camera: { x: -40, y: 300, scale: 4 },
    base: { id: 'base_3', x: -80, y: 770, reachRadius: 30 },
    defenseAreas: MAP_03_AREAS,
    spawnSources: perimeterSpawns('continent', MAP_03_SPAWN_ORDER)
  }),
  // A long east-to-west run: the reactor sits at the western end, rifts open at the far
  // eastern end, and solid walls close the north and south. Two nebula rows line the
  // walls with a centre-line chain so every field stays relay-linkable.
  map_04: freezeMap({
    ...COMMON_MAP, id: 'map_04', label: 'map 04 // corridor',
    menuLines: ['4000-unit walled corridor', 'base west // rifts east'], playable: true,
    walls: ['top', 'bottom'], flow: 'west',
    bounds: { left: -1300, right: 2700, top: -380, bottom: 380 },
    cameraBounds: { left: -1440, right: 2840, top: -520, bottom: 520 },
    camera: { x: -600, y: 0, scale: 4 },
    base: { id: 'base_4', x: -1200, y: 0, reachRadius: 30 },
    defenseAreas: [
      ...areasFromSpecs('corridor_', 1, [-1000,-660,-320,20,360,700,1040,1380,1720,2060,2400].flatMap((x, i) => [-245,245].map((y, j) => [x,y,70,60,(i + j) % 5]))),
      ...areasFromSpecs('corridor_', 23, [-830,-150,530,1210,1890].map((x, i) => [x,0,70,60,(i * 2 + 1) % 5]))
    ],
    spawnSources: [-240,0,240].map((y,i) => ({id:`corridor_rift_${i}`,x:2600,y,spreadX:12,spreadY:30,unlockSeconds:i*120}))
  }),
  map_05: freezeMap({
    ...COMMON_MAP, id: 'map_05', label: 'map 05 // shuffled rifts',
    menuLines: ['seeded rift positions', 'new approaches every run'], playable: true,
    randomRifts: true, camera: { x: 0, y: 300, scale: 4 },
    base: { id: 'base_5', x: 0, y: 760, reachRadius: 30 },
    defenseAreas: MAP_01_AREAS,
    spawnSources: perimeterSpawns('shuffle', MAP_01_SPAWN_ORDER)
  }),
  map_06: freezeMap({
    ...COMMON_MAP,
    id: 'map_06',
    label: 'map 06 // walled clusters',
    menuLines: ['47 mixed areas + side walls', 'northern rifts only'],
    playable: true,
    sideWalls: true,
    bounds: { left: -1420, right: 1420, top: -3300, bottom: 900 },
    cameraBounds: { left: -1560, right: 1560, top: -1050, bottom: 900 },
    camera: { x: 0, y: 300, scale: 4 },
    base: { id: 'base_6', x: 0, y: 760, reachRadius: 30 },
    defenseAreas: MAP_01_AREAS,
    spawnSources: perimeterSpawns('walled', MAP_01_SPAWN_ORDER)
      .filter((source) => source.id.startsWith('walled_n_')
        && Math.abs(source.x) + source.spreadX < 1420)
  }),
  map_07: freezeMap({
    ...COMMON_MAP,
    id: 'map_07',
    label: 'map 07 // crucible',
    menuLines: ['central base / 34 ring areas', 'rifts open on every side'],
    playable: true,
    arena: true,
    bounds: MAP_07_BOUNDS,
    cameraBounds: { left: -1450, right: 1450, top: -1450, bottom: 1450 },
    camera: { x: 0, y: 0, scale: 4 },
    base: { id: 'base_7', x: 0, y: 0, reachRadius: 30 },
    defenseAreas: MAP_07_AREAS,
    spawnSources: arenaSpawns('crucible', MAP_07_BOUNDS, MAP_07_RIFT_ORDER, 50)
  }),
  test_field: freezeMap({
    id: 'test_field',
    label: 'test field',
    playable: false,
    bounds: { left: -960, right: 960, top: -520, bottom: 840 },
    camera: { x: 0, y: 210, scale: 3 },
    cameraBounds: { left: -960, right: 960, top: -520, bottom: 840 },
    base: { id: 'test_base', x: 0, y: 710, reachRadius: 30 },
    defenseAreas: TEST_FIELD_AREAS,
    spawnSources: [
      { id: 'test_top', x: 0, y: -440, unlockSeconds: 0 },
      { id: 'test_left', x: -880, y: 40, spreadX: 6, spreadY: 20, unlockSeconds: 0 },
      { id: 'test_right', x: 880, y: 40, spreadX: 6, spreadY: 20, unlockSeconds: 0 },
      { id: 'test_split_left', x: -440, y: -440, unlockSeconds: 0 },
      { id: 'test_split_right', x: 440, y: -440, unlockSeconds: 0 }
    ],
    spawnCurve: {
      basePerSecond: 0,
      linearPerMinute: 0,
      growthPerMinute: 1
    }
  })
});

export const DEFAULT_MAP_ID = 'map_01';

// Randomised rifts: a per-run option (or a map default) that seeds every rift position
// along the map's open edges and shuffles the unlock order, so entries and their timing
// stay unpredictable. The base wall side never spawns. Deterministic per seed, so every
// peer and every correction derives the same layout.
export function riftsRandomized(map, options = {}) {
  return Boolean(map.randomRifts || options.randomRifts);
}

export function getMapDefinition(mapId = DEFAULT_MAP_ID, seed = 0, options = {}) {
  const map = MAP_DEFINITIONS[mapId];
  if (!map) throw new Error(`unknown map: ${mapId}`);
  if (!riftsRandomized(map, options)) return map;
  let value = (seed ^ 0xa341316c) >>> 0;
  const random = () => { value = (Math.imul(value,1664525)+1013904223) >>> 0; return value/4294967296; };
  const { left, right, top, bottom } = map.bounds;
  const inset = 120;
  const wallSides = new Set(map.arena ? [] : map.walls || ['bottom']);
  // Open edges exclude walls; the base side is always closed for flow maps.
  const edges = ['left', 'right', 'top', 'bottom'].filter((edge) => !wallSides.has(edge)
    && !(map.flow === 'west' && edge === 'left') && !(map.flow === 'east' && edge === 'right')
    && !(!map.arena && !map.flow && edge === 'bottom'));
  const along = (low, high, margin) => low + margin + random() * Math.max(0, high - low - margin * 2);
  const sources = map.spawnSources.map((source) => {
    const edge = edges[Math.floor(random() * edges.length)] || 'top';
    const x = edge === 'left' ? left + inset : edge === 'right' ? right - inset : along(left, right, inset);
    const y = edge === 'top' ? top + inset : edge === 'bottom' ? bottom - inset : along(top, bottom, inset + (edge !== 'top' && wallSides.has('bottom') ? 240 : 0));
    return {...source,x,y,spreadX:24,spreadY:24};
  });
  const unlocks = sources.map((source) => source.unlockSeconds);
  for (let index = unlocks.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [unlocks[index], unlocks[swap]] = [unlocks[swap], unlocks[index]];
  }
  const shuffled = sources.map((source, index) => Object.freeze({ ...source, unlockSeconds: unlocks[index] }));
  return Object.freeze({...map,layoutSeed:seed>>>0,randomizedRifts:true,spawnSources:Object.freeze(shuffled)});
}

// Relay eligibility is a static property of the map: two areas are linkable when a
// relay standing somewhere inside one can reach the other's field within link range.
// The largest linkable component is the set a complete relay network must cover; every
// production map is fully linkable, so completion means "every nebula joined". The
// sample lattice is deterministic, so every peer derives the same set.
const relayEligibleCache = new Map();
export function relayEligibleAreaIds(map, linkRange = 360) {
  const cacheKey = `${map.id}:${linkRange}`;
  if (relayEligibleCache.has(cacheKey)) return relayEligibleCache.get(cacheKey);
  const areas = map.defenseAreas;
  const interior = areas.map((area) => {
    const points = [];
    for (let ring = 0; ring <= 6; ring += 1) {
      for (let step = 0; step < 24; step += 1) {
        const angle = step / 24 * Math.PI * 2;
        const fraction = ring * 0.15;
        const x = area.shape.x + Math.cos(angle) * area.shape.radiusX * fraction;
        const y = area.shape.y + Math.sin(angle) * area.shape.radiusY * fraction;
        if (defenseAreaField(area, x, y) <= 0) points.push(x, y);
      }
    }
    return points;
  });
  const linkable = (from, to) => {
    const points = interior[from];
    for (let index = 0; index < points.length; index += 2) {
      if (defenseAreaField(areas[to], points[index], points[index + 1], linkRange) <= 0) return true;
    }
    return false;
  };
  const componentOf = new Map();
  let best = [];
  for (let start = 0; start < areas.length; start += 1) {
    if (componentOf.has(start)) continue;
    const seen = new Set([start]);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      for (let other = 0; other < areas.length; other += 1) {
        if (seen.has(other) || !(linkable(current, other) || linkable(other, current))) continue;
        seen.add(other);
        queue.push(other);
      }
    }
    for (const index of seen) componentOf.set(index, start);
    const ids = [...seen].map((index) => areas[index].id).sort();
    if (ids.length > best.length || (ids.length === best.length && ids[0] < best[0])) best = ids;
  }
  const result = Object.freeze(best);
  relayEligibleCache.set(cacheKey, result);
  return result;
}

export function playableMaps() {
  return Object.values(MAP_DEFINITIONS).filter((map) => map.playable);
}

export function findDefenseAreaAt(mapOrId, x, y) {
  const map = typeof mapOrId === 'string' ? getMapDefinition(mapOrId) : mapOrId;
  if (!map || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  for (const area of map.defenseAreas) {
    if (defenseAreaField(area, x, y) <= 0) return area.id;
  }
  return null;
}

export function isInsideDefenseArea(mapOrId, x, y) {
  return findDefenseAreaAt(mapOrId, x, y) !== null;
}

export function spawnRateAt(mapOrId, runTick, tickRate = 60) {
  const map = typeof mapOrId === 'string' ? getMapDefinition(mapOrId) : mapOrId;
  return spawnProfileAt(map, runTick, tickRate).rate;
}

export function activeSpawnSources(mapOrId, runTick, tickRate = 60) {
  const map = typeof mapOrId === 'string' ? getMapDefinition(mapOrId) : mapOrId;
  const seconds = Math.max(0, runTick) / tickRate;
  return map.spawnSources.filter((source) => source.unlockSeconds <= seconds);
}
