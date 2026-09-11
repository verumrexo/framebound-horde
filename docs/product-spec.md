# framebound horde — product specification

## product promise

framebound horde is a real-time space tower-defense survival game about holding one base against a continuous liquid-like red swarm. the map is enormous, building never pauses the game, and towers may be placed freely inside irregular handcrafted nebula defense areas that enemies flow around.

## fixed game rules

- production enemies are hostile-red squares with exactly 1 hp. a future weapon that “deals 10” means it can affect up to 10 valid enemies, not that ordinary enemies become health sponges.
- enemies enter from one broad authored top rift at the beginning of a run. spawn rate rises with elapsed time and additional broad perimeter rifts unlock with advance warning. each production map has 32 rifts, unlocks one every 60 seconds, and gradually expands from the distant north edge down both sides into late-game lower corners; nothing spawns directly beneath the base. production camera limits use a smaller authored safe view than the simulation bounds, so even maximum zoom keeps rifts and spawning offscreen.
- there are no waves, lanes, gravity, bouncing, pachinko physics, build pauses, difficulty selector, or active-enemy cap. if the player cannot clear the horde, the population is allowed to bury the base. above 20,000 movement records, nearby 1 hp enemies begin sharing deterministic swarm packets; this limits simulation records rather than gameplay population.
- enemies steer toward one base near the bottom without lanes or predetermined paths. a deterministic crowd field supplies approximate collision, shared momentum, pressure, and broad seeded curl; nearby nebula gradients bend and split that flow. enemies approach across a distributed arc and only collapse onto the base at close range. each arrival loses one base life and arrivals are never throttled to one life per second.
- maps are authored selectable definitions, not merely different random seeds. each may have its own bounds, defense areas, base, spawn locations, unlock timing, and flow.
- towers may be placed anywhere inside a defense area. they do not block enemies, take damage, or get destroyed.
- pressing `1` arms exactly one frame placement. the next valid click builds that frame and immediately exits placement. `b` opens a paged tower catalog containing every implemented form at its complete path price: 100 for frame, 300 for a first replacement, 700 for a second replacement, and 1,500 for a finished third replacement. choosing a catalog entry arms repeated placement of that exact finished form until right-click cancels or `b` opens the catalog to switch.
- clicking a tower opens a compact in-world `upgrade / sell` panel above it with authoritative lifetime kills for weapons or control work for pure installations. `upgrade` opens a larger three-choice replacement panel with branch role, price, and effect description. after a replacement, that panel stays attached and immediately shows the new form's children, allowing two consecutive replacements without reselecting the tower. building and menus never pause the run.
- tower number keys are contextual: with a selected tower, `1` opens its replacement choices and `2` sells it; inside the replacement panel, `1`, `2`, or `3` immediately chooses the matching branch. with no tower selected, `1` retains its normal one-frame placement behavior. a locally saved gameplay option, enabled by default, immediately selects a newly placed one-shot frame so `1 > place > 1 > 1` replaces it with assault. catalog placement deliberately stays in build mode without selecting each accepted tower.
- the bitmap main menu starts or continues a saved run, opens a three-map selector for every fresh run, or enters the test field. `escape` opens an in-game command menu with resume, new-run map selection, local gameplay options, and main-menu actions. deploying over a live run requires confirmation. none of these menus pauses a run once gameplay has been entered.
- targeting is selectable per tower; `closest` is the default. selected towers show range, with a toggle to show every range. the hud shows the authoritative elapsed run timer and a rolling five-second local-player gold-per-second rate derived from authoritative earned credits.
- every kill pays exactly 1 credit. a tower sells for 50 percent of its total investment.

## production maps

fresh runs choose one of three authored layouts. all use the same survival rules, 32 perimeter rifts outside the opening view, one newly active rift per minute, and uncapped elapsed-time difficulty. their defense geometry changes how the swarm divides and recombines:

