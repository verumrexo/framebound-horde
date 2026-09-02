# practical kps baseline

this is the historical protocol-10 balance snapshot captured on 2026-08-25 before the assault-family balance pass and parallel-launch/homing movement. it is retained as before-state evidence, not an approved balance target. current assault-family results live in `balance-assault.md`.

scenario: test field tower at `0,238`, centered top spawn, closest targeting, 1 hp enemies, invincible base, one deterministic run. timing is `15s warmup + 15s settle + 30s measured` at `10/s`, and `15s + 4s + 12s` at denser rates.

| tower | cost | 10/s | 100/s | 1,000/s | 10,000/s |
| --- | ---: | ---: | ---: | ---: | ---: |
| frame | 100 | 5.47 | 5.50 | 5.50 | 5.50 |
| assault | 300 | 8.93 | 11.00 | 11.00 | 11.00 |
| barrage | 700 | 9.03 | 22.00 | 22.00 | 22.00 |
| broadside | 1,500 | 9.10 | 40.00 | 40.00 | 40.00 |
| flechette | 1,500 | 9.77 | 45.00 | 45.00 | 45.00 |
| cyclone | 1,500 | 9.00 | 30.00 | 30.00 | 30.00 |
| rocket | 700 | 8.63 | 75.42 | 493.8 | 5,563 |
| warhead | 1,500 | 8.37 | 80.75 | 567.5 | 6,037 |
| cluster | 1,500 | 8.57 | 75.67 | 523.4 | 5,461 |
| salvo | 1,500 | 9.73 | 81.83 | 512.8 | 5,749 |
| laser | 700 | 6.50 | 52.08 | 369.7 | 3,788 |
| cutter | 1,500 | 8.80 | 75.50 | 602.2 | 6,024 |
| prism | 1,500 | 8.67 | 69.33 | 511.8 | 5,479 |
| sweeper | 1,500 | 9.67 | 97.50 | 737.2 | 7,681 |
| tether | 300 | 5.47 | 5.50 | 5.50 | 5.50 |
| anchor | 700 | 5.47 | 5.50 | 5.50 | 5.50 |
| knot | 700 | 5.47 | 5.50 | 5.50 | 5.50 |
| backwash | 700 | 5.47 | 5.50 | 5.50 | 5.50 |
| network | 300 | 5.47 | 5.50 | 5.50 | 5.50 |
| overclock | 700 | 6.67 | 6.67 | 6.67 | 6.67 |
| forge | 700 | 5.47 | 5.50 | 5.50 | 5.50 |
| relay | 700 | 5.47 | 5.50 | 5.50 | 5.50 |

standalone kps does not measure support value. network, overclock, forge, and relay require a separate multi-tower support benchmark before their overall balance can be judged.
