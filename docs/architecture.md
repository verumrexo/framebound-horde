# framebound horde — technical architecture

## authority and simulation

`embedded-session.js` is the solo and p2p host authority. it advances at a fixed 60 hz and owns session time, run time, roster, host, reconnect holds, maps, towers, attacks, projectiles, force fields, network topology, support counters, enemies, lives, wallets, kills, breaches, and ordered events. browser frame rate never changes accepted commands or combat outcomes at a given authority tick.

every action crosses the same versioned command envelope intended for a webrtc client: protocol version, client id, player id, monotonic sequence, intended tick, type, and payload. the authority validates it and emits ordered serializable events. solo does not bypass this boundary. protocol-v11 added owner-validated persistent rocket strike points; protocol-v12 added crosswind direction vectors; protocol-v13 replaces that one-off control with owner-validated generic point, line, and direction geometry plus a matching ordered state-change event.

## packed enemy swarm

`enemy-swarm.js` uses growable typed arrays rather than objects:

- one dense `float32` buffer stores x, y, vx, and vy;
- dense index/id tables provide stable enemy id plus generation handles;
- one dense `float32` unit-count table records how many real 1 hp enemies share each movement record;
- compact tables store reservations, dormant hp, slow and stasis expiry, recall due tick, recall cooldown and recorded position, and status marker;
- removal swaps the final active record into the gap;
- capacity doubles when needed and never acts as a gameplay cap.

the 64-unit combat grid powers targeting, explosion queries, laser lines, swept projectile collision, local retargeting, and the `densest group` targeting mode. a separate 24-unit crowd grid accumulates unit-weighted population and momentum into packed typed arrays. each fixed tick applies a compact blur, derives a pressure gradient, and lets movement records bilinearly sample pressure plus neighboring momentum. this creates approximate collision, viscosity, and broad density-driven motion in `o(records + cells)` without pairwise checks.

production begins with one unit per movement record. at 20,000 records, new 1 hp spawns pack in deterministic groups of two, then three at 22,500 records and four at 24,000. at the 25,000-record budget, new units merge into the least-loaded nearby spawn packet while the real unit population, spawn total, lives, kills, and economy remain uncapped. dormant multi-hp test enemies never compress. the budget therefore caps cpu movement work, not horde size or consequences. packet membership is authoritative, included in checksums and corrections, and reproduced identically by peers.

there is no global shortest-path field and no fixed route for a spawn. open-space steering combines a distributed deterministic approach around the base perimeter, shared crowd momentum, pressure, and low-frequency seeded curl. nebula areas have a static spatial index, so an enemy checks only nearby obstacles instead of every defense area. near a nebula, its single organic harmonic field supplies the outward gradient. the contours are star-shaped, including their shallow edge bites, so they can look irregular without creating enclosed pockets that trap the flow. on first contact an enemy chooses the tangent with the strongest downstream progress, uses position and a seeded tie-break only when both routes are equivalent, remembers that choice while skirting the same nebula, and releases it once clear. exact field-gradient projection honors that same temporary route and remains the hard exclusion boundary. the same seed, ids, tick, packed iteration order, route memory, and field reductions reproduce the motion on another peer. there is no pairwise collision or per-enemy scene object.

the earlier raw-record diagnostic reached approximately 21.99 ms/tick at 100,000 movement records before rendering and tower combat, which is why pretending the cpu path scaled forever was bullshit. the packet budget keeps movement near the user-observed playable range while preserving an uncapped gameplay population. current packet performance is exposed through separate real-unit and simulation-record diagnostics and remains a manual device-level playtest boundary.

## attacks and effects

`tower-catalog.js` is data, not tower-specific combat code. an attack snapshot contains cadence, volley, delivery, geometry, maximum victims, effects, triggers, source tower, owner, reward, and creation tick.