- `map 01 // clusters`: 47 mixed-size areas, including the original seven large hubs, arranged into loose irregular groups for braided flow and mixed tower capacity.
- `map 02 // shards`: 50 small isolated areas spread unevenly across the field, creating a wider, less centralized front.
- `map 03 // continents`: 30 large areas with broad spaces between them, creating fewer but heavier channels without fixed lanes.

the map choice is part of the authoritative start or restart command, correction snapshot, autosave, and multiplayer session state. it is not a local visual preference.

## tower replacement tree

the root tower is `frame` and costs 100 credits to place. progression replaces the entire tower form; it is not a row of generic stat upgrades. replacement keeps position, owner, targeting choice, total investment, lifetime kills, and branch history while changing the tower's name, weapon, stats, visuals, and ability. direct catalog builds are only a speed shortcut: the authority reconstructs the complete branch history, charges exactly the same accumulated path cost, and gives no discount or free replacement.

- first replacement: pay 200 and choose exactly one of `assault`, `tether`, or `network`.
- second replacement: each first form offers three mutually exclusive children costing 400. all nine second-stage forms are implemented.
- third replacement: each assault, tether and network child offers three mutually exclusive finished forms costing 800. all twenty-seven grandchildren are implemented.
- choosing a child permanently locks its siblings.
- a finished assault path has 1,500 credits invested and sells for 750.

## approved first forms

- `frame`: 170 range, 6 shots per second, one visible physical projectile, one victim maximum.
- `assault`: a twin shotgun. it fires two adjacent physical projectiles per volley at 6 volleys per second. the pair launches in a rigid parallel formation for 0.14 seconds, then each projectile homes independently toward its reserved victim. each projectile physically collides and can kill one enemy, for up to 12 kills per second.
- `tether`: keeps the frame shot. each kill slows the nearest 3 surviving enemies within 56 world units by 30 percent for 0.8 seconds. the strongest slow wins and duration refreshes; it does not stack with itself.
- `network`: keeps the frame shot and grants 10 percent range to every tower in its connected network, including itself. each additional unevolved network contributes only 1 percent more. replacing it with a child removes this range passive.

## approved assault replacements

each replacement costs 400 credits, fully replaces assault, preserves the tower's lifetime identity, and permanently locks the other two choices.

- `barrage`: 170 range and 6 volleys per second. each volley launches 4 adjacent projectiles in a short rigid parallel formation before independent homing and physical collision, for a reliable maximum of 24 kills per second.
- `rocket`: 220 range and 1 shot every 3 seconds. one visible physical rocket retargets as needed, then its first contact kills every production enemy inside a 64-unit circle.
- `laser`: 300 range and 1 beam every 2.5 seconds. one instant 32-unit-wide line kills every production enemy intersecting the complete beam; the hard-pixel presentation uses a thick three-band discharge matching that lethal width.

## approved assault grandchildren

each grandchild costs 800 credits, fully replaces its parent, preserves tower identity, and ends that branch for now.

from `barrage`:

- `broadside`: 180 range and 5 volleys per second. each volley launches 8 adjacent projectiles in a short rigid parallel formation before independent homing, for up to 40 kills per second.
- `flechette`: 200 range and 4 volleys per second. each volley launches 4 visible needles in a short rigid parallel formation before independent homing; every needle keeps flying after contact and can physically pierce 3 enemies, for up to 48 kills per second.
- `cyclone`: 180 range and 18 volleys per second. each volley launches 2 adaptive physical projectiles, for up to 36 kills per second with the most consistent target turnover.

from `rocket`:

- `warhead`: 250 range and 1 rocket every 2.5 seconds. its heavier rocket kills every production enemy inside a 112-unit impact circle.
- `cluster`: 240 range and 1 rocket every 1.7 seconds. impact clears a 48-unit circle, then six deterministic pseudo-random mini-payloads travel 80–128 units before delayed 32-unit blasts. angular, radial, and timing scatter comes from authority state so every peer reproduces the same pattern.
- `salvo`: 240 range and 1 three-rocket volley every 2 seconds. it launches toward spatially separate groups when possible, with independent 48-unit blasts; if fewer separated groups exist, unused rockets fall back to other valid targets.

