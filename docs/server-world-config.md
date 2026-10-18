# Actual world startup configuration

`server/world/startup.ts`는 환경변수를 읽거나 HTTP listener를 열지 않는다. Root main이 `WORLD_ENABLED=1`일 때 필수 `WORLD_CONFIG_JSON`을 JSON으로 파싱해 전달한다. 설정 누락, 알 수 없는 필드, 잘못된 값, 명시적 `null`, 지원하지 않는 정책은 시작 실패로 처리한다. `WORLD_ENABLED`를 생략한 상태에서 legacy 서비스의 동작은 바꾸지 않는다.

세계 시작만 실패한 경우 main은 비밀값을 포함하지 않는 검증 경로, ownership 상태 또는 알려진 오류 code를 로그에 남기고 legacy 계정/방을 계속 띄운다. `/world`와 world 관련 API는503이며 정상 DB의 `/healthz`는200이다. 세계 기동 확인에는 별도로 `/world`의426 및 catalog의200을 검사해야 한다. 일반 오류의 임의 message, JSON 원문과 credential은 로그에 넣지 않는다. 새 필수 설정 필드는 추가하지 않는다.

```ts
const runtime = await startConfiguredWorld({
  pool, admission, // accountHandler와 같은 WorldTicketRegistry 인스턴스
  assets: new URL('./world/', import.meta.url),
  config: parsedWorldConfig,
  originAllowed, clientIp,
});
```

반환값은 `{host,catalog,ownership,characters,codec,gameplayCatalog,config}`다. `host`는 실제 `createActualWorldHost`, `characters`는 실제 PG `CharacterStore`, `codec`는 strict core codec이다. `gameplayCatalog`만 공개 catalog 응답으로 사용하고, 내부 config와 CharacterStore는 공개하지 않는다. 6개 race, 2개 sex, 3개 class와 전체 shell/crest/LED/name 선택을 immutable identity에 보존한다. 시작 시 캐릭터를 자동 생성하지 않으며, slot/생성 정책은 이 모듈이 정하지 않는다.

## 필수 gameplay 설정

최상위 schema는 `world-startup-v1`이다. `ownership`, `assets`, `worlds`, `restore`가 필수다. 선택 필드 `characters:{maxCharactersPerAccount:<positive safe integer>}`는 명시적 account별 생성 cap을 전달한다. 생략 또는 빈 객체는 생성 API의 503 disabled 상태다. Slot 기본값은 없다. Root main이 `runtime.config.characters ?? {}`를 `createCharacterHandler`의 `policy`로 전달한다. `worlds`에는 `w1`, `w2`, `w3`, `w4`가 모두 있어야 한다. `w5`와 `w6`는 각각 완전한 region 설정을 명시한 경우에만 활성화한다. 기존 4월드 JSON에 새 필수 필드는 없다. 선택 region의 `null`이나 일부 필드만 지정한 값은 거부한다.

각 world의 필수 필드:

| 필드 | 의미와 검증 |
| --- | --- |
| `seed` | Area별 명시적 uint32 seed |
| `populationMode` | `nearby-slots-v1` 반응형 pool 또는 명시적 QA용 `fixed-slots` |
| `fixedLevels` | `scrapling`, `scavenger`, `jellyfish`, `echo`의 명시적 양의 safe integer 레벨 |
| `population` | `scrapling`, `scavenger`, `jellyfish`, `shallowPatrols`의 명시적 0 이상 정수 slot 수 |
| `respawnSeconds` | 위 4개 enemy kind/echo별 명시적 양의 유한 초 |

레벨, spawn 수, respawn 시간의 생산 기본값은 없다. `fixed-slots`는 이미 선언된 각 slot의 `desired=1`을 사용하며 nearby-player 밀도 곡선을 구현하지 않는다. Spawn pool은 설정 수로 제한된다. `shallowPatrols`는 별도 source spawn 역할이고 scrapling 레벨/respawn 시간을 사용한다. Echo의 명시적 respawnSeconds 값은 canonical helper가 반환하는 120과 같아야 한다. 다른 값을 받아 놓고 무시하는 설정은 거부한다. 최초 World II 45초 출현과 사망 후 120초 respawn을 구별한다. Party 보스 add의 실제 encounter 규칙은 별도다.

