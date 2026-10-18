# 개발자 모니터

개발자가 현재 접속한 플레이어의 위치와 움직임을 월드별로 관찰하는 읽기 전용 화면이다. `/monitor`로 들어가면 정적 서버가 `/monitor/`로 연결한다. dev와 main은 각 주소의 Node 프로세스가 가진 접속자만 조회한다.

## 요구사항과 결정

처음에는 모든 유저를 모니터링한다는 요청이었다. 명확화 후 다음과 같이 정했다.

| 항목 | 결정 | 결정 주체 |
| --- | --- | --- |
| 주 화면 | 플레이어별 3D 화면 격자 | 사용자 |
| 위치 | 각 월드의 모든 플레이어를 미니맵에 표시 | 사용자 |
| 월드 탐색 | 모든 월드를 한 페이지에 펼치고 스크롤 | 사용자 |
| 카메라 | 캐릭터를 따라가며 지형과 건물 충돌을 피하는 관전 시점 | 계속 진행 지시 후 에이전트 판단 |
| 접근 | 기존 Google 로그인과 서버의 개발자 계정 허용 목록 | 에이전트 판단 |

온라인 공개 shard와 비공개 방의 플레이어를 포함한다. 접속을 끊거나 오프라인으로 플레이하는 유저, 캐릭터 생성 전의 방문자, 과거 접속 이력은 포함하지 않는다. 위치를 아직 받지 않은 유저도 숨기지 않고 수신 대기로 표시한다. 구버전 비공개 방의 월드를 확인할 수 없으면 별도 위치 확인 중 섹션에 둔다.

## 화면과 동작

타일은 두 가지 방식으로 그린다. 앞쪽 몇 개 타일은 실시간 관전 화면(아래 절)으로 실제 게임을 보여 준다. 나머지 타일은 가벼운 renderer(`src/monitor/views.ts`)로, 기존 게임의 모델, 모션, 월드 자산을 이용해 서버가 수신한 위치를 관전 카메라에서 다시 그린다. 화면 전송은 하지 않는다. 가벼운 renderer에는 몬스터, 보스, 전투 효과, 개인 퀘스트 오브젝트와 플레이어의 실제 카메라 방향이 없다. World II는 동일한 높이 격자, 지형 색, 마을과 주요 지형물을 사용한다. 다른 월드는 기존 월드 생성기를 사용한다.

- 타일에 이름, 레벨, 체력, 위치, 방, 수신 지연 상태를 표시한다.
- 같은 월드의 다른 shard나 비공개 방은 미니맵에 함께 나오지만 개별 관전 타일에는 같은 방의 플레이어만 나타난다.
- 검색은 타일에만 적용하며 미니맵의 전체 위치는 유지한다.
- 미니맵의 같은 위치는 인원수로 묶는다. 반복 클릭하면 묶인 플레이어의 타일로 차례로 이동한다.
- 타일 클릭으로 확대하고 다시 클릭하거나 Escape로 줄인다. 기본, 작게, 크게 보기로 타일 밀도를 바꾼다.
- 빈 월드, 위치 대기, 로딩 실패, 로그인 필요, 권한 없음, 미설정, 서버 끊김을 구분한다.
- 네트워크 오류 때 마지막 화면을 멈추고 끊김을 표시한다. 자동 재접속 또는 다시 연결 버튼으로 갱신한다.
- 일시정지는 조회와 렌더를 모두 멈춘다. 배경 탭은 조회와 렌더를 쉰다.

## 실시간 관전 화면

요청: "모니터 화면에 몬스터가 안나오네? 기술 등 유저가 보는 모든 환경이 다 보여야지. UI 빼고 다 보여야해." 가벼운 renderer는 게임 세계를 갖지 않아 relay가 보내는 `e0`, `n3`, `b3` 같은 엔티티 ID를 그릴 수 없다. 그래서 실제 게임 클라이언트를 보이지 않는 관전자로 돌린다.

### 무엇이 보이는가

관전 화면은 그 방에 함께 있는 다른 플레이어의 화면과 같은 것을 보여 준다. 방의 combat host가 보내는 `world` checkpoint와 `combat` 이벤트, 다른 플레이어의 `state`, `action`, `skill`이 그대로 들어오기 때문이다.