every rocket-family form supports an optional persistent manual strike point inside its current effective range. with a point active, rockets ignore enemies along the flight path and airburst at the authoritative impact pattern instead of detonating on first contact. rocket, warhead, and cluster use the exact selected point; salvo treats it as the center of a three-impact line. a manual tower holds its ready shot until at least one enemy is inside one of the marked blast circles. clearing the point restores automatic target selection and first-contact detonation.

from `laser`:

- `cutter`: 360 range and 1 beam every 2 seconds. one 64-unit-wide line deletes every production enemy it intersects.
- `prism`: 320 range and 1 three-beam volley every 1.7 seconds. it resolves 3 independent 20-unit-wide lines toward distinct surviving targets.
- `sweeper`: 300 range and one discharge every 5 seconds. one authoritative 24-unit-wide line begins on its acquired target, then alternates sweep direction through 100 degrees over 0.6 seconds, resolving newly intersected enemies throughout the motion.

## approved tether replacements

each replacement costs 400 credits, fully replaces tether, preserves the tower's lifetime identity, and permanently locks the other two choices. all three keep one frame-like physical shot at 6 shots per second.

- `anchor`: every kill slows the nearest 8 surviving enemies within 72 world units by 45 percent for 1.4 seconds. strongest slow wins and duration refreshes.
- `knot`: every third lifetime kill creates a 72-unit attraction well at the impact for 0.6 seconds. a new well from the same tower replaces its previous well.
- `backwash`: every fourth lifetime kill creates a 76-unit upstream pulse at the impact for 0.35 seconds, pushing nearby enemies away from the base. a new pulse from the same tower replaces its previous pulse.

## approved tether grandchildren

each grandchild costs 800 credits, fully replaces its parent, sacrifices the frame-like weapon, preserves tower identity, and ends that branch for now. the parent effect is not inherited. these are passive installations: they do not fire projectiles. bond links enemies without requiring a kill to activate, but its paired-death payoff needs another weapon to kill a linked enemy. the other eight manipulate time or movement without dealing damage.

configurable points and walls may be placed anywhere inside the tower's current range, not only inside a nebula. repositioning is free but reboots that installation for one second. point and direction controls use one click; line controls use click-drag. overlapping copies of the same finished form do not multiply their force or slow. braid, crosswind, and breakwater combine only sideways steering, with a shared lateral-speed bound and preserved obstacle-aware forward movement. timed effects use shared rhythms so more copies add coverage, not permanent trapping. geometry affects every eligible enemy without a hidden population cap; a bond requires two unpaired enemies. all geometry, pulse phase, pairing, crossing outcomes, and telemetry are authoritative and correction-safe.

from `anchor`:

- `stasis`: place a 72-unit time field. on a shared eight-second authority rhythm it freezes every enemy inside for 0.6 seconds; enemies arriving after the pulse are not frozen.
- `recall`: draw a memory gate up to 130 units long. an enemy crossing it records that exact crossing point, receives the recall marker, and snaps back after 1.5 seconds. each enemy may be marked only once in its lifetime, shared across all recall gates. moving, stacking or selling gates cannot rearm it.
- `dragnet`: place a permanent 86-unit field that slows every enemy inside by 25 percent, down from 55 percent. the strongest slow wins rather than multiplying with other slows.

from `knot`:

- `singularity`: place a 108-unit gathering point. it pulls inward for 0.45 seconds every six seconds, then releases the clump. inward strength is reduced from 400 to 300; there is no always-on holding field.
- `bond`: replaces orbit. every six seconds it links spatially neighbouring enemies in pairs within 120 units of the tower for two seconds. killing one kills its surviving partner. an enemy has at most one active link; linked deaths cannot trigger more links or attack on-kill chains. bonus kills, ordinary income and forge progress are attributed to bond. it does not slow, pull or shoot. compressed records link a matched number of represented units, so one ordinary bullet claims at most one extra unit, not an entire packet. existing saved orbit towers become bond without losing investment, ownership or lifetime kills.
- `braid`: draw a corridor up to 180 units long and 82 units wide, preferably along the swarm's flow. weaker opposing lateral forces squeeze enemies toward its centreline without reducing forward movement. its default corridor now follows the flow instead of cutting across it.

