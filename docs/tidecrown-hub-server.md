# Tidecrown 허브 서버 시뮬레이션 (PR A)

새 수도 Tidecrown은 모든 월드를 잇는 chapter 없는 허브다. 이 문서는 네 PR 중 첫 PR A의 `src/sim` 변경만 설명한다. 허브 place id, 걸어서 넘는 경계선(`edge`)과 항구 배편(`route`) 이동, 링크마다 정하는 도착 지점, 허브를 지나도 유지되는 quest chapter를 시뮬레이션에 넣었다. 실제 월드 정의(world1..4, frontier), server host, catalog, startup, gameplay protocol과 `WIRE_SCHEMA_REVISION`은 바꾸지 않았다. 따라서 지금 서버에서 Tidecrown은 아직 열리지 않고 기존 여섯 월드의 동작과 wire bytes는 그대로다.

## 정체성: 새 id `tc`

`WorldId`는 `'w1'..'w6'` 그대로 두고 `HubId = 'tc'`, `PlaceId = WorldId | HubId`를 추가했다. "캐릭터가 지금 서 있는 Area"를 뜻하는 필드만 `PlaceId`로 넓혔다.

| `PlaceId`로 넓힌 것 | `WorldId`로 남긴 것 |
| --- | --- |
| `AreaDefinition.world`, `AreaServices.world`, `AreaSnapshot.world` | `DeathRecipe.world` (`ledger.ts`) |
| interaction `destination`, `travelReady.destination` | `DungeonReturnBinding.world` |
| `CharacterCheckpointV1.world`, `CheckpointCaptureInput.world` | `createWorldVariants`, `createTownsfolk` 등 월드 전용 생성기 |

`src/sim/math.ts`에 도우미를 두었다.

- `PLACE_IDS`: `['w1','w2','w3','w4','w5','w6','tc']`
- `isHub(place)`, `placeChapter(place)`: 허브면 `null`, 아니면 `worldChapter`
- `canTravelToPlace(place, flags)`: 허브는 항상 열림, 월드는 기존 `canTravelTo`
- `chapterWorld(place)`: 허브면 `hub-has-no-chapter` 오류. 적과 보상 규칙(`enemy.ts`, `outcomes.ts`)은 이 값을 거쳐 chapter를 얻는다. 허브에는 적과 보스가 없어서 실제로는 닿지 않는 경로이고, 잘못 닿으면 조용히 틀린 값을 쓰지 않고 실패한다.

### chapter 0을 쓰지 않은 이유

허브를 chapter 0인 월드로 두면 다음이 모두 깨진다.

- `persistence.ts`는 `quests.chapter === worldChapter(world)`를 요구한다. 허브에서는 플레이어가 가져온 chapter가 그대로 남아야 한다.
- `restoreTransfer`의 `setQuestChapter`가 chapter를 0으로 덮어써 진행 중인 chapter를 잃는다.
- `questTrack`이 `tracked[0]`에 쓰게 되는데 저장 검증은 key 1..6만 받는다.
- `canTravelTo(0)`은 `abyssCleared && trueCleared`로 계산되어 허브가 잠긴다.

`services.world`를 `PlaceId`로 넓히면 `worldChapter(s.world)`를 쓰는 모든 곳이 컴파일되지 않으므로 허브 처리를 빠뜨린 곳이 남지 않는다.

## 허브 안의 규칙

| 대상 | 허브에서의 동작 |
| --- | --- |
| quest chapter | 들어올 때 바꾸지 않는다. 허브에서 `wN`으로 나가면 `setQuestChapter(N)` |
| fresh attach | `freshQuests()` 그대로(chapter 1). 실제 접속은 저장된 checkpoint로 들어온다 |
| `questAccept`, `questTurnIn` | 항상 거부. 퀘스트를 주고 받는 NPC는 chapter 월드에 있다 |
| `questTrack` | 플레이어 chapter 기준으로 그대로 동작 |
| quest bump | NPC 대화, 탐험, 수정, 봉화 같은 허브 안의 bump는 효과가 없다. 다른 월드에서 번 grant의 objective(earned)는 허브에서도 반영된다 |
| boat, village | feature chapter가 `placeChapter(world) ?? 0`이라 꺼진다 |
| 적, 보스 | 허브 정의에 하나라도 있으면 Area 생성자가 거부한다 |
| boss challenge, ending replay | 거부. `PersonalEndings`도 허브에서는 엔딩을 시작하지 않는다 |
| PvP | public mode라 기존 규칙대로 플레이어 사이 피해가 0이다 |
| ledger | `sourceStepRequirements`, `validateSourceLedgerCapacity`가 `tc`를 받는다. victim이 없으므로 필요 용량은 0이다 |

