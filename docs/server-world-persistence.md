# 서버 캐릭터 저장 준비

작성자: 지수

이 문서는 `server/world/character-store.ts`와 migration `004_world_characters.sql`의 저장 계약을 설명한다. 실제 world host, 로그인 경로, simulation checkpoint adapter는 아직 연결하지 않았다. 이 저장 테스트만으로 S6 또는 서버 세계 전환이 끝났다고 판단하지 않는다.

## 결정과 경계

`docs/server-world.md` 6장에 따라 새 캐릭터는 Google 계정에 연결하고 level 1부터 시작한다. `accounts.username` FK를 재사용한다. `accounts.save`는 기존 browser 저장 경로에 남고 이 저장소에서 읽거나 가져오지 않는다. appearance와 class 검증, 새 level-1 상태 생성은 실제 core를 아는 필수 codec이 맡는다. 저장소가 별도 quest 규칙이나 XP 계산을 만들지 않는다. 모든 기여자에게 온전한 보상을 주는 자격 판정과 수치 계산은 실제 simulation과 host의 책임이다.

생성되는 character ID는 UUID v4이며 DB 전체에서 유일하다. 소유권 검사는 모든 API에서 account ID와 character ID를 함께 사용한다. 인증은 호출 전에 host가 수행해야 한다. 이 모듈에는 HTTP endpoint, session resolver, browser 진행 입력이 없다. 이 클래스는 신뢰된 서버 내부 코드에서만 호출한다.

캐릭터 슬롯 수, 생성 재설정이나 삭제 정책을 새로 정하지 않는다. schema는 여러 identity를 저장할 수 있고 목록은 페이지로 조회한다. 입장 제한과 슬롯 정책은 후속 host 작업에서 정한다. character와 grant를 지우는 API가 없으며 정리 작업도 추가하지 않았다.

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
| `create(accountId, identity)` | 기존 계정 FK 확인, 검증된 identity와 codec의 fresh 상태, revision 0 저장 |
| `listOwned(accountId, {after?, limit?})` | character ID 기준 정렬, UUID cursor, 기본 100개와 최대 100개 |
| `getOwned(accountId, characterId)` | 소유한 identity, checkpoint, revision 조회 |
| `recordGrant(accountId, characterId, id, payload)` | immutable journal 기록, 같은 ID와 같은 recipient/version/JSON 의미는 동일 결과, 다른 내용은 오류 |
| `pendingGrants(accountId, characterId, {after?, limit?})` | receipt가 없는 journal을 sequence cursor로 조회, 기본 100개와 최대 100개 |
| `saveCheckpoint(accountId, characterId, revision, checkpoint, appliedGrantIds)` | CAS revision 확인, checkpoint와 최대 256개 receipt를 하나의 transaction으로 저장 |
| `loadForRecovery(accountId, characterId, ids)` | character 공유 잠금 아래 checkpoint와 최대 256개 grant의 applied revision을 일관되게 조회 |

`appliedGrantIds`는 중복 없이 해당 recipient에게 이미 journal된 ID여야 한다. 이미 적용된 ID를 다시 저장하려 하면 `already_applied` 오류가 난다. CAS 실패는 `conflict`이며 grant ID를 새로 만들어 우회하지 않는다. journal cursor는 PostgreSQL bigint의 문자열이다. pending 마지막 페이지를 읽었다고 이후 journal 기록이 없다는 뜻은 아니다. 더 오래된 ID부터 다시 조회해도 적용된 것은 receipt로 제외된다.

identity는 4 KiB, checkpoint는 256 KiB, grant payload는 16 KiB로 제한한다. JSON은 최대 깊이 32와 노드 32,768개를 허용하며 finite number, plain object, dense array만 받는다. undefined, BigInt, NaN, Infinity, 순환 참조, accessor, 비 JSON 객체를 거부한다. 저장된 행도 조회 시 같은 검증과 codec을 거치며 schema version이 다르거나 손상되면 실패한다. 지원하지 않는 version을 자동 변환하지 않는다.

## 보상 transaction과 실패 복구

호스트의 정상 순서는 다음과 같다.