from `backwash`:

- `breaker`: emits a 180-unit-wide shockwave every eight seconds. the hard wavefront travels 220 units over 1.1 seconds. each enemy receives one 26-unit upstream shove per shared wave cycle; overlapping breakers cannot repeatedly shove the same enemy during that cycle. there is no continuing acceleration or lingering push field, and nebula exclusion still applies.
- `crosswind`: choose left or right for a permanent 132-unit steering field centred on the tower. both the preview and accepted direction snap sideways relative to local flow. enemy steering projects sideways against its own obstacle-aware direction, never upstream, and strength is reduced from 190 to 130.
- `breakwater`: draw a persistent passable splitter up to 188 units long, with a 30-unit influence band on either side. it steers enemies toward the nearer endpoint rather than pushing upstream. a stable enemy identity decides an exact centre tie. enemies retain forward movement, may cross anywhere, and never queue against a solid wall.

these are initial rework values, not a claim of playtested final balance. the test field exposes all nine through the existing tether catalog. bond uses a green centre marker; selecting it shows a small sample of actual live links, while normal play avoids a screenful of connecting lines. bond's selection displays kills, and breaker's selection counts enemies shoved rather than meaningless sustained-force time.

## approved network replacements

each replacement costs 400 credits, fully replaces network, preserves the tower's lifetime identity, keeps one frame-like physical shot, remains a node in relay topology, loses network's range passive, and permanently locks the other two choices.

- `overclock`: the first overclock makes every tower in its connected network fire 15 percent faster. each additional overclock contributes only 1 percent more.
- `forge`: the first forge contributes 10 economy points per linked kill and each additional forge contributes 1; every 80 points pays 1 deterministic bonus credit. this is exactly the long-run rate of 1 credit per 8 kills plus 1 per 80 kills for each extra forge. progress, payouts, contributors, and the earning forge are authoritative and saved.
- `relay`: the player selects one other nebula intersecting its visible 360-unit link range. eligible areas receive hard selection brackets, and the chosen link works in both directions. range, overclock, and forge effects operate across the connected pair. multiple relay links may form a larger deterministic network when they meet. relay provides no stat passive by itself.

## extensible combat contract

- an attack separately defines delivery, hit geometry, victim limit, effects, and follow-up triggers.
- delivery may be a visible projectile, instant hitscan, or a persistent timed field.
- geometry may be a single contact, explosion circle, piercing line, chain, or authoritative sweep.
- rockets can physically contact one enemy and then kill nearby enemies inside an explosion. lasers can delete every allowed enemy intersecting their line. on-kill cascades and deterministic risk-of-rain-style effect chains are supported with recursion limits.
- a normal projectile removes exactly one unit from a swarm packet, still paying one kill and one credit. rocket circles and laser lines remove every unit represented by every packet their geometry intersects. a packet reaching the base breaches once per represented unit. status and crowd pressure apply to the whole local packet.
- fired attacks snapshot their stats. later tower changes do not rewrite projectiles already in flight.
- pure control installations use a separate point, line, direction, or tower-centred geometry contract rather than pretending to be attacks. the same generic contract supports future walls, wells, fields, gates, and directional forces.
- target reservation prevents duplicate cosmetic shots. if another attack removes a reserved enemy first, the later projectile retargets instead of wasting itself in empty space.
- dormant hp values of 2, 5, and 10 exist only in the test field to validate damage and multi-hit behavior. production enemies remain 1 hp.

## test field

press or click `t` to enter the local test field while the actual solo run continues in the background. it uses the same authority, swarm, targeting, projectile, collision, effect, and tower-form code as the game.

the field provides one primary tower, up to 8 support towers, two defense areas for relay checks, direct hotkeys for the 13 core forms, and a paged `u` form catalog for all 40 implemented forms. it also provides draggable towers, draggable and toggleable spawn points, a 0–100,000 enemies-per-second slider, presets, hp diagnostics, invincible-base toggle, clear/reset, keep-swarm toggle, pause, single-step, 0.25×/1×/2×/4× time, range display, and live 1-second/10-second/peak kps plus real population, simulation-record, and combat counters. test settings persist locally.

