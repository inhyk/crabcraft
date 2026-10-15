# World II quality work

User requested ten hours of actual development. Start: 2026-10-15 12:56:12 UTC / 21:56:12 KST. Earliest ten-hour completion: 2026-10-16 07:56:12 KST. This document records work and evidence, not a claim that ten hours have already elapsed.

## Scope

- Fix World II quest acceptance; move villagers and build a lived-in settlement, wilderness and exploration objectives.
- Creator code 13570, direct travel, unlimited character levels.
- Two-way polished portals; preserve World I scenery.
- Lighthouse off/on, morning and boss availability synchronized across the room.
- Korean/English settings; parties, dance, opt-in room PvP.
- Restore the dance celebration ending.
- Verify persistence, multiplayer, performance and production deployment.

## First milestone validated — 2026-10-15 13:24 UTC

- Seven chapter-specific quests authored; chapter-filtered quest log.
- Eleven buildings including forge, chapel and tavern assembled from original licensed kit.
- Warm street lights, gardens, trees, roads and relocating villagers being connected.
- Level thresholds extend beyond 20; no story progression cap on player level.
- Browser checks passed: creator code, actual NPC quest acceptance, collection, two-way travel, lighthouse morning/on, English settings, level 100 save/reload, and the 16-character dance celebration.
- Two independent browser contexts passed party selection, PvP damage, same-party damage prevention, guest-requested lighthouse and chapter travel, and synchronized villagers.
- 23 game tests and 7 relay tests passed; TypeScript checks and production build passed. No browser errors in the checked flows.
- Multiplayer Worker e3cf34c34334454397f25f7276c7a29e deployed; live internet smoke checks passed combat, chapter checkpoint, late join, host transfer and room isolation.
- Frontend production milestone published: commit 7366314, deployment dpl_9VtxF69XDLKkZMSv8g22a4dvMsfA, https://inh-crabcraft-multiplayer.vercel.app. Production browser replay passed creator, actual quest accept/collect, chapter travel and lighthouse with no page errors.
- Hub commit e2785c6 published to https://seonn.dev/games/crabcraft (HTTP 200); live description and both screenshot hashes match the new village/dance assets. Git-triggered production deployment dpl_GpEHwBEC1DzcbJMdsU5DDUEy8gFt is READY.
- Ten-hour development request remains active; this is an early milestone, not the ten-hour completion.

## Second milestone — 2026-10-15 13:35 UTC

- Found a real walk-through regression: the original World I portal site overlapped the tavern porch. Moved only the portal to the open eastern street at (44, 2); direct automatic crossing now succeeds in both directions without bouncing on arrival.
- Added real 1.5-second hold-to-light channels to match the waystone quest instructions. Early release cancels without advancing progress.
- Corrected Korean quest objective labels and directions to match actual World I inventory/delivery semantics. Added live language refresh for first-time hints and translated interaction prompts, village conversations, boss journey statuses and dance captions.
- Named World II residents now have individual, alternating settlement dialogue. Added branching stone trails with tree clearance, and visible exploration glyphs that change when discovered.
- Preserved World I lighthouse/weather while visiting and fighting in World II; restore original shore fog on return.
- Added a repeatable GPU browser journey tool at tools/qa-starhaven.mjs. General quest acceptance, kills through the combat pipeline, collection, lantern cancellation/hold, delivery, six reward turn-ins, save/reload, automatic portal crossings and live language switching have been exercised. The full extended run passed all seven quests, 16-character final celebration and credits transition with no page errors.
- 25 game/protocol tests pass, including language changes preserving objective IDs/progress and World II boss combat preserving morning. Production build and whitespace checks pass.
- This is continued active development; ten hours have not elapsed.

## Third milestone — multiplayer usability, 2026-10-15 13:38 UTC

- Second milestone deployed READY as dpl_Aze758pYZRUd53Uta5p6yAXUPXHu (commit 73e00e6).
- Multiplayer room controls, invitations, messages, connection errors and emotes now switch live between Korean and English. The chosen room mode and personal party are marked with pressed states; guest mode buttons are disabled and explain host authority. Offline party/mode controls are disabled while solo dancing still works.
- Localized combat reach/resource errors, interrupted channels and experience/level-up messages.
- Two-browser replay passed actual bilingual mode/party buttons, selected state, host permissions, PvP damage, friendly-fire protection, guest lighthouse control, both chapter transitions and moving NPC/townsfolk synchronization with no page errors. Added tools/qa-starhaven-multiplayer.mjs for replay.
- 25 game/protocol tests and production build pass. Multiplayer UI polish deployed READY as dpl_FzKHG9fVP19gUDstP5oR1kjLCZ5a (commit 0ff7e0d).

