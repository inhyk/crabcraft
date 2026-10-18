# Personal ending courtyard

The player watches their server-owned celebration and then uses Skip or Continue. The client owns scenery and display only. Phase timing, cast poses, rewards, network recovery and controls stay unchanged.

Reference: `tmp/server-world-evidence-20261018/world-main-c71/production-create-reconnect.png`, inspected at1280x720. Adopt W1 red tile roofs, timber/stone modules, paving, planted edges, readable warm windows and gold HUD trim. The original1280x800 celebration had a plain tan disk, blue void and cropped front row. The original credits used an unstyled rectangular button and dense centered license copy. No reference interaction was inferred from a still image.

Use existing `models/world/{village,nature,props}.glb`, W1 TownBuilder and Pincer Fountain, actual W1 Terrain splat/cobble/rock material and existing source lamp-post profile and `art/ui/divider-gold.webp`. No new external/generated artwork. Layering: textured open performance court in the foreground, low benches/market/flower edges in the middle, chapel bell tower and timber houses behind, tree silhouettes and mist beyond. Warm stone and terracotta stay subordinate to the cast. Keylight gold, lantern teal. Keep centre clear.

HUD tokens reuse `--font-display` and `--font-body` from `src/ui/kit.css`. Gold `#edcd89`, dark teal `#102b30`, copy `#f6e9c9`. Status13px, caption22-36px, controls15px with48px narrow touch height. Credits width760px maximum, mobile width viewport minus32px; independent scroll region and visible focus. Full original NOTICE text remains available in the scroll region. CSS: `src/multiplayer/endingPresentation.css`.

Camera preserves the server-tick orbit direction, focus and progress. A presentation-only frustum distance guard fits all observed cast bounds with space for letterboxing and HUD. No pose, phase or gameplay positions change. Capture desktop1280x800 and narrow390x844 with the same accepted observation/camera recipe for before/after comparisons. Trusted W4-clear integration fixtures must remain visibly labelled; they do not prove earned story completion.

Verification includes actual Game/PG/binary WS, responsive credits/controls, cast bounds, recovery and disposal. Aesthetic scores are subjective review signals, not a measured world-quality ranking. Design Boost source reviewed2026-10-18, latest source update2026-10-07 02:35KST; W1 design-bar source reviewed2026-10-18. No timing/reward/host changes are part of this slice.

The live integration and controlled before/after renders use the same requested graphics quality per run (`low` by default, explicit `high` run supported). The W1 reference quality is unconfirmed, so these comparisons do not establish a higher W1 rubric score. Root review owns the final design acceptance; self-review scores are iteration signals only.

Verification checkpoint: Node24 focused ending client/schema/controller/integration18/18, `pnpm10.10.0 build` passes. Actual Game/PG/WS runs pass at1280x800 low,390x844 low and1280x800 high. Each covers19 real cast rigs, initial and tick500 late-orbit bounds, credits, ordered pointer controls, same-incarnation reconnect, stale listener rejection, chat/NPC continuation, unchanged gameplay progress, camera release and late asynchronous scenery disposal. Each owned QA host shut down durably with zero unresolved obligations. Same accepted observation and exact camera matrix are used for paired before/after renders at each setting. Original PNGs and reports are in `tmp/qa/world-ending-courtyard{,-narrow,-high}/`.

Final self-review remains88/100, below90. The surrounding terrain is flatter than the W1 village reference; W1 reference graphics quality is unconfirmed. This is a reviewable implementation checkpoint, with root design acceptance pending. It is not a claim of earned progression, W1 superiority, deployment or final design approval.

## Grounding follow-up after39de09f

The actual HIGH probe confirmed the existing light and target were already anchored to the trusted stage centre. The2048 shadow map was allocated and caster/receiver flags were present; the W1 terrain remains MeshStandardMaterial with its standard shadow/light chunks. The visible contact was still weak.

Reuse `CreateStage`'s `radialSprite` contact treatment in the private `EndingContactShadows` helper. Its19 small alpha planes follow observed body positions; opacity and size respond only to the current rendered foot height, without advancing animation or changing poses. Geometry, materials and texture belong to the helper and are disposed with the view. HIGH retains one2048 sun map with a tighter64m span. LOW allocates no sun shadow target and keeps the contact treatment, avoiding the512-map rooftop alias seen in the intermediate capture. These are private scene choices; global renderer, exposure and shared materials are untouched.

The court stays flat within13m. Only the outer planting/backdrop surface gains shallow visual relief, and scenery placement follows that display-only height. No collision query, Area position, gameplay height or server camera recipe changes. The terrain grid is160x160 HIGH and96x96 LOW, concentrated near the court.

Actual Game/PG/WS runs pass at HIGH1280x800 and LOW390x844, including initial and tick500 cast bounds, credits, reconnect, controls, unchanged progress and disposal. Both owned hosts shut down `durable:true, unresolved:0`. Node24 ending tests18/18 and build pass. Controlled before/after baseline is39de09f with the same accepted observation, camera, quality and GAME_VIEW. Reports and original PNGs: `tmp/qa/world-ending-grounded-{high,narrow}/`.

Performance qualification: the sampled headless HIGH opening/routine frames reported843/838 total render calls and about4.74M triangles; LOW reported459/456 calls and about2.38M triangles at a different viewport. These are diagnostic samples, not matched-resolution performance benchmarks. GPU timing was unavailable. Opening/routine FPS samples were about60, but one LOW credits sample was31.7, so no blanket60fps or mobile-device claim is made. Final self-review is89 and root visual acceptance remains pending; W1 superiority is unproven.

## Festival polish after554c1a1

Root review asked for polish before merge: a front roof crossed the 390x844 orbit, and a chat line overlapped the credits card. The courtyard also read as midday with no focal point.

- Mood: the W1 golden-hour palette (`ENDING_DUSK` in `endingStage.ts`) drives sky, fog, hemisphere and key light; one low western sun (`ENDING_SUN`) feeds both sky and shadow. A warm fill from the opposite side keeps dark shells readable. Lantern point lights are warm instead of teal.
- Focus: a brass medallion, an additive light pool and a narrow spotlight mark the hero's floor; the cast stays where the server put it.
- Dressing from the existing kits only: festoon bulbs strung post to post, a ring of twelve floor candelabra between the slate bands, petals on the court, feast tables with mugs and candles at both stalls, torch stands on the chapel path, the hero's gear by the tavern. Existing W1 particles (`buildFx`) add lamp halos, fountain jets, fireflies and dust; their clock is the accepted server tick.
- Camera: orbit direction and progress are unchanged. It cranes from a high establishing view to an 18 degree festival view at 20 m on wide screens and stays at 36 degrees, 22 m on portrait screens, above roofs and trees. Distance is fixed inside the courtyard ring; the lens (24 to 90 degrees) widens to fit the whole cast inside an NDC window of x 0.88, y -0.40 to 0.56, so the cast sits above the caption.
- HUD: during the ending the account chat moves into its own strip, inside the bottom letterbox beside the centred control on wide screens and one row above the letterbox below 900 px. The control sits inside the letterbox. No `game.ts` change, so the motion data hashes stay as baked.

Same-camera and same-tick before/after captures at 1280x800 and 390x844 (low quality, trusted W4 fixture): `docs/qa/frost-ending-polish-before-after.jpg`, originals in `tmp/qa/ending-polish-{before,final}-{desktop,narrow}/` and `tmp/qa/ending-polish-final-desktop-high/`. Self-review 78/100 against W1 85; not approved, root design review owns acceptance.
