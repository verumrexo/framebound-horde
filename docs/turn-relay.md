# turn relay for mobile-hotspot co-op

the browser client accepts `iceServers` from the signaling server's successful
`host` and `join` responses. that lets the backend issue short-lived turn
credentials without exposing a permanent relay password in github pages.

response shape:

```json
{
  "code": "ABC123",
  "hostId": "...",
  "iceServers": [
    { "urls": ["stun:turn.example.com:3478"] },
    {
      "urls": ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
      "username": "1737000000:room-ABC123",
      "credential": "generated-on-the-server",
      "credentialType": "password"
    }
  ]
}
```

issue the username and credential on the signaling server using coturn's
shared-secret REST authentication. do not place `static-auth-secret`, a
long-lived username, or a password in this repository or any Vite variable.

## relay host requirements

- a small public-ip VPS; a laptop or a phone hotspot is not a reliable relay.
- inbound UDP and TCP `3478`, plus an inbound UDP relay range such as
  `49160-49200`.
- coturn with `use-auth-secret` and the same `static-auth-secret` held only by
  coturn and the signaling backend.

minimal coturn settings:

```ini
fingerprint
use-auth-secret
static-auth-secret=replace-with-a-long-random-secret
realm=framebound-horde
listening-port=3478
min-port=49160
max-port=49200
no-cli
no-multicast-peers
```

the signaling service must generate an expiry-prefixed username and its HMAC
credential from that shared secret for each successful host/join request, then
include the `iceServers` array above in its acknowledgement. after deployment,
both mobile-hotspot players should receive relay candidates and connect even
when direct UDP hole punching fails.

## no-vps temporary fallback

`host-relay.command` runs a one-guest relay on the host mac. it serves the
current production build and accepts a Cloudflare quick tunnel, which works
over an outgoing phone-hotspot connection. install `cloudflared` first, then
double-click `host-relay.command`. copy the printed `https://...trycloudflare.com`
address, append `?relay=1`, and send that whole link to the guest. this is a
temporary game relay, not a permanent public server; closing the terminal ends
the session.