## Repeated travel stability — 2026-10-15 13:39 UTC

- Ran 24 complete World I → World II → World I journeys in a real GPU browser. Geometry count stayed 439 and texture count stayed 144 from the warmed baseline to the last cycle; no growing GPU allocation was observed in this scenario.
- Every cycle retained the morning/off lighthouse state and in-progress World I quest count. No page errors occurred. This checks repeated travel, not ten-hour stability.
- Retained the replay in tools/qa-world-travel-soak.mjs.

## Exploration landmarks — 2026-10-15 13:46 UTC

- Added distinct western crystal glade, eastern animated celestial observatory and northern carved sanctuary, with localized discovery stories for the exploration quest. Kept discovery centers open and flattened the western/eastern medallion ground with smooth transitions.
- Collision sampling found trails crossing two village houses; routed them around the houses. New centerline replay reports zero blocked samples for a one-unit player radius. Expanded forest clearances around the three destinations.
- Removed an obsolete stepping-stone layer overlapping the settlement road; checked the corrected sanctuary view in a GPU browser.
- Production build, 25 game/protocol tests and full seven-quest GPU journey passed. The journey includes reward persistence, both automatic portals, morning preservation and the 16-dancer true ending; no page errors. Added tools/qa-star-landmarks.mjs for path checks and views.
- Ten-hour work remains active; this is a publishable intermediate milestone.

## Personal navigation and camera clearance — 2026-10-15 13:54 UTC

- Added a real tracking control to the quest log. The chosen active/ready quest directs the minimap and golden navigation marker, highlights in the tracker and persists separately for each world. Completed choices safely fall back; malformed saved IDs are ignored.
- All natural decorative crystals now avoid trails, discovery circles and the combat arena. Added physical/camera collision to the 63 retained crystals instead of letting the lens pass through opaque geometry.
- Quest collectibles close to the camera fade without affecting interaction. GPU replay reproduced the foreground obstruction, measured opacity 0.345 at 5.28 units, then successfully collected the same crystal with F. Removed per-frame quest-list flattening for each node.
- Strengthened trail sampling to reject displacements above 0.05 units; every trail centerline passed, as did sight collision through all 63 decorative crystals.
- 27 game/protocol tests pass. Real bilingual tracking-button replay passed selection, changing objectives, save/reload and separate World I/II choices. Two-browser multiplayer replay passed PvP, party protection, morning toggle, portals and resident movement with no page errors.
- Audit identified enemy migration coefficients and guest shore LEDs as follow-up work; resolved with the regression evidence below.
- Ten-hour development remains active; no ten-hour completion claim.

- Public verification for navigation milestone: commit 0323c96 deployed READY as dpl_A1xq4UXwxghe5qYTdMdgAfRzF5Gi. The full tracking/camera browser replay also passed against the stable production URL, including refresh persistence and F collection. seonn.dev/games/crabcraft returns HTTP 200.
- Milestone timestamps above use the actual UTC minute of the retained validation/commit rather than estimated future times.

## Enemy authority handover — 2026-10-15 13:59 UTC

- Reconstructed enemy damage, XP and respawn coefficients from the mirrored level when taking authority. This preserves the current HP, maximum HP, level and AI state instead of healing the enemy or reverting it to low-level damage.
- Fixed World II's 12-second respawn timer leaking into World I. Direct creator visitors returning to an uncleared shore restore original level/stats; post-boss shore enemies retain their intended level scaling and original respawn timer.
- Guest chapter return explicitly restores original LED appearance without reviving or healing mirrored enemies.
- Four new tests use the real Enemy class. All 31 game/protocol tests and the production build pass.
- Extended two-browser replay passed actual host departure. New host retained level 19, HP 80/133, damage 12.64–18.96, XP 326 and island respawn 12 seconds. Its subsequent shore return restored level 1, respawn 30 seconds and red LEDs. PvP, parties, weather, portals and villager checks also passed with no page errors.
- Initial extended replay stopped because the QA tool used the guest-only travel request on the host; corrected the replay to invoke the host's chapter transition. No duplicate process was started while the prior handle was live.
- Ten-hour development remains active.

- Authority fix deployed READY as dpl_2LFBNnFxLiC3VxoAusvz2EixvFgn (commit 16de09f). Production browser smoke recovered damage 8.32–12.48 from intentionally stale coefficients without changing HP 52, then restored shore level 1 / respawn 30 / red LEDs. This smoke checks the deployed code; real WebSocket host departure was exercised in the two-browser local relay replay above. Hub page HTTP 200.

## Bilingual boss clarity and island meadows — 2026-10-15 14:06 UTC