`population` 합계와 실제 생성된 enemy 수 모두 `limits.maxMutationSourcesPerTick <= 256` 이하여야 한다. 원본 layout이 지형 조건에 따라 일부 jellyfish template을 찾지 못하면 실제 목록이 요청 수보다 적을 수 있다. 조용히 population을 늘리거나 다른 template으로 대체하지 않는다. 아래에 정의한 이름 외의 density 알고리즘이나 알 수 없는 필드는 거부한다. 실제 enemyStats에서 계산한 HP/XP/damage 등 숫자가 finite-safe 범위를 벗어나면 ownership 획득 전에 시작을 거부한다. 임의의 level cap으로 정규화하지 않는다.

Public은 필수 4개 world와 명시적으로 설정한 W5/W6만 생성하며, world별 capacity100, PvP disabled다. 이 값들은 현재 host/core 계약에서 온다. Startup policy는 public player-to-player damage를 거부한다. Private party에서만 `pvp:party-only`이고 source/target의 exact full ref가 같은 non-null party membership에 속할 때 허용한다. Self damage, stale life, 다른 party, public toggle은 허용하지 않는다. `party`를 생략하거나 `{"enabled":false}`로 두면 party가 disabled다. Party 활성화는 아래의 모든 명시적 capacity/return 정책이 있을 때만 지원한다. 누락한 설정을 임의의 return 위치로 채우지 않는다.

## 선택적 W5/W6 활성화

W5/W6에도 위 표의 `seed`, `populationMode`, `fixedLevels`, `population`, `respawnSeconds` 전체를 지정한다. `nearby-slots-v1`이면 아래의 다섯 group별 `radius`, `base`, `max`, `scale`도 모두 필요하다. 이 문서는 운영 레벨, 밀도, seed 또는 respawn 값을 새로 선택하지 않는다.

`party.enabled:true`이면 활성화한 W5에는 `returns.ember:{world:"w5",spawn:<실제 public POI id>}`, W6에는 `returns.sky:{world:"w6",spawn:<실제 public POI id>}`를 추가한다. 각 `spawn`은 해당 canonical definition의 spawn, recall 또는 POI에 존재해야 한다. 비활성 월드의 profile을 return 정책에 추가하면 거부한다. 기존 4월드 설정은 기존 다섯 profile return만 요구한다. Party capacity8과 명시적 `maxParties`/`maxEncounters` 계약은 유지한다.

`deploy/vm/world-dev-6.json`은 `deploy/vm/world-dev.json`에 W5(seed 1005)와 W6(seed 1006), 아래 표의 레벨과 respawn, population 12/4/6/3, `returns.ember`/`returns.sky`의 `spawn`을 더한 6월드 dev 설정이다. 이 파일로 실제 package를 기동해 `/healthz` 200, `/world` 426, catalog의 `gate:w5`/`gate:w6`와 `boss-ember`/`boss-sky`를 확인했다. VM의 `/etc/crabcraft/dev-world.json`은 이 PR이 바꾸지 않는다.

현재 canonical helper(`src/sim/data/enemies.ts`, dev52 합성 기준)의 source 값은 다음과 같다. 이 값은 config의 자동 기본값이 아니며 운영 설정에서 명시해야 한다.

| Region | scrapling / scavenger / jellyfish / echo 레벨 | ordinary respawn | echo respawn | respawn clearance |
| --- | --- | --- | --- | --- |
| W5 | 300 / 302 / 300 / 10 | 12초 | 120초 | 22m |
| W6 | 400 / 402 / 400 / 10 | 12초 | 120초 | 22m |

