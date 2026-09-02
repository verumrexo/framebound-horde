# rejected assault family balance experiment

this 2026-08-25 snapshot is retained only as evidence of a rejected balance experiment. it forced a universal `2x` raw-kps rule against a synthetic preloaded swarm and produced bad gameplay. none of the weapon stats in this file are current. use `tower-catalog.js` for current stats and the gameplay-profile benchmark for future comparisons.

the rule is a practical `2x` kps floor for every replacement wherever the supplied horde is large enough to expose the weapon's throughput. the `10/s` column is deliberately supply-starved: no tower can sustainably double a parent that already kills most of the ten enemies supplied each second. area weapons are not forced into one identical curve; their density scaling remains part of their identity.

scenario: test field tower at `0,238`, centered top spawn, closest targeting, 1 hp enemies, invincible base, one deterministic run. timing is `15s warmup + 15s settle + 30s measured` at `10/s`, and `15s + 4s + 12s` at denser rates.

| tower | cost | 10/s | 100/s | 1,000/s | 10,000/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| frame | 100 | 6.00 | 6.00 | 6.00 | 6.00 |
| assault | 300 | 8.90 | 12.00 | 12.00 | 12.00 |
| barrage | 700 | 8.83 | 24.00 | 24.00 | 24.00 |
| broadside | 1,500 | 8.90 | 48.00 | 48.00 | 48.00 |
| flechette | 1,500 | 9.67 | 48.00 | 48.00 | 48.00 |
| cyclone | 1,500 | 9.10 | 48.00 | 48.00 | 48.00 |
| rocket | 700 | 6.97 | 43.58 | 251.5 | 2,913 |
| warhead | 1,500 | 9.73 | 123.8 | 1,142 | 9,184 |
| cluster | 1,500 | 9.27 | 107.0 | 994.2 | 8,922 |
| salvo | 1,500 | 10.90 | 99.08 | 1,133 | 9,440 |
| laser | 700 | 5.47 | 41.67 | 271.1 | 3,295 |
| cutter | 1,500 | 9.73 | 85.58 | 710.8 | 6,961 |
| prism | 1,500 | 9.67 | 90.00 | 679.4 | 6,878 |
| sweeper | 1,500 | 10.00 | 100.7 | 748.9 | 7,818 |

minimum measured replacement multipliers across the non-starved `100/s`, `1,000/s`, and `10,000/s` rows:

| replacement | parent | minimum practical multiplier |
| --- | --- | ---: |
| assault | frame | 2.00x |
| barrage | assault | 2.00x |
| rocket | assault | 3.63x |
| laser | assault | 3.47x |
| broadside | barrage | 2.00x |
| flechette | barrage | 2.00x |
| cyclone | barrage | 2.00x |
| warhead | rocket | 2.84x |
| cluster | rocket | 2.46x |
| salvo | rocket | 2.27x |
| cutter | laser | 2.05x |
| prism | laser | 2.09x |
| sweeper | laser | 2.37x |

the direct-projectile chain now produces exact saturated throughput of `6 -> 12 -> 24 -> 48` instead of being silently rounded down by the fixed-tick scheduler. rerun the same command after any weapon, movement, targeting, packet-compression, or spawn-flow change.
