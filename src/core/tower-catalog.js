import { NETWORK_DESCENDANTS } from './network-descendants.js';
const TARGETING_MODES = Object.freeze(['closest', 'nearest_base', 'farthest_base', 'densest_group']);

const projectileAttack = ({
  cadencePerSecond = 6,
  volleyCount = 1,
  muzzleSpacing = 0,
  targetSpacing = 0,
  speed = 520,
  collisionRadius = 5,
  maxContacts = 1,
  parallelVolley = false,
  parallelLaunchSeconds = 0.14,
  manualStrikePoint = false,
  strikeSpacing = 0,
  geometry = { type: 'single', maxVictims: 1 },
  triggers = [],
  impactFollowUps = []
} = {}) => Object.freeze({
  cadencePerSecond,
  volley: Object.freeze({
    count: volleyCount,
    muzzleSpacing,
    targetSpacing,
    parallel: parallelVolley,
    parallelLaunchSeconds
  }),
  delivery: Object.freeze({
    type: 'projectile',
    speed,
    collisionRadius,
    maxContacts,
    homing: 'gentle',
    manualStrikePoint,
    strikeSpacing
  }),
  geometry: Object.freeze({ ...geometry }),
  effects: Object.freeze([
    Object.freeze({ type: 'damage', amount: 1 })
  ]),
  triggers: Object.freeze(triggers),
  impactFollowUps: Object.freeze(impactFollowUps)
});

const hitscanAttack = ({ cadencePerSecond, width, volleyCount = 1, maxVictims = 'unlimited' }) => Object.freeze({
  cadencePerSecond,
  volley: Object.freeze({ count: volleyCount, muzzleSpacing: 0 }),
  delivery: Object.freeze({ type: 'hitscan' }),
  geometry: Object.freeze({ type: 'line', width, maxVictims, packetMode: 'all' }),
  effects: Object.freeze([
    Object.freeze({ type: 'damage', amount: 1 })
  ]),
  triggers: Object.freeze([])
});

const sweepAttack = ({ cadencePerSecond, width, durationSeconds, sweepDegrees, pulseSeconds }) => Object.freeze({
  cadencePerSecond,
  volley: Object.freeze({ count: 1, muzzleSpacing: 0 }),
  delivery: Object.freeze({
    type: 'persistent',
    motion: 'sweep',
    durationSeconds,
    pulseSeconds,
    sweepRadians: sweepDegrees * Math.PI / 180
  }),
  geometry: Object.freeze({ type: 'line', width, maxVictims: 'unlimited', packetMode: 'all' }),
  effects: Object.freeze([
    Object.freeze({ type: 'damage', amount: 1 })
  ]),
  triggers: Object.freeze([])
});

const NETWORK_RANGE_MODIFIERS = Object.freeze([
  Object.freeze({
    id: 'network_range',
    scope: 'network_area',
    stat: 'range',
    operation: 'add_percent',
    value: 0.1,
    additionalValue: 0.01,
    stacking: 'diminishing_additive',
    stackGroup: 'network_range'
  })
]);

const OVERCLOCK_MODIFIERS = Object.freeze([
  Object.freeze({
    id: 'overclock_fire_rate',
    scope: 'network_area',
    stat: 'cadencePerSecond',
    operation: 'add_percent',
    value: 0.15,
    additionalValue: 0.01,
    stacking: 'diminishing_additive',
    stackGroup: 'overclock_fire_rate'
  })
]);