현재 Frontier definition은 scrapling, scavenger, shallow patrol template을 생성한다. Jellyfish와 echo template은 없지만 기존 region schema의 해당 필드는 필요하다. Return으로 검증되는 public POI id는 `spawn`, `forge`, `chapel`, `tavern`, `grove`, `shore`, `wreck`, `lighthouse`, `beacon`, `bossArena`, `npc:brinebeard`, `npc:silvermoon`, `npc:coralline`, `npc:grukk`, `npc:hoofclaw`, `npc:rattlebolt`, `npc:pip`이다. W5/W6의 spawn과 recall은 `(0, heightAt(0,82), 82)`이며 별도 `arrival` POI는 없다. 이 목록은 허용 위치를 설명하며 seed, population 또는 return 위치를 새로 선택하지 않는다.

Catalog는 실제 활성 encounter에 대해서만 `boss-ember`/`boss-sky` alias를 광고한다. 비활성 destination의 gate는 public/encounter definition과 wire catalog에서 모두 제거한다. W4에서 W5로 가는 canonical `frostCleared` 조건, W5/W6의 캐릭터별 퀘스트와 보상, Ember500/Sky750 조건은 core 규칙을 그대로 사용한다. Startup에서 플래그, XP 또는 승리 상태를 만들어 넣지 않는다.

패키지는 canonical collision bake6개와 공통 source/hash manifest를 생성한다. 현재 loader는 4개 또는 선택 artifact가 추가된 manifest를 허용하되 활성 world의 artifact 누락은 ownership 획득 전에 거부한다. Manifest에 선언한 artifact는 비활성 world여도 크기/hash budget 검사를 받는다. 6개 package에 4월드 config를 사용하면 Area는4개만 생성한다. 4월드 rollback은 해당 binary와 일치하는 기존 4개 manifest/package 및 source 설정을 함께 복원해야 한다. 이전 binary가 새6개 manifest를 읽는다고 가정하지 않는다. W5/W6에 저장된 캐릭터를 해당 world가 비활성인 host에 접속시키면 world-unavailable로 거부하며 다른 world로 옮기거나 저장 데이터를 지우지 않는다.

## 반응형 bounded slot pool

`populationMode:"nearby-slots-v1"`은 `nearby`를 필수로 받는다. `scrapling`, `scavenger`, `jellyfish`, `shallowPatrols`, `echo` 다섯 그룹 모두 `{radius,base,max,scale}`을 명시해야 한다. 레벨과 respawn 시간도 앞의 필수 설정을 사용한다. 수치 기본값은 없다.

- `radius`: spawn home 주변 생존하고 숨겨지지 않은 player를 세는 반경.
- `base`, `max`: 0 이상 정수. `base <= max`. 일반 그룹 `max`는 같은 `population`의 미리 만든 pool 크기와 정확히 같아야 한다. Echo는 실제 1개 slot이므로 `max <= 1`이다.
- `scale`: player 1명당 추가 slot 수, 0 이상 유한 수. 활성 목표는 `min(max, base + floor(nearbyPlayers * scale))`이다.
- 반응형 증가가 있는 그룹(`scale > 0`, `max > base`)은 `radius > enemyRespawnClearance(kind,chapter,role)`가 필요하다. 현재 PR52 source에서 일반 scavenger의 World II/III clearance는 8m, 그 외는 22m다. 보호 반경 밖에서 근처 player를 셀 수 없는 조합은 시작을 거부한다.

실제 활성 여부는 불변 `legacySlot`의 그룹/번호로 결정하며 Area 배열 순서나 legacy eN wire 번호로 추측하지 않는다. Pool은 `max`개만 만들고 runtime actor를 무제한 생성하지 않는다. Gone 일반 slot은 목표가 활성이고 모든 player가 해당 kind/chapter/role의 canonical 보호 반경 밖에 있을 때만 나타난다. Dead slot도 별도 respawn 시간, 목표 활성, 같은 clearance를 모두 검사한다. 목표가 감소했을 때 full-HP idle이고 5초 이상 전투 밖이며 해당 보호 반경 안에 player가 없는 초과 slot만 숨긴다. Chasing/leashing/injured actor를 즉시 없애지 않는다.

