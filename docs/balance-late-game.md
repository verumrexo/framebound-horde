# late-game balance // protocol 23

status: implemented september 11, 2026. constants are initial tuning values fitted against an analytic spending model and the tools below; manual play decides the final numbers.

## the collapse, diagnosed

the september playtest (previous commit's rules: reactor damage x1.5 per rank at 10k x1.1^rank) had every meaningful upgrade bought by ~30 minutes, ~30 damage turrets and reactor damage rank ~30 holding everything, and 3.2 billion credits by 60 minutes. rank 30 cost 1.6 million in total for x192,000 damage. removing that (additive +10%, x1.25 pricing, arsenal x10) did not fix the structure:

1. **one constant exponential.** `hp/s = (2 + 0.8m) · 1.22^m` doubled every 3.5 minutes from minute 0 to infinity. after the body cap at minute 20 all growth was per-body hp on identical squares at constant speed.
2. **income was the same exponential and every sink was finite.** one credit per hp; arsenal all-39 = 279m; reactor damage rank 30 = 32m cumulative; tower spacing is 24 units so a map holds ~1,500 towers for ~2.25m — one minute of income at minute 35.
3. **player power was either unbounded or bounded, never tracking.** measured per-tower hp/s against fat enemies (below): with reactor x4–6 and arsenal x1.5, break-even tower count was ~35 at minute 35, ~110 at 40, ~330 at 45, ~970 at 50. under the additive reactor the rational play from minute 30 was tower spam and a wall near minute 45 regardless of skill.
4. **spatial pressure froze at minute 31.** every rift had equal weight; after the last unlock nothing ever changed.

## what changed

- **threat taper** (`progression.js`): identical curve through minute 20; growth factor eases log-linearly to 1.12/min by minute 40 and holds. still exponential. arsenal prices now land naturally (tier 1s by ~30, all tier 2 by ~45, most tier 3 by ~60).
- **reactor damage** (`research.js`): x1.10 per rank, compounding; 100k x1.20^rank, uncapped. affordable damage grows as spend^0.52.
- **placement escalator** (`network-descendants.js`): the 31st and later placements cost x1.06 each; upgrades never escalate. without it a constant-price tower is 20–100x more damage per credit than any geometric rank, so nobody would buy ranks.
- **rift surges** (`progression.js`, `enemy-swarm.js`): additive, escalating, directional; deterministic from the seed; 45 s warning; hud direction and amber markers.
- **horde pace**: a run-wide time stretch chosen at deployment (x0.6–x1.6).

untouched: minutes 0–20, body cap, movement, 1 credit/hp, mint/forge, arsenal, tower stats, upgrade costs, sale refund, rift timing, control forms.

## measured per-tower hp/s against fat enemies

`npm run balance:kps -- --hp=200 --rates=480 --sources=top,split_left,split_right`, three fronts, 200 hp bodies at the 480/s body cap. damage is honest per hp, so these are the base numbers the reactor multiplies.

| tower     | cost | 480/s |
| --------- | ---- | ----- |
| broadside | 1500 | 50.50 |
| flechette | 1500 | 238.0 |
| cyclone   | 1500 | 65.75 |
| warhead   | 1500 | 301.6 |
| cluster   | 1500 | 286.8 |
| salvo     | 1500 | 359.2 |
| cutter    | 1500 | 132.7 |
| prism     | 1500 | 131.3 |

broadside and cyclone sit far below flechette against fat streams even after the september 11 pierce buffs; revisit after the curve has been played.

## curves (`npm run balance:curves`)

## threat budget (base stream only, 100% kill, no mint)

| min | hp/s | bodies/s | mean hp | cumulative credits | rifts live |
| --- | ---: | ---: | ---: | ---: | ---: |
| 5 | 16 | 13.9 | 1.2 | 2.2k | 6 |
| 10 | 73 | 50.6 | 1.4 | 13.8k | 11 |
| 15 | 276 | 160.5 | 1.7 | 60.2k | 16 |
| 20 | 960 | 480.2 | 2.0 | 226.1k | 21 |
| 25 | 3.0k | 480.2 | 6.3 | 771.6k | 26 |
| 30 | 8.2k | 480.2 | 17.0 | 2.34m | 31 |
| 35 | 19.5k | 480.2 | 40.7 | 6.30m | 32 |
| 40 | 41.2k | 480.2 | 85.7 | 15.11m | 32 |
| 45 | 81.1k | 480.2 | 168.8 | 32.81m | 32 |
| 50 | 157.9k | 480.2 | 328.8 | 67.45m | 32 |
| 55 | 304.8k | 480.2 | 634.7 | 134.58m | 32 |
| 60 | 583.9k | 480.2 | 1215.8 | 263.58m | 32 |
| 65 | 1.11m | 480.2 | 2314.1 | 509.81m | 32 |
| 70 | 2.10m | 480.2 | 4380.3 | 977.00m | 32 |
| 75 | 3.96m | 480.2 | 8252.0 | 1.86b | 32 |
| 80 | 7.43m | 480.2 | 15481.1 | 3.52b | 32 |
| 90 | 25.89m | 480.2 | 53909.9 | 12.41b | 32 |

## reactor damage line (x1.10 damage per rank)

| rank | damage | rank price | cumulative |
| ---: | ---: | ---: | ---: |
| 0 | x1.0 | 100.0k | 0.00 |
| 5 | x1.6 | 248.8k | 744.2k |
| 10 | x2.6 | 619.2k | 2.60m |
| 15 | x4.2 | 1.54m | 7.20m |
| 20 | x6.7 | 3.83m | 18.67m |
| 25 | x10.8 | 9.54m | 47.20m |
| 30 | x17.4 | 23.74m | 118.19m |
| 35 | x28.1 | 59.07m | 294.83m |
| 40 | x45.3 | 146.98m | 734.39m |
| 45 | x72.9 | 365.73m | 1.83b |
| 50 | x117.4 | 910.04m | 4.55b |
| 60 | x304.5 | 5.63b | 28.17b |

other categories:
- weapon cycling: 25 ranks, 10.55m to cap
- targeting range: 15 ranks, 1.10m to cap
- projectile velocity: 20 ranks, 3.43m to cap
- blast coverage: 15 ranks, 1.10m to cap
- beam focus: 15 ranks, 1.10m to cap
- control recovery: 15 ranks, 1.10m to cap
- control coverage: 15 ranks, 1.10m to cap
- construction efficiency: 35 ranks, 98.57m to cap
- base reserve: 20 ranks, 3.43m to cap
- projectile guidance: 15 ranks, 1.10m to cap
- field sustain: 10 ranks, 332.5k to cap

## placement prices (first 30 at catalog price, then x1.06 each)

| placement | frame | finished tower |
| ---: | ---: | ---: |
| 30 | 100 | 1.5k |
| 31 | 106 | 1.6k |
| 40 | 180 | 2.7k |
| 50 | 321 | 4.8k |
| 60 | 575 | 8.6k |
| 80 | 1.8k | 27.6k |
| 100 | 5.9k | 88.6k |
| 120 | 18.9k | 284.2k |
| 150 | 108.8k | 1.63m |

## surge schedule

first surge at 32.0 min, every 6 min for 120s; extra stream 15% of the body cap

| surge | minute | hot rifts | hp multiplier | extra hp/s |
| ---: | ---: | --- | ---: | ---: |
| 0 | 32.0 | cluster_sw_outer, cluster_w_low, cluster_w_mid_b | x3 | 5.3k (+45%) |
| 1 | 38.0 | cluster_n_far_w, cluster_n_gap_w, cluster_n_warm | x3.5 | 16.3k (+53%) |
| 2 | 44.0 | cluster_n_extreme_e, cluster_ne_corner, cluster_e_high | x4 | 42.5k (+60%) |
| 3 | 50.0 | cluster_se_inner, cluster_se_mid, cluster_se_outer | x4.5 | 106.6k (+68%) |
| 4 | 56.0 | cluster_n_warm, cluster_n_slot_w, cluster_n_core | x5 | 260.5k (+75%) |
| 5 | 62.0 | cluster_w_high, cluster_nw_corner, cluster_n_extreme_w | x5.5 | 623.6k (+83%) |
| 6 | 68.0 | cluster_n_gap_e, cluster_n_east, cluster_n_slot_e | x6 | 1.47m (+90%) |
| 7 | 74.0 | cluster_ne_corner, cluster_e_high, cluster_e_gap | x6.5 | 3.41m (+98%) |
| 8 | 80.0 | cluster_e_mid_b, cluster_e_low, cluster_s_last | x7 | 7.81m (+105%) |
| 9 | 86.0 | cluster_n_slot_e, cluster_n_far_e, cluster_n_extreme_e | x7.5 | 17.71m (+113%) |

## expected progression (analytic spending model, to be confirmed by play)

| min | threat (hp/s, mean hp) | typical build | feel |
| --- | --- | --- | --- |
| 15 | 276, 1.7 | 15–25 towers, mostly tier 2–3 | unchanged opening |
| 30 | 8.2k, 17 | 50–70 towers, damage rank 5–8, a few arsenal nodes | comfortable; first surge at 32 is the wake-up |
| 45 | 81k, 169 | ~100 towers, rank ~20, all tier 2 + first tier 3 | ~2x headroom on the base stream, surge peaks ~1.3x |
| 60 | 584k, 1.2k | ~130 towers, rank ~33, 6–10 tier 3 | ~1.2x headroom; surges bleed lives; passive play dies |
| 75 | 4m, 8.3k | ~155 towers, rank ~45, arsenal complete | base alone ≈ 0.7x → loss |

## tools

- `npm run balance:curves [-- --map=map_07 --seed=7]`: the tables above.
- `npm run balance:kps -- --hp=N`: per-form hp/s against N-hp bodies.
- `npm run balance:progression -- --maps=map_01,map_07 --policies=greedy,settled,surge-blind --until=80`: full-run scripted players with per-minute csv output under `docs/progression/`. the scripted player is far weaker than a human at reading the funnel north of the base and the east-wall arrivals on map 01, so treat it as a relative comparison between constant sets, not an oracle; `PROGRESSION_TRACE=1` prints placements and tower kills.
- `npm run test:progression` covers the taper, surge determinism/contiguity/rotation/additivity, the escalator and pace.

## still manual

whether 20–30 minutes feels slack (taper start 20 vs 25); surge readability and cadence; reactor purchase rhythm at 45–60 minutes (a buy-x5 button if it feels like clicking); performance with 100–150 towers and 10–15k fat bodies; crucible severity; co-op reach of rank ~20 by minute 45.