## cooperative multiplayer contract

- cooperative play is a fixed requirement for 2–4 players over webrtc peer-to-peer data channels. there is no dedicated authoritative gameplay server; a signaling service only introduces peers and a turn relay is a connectivity fallback.
- one peer is authoritative for commands, physical victims, kills, money, lives, ownership, checksums, and correction snapshots. peers run the same seeded fixed-tick simulation so 100 or 10,000 enemies remain visually close; the host's ids and outcomes are final.
- the roster locks when the run starts. new players cannot join mid-run. an original player may reconnect.
- a disconnect freezes the run for up to 90 seconds by default. the host may continue earlier. if the host disconnects, authority migrates before inheritance is resolved.
- if a player is removed, their towers are distributed across remaining players to balance inherited total investment, and their wallet is split evenly. a player returning after transfer is a spectator.
- wallets are individual. kill income is divided as evenly as possible among connected players.
- solo is about individual skill; co-op is about teamwork. neither mode pauses except the explicit reconnect/host-migration hold.

### first public beta

the pixel main menu now hosts or joins a six-character room through the existing framebound signaling relay. two to four linked pilots share one host-scheduled run; the host selects its map. player commands, packed corrections, version checks, guest reconnection, and balanced inheritance are connected. foreign towers can be inspected but not edited. co-op never replaces the player's solo autosave.

the full contract above remains the target. this beta does not yet have network host migration, turn fallback, or restart voting. the host must keep the game open; an original guest can reconnect, but the room cannot survive its host closing. restrictive-network connectivity and multi-machine gameplay are manual acceptance checks, not claimed as verified by a build.

## network grandchildren

the nine implemented forms, shared rules, controls and acceptance boundary are recorded in [`network-grandchildren-todo.md`](network-grandchildren-todo.md). overclock becomes redline, metronome or aperture; forge becomes mint, salvage or foundry; relay becomes amplifier, echo or hardpoint.

## visual contract

- the world and hud render together into one deliberately low-resolution webgl2 surface that adapts to the window. it is enlarged only by an integer 1× or 2× css scale with nearest-neighbor sampling.
- camera and geometry snap to logical pixels. the context disables antialiasing, multisampling, dithering, smoothing, and filtered textures. shaders use hard cutoffs and never `smoothstep` edges.
- enemies are chunky red squares. compressed packets remain visibly plural: one movement point draws a hard cluster of up to four separate squares, with a center overload pixel when it represents more. a status is a tiny contrasting square in the packet center: slow uses cyan, recall uses amber, and stasis uses mint.
- each nebula is one authored organic harmonic silhouette, drawn from three families: torn islands, angled wisps, and shallow bitten hubs. there are no stacked-circle seams or enclosed cutout traps. the interior is near-black green with sparse hard scratches; the full edge stays subdued and only broken edge scars use bright mint. cyan is reserved for towers, shots, status, and information.
- tower bodies use only horizontal and vertical rectangles, including all upgrades and future forms. frame and its assault, tether and network replacements are the reference: square housings, inset cores, straight rails and blunt attachments. no diagonal lines, diagonal silhouettes, triangles, angled arms or rotating body parts. prism is a three-emitter rack; sweeper is a straight scanner rail. combat beams and world-space targeting retain their actual geometry.
- all interface text is lowercase and drawn from a real bitmap glyph atlas inside the game framebuffer.
- the palette is black `#010607`, cyan `#35f2ff`, mint `#55ffc2`, green `#74ff6a`, amber `#ffc857`, and hostile red `#ff4d5a`.
- the hud may be polished, readable, responsive, and playful, but never becomes glossy web chrome: no gradients, glow, blur, soft shadows, rounded cards, or corporate cyan dashboard sludge.

## usability