const BASE_TOWER_DEFINITIONS = Object.freeze({
  ...NETWORK_DESCENDANTS,
  frame: Object.freeze({
    id: 'frame',
    label: 'frame',
    role: 'baseline',
    description: Object.freeze(['single shot', '6 shots/sec']),
    placeable: true,
    cost: 100,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['assault', 'tether', 'network']),
    attack: projectileAttack()
  }),
  assault: Object.freeze({
    id: 'assault',
    label: 'assault',
    role: 'volume',
    description: Object.freeze(['2 side by side', '6 volleys/sec', 'max 12 kills/sec']),
    evolvesFrom: 'frame',
    evolutionCost: 200,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['barrage', 'rocket', 'laser']),
    attack: projectileAttack({ volleyCount: 2, muzzleSpacing: 12, parallelVolley: true })
  }),
  barrage: Object.freeze({
    id: 'barrage',
    label: 'barrage',
    role: 'volume',
    description: Object.freeze(['4 side by side', '6 volleys/sec', 'max 24 kills/sec']),
    evolvesFrom: 'assault',
    evolutionCost: 400,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['broadside', 'flechette', 'cyclone']),
    attack: projectileAttack({ volleyCount: 4, muzzleSpacing: 8, parallelVolley: true })
  }),
  broadside: Object.freeze({
    id: 'broadside',
    label: 'broadside',
    role: 'width',
    description: Object.freeze(['8 parallel projectiles', '5 volleys/sec', 'max 40 kills/sec']),
    evolvesFrom: 'barrage',
    evolutionCost: 800,
    range: 180,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze([]),
    attack: projectileAttack({ cadencePerSecond: 5, volleyCount: 8, muzzleSpacing: 7, parallelVolley: true })
  }),
  flechette: Object.freeze({
    id: 'flechette',
    label: 'flechette',
    role: 'depth',
    description: Object.freeze(['4 piercing projectiles', '3 contacts each', '4 volleys/sec']),
    evolvesFrom: 'barrage',
    evolutionCost: 800,
    range: 200,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze([]),
    attack: projectileAttack({ cadencePerSecond: 4, volleyCount: 4, muzzleSpacing: 9, speed: 620, collisionRadius: 4, maxContacts: 3, parallelVolley: true })
  }),
  cyclone: Object.freeze({
    id: 'cyclone',
    label: 'cyclone',
    role: 'consistency',
    description: Object.freeze(['2 adaptive projectiles', '18 volleys/sec', 'max 36 kills/sec']),
    evolvesFrom: 'barrage',
    evolutionCost: 800,
    range: 180,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze([]),
    attack: projectileAttack({ cadencePerSecond: 18, volleyCount: 2, muzzleSpacing: 10, speed: 660, collisionRadius: 4 })
  }),
  rocket: Object.freeze({
    id: 'rocket',
    label: 'rocket',
    role: 'circle',
    description: Object.freeze(['1 rocket / 4 sec', 'range 220', 'blast 64', '1 damage / victim']),
    evolvesFrom: 'assault',
    evolutionCost: 400,
    range: 220,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['warhead', 'cluster', 'salvo']),
    attack: projectileAttack({
      cadencePerSecond: 0.25,
      speed: 260,
      collisionRadius: 7,
      manualStrikePoint: true,
      geometry: { type: 'circle', radius: 64, maxVictims: 'unlimited', packetMode: 'all' }
    })
  }),
  warhead: Object.freeze({
    id: 'warhead',
    label: 'warhead',
    role: 'huge blast',
    description: Object.freeze(['1 rocket / 3.3 sec', 'range 250', 'blast radius 112']),
    evolvesFrom: 'rocket',
    evolutionCost: 800,
    range: 250,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze([]),
    attack: projectileAttack({
      cadencePerSecond: 0.3,
      speed: 230,
      collisionRadius: 9,
      manualStrikePoint: true,
      geometry: { type: 'circle', radius: 112, maxVictims: 'unlimited', packetMode: 'all' }
    })
  }),
  cluster: Object.freeze({
    id: 'cluster',
    label: 'cluster',
    role: 'scattered area',
    description: Object.freeze(['1 rocket / 2.5 sec', 'blast 48', '6 scattered mini-blasts']),
    evolvesFrom: 'rocket',
    evolutionCost: 800,
    range: 240,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze([]),
    attack: projectileAttack({
      cadencePerSecond: 0.4,
      speed: 250,
      collisionRadius: 7,
      manualStrikePoint: true,
      geometry: { type: 'circle', radius: 48, maxVictims: 'unlimited', packetMode: 'all' },
      impactFollowUps: [Object.freeze({
        type: 'cluster_circle',
        count: 6,
        delaySeconds: 0.18,
        ringRadius: 104,
        radialJitter: 24,
        angleJitter: 0.7,
        delayJitterSeconds: 0.08,
        radius: 32,
        maxVictims: 'unlimited',
        packetMode: 'all'
      })]
    })
  }),
  salvo: Object.freeze({
    id: 'salvo',
    label: 'salvo',
    role: 'multiple fronts',
    description: Object.freeze(['3 rockets / 3 sec', 'separate targets', 'blast radius 48']),
    evolvesFrom: 'rocket',
    evolutionCost: 800,
    range: 240,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze([]),
    attack: projectileAttack({
      cadencePerSecond: 1 / 3,
      volleyCount: 3,
      muzzleSpacing: 14,
      targetSpacing: 96,
      speed: 270,
      collisionRadius: 7,
      manualStrikePoint: true,
      strikeSpacing: 72,
      geometry: { type: 'circle', radius: 48, maxVictims: 'unlimited', packetMode: 'all' }
    })
  }),
  laser: Object.freeze({
    id: 'laser',
    label: 'laser',
    role: 'line',
    description: Object.freeze(['1 beam / 2.5 sec', 'range 300', 'line width 16', '1 damage / victim']),
    evolvesFrom: 'assault',
    evolutionCost: 400,
    range: 300,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['cutter', 'prism', 'sweeper']),
    attack: hitscanAttack({ cadencePerSecond: 0.4, width: 16 })
  }),
  cutter: Object.freeze({
    id: 'cutter',
    label: 'cutter',
    role: 'thick line',
    description: Object.freeze(['1 beam / 2 sec', 'range 360', 'line width 32']),
    evolvesFrom: 'laser',
    evolutionCost: 800,
    range: 360,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze([]),
    attack: hitscanAttack({ cadencePerSecond: 0.5, width: 32 })
  }),
  prism: Object.freeze({
    id: 'prism',
    label: 'prism',
    role: 'coverage',
    description: Object.freeze(['3 beams / 1.7 sec', 'independent targets', 'line width 10']),
    evolvesFrom: 'laser',
    evolutionCost: 800,
    range: 320,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze([]),
    attack: hitscanAttack({ cadencePerSecond: 0.6, width: 10, volleyCount: 3 })
  }),
  sweeper: Object.freeze({
    id: 'sweeper',
    label: 'sweeper',
    role: 'sustained clearing',
    description: Object.freeze(['100 degree sweep', 'lasts 0.6 sec', 'fires every 5 sec']),
    evolvesFrom: 'laser',
    evolutionCost: 800,
    range: 300,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze([]),
    attack: sweepAttack({ cadencePerSecond: 0.2, width: 12, durationSeconds: 0.6, sweepDegrees: 100, pulseSeconds: 0.05 })
  }),
  tether: Object.freeze({
    id: 'tether',
    label: 'tether',
    role: 'control',
    description: Object.freeze(['kill slows 3', 'slow 30%', 'lasts 0.8 sec']),
    evolvesFrom: 'frame',
    evolutionCost: 200,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['anchor', 'knot', 'backwash']),
    attack: projectileAttack({
      triggers: [Object.freeze({
        id: 'tether_slow_on_kill',
        event: 'kill',
        selector: Object.freeze({ type: 'nearest', count: 3, radius: 56 }),
        effects: Object.freeze([
          Object.freeze({
            type: 'status',
            status: 'slow',
            magnitude: 0.3,
            durationSeconds: 0.8,
            stacking: 'strongest_refresh',
            marker: 'cyan'
          })
        ])
      })]
    })
  }),
  anchor: Object.freeze({
    id: 'anchor',
    label: 'anchor',
    role: 'delay',
    description: Object.freeze(['kill slows 8', 'slow 45%', 'lasts 1.4 sec', 'radius 72']),
    evolvesFrom: 'tether',
    evolutionCost: 400,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['stasis', 'recall', 'dragnet']),
    attack: projectileAttack({
      triggers: [Object.freeze({
        id: 'anchor_slow_on_kill',
        event: 'kill',
        selector: Object.freeze({ type: 'nearest', count: 8, radius: 72 }),
        effects: Object.freeze([
          Object.freeze({
            type: 'status',
            status: 'slow',
            magnitude: 0.45,
            durationSeconds: 1.4,
            stacking: 'strongest_refresh',
            marker: 'cyan'
          })
        ])
      })]
    })
  }),
  stasis: Object.freeze({
    id: 'stasis',
    label: 'stasis',
    role: 'hard stop',
    description: Object.freeze(['freeze 0.6s', 'every 8s', 'field radius 72', 'no weapon']),
    evolvesFrom: 'anchor',
    evolutionCost: 800,
    range: 185,
    killReward: 1,
    evolutionChoices: Object.freeze([]),
    control: Object.freeze({
      type: 'stasis_zone',
      input: 'point',
      radius: 72,
      periodSeconds: 8,
      durationSeconds: 0.6,
      rebootSeconds: 1
    })
  }),
  recall: Object.freeze({
    id: 'recall',
    label: 'recall',
    role: 'rewind',
    description: Object.freeze(['cross to mark', 'rewind in 1.5s', 'once per enemy', 'all gates share']),
    evolvesFrom: 'anchor',
    evolutionCost: 800,
    range: 190,
    killReward: 1,
    evolutionChoices: Object.freeze([]),
    control: Object.freeze({
      type: 'recall_gate',
      input: 'line',
      maxLength: 130,
      thickness: 5,
      delaySeconds: 1.5,
      rebootSeconds: 1
    })
  }),
  dragnet: Object.freeze({
    id: 'dragnet',
    label: 'dragnet',
    role: 'persistent slow',
    description: Object.freeze(['permanent net', '25% slow', 'no stacking', 'field radius 86']),
    evolvesFrom: 'anchor',
    evolutionCost: 800,
    range: 180,
    killReward: 1,
    evolutionChoices: Object.freeze([]),
    control: Object.freeze({
      type: 'slow_zone',
      input: 'point',
      radius: 86,
      magnitude: 0.25,
      rebootSeconds: 1
    })
  }),
  knot: Object.freeze({
    id: 'knot',
    label: 'knot',
    role: 'compression',
    description: Object.freeze(['every 3rd kill', 'pull well radius 72', 'lasts 0.6 sec']),
    evolvesFrom: 'tether',
    evolutionCost: 400,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['singularity', 'bond', 'braid']),
    attack: projectileAttack({
      triggers: [Object.freeze({
        id: 'knot_well_on_kill',
        event: 'kill',
        everyNthKill: 3,
        selector: Object.freeze({ type: 'origin' }),
        effects: Object.freeze([
          Object.freeze({
            type: 'radial_force_field',
            radius: 72,
            strength: -180,
            durationSeconds: 0.6,
            fieldSlot: 'knot'
          })
        ])
      })]
    })
  }),
  singularity: Object.freeze({
    id: 'singularity',
    label: 'singularity',
    role: 'mass compression',
    description: Object.freeze(['gather / release', '0.45s every 6s', 'radius 108', 'no weapon']),
    evolvesFrom: 'knot',
    evolutionCost: 800,
    range: 195,
    killReward: 1,
    evolutionChoices: Object.freeze([]),
    control: Object.freeze({
      type: 'singularity',
      input: 'point',
      radius: 108,
      strength: -300,
      periodSeconds: 6,
      activeSeconds: 0.45,
      rebootSeconds: 1
    })
  }),
  bond: Object.freeze({
    id: 'bond',
    label: 'bond',
    role: 'paired kills',
    description: Object.freeze(['pairs last 2s', 'pulse every 6s', 'one kill = two', 'no chains / r120']),
    evolvesFrom: 'knot',
    evolutionCost: 800,
    range: 190,
    killReward: 1,
    evolutionChoices: Object.freeze([]),
    control: Object.freeze({
      type: 'bond_zone',
      input: 'none',
      radius: 120,
      periodSeconds: 6,
      durationSeconds: 2,
      rebootSeconds: 1
    })
  }),
  braid: Object.freeze({
    id: 'braid',
    label: 'braid',
    role: 'channeling',
    description: Object.freeze(['draw along flow', 'squeeze sideways', 'no forward slow', 'width 82']),
    evolvesFrom: 'knot',
    evolutionCost: 800,
    range: 200,
    killReward: 1,
    evolutionChoices: Object.freeze([]),
    control: Object.freeze({
      type: 'braid',
      input: 'line',
      maxLength: 180,
      width: 82,
      strength: 210,
      rebootSeconds: 1
    })
  }),
  backwash: Object.freeze({
    id: 'backwash',
    label: 'backwash',
    role: 'displacement',
    description: Object.freeze(['every 4th kill', 'upstream pulse 76', 'lasts 0.35 sec']),
    evolvesFrom: 'tether',
    evolutionCost: 400,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['breaker', 'crosswind', 'breakwater']),
    attack: projectileAttack({
      triggers: [Object.freeze({
        id: 'backwash_pulse_on_kill',
        event: 'kill',
        everyNthKill: 4,
        selector: Object.freeze({ type: 'origin' }),
        effects: Object.freeze([
          Object.freeze({
            type: 'directional_force_field',
            direction: 'away_from_base',
            radius: 76,
            strength: 320,
            durationSeconds: 0.35,
            fieldSlot: 'backwash'
          })
        ])
      })]
    })
  }),
  breaker: Object.freeze({
    id: 'breaker',
    label: 'breaker',
    role: 'shockwave',
    description: Object.freeze(['shove 26u', 'once every 8s', 'wave travel 220', 'no lasting push']),
    evolvesFrom: 'backwash',
    evolutionCost: 800,
    range: 205,
    killReward: 1,
    evolutionChoices: Object.freeze([]),
    control: Object.freeze({
      type: 'breaker_wave',
      input: 'none',
      range: 220,
      width: 180,
      waveThickness: 24,
      shoveDistance: 26,
      periodSeconds: 8,
      travelSeconds: 1.1,
      rebootSeconds: 1
    })
  }),
  crosswind: Object.freeze({
    id: 'crosswind',
    label: 'crosswind',
    role: 'steering',
    description: Object.freeze(['choose a side', 'sideways only', 'no forward slow', 'radius 132']),
    evolvesFrom: 'backwash',
    evolutionCost: 800,
    range: 195,
    killReward: 1,
    evolutionChoices: Object.freeze([]),
    control: Object.freeze({
      type: 'crosswind',
      input: 'direction',
      radius: 132,
      strength: 130,
      rebootSeconds: 1
    })
  }),
  breakwater: Object.freeze({
    id: 'breakwater',
    label: 'breakwater',
    role: 'swarm splitter',
    description: Object.freeze(['draw a splitter', 'nearest end wins', 'always passable', 'no upstream push']),
    evolvesFrom: 'backwash',
    evolutionCost: 800,
    range: 195,
    killReward: 1,
    evolutionChoices: Object.freeze([]),
    control: Object.freeze({
      type: 'splitter',
      input: 'line',
      maxLength: 188,
      thickness: 30,
      strength: 240,
      rebootSeconds: 1
    })
  }),
  network: Object.freeze({
    id: 'network',
    label: 'network',
    role: 'support',
    description: Object.freeze(['linked range +10%', 'extra networks +1%', 'range support only']),
    evolvesFrom: 'frame',
    evolutionCost: 200,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['overclock', 'forge', 'relay']),
    networkNode: true,
    attack: projectileAttack(),
    modifiers: NETWORK_RANGE_MODIFIERS
  }),
  overclock: Object.freeze({
    id: 'overclock',
    label: 'overclock',
    role: 'tempo',
    description: Object.freeze(['linked fire rate +15%', 'extra overclocks +1%', 'no range passive']),
    evolvesFrom: 'network',
    evolutionCost: 400,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['redline', 'metronome', 'aperture']),
    networkNode: true,
    attack: projectileAttack(),
    modifiers: OVERCLOCK_MODIFIERS
  }),
  forge: Object.freeze({
    id: 'forge',
    label: 'forge',
    role: 'economy',
    description: Object.freeze(['first: 1cr / 8 hp', 'extra forges: 1cr / 80', 'no range passive']),
    evolvesFrom: 'network',
    evolutionCost: 400,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['mint', 'reactor', 'arsenal']),
    networkNode: true,
    attack: projectileAttack(),
    supportEffects: Object.freeze([
      Object.freeze({
        id: 'forge_income',
        type: 'kill_income',
        scope: 'network_area',
        everyKills: 8,
        additionalEveryKills: 80,
        bonusCredits: 1,
        stacking: 'diminishing_sources',
        stackGroup: 'forge_income'
      })
    ])
  }),
  relay: Object.freeze({
    id: 'relay',
    label: 'relay',
    role: 'coverage',
    description: Object.freeze(['choose nearby nebula', 'link range 360', 'shares network effects', 'no passive bonus']),
    evolvesFrom: 'network',
    evolutionCost: 400,
    range: 170,
    killReward: 1,
    targetingModes: TARGETING_MODES,
    evolutionChoices: Object.freeze(['amplifier', 'echo', 'hardpoint']),
    networkNode: true,
    linkRange: 360,
    attack: projectileAttack(),
    supportEffects: Object.freeze([
      Object.freeze({
        id: 'relay_link',
        type: 'area_link',
        target: 'selected_area',
        stacking: 'unique_area',
        stackGroup: 'relay_link'
      })
    ])
  })
});

