# framebound // visual passes

implementation notes for the framebound visual system, newest last. the portable system itself is `docs/visual-theme-card.md`; each pass here names the modules it touched and the `npm run` gate that guards it.

## current rendering override

the game now renders at display pixel density with antialiasing. the earlier forced low-resolution enlargement and geometry-snapping requirements are superseded. the blocky tower body contract and authored bitmap lettering remain, but there is no full-scene pixelation filter. enemies use remaining-hp colours instead of a universally red body.


## subtle sleeping-machine network

linked nebulae reveal sparse, static, world-aligned circuit traces inside their silhouettes. traces disappear beyond zoom scale 5; ordinary link lines stay below enemy contrast and render underneath enemies. at most one two-pixel signal moves across the entire network for two seconds every eight seconds. paid research triggers one outward activation on existing traces only, lasting at most four seconds; repeated purchases replace the wave. no full-field flashes, tower-body blinking, glow, particles, or additional labels. reduced-motion preference disables both traveling effects. this is presentation only and does not change buff timing or network rules.

## mechanical void world art

this pass preserves the current display-density renderer and the exact organic field boundary used for placement and enemy movement. all machinery remains rectangle-built; body animation stays inside a fixed silhouette.

- rifts use fractured jaws around a recessed black aperture. four staggered rows of segments step inward while live. countdowns remain amber, live openings red, and surge rails amber. the test field uses the same artwork and keeps spawn-point dragging. reduced motion freezes the moving segments while preserving the state colours.
- the home base is an armoured reactor with four plates and a recessed core. cyan means above 50% health, amber above 25% through 50%, red above zero through 25%, and an extinguished core means destroyed. maximum lives includes reactor upgrades, with starting lives as the fallback. genuine life loss refreshes one 0.18-second rim response; invincibility cannot trigger it. healing restores the plates and core. replacement sessions, saves, and corrections clear transient responses.
- nebula interiors have dark, stepped contour shelves and sparse mineral cuts, anchored to world coordinates. fine interior detail disappears beyond zoom scale 5. unlinked terrain stays dim green and pending relays amber. confirmed networks use deterministic hues from 200–320 degrees: blue, violet, and pink. interiors, rims, scratches, traces, relay links, target brackets, research waves, and completion effects derive directly from that palette; none tint an existing green surface. a merged network adopts the canonical root's colour and retains it after connector retirement.
- all 40 turrets fit a 22-world-unit diameter inside the 24-unit placement spacing. each form measures its full animation envelope once; only camera zoom changes the rendered scale. nearby towers, previewing, placement, sale, and relay retirement never resize bodies. local and remote selection brackets and ownership marks use those same bounds. click targets remain comfortable.
- enemy point sizes are 80% of the previous sizes, including compressed packets, with a two-logical-pixel minimum. hp colours and packet silhouettes remain; a device-aligned status mark stays visible without covering every body pixel. the swarm still uses one draw.
- landmark movement, research waves, and relay completion use simulation ticks, so pausing freezes them. reduced motion uses static landmark poses and disables travelling relay effects. the existing sparse background-network pulse budget remains.

`src/render/world-appearance.js` owns pure state and palette rules; `world-sprites.js` owns the base, rifts, and fitted brackets; `nebula-shader.js` keeps the instanced contour and colour pass. `src/render/tower-sprites.js` shares compact body bounds across world rendering and previews. `npm run test:visual` checks all tower envelopes and production draw routes, non-green relay colours through merging/retirement/restoration, and landmark damage/motion states. it runs under `npm run check`. browser visual and gameplay acceptance remain manual.

## refined pixel combat interface

the combat hud and tower panel stay in the canvas and use the authored bitmap atlas. the readability pass increases hierarchy without introducing html chrome or a second visual language.

- top telemetry gives lives, credits, and next-rift state a larger bitmap scale where the viewport has room. time, horde, income, spawn rate, network state, and fps remain compact two-line telemetry.
- the bottom strip has 17px pixel controls, a dedicated status line, and a separate muted performance line. narrow windows move the right control group to a second row instead of overlapping it.
- selected towers use a larger attached pixel panel with title, activity metric, investment, and separated action rows. tall relay and echo panels paginate within the playable field. peer-owned towers remain inspect-only.
- the same canvas hud renders during active play, defeat, reconnect, research, and menus. no overlay appears or disappears across game state transitions.