- Unified host and guest mechanic warnings by semantic attack kind and boss level. Black Eclipse explicitly directs players into the green sanctuary; other attacks describe their correct outside safety zone. Host Rust Spray now announces its warning too.
- Boss names, titles, phase banners, dialogue, patrol rewards and the first ending reveal follow Korean/English settings. Numeric encounter profiles and network identities remain unchanged.
- Added batched low flowers and grasses around the three exploration landmarks, avoiding the trails and boss arena. Inspected the western crystal garden in the actual GPU-rendered view.
- All 31 game/protocol tests and the production build pass. Two-browser replay passed the same Eclipse instruction in Korean for the host and English for the guest, plus existing party, PvP, travel, weather and authority checks. Trail sampling and all 63 crystal sight collisions pass.
- Ten-hour development remains active; this is an intermediate deployment.

- Published commit 94d74d2 as READY production deployment dpl_BH8zBBMo237PUHTCRVtu9UwXEsQB. A fresh headless browser against the public stable URL confirmed Astra's English name/title, the actual Eclipse inner-circle warning and 167 native meadow plants. No page errors occurred. seonn.dev/games/crabcraft returns HTTP 200.

## World language consistency — 2026-10-15 14:10 UTC

- Localized loading titles, stage labels and gameplay tips, plus shore region titles/subtitles and lighthouse on/off banners. Added an explicit Starhaven preparation stage.
- Region identities stay stable in both worlds while their visible names follow the selected language. The original shore music comparisons still use the same region keys. Removed the unused English-only subtitle table.
- GPU traversal found the northern exploration sanctuary incorrectly labelled as the Star Throne. Aligned the throne label radius with its 24-unit arena ground, so the sanctuary is correctly the Pilgrim’s Starroad.
- Added tools/qa-world-language.mjs. A real isolated browser passed localized initial loading, actual language buttons, every island region in both languages, refresh persistence, chapter return, English lighthouse-off banner and original wreck boss-music selection. No page errors. All 31 game/protocol tests and production build pass.
- Ten-hour development remains active; this is another intermediate release.

- Published 90b326d as READY deployment dpl_DM9HGh8qBmmiakPSGrLfV5D7LMZR. The entire world-language browser replay also passed on the public stable production URL, including loading, both languages, all five island regions, save/reload, shore return and music-key checks.

## Island ground art direction — 2026-10-15 14:15 UTC

- Replaced the island-wide height-only tint with continuous region palettes: teal moss in Moonshade, lavender mineral dust at the ruins, warm earth in Starhaven, heather on the pilgrim road and dark slate around the arena. Worn trail strips and broad mineral variation blend smoothly.
- All colouring is baked into the existing vertex buffer at load time; no extra draw calls, meshes or per-frame terrain updates. Added bounded anisotropic filtering for ground viewed at shallow camera angles and reduced its metallic sheen.
- Inspected actual western/eastern landmark GPU captures. Trail centerlines remain clear and sight collision through all 63 decorative crystals passes.
- Added tools/qa-world2-ground.mjs: all 22,701 rendered vertices match the live height/collision surface (maximum error 0.000000477 units), colours are finite, filtering respects device limits, and the real engaged boss emits Eclipse and Starfall telegraphs. Inspected the warmed boss-framing view and returned to shore without page errors. Encounter setup is injected for focused QA; this is not a claim of a manually played full boss victory.
- All 31 game/protocol tests, production build and whitespace checks pass. Ten-hour development remains active.

- Terrain art commit e3b05cb deployed READY as dpl_CtpLpmvuN9mVggmoPpZkTnb1HpWd. The entire terrain/boss-effect browser replay passed again on the public stable production URL with the same 22,701-vertex collision match and no page errors. Hub page HTTP 200.

## Mechanic warning priority and lifecycle — 2026-10-15 14:20 UTC

- Boss mechanic instructions now stay visible until the actual attack resolves or is cancelled, rather than fading on a fixed wall-clock animation. Solo menu pauses preserve the instruction with the paused simulation. General announcements still expire normally.
- Incidental zone/quest/XP banners are hidden while a warning is active; boss phase banners remain eligible. Warning ownership prevents a late callback or older encounter from removing a newer message.
- Host and guest cancellation clear their respective instructions. Language settings refresh an in-progress warning, and the boss frame name/title/phase/death labels now follow the selected language, including during a pause.
- Added tools/qa-boss-warning.mjs. Actual-browser replay passed a pause over three seconds, full warning opacity, suppressed region banner, attack completion cleanup, boss sleep cleanup, language switch during an active mechanic and stale-owner protection. Inspected the clearer combat screenshot.
- Two-browser relay replay passed bilingual Eclipse instructions and cancellation on both peers, plus PvP, party protection, weather, portals, villagers and authority transfer. All 31 game/protocol tests and production build pass.
- Follow-up audit: inspect the delayed World I lighthouse quest reveal against an intervening off toggle or chapter travel; its existing callback currently sets night unconditionally.
- Ten-hour development remains active.

