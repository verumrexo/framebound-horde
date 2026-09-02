# p2p beta handoff

## connected

- the existing framebound signaling service is reused without changing that project or its deployment.
- main-menu host/join flow, six-character codes, map selection, and a four-pilot roster render in the existing pixel surface.
- one host schedules commands; guest replicas use the same simulation, ids, outcomes, and correction format.
- guest disconnects hold the run for up to 90 seconds, allow earlier host continuation, and retain investment-balanced inheritance. simultaneous departures are handled in deterministic order.
- reconnect credentials stay in the guest tab's session storage. solo snapshots stay local and separate.

## checks performed

- syntax checks and a production build passed.
- the existing service's health, room creation, guest join, and signal relay diagnostic passed against `https://framebound-signaling.onrender.com`.
- an in-memory transport diagnostic introduced four frames of delay each way, continued through a packed correction, disconnected and rejoined the guest, and compared both simulations at the same authority tick.
- at tick 1091 both sides had 13,864 active enemies, 2,499 kills, 11 fired attacks, two towers, equal wallets, and checksum `04ded120`. the guest presentation was six ticks behind before tick alignment.

this does not prove real-world webrtc connectivity, browser visuals, or gameplay feel. those checks are deliberately left to the player.

## known beta limits

- host migration is not wired to the network transport; the host must stay open and active.
- stun-assisted direct connectivity has no turn fallback yet, so some network combinations can fail.
- no multiplayer restart vote yet; create a fresh room after a run.
- the deferred network grandchildren are not part of this release.

## manual check

host on one computer, join from the other with the same beta link, and deploy after both pilots appear. place and replace towers from both computers, compare kills/lives, then briefly disconnect and rejoin the guest. the host should see the reconnect hold and regain the same guest identity without duplicate towers or money.