허브 NPC id는 `tc-` 접두사(`tc-king`, `tc-harbourmaster` 등)를 쓰고 기존 archetype(`npc:*`, `townsfolk:*`)을 재사용한다. 그래서 rig와 pose 데이터는 바뀌지 않는다.

## 이동: gate, route, edge

interaction kind에 `route`와 `edge`를 추가했다. 세 이동 종류는 `isTravelKind`로 함께 다룬다.

| kind | 시작 방법 | 범위 검사 |
| --- | --- | --- |
| `gate` | 기존 자동 walk-in 또는 명령 | 3D 구(`range`) |
| `route` | `{kind:'travel'}` 또는 `{kind:'interact'}` 명령만. 자동 walk-in 없음 | 3D 구(`range`) |
| `edge` | Area가 경계선을 넘는 순간 스스로 시작. 명령도 가능 | 2D 띠(아래) |

세 종류 모두 같은 나머지 검사를 받는다: 살아 있음, 배나 마을 놀이 중이 아님, `canInteract`, 진행 중 encounter 없음, 마지막 전투 후 5초, `canTravelToPlace(destination, flags)`. 이 검사는 `interactions.ts`의 `validate`와 `transfer.ts`의 `InMemoryTransferCoordinator.transfer` 두 곳에서 같은 함수(`inTravelRange`, `canTravelToPlace`)로 한다. 통과하면 모든 이동 종류가 `travelReady`를 낸다. 기존 자동 walk-in은 `kind === 'gate'`만 보므로 기존 월드의 동작은 같다.

### edge 띠와 자동 발동

`edge` interaction은 `position`(선 위의 한 점), `edge: {nx, nz, depth}`(바깥쪽 단위 법선과 띠 깊이), `range`(선을 따라 양쪽 폭)를 가진다.

- `along = dot(p - position, n)`, `lateral = |cross(p - position, n)|`
- 이동 검사 범위: `-1 <= along <= depth` 이고 `lateral <= range`
- 캐릭터마다 경계선별 무장 상태를 둔다. `along <= -2`가 되면 무장한다.
- 무장 상태에서 `along >= 0`, `lateral <= range`가 되면 `interact`를 부른다. 성공했을 때만 무장을 푼다. 전투 중처럼 거부되면 무장을 유지하고 띠 안에 있는 동안 매 tick 다시 시도한다.
- 경계선 밖에 저장되어 접속한 캐릭터는 무장하지 않은 채 시작하므로 바로 넘어가지 않는다. 다시 2m 안쪽으로 들어갔다 나와야 한다.
- 상태는 portal 상태와 같은 시점에 지운다(퇴장, respawn, 이동 불가 상태). `debugState().interactions.edges`에 `{character, ref, armed}`로 보인다. edge가 없는 월드에서는 항상 빈 배열이다.

Area 생성자는 링크 정의도 검사한다. `route`와 `edge`는 `destination`이 있어야 하고, `edge`는 길이 1인 법선, 양수 `depth`와 `range`가 있어야 한다. `edge` 필드는 `edge` kind에만 둘 수 있다.

### 도착 지점

링크마다 도착 지점을 정한다. 입장 예약 id는 `point.arrival ?? pois.arrival?.id ?? spawn.id` 순서로 고른다. 그래서 `arrival`이 없는 기존 gate는 예전처럼 목적지의 `pois.arrival` 또는 `spawn`에 내린다.

링크 전용 도착 지점은 `AreaDefinition.arrivals`에 둔다. `pois`에 넣지 않는 이유는 `pois`가 마을 놀이의 nav graph와 파티 귀환 검사에 쓰이기 때문이다. `spawn()`은 spawn, recall, pois 다음으로 `arrivals`를 key 또는 id로 찾는다. 이름이 없으면 기존과 같이 `Unknown spawn`으로 이동이 실패하고 상태는 복구된다.

## 저장

새 checkpoint 필드는 없다. DB migration도 없고 codec version 1을 유지한다.

- `world`는 `PLACE_IDS` 중 하나여야 한다. `w7`, `tc2`처럼 모르는 값은 계속 거부한다.
- 허브 checkpoint의 `quests.chapter`는 1..6의 정수면 된다. 플레이어가 가져온 chapter다.
- 예전 25개, 35개 퀘스트 catalog의 자동 확장은 chapter 월드에서만 한다. 허브 checkpoint가 예전 catalog면 `quests.previous-catalog.world`로 거부한다.
- `tracked` key 1..6, chapter 월드의 `chapter === worldChapter(world)` 규칙은 그대로다.
- 허브 checkpoint를 `w3` Area에 복원하면 world 불일치로 거부한다. 기존 규칙이다.
- `DeathRecipe.world`는 `WorldId`로 남겨 `tc` recipe는 거부한다. 허브에는 victim이 없다.

## 이 PR이 바꾸지 않은 것과 타입만 넓힌 곳