- 몬스터와 보스의 위치, 체력, AI 상태, 공격 동작, 맞을 때의 번쩍임, 죽는 연출, 보스 단계와 timeline
- 플레이어의 이동, 공격과 시전 동작(`attack_swipe`, `attack_slam`, `cast`), 감정 표현, 브레이크댄스
- 플레이어의 기술 효과: 시전 중 집게의 빛, 날아가는 탄(물방울, 성광), 서리 분사, 해일, 소용돌이, 돌진 자국, 기절 별, 보호막 등. 아래 "기술 효과" 참고
- 날씨, 등대와 분위기, 배, 마을 놀이, 비공개 방의 던전, 월드 이동(공개 shard는 `area`, 비공개 방은 `world.chapter`)

보이지 않는 것:

- UI 전부: HUD, 이름표, 데미지 숫자, 말풍선, 채팅, 메뉴, 대화창, 튜토리얼, 시작 안내. 3D canvas만 남긴다(`src/spectate.ts`의 `spectateChrome`).
- 개인 진행에 따른 화면(퀘스트 노드, 금색 목표 표시, 개인 보스 승리로 열리는 문). 관전자는 진행이 없는 새 캐릭터로 시작한다.
- 플레이어의 실제 카메라 방향. 관전 카메라는 따라가는 게의 뒤쪽으로 천천히 돌아가는 일반 follow camera다. 보스전에서는 게임의 보스 framing이 그대로 적용된다.

### 기술 효과

플레이어의 기술 효과는 시전한 브라우저만 그렸다. 이제 클라이언트(`src/multiplayer/client.ts`의 `shareSkill`)가 자기 게의 `ability`, `projectile`, `castStart`, `castEnd`, `ward` 이벤트를 `{type:'skill', skill}`로 방에 보낸다. relay(`server/rooms.ts`)는 `server/protocol.ts`의 `skillOf`로 모양을 검사해 보낸 사람을 뺀 방 전체와 관전자에게 전한다. 받은 쪽은 `BrowserSink.remote`가 같은 VFX를 그 플레이어의 게 위에 그린다.

- 효과만 보낸다. 피해, 회복, 기절은 지금처럼 `combat`으로 처리하고, `skill`은 게임 상태를 바꾸지 않는다.
- 위치와 방향(`at`, `yaw`)은 시전한 순간의 값을 함께 보낸다. 받은 쪽의 게는 `state`를 따라 조금 늦게 움직이므로, 자리에 남는 효과(서리 분사, 해일, 왕관 폭발, 성스러운 물결, 스팀 점멸)는 이 값으로 그린다.
- 대상은 플레이어 id나 combat key(`e4`, `b20` 등)로 보낸다. combat을 공유하지 않는 방(예전 공개 shard)에서는 몬스터가 브라우저마다 달라서 대상이 있는 효과는 그리지 않는다.
- 다른 플레이어의 기술에는 카메라 흔들림, 소리, 머리 위 글자(`+15 Rage`, `Stunned`, `Barnacle Ward`)를 넣지 않는다.
- 같은 방의 다른 플레이어도 같은 효과를 본다.
- 확인: `pnpm test:multiplayer`(relay 전달과 잘못된 `skill` 거부), `node tools/qa-skill-fx.mjs`(실제 Chrome 마법사와 전사, 관전 화면에서 시전, 물방울 탄, 서리 분사, 해일, 스팀 점멸).

### 관전 화면 주소

`/?observe=<방 코드>&follow=<플레이어 ID>&area=<1-6>`. 방 코드는 공개 shard(`W` + 월드 번호 + 16진수 4자리) 또는 비공개 방 코드(16진수 6자리), 플레이어 ID는 모니터 snapshot의 `id`, `area`는 welcome이 오기 전 먼저 띄울 월드다. 이 주소는 시작 안내, 계정 초기화, 저장을 모두 건너뛴다.

