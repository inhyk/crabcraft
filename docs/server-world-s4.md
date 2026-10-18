# S4 공유 월드 네트워크 준비

`server/world/`는 프로덕션에 연결하지 않은 독립 네트워크 모듈이다. 현재 `/multiplayer`, 계정 API, 기존 게임 코드는 사용하지 않는다. `fixture.ts`는 합성 위치 이동만 계산하며 실제 `SimArea`, 충돌, 전투, XP, 계정 인증을 실행하지 않는다. 이 문서와 부하 도구의 수치는 실제 게임 전투나 VM 성능의 근거가 아니다.

## 실행

Node 24와 pnpm 10.10.0을 사용한다. 새 dependency나 lockfile 변경은 없다.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test:world
pnpm load:world --seconds 10
pnpm load:world --clients 100 --seconds 60 --idle-seconds 1 --warmup-seconds 1
```

`load:world` 기본값은 별도 Node 프로세스의 fixture 1개, 실제 WebSocket 클라이언트 100개, 준비 1초, 측정 10초, 입력 정지 1초다. `--clients`는 1부터 100, 측정 시간은 1초부터 300초, idle은 0.3초부터 300초다. 외부 서버 URL 옵션은 없다. fixture는 `127.0.0.1` 또는 명시한 `::1`에만 bind한다. 기본 port는 OS가 할당한다. 계정 로그인 설정과 프로덕션 route는 추가하지 않는다.

## Snapshot v2

`protocol.ts`의 `ClientStream.encode(tick, entities, forceFull = false, ack = 0)`는 새로 소유한 `Uint8Array`를 반환한다. 다른 호출이나 클라이언트가 이전 packet 내용을 바꾸지 않는다. `ack`는 해당 클라이언트의 마지막 소비한 입력 sequence다. 수신하거나 queue에 넣은 것만으로 ack를 올리지 않는다. fixture는 tick에서 이동 입력을 적용하거나 action queue를 소비한 뒤 ack를 올린다. 교체된 오래된 이동 입력은 최신 이동 입력에 합쳐진다.

정수는 little endian이다. Header 크기는 30 bytes다.

| Offset | 형식 | 값 |
|---|---|---|
| 0 | u16 | magic `0x4357` |
| 2 | u8 | version `2` |
| 3 | u8 | full `1`, delta `2` |
| 4 | u32 | epoch, 1 이상 |
| 8 | u32 | sequence, 1 이상 |
| 12 | u32 | baseline, full은 0 |
| 16 | u32 | server tick |
| 20 | u32 | 소비한 입력 ack |
| 24 | u32 | recipient selfId, 범용 codec에서는 0 허용 |
| 28 | u16 | record count |

각 record는 `id u32`, `mask u8`, mask가 가리키는 필드를 아래 순서로 담는다. ID는 1 이상이다.

| Mask | 필드 | 단위와 범위 |
|---|---|---|
| 1 | x i16, y i16, z i16 | x/z 1/16m, y 1/64m |
| 2 | yaw u8 | 1/256회전, modulo 2π 후 반올림 |
| 4 | hp u32 | 0부터 maxHp |
| 8 | flags u8 | 0부터 127, bit0 alive, bit1 hidden, 나머지 bit는 adapter에서 정의 |
| 16 | stunTick u32, slowTick u32, slowPct u8, rust u8, rustTick u32 | 절대 종료 tick, slowPct 0부터 100 |
| 32 | maxHp u32, level u16 | 둘 다 1 이상 |
| 128 | payload 없음 | 기존 entity 제거, 다른 mask와 결합 금지 |

full의 모든 record와 delta의 신규 entity는 mask63으로 전체 필드를 보낸다. 기존 entity는 바뀐 필드만 보낸다. 상태는 최대 2048 entities다. full record는 최대 2048개, delta record는 최대 4096개로 기존 2048개 제거와 신규 2048개 진입을 함께 처리한다. packet 상한은 131072 bytes다. 중복 ID, 미지원 version/type/mask, 정수 overflow, NaN/Infinity, 좌표 범위 초과, 잘린 payload, 추가 bytes, 존재하지 않는 entity의 partial update/remove는 거부한다. 좌표를 clamp해서 숨기지 않는다. `quantizeEntity`와 `dequantizeEntity`로 단위를 변환한다.

`SnapshotReceiver.apply(bytes)`는 전체 decode와 다음 상태 검증이 끝나야 map과 epoch/sequence/tick/ack를 교체한다. 실패하면 기존 상태 객체와 metadata를 보존한다. entity 값은 freeze한 quantized 값이고 `state`의 타입은 읽기 전용 map이다. 외부에서 map을 강제로 변경하지 않는 것이 API 계약이다.

첫 packet은 full이어야 한다. delta는 epoch, selfId, baseline이 현재 수신 상태와 같고 sequence가 baseline+1이어야 한다. 같은 epoch에서 sequence 증가, tick과 ack 비감소를 검사한다. stale full과 낮아진 epoch도 거부한다. 누락을 감지한 adapter는 full을 요청해야 하며 WebSocket reliable delivery 자체를 recovery 계약으로 간주하지 않는다. `forceFull`은 같은 epoch에서 최신 상태로 복구한다. `ClientStream.reset()`은 epoch를 올리고 sequence, baseline, ack를 초기화한다. 새 연결에는 새 receiver 또는 명시적 `receiver.reset()`을 쓴다. u32 wrap은 허용하지 않으므로 adapter는 상한 전에 stream을 교체해야 한다. stream 인스턴스는 연결별로 둔다.

## AOI

`AoiGrid(radius = 80, hysteresis = 8, cellSize = 16)`는 x/z의 16m grid다. `rebuild(entities)`는 입력 검증 후 한 번에 index를 바꾼다. `query(visibility, previousIds)`는 처음에는 거리 80m 이하, 직전 보이던 entity는 88m 이하에서 보낸다. 원형 거리로 검사하고 음수 cell 좌표도 처리한다. 결과는 ID 순서다.

`visibility`는 `{ selfId, partyIds?, targetId?, engagedBossId? }`다. 이 값은 미래의 서버 adapter가 결정하며 클라이언트의 권한 주장이 아니다. self, party, 현재 target, 교전 중 boss는 거리와 hidden 상태에 관계없이 보낸다. 그 외 hidden entity는 거리 안에서도 제외하고 기존 view에서도 제거한다. party/target/boss 변경은 매 query에 반영한다. view에서 사라진 ID는 ClientStream이 remove로 보내고 재진입은 전체 record로 보낸다. fixture는 self pin만 사용하고 나머지 pin은 모듈 테스트에서 검증한다.

## 입력

`intents.ts`의 `encodeIntent`/`decodeIntent`는 위치나 전투 결과를 받지 않는다. 공통 prefix는 snapshot과 같은 magic/version 뒤 kind, 이어지는 sequence u32다. sequence는 1부터 u32 상한까지이며 연결 안에서 증가한다. packet 길이는 정확히 일치해야 한다.

| Kind | Bytes | Payload |
|---|---|---|
| move `16` | 13 | x i8, z i8, yaw u16, flags u8 |
| action `17` | 14 | action u8, slot u8, target u32 |

이동 축은 -127부터 127을 -1부터 1로 변환하고 -128은 거부한다. yaw는 1/65536회전이다. flags의 bit0은 sprint 요청, bit1은 jump 요청이다. action1은 공격 요청, action2는 ability 요청이며 slot은 0부터 7이다. target0은 미지정이다. encoder는 `damage`, `xp`, `position`, `hp`를 포함한 미지원 필드를 거부한다. binary decoder에는 이 필드를 전달할 공간이 없다.

`IntentSession.accept(bytes, nowSeconds)`는 stale sequence, 시계 역행, token bucket(초당 60, burst120), action queue4개 상한을 검사한다. 이동은 최신 입력 하나로 합치고 action은 `drainActions()`로 소비한다. 수락은 권한 검증이나 전투 적용을 뜻하지 않는다. 미래 adapter는 계정과 connection binding, 사망/상태/거리/target/ability cooldown을 서버에서 검사해야 한다. fixture는 3m/s 이동, sprint 요청이면 6m/s, 250ms 입력 timeout을 사용한다. jump의 물리, 충돌, 피해, HP 변화는 실행하지 않는다. action은 합성 action event만 만든다.

## Event v2

`events.ts`는 S1 runtime을 import하지 않는 adapter용 출력 계약이다. prefix kind는3이다. 뒤에는 epoch u32, sequence u32, tick u32, count u16으로 총18 bytes header다. 한 packet은 최대256 events다.

| Event code | kind | Payload |
|---|---|---|
| 1/2 | damage/heal | source u32, target u32, amount u32(0부터1000000) |
| 3 | death | target u32 |
| 4/5 | action/cast | source u32, target u32, code u8 |
| 6 | telegraph | source u32, x i16, z i16, radius u16, durationTicks u16 |
| 7 | result | source u32, target u32, code u8, success u8(0/1) |

source/target은 1 이상이다. telegraph 좌표와 radius는1/16m, radius는1부터16000, durationTicks는1부터1800이다. `EventReceiver.apply`는 같은 epoch에서 정확한 sequence+1, tick 비감소를 요구한다. 새 epoch는 sequence1로 시작하며 낮은 epoch와 순서 누락을 거부한다. decode가 실패하면 receiver metadata가 바뀌지 않는다. fixture는 요청한 action과 매30tick의 합성 cast pulse만 보낸다. damage/heal/death/telegraph/result는 codec 테스트에서만 검증하며 실제 게임 의미는 S2 통합에서 정한다. event 유실 후 과거 효과를 복원하는 프로덕션 정책도 통합 범위다.

## Fixture, 측정, 종료

`startFixture({ host?, port?, maxClients? })`는 `{ url, stats(), close() }`를 반환한다. 기본 정원은100이고 초과 connection은 code1013으로 종료한다. 설정 가능한 정원도100 이하이며 새 shard나 대기열을 자동 생성하지 않는다. 프로덕션의100+ 대기 정책은 미구현이다. WebSocket maxPayload는64 bytes이고 text/잘못된 입력은 거부한다. 느린 클라이언트의 bufferedAmount가1MiB를 넘으면1013으로 종료한다.

simulation deadline은30Hz 고정 dt, snapshot deadline은20Hz다. tick catch-up은 한 번에4개, snapshot은1개까지만 처리하고 밀린 deadline은 dropped counter에 남긴다. 클라이언트가0이면 tick과 snapshot을 진행하지 않으며50ms timer로 대기한다. load 도구는 idle 중 위치 정지와 마지막 입력 ack 도달, 연결 해제 후 tick 정지를 검사한다. fixture 종료는 모든 socket과 timer를 닫으며 load 도구는 child의 실제 exit0을 확인한 뒤 성공을 반환한다. 실패 경로도 socket을 닫고 child가 종료하지 않으면 kill한다.

JSON 결과의 의미는 다음과 같다.

- `serverCpuUserMs`, `serverCpuSystemMs`, `serverCpuPercent`: fixture 프로세스의 누적 CPU. bot 프로세스 CPU는 제외한다. `measuredCpuMs`/`measuredCpuPercent`는 준비 후 측정 구간의 차이다.
- `tickMs`: 합성 이동, 입력 소비, 합성 event send의 tick 시간 p50/p99다. 실제 전투 비용이 아니다.
- `encodeMs`: recipient 한 명의 AOI query와 encode 시간 p50/p99다. `snapshotBatchMs`는 grid rebuild부터 전체 recipient encode/send까지 한20Hz batch의 시간이다. send 완료나 네트워크 RTT는 측정하지 않는다. latency 표본은 준비와 idle을 포함한 fixture 수명 기준이며 각 배열은100000개로 제한한다.
- `bytesSent`/`bytesReceived`: WebSocket payload bytes다. frame/TCP/TLS overhead는 제외한다. server와 client 양쪽 값 및 packet/event/intent 수를 기록한다. Whole-run totals는 모든 bot socket의 정상 close가 끝나고 fixture를 닫은 동일한 종료 경계에서 확정한다. server.activeClients는 이 경계의0이고 activeClientsBeforeClose는 입력 정지 확인 후 연결 종료 전 수다. 두 방향의 payload bytes와 packet 수, snapshot 수, event packet 수, event 수, action event 수가 정확히 일치해야 통과하며 허용 오차는 없다. 강제 bot 종료나 child exit 실패도 통과시키지 않는다. JSON windows가 totals, client rate, measured CPU, latency 표본의 시간 범위를 구분한다.
- `acceptedIntents`는 decode/rate/queue 수락 수, `appliedIntents`는 tick에서 소비한 입력 수다. 이동 coalescing 때문에 같을 필요가 없다. `rejectedPackets`/`invalidPackets`는 잘못된 packet, stale/rate/queue 거부와 ws payload 오류를 집계한다.
- `activeClients`, `peakClients`, `rejectedClients`, `backpressureDisconnects`, `droppedTicks`, `droppedSnapshots`로 정원과 부하 이탈을 확인한다.
- 각 bot은 snapshot을 decode/apply하고 HP, 좌표, 자기 ID, 소비 ack, event sequence를 검사한다. 준비 후 client별14Hz부터26Hz snapshot, 초당10회 이상 ack 증가, 측정 구간에 client별 초당0.7회 이상의 action/event 수신이 없거나 마지막 action/event가1.5초 넘게 오래되면 실패한다. 준비 구간에서 받은 event만으로 통과시키지 않는다. 100ms watchdog은 snapshot 공백1초와 입력 전송 중 action/event 공백1.5초를 연속 감시한다. 측정 중 잠깐 멈췄다가 복구한 stream도 실패로 남긴다. baseline/event 순서가 깨져도 실패한다. 성공 결과의 `invalidPackets`와 `staleOrMissingStreams`는0이어야 한다. 단지 연결 수나 server send count만으로 통과시키지 않는다.

## 검증과 남은 통합

`pnpm test:world`는 full/delta/remove/re-entry, packet 소유권, 수치 범위, 모든 byte offset truncation, 악성 입력, stale/missing baseline, full recovery, reset,2048개 전체 교체,80/88m 경계, hidden/party/target/boss, rate/queue, event7종, bounded scheduler를 검사한다. lifetime entity ID가 u32 상한까지 증가해도 spawn 좌표가 bounded인 것과 parent IPC 단절 후 exit0도 검사한다. 실제 socket의 bind guard, 정원 초과, malformed/text/oversized 입력, 정상 client 유지와 별도 프로세스100-client 검증도 실행한다. `.github/workflows/world-network.yml`은 Node24에서 build, 모듈 검사,10초 부하 검증을 실행하고 JSON artifact를 남긴다.

S2 이후 필요한 작업은 실제 SimArea state/event adapter, account와 connection binding, 권한과 cooldown 검증, self prediction/reconciliation, full recovery 요청 경로, map/area 이동, production 대기열, VM 측정이다. 이 PR은 해당 항목이나 실제100명 전투 성능을 완료했다고 주장하지 않는다.
