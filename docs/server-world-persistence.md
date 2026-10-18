# 서버 캐릭터 저장 준비

작성자: 지수

이 문서는 `server/world/character-store.ts`와 migrations `004_world_characters.sql`, `005_world_victim_outcomes.sql`의 저장 계약을 설명한다. 실제 world host, 로그인 경로, simulation checkpoint adapter는 아직 연결하지 않았다. 이 저장 테스트만으로 S6 또는 서버 세계 전환이 끝났다고 판단하지 않는다.

## 결정과 경계

`docs/server-world.md` 6장에 따라 새 캐릭터는 Google 계정에 연결하고 level 1부터 시작한다. `accounts.username` FK를 재사용한다. `accounts.save`는 기존 browser 저장 경로에 남고 이 저장소에서 읽거나 가져오지 않는다. appearance와 class 검증, 새 level-1 상태 생성은 실제 core를 아는 필수 codec이 맡는다. 저장소가 별도 quest 규칙이나 XP 계산을 만들지 않는다. 모든 기여자에게 온전한 보상을 주는 자격 판정과 수치 계산은 실제 simulation과 host의 책임이다.

생성되는 character ID는 UUID v4이며 DB 전체에서 유일하다. 소유권 검사는 모든 API에서 account ID와 character ID를 함께 사용한다. 인증은 호출 전에 host가 수행해야 한다. 이 모듈에는 HTTP endpoint, session resolver, browser 진행 입력이 없다. 이 클래스는 신뢰된 서버 내부 코드에서만 호출한다.

캐릭터 슬롯 수, 생성 재설정이나 삭제 정책을 새로 정하지 않는다. 공개 생성 HTTP는 명시된 policy.maxCharactersPerAccount를 createBounded에 전달하며 policy 없이는 닫는다. 자세한 경로와 DTO는 [서버 캐릭터 HTTP](server-world-characters-http.md)에 적었다. schema는 여러 identity를 저장할 수 있고 목록은 페이지로 조회한다. 입장 제한과 슬롯 정책은 후속 host 작업에서 정한다. character와 grant를 지우는 API가 없으며 정리 작업도 추가하지 않았다.

## 필수 codec

`new CharacterStore(pool, codec)`은 다음 함수가 빠지거나 version이 올바르지 않으면 거부한다. 허용적인 기본 codec은 없다.

| 필드 | 책임 |
| --- | --- |
| `version` | identity, checkpoint, earned grant의 양의 정수 schema 버전 |
| `validateIdentity(value)` | class와 appearance catalog, 필드와 범위를 검증한 JSON identity 반환 |
| `fresh(context)` | 해당 account와 character의 새 level-1 서버 상태 생성 |
| `validateCheckpoint(value, context)` | 실제 durable core state와 identity binding을 검증한 JSON 반환 |
| `validateGrant(value, context)` | 해당 캐릭터가 얻은 서버 보상의 구조와 수치 범위 검증 |

codec은 순수하고 결정적으로 동작하며 성공 시 독립된 JSON 값을 반환해야 한다. level-1 불변식, XP와 coin의 의미, quest와 flags, identity와 checkpoint의 일치는 실제 adapter에서 검증해야 한다. codec 검증을 통과했다고 호출자의 수치 계산이 올바른지 저장소가 증명하지는 않는다. `saveCheckpoint`의 grant ID는 서버가 이미 core에 적용한 보상만 전달한다.

현재 `TransferDTO`는 살아 있고 이동 가능한 actor의 지역 전환 형식이다. dead, seated, village-playing 상태의 영속 형식으로 사용하지 않는다. 후속 adapter는 실제 core API로 durable 진행과 ephemeral 전투 상태를 구분하고 이 상태들의 persist/restore를 검증해야 한다. 테스트 codec의 단순 `mode` 필드는 저장 경계의 시험 값이며 production projection이 아니다. offline 경과 시간, cooldown과 clock 복원 정책은 아직 정하지 않았다.

## API

