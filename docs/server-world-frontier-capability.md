# Frontier 관측 capability

이 변경은 W5/W6, Ember/Sky를 기존 gameplay-v3 wire와 readonly 장면 경로에서 이해하게 한다. catalog/startup/host/build 및 운영 JSON은 바꾸지 않으므로 현재 4world host는 그대로다. 새 필수 S8 설정, gameplay default, 로컬 보상 권한을 추가하지 않는다.

snapshot world, 개인 quest chapter/tracked key, party/queued world, travelReady와 boss recovery는 canonical 6world/7boss를 지원한다. Frame layout, serializer, ACK/consumption/receipt, rate와 pose budget은 그대로다. World7, 알 수 없는 profile/field는 계속 거부하며 endingReady는 기존 Frost chapter4만 지원한다. Ember/Sky challenge는 활성 catalog의 `boss-ember`/`boss-sky` 광고가 있어야 encode할 수 있다. 기존 다섯 profile의 처리와 기존 4world 메시지 bytes는 바꾸지 않는다.

`HiddenWorld.observeChapter`는 W5/W6의 실제 FrontierIsland root, height/collision/raycast, canonical POI와 minimap을 선택한다. Legacy `go`/`enterFrontier`를 호출하지 않고 actor teleport/respawn, quest 변경, XP/coins, local save를 쓰지 않는다. ServerGameBridge는 catalog가 광고한 gate만 보내며 frontier boss 버튼/command도 해당 alias가 있어야 노출한다. Freed/NPC/enemy 이름은 기존 frontier 명칭을 사용한다.

## 검증

- `node --test server/world/gameplay/protocol.test.mjs server/world/gameplay/frontier.test.mjs tests/world-client.test.mjs tests/world-view.test.mjs tests/world-presentation.test.mjs`
- `node --test tests/world-frontier-view.test.mjs`는 local Vite와 실제 Chrome/WebGL에서 shipped W4/W5/W6 장면을 관측한다. 4→5→6→5→4→1 및 재진입, 같은 chapter의 idempotence, canonical POI/collision/minimap, catalog gate/challenge 차단을 검사한다. Legacy 이동과 보상 함수에 trap을 설치하고 actor/progression 불변을 확인한다. Screenshot/result는 `/private/tmp/crabcraft-a6-view-*`에 남는다. Chrome 설치가 필요하다.
- `pnpm build`와 `tests/core-motion-data.test.mjs`, `core-interactions.test.mjs`, `core-boss-profiles.test.mjs`, `core-transfer.test.mjs`, `server/world/catalog.test.mjs`의 기존 numeric/freshness/4world gate 회귀를 유지한다.

`frontier.test.mjs`에는 변경 전 `2aa6a51184ee56fac1527337ceb06c515f73110d`에서 측정한 기존 4world fixture full snapshot SHA를 고정했다. Actual W5/W6 Area의 fragmented full/delta, private self state와 boss recovery도 전달한다. 이 파일은 gameplay 하위 디렉터리이므로 위 명령처럼 명시적으로 실행한다.

Chrome 검사는 readonly projection fixture다. 실제 configured 6world host admission, PG persistence/return, 운영 activation 및 VM S8는 후속 catalog/host 통합 gate다.