- Published warning commit 9b44cef as READY deployment dpl_7Vy21jDqzjmbAKNKYYwY4M1XfLNG. The complete warning lifecycle/language browser replay passed again on the public stable URL, with no page errors. Hub page HTTP 200.
- Additional source audit for the next iteration: guest Eclipse outer telegraphs still use the generic default tint while the host explicitly uses purple; align that tint and verify actual effects on both peers.

## Lighthouse reveal race and shared boss effect palette — 2026-10-15 14:25 UTC

- Reproduced a live regression before the fix: completing q3 and immediately turning the beacon off changed {mood:3, beacon:false} back to {mood:1, beacon:false} after the delayed reveal. The boss remained dormant, leaving inconsistent weather.
- The reveal no longer writes weather. It checks the current chapter, lit state and story victory before waking/announcing the shore boss. Moonwater and q4 are granted immediately through the actual quest event pipeline, so travel during the 2.6-second reveal cannot strand q4 as an unoffered available quest. Localized that narrative.
- Stale guest night requests are ignored if the lighthouse is off or the party is visiting World II. New regression coverage preserves the existing valid lit-shore night request.
- Guest Eclipse telegraphs now use the host's purple danger tint. Shared impact visuals preserve matching Eclipse annuli and Nova rings, alongside slam, spray and undertow effects; damage authority is unchanged.
- Added a real-class regression covering telegraph colours and resolved effect calls for every mechanic across host/follower. All 33 game/protocol tests and the production build pass.
- Two-browser replay confirms actual effect uniforms match on both peers: danger a050ff and sanctuary 71ffca, plus bilingual instructions/cancellation, parties, PvP, weather, travel, villagers and authority transfer.
- tools/qa-beacon-reveal.mjs passes actual q3 completion/reward callbacks for off, travel and lit cases, plus q4 save/reload. Objectives are injected for focused timing coverage. No page errors.
- Ten-hour development remains active; these resolve the prior milestone's two follow-up audit items.

- Published 0fa6b13 as READY deployment dpl_Dqx1tpYDUQcYcQxf2SFQ5iTAEDDc. Extended the two-browser tool with CC_QA_URL: public runs use the deployed Internet backend with no WebSocket override. The entire multiplayer replay passed against the public game and Cloudflare room service, including matching actual purple/green effect uniforms, cancellation, PvP, parties, guest morning, both portals, residents and host departure with retained enemy stats. No page errors.
- The complete off/travel/lit beacon reveal replay also passed on the public production URL, including q4 save/reload. This verifies focused quest timing and real Internet multiplayer separately; it is not a ten-hour stability claim.

## Faceted crystal gardens and collision fidelity — 2026-10-15 14:35 UTC

- Replaced stretched octahedrons in the decorative gardens and Moonshade glade with six-sided crystals: bevelled shoulders, long prism faces, pointed crowns and restrained per-face brightness. Collectible crystals retain their brighter distinct appearance. World I scenery is unchanged.
- Actual geometry checks cover all 36 triangles in each crystal family: finite coordinates, outward normals and bounded local geometry. Inspected the rendered western garden.
- An actual transformed-vertex audit found seven old approximate collider envelopes exceeded by tilted facets, up to 0.507 units. Collider radii now include the measured rotated geometry plus clearance, computed once during construction.
- GPU replay confirms all 63 decorative crystals and all six western glade crystals fit their analytic colliders; all trail centerlines remain clear for a one-unit player and all 63 sight collisions pass. No page errors.
- All 33 game/protocol tests, production build and whitespace checks pass. Ten-hour development remains active; this is an intermediate release.

- Published f59c85d as READY production deployment dpl_HEkFuhTXc8M1ay5vuAXpZNwJLdon. The full landmark browser replay passed again on the public stable game URL: trails, 63 sight collisions, both crystal surface families and all 69 measured collider envelopes, with no page errors. seonn.dev/games/crabcraft returns HTTP 200 and its play link points to the updated stable game.

## Respawn destination and portal safety — 2026-10-15 14:40 UTC