| 호출 | 결과와 제약 |
| --- | --- |
| `createBounded(accountId, identity, maxCharactersPerAccount)` | 명시 public policy에 따른 계정 잠금/count/생성을 같은 client transaction에서 수행 |
| `create(accountId, identity)` | 기존 계정 FK 확인, 검증된 identity와 codec의 fresh 상태, revision 0 저장 |
| `listOwned(accountId, {after?, limit?})` | character ID 기준 정렬, UUID cursor, 기본 100개와 최대 100개 |
| `getOwned(accountId, characterId)` | 소유한 identity, checkpoint, revision과 검증된 updatedAt(ms) 조회 |
| `getOwner(characterId)` | trusted offline core recipient의 account ID만 조회, client endpoint에 노출하지 않음 |
| `recordGrantBatch(entries)` | 기존 최대 100개 trusted batch 호환 API, lifetime outcome 전체 상한을 뜻하지 않음 |
| `recordVictimOutcome(entries, resources)` | 전체 victim lifetime의 N개 entitlement와 immutable count/digest seal을 한 transaction으로 저장 |
| `recordGrant(accountId, characterId, id, payload)` | immutable journal 기록, 같은 ID와 같은 recipient/version/JSON 의미는 동일 결과, 다른 내용은 오류 |
| `pendingGrants(accountId, characterId, {after?, limit?})` | receipt가 없는 journal을 sequence cursor로 조회, 기본 100개와 최대 100개 |
| `saveCheckpoint(accountId, characterId, revision, checkpoint, appliedGrantIds)` | CAS revision 확인, checkpoint와 최대 256개 receipt를 하나의 transaction으로 저장 |
| `loadForRecovery(accountId, characterId, ids)` | character 공유 잠금 아래 checkpoint와 최대 256개 grant의 applied revision을 일관되게 조회 |

`appliedGrantIds`는 중복 없이 해당 recipient에게 이미 journal된 ID여야 한다. 이미 적용된 ID를 다시 저장하려 하면 `already_applied` 오류가 난다. CAS 실패는 `conflict`이며 grant ID를 새로 만들어 우회하지 않는다. journal cursor는 PostgreSQL bigint의 문자열이다. pending 마지막 페이지를 읽었다고 이후 journal 기록이 없다는 뜻은 아니다. 더 오래된 ID부터 다시 조회해도 적용된 것은 receipt로 제외된다.

grant ID는 1..512 UTF-8 bytes로 제한하고 NUL, C0/C1 제어 문자, 단독 surrogate를 거부한다. 괄호와 따옴표를 포함하는 core의 `JSON.stringify([area,id,life,character])` 문자열을 변환 없이 보존한다. Unicode 문자도 허용하며 SQL parameter로 전달한다.

identity는 4 KiB, checkpoint는 256 KiB, grant payload는 16 KiB로 제한한다. JSON은 최대 깊이 32와 노드 32,768개를 허용하며 finite number, plain object, dense array만 받는다. 배열의 각 own key가 실제 `0..length-1` 인덱스인지 확인하므로 범위 밖 숫자 모양 property로 빈 칸을 가릴 수 없다. 이 검사는 호출 입력과 codec 반환값에 모두 적용한다. undefined, BigInt, NaN, Infinity, 순환 참조, accessor, 비 JSON 객체를 거부한다. 저장된 행도 조회 시 같은 검증과 codec을 거치며 schema version이 다르거나 손상되면 실패한다. 지원하지 않는 version을 자동 변환하지 않는다.

## 보상 transaction과 실패 복구

호스트의 정상 순서는 다음과 같다.

1. 한 death의 lifetime 전체 entitlement를 안정된 ID와 trusted recipient로 모아 `recordVictimOutcome`에 기록하고 commit을 기다린다. 동접 100명이어도 떠난 기여자가 남으므로 전체 N은 100을 넘을 수 있다. N을 자르거나 여러 transaction으로 나누어 일부 성공을 earned outcome으로 발표하지 않는다.
2. 실제 core가 이미 적용한 `appliedHere` grant는 receipt가 없다는 이유로 다시 적용하지 않는다. 현재 owner의 state에 해당 적용이 포함되는지 확인한다. 아직 적용되지 않은 offline/transferred grant만 between-tick owner boundary에서 실제 core의 receiveGrant로 적용한다.
3. 같은 core 상태에서 checkpoint를 캡처한다.
4. 그 checkpoint와 적용한 journal ID를 `saveCheckpoint`로 함께 commit한다.
5. commit을 확인한 뒤 source에 ACK한다.

