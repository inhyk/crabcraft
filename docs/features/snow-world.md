# Frostlight and healing blink

World IV is an optional post-Solarkan realm. Defeating the level 100 king opens the east gateway in Dawnharbor (14, 84). The return gateway leads back to World III; neither route changes XP or grants levels.

Frostlight includes six snow-covered timber homes, warm windows and lanterns, a frozen fountain, instanced layered evergreen trees, paved ascent, GPU snowfall and aurora, two bilingual village quests, scaling patrol enemies and a flat ice arena. It uses the existing shared musical score.

Boreas requires **each participating character to be level 300**. His 620,000 HP encounter starts with Frost Prison, then alternates breath, pull, seven-circle blizzard, glacial burst, six-ray lanes and slam across three phases. Warning geometry is shared with host damage checks. Low-level companions cannot start the encounter, hit the boss, apply crowd control, or be hit by it. The Frozen Crown and chapter IV survive reload, account-save payloads, late joins and host transfer. The existing dance ending stays available.

Mage slot 3, Steam Blink, now restores a flat **10 HP**, capped at maximum HP, and teleports up to 8 m forward using the existing collision and slope checks. Its 15-second cooldown and 10-mana cost remain. Repeated keys and action-bar clicks cannot repeat its heal during recovery.

## Deployment order

Merge and deploy the backward-compatible snow protocol server PR first. It accepts existing three/four-boss snapshots plus chapter IV/five-boss snapshots, supports area IV public presence, and isolates private room capabilities with `snowWorld: true`. A saved empty room retains its version requirement; mixed screens receive a refresh instruction. Old rooms reject new chapter/boss events. Then merge the game PR. No migrations or new services are required.

## Validation

- `pnpm build`
- `pnpm test:boss`: 95 passed (300 gate, low-level damage/condition denial, seven-circle layout, host transfer and healing blink recovery included).
- `pnpm test:engine`: 4 passed.
- `pnpm test:multiplayer`: 42 passed (legacy packets and mixed-version retained rooms included).
- `pnpm test:server`: 16 passed.
- `node tools/qa-snow300.mjs`: actual key 3, HP +10, repeat denial, story gate, XP-preserving travel, level 299/300 challenge UI, save/reload and victory; zero browser errors.
- `node tools/qa-snow300-online.mjs`: two actual Chrome pages, level 299 host / level 300 guest, native room and challenge buttons, phase III, matching seven-circle coordinates/HP, accepted/rejected damage; zero browser errors.

Browser QA changes only its own disposable character saves and uses explicit XP/story fixtures to reach endgame. Production deployment has not been claimed by these local checks.