Echo는 실제 World II 45초 최초 출현을 유지하고 목표 density와 22m clearance도 검사한다. 사망한 Echo는 corpse/dead 상태를 거쳐 사망 시각부터 120초를 기다리며, 이전 spawn 시각의 deadline 때문에 일찍 나오지 않는다. 일반 적 respawn 시간으로 Echo 규칙을 대체하지 않는다. Source terrain에서 못 만든 slot을 다른 위치로 조용히 복제하지 않는다.

QA용 한 그룹 예는 `population.scrapling:3`, `nearby.scrapling:{"radius":50,"base":1,"max":3,"scale":1}`이다. 50/1/3/1은 검사 fixture 수치이며 생산 tuning 권고가 아니다. 나머지 네 그룹도 명시해야 한다.

## PR52 source의 balance 참조

기준은 canonical commit `b051b47`의 `src/game/enemies.ts`, `src/game/progression.ts`, `src/game/boss.ts`다. Pure core의 `canonicalEnemyLevel`, `canonicalEnemyRespawn`, `enemyRespawnClearance`가 이 규칙을 제공한다. Startup은 clearance와 Echo timer를 그 helper에서 읽는다. 일반 monster의 레벨/respawn JSON은 계속 명시적 operator 설정이며 아래 표를 조용한 기본값으로 채우지 않는다.

| 일반 kind | World I level/respawn/clearance | World II | World III | World IV |
| --- | --- | --- | --- | --- |
| scrapling | 1 / 30s / 22m | 10 / 12s / 22m | 20 / 12s / 22m | 100 / 12s / 22m |
| scavenger | 2 / 45s / 22m | 12 / 6s / 8m | 22 / 6s / 8m | 102 / 12s / 22m |
| jellyfish | 2 / 40s / 22m | 10 / 12s / 22m | 20 / 12s / 22m | 100 / 12s / 22m |

해당 world definition에 없는 kind는 표 때문에 새로 생성되지 않는다. Echo는 level10, 사망 후120초, clearance22m다. Boss-owned add는 별도 역할이며 일반 pool로 자동 재생성하지 않는다. Dawn/Frost의 HP/damage/tempo와 telegraph는 PR52로 갱신한 pure boss data/controller를 사용하며 startup JSON의 임의 boss override는 없다. 아래 전체 JSON 예제의 소수 enemy와 300초 계열 시간은 startup QA용 선택이고 이 source balance 표를 대체하지 않는다.

## 명시적 private party 설정

`party`를 생략하거나 `{"enabled":false}`로 두면 실제 host가 party 명령을 `party-unavailable`로 거부한다. 활성화에는 아래 필드가 모두 필요하다. `maxParties`는 1..10000, `maxEncounters`는 1..1024이며 `maxEncounters <= maxParties`여야 한다. 이들은 명시적 process 자원 한도이고 기본값이 없다. 실제 private member cap8은 host/core 계약을 유지한다.

```json
{"enabled":true,"maxParties":2,"maxEncounters":1,"returns":{
 "rust":{"world":"w1","spawn":"spawn"},
 "abyss":{"world":"w1","spawn":"spawn"},
 "eclipse":{"world":"w2","spawn":"spawn"},
 "dawn":{"world":"w3","spawn":"arrival"},
 "frost":{"world":"w4","spawn":"arrival"}
}}
```

위 2/1과 return 위치는 QA fixture의 명시 선택이다. 생산 기본값이 아니다. 다섯 profile의 return entry가 모두 있어야 한다. 각 world에 실제 해당 encounter 정의가 있는지, spawn 값이 실제 public spawn/recall/POI id인지 static loading에서 검사한 뒤 ownership을 획득한다. 잘못된 world나 존재하지 않는 POI, 빠진 profile은 시작을 거부한다. Host가 party leader, 참여자, 레벨/거리/전투/스토리 조건, trusted beacon bootstrap, stage/ownership CAS/return queue를 계속 검증한다. Startup은 이 권한 검사를 client boolean으로 대체하지 않는다.

