# Actual world startup configuration

`server/world/startup.ts`는 환경변수를 읽거나 HTTP listener를 열지 않는다. Root main이 `WORLD_ENABLED=1`일 때 필수 `WORLD_CONFIG_JSON`을 JSON으로 파싱해 전달한다. 설정 누락, 알 수 없는 필드, 잘못된 값, 명시적 `null`, 지원하지 않는 정책은 시작 실패로 처리한다. `WORLD_ENABLED`를 생략한 상태에서 legacy 서비스의 동작은 바꾸지 않는다.

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

최상위 schema는 `world-startup-v1`이다. `ownership`, `assets`, `worlds`, `restore`가 필수다. 선택 필드 `characters:{maxCharactersPerAccount:<positive safe integer>}`는 명시적 account별 생성 cap을 전달한다. 생략 또는 빈 객체는 생성 API의 503 disabled 상태다. Slot 기본값은 없다. Root main이 `runtime.config.characters ?? {}`를 `createCharacterHandler`의 `policy`로 전달한다. `worlds`에는 `w1`, `w2`, `w3`, `w4`가 모두 있어야 한다.

각 world의 필수 필드:

| 필드 | 의미와 검증 |
| --- | --- |
| `seed` | Area별 명시적 uint32 seed |
| `populationMode` | 현재 지원값 `fixed-slots`만 허용 |
| `fixedLevels` | `scrapling`, `scavenger`, `jellyfish`, `echo`의 명시적 양의 safe integer 레벨 |
| `population` | `scrapling`, `scavenger`, `jellyfish`, `shallowPatrols`의 명시적 0 이상 정수 slot 수 |
| `respawnSeconds` | 위 4개 enemy kind/echo별 명시적 양의 유한 초 |

레벨, spawn 수, respawn 시간의 생산 기본값은 없다. `fixed-slots`는 이미 선언된 각 slot의 `desired=1`을 사용하며 nearby-player 밀도 곡선을 구현하지 않는다. Spawn pool은 설정 수로 제한된다. `shallowPatrols`는 별도 source spawn 역할이고 scrapling 레벨/respawn 시간을 사용한다. Echo는 echo 레벨/respawn 설정과 기존 World II 45/120초 규칙을 함께 따른다. Party 보스 add의 실제 encounter 규칙은 별도다.

`population` 합계와 실제 생성된 enemy 수 모두 `limits.maxMutationSourcesPerTick <= 256` 이하여야 한다. 원본 layout이 지형 조건에 따라 일부 jellyfish template을 찾지 못하면 실제 목록이 요청 수보다 적을 수 있다. 조용히 population을 늘리거나 다른 template으로 대체하지 않는다. 새로운 density 알고리즘 이름이나 알 수 없는 필드는 거부한다. 실제 enemyStats에서 계산한 HP/XP/damage 등 숫자가 finite-safe 범위를 벗어나면 ownership 획득 전에 시작을 거부한다. 임의의 level cap으로 정규화하지 않는다.

Public은 실제 4개 world, world별 capacity100, PvP disabled다. 이 값들은 현재 host/core 계약에서 온다. Startup policy는 모든 player-to-player damage를 거부한다. `party`를 생략하거나 `{"enabled":false}`로 두면 party가 disabled다. 현재 startup checkpoint는 `enabled:true`를 거부한다. Party owner의 실제 host 지원, 명시적 maxParties/maxEncounters와 각 profile의 return POI 정책이 연결된 별도 checkpoint 전에는 활성화할 수 없다.

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

Root build는 `server-dist/world/`에 실제 collision JSON 4개와 `world-manifest.json`을 함께 배치한다. 4개 원본 JSON의 common source가 다르면 build가 실패해야 한다.

```json
{
  "format":"crabcraft-world-manifest",
  "version":1,
  "source":"<reviewed common 64-lowercase-hex SHA>",
  "artifacts":{
    "w1":{"file":"collision-w1.json","bytes":123,"sha256":"<64 hex>"},
    "w2":{"file":"collision-w2.json","bytes":123,"sha256":"<64 hex>"},
    "w3":{"file":"collision-w3.json","bytes":123,"sha256":"<64 hex>"},
    "w4":{"file":"collision-w4.json","bytes":123,"sha256":"<64 hex>"}
  }
}
```

위 byte/hash 값은 shape 설명용이다. 실제 build가 측정한 값을 사용한다. Config의 `assets.source`는 검토한 release source hash를 명시적으로 pin한다. Manifest source, 4개 exact filename, byte 수, SHA256, collision schema/world/source/cell 수를 모두 검사한다. Catalog가 다시 읽은 실제 artifact hash도 manifest와 비교해 loading 중 변경을 감지한다. HTTP URL, 경로 이동 filename, source mismatch, 과대 파일, 누락 파일을 허용하지 않는다.

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
  "w1":{"seed":1,"populationMode":"fixed-slots","fixedLevels":{"scrapling":1,"scavenger":2,"jellyfish":2,"echo":10},"population":{"scrapling":1,"scavenger":0,"jellyfish":0,"shallowPatrols":0},"respawnSeconds":{"scrapling":300,"scavenger":301,"jellyfish":302,"echo":303}},
  "w2":{"seed":2,"populationMode":"fixed-slots","fixedLevels":{"scrapling":1,"scavenger":2,"jellyfish":2,"echo":10},"population":{"scrapling":1,"scavenger":0,"jellyfish":0,"shallowPatrols":0},"respawnSeconds":{"scrapling":300,"scavenger":301,"jellyfish":302,"echo":303}},
  "w3":{"seed":3,"populationMode":"fixed-slots","fixedLevels":{"scrapling":1,"scavenger":2,"jellyfish":2,"echo":10},"population":{"scrapling":1,"scavenger":0,"jellyfish":0,"shallowPatrols":0},"respawnSeconds":{"scrapling":300,"scavenger":301,"jellyfish":302,"echo":303}},
  "w4":{"seed":4,"populationMode":"fixed-slots","fixedLevels":{"scrapling":1,"scavenger":2,"jellyfish":2,"echo":10},"population":{"scrapling":1,"scavenger":0,"jellyfish":0,"shallowPatrols":0},"respawnSeconds":{"scrapling":300,"scavenger":301,"jellyfish":302,"echo":303}}
 },
 "restore":{"cooldowns":"pause","statuses":"pause","death":"pause","history":"pause","hp":"preserve","resource":"preserve","location":"saved","activity":"cancel"},
 "party":{"enabled":false}
}
```

## Ownership과 cleanup

설정, manifest, 실제 artifact 4개, catalog, identity codec, gameplay protocol의 static loading에 성공한 뒤 전용 PG session의 advisory ownership을 획득한다. 조립 실패 시 guard를 release하고, release에서 발생한 오류도 보고한다. 새 admission registry를 만들지 않고 account HTTP와 같은 객체를 host에 전달한다.

Main이 shutdown을 소유한다. `host.stopAdmission()`, `host.shutdown(deadlineMs)` 결과 확인, `ownership.release()`, pool 종료 순서를 따른다. Startup 자체는 pool을 종료하지 않는다. 공개 NPC visibility는 공유 `personalNpcVisible`, feature/achievement/recovery projection은 공유 `projectObservationExtras`를 사용하며, 테스트 전용 별도 구현을 사용하지 않는다.