새 whole-outcome API와 기존 batch API는 canonical victim key의 advisory transaction lock을 정렬해 먼저 잡고, 모든 recipient character를 UUID순으로 잠근 후 global grant ID순으로 삽입한다. JSON 의미가 같은 재시도는 기존 journal을 반환하며 recipient, version, payload 충돌이나 중간 SQL 실패 시 전체를 rollback한다. 기존 `recordGrant`도 같은 batch 경로에 entry 1개로 위임한다. 저장소는 전달된 집합의 원자성을 제공하며 실제 모든 기여자가 포함됐는지는 core와 host가 증명해야 한다.

`MAX_GRANT_BATCH_ENTRIES=100`은 기존 API 호환 범위이며 victim lifetime 기여자 상한이 아니다. `MAX_CHECKPOINT_GRANT_RECEIPTS=256`은 한 캐릭터가 포함하는 미저장 적용 grant 수의 별도 경계다. 한 checkpoint에는 그 state가 포함하는 모든 새 grant의 정확한 receipt가 함께 있어야 한다. 이미 256개를 넘게 적용한 최종 state를 여러 save에 반복해 넣으며 receipt만 나누면 안 된다. 첫 save 후 crash하면 나머지 grant가 중복 적용된다. host가 적용 전 또는 reward tick 경계에서 uncommitted grant 수를 제한하고 한도를 넘기기 전에 barrier를 걸어야 한다. 저장소는 checkpoint 수치만 보고 누락된 receipt를 추론하지 않는다.

journal 기록만 끝나고 호스트가 죽으면 pending grant가 DB에 남는다. checkpoint 저장 중 하나의 receipt 삽입이 실패해도 checkpoint와 그 transaction의 모든 receipt는 rollback된다. 아직 ACK하지 않은 journal은 남으므로 재시도할 수 있다. 일시적인 DB 실패 후 같은 core 상태를 유지한 경우, 수치를 다시 적용하지 않고 **동일한 checkpoint와 grant ID**를 저장 재시도한다.

CAS conflict가 나면 live 캐릭터의 진행을 멈추고 `loadForRecovery`로 durable checkpoint와 관련 grant receipt를 다시 읽는다. 그 checkpoint로 core를 복원한 후 receipt가 없는 grant만 다시 적용한다. 기존 live 상태에 pending 수치를 무조건 더하거나 stale checkpoint를 새 revision에 그대로 덮어쓰면 안 된다. 여러 host의 동일 캐릭터 접속을 막는 ownership 주입과 freeze/reload 실행은 host adapter의 책임이다. 저장 CAS만으로 in-memory simulation의 단일 소유권을 제공하지 않는다.

DB commit 후 source ACK 전에 호스트가 죽어도 source가 같은 grant ID를 다시 내보낼 수 있다. `recordGrant`는 같은 내용을 확인하고 기존 journal을 반환한다. `loadForRecovery`의 receipt가 존재하면 durable checkpoint에 이미 반영된 것이므로 수치를 다시 적용하지 않고 source를 ACK한다. commit 응답을 잃어 성공 여부가 불확실할 때도 같은 복구 절차를 쓴다.

모든 writer는 character row를 먼저 잠근다. 여러 프로세스의 journal retry는 grant ID PK와 내용 비교로 합쳐지고, checkpoint writer는 row lock과 revision CAS로 직렬화된다. receipt는 character의 새 revision을 기록한다. earned journal과 receipt의 UPDATE/DELETE는 DB trigger가 거부한다. receipt가 생겨도 journal은 보존한다. 자동 pruning, 조용한 eviction, unbounded client input log를 추가하지 않는다. 보존 비용과 운영 archive 정책은 추후 별도 설계가 필요하다.

## Victim outcome 완전성 seal과 자원 경계

`recordVictimOutcome(entries, resources)`에는 같은 victim의 전체 N을 전달한다. source의 canonical JSON tuple ID를 유지하고 victim area/id/life와 각 recipient character를 검증한다. `005_world_victim_outcomes.sql`의 새 테이블은 key, codec version, recipient count, canonical content digest를 immutable하게 저장한다. 이 seal과 모든 grant는 같은 transaction으로 commit된다. 순서를 바꾼 같은 집합의 재시도는 허용하고, subset/extension, account나 payload 변경은 outcome_conflict로 거부한다. 기존 journal과 receipt에는 pruning을 추가하지 않는다.

