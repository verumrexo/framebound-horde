# aoe cadence nerf gameplay profile

captured on 2026-08-26 after reducing rocket-family and laser-family cadence while preserving their lethal geometry. cluster also uses deterministic angular, radial, and timing scatter across an 80–128 unit payload distance. this is comparison evidence, not an automatic tuning rule.

each cell is `measured kps / final cohort kill percent` under the unchanged early, mid, and late scenarios.

| tower | early | mid | late |
| --- | ---: | ---: | ---: |
| rocket | 28.0 / 58.1% | 97.7 / 36.6% | 140.7 / 25.7% |
| warhead | 37.3 / 76.3% | 130.1 / 51.1% | 220.8 / 37.1% |
| cluster | 35.5 / 73.7% | 148.2 / 48.2% | 171.1 / 35.8% |
| salvo | 38.8 / 81.9% | 154.2 / 52.4% | 202.0 / 36.7% |
| laser | 14.7 / 32.2% | 54.4 / 19.0% | 61.6 / 13.5% |
| cutter | 30.7 / 64.9% | 122.2 / 39.2% | 158.3 / 28.0% |
| prism | 29.9 / 62.3% | 126.2 / 38.1% | 144.6 / 27.2% |
| sweeper | 32.5 / 66.6% | 157.7 / 45.5% | 176.3 / 33.3% |

the bullet-family rows are unchanged from `gameplay-benchmark-baseline.md`. the nerf makes barrage outperform laser against the sparse early stream, keeps rocket close to barrage there, and leaves aoe ahead when enemy density supplies enough valid geometry. because slowing unlimited geometry lets larger groups accumulate between attacks, cadence reductions do not reduce dense-horde kps linearly.
