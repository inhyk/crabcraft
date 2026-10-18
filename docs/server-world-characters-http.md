# 서버 캐릭터 목록과 생성 HTTP

작성자: 지수

`server/world/characters-http.ts`의 `createCharacterHandler({pool, characters, codec, origins, clientIp, policy})`는 기존 Google 계정의 서버 캐릭터 목록과 신규 생성만 제공한다. root main이 `/api/account/world-characters` prefix를 일반 account handler보다 먼저 이 handler로 전달해야 한다. 이 작업에서는 `accounts.ts`, `main.ts`, 실제 host와 browser UI를 바꾸지 않았다.

## 명시적인 생성 정책

`policy.maxCharactersPerAccount`가 양의 safe integer로 주어져야 두 endpoint를 사용한다. policy나 값이 없거나 잘못되면 `503 {error:"disabled"}`로 닫는다. 승인되지 않은 캐릭터 슬롯 수를 기본값으로 만들지 않는다. startup config와 UI 연결 담당에게 이 계약을 전달했다. 이 설정은 API 생성 한도이며 world 입장 정원, 보상이나 character reset 정책이 아니다.

## 요청과 응답

`GET /api/account/world-characters?after=<UUID>&limit=<1..100>`은 다음 형식으로 반환한다. limit 기본값은 페이지 크기 20이며 캐릭터 슬롯 기본값을 뜻하지 않는다. after는 UUID v4 cursor이고 UUID순으로 조회한다. unknown/중복 query parameter와 범위 밖 limit는 거부한다. 마지막 페이지는 nextAfter가 null이다. 이 목록은 각 요청 시점의 owned DB 행을 조회하며 여러 페이지를 하나의 transaction snapshot으로 고정하지 않는다.

```json
{
  "characters": [
    {
      "characterId": "00000000-0000-4000-8000-000000000000",
      "identity": {
        "schema": "world-identity-v1",
        "classId": "warrior",
        "archetype": "human",
        "appearance": {"race":"human","sex":"female","classId":"warrior","shell":3,"crest":2,"led":1,"name":"새 게"}
      },
      "updatedAt": 0
    }
  ],
  "nextAfter": null
}
```

위 UUID와 시각은 형식 설명용이다. 응답은 실제 생성된 UUID와 검증된 DB updated_at milliseconds를 사용한다. account ID, session/token, revision과 checkpoint는 응답하지 않는다. 다른 계정의 cursor를 주더라도 반환 대상은 요청 세션의 캐릭터로 제한한다.

`POST /api/account/world-characters`는 다음 object만 받으며 query parameter를 받지 않는다.

```json
{"appearance":{"race":"human","sex":"female","classId":"warrior","shell":3,"crest":2,"led":1,"name":"새 게"}}
```

handler가 identity schema, classId와 archetype=race를 조립하고 주입된 실제 core codec의 validateIdentity로 검증한다. appearance의 모든 필드와 현재 catalog 선택을 검사한다. class/archetype catalog는 주입된 codec의 설정을 따르며 handler에서 별도 직업 규칙을 만들지 않는다. XP, coins, flags, checkpoint, owner, account ID, revision, save/import나 임의 schema를 client가 보낼 수 없다. body는 UTF-8 JSON 최대 4096 bytes이고 잘못된 UTF-8도 거부한다. 성공 응답은 `201 {character:<동일한 summary DTO>}`다.

신규 checkpoint는 store 내부 codec의 fresh에서만 만든다. 실제 core codec 테스트에서 xp=0, coins=0, 빈 flags, 초기 장비와 world w1을 확인했다. 기존 accounts.save를 읽어 새 진행으로 가져오거나 그 save/revision을 갱신하지 않는다. 삭제, 슬롯 reset, 이름 중복 제한 정책은 추가하지 않았다.

## 인증과 제한

