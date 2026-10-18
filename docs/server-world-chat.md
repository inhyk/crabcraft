# 인증 월드 채팅

`server/world/chat.ts`의 `WorldChatService`는 실제 월드 호스트가 사용하는 Postgres 어댑터다. 별도 서버나 소켓은 만들지 않는다. `server/rooms.ts`의 기존 relay는 바꾸지 않는다.

## 호스트 연결

```ts
const chat = new WorldChatService(pool);
type ChatParticipant = {
  accountId: string; // admission과 서버 actor에서만 가져온다.
  ref: EntityRef;    // { area, id, life } 전체 참조다.
  name: string;
  partyId?: string | null; // 서버 파티 등록부의 값이다.
};
```

| 호출 | 성공 응답 |
|---|---|
| `preferences(accountId)` | `{ ok: true, enabled, partyOnly }` |
| `setPreferences(accountId, { enabled?, partyOnly? })` | `{ ok: true, enabled, partyOnly }` |
| `block(accountId, target, blocked)` | `{ ok: true }` |
| `mute(accountId, target, muted)` | `{ ok: true }` |
| `say(sender, raw, audience, 'area' 또는 'party')` | `{ ok: true, line: { sender, name, text, at }, recipients }` |
| `report(reporter, target, room, reason)` | `{ ok: true, muted }` |

실패는 `{ ok: false, error }`다. DB 연결, 잠금, SQL 실패는 `unavailable`로 돌려주며 소켓에 직접 쓰거나 gameplay 예외를 던지지 않는다. `report`의 `muted`는 내부 운영 결과다. 기존 공개 신고 응답은 성공 여부만 보낸다.

호스트는 클라이언트의 target 전체 참조를 현재 actor 또는 유효기간 안의 서버 보관 참조에 대조한다. 클라이언트의 accountId, 세션, 이름, 파티 주장을 신뢰하지 않는다. 같은 지역 또는 파티에서 만났는지와 지난 참조의 신고 허용 시간을 호스트가 확인한 뒤 어댑터를 호출한다.

`audience`는 호스트가 정한 후보 목록이다. 어댑터는 지역, 서버 파티, 수신 설정, 계정 차단과 음소거를 추가 적용한다. `area` 채널은 같은 area에서만 전달하며, `party` 채널은 서버가 지정한 같은 파티의 다른 area에도 전달할 수 있다. 발신자나 수신자가 party-only를 켜면 같은 파티에만 전달한다. 채팅을 끄면 발신과 수신을 막는다.

어댑터는 호출 당시 참조와 파티 값을 복사한다. 비동기 완료를 받을 때 호스트는 연결과 actor 세대를 다시 검사하고, 현재 수신 연결에 해당하는 전체 참조만 전달한다. 전송 대기열과 진행 중 비동기 명령 수는 호스트에서도 제한한다. 공개 line과 recipients에는 accountId, 세션 키, Google 정보가 없다.

## 유지하는 정책

- `Talk.say`, `shownName`, 기존 필터를 그대로 쓴다. 욕설, 연락처, URL, 여러 줄 전화번호 차단과 200자 제한을 유지한다.
- 700ms 간격, 10초에 5개, 30초 안의 같은 문장 제한을 계정에 적용한다. 재접속, 다른 캐릭터, 다른 서비스 인스턴스에서도 같은 DB 상태를 잠근다.
- 계정별 최근 문장은 이미 마스킹된 마지막 20개만 보관한다. `Talk.snapshot()`과 복원 생성자는 독립 복사를 사용하고 getter, 비정상 시각, 과도한 배열, 필터링되지 않은 복원 문장을 거부한다.
- 같은 계정의 자기 신고와 다른 캐릭터를 이용한 중복 신고를 거부한다. 10분 안에 다른 계정 3개가 신고하면 30분 동안 전체 캐릭터를 음소거한다. 신고자 계정당 10분에 10건을 유지한다.
- 자동 음소거 상태에서도 발신자는 자기 문장을 본다. 기존 relay의 shadow mute 정책을 유지한다. 해당 계정의 다른 수신 캐릭터에게까지 전달하지 않는다.
- 채팅 켜기, party-only, 계정별 차단과 개인 음소거, 자동 음소거는 재시작 뒤에도 유지한다. 개인 차단과 음소거는 대상 계정의 모든 캐릭터에 적용한다.

## 저장과 실패 처리

`006_world_chat.sql`은 `world_chat_accounts`, `world_chat_targets`와 `chat_reports.target_account` 및 조회 인덱스를 더한다. 기존 계정, 캐릭터, relay 신고 행을 바꾸지 않는다. `005`는 캐릭터 저장 작업에서 사용한다.

계정 설정 행 하나에 최대 20개 문장과 5개 전송 시각을 보관하며, 개인 차단과 음소거 대상은 계정당 합쳐서 최대 256개다. 한 전송의 audience는 최대 2048개, 입력 문자열은 최대 4096자다. wire의 UTF-8 바이트 제한은 별도로 적용한다.

신고 시 두 계정 행을 같은 정렬 순서로 잠근다. 신고 제한, 중복 여부, 신고 행, 자동 음소거, 신고 watermark를 하나의 트랜잭션에서 처리한다. 자동 음소거가 시작되면 watermark 이후 신고부터 새 신고 묶음으로 센다. 같은 대상에 동시 신고가 들어와도 음소거 시작 표시는 한 행에만 남는다. 추가 투표 테이블이나 메모리별 신고 캐시는 없다.

신고의 기존 session 칸에는 공개 전체 참조의 JSON 배열만 쓴다. 원시 문장, 실제 세션 키, IP, Google subject, 이메일, 토큰을 저장하지 않는다. 신고 행의 기존 90일 보관 정리는 Node 호스트가 담당한다.

SQL statement timeout은 3초, lock timeout은 1.5초다. 성공 응답은 commit 뒤에만 돌려준다. 실패하면 rollback하고 메시지 전달을 하지 않는다. 실패한 문장이나 신고의 재시도는 미완료 트랜잭션의 제한이나 자동 음소거를 물려받지 않는다.

## 검증

```sh
npx --offline -y -p node@24 -p pnpm@10.10.0 -c \
  'node --test server/world/chat.test.mjs server/chat/filter.test.mjs server/chat/safety.test.mjs server/chat/talk-state.test.mjs'
```

실제 임시 Postgres에서 계정 격리, 재접속과 다른 캐릭터의 제한 공유, 필터, 분할 전화번호, 동시 3계정 신고, 신고 제한, 설정과 자동 음소거의 재시작 유지, 신고 개인정보 제한, DB 실패 rollback, 대상 수 제한을 검사한다. 이 어댑터 테스트만으로 HTTP/WS 연결 검증을 대신하지 않는다. 실제 host 연결과 브라우저 검사는 통합 작업의 검증 대상이다.