- press `?` or open the escape menu field guide for build, targeting, camera and save controls. the guide distinguishes test-field shortcuts from production shortcuts and explicitly states that menus do not pause solo.
- pointer cancellation, lost capture and focus loss clear unfinished gestures without committing control geometry. secondary touches cannot hijack a gesture. browser modifier shortcuts do not trigger game hotkeys. escape and defeat screens discard underlying interactive hitboxes.
- solo saving is attempted when a tab becomes hidden as well as on page exit and the existing autosave cadence; browser storage and abrupt process termination remain external limits. blocked database opens and ten-second open timeouts report save unavailability instead of locking the loading flow indefinitely. a read is accepted only after its transaction commits.
- defeat shows survival time, kills and remaining towers with clickable retry, map selection and menu actions. co-op offers room status and explains the fresh-room restart limitation.

## current scope boundary

the current build includes the reusable game foundation, all twenty-seven grandchildren, three selectable production maps, the menu shell, perimeter production rifts, the test field, and live webrtc room flow. final balance, audio, and tauri packaging remain later milestones. tower names and effects beyond the approved forms require player decisions before implementation.

## current hp economy and boundary revision — protocol 16

this section supersedes the earlier one-hp-only and forced low-resolution rendering requirements.

- the original exponential spawn formula is retained as hp per second, and each hp actually removed pays one ordinary credit before existing mint/forge bonuses. nonlethal hits pay immediately; overkill cannot pay. body kills remain a separate statistic.
- after two minutes the hp mixture gradually changes from red (1) to orange (2). it reaches all-orange at twenty minutes. the physical spawn cap is that twenty-minute body rate: approximately 480.22/sec. all later exponential growth becomes average hp. neighbouring integer hp values mix deterministically; colour changes as remaining hp drops. first tiers are red, orange, yellow, violet and magenta; higher hp uses marked colour bands.
- the budget identity is `body rate * average hp = old uncapped spawn rate`. at 45 minutes that is about 480.22 bodies/sec * 608.89 hp = 292,399.06 hp/sec. this preserves available reward supply, not automatic income or unchanged survival difficulty. late-game damage research remains the next design stage.
- rocket cadence: rocket 0.25/sec; warhead 0.3/sec; cluster 0.4/sec; salvo one three-rocket volley per three seconds. laser/cutter/prism/sweeper widths are 16/32/10/12.
- tower placement and test dragging enforce an 80-unit centre separation; occupied socket purchases also respect clearance. existing saved layouts are not moved. tower art scales with world zoom rather than staying the same screen size.
- production bottom boundary is y=900 for camera and enemies. old southern entrances now approach from the side perimeter above the wall. zoom levels 1–8 are restored, with the bottom of the playable viewport clamped to the wall.
- unlinked relays automatically select the nearest eligible nebula not already claimed by a relay target, respecting existing link range. valid manual links remain unchanged; target choice has stable tie-breaking.
- the canvas renders at display pixel density with antialiasing, without forced low-resolution enlargement or geometry snapping. blocky tower assets and bitmap lettering remain intentional.
- protocol 16 is required between peers; older solo corrections through 15 still load. hp tables use float64 to avoid the previous 65,535-hp limit. fractional spawn state is included in corrections and checksums.
- arsenal/reactor replacements and revised 39-node research are proposed in `arsenal-reactor-proposal.md`; their purchase systems are not implemented yet.

## arsenal and reactor / protocol 17

this supersedes earlier salvage/foundry descriptions: salvage migrates to reactor and foundry to arsenal. arsenal offers 39 unique global research nodes in a 3/9/27 tree, with one path per station and free traversal of owned ancestors. tiers cost 10 million, 100 million and 1 billion. reactor offers 12 globally priced rank categories. research survives station sale and never contributes to its refund. purchases use the payer wallet; benefits are shared. see [the approved station design](arsenal-reactor-proposal.md) for effects and caps. fractional damage pays accumulated whole hp, without overkill rewards; secondary attacks cannot recursively trigger research. automated checks cover authority behavior; manual gameplay and multiplayer acceptance remain pending.