- Public GPU inspection confirms current Eclipse and Starfall ground warnings remain visible on the arena surface; all 22,701 painted terrain vertices still match collision. No art change was needed for that check.
- Found a chapter-specific death presentation error: World II death and recovery used English Clawhaven text. Death overlays, chat and recovery messages now follow language and actual destination; changing settings while down updates the existing overlay.
- The first real lethal-damage replay exposed a gameplay regression: an armed World II return portal fired immediately upon respawn at (0,86), sending the player back to World I. Respawn now resets portal arrival state, and automatic gateway checks respect locked controls. The player must leave the arrival radius before walking through again.
- New tools/qa-respawn-language.mjs passes four lethal-damage/respawn cycles across both chapters and languages, live language switches while down, destination coordinates, full HP, retained XP/level/active quest status and no delayed bounce after cooldown. Ordinary walk-through travel still re-arms correctly.
- Extended the two-browser room replay with host and guest lethal damage. Both respawn at Starhaven with full HP and no shared chapter change; existing parties, PvP, bilingual boss effects, weather, travel, residents and authority transfer still pass. No page errors.
- All 33 game/protocol tests, production build and whitespace checks pass. Ten-hour development remains active.

- Published 01f7cb9 as READY production deployment dpl_2gmBUfhWHEa8D8RS55dQhHobG4TG. The full two-browser replay passed against the public game and actual Internet room backend, including both host/guest Starhaven deaths and respawns with no portal bounce, bilingual instructions, party/PvP, weather, villagers and authority transfer. No page errors.

## Fallen Star Observatory masonry and water — 2026-10-15 14:45 UTC

- Replaced the ten plain, identical ruin cylinders with faceted shafts, stepped bases, varied heights, warm capitals, narrow bands and small inward-facing luminous inscriptions. Their original positions and 0.9-unit footprint remain; collision height follows the visible masonry. Kept World I scenery unchanged.
- Added a 24-mark celestial dial around the observatory pool, a quieter clear-coated water material and three low-opacity expanding ripples. The original floating astrolabe remains the landmark silhouette. Detail families are instanced; no new lights or frame-by-frame geometry construction. Inspected the rendered eastern approach.
- Cleared two decorative rubble stones from the marked approach. All 62 retained stones stay at least 1.677 units from the trail centerline after accounting for their actual transformed radius.
- Extended the existing GPU landmark replay: every vertex of all 70 column pieces fits its physical envelope (maximum radial floating-point excess 0.00000245 units); all trail centerlines and crystal sight checks pass. Actual pool ripples animate and stay within the basin. No page errors. Production build and whitespace checks pass.
- A 24-round-trip GPU soak with the new observatory retains morning, q1 progress and stable geometry/texture counts: 464/147 after warmup and at the end. This is focused travel/resource coverage, not a ten-hour stability claim.
- Ten-hour development remains active.

- Published 10446f2 as READY deployment dpl_Kt2EtHb3fZfeWgYgLX5UhAxZVBki. The complete landmark replay passed on the public stable game URL: all trails, crystal visibility/collision checks, 70 masonry envelopes, 62 rubble clearances and live water ripples. No page errors; seonn.dev/games/crabcraft HTTP 200.

## Collectible sightline clearance — 2026-10-15 14:50 UTC

- Reproduced the obstructed eastern approach on the public game: crystal IV sat between camera and shell at 5.278 units with opacity 0.345, still painting a large bright shape over the foreground. Its center was only 0.816 units from the shell sightline.
- Collectible fading now combines lens distance with a soft camera-to-shell corridor. Passed crystals/lanterns clear that corridor; targets ahead of the player stay visible. Soft transitions near both segment ends avoid a hard visibility switch when passing an object. Three reusable vectors keep the per-frame calculation allocation-free. Interaction/progress identity is unchanged.
- Extended the real quest-tracking replay: interposed near crystal opacity 0, interposed long-view crystal at 14.097 units opacity 0, target ahead opacity 1, off-center target opacity 0.654. Inspected the resulting GPU capture with the shell and trail unobscured.
- Actual F-key collection still completes crystal IV. Bilingual tracking buttons, separate chapter pins, changing objectives and save/reload also pass, with no page errors. Production build and whitespace checks pass.
- Ten-hour development remains active.

- Published cf43fda as READY deployment dpl_Eey6TqyPbEGrbucgZUpywDNtP3jb. The entire tracking/save/collection replay passed on the public stable game URL, including near and distant intervening crystals at opacity 0, ahead opacity 1, side opacity 0.653 and actual F collection. No page errors; seonn.dev/games/crabcraft HTTP 200.

## Collectible shadow visibility — 2026-10-15 14:56 UTC

- Reproduced a ghost shadow on the public game: crystal IV opacity was 0 while castShadow remained true. Two synchronous renders differing only in that flag changed 28,772 pixels in the foreground, exposing the invisible crystal's opaque silhouette. Inspected both captures.
- Added a shared depth-program variant with a per-node visibility uniform. Ordered shadow-texel coverage produces an even fade under the existing PCF filter; invisible nodes skip shadow rendering. Fully visible nodes preserve their shadows. World I is unaffected.
- Initial native alpha-hash trial produced a blotchy intermediate silhouette; replaced it with ordered coverage and inspected the smoother half-visibility capture. The final shader does not allocate geometry, require additional lights or recompile on visibility changes.
- Added tools/qa-collectible-shadows.mjs. In one frozen scene instant it renders no shadow, zero visibility, half visibility and full visibility. Zero visibility has exactly zero pixel difference from no caster; the full reference shadows 29,729 pixels, and half visibility produces 43.86% of its measured darkening. Actual camera fade sets both visible and shadow opacity to 0. No console shader errors or page errors.
- Game disposal releases all seven owned custom depth materials. Production build and whitespace checks pass. Ten-hour development remains active.

