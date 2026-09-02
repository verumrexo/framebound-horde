# isolated kps stress benchmark

`npm run balance:kps` runs every implemented tower through the real fixed-tick authority, packed swarm, movement, targeting, projectile collision, area geometry, effects, and kill accounting. it is an isolated saturation and regression tool, not a gameplay balance model.

the standard balance lane uses the test field's existing primary-tower position at `0,238`, the centered top spawn, closest targeting, 1 hp enemies, and an invincible base. each spawn rate receives one shared enemy-only warmup checkpoint. every tower then gets an independent clone of that identical swarm. dense rates use four seconds to settle and twelve measured seconds; the cheap `10/s` case automatically uses fifteen settling seconds and thirty measured seconds so a stored trickle of enemies cannot make burst towers report impossible long-run kps. this makes comparisons reproducible and prevents an earlier tower from stealing a later tower's targets.

up to four local worker threads simulate independent towers in parallel by default. use `--workers=1` for a slower sequential run or lower the count if the benchmark is competing with other heavy software.

the default matrix is `10`, `100`, `1,000`, and `10,000` enemies per second across all 22 current forms:

```sh
npm run balance:kps
```

focused and machine-readable examples:

```sh
npm run balance:kps -- --forms=assault,barrage,broadside --rates=100,1000
npm run balance:kps -- --sources=top,split_left,split_right --runs=3
npm run balance:kps -- --json --quiet
npm run balance:kps -- --csv --quiet
```

use `npm run balance:kps -- --help` for every option. the json report also includes kills per shot, captured spawn percentage, ending horde population, simulation-record count, surviving projectile count, oldest projectile age, and simulation-to-wall-time ratio.

these numbers are controlled laboratory throughput, not a balance target. the enemy-only warmup can create unrealistic density, especially at `10,000/s`; never use this report alone to buff or nerf a tower. use `npm run balance:gameplay` for naturally arriving early, mid, and late profiles, then treat both reports as evidence rather than holy scripture.

replacement multipliers are judged only where enemy supply exceeds both forms' practical throughput. if a parent already kills nearly all `10/s`, asking its child for `2x` would require killing enemies that were never spawned. the current assault-family balance uses `100/s`, `1,000/s`, and `10,000/s` as the non-starved comparison rows and keeps `10/s` as an early-game capture-efficiency check.