seal이 없는데 같은 victim prefix의 legacy grant가 있으면 부분 journal을 완전하다고 추정하지 않고 failclosed한다. 자동 seal/backfill/삭제 정책은 추가하지 않았다. seal된 victim에 기존 단일/batch API로 새 recipient를 뒤늦게 추가하는 것도 거부한다. 같은 기존 grant의 immutable 재시도는 유지한다. 기존 API를 사용하는 모든 writer도 victim lock 순서를 공유해야 한다.

`resources={maxEntries,maxPayloadBytes,timeoutMs}`는 명시적으로 주입한다. entries/bytes/time의 운영 budget이며 보상 자격이나 새 게임 슬롯 한도가 아니다. N에 대한 새 hard cap이나 default는 없다. count/bytes 초과는 resource_limit으로 transaction 전에 또는 전체 rollback으로 실패한다. timeoutMs는 양의 정수이며 PostgreSQL statement_timeout 지원 범위 안에서만 받는다. 전체 deadline과 각 query의 남은 시간으로 statement/read timeout을 설정한다. 정리 rollback에는 추가 시간이 들 수 있으며 응답 유실은 full commit 여부를 같은 seal/집합 재시도로 확인한다.

bytes는 payload와 grant ID, account ID, character ID의 UTF-8 합계를 원본과 codec 검증 결과 모두에서 잰다. heap bytes와 같은 값이라고 주장하지 않으며 N과 payload 크기로 작업량을 제한한다. legacy journal의 victim prefix 조회는 이력 크기에 따른 비용이 있으므로 deadline으로 failclosed하고, 실제 부하 측정 없이 production 성능을 완료로 쓰지 않는다.

host는 budget 부족이나 DB 실패 때 원본 전체 outcome을 보존하고 source ACK, 공개 reward와 진행을 멈춘 뒤 충분한 자원으로 같은 집합을 재시도해야 한다. 일부 recipient를 빼거나 거리/시간 eligibility cut을 넣지 않는다. 이 저장 API는 pre-death source credits Map의 memory를 직접 제한하지 않는다. host가 실제 configured memory/mutation budget을 감시하고 초과 전에 backpressure/failclosed해야 하며, 동접 수나 healing/reset이 가능한 victim HP만으로 lifetime bound를 증명했다고 쓰지 않는다. seal commit 전의 미공개 world outcome은 process crash로 reset될 수 있다는 기존 crash boundary를 유지한다. 이를 이미 durable earned로 발표해서는 안 된다.

## 검증한 101명 교대 기여와 guard 유실

`victim-outcome.test.mjs`는 실제 SimulationArea, core Combat/WorldRules, core checkpoint codec과 임시 PostgreSQL을 사용한다. query는 flat fixture이며 전체 world 네트워크 부하 시험은 아니다. 실제 configured level20 scrapling에 100명이 유효한 1 damage씩 기여하고, 한 명을 durable 퇴장시킨 뒤 101번째가 들어와 기여/처치했다. peak 동접은 100, lifetime entitlement는 101이며 모두 XP 248, coins 62 전액이다.

작은 budget과 중간 SQL 실패는 seal/grant 0개, source pending 101개를 남긴다. 충분한 명시 test budget에서는 seal/count와 101개 journal이 함께 commit된다. live 100명은 appliedHere를 재적용하지 않고 capture/receipt를 저장하며, offline 1명은 실제 restore/receiveGrant 후 저장한다. 새 pool에서 재접속해 전원 checkpoint와 receipt 101개, pending 없음, 재시도 시 중복 XP/coins 없음과 subset/extension 거부를 확인한다. test resource 숫자는 승인된 deployment cap이 아니다.

별도 실제 PG trigger로 checkpoint write를 막은 상태에서 ownership backend를 종료하고 새 guard를 획득했다. 기존 guard의 abort는 별도 DB transaction을 fence하지 않으므로 old write가 complete state+receipt로 commit될 수 있음을 확인했다. coordinator는 그 completion을 ownership unresolved로 돌려 publication을 허용하지 않았다. 새 authority가 durable state를 읽고 revision 2를 저장한 뒤 stale CAS와 closed coordinator 재시도는 이를 덮어쓰지 못했다. 실제 host socket/boundary에서 late publication을 막는 통합 시험은 host 담당의 별도 검증이다.