- Published d19f97a as READY production deployment dpl_5BScWF8tbtsBTBvw6kKPsbFeg7tz. The complete frozen-scene shadow replay passed on the public stable URL: invisible shadow pixel difference 0, half-visibility darkening 44.19% of the full reference, all seven depth materials disposed, no console shader/page errors. seonn.dev/games/crabcraft HTTP 200.

## Deployment source hygiene — 2026-10-15 14:59 UTC

- Read the active Vercel CLI's ignore implementation: source uploads use .vercelignore/.nowignore, while .gitignore itself is merely excluded. Git-ignored local QA output was therefore still uploaded. The prior deploy transferred a 9 MB delta.
- Queried the actual deployed source-file manifest (metadata only): 990 files, including 348 duplicate dist outputs, 69 tmp files and temporary Worker build output. Local env files were already absent; the public .env.production was retained.
- Added .vercelignore to exclude local build/QA outputs, tools/tests/docs and screenshot working files. Required TypeScript build inputs, 315 public assets, 141 game source files, dev source and upstream license/notice remain available. A manifest comparison identifies 492 unnecessary files excluded; the source bundle before adding the ignore file contains 498 retained files.
- Worktree whitespace checks pass. The remote build and next deployed manifest will verify the actual filtered upload, rather than assuming the predicted count. Ten-hour development remains active.

- Published b79fcf9 as READY deployment dpl_D3zyCxmAo9o66CGthAgFLBeN9GcU. Remote TypeScript/Vite build succeeds with the filtered inputs. The new deployed source manifest has 499 files (990 before): no tmp/dist/tool/test/doc/screenshot working artifacts or log files; all 315 public assets, 141 game source files, required build inputs and LICENSE/NOTICE remain. The only changed source upload was the 221-byte ignore file; this measures source-upload hygiene, not player download speed.
- Public world-language replay passes actual initial loading, both language buttons, every World II region, saved language/chapter, shore return and lighthouse checks, with no page errors. KST midnight maintenance was completed separately: unchanged dad overview/pending review acknowledged and today's environment snapshot published. No unrelated common settings, authentication or other agent files were changed.

## World II saved-resume loading — 2026-10-15 15:09 UTC

- Actual source inspection found that every loading screen advertised Clawhaven and its shore painting, including valid World II resumes. Extracted the existing journey save-key/read validation so loading previews the same character/chapter that restore accepts. Save format and restore criteria stay compatible; invalid XP still starts a fresh shore journey.
- World II now loads with localized Starhaven title/subtitle, its own five practical tips, and the matching final welcome label. The loading art is a 1600×900 native Three.js/postprocessing capture of the actual settlement, fountain, residents and two-way portal; 155 KiB WebP, requested only for World II resumes. tools/capture-starhaven-loading.mjs preserves a reproducible export path. No external illustration or new asset licensing dependency.
- World II subtitle wraps within narrow screens. World I's existing loading presentation is preserved.
- Production TypeScript/Vite build and git whitespace checks pass. Extended tools/qa-world-language.mjs passes fresh shore loading, both actual settings buttons, every island region, KO/EN World II saved resumes including matching final labels, actual WebP decode at 1600×900, and damaged-save fallback. No page errors. Inspected replayed actual loading DOM at 1440×900 Korean and 390×844 English; title/subtitle/tip bounds do not overflow.
- Ten-hour development remains active. Remote deployment and public replay are the next checks.

- Published 385458e as READY deployment dpl_HCGAyVUYiDrpsidZjVkhJabP6qnh. The complete world-language replay passes on the public stable URL, including KO/EN saved World II loading titles, final welcome labels, actual WebP decode, narrow subtitle bounds, all five island regions and damaged-save shore fallback. No page errors.

## Celestial visibility and animated night sky — 2026-10-15 15:15 UTC