`effect-system.js` plans impacts before mutating the swarm, preventing simultaneous 1 hp shots from wasting themselves after all units in a packet are already claimed. ordinary hits consume one represented unit. geometry marked packet-wide consumes every represented unit it intersects, so rocket and laser kill counts, credits, forge milestones, on-kill ordinals, and breach consequences remain unit-exact even though movement is compressed. it also resolves status, scheduled position recall, radial, directional, slow, vortex, centerline-pinch, and passable force-wall fields, plus queued on-kill triggers. trigger ids, lineage, a depth limit, and a per-tick event limit prevent infinite cascades.

projectiles reserve targets only for aim assistance. every tick uses a swept segment against the current packed enemy grid; physical contact chooses the victim. if a reservation disappears, a deterministic nearby grid search finds another. formation volleys sort reserved targets across the muzzle axis and use one immutable launch vector for their first 0.14 seconds; they do not steer as a group. after that readable ballistic launch, every projectile homes independently. an orphan with no unreserved target continues ballistically and expires after its bounded flight budget instead of stopping indefinitely in space. a projectile may carry a bounded authoritative contact budget, allowing flechette needles to continue through three physical victims without becoming a fake line attack. hitscan resolves geometry immediately; persistent delivery owns a timed authority field.

barrage exercises four separately lethal projectiles with parallel launch and independent terminal homing. its grandchildren stress wider launch formations, bounded physical piercing, and high-cadence adaptive target turnover. rocket exercises unlimited circle geometry after physical projectile contact. its optional strike point is stored on the tower; `strike-pattern.js` derives the exact impact coordinates from tower position, effective range, volley count, and catalogued spacing on both authority and renderer. manual rockets ignore swept enemy collision and resolve their geometry at those immutable coordinates. cluster schedules six delayed one-shot authority fields with pseudo-random scatter derived entirely from stable tower, tick, and field identifiers, while salvo uses the chosen point as the center of its three-impact line. laser exercises unlimited line geometry through an immediate hitscan; prism plans multiple lines against one shared pending-kill set, while sweeper advances a line angle on fixed ticks inside one timed authority field. all victims are resolved by the authority and attributed to the source tower before presentation events are emitted; presentation never chooses destinations or decides a kill.

anchor, knot, and backwash still exercise attack-triggered status and transient force fields. their nine finished descendants are instead pure control installations with no attack record. `control-system.js` validates and normalizes generic point, line, direction, and tower-centred geometry, supplies deterministic defaults, enforces tower range and line length, derives one authoritative field per tower, and applies the shared one-second reboot after edits.

stasis uses a globally phased periodic status zone; recall performs generation-safe segment crossing against a drawn gate and stores a per-enemy rewind point plus cooldown; dragnet is a persistent strongest-only slow. singularity is a periodic radial pull, orbit a tower-centred vortex, and braid a drawn rectangular centreline squeeze. breaker derives a travelling upstream wavefront, crosswind uses an owner-authored normalized direction, and breakwater uses a drawn line band with a separate upstream push vector. active fields are indexed into the same 64-unit combat grid, so an enemy checks only geometry touching its current cell rather than scanning every control tower. for each pure field kind, an enemy accepts only the strongest overlapping contribution; different forms still combine. field hits mutate per-tower control counters, and field state renders directly from authoritative ticks rather than client-time particles.

network support is also catalog data. relay targets are owner-issued versioned commands: the authority verifies ownership, excludes the source area, checks the selected organic area against the relay's 360-unit expanded field, and stores the target on the tower. it then derives a deterministic defense-area graph from every valid relay edge and applies modifiers across each connected component. the choice survives saves, replays, corrections, and p2p command replication. diminishing modifier groups apply the full value from the deterministic first source and a separately declared marginal value from every later source: network range is 10 percent plus 1 percent per extra network, while overclock cadence is 15 percent plus 1 percent per extra overclock. children remain topology nodes but do not inherit network range.

