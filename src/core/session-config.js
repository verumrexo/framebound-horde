import { TOWER_DEFINITIONS } from './tower-catalog.js';
import { DEFAULT_MAP_ID } from './world-config.js';

export const SESSION_SEED = 0x5f3759df;

export const PROTOTYPE_SESSION_CONFIG = Object.freeze({
  sessionId: 'session_local_1',
  mode: 'game',
  autoStart: false,
  mapId: DEFAULT_MAP_ID,
  seed: SESSION_SEED,
  startingLives: 100,
  startingCredits: 300,
  towers: Object.freeze([]),
  towerDefinitions: TOWER_DEFINITIONS,
  swarm: Object.freeze({
    initialCapacity: 4096,
    enemyHp: 1
  }),
  test: null
});

export const TEST_FIELD_SESSION_CONFIG = Object.freeze({
  sessionId: 'session_test_field_1',
  mode: 'test',
  autoStart: true,
  mapId: 'test_field',
  seed: SESSION_SEED ^ 0x13579bdf,
  startingLives: 100,
  startingCredits: 999999,
  towers: Object.freeze([]),
  towerDefinitions: TOWER_DEFINITIONS,
  swarm: Object.freeze({
    initialCapacity: 16384,
    enemyHp: 1
  }),
  test: Object.freeze({
    spawnRatePerSecond: 100,
    enemyHp: 1,
    invincibleBase: true,
    paused: false,
    timeScale: 1,
    activeSpawnSourceIds: Object.freeze(['test_top']),
    spawnSourceOverrides: Object.freeze({})
  })
});
