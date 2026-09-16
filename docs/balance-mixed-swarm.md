# mixed swarm and linear ramp // protocol 26

september 16, 2026. supersedes the threat curve and surge budget in `balance-late-game.md`; tower, reactor and arsenal stats are unchanged by this pass.

- opening hp/sec: `(2 + 0.8m) * 1.20^m`, down from `1.22^m`.
- from minute 20: continue from the same value and slope with a linear ramp, adding about 156.49 hp/sec per minute. no jump at the join.
- ordinary physical spawns cap at about 345.04/sec at minute 20. subsequent budget growth goes into hp.
- opening average hp stays at 1 for three threat minutes, then rises gradually to 2 at minute 20. ordinary 2 hp enemies start appearing after minute 3, with 3+ hp bodies introduced later. body rate compensates to preserve total hp/sec; pace stretches this schedule along with the rest of the threat clock.
- while average hp is at most 1.2, distribute extra hp one body at a time so ordinary enemies stay at 1–2 hp through the first six threat minutes. afterwards interleave light, medium and heavy bodies in groups of 16. bank each spawn's hp allowance, spend that same bank on stronger bodies, and retain fractional hp. every complete group spends its allowance to within one hp; unfinished groups carry their budget forward.
- one credit per hp removed remains unchanged. mixing does not add income beyond the new threat curve. fewer incoming hp does mean less available income than the old curve.
- surges concentrate ordinary traffic as before, plus exactly 30% of current hp/sec in a separate heavy stream. early surges also respect the 2 hp opening limit. increasing surge hp reduces the extra body rate proportionally. the old stream used 15% of the late-game body cap regardless of current pressure.
- rift timing, surge timing, pace selection, movement and base damage rules remain unchanged.

| threat minute | hp/sec | ordinary bodies/sec | average hp |
| --- | ---: | ---: | ---: |
| 0 | 2.00 | 2.00 | 1.00 |
| 5 | 14.93 | 13.36 | 1.12 |
| 10 | 61.92 | 43.86 | 1.41 |
| 20 | 690.08 | 345.04 | 2.00 |
| 30 | 2254.94 | 345.04 | 6.54 |
| 40 | 3819.80 | 345.04 | 11.07 |
| 60 | 6949.52 | 345.04 | 20.14 |
| 80 | 10079.23 | 345.04 | 29.21 |

the late reduction is substantially larger than the opening reduction because indefinite compounding is removed. these are deterministic budget measurements, not a claim of a particular survival time. manual play remains the tuning check, especially for weapon overkill, targeting and income pacing under mixed hp.

hp-group position and fractional allocation participate in checksums and correction snapshots. protocol 24 saves load with default group state; protocol 25 saves retain their group state. mixed-version live peers must reload to protocol 26.

automated coverage: `test-progression.mjs` verifies budgets, ramp continuity, body cap, mixed tiers, surge ratios and save/correction continuation. `test-edge-indicators.mjs` verifies bearings, viewport bounds, camera changes, lifetimes and reduced motion. sprite masks retain distinct silhouettes through 261 hp and keep the existing point buffer layout and draw count. gpu frame-time impact and visual acceptance require a real browser/device check.