기존 `cc_account` cookie의 Path=/api/account와 공통 read-only session resolver를 재사용한다. X-Crabcraft-Account:1 header, 허용된 요청 Host와 엄격한 same-origin 증거가 필요하다. POST는 Origin이 요청 target origin과 정확히 일치해야 한다. 브라우저가 Origin을 생략하는 same-origin GET은 Sec-Fetch-Site:same-origin을 증거로 받는다. 다른 origin, cross-site metadata와 증거가 없는 요청은 거부한다. GET body도 허용하지 않는다. 브라우저 UI는 forbidden Origin/Fetch-Metadata header를 직접 설정하지 않고 fetch의 같은 origin cookie와 custom account header를 사용한다.

응답은 no-store, private JSON이며 새 cookie를 쓰지 않는다. 기존 DB fixed-window limiter로 IP당 100회/900초와 계정당 20회/60초를 적용한다. IP 제한은 인증 실패도 센다. 이는 HTTP 작업량 제한이며 캐릭터 슬롯 정책이 아니다. 로그에는 검증된 DB error code만 적고 appearance 이름, request body, cookie나 checkpoint를 적지 않는다.

| 상태 | 의미 |
| --- | --- |
| 200 | owned 목록 |
| 201 | 서버 캐릭터 생성 |
| 400 | identity/body/query/request 오류 |
| 401 | 세션 없음, 만료 또는 취소 |
| 403 | Origin/Fetch-Metadata/CSRF header 오류 |
| 404 | 다른 경로 |
| 405 | GET/POST 외 method |
| 409 character_limit | 명시된 계정 생성 한도에 도달 |
| 429 rate | DB rate 제한 |
| 503 disabled | 생성 정책 미설정/잘못됨 |
| 503 unavailable | DB 또는 서버 codec/store 실패 |

## 원자적 생성

`characters.createBounded(accountId, identity, maxCharactersPerAccount)`는 같은 retained PoolClient로 BEGIN, accounts row FOR UPDATE, owned count, fresh 생성과 INSERT, 반환 행 검증, COMMIT을 수행한다. 다른 client에서 account lock만 잡고 기존 create를 호출하지 않는다. 두 pool이나 동시 HTTP 요청이 같은 계정에 생성해도 account row가 count와 insertion을 직렬화한다. 중간 SQL 실패나 INSERT 후 codec decode 실패는 모두 rollback한다.

기존 trusted `store.create` 계약은 유지한다. 이 API는 운영 내부 fixture/신뢰된 호출의 unbounded 생성 경로이며 공개 HTTP는 이를 사용하지 않는다. 생성 한도는 createBounded로 들어오는 public 경로에서 보장한다.

POST는 client idempotency key를 받지 않는다. commit 응답이 유실되어 성공 여부가 불확실하면 새로 생긴 owned 목록을 확인한 뒤 사용자가 선택하도록 해야 한다. 같은 appearance의 자동 재생성을 성공 확인으로 삼지 않는다.

## 검증 범위

`characters-http.test.mjs`는 실제 loopback HTTP와 throwaway PostgreSQL, canonical src/sim/persistence.ts의 실제 core codec을 사용한다. 외부 provider나 VM에 연결하지 않는다. 테스트용 명시 limit는 운영 슬롯 승인이 아니다.

- 모든 race와 class의 full appearance 보존과 server-fresh 진행
- 두 계정의 owned list와 UUID pagination, forged cookie와 foreign cursor의 격리
- 진행/owner/schema/import 필드, invalid appearance/catalog, UTF-8와 body/query 경계
- same-origin GET Fetch Metadata와 POST Origin, CSRF, 만료/로그아웃 세션
- 동시 HTTP 8건에서 명시 cap 2건만 생성
- SQL insert 실패와 INSERT 후 codec 실패의 rollback, legacy save/revision 보존
- DB 계정/IP rate 제한과 누락 정책 disabled

새 handler의 실제 root main routing, startup 정책 전달과 browser 선택/생성 화면은 각 담당의 통합 검증이 남는다.

Node 24.22.0과 pnpm 10.10.0에서 실제 HTTP/core/store PostgreSQL 검사 35개, world 전체 82개, 기존 bundled server 17개가 통과했고 build 종료 코드는 0이다. build에는 기존 browser externalization과 큰 chunk 경고가 남아 있다.