005 migration은 기존 accounts.save/revision과 004 character/journal/receipt rows를 바꾸지 않는 것을 실제 이전 schema 데이터와 migration framework로 비교했고 재실행은 빈 applied 목록이다.

## Host 소유권 guard

`server/world/ownership.ts`의 `await acquireHostOwnership(pool, key, options?)`가 전용 pool client를 잡아 session-level `pg_try_advisory_lock`을 획득한다. key는 모든 world host 프로세스가 일치시켜야 하는 서버 내부 scope 문자열(1..128 UTF-8 bytes)이며 SHA-256 앞 64 bits를 signed advisory key로 사용한다. 경합은 `HostOwnershipError('busy')`로 즉시 실패한다. main은 acquire 성공 후에만 guard를 host에 주입하고 입장을 열어야 한다.

반환 `HostOwnership`은 `{key, closed: AbortSignal, assertOwned(), release(): Promise<void>}`다. 전용 client는 유지 중 pool에 반환하지 않으므로 일반 transaction이 이 연결을 빌리거나 rollback하지 않는다. heartbeat와 query timeout 기본값은 각각 1000 ms이며 options로 조정할 수 있다. backend error/end 또는 heartbeat 실패 시 `closed`가 `lost` reason으로 abort된다. 정상 release는 `released` reason으로 먼저 닫고 unlock 후에도 client를 destroy해 idle pool에 반환하지 않는다. 취득/해제 실패 경로도 client를 destroy한다.

host는 closed signal을 구독하고 tick, 입장, 진행 commit 경계에서 assertOwned를 확인해야 한다. 연결 유실 검출은 error/end와 heartbeat deadline을 따르며 guard가 이미 열린 socket을 닫거나 저장 transaction에 별도 fencing token을 넣지는 않는다. 종료 시 host를 멈추고 guard를 release한 뒤 pool.end를 호출한다. 실제 host가 이 중단 순서를 지키는지는 별도 통합 검사 대상이다.

기존 updated_at를 검증된 Character.updatedAt(ms)로 읽어 준다. offline elapsed 계산과 어떤 상태를 경과시키는지는 host의 명시적 restore policy가 결정한다. 저장소에서 새 offline clock 정책을 만들지 않는다.

## 실행 확인과 남은 연결

테스트는 `server/node/local-postgres.mjs`의 임시 PostgreSQL cluster를 사용한다. production DB와 provider에 연결하지 않는다. 종료와 실패 경로에서 pool과 cluster를 정리한다.

```sh
node --test server/world/character-store.test.mjs
```

Node 24.22.0, pnpm 10.10.0에서 현재 checkpoint 검사는 character HTTP 9개, store 26개, victim outcome 6개를 합한 실제 PG 41개 통과다. ownership 5개를 포함한 `pnpm test:world` 88개, `pnpm test:server` 17개가 통과했고 `pnpm build` 종료 코드는 0이다. build에는 기존 browser externalization과 500 kB chunk 경고가 남아 있다. 새 migration 적용 전의 account save, revision, created, updated가 그대로 보존되는 것도 실제 migration framework로 검사했다.

검증 항목은 기존 bundle과 새 level-1 분리, 계정 소유권, 재접속 후 journal, immutable 내용 충돌과 JSON 의미 비교, checkpoint/receipt transaction 실패 rollback, 다른 pool의 CAS 경쟁, 별도 Node 프로세스의 중복 journal 경쟁, 페이지 조회, JSON 크기와 버전/손상 행 거부, commit 후 ACK 유실 복구다.

후속 작업은 실제 core codec과 persist/restore projection, 계정 세션 인증과 character 선택, 소유권 guard와 실제 host 연결, non-dropping grant 작업 큐, ACK 연결, 재시작 복구와 shutdown flush다. Google-only 로그인, 25 quests, 반복 보스, dead reconnect, 배 2인, 마을 놀이의 실제 통합 동작은 이 준비 작업에서 검증하지 않았다.
