# turret rework

implemented roster, september 10, 2026. these are initial tuning values; manual gameplay and visual acceptance remain with the user.

## barrage descendants

- broadside: manually faced shotgun fan, 17 pellets, short range and a 2.5-second reload. facing is set with the reshape action or `a`.
- flechette: heavy straight dart, pierces enemies, embeds at the end of its travel, then emits two opposing sideways sprays after a delay.
- cyclone: 24 bullets orbit harmlessly while charging for one second, then fly outward. four-second base cycle.

## tether descendants — zero damage

- tether: sticky homing projectile; prefers an enemy without glue.
- anchor: continuous single-target chill beam, freezes after sustained exposure, then switches targets. unused chill fades.
- stasis: slow lobbed freeze shell with a group freeze on arrival.
- recall: placed crossing gate; marks enemies for a delayed rewind, once per enemy.
- dragnet: placed frost patch, continuous slow and gradual freeze buildup. moving it reboots it.
- knot: two magnetic harpoons draw a pair toward their shared midpoint.
- singularity: gravity seed lands at a chosen point, creates a brief inward pull and a short central hold.
- bond: projectile chains up to five enemies. slows and freezes spread with weaker magnitude/duration. inherited effects do not bounce, groups cannot overlap, and deaths never propagate.
- braid: drawn corridor squeezes the swarm toward its centreline.
- backwash: concussion projectile prioritizes enemies nearest the base; briefly stuns and shoves upstream.
- breaker: drawn solid barricade, maximum 100 units; blocks for 2.5 seconds then recharges. enemies can escape around its ends. swept crossing detection prevents tunnelling.
- crosswind: chosen-side air cannon; short, strong lateral gusts separated by recharge.
- breakwater: passable drawn splitter; alternating enemy identities are steered toward opposite ends.

## network and presentation

network, overclock, forge and relay no longer retain basic guns. infrastructure descendants remain non-damaging. echo accepts tether-family sources only and emits their control locally, including editable fields and walls. damage research and redline do not give control weapons damaging secondary attacks. metronome speeds their recharge.

turret artwork uses a 25% smaller base scale and a shared 54-world-unit maximum footprint; crowded placements shrink further to leave a gap, while hit targets are unchanged. combat presentation includes distinct projectiles, orbit charges, freeze beams, chains, gravity wells and solid barricades.

## persistence and verification

protocol 18 prevents mixed-version multiplayer. older solo saves retain towers and investment; obsolete support projectiles, fields and kill-bond state are discarded during migration. current saves preserve custom shots, chill, chains and geometry through corrections.

`npm run check` includes `npm run test:turrets`: behavior checks for damage isolation with all research enabled, fan direction, piercing and delayed sprays, orbit charging, control targeting, group freeze, harpoons, concussion, chains, field placement, barricades, echo and deterministic corrections. builds and automated simulation checks do not establish balance or visual acceptance.

## laser-family presentation

laser uses a thin cyan/white lance and focusing collars. cutter uses a warm broad thermal blade, cutting edges and vented jaws. prism uses three coloured optical channels and a three-lens chassis. sweeper uses one continuous beam with a restrained directional wake and a gimbal aperture driven by its actual sweep phase.

sweeper is rendered from the persistent attack field at fractional authority ticks, not restarted from damage events. pause holds its pose; correction snapshots restore it directly. damage, sweep duration, arc and targeting remain unchanged. `npm run test:lasers` checks sub-tick motion, reverse direction, expiry, correction-stable poses and rendering bounds. manual visual acceptance remains outstanding.

## sweep collision fix

protocol 19: each damage pulse checks the complete finite beam arc since the previous pulse. this closes the gaps between sampled rays without damaging the unswept fan or changing the damage-pulse rate. the last partial interval is included. saved fields preserve their last checked phase; older solo fields infer it from their pulse timing. `npm run test:sweep` covers both directions, all twelve former angular gaps, range and angular boundaries, single damage per pulse, the final interval and correction continuity.

## september 11 follow-up

- sweeper uses swept-arc collision; the visible beam no longer skips enemies between damage pulses.
- homing control projectiles keep pursuing a live target past firing range, with their existing finite lifetime. firing range only limits acquisition.
- broadside automatically faces its selected target and respects targeting modes.
- laser, cutter, prism and sweeper support the existing aim-point and auto-reset controls. prism fans its three beams around the chosen direction; sweeper centres its sweep around that direction. current attacks finish their original trajectory.
- a single arsenal opens all 39 nodes in one global prerequisite tree. branches are not exclusive, duplicates cannot spend money or stack, and older unlocked research remains owned. large viewports show all three trees; compact viewports use paged entries with prerequisite descriptions.
- reactor ranks cost 10k initially and grow by x1.1 per rank, independently per category. buff amounts and rank caps are unchanged.
- map 04 is a 4000-unit east-to-west corridor with solid northern and southern walls: the reactor sits at the western end, three rifts open at the far eastern end, and two nebula rows plus a centre-line chain keep every field relay-linkable. map 05 uses the clusters terrain with seed-derived rift locations along the outer north/east/west boundaries; the same shuffle is available on every map through the deployment toggle. unlock timing is retained.
- new solo sessions use random seeds; fresh runs advance to a new deterministic seed so peers agree. continuing a save retains its original seed. map 05 layout is reconstructed from that seed on host, guest and save restore.
- protocol 20 separates changed combat/research/map rules from older clients. old solo corrections remain accepted. `npm run test:options` covers these follow-up behaviors alongside the sweep, research and turret suites. visual/play balance remains manual.

## september 11 barrage-descendant tuning

measured in the isolated kps lane (`npm run balance:kps -- --forms=barrage,broadside,flechette,cyclone`) and a 6-hp damage lane before and after; all three now clear their 24-dps parent in their own situation while keeping their identities.

- **broadside** — 17-pellet fan, 3 damage per pellet, every pellet punches through two bodies, 2-second reload, range 160 (was 2 damage, single contact, 2.5 s, range 145). the fan reaches ~50 dps against any stream and is the best of the three at low density (7.9 kps at 10/s vs 5.0 / 5.2). manual facing: `a` / `3 aim point` fixes the fan direction with a click inside range and `0 auto` restores tracking; the tuned volley only fires when an enemy is inside the fan, so a held facing never wastes reloads.
- **flechette** — heavy dart, 4 damage, still pierces everything on its 240-unit line, embeds after 0.4 s and throws two opposing sprays of six splinters (12 total, 140-unit reach, each passing through two bodies); 1.33-second cycle (was 3 damage, 10 single-contact splinters at 110 units, 2 s). best against dense lines: ~118 dps and ~100 kps at 1000/s.
- **cyclone** — 32 bullets orbit at 26 units for 0.9 s, then expand as a storm; each bullet deals 3 damage and passes through four bodies, 3-second cycle, range 190 (was 24 bullets, 2 damage, single contact, 4 s, range 175). best when surrounded: in a five-direction surround lane it edges out both siblings (~50 dps) and scales with crowd density.
- the per-form tuning lives on the attack (`attack.rework`) so shots serialize it and `turret-rework.js` stays free of per-form constants. `npm run test:turrets` covers the pierce budgets, the fixed and automatic fan, range rejection, correction survival of the facing, and the storm's contact limit.
