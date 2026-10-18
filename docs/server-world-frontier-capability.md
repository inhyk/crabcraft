# Frontier 관측 capability

이 문서는 A6 capability 변경만 설명한다. 통합된 optional host/config 계약은 [server-world-config.md](server-world-config.md)에서 관리한다.

이 변경은 W5/W6, Ember/Sky를 기존 gameplay-v3 wire와 readonly 장면 경로에서 이해하게 한다. catalog/startup/host/build 및 운영 JSON은 바꾸지 않으므로 현재 4world host는 그대로다. 새 필수 S8 설정, gameplay default, 로컬 보상 권한을 추가하지 않는다.

snapshot world, 개인 quest chapter/tracked key, party/queued world, travelReady와 boss recovery는 canonical 6world/7boss를 지원한다. Frame layout, serializer, ACK/consumption/receipt, rate와 pose budget은 그대로다. World7, 알 수 없는 profile/field는 계속 거부하며 endingReady는 기존 Frost chapter4만 지원한다. Ember/Sky challenge는 활성 catalog의 `boss-ember`/`boss-sky` 광고가 있어야 encode할 수 있다. 기존 다섯 profile의 처리와 기존 4world 메시지 bytes는 바꾸지 않는다.

`HiddenWorld.observeChapter`는 W5/W6의 실제 FrontierIsland root, height/collision/raycast, canonical POI와 minimap을 선택한다. Legacy `go`/`enterFrontier`를 호출하지 않고 actor teleport/respawn, quest 변경, XP/coins, local save를 쓰지 않는다. ServerGameBridge는 catalog가 광고한 gate만 보내며 frontier boss 버튼/command도 해당 alias가 있어야 노출한다. Freed/NPC/enemy 이름은 기존 frontier 명칭을 사용한다.

## 검증

- `node --test server/world/gameplay/protocol.test.mjs server/world/gameplay/frontier.test.mjs tests/world-client.test.mjs tests/world-view.test.mjs tests/world-presentation.test.mjs`
- `node --test tests/world-frontier-view.test.mjs`는 local Vite와 실제 Chrome/WebGL에서 shipped W4/W5/W6 장면을 관측한다. 4→5→6→5→4→1 및 재진입, 같은 chapter의 idempotence, canonical POI/collision/minimap, catalog gate/challenge 차단을 검사한다. Legacy 이동과 보상 함수에 trap을 설치하고 actor/progression 불변을 확인한다. Screenshot/result는 `/private/tmp/crabcraft-a6-view-*`에 남는다. Chrome 설치가 필요하다.
- `pnpm build`와 `tests/core-motion-data.test.mjs`, `core-interactions.test.mjs`, `core-boss-profiles.test.mjs`, `core-transfer.test.mjs`, `server/world/catalog.test.mjs`의 기존 numeric/freshness/4world gate 회귀를 유지한다.

`frontier.test.mjs`에는 변경 전 `2aa6a51184ee56fac1527337ceb06c515f73110d`에서 측정한 기존 4world fixture full snapshot SHA를 고정했다. Actual W5/W6 Area의 fragmented full/delta, private self state와 boss recovery도 전달한다. 이 파일은 gameplay 하위 디렉터리이므로 위 명령처럼 명시적으로 실행한다.

Chrome 검사는 readonly projection fixture다. 실제 configured 6world host admission, PG persistence/return, 운영 activation 및 VM S8는 후속 catalog/host 통합 gate다.

## Canonical provider refresh 후 byte 기준

PR104를 받은 A head `952036c0791b75d33961969a7f1ba05bb086d7f8`는 provider가 `shipped-motion-v1-0843c9ac1ef19c400a9f`로 갱신되어 최초 `2aa6a51` bytes와 달라졌다. Golden test는 최초 provider와 네 SHA를 보존하면서, 실제 독립 canonical `52a748c628b844cbb1f936944f914e8b17512f1b` 기준을 추가한다. 알 수 없는 provider에는 fallback하지 않는다. Provider ID, pose-data 전체 SHA, fixture SHA 및 각 world packet SHA를 고정 검사한다.

Canonical Git archive의 `src server tests/core tests/world-client-fixture.mjs package.json pnpm-lock.yaml`을 별도 `/private/tmp`에 추출하고 그 원본 fixture/codec을 직접 실행했다. Archive SHA256은 `564ee0c93983d5856a32a8504b442f4c45fb0b0a7a81e6199f5294c00fb91a95`다. 추출본과 A의 pose-data, rig-catalog, world-client fixture 및 core harness SHA가 모두 같음을 확인한 뒤 양쪽 실제 fixture를 각각 생성해 W1-W4 full packet 배열을 byte 단위로 비교했다. 네 world 모두 1packet/1883bytes, exact equality다.

| world | canonical52 및 A full packet SHA256 |
|---|---|
|w1|3bfdc873a4db5c6a5933cc9cb1d6756237c5d2fb96544b00602a4c5580f67ffb|
|w2|64b73fec6966ba8dff511639969f60f5ded1ad199ef7e2e9239e6c9f73ea6f60|
|w3|8ba4160e7a696f96ec5f744cb6220321836a0cb244863b455c9da9bcc9e91cad|
|w4|0c2c6302013a765152a8b6d83814903f49e6d32899da637aa54b37136dff8247|

Canonical protocol SHA256 `6be61417833f74494474dd1b5a7a603e6d96fb241a4798fd630c6deba4b50f13`와 fixture SHA256 `0aa40b38e99c13f56d68b7d92dd28770e1475f5c405ba277f188ffe8918a9263`는 최초2aa와52 모두 같다. 새 pose-data SHA256은 `d0326aeaa725c165ffbe34572f40a3622d3446704eb2143df3a849c0728c2c6a`다. 기존 source hash 목록이나 tolerance는 바꾸지 않았다.

재현 시 위 archive selection을 `git archive <canonical-head> ... | tar -x -C <reference-dir>`로 고정하고 reference-dir/node_modules를 같은 frozen dependency 설치에 연결한다. Node24에서 reference와 candidate의 `tests/world-client-fixture.mjs`를 각각 dynamic import한다. 각 world마다 양쪽 `actualWorld()`를 새로 만들고, `observation(1,{full:true})`의 snapshot.world만 같은 world로 설정한 뒤 `codec.encodeObservation` packet 배열을 `assert.deepEqual`로 비교하고 양쪽 Area를 dispose한다. 이 순서로 측정한 SHA만 새 provider 기준으로 추가한다.
