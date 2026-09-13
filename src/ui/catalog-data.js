import { NETWORK_DESCENDANT_IDS } from '../core/network-descendants.js';

export const TOWER_DEFINITION_ID = 'frame';

export const BUILD_CATALOG_PAGES = Object.freeze({
  network: Object.freeze({ label: 'network iii', rows: Object.freeze([
    NETWORK_DESCENDANT_IDS.slice(0, 3).map((definitionId, i) => ({ key: String(i + 1), definitionId })),
    NETWORK_DESCENDANT_IDS.slice(3, 6).map((definitionId, i) => ({ key: String(i + 4), definitionId })),
    NETWORK_DESCENDANT_IDS.slice(6, 9).map((definitionId, i) => ({ key: String(i + 7), definitionId }))
  ]) }),
  core: Object.freeze({
    label: 'core',
    rows: Object.freeze([
      Object.freeze([Object.freeze({ key: '1', definitionId: 'frame' })]),
      Object.freeze([
        Object.freeze({ key: '2', definitionId: 'assault' }),
        Object.freeze({ key: '5', definitionId: 'barrage' }),
        Object.freeze({ key: '6', definitionId: 'rocket' }),
        Object.freeze({ key: '7', definitionId: 'laser' })
      ]),
      Object.freeze([
        Object.freeze({ key: '3', definitionId: 'tether' }),
        Object.freeze({ key: '8', definitionId: 'anchor' }),
        Object.freeze({ key: '9', definitionId: 'knot' }),
        Object.freeze({ key: '0', definitionId: 'backwash' })
      ]),
      Object.freeze([
        Object.freeze({ key: '4', definitionId: 'network' }),
        Object.freeze({ key: 'o', definitionId: 'overclock' }),
        Object.freeze({ key: 'f', definitionId: 'forge' }),
        Object.freeze({ key: 'r', definitionId: 'relay' })
      ])
    ])
  }),
  assault: Object.freeze({
    label: 'assault iii',
    rows: Object.freeze([
      Object.freeze([
        Object.freeze({ key: '1', definitionId: 'broadside' }),
        Object.freeze({ key: '2', definitionId: 'flechette' }),
        Object.freeze({ key: '3', definitionId: 'cyclone' })
      ]),
      Object.freeze([
        Object.freeze({ key: '4', definitionId: 'warhead' }),
        Object.freeze({ key: '5', definitionId: 'cluster' }),
        Object.freeze({ key: '6', definitionId: 'salvo' })
      ]),
      Object.freeze([
        Object.freeze({ key: '7', definitionId: 'cutter' }),
        Object.freeze({ key: '8', definitionId: 'prism' }),
        Object.freeze({ key: '9', definitionId: 'sweeper' })
      ])
    ])
  }),
  tether: Object.freeze({
    label: 'tether iii',
    rows: Object.freeze([
      Object.freeze([
        Object.freeze({ key: '1', definitionId: 'stasis' }),
        Object.freeze({ key: '2', definitionId: 'recall' }),
        Object.freeze({ key: '3', definitionId: 'dragnet' })
      ]),
      Object.freeze([
        Object.freeze({ key: '4', definitionId: 'singularity' }),
        Object.freeze({ key: '5', definitionId: 'bond' }),
        Object.freeze({ key: '6', definitionId: 'braid' })
      ]),
      Object.freeze([
        Object.freeze({ key: '7', definitionId: 'breaker' }),
        Object.freeze({ key: '8', definitionId: 'crosswind' }),
        Object.freeze({ key: '9', definitionId: 'breakwater' })
      ])
    ])
  })
});

export const BUILD_CATALOG_PAGE_IDS = Object.freeze(Object.keys(BUILD_CATALOG_PAGES));