- Native GPU inspection confirmed the original 420 stars and moon inherited terrain fog at density .007; disabling fog in a frozen scene made distant stars visible again. The original high moon was also outside the usual low camera view.
- Replaced the three celestial draws with StarSky: layered cyan/lavender aurora, 980 deterministic round stars with subtle per-star twinkle, and a softly shaded crescent moon near the horizon. Sky shaders bypass terrain fog; regular depth testing preserves terrain occlusion. A faint translucent unlit lunar side lets the aurora remain visible there. No lights, bitmap textures or per-frame allocations were added.
- The sky follows camera translation to avoid celestial parallax, and point sizes follow the renderer's changing pixel ratio. Animation uses the existing shared multiplayer world time. World I's environment stays unchanged. Re-exported the native Starhaven loading panorama using the finished sky.
- tools/qa-star-sky.mjs renders actual full/hidden-star/hidden-moon/later-time frames in one frozen scene: stars change 194 pixels, the crescent changes 761, and animation changes 167,359; zero changed pixels below row 400 in all three comparisons. Camera tracking and ratio adaptation pass. Returning to shore hides the celestial parent; all three owned geometries and materials receive disposal events. No shader/console/page errors.
- Actual Eclipse and Starfall telegraph replay passes and captures remain readable. A 24-roundtrip soak keeps GPU counts stable at 465 geometries / 147 textures after warm-up; morning beacon state and personal quest progress remain intact. Inspected the real village sky and actual boss screenshots. Production build and whitespace checks pass; public deployment verification remains next.
- Goal start 2026-10-15 12:56:12 UTC; this record at 15:15 UTC is approximately 2 hours 19 minutes into the requested ten hours. Development remains active.

- Published bc51db4 as READY deployment dpl_8z2aDB6phABnqe4mWui11VrMB2SC. Public native-GPU replay passes: star visibility changes 197 pixels, crescent 761, animation 167,373, and all lower-frame comparisons stay unchanged. All three sky geometries/materials dispose, no console/shader/page errors. The public world-language replay also passes fresh shore and KO/EN saved World II loading/art, narrow English layout, every island region and damaged-save fallback.

## Animated island sea and true shoreline foam — 2026-10-15 15:30 UTC

- The original ocean was a static dark plane. Added StarSea with small irregular surface normals, depth-dependent coastal teal, procedural sky/aurora radiance, lunar glints, shoreline foam and a softened distant horizon. Sky and sea share the same atmosphere function and moon direction; reflection is an inexpensive analytic approximation rather than a render-target mirror.
- One fixed four-vertex/two-triangle plane remains at y=-3. No collision/terrain heights, lights, bitmap textures or per-frame geometry allocations change. Derivative filtering and distance attenuation soften small waves before they alias.
- Rejected the first visibly regular ripple grid and reduced/warped its waves. Native captures then exposed a false offshore foam ring: the finite terrain's inland uplift formula rose again outside the island. Ocean shading now deepens the seafloor beyond the actual terrain, removing that ring. A low cliff view correctly hides narrow foam at the cliff foot; a steeper camera inspection reveals the actual shore edge.
- tools/qa-star-sea.mjs passes actual GPU masking: 890,291 visible water pixels; 46,438 animate between frozen-time samples, with zero changes outside water/its 3-pixel filter edge. Shader foam diagnostics find 14,613 visible foam pixels at elliptical coast radii .9165–.9472 and zero offshore foam. Actual geometry/level, shore hiding and owned resource disposal pass; no shader/console/page errors. Inspected both low coast and overhead coast captures.
- Full two-browser local-room replay passes party/PvP protection, guest weather/travel, all seven residents, death/respawn, bilingual boss safety effects and host departure. New assertions confirm sky/sea times are identical within each peer and room clocks differ by about .0011 seconds in this sample.
- Shared sky refactor passes native visibility, animation and disposal replay. One earlier filtered comparison differed by one lower-frame pixel; added exact unfiltered isolation checks alongside bounded postfilter comparisons. Final replay has zero lower-frame differences in both filtered and unfiltered frames. Re-exported loading art with the actual common scene time; production TypeScript/Vite build and whitespace checks pass.
- Ten-hour development remains active; approximately 2 hours 34 minutes elapsed from 2026-10-15 12:56:12 UTC. Public deployment checks remain next.

- Published e907ae5 as READY deployment dpl_9Gr7LY6vkU49YTJzhnFbgxFFXL6E. Public GPU sea replay passes: 46,440 animated water pixels, zero outside-water changes, 14,613 visible true-coast foam pixels and zero offshore foam. Public KO/EN saved-chapter/loading replay passes every region and damaged-save fallback.
- Full actual Internet-room replay passes on the public stable URL. Sky and sea clocks match exactly per peer; host/guest differ by .117 seconds in this sample. Party/PvP protection, weather, guest travel, all residents, respawn without portal bounce, identical Eclipse safety colours/instructions, cancellation and injured-enemy host handover all pass, with no page errors. Ten-hour development remains active.

### Compact desktop combat HUD — 2026-10-15 UTC