forge groups use one saved point counter per connected network. every linked kill contributes 10 points for the first forge plus 1 for each extra forge; every 80 points pays one credit through the ordinary co-op income distributor. this prevents placement-order or sell-order exploits while exactly preserving the approved long-run diminishing rates. protocol-v7 forge remainders migrate from old eight-kill units into equivalent ten-point units.

## maps

`world-config.js` owns a map catalog. each immutable definition contains world bounds, safe camera bounds, initial camera, base, handcrafted defense areas, spawn sources, source unlock times, menu metadata, and elapsed-time spawn curve. the same center, rotated radii, harmonic amplitudes, and shallow bite direction drive enemy exclusion, tower placement, and world rendering; menu thumbnails use the same center and radii as a deliberately tiny summary.

the catalog currently contains three production layouts: 47 mixed clustered areas, 50 small scattered areas, and 30 large continental areas. map ids are carried by host-validated start and restart commands. changing map rebinds the authority's immutable geometry, spatial obstacle index, network-area graph, base, and packed swarm as one fresh-run operation. corrections may restore any catalogued production map, including compatible protocol-v2 through protocol-v12 saves, before applying packed swarm state.

spawn sources are authored regions with horizontal and vertical spread, not single-pixel emitters. every production map exposes 32 irregular perimeter regions at a fixed one-per-minute cadence, but uses a different deterministic unlock order. the seeded authority samples among active regions instead of round-robin striping, so broad fronts fluctuate naturally while every peer still reproduces the same source choices and positions.

the opening camera focuses on the playable interior, and production pan plus resize-aware integer zoom use authored camera-safe bounds inside the larger simulation bounds. maximum zoom fits that entire safe area while perimeter spawn regions remain outside the view. the camera remains snapped to logical pixels at every scale.

nebulae do not run a fifty-area loop inside every fullscreen fragment. the renderer uploads one static 20-float instance per area—bounds plus one organic-field description—and draws every visible nebula in one instanced hard-edged pass. a fragment evaluates only its instance's rotated harmonic contour. cpu collision uses the same equation and parameters. this removes stacked-circle seams while scaling map count without multiplying fullscreen shader work.

## renderer

`main.js` owns one webgl2 canvas for the complete world and hud. its backing resolution is recalculated from the available window using an integer 1× or 2× display-pixel scale. the camera and projected geometry are rounded to logical pixels.

rendering uses:

1. one procedural hard-pixel background pass for black space and stars, followed by one instanced hard-edged nebula pass;
2. one gpu point draw for the complete movement-record prefix, with each point presenting one red square or a hard multi-square packet cluster plus a hard center status pixel;
3. batched triangle geometry for towers, projectiles, impacts, ranges, base, cursor, and hud;
4. batched bitmap-atlas glyph quads for all lowercase text.

tower interaction panels, the wip main menu, the authoritative elapsed timer, rolling player gold-per-second telemetry, the paged `b` tower catalog, the test field's `u` form catalog, and the escape/options menus are drawn into those same shape and glyph batches. they are pixel interfaces, not dom overlays; contextual number-key shortcuts call the same panel actions, while start, restart, placement, upgrade, relay selection, and sell remain authority-validated commands. a successful replacement keeps the same selected tower and leaves the replacement panel open when the new form has children. one-shot placement disarms after one command and may locally auto-select the accepted frame; catalog placement stays armed without selecting accepted towers. the host derives each direct build's complete path and accumulated price from the catalog, so clients cannot claim a cheaper finished form. local menu and auto-select state never enter authoritative or multiplayer state. lifetime kills are stored on the authoritative tower record, survive form replacement and ownership transfer, and travel in ordinary correction snapshots. opening escape or returning to the main menu never stops an already-entered run.

production maps separate simulation bounds from authored camera-safe bounds. zoom levels and camera clamping use the safe bounds, preventing the player from exposing perimeter spawn rifts while leaving the larger deterministic simulation space intact.

