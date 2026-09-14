# framebound // horde

pixel-rendered space tower-defense survival. one base, an uncapped red horde, live building, and branching tower replacements.

[play the browser beta](https://verumrexo.github.io/framebound-horde/)

## play together

1. open the same beta link in chrome on both computers.
2. the host chooses `host coop` and shares the six-character room code.
3. the other player chooses `join code`, types or pastes it, and presses enter.
4. once at least two pilots are linked, the host chooses a map and deploys.

the room supports one host and up to three guests. everyone sees the same swarm and base; wallets are individual, and kill income is divided among connected pilots. each player controls only their own towers. relay networks work across the team.

keep the host's game open and active. this beta uses the existing framebound signaling service at `https://framebound-signaling.onrender.com`; only connection metadata goes through that service. commands and correction snapshots use a direct encrypted webrtc data channel. the relay may take a little while to wake.

## beta boundaries

- new players cannot join after deployment. an original guest can reconnect using the same browser tab and room code.
- a dropped guest holds the run for up to 90 seconds. the host may continue early; the departed player's towers are redistributed by total investment and their wallet is split.
- host migration is not connected in this beta. closing the host ends the peer session. the client accepts short-lived TURN credentials from the signaling service when that service is configured with a relay; see [turn relay setup](docs/turn-relay.md).
- multiplayer restart voting is not implemented; start another room for a fresh co-op run.
- solo autosaves and the local test field stay separate from co-op.

## controls

- `1`: place one frame. click a tower, then `1` for replacements or `2` to sell.
- replacement menu `1 / 2 / 3`: choose a branch.
- `b`: catalog for repeated placement of already-upgraded forms.
- `q / e`: targeting. `a`: rocket strike point, laser direction, broadside fan facing, or editable control geometry. `0`: back to automatic.
- `g`: all ranges. `k`: kills-per-second. `t`: solo test field.
- `o` on the main menu, or `gameplay options` in the pause menu: master / music / sfx volume sliders, saved on this browser.
- `f2`: dev tools. `f3`: part lab (per-form pixel art overrides and the sound lab).
- drag: pan. wheel: integer pixel zoom. `esc`: menu; it does not pause a running game.
- map selection `[ / ]`: horde pace x0.6–x1.6, a time stretch on the spawn curve, rift unlocks and surges.

## local build

```sh
npm ci
npm run check
npm run build
npm run serve
```

the preview is served at `http://127.0.0.1:4173/`. `npm run dev` starts the development server at the same address. use the server link, not a `file://` page.

`npm run dev` also serves the part lab's promotion endpoint: `save all` inside the lab writes `public/part-lab/pack.json` (art overrides, saved sounds, hook bindings), which ships with the next build. production builds download the pack instead.

github pages publishes the production build from `main`. no automated gameplay tests are created or run; the player owns browser and gameplay acceptance. runtime/gpu failures and peer state are exposed through the visible error panel and `window.__hordeDiagnostics`.

## design and architecture

- [product specification](docs/product-spec.md)
- [technical architecture](docs/architecture.md)
- [deferred network grandchildren](docs/network-grandchildren-todo.md)
