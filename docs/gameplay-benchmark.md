# gameplay balance profile

`npm run balance:gameplay` is the primary tower-balance diagnostic. unlike the isolated saturation script, every tested tower exists from tick zero and enemies arrive naturally. no enemy-only stockpile is cloned underneath it.

the default profiles are bounded around the populations the browser build can currently handle:

| profile | spawn | fronts | lead | measured | no-spawn drain | maximum total spawned |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| early | 50/s | 1 | 12s | 20s | 30s | 1,600 |
| mid | 400/s | 3 | 10s | 12s | 30s | 8,800 |
| late | 1,000/s | 5 | 8s | 10s | 30s | 18,000 |

each profile also runs a no-tower control with the same seed and spawn schedule. the report keeps separate measurements instead of hiding judgment inside one magic score:

- kps and percentage of spawned enemies killed;
- firing utilization, which exposes range or target starvation;
- final kill, breach, and unresolved percentages after spawning stops and the bounded cohort receives 30 seconds to drain;
- breach-percentage points prevented versus the no-tower control;
- active-horde growth during the measured window;
- kps per 100 invested credits;
- starting, ending, and peak active population;
- projectile count and maximum surviving projectile age in json output.

usage:

```sh
npm run balance:gameplay
npm run balance:gameplay -- --forms=rocket,warhead,cluster,salvo
npm run balance:gameplay -- --scenarios=mid,late --runs=3
npm run balance:gameplay -- --json --quiet
npm run balance:gameplay -- --csv --quiet
```

`npm run balance:kps` remains available as an isolated saturation and regression stress test. its stocked swarm is useful for finding throughput cliffs, packet bugs, and projectile leaks, but it must not dictate buffs or nerfs.