// Every support descendant is explicitly non-damaging, including copied controls.
export const CONTROL_FORMS = Object.freeze(['tether', 'anchor', 'stasis', 'recall', 'dragnet', 'knot', 'singularity', 'bond', 'braid', 'backwash', 'breaker', 'crosswind', 'breakwater']);
const reworkAttack = (mechanic, cadence, damage = 0) => ({
  ...projectileAttack({ cadencePerSecond: cadence,
    speed: ({ shotgun: 600, nail: 550, orbit: 180, freeze_shell: 210, gravity_seed: 220 })[mechanic] || 340,
    volleyCount: ({ shotgun: 17, orbit: 24 })[mechanic] || 1 }), mechanic,
  effects: damage ? [{ type: 'damage', amount: damage }] : [], triggers: [],
  supportOnly: !damage
});
const reworks = {
  broadside: { range: 145, description: ['tracking shotgun fan', 'heavy burst / 2.5s', 'automatic targeting'],
    attack: reworkAttack('shotgun', .4, 2) },
  flechette: { range: 240, description: ['heavy piercing dart', 'plants a delayed nail', 'bursts sideways'], attack: reworkAttack('nail', .5, 3) },
  cyclone: { range: 175, description: ['orbiting bullet ring', 'charges then expands', 'one storm / 4s'], attack: reworkAttack('orbit', .25, 2) },
  tether: { description: ['sticky projectiles', 'heavy single-target slow', 'prefers unglued enemies'], attack: reworkAttack('glue', 2) },
  anchor: { description: ['continuous freeze ray', 'build chill to freeze', 'switches frozen targets'], attack: reworkAttack('freeze_ray', 10) },
  stasis: { description: ['lobbed freeze shell', 'freezes a whole group', 'long reload'], attack: reworkAttack('freeze_shell', .2), control: null },
  dragnet: { description: ['place a frost patch', 'slows and builds chill', 'reposition to reboot'], control: { type: 'frost_zone', input: 'point', radius: 86, magnitude: .3, rebootSeconds: 1 } },
  knot: { description: ['paired magnetic harpoons', 'pull enemies together', 'no damage'], attack: reworkAttack('harpoon', .5) },
  singularity: { description: ['launch a gravity seed', 'gather then briefly hold', 'choose landing point'], attack: reworkAttack('gravity_seed', 1 / 6), control: { type: 'seed_aim', input: 'point', radius: 108, rebootSeconds: 1 } },
  bond: { description: ['chains a small group', 'shares weaker control', 'no damage / no chains'], attack: reworkAttack('chain', .25), control: null },
  backwash: { description: ['concussion projectiles', 'stun and shove backward', 'prioritizes escapees'], attack: reworkAttack('concussion', .8) },
  breaker: { description: ['place a solid barricade', 'blocks 2.5s / recharges', 'short wall with open ends'], control: { type: 'barricade', input: 'line', maxLength: 100, thickness: 9, periodSeconds: 8, durationSeconds: 2.5, rebootSeconds: 1 } },
  crosswind: { description: ['directional air cannon', 'broad sideways gusts', 'choose a side'], control: { type: 'crosswind', input: 'direction', radius: 132, strength: 650, periodSeconds: 3, activeSeconds: .45, rebootSeconds: 1 } },
  breakwater: { description: ['place a splitter fence', 'alternates left / right', 'passable stream divider'] }
};
export const TOWER_DEFINITIONS = Object.freeze(Object.fromEntries(Object.entries(BASE_TOWER_DEFINITIONS).map(([id, base]) => {
  const definition = { ...base, ...reworks[id] };
  if (CONTROL_FORMS.includes(id)) {
    definition.supportOnly = true;
    if (!reworks[id]?.attack) delete definition.attack;
    if (!definition.control) delete definition.control;
  }
  if (['network', 'overclock', 'forge', 'relay'].includes(id)) {
    delete definition.attack;
    definition.infrastructure = true;
    definition.supportOnly = true;
  }
  if (['laser','cutter','prism','sweeper'].includes(id)) definition.attack = { ...definition.attack, delivery: { ...definition.attack.delivery, manualStrikePoint: true } };
  return [id, Object.freeze(definition)];
})));