## 복원 정책의 정확한 범위

다음 8개 필드가 모두 필수다. 4개의 pause/elapse 선택과 2개의 위치 선택을 조합한 32개 조합을 지원한다. HP/resource full 회복, regen, penalty, live action 재개, 타 world로 이동은 지원하지 않는다.

| 필드 | 지원값 | 동작 |
| --- | --- | --- |
| `cooldowns` | `pause`, `elapse` | GCD와 각 cooldown의 startAge/remaining을 그대로 유지하거나, offline seconds만큼 age 증가/remaining 감소 |
| `statuses` | `pause`, `elapse` | stun/slow/rust/absorb/blessing remaining을 유지하거나 경과 처리. 만료된 slow/rust/absorb 효과 payload를 비활성화 |
| `death` | `pause`, `elapse` | dead respawn remaining 유지 또는 감소. 남은 시간이 0이어도 복원 순간에는 dead/기존 HP/resource 유지. 재개 후 실제 core 첫 tick에서 기존 respawn 규칙이 실행되면 full HP와 class 자원이 복구됨 |
| `history` | `pause`, `elapse` | combat/spend/attack age 및 next-swing remaining 유지 또는 경과 처리 |
| `hp` | `preserve` | 저장 HP, alive/maxHp 유지 |
| `resource` | `preserve` | 저장 class resource/maxResource 유지 |
| `location` | `saved`, `arrival` | 저장 위치/yaw 또는 같은 world의 실제 `pois.arrival ?? spawn` 사용. World III/IV의 nominal recall과 actual arrival을 구별 |
| `activity` | `cancel` | boat/village/controls lock/cast/channel/dash/pending hit/root carry와 self motion을 명시적으로 취소 |

`encounterBlessing`은 유한 duration과 구분되는 원본 permanent encounter 상태다. `statuses:elapse`도 이 boolean을 시간으로 지우지 않는다. 타인 ref, boat seat/round, projectiles, action layer는 복원하지 않는다. Quests, gear, XP/coins, flags, pity, 15개 achievements, accepted boat distance와 lighthouse discovery는 변하지 않는다. `prepareRestore`의 strict 검증을 재사용하며 invalid/overflow 결과를 clamp하지 않는다. Policy version은 선택값에서 만든 고정 digest를 포함한다.

Offline seconds는 저장 row의 trusted `updatedAt`과 현재 server wall clock 차이다. 저장 timestamp가 미래이거나 값이 잘못되면 attach 실패다. 음수를 0으로 정규화하지 않는다. 같은 프로세스의 reconnect는 기존 live actor를 재사용하는 host 경로를 따른다.

## Packaged asset manifest

Root build는 `server-dist/world/`에 실제 collision JSON 6개와 `world-manifest.json`을 함께 배치한다. 6개 원본 JSON의 common source가 다르면 build가 실패한다. 다음은 현재 package의 shape다. 기존 4개 항목만 있는 manifest도 4월드 설정에 계속 사용할 수 있다.

```json
{
  "format":"crabcraft-world-manifest",
  "version":1,
  "source":"<reviewed common 64-lowercase-hex SHA>",
  "artifacts":{
    "w1":{"file":"collision-w1.json","bytes":123,"sha256":"<64 hex>"},
    "w2":{"file":"collision-w2.json","bytes":123,"sha256":"<64 hex>"},
    "w3":{"file":"collision-w3.json","bytes":123,"sha256":"<64 hex>"},
    "w4":{"file":"collision-w4.json","bytes":123,"sha256":"<64 hex>"},
    "w5":{"file":"collision-w5.json","bytes":123,"sha256":"<64 hex>"},
    "w6":{"file":"collision-w6.json","bytes":123,"sha256":"<64 hex>"}
  }
}
```