verification: `npm run test:ui` covers pixel layout, narrow reflow, telemetry clipping, panel pagination, tower action routes, and ownership. `npm run check` includes this gate.

## combat marks and body portraits

projectile heads and kill marks now follow the 22-unit turret footprint through the camera instead of fixed screen slabs. `src/render/combat-marks.js` owns the proportions: light heads are 2–5px, explosive heads an odd 3–9px width with a one-pixel black backing, and the kill mark radius is 3–8px, all derived from the on-screen turret diameter with floors matching the two-pixel enemy minimum. trails keep their world lengths.

each weapon family has one compact rectangle-only kill mark: ballistic ticks move outward, explosives expand a hollow square, beams split two bars apart, control forms close four corner brackets, gravity forms collapse ticks inward, and displacement forms widen a single bar. colours keep the earlier family logic. dense combat absorbs same-family kills landing within one burst radius of a mark younger than 70ms, caps live marks at 48 by recycling the oldest, and draws at most three control-link lines per mark. nothing here changes simulation, targeting, or authority.

upgrade cards and the tower catalog show the real body as a static 1× portrait inside a fixed 25px socket (`drawTowerPortrait` in `tower-sprites.js`), centred on the measured bounds; no fractional scaling and no animation. catalog rows grew to 27px with a two-line label so shortcut, name, and price stay readable in four-column rows. `npm run test:art` checks every portrait fits its socket and `npm run test:visual` checks mark proportions, family distinctness, merge and cap behaviour.

## assembly reveal, map contours, menu tiers and reactor shutdown

- placing or evolving any turret, local or remote, draws a fixed 17px frame over the already-live body: four corner ticks plus one hard scanline stepping top to bottom over 18 simulation ticks (`src/render/assembly.js`). placement is mint, evolution cyan with a dim trailing line. pausing freezes it, reduced motion holds the static ticks, and replacement sessions clear it. the snapshot, targeting and firing never wait on it.
- map selection shows the selected field's real organic boundary (`src/render/map-thumbnail.js`): the camera-safe window is rasterised once per map and size through `defenseAreaField`, drawn as interior and rim runs in the unlinked terrain palette, with the base as a cyan block and rift entries as red jaw pairs clamped to the frame edge. arena maps get the four-edge frame; southern-wall maps the hazard rule. narrow panels keep the full-width list.
- the main menu drops "wip command deck" for `survival telemetry // mechanical void`, an interrupted rule with one amber scar, a cyan run-state rail, and an interrupted divider between the run tier and the session tier.
- defeat shows the base sprite inside the panel stepping cyan, amber, red, then extinguished over 0.6s of wall-clock time (ticks stop at defeat); reduced motion jumps to extinguished. retry, map and menu controls render from the first frame.

`npm run test:visual` covers reveal ticks, pause and reduced motion, contour coverage of every visible field centre, bounded thumbnail painting, and shutdown states through the production route.

## consistency and cleanup pass

- the last fixed-size world marks follow the camera: the hardpoint socket bracket matches the turret footprint, perimeter-intel brackets match packet size, and the forge credit cross uses the kill-mark reach.
- escape, coop and defeat panels share the main menu hierarchy through `drawMenuHeader` and `drawTierDivider`: hard bookends, 2× title, machine sub-line, interrupted rule with one accent scar, and an interrupted divider between the run tier and the session tier. the escape menu and the defeat panel reuse the cached map thumbnail for the current field.
- research stations lean on the bitmap icon set: reactor categories get their own icon kinds (`plate`, `guide`, `economy` added), the arsenal detail and reactor tiles carry 2× icon sockets, and the compact station rows use 2× icons.
- `src/ui/panel-layout.js` owns pure panel geometry (centred panels, menu tiers, map selection with thumbnail column, catalog, attached tower panels). `npm run test:ui` checks every panel at four viewports: inside the viewport, tiers only with room, thumbnails only beside a wide list, attached panels flipping and clamping.
- `catalogDefinition(snapshot, id)` indexes the catalog once per snapshot instead of a linear scan per tower per frame. `drawReworkedCombat` and the never-pushed knot/backwash flash branches are gone.
- gameplay options gain a hostile palette switch (`2` in the options page): a magenta-led hp ramp for players who cannot separate hostile red from system green. it is a single shader uniform; hp values, statuses and packet silhouettes are unchanged, and the field guide reports the active ramp.