export function towerBuildQuote(catalog, definitionId) {
  const definitions = Array.isArray(catalog)
    ? Object.fromEntries(catalog.map((definition) => [definition.id, definition]))
    : catalog;
  const path = [];
  const visited = new Set();
  let definition = definitions?.[definitionId];
  while (definition && !visited.has(definition.id)) {
    visited.add(definition.id);
    path.unshift(definition.id);
    if (definition.placeable) break;
    definition = definitions[definition.evolvesFrom];
  }
  const root = definitions?.[path[0]];
  if (!root?.placeable || !Number.isFinite(root.cost)) return null;
  let cost = root.cost;
  for (const id of path.slice(1)) {
    const step = definitions[id];
    if (!step || !Number.isFinite(step.evolutionCost)) return null;
    cost += step.evolutionCost;
  }
  return { definitionId, path, cost };
}

export function validateTowerCatalog(catalog = TOWER_DEFINITIONS) {
  const errors = [];
  for (const [id, definition] of Object.entries(catalog)) {
    if (definition.id !== id) errors.push(`${id}: definition id mismatch`);
    if (!Number.isFinite(definition.range) || definition.range <= 0) errors.push(`${id}: invalid range`);
    if (!definition.attack && !definition.control && !definition.infrastructure) errors.push(`${id}: missing attack or control`);
    if (definition.attack) {
    if (!Number.isFinite(definition.attack.cadencePerSecond)) errors.push(`${id}: invalid attack`);
    if (!['projectile', 'hitscan', 'persistent'].includes(definition.attack?.delivery?.type)) errors.push(`${id}: invalid delivery`);
    if (!Number.isFinite(definition.attack?.volley?.targetSpacing || 0) || (definition.attack?.volley?.targetSpacing || 0) < 0) {
      errors.push(`${id}: invalid volley target spacing`);
    }
    if (definition.attack?.delivery?.type === 'projectile'
      && (!Number.isSafeInteger(definition.attack.delivery.maxContacts) || definition.attack.delivery.maxContacts < 1)) {
      errors.push(`${id}: invalid projectile contacts`);
    }
    if (definition.attack?.delivery?.manualStrikePoint !== undefined
      && typeof definition.attack.delivery.manualStrikePoint !== 'boolean') {
      errors.push(`${id}: invalid manual strike point flag`);
    }
    if (!Number.isFinite(definition.attack?.delivery?.strikeSpacing || 0)
      || (definition.attack?.delivery?.strikeSpacing || 0) < 0) {
      errors.push(`${id}: invalid strike spacing`);
    }
    if (definition.attack?.delivery?.motion === 'sweep'
      && (!Number.isFinite(definition.attack.delivery.durationSeconds)
        || definition.attack.delivery.durationSeconds <= 0
        || !Number.isFinite(definition.attack.delivery.sweepRadians)
        || definition.attack.delivery.sweepRadians <= 0)) {
      errors.push(`${id}: invalid sweep delivery`);
    }
    const maximum = definition.attack?.geometry?.maxVictims;
    if (maximum !== 'unlimited' && (!Number.isSafeInteger(maximum) || maximum < 1)) errors.push(`${id}: invalid victim limit`);
    for (const trigger of definition.attack?.triggers || []) {
      if (trigger.everyNthKill !== undefined && (!Number.isSafeInteger(trigger.everyNthKill) || trigger.everyNthKill < 1)) {
        errors.push(`${id}: invalid trigger cadence`);
      }
    }
    const attackEffects = [
      ...(definition.attack?.effects || []),
      ...(definition.attack?.triggers || []).flatMap((trigger) => trigger.effects || [])
    ];
    const supportedEffects = new Set([
      'damage',
      'status',
      'position_recall',
      'radial_force_field',
      'directional_force_field',
      'slow_field',
      'vortex_force_field',
      'pinch_force_field',
      'force_wall'
    ]);
    for (const effect of attackEffects) {
      if (!supportedEffects.has(effect.type)) errors.push(`${id}: unsupported effect ${effect.type}`);
      if (effect.type === 'status'
        && (!['slow', 'stasis'].includes(effect.status)
          || !Number.isFinite(effect.durationSeconds)
          || effect.durationSeconds <= 0)) {
        errors.push(`${id}: invalid status effect`);
      }
      if (effect.type === 'position_recall' && (!Number.isFinite(effect.delaySeconds) || effect.delaySeconds <= 0)) {
        errors.push(`${id}: invalid recall effect`);
      }
      if (['radial_force_field', 'directional_force_field', 'slow_field', 'vortex_force_field', 'pinch_force_field'].includes(effect.type)
        && (!Number.isFinite(effect.radius) || effect.radius <= 0 || !Number.isFinite(effect.durationSeconds) || effect.durationSeconds <= 0)) {
        errors.push(`${id}: invalid control field`);
      }
      if (effect.type === 'force_wall'
        && (!Number.isFinite(effect.halfLength)
          || effect.halfLength <= 0
          || !Number.isFinite(effect.thickness)
          || effect.thickness <= 0
          || !Number.isFinite(effect.durationSeconds)
          || effect.durationSeconds <= 0)) {
        errors.push(`${id}: invalid force wall`);
      }
    }
    for (const followUp of definition.attack?.impactFollowUps || []) {
      if (followUp.type !== 'cluster_circle'
        || !Number.isSafeInteger(followUp.count)
        || followUp.count < 1
        || !Number.isFinite(followUp.radius)
        || followUp.radius <= 0
        || !Number.isFinite(followUp.ringRadius)
        || followUp.ringRadius < 0
        || (followUp.radialJitter !== undefined
          && (!Number.isFinite(followUp.radialJitter) || followUp.radialJitter < 0 || followUp.radialJitter > followUp.ringRadius))
        || (followUp.angleJitter !== undefined
          && (!Number.isFinite(followUp.angleJitter) || followUp.angleJitter < 0 || followUp.angleJitter > 1))
        || (followUp.delayJitterSeconds !== undefined
          && (!Number.isFinite(followUp.delayJitterSeconds) || followUp.delayJitterSeconds < 0))
        || !Number.isFinite(followUp.delaySeconds)
        || followUp.delaySeconds < 0) {
        errors.push(`${id}: invalid impact follow-up`);
      }
    }
    }
    if (definition.control) {
      const control = definition.control;
      const supportedControlTypes = new Set([
        'aim', 'seed_aim', 'frost_zone', 'barricade',
        'stasis_zone',
        'recall_gate',
        'slow_zone',
        'singularity',
        'bond_zone',
        'braid',
        'breaker_wave',
        'crosswind',
        'splitter'
      ]);
      if (!supportedControlTypes.has(control.type)) errors.push(`${id}: invalid control type`);
      if (!['none', 'point', 'line', 'direction'].includes(control.input)) errors.push(`${id}: invalid control input`);
      if (!Number.isFinite(control.rebootSeconds) || control.rebootSeconds < 0) errors.push(`${id}: invalid control reboot`);
      if (control.input === 'line' && (!Number.isFinite(control.maxLength) || control.maxLength <= 0)) {
        errors.push(`${id}: invalid control line length`);
      }
      if (['stasis_zone', 'slow_zone', 'singularity', 'bond_zone', 'crosswind'].includes(control.type)
        && (!Number.isFinite(control.radius) || control.radius <= 0)) errors.push(`${id}: invalid control radius`);
      if (['stasis_zone', 'singularity', 'bond_zone', 'breaker_wave'].includes(control.type)
        && (!Number.isFinite(control.periodSeconds) || control.periodSeconds <= 0)) errors.push(`${id}: invalid control period`);
      if (['stasis_zone', 'bond_zone'].includes(control.type)
        && (!Number.isFinite(control.durationSeconds) || control.durationSeconds <= 0
          || control.durationSeconds >= control.periodSeconds)) errors.push(`${id}: invalid control duration`);
      if (control.type === 'singularity'
        && (!Number.isFinite(control.activeSeconds) || control.activeSeconds <= 0
          || control.activeSeconds >= control.periodSeconds)) errors.push(`${id}: invalid pull duration`);
      if (control.type === 'breaker_wave'
        && (!Number.isFinite(control.shoveDistance) || control.shoveDistance <= 0
          || !Number.isFinite(control.travelSeconds) || control.travelSeconds <= 0
          || control.travelSeconds >= control.periodSeconds)) errors.push(`${id}: invalid shockwave`);
    }
    for (const modifier of definition.modifiers || []) {
      if (!['self', 'same_area', 'same_area_other', 'network_area', 'network_area_other', 'global'].includes(modifier.scope)) {
        errors.push(`${id}: invalid modifier scope`);
      }
      if (modifier.stacking && !['unique_strongest', 'diminishing_additive'].includes(modifier.stacking)) {
        errors.push(`${id}: invalid modifier stacking`);
      }
      if (modifier.stacking && !modifier.stackGroup) errors.push(`${id}: modifier stack group is required`);
      if (modifier.stacking === 'diminishing_additive' && !Number.isFinite(modifier.additionalValue)) {
        errors.push(`${id}: invalid diminishing modifier value`);
      }
    }
    for (const support of definition.supportEffects || []) {
      if (!['kill_income', 'area_link'].includes(support.type)) errors.push(`${id}: invalid support effect`);
      if (support.type === 'kill_income' && (!Number.isSafeInteger(support.everyKills) || support.everyKills < 1)) {
        errors.push(`${id}: invalid support kill interval`);
      }
      if (support.type === 'kill_income' && (!Number.isSafeInteger(support.bonusCredits) || support.bonusCredits < 1)) {
        errors.push(`${id}: invalid support credit reward`);
      }
      if (support.type === 'kill_income' && support.stacking === 'diminishing_sources'
        && (!Number.isSafeInteger(support.additionalEveryKills)
          || support.additionalEveryKills < support.everyKills
          || support.additionalEveryKills % support.everyKills !== 0)) {
        errors.push(`${id}: invalid diminishing support interval`);
      }
    }
    for (const choice of definition.evolutionChoices || []) {
      if (!catalog[choice] || catalog[choice].evolvesFrom !== id) errors.push(`${id}: invalid evolution ${choice}`);
    }
    if (!towerBuildQuote(catalog, id)) errors.push(`${id}: invalid direct-build path`);
  }
  return errors;
}
