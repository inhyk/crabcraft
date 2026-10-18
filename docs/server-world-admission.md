# 서버 세계 입장 인증 준비

작성자: 지수

기존 Google 계정 세션으로 짧은 수명의 일회용 world ticket을 발급한다. 쿠키의 `Path=/api/account`를 유지하며 `/world`에는 원래 session token을 보내지 않는다. 실제 `/world` HTTP/upgrade, socket 수 제한, 최초 frame 처리와 게임 입장은 이번 작업에서 열지 않았다.

## HTTP 발급

`POST /api/account/world-ticket`는 기존 account handler가 처리한다. body는 빈 JSON object 또는 빈 body만 허용하고 최대 256 bytes로 제한한다. client가 account ID, 진행 상태, character 선택이나 ticket을 body에 넣을 수 없다.

다음 조건을 모두 확인한다.

- 기존 `X-Crabcraft-Account: 1` header가 있어야 한다.
- `Origin`이 있어야 하며 허용 목록과 해당 요청의 Host가 가리키는 정확한 origin에 일치해야 한다. 두 사이트가 모두 허용 목록에 있어도 dev origin으로 production Host에 ticket을 요청하면 거부한다. local dev는 기존 localhost/127.0.0.1 관례를 따른다. Vite proxy와 Caddy가 원래 Host를 보존하는 현재 구성을 사용한다.
- 기존 `cc_account` cookie를 공통 read-only resolver로 조회한다. token을 SHA-256으로 바꾼 후 원래 account, session hash, 만료 시각을 PostgreSQL에서 확인한다. 세션을 갱신하거나 기존 save를 읽어 입장 자료로 사용하지 않는다.
- 기존 DB fixed-window limiter로 IP당 900초에 100회, 인증된 계정당 60초에 20회로 제한한다. IP 제한에는 인증 실패 요청도 포함한다. 값은 HTTP 인증 작업량을 제한하는 운영 설정이며 게임 입장 정원이나 캐릭터 슬롯 정책이 아니다.

성공 응답은 `{ticket, expiresAt}`뿐이다. ticket은 `randomBytes(32)`를 base64url로 인코딩한 43자 문자열이다. `expiresAt`은 server Unix milliseconds이며 ticket TTL과 원래 세션 만료 중 빠른 값이다. 응답은 `Cache-Control: no-store, private`를 사용하고 새 쿠키를 쓰지 않는다. 거부는 기존 형식의 JSON error를 사용하며 Origin/CSRF는 403, 세션은 401, rate는 429, registry 정원 부족과 DB 장애는 503이다.

## 실제 host가 공유할 API

```ts
const admission = createWorldAdmission(pool);
const accounts = accountHandler(pool, origins, clientIp, google, admission);
// 동일 admission 객체를 실제 /world host에 전달한다.
// const binding = await admission.consume(firstAuthFrame.ticket, request.headers.origin);
```

`createWorldAdmission`과 공통 resolver는 `server/node/accounts.ts`, `WorldTicketRegistry`와 `SessionBinding`은 `server/world/admission.ts`에서 export한다. 기존 main은 optional registry 인자를 생략해 독립 registry를 만든다. 실제 host를 연결할 때는 위와 같이 하나의 객체를 주입해야 한다. 서로 다른 registry나 다른 Node 프로세스는 같은 ticket을 소비할 수 없다. 재시작하면 미사용 ticket도 사라지므로 HTTP에서 새로 발급받는다. 다중 프로세스 배치의 공유 저장소나 routing은 이번 작업에서 추가하지 않았다.

```ts
type SessionBinding = {
  accountId: string;
  sessionKey: string; // 서버 내부 opaque DB token hash, 원래 cookie token 아님
  expiresAt: number;
};
consume(ticket: unknown, origin: unknown): Promise<SessionBinding>;
revalidate(binding: SessionBinding): Promise<SessionBinding | null>;
```