host, catalog, startup, protocol의 동작은 바꾸지 않았다. `services.world`가 넓어지면서 컴파일을 위해 타입 주석만 고쳤고 실행 동작은 같다.

- `server/world/host.ts`: `slots` Map key, `Waiting.world`, `PendingTravel.destination`, `queueNotice`의 `world`를 `PlaceId`로. 허브 slot이 없으므로 `tc`로 가는 `travelReady`는 지금처럼 `world-unavailable`이 된다.
- `server/world/startup.ts`: `createConfiguredRestorePolicy`의 catalog key를 `PlaceId`로. 허브 catalog가 없으므로 `restore world` 오류는 그대로다.

`src/sim/data/quests.ts`는 일부러 고치지 않았다. 이 파일은 collision bake의 source hash 입력이라 한 글자만 바뀌어도 baked collision 파일을 다시 만들어야 한다. 허브의 quest bump 규칙은 `interactions.ts`의 bump 도우미에서 처리한다.

## 검사

`tests/core-hub.test.mjs`는 평평한 테스트 월드 위의 합성 허브 정의(NPC 둘, W1으로 가는 edge, W1/W3/W5로 가는 route)와 링크를 덧붙인 실제 W1, W3, W5 정의로 7가지를 검사한다.

1. W1 경계선을 넘으면 `travelReady{destination:'tc', gate:'edge:tc'}`가 한 번만 나오고, 허브 `from:w1`에 내리며 quests가 그대로다.
2. 띠 옆으로 넘거나 전투 중이면 나오지 않고, 전투가 5초 지나면 한 번 나온다. 경계선 밖으로 복원된 캐릭터는 다시 무장하기 전까지 넘어가지 않는다.
3. 허브에서 W1로 가면 `from:tc`에 내리고 chapter가 1이 된다. 경계선 id로 보낸 `travel` 명령은 띠 안에서만 성공한다.
4. route는 잠긴 월드(W3, W5)를 flag 없이 거부하고, flag가 있으면 chapter 3, 5로 들어간다. W3에서 `route:tc`로 오면 chapter, status, progress, tracked가 정확히 같다. route는 자동 walk-in이 없다.
5. 허브 안 quest 수락 거부, 추적 허용, 대화 bump 무효, earned grant 반영, boat와 village 꺼짐, PvP 피해 0, boss challenge와 ending replay 거부.
6. chapter 3 허브 checkpoint 검증과 복원, 캡처. chapter 0, 7, 2.5, tracked key 7, 예전 catalog, 모르는 world 거부. 허브 checkpoint의 W3 복원 거부.
7. 적이나 보스가 있는 허브 정의와 잘못된 링크 정의 거부.

`tests/core-ledger.test.mjs`에는 `tc` death recipe 거부와 `sourceStepRequirements(area,'tc',0,...)` 용량 0 검사를 더했다. 기존 `w7` 거부 검사는 모두 그대로다.

```sh
pnpm build
pnpm test:sim:core
pnpm test:sim
pnpm test:engine
pnpm test:boss
pnpm test:world
pnpm test:server
pnpm test:multiplayer
```

## 남은 작업

- PR B (bake): `tc`를 ground kind `grid`, heightAt `collision`으로 bake한다. `src/sim/world/baked.ts`의 로컬 `WorldId` 사본에 `tc`를 더하고 WORLDS, SAMPLE_BOX, build 스크립트를 고친다. `tidecrownLayout()`에서 TC_BOUNDS 밖 cell을 먼저 막는다.
- PR C (host): 실제 정의 `src/sim/areas/tidecrown.ts`와 링크 표(W1 `edge:tc`, 허브 `edge:w1`, `route:w1..w6`, 각 월드의 `route:tc` 도착 `harbour`)를 만든다. 설정 key `hubs: { tc: { seed } }`, catalog, `HOSTABLE_PLACES`, protocol의 place id 목록, `WIRE_SCHEMA_REVISION` 증가, `world-dev-tc.json`을 더한다. catalog load에서 켜진 링크의 `arrival`이 목적지에서 풀리는지 확인하고 아니면 startup을 실패시킨다. Tidecrown이 꺼져 있으면 `!point.destination || enabled.includes(point.destination)` 필터로 링크를 빼서 기존 월드 정의와 wire catalog가 그대로가 되게 한다. `startup.ts`의 visibility가 `'w' + viewer.quests.chapter`로 catalog를 찾는 잠재 버그를 Area의 place를 받는 `visible(unit, viewer, place)`로 고친다.
- PR D (client): server mode에서 teleport 없이 Tidecrown을 관측하고, 항구 관리인 메뉴, `route:tc` 안내, edge 근처 prefetch를 붙인다. `serverBridge.ts`의 `Number(world.slice(1))`를 `placeChapter(state.world) ?? state.self.player.quests.chapter`로 바꾼다.
