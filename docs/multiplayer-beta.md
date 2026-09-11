# p2p beta handoff

## connected

- the existing framebound signaling service is reused without changing that project or its deployment.
- main-menu host/join flow, six-character codes, map selection, and a four-pilot roster render in the existing pixel surface.
- one host schedules commands; guest replicas use the same simulation, ids, outcomes, and correction format.
- guest disconnects never hold the run. authenticated seats remain reconnectable for 90 seconds, while their towers stay active and editable by the team.
- reconnect credentials stay in the guest tab's session storage. solo snapshots stay local and separate.

## tether rework / protocol 14

the local tether rework adds bond pairs, one-use recalls and shared breaker hit cycles to peer corrections and checksums. old solo orbit towers migrate to bond. peer handshakes require matching versions; both players must use the same build. syntax, catalog validation and production build checks passed for the rework; gameplay, reconnect behaviour with these new effects, and visual acceptance remain player-side. the rework has not been pushed to github pages.

## original protocol-13 beta checks

- syntax checks and a production build passed.
- the existing service's health, room creation, guest join, and signal relay diagnostic passed against `https://framebound-signaling.onrender.com`.
- an in-memory transport diagnostic introduced four frames of delay each way, continued through a packed correction, disconnected and rejoined the guest, and compared both simulations at the same authority tick.
- in the historical protocol 13 diagnostic, at tick 1091 both sides had 13,864 active enemies, 2,499 kills, 11 fired attacks, two towers, matching individual wallets, and checksum `04ded120`. the guest presentation was six ticks behind before tick alignment.

this does not prove real-world webrtc connectivity, browser visuals, or gameplay feel. those checks are deliberately left to the player.

## known beta limits

- host migration is not wired to the network transport; the host must stay open and active.
- stun-assisted direct connectivity has no turn fallback yet, so some network combinations can fail.
- no host migration or multiplayer restart vote; create a fresh room after a run, and host loss ends the current room.
- protocol 23 uses one fixed shared team pool, team-wide tower controls, compact roster/contribution ui, bounded chat, pings and throttled live presence.
- all nine network grandchildren are implemented under protocol 15; live multiplayer and visual acceptance of those forms remain pending.

## manual check

host on one computer, join from the other with the same beta link, and deploy after both pilots appear. place and replace towers from both computers, compare kills/lives, then briefly disconnect and rejoin the guest. the host should keep the run moving, mark that pilot reconnecting, and restore the same guest identity without duplicate towers or money.

## arsenal and reactor / protocol 17

this supersedes earlier salvage/foundry descriptions: salvage migrates to reactor and foundry to arsenal. arsenal offers 39 unique global research nodes in a 3/9/27 tree, with one path per station and free traversal of owned ancestors. tiers cost 10 million, 100 million and 1 billion. reactor offers 12 globally priced rank categories. research survives station sale and never contributes to its refund. purchases use the shared team pool; benefits are shared. see [the approved station design](arsenal-reactor-proposal.md) for effects and caps. fractional damage pays accumulated whole hp, without overkill rewards; secondary attacks cannot recursively trigger research. automated checks cover authority behavior; manual gameplay and multiplayer acceptance remain pending.