registry는 raw ticket 대신 SHA-256 digest, 발급 origin과 session binding을 보관한다. TTL 기본값은 30초, 미사용 ticket 상한은 전체 4096개와 계정당 4개다. `WorldAdmissionOptions`의 `ttlMs`, `maxTickets`, `maxPerAccount`로 조정할 수 있다. 가득 차면 기존 ticket을 조용히 버리지 않고 새 발급을 거부한다. 만료된 항목은 다음 발급 시 정리한다. timer와 외부 provider는 추가하지 않는다.

`consume`은 첫 await 전에 ticket을 제거한다. 동시 소비와 replay에서 하나만 진행하며, origin 불일치나 DB 장애가 나도 같은 ticket을 다시 쓸 수 없다. 발급 때 확인한 origin과 소비 요청의 Origin이 정확히 일치해야 한다. 이어 PostgreSQL에서 원래 session hash와 account, 만료를 다시 확인한다. 로그아웃되거나 만료됐거나 다른 account로 바뀐 세션으로는 입장할 수 없다. DB 응답을 기다리는 사이 ticket TTL이 지나도 거부한다. 실패하면 client는 새 ticket을 요청해야 한다.

## 최초 WebSocket frame과 후속 책임

browser는 ticket을 URL query나 `Sec-WebSocket-Protocol`에 넣지 않고 최초 인증 frame으로 보낸다. 이 계약은 host 담당과 합의했으며 registry는 frame parsing을 하지 않는다. host가 tiny frame cap, 정확한 인증 frame shape, 인증 deadline, 인증 전 socket/IP별 상한을 적용하고 인증이 끝나기 전 gameplay 입력을 받지 않아야 한다. 이 작업은 `/multiplayer`의 기존 wire를 바꾸지 않는다.

host는 반환된 account binding만 신뢰하고 client가 보낸 account를 채택하지 않는다. character 소유권과 중복 접속은 host와 character store에서 검사해야 한다. 접속 이후의 로그아웃과 만료는 host가 `revalidate`를 lifecycle boundary와 정한 주기에 호출하여 확인하고 해당 연결을 닫아야 한다. 이 API만으로 이미 열린 socket을 자동 종료하지는 않는다. 원래 세션의 만료를 연장하지 않으며 재인증은 account HTTP 흐름을 따른다.

raw ticket, cookie token, 내부 session hash를 URL, access log, application log에 쓰지 않는다. HTTP 실패 로그는 고정된 route와 검증된 DB error code만 기록한다. 실제 host도 인증 frame의 내용을 로그에 남기지 않아야 한다.

## 검증

`server/world/admission.test.mjs`는 기존 throwaway PostgreSQL helper와 실제 loopback HTTP server에서 account handler를 실행한다. 세션은 Google 계정 형식의 fixture로 만들고 외부 provider에 접속하지 않는다. 기존 `test:server`의 fake Google round trip과 bundled main 테스트도 유지한다.

검증 항목은 read-only session 조회, account binding, Origin/CSRF와 body 경계, ticket 불투명성과 replay, 동시 소비, TTL과 세션 만료, 로그아웃 후 거부, 계정/전역 pending cap, 인증 실패 IP와 계정 rate 제한, DB 오류 후 ticket 재사용 거부, resolver의 account 대체 거부, legacy save/logout 보존이다. bundled main에서도 Google 로그인 후 ticket 발급과 `/world` 미개방, raw ticket 로그 부재를 확인한다.

```sh
node --test server/world/admission.test.mjs
pnpm test:world
pnpm test:server
pnpm build
```

Node 24.22.0, pnpm 10.10.0에서 admission HTTP/PG 테스트 10개, world 전체 50개, bundled server 17개가 통과했고 build 종료 코드는 0이다. build의 기존 browser externalization과 큰 chunk 경고는 남아 있다. 실제 WebSocket 로그인이나 이미 열린 world 연결의 세션 종료는 아직 검증하지 않았다.
