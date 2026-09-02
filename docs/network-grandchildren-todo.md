# network grandchildren — deferred design

status: saved for a later milestone. none of these forms are implemented yet.

the three relay forms are approved. the six overclock and forge forms remain recommendations until the player explicitly locks them.

## overclock replacements

- `redline`: every ten seconds, connected weapon towers immediately fire one bonus volley. additional redlines add one percent pulse frequency each. redline does not inherit overclock's permanent fire-rate passive.
- `metronome`: timed tower mechanics recharge 25 percent faster. additional metronomes add one percent each.
- `aperture`: explosions, beams, chains, and fields gain ten percent size. additional apertures add one percent each.

## forge replacements

- `mint`: connected kills generate 20 percent more credits. additional mints add one percent each.
- `salvage`: connected towers sell for 65 percent of actual investment. additional salvages recover one percent of the remaining gap toward a 100 percent refund, so copies always help but can never create a buy-and-sell profit loop.
- `foundry`: future placements and replacements cost 12 percent less. additional foundries reduce the remaining price by one percent, so stacking never creates negative prices.

## approved relay replacements

- `amplifier`: every numerical network bonus received by the amplifier's own nebula is multiplied by 1.5. amplifiers do not stack and never amplify themselves or discrete mechanics.
- `echo`: the player selects any assault-family weapon available through the connected network. echo fires that complete weapon from its own position using its own cadence and local targeting. it cannot copy support towers or another echo, and a disconnected or sold source removes that weapon from its choices.
- `hardpoint`: creates one nonblocking build socket anywhere along its direct relay line. the socket holds exactly one separately purchased tower. the hosted tower upgrades and sells normally. the relay target and hardpoint cannot be removed while the socket is occupied.

## shared rules

- every form completely replaces its parent and does not inherit the parent's passive.
- first copies provide the meaningful identity; repeated percentage sources add only one percentage point unless a form states a mathematically bounded rule.
- relay replacements retain exactly one direct bidirectional link because their mechanics require it.
- these are infrastructure forms and do not receive placeholder bullets merely to pretend every tower shoots.