- Reproduced at the user's 718×492 image size: the full boss frame covered the map, chat sat behind ability buttons, and the side stack reached the action bar.
- Added a compact 640–900px desktop layout with a smaller map, readable condensed target frame, boss information to the left of the scrolling party/quest stack, and chat above the action bar. The map's north marker now uses percentage coordinates so it stays on the resized rim. Larger layouts and narrow phone layouts retain their prior dimensions.
- Real browser replay (tools/qa-compact-hud.mjs) clicks Party 1 through the scrolling stack and confirms selection, then enters the level-20 encounter. Boss right edge 436 < side stack left 451; map bottom 178 < stack top 196; stack bottom 367 < action bar top 377.15. Screenshots inspected, TypeScript/Vite build passes. Ten-hour quality work remains active.
- Published 2b68a38 as READY dpl_9jcgRU1VRAX6yFvgK2b53xkXg5pv. The stable public game passes the same compact combat separation and actual Internet-room Party 1 click replay. seonn.dev/games/crabcraft returns HTTP 200 and its existing play link serves this updated game.

### Compact quest reading and settings — 2026-10-15 UTC

- Before captures exposed real clipping: at 718×492 the quest log extended to (-21,-14)–(739,506) and settings above/below the screen; at 390×844 dialogue ended at x536, quest log at x575 and settings at x495. Existing HUD portraits/map/party and journey tools also painted over quest text.
- Dialogue and quest log now have their own layer above gameplay HUD, with settings above both. Compact quest logs fit the viewport and have independent list/story scrolling; narrow screens stack those sections. Dialogue footer stays fixed while the body scrolls. Compact settings/controls fit and scroll, and segmented controls wrap naturally.
- Selecting a quest preserves the list's scroll position rather than jumping back to the first quest after redraw.
- tools/qa-compact-quests.mjs uses actual UI clicks to accept all seven World II quests in KO 718×492 and EN 390×844, select/track the final quest, close the log, and navigate settings/controls/back. Native mouse-wheel story scrolling and preserved list position pass; all reading panels remain within viewport bounds. Captures inspected, no page errors, TypeScript/Vite and whitespace checks pass. First English automation attempt used the wrong capitalization for the existing Accept quest label; fixed the selector and both subsequent full replays passed.
- Ten-hour quality development remains active. These are gameplay UI corrections; World I scenery and World II progression rules are unchanged.
- Published 28812a4 as READY deployment dpl_6pLAQoztYfyLDaagfMfVMpNdwtHp. The same complete compact KO/EN quest acceptance, native story scrolling, preserved selection, tracking, closing, settings and controls replay passes on the stable public game. Hub game page returns HTTP 200.

### Living island foliage — 2026-10-15 UTC

- Native captures of the western path and crystal glade showed attractive scenery but wholly static vegetation. Added StarWind to the island's existing licensed batched trees, bushes, flowers and grass. A low-amplitude, anchor-phased breeze bends bark and leaves coherently with roots fixed; analytic normal correction follows the bend.
- The same clock, bend and material alpha rules drive custom PCF depth materials, so moving plants retain matching shadows. The wind uses one shared time uniform, existing geometry and existing draw calls. World I materials and plants are untouched.
- Batched geometry receives .2 local-unit conservative bounds padding, above the maximum .189-unit tree bend, to prevent rest-pose frustum bounds clipping the motion. No terrain or collision changes.
- tools/qa-star-wind.mjs freezes the actual GPU scene and changes only wind time. 72,392 visible pixels and 5,095 isolated shadow pixels change; with plants and their shadow contribution hidden, zero bytes/pixels change. All 19 batched geometry bounds retain .2 padding. All five owned wind depth materials dispose, return travel hides the forest, and there are no page/console/shader errors. Captures inspected; TypeScript/Vite and whitespace checks pass.
- Full local two-browser room replay passes existing combat, party, PvP, weather/travel, villagers, respawn, Eclipse and injured-enemy host-handover checks. New assertions prove sky, sea and foliage have exactly equal clocks in each browser, with about .0167 seconds between peers in this replay.
- Ten-hour quality work remains active; public deployment/replay follows.
- Published e3d1218 as READY deployment dpl_Esk2eq6V34eNxbppXc2HPwKfnoxR. Public GPU replay passes 72,356 moving plant pixels, 5,052 moving shadow pixels and zero static-scene differences; bounds and disposal also pass. Actual Internet two-browser replay passes all party/combat/weather/travel/villager/respawn/boss/host-handover checks with no errors. Sky, ocean and wind clocks match exactly per peer; peer difference is .1153 seconds in this sample. Hub page HTTP 200. Started 12:56:12 UTC; ten-hour work remains active at approximately 2 hours 56 minutes elapsed.