1. source가 얻은 grant를 안정된 ID와 recipient로 `recordGrant`에 기록하고 commit을 기다린다.
2. receipt가 없는 grant만 실제 core에서 수치로 적용한다.
3. 같은 core 상태에서 checkpoint를 캡처한다.
4. 그 checkpoint와 적용한 journal ID를 `saveCheckpoint`로 함께 commit한다.
5. commit을 확인한 뒤 source에 ACK한다.

journal 기록만 끝나고 호스트가 죽으면 pending grant가 DB에 남는다. checkpoint 저장 중 하나의 receipt 삽입이 실패해도 checkpoint와 그 transaction의 모든 receipt는 rollback된다. 아직 ACK하지 않은 journal은 남으므로 재시도할 수 있다. 일시적인 DB 실패 후 같은 core 상태를 유지한 경우, 수치를 다시 적용하지 않고 **동일한 checkpoint와 grant ID**를 저장 재시도한다.

CAS conflict가 나면 live 캐릭터의 진행을 멈추고 `loadForRecovery`로 durable checkpoint와 관련 grant receipt를 다시 읽는다. 그 checkpoint로 core를 복원한 후 receipt가 없는 grant만 다시 적용한다. 기존 live 상태에 pending 수치를 무조건 더하거나 stale checkpoint를 새 revision에 그대로 덮어쓰면 안 된다. 여러 host의 동일 캐릭터 접속을 막는 ownership/fencing과 freeze/reload 실행은 후속 host adapter의 책임이다. 저장 CAS만으로 in-memory simulation의 단일 소유권을 제공하지 않는다.

DB commit 후 source ACK 전에 호스트가 죽어도 source가 같은 grant ID를 다시 내보낼 수 있다. `recordGrant`는 같은 내용을 확인하고 기존 journal을 반환한다. `loadForRecovery`의 receipt가 존재하면 durable checkpoint에 이미 반영된 것이므로 수치를 다시 적용하지 않고 source를 ACK한다. commit 응답을 잃어 성공 여부가 불확실할 때도 같은 복구 절차를 쓴다.

모든 writer는 character row를 먼저 잠근다. 여러 프로세스의 journal retry는 grant ID PK와 내용 비교로 합쳐지고, checkpoint writer는 row lock과 revision CAS로 직렬화된다. receipt는 character의 새 revision을 기록한다. earned journal과 receipt의 UPDATE/DELETE는 DB trigger가 거부한다. receipt가 생겨도 journal은 보존한다. 자동 pruning, 조용한 eviction, unbounded client input log를 추가하지 않는다. 보존 비용과 운영 archive 정책은 추후 별도 설계가 필요하다.

## 실행 확인과 남은 연결

테스트는 `server/node/local-postgres.mjs`의 임시 PostgreSQL cluster를 사용한다. production DB와 provider에 연결하지 않는다. 종료와 실패 경로에서 pool과 cluster를 정리한다.

```sh
node --test server/world/character-store.test.mjs
```

Node 24.22.0, pnpm 10.10.0에서 실행한 결과는 DB 테스트 14개 통과, `pnpm test:world` 36개 통과, `pnpm test:server` 16개 통과, `pnpm build` 종료 코드 0이다. build에는 기존 browser externalization과 500 kB chunk 경고가 남아 있다. 새 migration 적용 전의 account save, revision, created, updated가 그대로 보존되는 것도 실제 migration framework로 검사했다.

검증 항목은 기존 bundle과 새 level-1 분리, 계정 소유권, 재접속 후 journal, immutable 내용 충돌과 JSON 의미 비교, checkpoint/receipt transaction 실패 rollback, 다른 pool의 CAS 경쟁, 별도 Node 프로세스의 중복 journal 경쟁, 페이지 조회, JSON 크기와 버전/손상 행 거부, commit 후 ACK 유실 복구다.

후속 작업은 실제 core codec과 persist/restore projection, 계정 세션 인증과 character 선택, 단일 host 소유권, non-dropping grant 작업 큐, ACK 연결, 재시작 복구와 shutdown flush다. Google-only 로그인, 25 quests, 반복 보스, dead reconnect, 배 2인, 마을 놀이의 실제 통합 동작은 이 준비 작업에서 검증하지 않았다.
