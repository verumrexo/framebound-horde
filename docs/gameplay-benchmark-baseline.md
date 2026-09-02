# pre-aoe-nerf assault-family gameplay baseline

captured on 2026-08-26 after reverting the rejected universal-`2x` balance experiment and before the cadence-based aoe nerf. the fractional cadence fix and ballistic-parallel-launch/independent-homing projectile movement are active. this historical table remains the comparison point for `gameplay-benchmark-aoe-nerf.md`.

each cell is `measured kps / final cohort kill percent`. see `gameplay-benchmark.md` for scenario timing, fronts, population bounds, leak accounting, and complete command usage.

| tower | early | mid | late |
| --- | ---: | ---: | ---: |
| frame | 6.0 / 16.7% | 6.0 / 2.8% | 6.0 / 1.3% |
| assault | 12.0 / 31.8% | 12.0 / 5.4% | 12.2 / 2.5% |
| barrage | 24.1 / 59.8% | 24.0 / 10.4% | 24.4 / 4.8% |
| broadside | 39.1 / 81.7% | 40.0 / 16.8% | 40.0 / 7.8% |
| flechette | 45.5 / 93.1% | 48.0 / 20.5% | 48.0 / 9.6% |
| cyclone | 36.0 / 79.2% | 36.0 / 15.3% | 36.2 / 7.1% |
| rocket | 36.3 / 75.9% | 145.6 / 50.6% | 188.0 / 36.0% |
| warhead | 37.3 / 78.4% | 174.7 / 53.2% | 225.0 / 39.0% |
| cluster | 38.0 / 78.1% | 166.8 / 52.1% | 223.1 / 38.2% |
| salvo | 42.5 / 87.0% | 177.3 / 57.3% | 241.7 / 39.7% |
| laser | 28.4 / 58.0% | 113.8 / 36.8% | 149.7 / 26.8% |
| cutter | 38.0 / 77.3% | 164.2 / 51.5% | 251.4 / 38.0% |
| prism | 36.3 / 75.2% | 151.4 / 47.9% | 209.7 / 34.8% |
| sweeper | 45.3 / 91.8% | 222.5 / 69.4% | 329.3 / 52.8% |

the no-tower controls ended with `95.2%`, `87.8%`, and `85.7%` breached in early, mid, and late respectively; the remaining units are reported as unresolved rather than silently treated as kills or leaks.