위 byte/hash 값은 shape 설명용이다. 실제 build가 측정한 값을 사용한다. Config의 `assets.source`는 검토한 release source hash를 명시적으로 pin한다. Manifest source와 선언된 모든 artifact의 exact filename, byte 수, SHA256을 검사한다. 활성 world는 collision schema/world/source/cell 수까지 검사한다. Catalog가 다시 읽은 실제 artifact hash도 manifest와 비교해 loading 중 변경을 감지한다. HTTP URL, 경로 이동 filename, source mismatch, 과대 파일, 누락 파일을 허용하지 않는다.

`assets` 필수값은 `source`, `manifest:"world-manifest.json"`이다. 기술 budget 기본값은 artifact당16MiB, 합계64MiB, manifest16KiB, artifact당1,000,000 cells다. `maxBakeBytes`, `maxTotalBakeBytes`, `maxManifestBytes`, `maxCells`로 각각 최대128MiB/256MiB/64KiB/4,000,000까지 override할 수 있다. 이들은 게임 balance 값이 아니다.

## Operational 기본값

`limits`, `areaLimits`, `persistence`, `ownership.heartbeatMs/queryTimeoutMs`만 bounded 기술 기본값을 제공한다. 일부 필드만 override할 수 있고 잘못된 값이나 알 수 없는 필드는 거부한다.

| 그룹 | 기본값 |
| --- | --- |
| `limits` timing(ms) | auth5000, input400, reconnectGrace30000, sessionRevalidate30000, checkpointInterval1000, loopInterval5 |
| `limits` capacity | maxConnections2000, perIp16, maxWaiting1000, maxQueuedInputs128, maxMutationSourcesPerTick128 |
| `limits` bytes | maxAuthFrame1024, maxFrame65536, maxBuffered4194304 |
| `areaLimits` | eventCount16384, inputCommandsPerTick32, timers4096, projectiles4096 |
| `persistence` | maxQueuedPerCharacter1, maxAttempts3, retryMs100, maxRecoveryRounds2 |
| `ownership` | 필수 key, heartbeat1000ms, queryTimeout1000ms |

최대 connection/waiting10000, queued input1024, mutation sources256, input commands32, inbound frame2MiB, auth frame64KiB, recovery rounds32로 제한된다. 세부 검증은 `validateWorldConfig`가 단일 원본이다. 현재 slot100/public4 및 전체 Area mutation bound를 기술 설정으로 우회할 수 없다.

## 로컬 QA용 설정 예제

다음 수치는 startup smoke test용이다. 생산 monster level/population/respawn 승인값이 아니다. `<SOURCE_SHA>`를 manifest와 일치하는 검토된 실제 hash로 바꿔야 유효하다.

```json
{
 "schema":"world-startup-v1",
 "ownership":{"key":"local-qa-world"},
 "assets":{"source":"<SOURCE_SHA>","manifest":"world-manifest.json"},
 "worlds":{
  "w1":{"seed":1,"populationMode":"fixed-slots","fixedLevels":{"scrapling":1,"scavenger":2,"jellyfish":2,"echo":10},"population":{"scrapling":1,"scavenger":0,"jellyfish":0,"shallowPatrols":0},"respawnSeconds":{"scrapling":300,"scavenger":301,"jellyfish":302,"echo":120}},
  "w2":{"seed":2,"populationMode":"fixed-slots","fixedLevels":{"scrapling":1,"scavenger":2,"jellyfish":2,"echo":10},"population":{"scrapling":1,"scavenger":0,"jellyfish":0,"shallowPatrols":0},"respawnSeconds":{"scrapling":300,"scavenger":301,"jellyfish":302,"echo":120}},
  "w3":{"seed":3,"populationMode":"fixed-slots","fixedLevels":{"scrapling":1,"scavenger":2,"jellyfish":2,"echo":10},"population":{"scrapling":1,"scavenger":0,"jellyfish":0,"shallowPatrols":0},"respawnSeconds":{"scrapling":300,"scavenger":301,"jellyfish":302,"echo":120}},
  "w4":{"seed":4,"populationMode":"fixed-slots","fixedLevels":{"scrapling":1,"scavenger":2,"jellyfish":2,"echo":10},"population":{"scrapling":1,"scavenger":0,"jellyfish":0,"shallowPatrols":0},"respawnSeconds":{"scrapling":300,"scavenger":301,"jellyfish":302,"echo":120}}
 },
 "victimOutcome":{"maxEntries":1024,"maxPayloadBytes":4194304,"timeoutMs":3000},
 "chat":{"maxPending":16},
 "restore":{"cooldowns":"pause","statuses":"pause","death":"pause","history":"pause","hp":"preserve","resource":"preserve","location":"saved","activity":"cancel"},
 "party":{"enabled":false}
}
```

