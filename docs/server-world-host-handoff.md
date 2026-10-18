# 실제 서버 세계 통합 인계

이 변경은 S4 실제 host와 S5 관측 클라이언트, S6 저장, S7 기능 연결을 dev에 검토 가능한 상태로 전달한다. 전체 서버 전환 완료를 뜻하지 않는다.

## 시작과 기존 경로

`WORLD_ENABLED`를 생략하면 기존 account/legacy WebSocket 서버가 그대로 실행된다. 실제 host는 `WORLD_ENABLED=1`과 명시적인 `WORLD_CONFIG_JSON`이 있어야 시작한다. 설정과 asset manifest 검증에 실패하면 listen 전에 종료한다. 설정 계약과 QA 예시는 `docs/server-world-config.md`에 있다. QA의 slot cap, 복원 정책, 밀도 수치를 운영 승인 값으로 취급하지 않는다.

활성화한 서버에서 `?screen=game&world=server`로 들어가 Google 계정의 서버 캐릭터를 선택하거나 현재 외형으로 새 캐릭터를 만든다. 기존 browser save와 XP는 가져오지 않는다. 새 경로의 계산 권한은 Node Area에 있고 browser는 입력과 관측을 담당한다. 서버 연결 실패 시 같은 경로에서 실패 상태를 표시한다.

Node build는 collision JSON 네 개와 source/bytes/SHA256 manifest를 `server-dist/world/`에 포함한다. dev Caddy의 `/world` proxy 추가는 별도로 설치해야 한다. activate.sh, systemd 유닛, deploy-scripts와 VM 부하는 로제 S8 작업이 소유한다.

## 검증 근거

- `pnpm build`, `pnpm test:server`: 실제 packaged main, account cookie/ticket, character GET/POST, legacy WSS와 SIGTERM 저장을 검사한다.
- `pnpm test:world`: 실제 PostgreSQL/WS, 계정 chat, ownership 손실, 개인 저장, admission과 대기열을 검사한다. 포함된 v2 fixture 부하와 clock을 멈춘 100+101 admission은 실제 gameplay 지속 부하와 구분한다.
- `pnpm test:sim:core`: 실제 숫자 규칙, 개인 진행, 수명과 motion source freshness를 검사한다.
- `node tools/qa-world-main-browser.mjs`: production dist와 actual bundled main, 실제 임시 PG에서 캐릭터를 미리 만들지 않고 UI로 생성, 이동, 재접속한다. HTTP 로그인 세션만 fixture로 제공한다.
- `node tools/qa-server-game.mjs`: 실제 Game/host의 정상 level-1 mage 전투, 보상과 재접속을 검사한다. `WORLD_QA_BROWSER_PORT`와 `WORLD_QA_HOST_PORT`로 격리한다.
- `node tools/qa-world-social.mjs`: 실제 Game에서 채팅, native party와 계정 설정 복구를 검사한다. 현재 두 캐릭터는 같은 QA 계정이므로 교차계정 Chrome 증거로 쓰지 않는다.
- `docs/evidence/world-motion-dev362f843-{parity,provenance}.json`: source114개와 실제 controller parity, 독립 browser observation graph 근거다.

실행 환경은 Node24.22.0, pnpm10.10.0이다. 로컬 임시 PG는 기능 검증용이며 fsync-off이므로 DB 운영 성능 근거가 아니다.

## 후속 범위

현재 retained ledger는 전체 N명 outcome을 원자 저장하고 예산 초과 시 source와 미확정 보상을 보존한다. 누적 기여자101명과 동접최대100명의 정확한 지급은 검사했지만 살아 있는 적의 장기 기여 기록 및 receipt의 일반적인 heap 상한은 아직 없다. certified replay/pruning, contribution spill과 paged outcome007은 별도 worktree의 후속 구현이며 이번 runtime에 활성화하지 않는다.

엔딩 군무/카메라/credits, earned private encounter의 최종 HUD와 정상 진행 전체 흐름, 교차계정 moderation의 실제 Chrome 검사, 실제100명 지속 부하/VM 측정, production 정책과 기본 전환이 남아 있다. `endingReady`를 엔딩 연출 완료로 해석하지 않는다. 공개 전환 승인은 이 미완료 항목과 로제의 S8 결과를 함께 검토한다.


## 최신 dev 던전 원정 보존

PR69의 dev `9c06f54`를 반영했다. 기존 경로의 여섯 던전과 pointer capture, 월드 layout은 유지한다. 새 서버 경로에서는 browser가 좌표/충돌/보상/적을 직접 바꾸는 기존 DungeonExpeditions를 생성하지 않는다. 여섯 던전의 서버 권한 이전은 S7 후속 범위다. 이 경계를 production browser QA에서 확인한다.