enemy gpu buffers grow geometrically with swarm-record capacity. position, status, and packet-unit tables upload once per authority frame; there is still one enemy draw, never one draw or scene node per unit. webgl requests `antialias: false`, disables dither and multisampling paths, uses nearest texture filtering, and surfaces initialization, shader, context-loss, and periodic gpu errors in a visible red panel.

## multiplayer consistency and recovery

the browser beta uses host-scheduled p2p command replication with deterministic local simulation and correction:

- all peers receive the same ordered commands and simulate the same seed at 60 hz; the host schedules player commands twelve ticks ahead and binds each request to its authenticated peer identity;
- deterministic simulation reproduces ids, physical victims, kills, status, economy, breaches, and ownership; host corrections arbitrate any divergence;
- a checksum covers positions, velocities, ids, generations, packet unit counts, real population, hp, reservations, controls, rng, spawn state, and free-id order;
- mismatch recovery applies a full correction snapshot containing authority counters, pending accepted commands, payout cursor, player/tower/combat state, network support progress, and every required packed swarm table;
- guests advance a continuously estimated host clock with a three-tick presentation delay; they do not freeze between the 250 ms sync messages;
- rendering may lag the host by network delay plus a few ticks, but authoritative membership and outcomes reconcile to the host.

`p2p-transport.js` adapts the working framebound socket.io signaling client and webrtc coordinator. it reuses `https://framebound-signaling.onrender.com`, six-character room codes, host keepalive, and one-host/three-guest topology. the public service carries signaling only. ordered reliable webrtc data channels carry gameplay; google and cloudflare stun services assist direct connectivity. peer negotiation, timeouts, errors, and reconnect attempts are visible in the bitmap lobby.

`p2p-wire.js` packs typed arrays as binary buffers, frames corrections in bounded 16 kib chunks, and rejects invalid versions, lengths, and packet overlap. `p2p-session.js` connects that transport to the existing authority/client interface. guests cannot submit enemy positions or kills; their requests become host-canonical commands. host-only operations and tower ownership remain authority-validated. reconnect identity uses a private per-player resume token stored in the tab's session storage. a guest holds its replica while applying a requested correction or when host sync messages stop, and reports that state in the pixel hud.

the beta implements roster locking, guest reconnect holds, spectator return, and investment-balanced inheritance. the authority has host-succession data structures, but network host migration is not wired; closing the host ends the room. turn fallback and multiplayer restart voting are also deferred. multi-machine visual and network acceptance remain the user's manual check.

vite bundles the browser source and socket.io client into static hashed assets. github pages deploys `dist` through a pinned-action workflow after syntax and production-build checks. solo persistence never stores a multiplayer authority snapshot.

## saves, replays, and test field

accepted commands are retained as a deterministic replay log. correction snapshots are structured-clone-safe and include typed arrays. the browser stores solo snapshots plus the command log in indexeddb every 15 seconds and on page exit; incompatible protocol or unknown-map snapshots fail visibly in diagnostics instead of being silently applied. compatible older snapshots first rebind the authority to their saved map and current tower catalog, so newly approved branches and map-aware restores do not discard the run.

the production authority begins in a lobby phase while its indexeddb correction is checked, so the title screen cannot spawn enemies before the player starts or continues. once entered, the run keeps advancing behind escape, the main menu, the map selector, and the test field. restart is an ordinary authority command with an authoritative map id; it clears run-owned towers, swarm, combat fields, counters, lives, and economy without rebuilding the renderer.

the test field is a second local authority using the exact production systems and two defense areas so relay topology is observable. the real solo authority continues advancing while the test field is visible after gameplay has begun. tester-only commands configure spawns, move towers, switch among all 31 implemented forms without cost/path locks, pause, step, and clear counters. tester hp does not change production enemy rules.

## verification boundary

allowed automated diagnostics are syntax/compiler checks, production builds, deterministic simulation comparisons, correction continuation, gpu error reporting, and performance counters. there are no automated gameplay tests. visual and gameplay acceptance belong to the player's browser playtest.