- `localStorageGet`은 항상 비어 있고 `localStorageSet`은 아무것도 쓰지 않는다. 같은 브라우저에서 게임을 하던 개발자의 저장과 설정을 읽거나 덮어쓰지 않는다. 계정 동기화도 시작하지 않는다.
- 그래픽은 `low` 품질, 오디오는 음소거, 음악은 끈다.
- 로컬 게는 숨기고(`hidden`, 공격 대상 아님) 따라갈 플레이어의 게 위치에 매 프레임 둔다. follow camera, 지역 효과, 월드 streaming이 그 플레이어를 따라간다. 입력, 플레이어 이동, HUD 갱신, 음악, 퀘스트 목표 표시는 돌리지 않는다.
- `Multiplayer.send`는 관전 중 아무것도 보내지 않는다(`state`, `action`, `combat`, `world`, 채팅, 신고). `BattleSync.authority`는 관전 중 항상 false라서 몬스터 AI를 돌리거나 host가 되지 않는다. 몬스터가 죽을 때 숨은 게에 경험치를 주지 않는다.
- 따라가는 플레이어가 방을 떠나면 화면 전체에 `NO SIGNAL`을 띄운다.
- 부모 모니터에 `{type:'cc-spectator', state, room, follow}`를 postMessage로 알린다(`state`는 `connecting`, `live`, `nosignal`). 모니터는 `{type:'cc-spectate', observe, follow, area}`로 같은 iframe을 다른 방이나 플레이어로 옮긴다. 둘 다 같은 origin만 받는다.
- 대상은 지금 플레이어가 쓰는 legacy relay 게임이다. 서버 월드 모드(`?world=server`, `src/game/serverBridge.ts`)는 이번 변경의 대상이 아니다.

### observer 프로토콜

`/multiplayer`에서 `create`, `join`, `enter` 대신 `{type:'observe', room, ticket}`을 보낸다(`server/rooms.ts`).

- 허용되면 방 멤버가 들어올 때와 같은 모양의 `welcome`을 받는다: `observer: true`, `id`, `room`, `host`, `world`, `players`, 공개 shard면 `public`, `area`, `sharedWorld`. 그 뒤 방의 모든 broadcast(`state`, `action`, `combat`, `world`, `joined`, `left`, `authority`, `chat`)를 받는다. guest가 host에게만 보내는 `combat`은 받지 않는다.
- observer는 방의 `players`, `joined`와 `left`, host 선출, 8명 정원, 이름 중복 검사, 모니터 snapshot, 빈 방 정리 어디에도 들어가지 않는다. `observe`와 `leave` 말고는 무엇을 보내도 무시한다. 권한 확인 중에 온 메시지도 무시한다. 플레이어로 들어온 소켓은 observe할 수 없다. observer는 다른 방을 다시 `observe`할 수 있다.
- 거부: 권한이 없으면 `{type:'error', message:'Monitor access required.'}` 뒤 1008로 닫는다. 방이 없으면 `Room not found...` 뒤 1000으로 닫는다. `attachRooms`에 `observe` 옵션이 없으면(테스트, `CC_SERVER_URL` 없는 Vite relay) 누구도 observe할 수 없다.
- 서버 전체 소켓 상한(`maxMembers`)에는 observer 소켓도 센다. 연결 수를 막는 자원 상한이기 때문이다.
- 브라우저 쪽 `Link`(`src/multiplayer/link.ts`)의 `observe` 모드는 welcome을 받아도 observer로 남고, 끊기면 공개 월드와 같은 backoff로 계속 다시 붙는다.

### 권한

`GET /api/account/monitor`와 같은 규칙이다(`server/node/monitor.ts`의 `monitorAccess`). 업그레이드 요청의 주소가 `MONITOR_IPS`에 있거나(`TRUST_PROXY=1`이면 `X-Forwarded-For`의 마지막 주소), 계정 세션 쿠키의 계정이 `MONITOR_ACCOUNTS`에 있으면 허용한다.

계정 쿠키는 `Path=/api/account`라서 브라우저가 `/multiplayer` 소켓에 보내지 않는다. 그래서 관전 화면은 먼저 `GET /api/account/monitor-ticket`을 부른다. 이 경로는 모니터 snapshot과 같은 검사(`X-Crabcraft-Account: 1`, 같은 origin, 위 규칙)를 하고 `{ticket, expires}`를 돌려준다. ticket은 120초 동안 유효한 HMAC 서명이며 key는 프로세스마다 새로 만든다. 서버에 저장하지 않고, 재시작하면 무효가 된다. 관전 화면은 60초마다 새 ticket을 받고 소켓을 열 때마다 최신 ticket을 보낸다. relay는 ticket이 유효하거나 업그레이드 요청이 위 규칙을 통과하면 허용한다.

### 모니터 타일과 상한

