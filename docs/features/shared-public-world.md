# Shared public-world combat, lighthouse and skiff

The automatic public connection previously shared presence and chat only. This change opts new screens into `sharedWorld: 1` shards with one elected combat authority. Existing code rooms retain their current shared simulation.

Public shards share monster HP/death/respawn, boss state, lighthouse illumination and weather, the two-seat skiff's position, heading, velocity, reservations and shore exits. Guests send attacks and lighthouse/boat requests to the elected host. Checkpoints arrive at 10 Hz, support late arrivals and retain state when the host leaves. No second damage simulation runs on followers.

Public portal travel stays personal: a traveler leaves the old area and joins a shard in the destination area. Cross-area checkpoints and room-only travel/PvP/party commands are rejected by the relay. Public rooms use co-op rules. Personal quest logs and ending-view flags are not copied; already earned crowns are retained, and the defeated shared boss's crown allows late arrivals to use the unlocked route. This avoids stranding them behind a boss that is already dead.

The server negotiates the capability in `welcome`. Legacy presence-only screens are isolated in their original shard pool; a new screen on an old server falls back to presence-only mode. On transport loss, the public client releases its shared simulation before retrying. Private rooms and their version checks remain compatible.

## Repeatable bosses and coins

All five bosses expose “Challenge again” after their defeat animation ends. Rematches restore full HP, phase one, fresh mechanics, adds and the freed companion animation. Level, chapter, story and lighthouse requirements still apply. Existing first-victory XP, crowns and ending flags remain one-time progress.

Each actual defeat awards every connected player coins once: level 3 → 150; level 10 → 500; level 20 → 1,200; level 100 → 5,000; level 300 → 15,000. Rewards are shown on boss cards and saved immediately. A per-encounter claim prevents duplicate death events from awarding extra coins; a new local wake or authoritative rematch resets the claim. Late arrival at an already cleared boss grants no coins.

## Rollout

Merge and deploy server PR #39 first. Then retarget the game PR to `dev` and merge/deploy it. No database migration or new service is needed.

## Validation

- `pnpm build`: passed for both server-only and complete changes; existing large-bundle warning remains.
- `pnpm test:boss`: 101 passed, including three consecutive defeats for all five bosses, increasing coin rewards and duplicate reward rejection, plus including shared HP, lighthouse, boat checkpoint/authority transfer, personal quest isolation and late shared-boss crowns.
- `pnpm test:engine`: 4 passed.
- `pnpm test:multiplayer`: 44 passed, including legacy shards, opt-in checkpoints/requests, host transfer, per-area isolation and rejected forged commands.
- `pnpm test:server`: 16 passed.
- `node tools/qa-shared-world.mjs`: two real Chrome players in both public shards and code rooms. Host and guest attacks share exact monster HP; native hold-F toggles the lighthouse on/off/on with matching night/morning; native F boards two players and W moves the shared boat. A third late arrival receives lighthouse/boat state, the passenger takes over after the host departs, and public portal travel affects only the traveler. No browser execution errors.

- `node tools/qa-boss-rematch.mjs`: two real Chrome players; a guest uses the real rematch button twice, both screens restore full boss HP, defeat fixtures award exactly 150 coins per player each time, and coins survive reload. The fixture accelerates the kill rather than claiming a full manual boss fight. No browser execution errors.

The first local build ran out of storage. Only generated output was removed; the subsequent full build passed after space became available. No production deployment is implied by these local checks.
