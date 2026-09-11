# arsenal and reactor — approved implementation

status: implemented under protocol 17. all 39 arsenal choices and 12 reactor categories are available through their station panels, including the test field. automated authority checks cover purchases, stacking, damage, secondary attacks and correction persistence. gameplay balance and visual acceptance remain player-side.

## replacements and ownership

- salvage becomes reactor. foundry becomes arsenal. mint remains, including its income identity. forge and mint accrue their existing reward effects from hp popped rather than bodies killed.
- each arsenal can follow one 3-tier path. additional arsenals unlock other paths, including all three roots. each research node is purchased once globally per cooperative run from the team pool, and every player benefits. duplicate ancestors are traversed for free but never grant a second bonus.
- two arsenals can split below a shared ancestor. completing all 39 nodes is possible with 27 arsenals, not with duplicate bonus stacking. research survives station sale/disconnection; selling does not refund research or erase unlocks. simultaneous duplicate purchases reject the later command without charging it.
- approved prices per unique node: 10,000,000 at tier 1; 100,000,000 at tier 2; 1,000,000,000 at tier 3. all nodes cost 27.93 billion in total. a single path costs 1.11 billion. these are late-game purchases, not opening buffs.
- research prices are never affected by build discounts. benefits apply to existing and future eligible towers globally. previews list affected weapon families and exact stat changes.

## stacking rules

- arsenal damage percentages add against the reactor-adjusted weapon baseline, rather than multiplying each other. reactor damage ranks are the one explicit long-term multiplicative progression. percentage damage needs fixed-point damage accounting; rounding each 20% purchase up to another full point is forbidden.
- ordinary damage pays exactly one credit per hp actually removed. overkill and fracture/slow status application pay nothing. mint/forge bonuses remain separate.
- any extra attack is marked secondary. secondary attacks cannot create double shots, ricochets, explosions on kill, more secondary attacks, or reload procs. their stated damage is a fraction of primary damage, with no reapplication of research modifiers.
- freeze duration, slowing and displacement remain bounded. no repeated permanent freezes, upstream parking, or stasis chains.
- the values below are initial tuning values, not a claim of playtested balance. stack-safe does not mean weak: enemies already reach about 609 hp at 45 minutes under the preserved exponential budget. reactor damage supplies sustained scaling; arsenal research changes how that damage is delivered.

## tier 1 — 10 million each (3)

| id | choice | effect |
| --- | --- | --- |
| 1 | reinforced ammunition | +20% primary weapon damage |
| 2 | cycling assembly | +15% normal firing cadence |
| 3 | fire-control array | +10% weapon targeting range; does not enlarge blasts or beams |

## tier 2 — 100 million each (9)

| parent | id | choice | effect |
| --- | --- | --- | --- |
| reinforced ammunition | 4 | armor penetration | +30% base damage against enemies above half health; no extra victim count |
| reinforced ammunition | 5 | finishing rounds | +30% base damage against enemies at or below half health; complementary to penetration, not multiplicative |
| reinforced ammunition | 6 | coordinated fire | hits by three distinct towers within one second expose an enemy for one +50% base-damage primary hit; then a cooldown |
| cycling assembly | 7 | reserve magazine | idle weapon towers store one normal firing cycle, released on reacquiring a target |
| cycling assembly | 8 | target handoff | when a projectile loses its target, it can search a wider local area; travel lifetime is never extended |
| cycling assembly | 9 | controlled burst | every fifth normal firing cycle releases one additional primary-shaped attack at 25% damage |
| fire-control array | 10 | close defense | +25% base damage against enemies in the inner third of weapon range |
| fire-control array | 11 | long sight | +25% base damage against enemies in the outer third of weapon range |
| fire-control array | 12 | suppression rounds | primary hits apply a brief 10% slow; strongest slow wins |

## tier 3 — 1 billion each (27)

| parent | id | choice | effect |
| --- | --- | --- | --- |
| armor penetration | 13 | through-shot | a non-explosive physical projectile continues into one additional enemy with 50% damage |
| armor penetration | 14 | shell breaker | every fourth primary hit from the same tower against the same surviving enemy ignores the above-half-health condition for a +100% base-damage bonus |
| armor penetration | 15 | narrow bore | laser beams become 25% narrower but gain +75% base damage; trades coverage for layer removal |
| finishing rounds | 16 | execution order | targeting option prefers the lowest remaining-hp enemy that the next primary hit can kill |
| finishing rounds | 17 | overkill transfer | up to 25% of wasted damage from one primary kill transfers to one nearby enemy; cannot repeat |
| finishing rounds | 18 | final impact | primary kills by physical bullets emit a tiny secondary blast at 20% damage; at most one blast per normal firing cycle |
| coordinated fire | 19 | shared lock | connected towers can share targeting information about exposed enemies, without gaining range or attacks |
| coordinated fire | 20 | prolonged exposure | the exposure mark lasts longer, retaining its one-hit consumption rule |
| coordinated fire | 21 | synchronized strike | exposure instead permits the next three distinct contributing towers to receive +20% base damage each; the original single-hit bonus is replaced |
| reserve magazine | 22 | deep magazine | increases stored normal cycles from one to three |
| reserve magazine | 23 | emergency discharge | stored cycles are released faster when a target enters the base danger zone; does not create ammunition |
| reserve magazine | 24 | charged opening | the first stored attack against a new engagement gains +75% base damage after five idle seconds |
| target handoff | 25 | ricochet | a non-explosive physical projectile that kills its target redirects once with 25% damage; shares its one secondary-contact budget with through-shot |
| target handoff | 26 | predictive aim | automatic rocket impact selection accounts for target velocity and flight time; manual aim remains authoritative |
| target handoff | 27 | anti-overkill routing | targeting distributes reserved damage across enemies before assigning additional attacks to an already-covered target |
| controlled burst | 28 | double shot | the additional attack occurs every second normal cycle instead of every fifth; remains at 25% damage, not a second full-strength volley |
| controlled burst | 29 | split assignment | the additional attack selects a separate enemy group; no extra damage or extra attack count |
| controlled burst | 30 | delayed echo | the additional attack is delayed by 0.6 seconds and gains damage from 25% to 40%, trading immediate defense for efficiency |
| close defense | 31 | point-blank shells | primary rocket hits gain +50% base damage against enemies in the inner quarter of their blast; blast size does not grow |
| close defense | 32 | emergency cycle | towers attacking within the base danger zone receive +15% base cadence; does not stack per enemy |
| close defense | 33 | repulsor strike | every fifth close-range primary hit causes one small outward displacement; shared enemy cooldown prevents pinball |
| long sight | 34 | rangefinder | after tracking the same target for two seconds, gain +50% base damage against it until the target changes |
| long sight | 35 | flight stabilizer | physical projectile speed +40%, improving time-to-impact without changing cadence or damage |
| long sight | 36 | watch perimeter | connected networks reveal high-hp incoming groups and offer highest-hp targeting; no hidden range bonus |
| suppression rounds | 37 | chilling rounds | increases the research slow from 10% to 20%; replaces rather than stacks with the earlier slow |
| suppression rounds | 38 | brittle targets | +20% base damage against enemies currently frozen by a control tower; adds no freezes |
| suppression rounds | 39 | lingering suppression | doubles the duration of the research slow; does not extend stasis, recall, bond or other control effects |