- 실시간 관전 화면은 타일의 3D canvas 위에 iframe으로 놓고, `CAM 01`, 월드, LIVE와 NO SIGNAL, 이름, 방, 레벨, 미니맵 overlay는 그 위에 그대로 둔다. iframe은 클릭을 받지 않는다. 타일은 iframe을 담을 수 있게 `<button>` 대신 `role="button"` div로 바꿨다(Enter, Space로 확대).
- 관전 화면 하나가 게임 하나다. 약한 TV(LG StanbyME, webOS 브라우저)를 위해 동시에 4개까지만 띄운다. 확대한 타일이 먼저 받고, 나머지는 벽의 순서대로 받는다. 주소에 `?live=N`을 붙여 바꾼다(0이면 끔, 최대 16). 상한 밖의 타일, iframe이 아직 준비되지 않은 타일, 플레이어를 놓친 타일은 가벼운 renderer가 그린다. 일시정지하면 iframe을 모두 내리고 다시 시작하면 다시 띄운다.
- 방 하나에 iframe 하나를 두고 따라갈 대상을 바꾸는 방식은 고르지 않았다. 타일마다 다른 플레이어를 보여 주려면 결국 타일마다 화면이 필요하기 때문이다.
- 월드를 옮기면 클라이언트가 소켓을 새로 열어 relay ID가 바뀐다. 온라인 이름은 서버가 모든 방에서 유일하게 보장하므로, 사라진 타일이 관전 화면을 갖고 있으면 8초 동안 남겨 두고(상태 `이동 중`) 같은 이름의 새 ID가 나타나면 그 타일과 iframe을 넘겨준다. iframe은 postMessage로 새 방에 다시 붙어 다시 로드하지 않는다. 벽의 순서는 DOM 이동 대신 CSS `order`로 정한다. iframe을 DOM에서 옮기면 게임 전체가 다시 로드되기 때문이다.
- TV에서 관전 화면 4개가 내는 부하는 측정하지 않았다.

## 화면 구성

게임의 어두운 배경과 금색 포인트를 이어 쓰되 시스템 sans-serif로 숫자와 이름을 읽기 쉽게 한다. `src/monitor/monitor.css`에 화면 전용 토큰이 있다. 배경 `#111719`, 패널 `#192123`, 본문 `#edf1ed`, 보조 `#a8b9b8`, 강조 `#d9b45a`, 연결 `#75dab5`를 사용한다.

1440px에서 월드 제목, 왼쪽 240px 미니맵, 오른쪽 유저 화면 격자로 읽는다. 타일은 최소 290px, 영상은 16:9이며 정보 줄은 13px와 10px다. 850px 이하에서는 미니맵과 격자를 위아래로 쌓는다. 클릭과 키보드 focus는 테두리로 표시한다. 장식 애니메이션은 없다.

화면 단위는 header(환경과 총 접속 수), toolbar(검색, 밀도, 정지), world section(월드와 인원), minimap(전체 좌표), player tile(3D와 상태)이다. 실제 로컬 빌드에서 1440 x 1000, 390 x 844 viewport를 검증했다. 디자인 원본은 기존 게임 자산이며 외부 브랜드 자산은 사용하지 않는다.

## 서버와 권한

`GET /api/account/monitor`는 계정 쿠키의 기존 Path를 그대로 사용한다. `X-Crabcraft-Account: 1` 헤더, 같은 origin, 유효한 DB 세션, `MONITOR_ACCOUNTS` 포함 여부를 매번 확인한다. 캐시와 CORS를 허용하지 않는다. API에는 계정 ID, 세션, 채팅, 저장 데이터가 없다. 미설정이면 503, 미로그인이면 401, 허용되지 않은 계정이면 403이다.

merge 후 각 환경의 `/etc/crabcraft/dev.env` 또는 `/etc/crabcraft/prod.env`에 개발자의 익명 계정 ID를 쉼표로 구분해 `MONITOR_ACCOUNTS`에 설정하고 해당 서버를 재시작한다. ID는 개발자가 로그인한 브라우저에서 기존 `/api/account/session` 응답의 `username`으로 확인한다. 이메일이나 Google subject, 세션 토큰을 이 변수에 넣지 않는다. 계정 목록과 실제 값은 레포나 PR에 기록하지 않는다.

로그인하기 어려운 화면(집 TV 등)은 `MONITOR_IPS`에 그 네트워크의 공인 IP를 쉼표로 구분해 넣는다. 이 주소에서 온 요청은 로그인 없이 모니터를 본다. `X-Crabcraft-Account` 헤더와 같은 origin 검사는 그대로 한다. 서버는 Caddy가 붙인 `X-Forwarded-For`의 마지막 주소(`TRUST_PROXY=1`)로 판단하므로 요청자가 앞쪽 주소를 꾸며도 통과하지 못한다. 같은 공유기 뒤의 모든 기기가 모니터를 볼 수 있으니 집처럼 믿을 수 있는 네트워크만 넣는다. 공인 IP가 바뀌면 값을 고치고 서버를 다시 띄운다. 실제 IP 값은 레포나 PR에 기록하지 않는다.

