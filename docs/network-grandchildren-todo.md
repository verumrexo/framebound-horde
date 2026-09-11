# network grandchildren

status: implemented, awaiting player gameplay and visual acceptance. all nine cost 800 credits and are available through replacement menus and the network iii catalog page.

all nine forms and the follow-up edge-case rules were approved for implementation.

## overclock replacements

- `redline`: every ten seconds, connected weapon towers immediately fire one bonus volley. additional redlines add one percent pulse frequency each. redline does not inherit overclock's permanent fire-rate passive.
- `metronome`: stasis, singularity, bond, and breaker recharge 25 percent faster on shared authority rhythms. additional metronomes add one percentage point each. active duration is unchanged; the period never falls below twice the active duration, preserving downtime even at extreme stacking. static gates, slows and steering are unchanged.
- `aperture`: blast radii (including cluster follow-ups), beam widths, and control radii/widths gain ten percent size. additional apertures add one percentage point each. weapon range, gate length, travel distance, and scatter spacing are unchanged.

## forge replacements

- `mint`: connected ordinary kill rewards generate 20 percent more credits. additional mints add one percentage point each. fractional hundredths are saved per earning nebula. forge payouts and mint bonuses never generate additional mint income.
- `salvage`: connected towers sell for 65 percent of actual investment. additional salvages recover one percent of the remaining gap toward a 100 percent refund, so copies always help but can never create a buy-and-sell profit loop.
- `foundry`: future placements and replacements cost 12 percent less. additional foundries reduce the remaining price by one percent, so stacking never creates negative prices.

## approved relay replacements

- `amplifier`: range, cadence, control recharge and coverage bonuses received by its own nebula are multiplied by 1.5. amplifiers do not stack or amplify economy, redline volleys, or discrete mechanics.
- `echo`: the player selects any assault-family weapon available through the connected network. echo fires that complete weapon from its own position using its own cadence and local targeting. it cannot copy support towers or another echo, and a disconnected or sold source removes that weapon from its choices.
- `hardpoint`: creates one nonblocking build socket anywhere along its direct relay line. the socket holds exactly one separately purchased tower. the hosted tower upgrades and sells normally. the relay target and hardpoint cannot be removed while the socket is occupied.

## shared rules

- every form completely replaces its parent and does not inherit the parent's passive.
- first copies provide the meaningful identity; repeated percentage sources add only one percentage point unless a form states a mathematically bounded rule.
- relay replacements retain exactly one direct bidirectional link because their mechanics require it.
- these are infrastructure forms and do not receive placeholder bullets merely to pretend every tower shoots.

## controls and integrity

- relay now offers upgrades on 1 and link selection on 3. descendants retain their link button. echo also offers a source-selection button; click a connected assault-family tower. copied rocket weapons have local aim/auto controls. source upgrades change the copied weapon; selling or disconnecting it disables the echo weapon.
- hardpoint offers a socket-position button. click along its relay line; the click projects onto the segment. build within ten world units of the socket to snap the purchase onto it. it belongs to the source nebula for buffs and prices. occupied sockets block sale, relinking, repositioning and test-form changes of the host; hosted towers cannot become hardpoints.
- foundry prices are calculated before purchase from the destination's current network. refunds use actual paid investment. the placement preview and upgrade cards show discounted prices.
- redline does not consume or reset ordinary firing charge and cannot recurse. a pulse with no valid target is discarded.
- protocol 15 carries the new commands. protocol 14 solo corrections remain loadable; multiplayer peers must use matching builds.
- `node scripts/test-network-descendants.mjs` checks branch paths, buff scope, geometry, economy, echo, redline, socket constraints and deterministic correction continuation. browser visuals, live multiplayer and balance remain manual acceptance checks.

## arsenal and reactor / protocol 17

this supersedes earlier salvage/foundry descriptions: salvage migrates to reactor and foundry to arsenal. arsenal offers 39 unique global research nodes in a 3/9/27 tree, with one path per station and free traversal of owned ancestors. tiers cost 10 million, 100 million and 1 billion. reactor offers 12 globally priced rank categories. research survives station sale and never contributes to its refund. purchases use the payer wallet; benefits are shared. see [the approved station design](arsenal-reactor-proposal.md) for effects and caps. fractional damage pays accumulated whole hp, without overkill rewards; secondary attacks cannot recursively trigger research. automated checks cover authority behavior; manual gameplay and multiplayer acceptance remain pending.