## reactor — repeatable late-game purchases

- first rank: 1 million credits per category. the next rank costs 1.7 times the previous price, rounded up; damage uses 1.5 times so its price grows with its output. rank/pricing is global; placing another reactor never resets the price or repeats a rank.
- station sale does not refund purchases. stat boosts are persistent for the run and affect existing/future towers. no income upgrades: mint already owns that role, and keeping income intact does not require adding another income multiplier.
- these categories deliberately overlap some arsenal numerical benefits. those percentages share additive stat buckets; the arsenal's conditional/mechanical behavior remains separate.

| category | per rank | limit |
| --- | --- | --- |
| damage output | multiply primary damage baseline by 1.5 | no gameplay cap; each next damage rank also costs 1.5 times more |
| weapon cycling | +2% base cadence | +50% from reactor |
| targeting range | +2% base range | +30% from reactor |
| projectile velocity | +5% base speed | +100% from reactor |
| blast coverage | +1% base radius | +15% from reactor |
| beam focus | +1% base beam width | +15% from reactor |
| control recovery | +2% base recharge rate | +30%; existing active/downtime safeguards still apply |
| control coverage | +1% base control size | +15%; no range/line-length expansion |
| construction efficiency | 2% reduction of remaining tower price | maximum 50% discount; excludes all research/reactor prices |
| base reserve | +5 maximum lives and restores up to 5 missing lives | +100 capacity total |
| projectile guidance | +2% homing turn strength | +30%; no projectile lifetime extension |
| field sustain | +2% duration for ordinary slows | +20%; excludes immobilisation and bond |

## implementation and migration

- salvage/foundry are replaced across the catalog, art, UI and save migration. legacy towers migrate in place, preserving investment, owner and identity history. no automatic spending or free ranks.
- the authority validates the authenticated player, station, branch, current price/rank and team balance before purchase. global unlocks, ranks, combat counters and pending attacks travel in corrections. mixed protocol builds cannot join.
- existing additional-copy support bonuses are unchanged in the current build. their removal/cap was discussed but not selected in the latest direction; station pricing must not silently nerf existing mint/forge income.
- damage is quantized to 0.001 hp; fractional credit remainders accumulate until a whole hp is paid. refunds use only the amount paid for the physical tower, never its research spending.

## station controls

select an arsenal or reactor and open its research action. select a choice with the pointer or number keys, inspect its description and price, then buy with the button or enter. tab pages reactor categories; escape returns to tower actions. already-owned ancestors cost zero when traversing another arsenal.

## september 11 pricing and stacking revision

- live arsenal prices are one decimal order above the previous schedule: 100,000 at tier 1, 1,000,000 at tier 2, 10,000,000 at tier 3. all 39 nodes cost 279.3 million; a single root-to-leaf path costs 11.1 million.
- reactor ranks: 10,000 for the first rank of any category, then x1.25 per additional rank of that category (`ceil(10,000 x 1.25^rank)`). categories still price independently; damage no longer uses its own growth factor.
- damage output ranks add +10% of base weapon damage each and never compound: rank n gives `base x (1 + 0.1n)`. that rank-adjusted value is the baseline every arsenal percentage is measured against, so root, conditional and reactor contributions stay a single additive bucket around one baseline. caps and effects of the other eleven categories are unchanged.

## late-game balance revision // protocol 23

this supersedes the damage line of the september 11 revision; the other eleven categories are unchanged.

- damage output ranks multiply base weapon damage by 1.10 and compound: rank n gives `base x 1.10^n`. that compounded value remains the baseline every arsenal percentage is measured against, so root, conditional and reactor contributions stay one additive bucket around one baseline.
- damage output prices `ceil(100,000 x 1.20^rank)`, uncapped. affordable damage therefore grows as roughly `spend^0.52`, strictly slower than the enemy hp budget: the reactor is the line a late-game player rides every few minutes, never a line that wins on its own. cumulative cost: rank 10 ≈ 2.6m, 20 ≈ 18.7m, 30 ≈ 118m, 40 ≈ 734m.
- rationale and the placement escalator that makes ranks competitive with extra sockets are recorded in `balance-late-game.md`.