## Ownership과 cleanup

설정, manifest, 실제 artifact 4개, catalog, identity codec, gameplay protocol의 static loading에 성공한 뒤 전용 PG session의 advisory ownership을 획득한다. 조립 실패 시 guard를 release하고, release에서 발생한 오류도 보고한다. 새 admission registry를 만들지 않고 account HTTP와 같은 객체를 host에 전달한다.

Main이 shutdown을 소유한다. `host.stopAdmission()`, `host.shutdown(deadlineMs)` 결과 확인, `ownership.release()`, pool 종료 순서를 따른다. Startup 자체는 pool을 종료하지 않는다. 공개 NPC visibility는 공유 `personalNpcVisible`, feature/achievement/recovery projection은 공유 `projectObservationExtras`를 사용하며, 테스트 전용 별도 구현을 사용하지 않는다.


## 보상 저장과 계정 채팅

`victimOutcome`의 `maxEntries`, `maxPayloadBytes`, `timeoutMs`와 `chat.maxPending`은 명시적으로 설정한다. 문서 예시는 QA 자원 예산이며 보상 대상 자격을 제한하지 않는다. outcome 예산 초과는 전체 source를 보존하고 실패를 닫으며 부분 ACK나 부분 저장을 허용하지 않는다. 계정 chat은 같은 PG pool의 WorldChatService로 연결하고 pending 수를 제한한다. 선택적 `victimOutcomeRetryCeiling`은 초기 예산 이상의 세 값을 모두 지정한다. 내부 재시도 상한이며 HTTP 조작 API는 제공하지 않는다.


## 별도 ledger 환경변수

후속 host는 선택적 `WORLD_LEDGER_CONFIG_JSON`을 받는다. 기존 `WORLD_CONFIG_JSON`은 그대로 두어 구버전 strict parser의 rollback 호환성을 유지한다. 새 변수를 생략하면 retained 경로를 보존하며, 외부 ledger 운영 전환을 자동으로 승인하거나 실행하지 않는다. 명시한 경우 `schema:world-ledger-v1`, `queryTimeoutMs`, `sourceLimits`, `drainLimits`, `recoveryLimits`, `recoveryIntervalMs`를 모두 검증한다. 런타임은 실제 `DurableOutcomeStore`와 canonical `planOutcomePage`를 주입하고 `host.ready()`가 현재 발견된 startup draft를 복구한 뒤에 반환한다. 늦은 옛 writer의 commit은 반복 bounded recovery로 처리하며 fencing으로 설명하지 않는다.

`sourceLimits`는 `maxDirtyCreditEntries`, `maxDirtyCreditBytes`, `maxPendingDeaths`, `maxStagedBytes`를 요구한다. 실제 Area constructor가 public100/private8과 모든 설정된 private variant의 최대 roster 용량을 입장 전에 검사한다. `drainLimits`는 `pageSize`, `creditBatchesPerSlice`, `outcomesPerSlice`, `summaryVictimsPerSlice`, `writeAttempts`, `recoveryLimits`는 `draftsPerSlice`, `pageSize`를 요구한다. 페이지/작업 수는1~100이다. query timeout과 recovery interval은 Node timer 범위 안의 양수 정수다. 수치는 운영 승인값을 추정하지 않고 명시적으로 제공한다.

007 migration 전체 commit이 끝나기 전에는 staging을 켜지 않는다. 이 환경변수와 VM 설정은 구현 세션이 직접 설치하지 않는다.