기존 Caddy `/api/account/*` 프록시와 정적 디렉터리 index를 사용한다. Caddy는 [기본 canonical URI 처리](https://caddyserver.com/docs/caddyfile/directives/file_server)에 따라 디렉터리에 trailing slash를 붙인다. Vite 개발 및 preview 서버에는 같은 redirect를 추가했다. Caddy 설정 변경과 DB migration은 없다. 서버와 프런트엔드를 함께 배포한다. 설정은 이 PR에서 운영 환경에 적용하지 않았다.

## 부하와 로컬 실행

화면은 200ms 간격으로 snapshot을 읽으며 요청을 겹치지 않는다. 받은 위치를 그대로 쓰지 않고 300ms 늦게, 앞뒤로 받은 두 위치 사이를 이어 움직여 끊김을 없앤다(30m 넘게 뛰면 순간이동으로 보고 바로 옮긴다). 조회는 방 입장, 호스트 선출, 정원, 캐릭터 저장에 관여하지 않는다. 단일 WebGL context에서 화면에 보이는 타일만 렌더한다. 타일이 4개 이하면 30fps, 9개 이하면 20fps, 그보다 많으면 12fps이고, 한 프레임에 가장 큰 타일 1개와 나머지 8개를 차례로 그린다. 가로는 최대 800px이다. 이 수치는 렌더 제한값이며 다수 유저 부하 보장값은 아니다.

로컬에서 Node 서버를 먼저 실행하고 `CC_SERVER_URL=http://127.0.0.1:<Node port> pnpm dev` 또는 같은 변수로 `pnpm preview`를 실행한다. 이 모드는 계정 API와 `/multiplayer`를 같은 Node에 프록시하므로 모니터와 게임이 동일한 접속자를 본다. 변수를 지정하지 않은 기존 Vite relay 개발 방식은 그대로 유지한다.

## 검증

- `pnpm test:monitor`: 권한, 만료, origin, DB 장애, 여러 shard, 비공개 방, 미확인 위치, 이동, 이탈, 서버 분리, 읽기 전용 snapshot. observer 소켓이 등록 주소, 허용 계정 쿠키, ticket으로만 붙는지, ticket 경로가 모니터와 같이 답하는지, ticket 만료와 위조.
- `pnpm test:multiplayer`: 기존 멀티플레이와 collision 회귀 검사. observe 규칙이 없으면 거부, 권한 없는 observer와 없는 방 거부, 허용된 observer의 welcome과 broadcast, 플레이어에게 보이지 않음, 게임 메시지 무시, host가 되지 않음, 정원과 이름 중복에 안 셈, 떠나도 아무도 모름, `Link` observe 모드의 재연결.
- `pnpm test:server`: 실제 임시 Postgres에서 기존 Node 서버, Google 인증, 재시작 회귀 검사. `server/node/main.ts`가 `MONITOR_IPS`와 ticket으로 observer를 받는지.
- `node tools/qa-monitor-spectator.mjs`(먼저 `pnpm build`): 임시 Postgres, `server-dist/main.mjs`(`MONITOR_IPS=127.0.0.1`), `vite preview`로 실제 Chrome 플레이어 둘을 같은 공개 shard에 넣는다. 한 명이 스크랩링에게 걸어가 싸우는 동안 1920x1080 모니터의 그 타일에 몬스터와 공격 동작, 맞은 몬스터의 체력 감소가 나오는지, 관전 화면에 canvas만 있는지, 플레이어 화면에 관전자가 없는지, 월드 II로 옮겨도 같은 iframe이 다시 로드되지 않고 따라가는지, 플레이어가 떠나면 `NO SIGNAL`이 나오는지, `?live=1` 상한과 확대 타일 우선을 확인한다. 페이지 오류 0건이어야 한다.
- `pnpm build`: 타입 검사와 `/monitor/index.html` 포함 프로덕션 빌드.
- 브라우저: 로컬 Node, 임시 Postgres, 가짜 Google OAuth, 실제 WebSocket 테스트 유저 8명으로 로그인부터 네 월드 렌더, 검색, 확대, 정지, 연결 복구, 모바일 overflow를 확인한다.

운영 도메인 배포, 실제 개발자 계정 등록, 512명 규모의 지속 부하 검증은 별도 단계다.
