# 전투 출력 분리 구현과 검증

전투 출력은 `src/game/events.ts`의 이벤트와 `browserSink.ts`의 브라우저 수신부로 나눴다. 명중은 `Unit.updateHit()`, 투사체는 `Projectiles`, 전투 지연 작업은 `SimTimers`의 게임 시간을 따른다. 화면을 갱신하지 않는 Node에서도 실제 전투와 보스 기믹을 실행하고 사건을 검사한다. 능력과 적 공격 9가지의 명중은 디스크의 실제 클립 hit와 1 ms 안에서 일치한다.

`Player`의 카메라 방향과 키 입력은 이번 단계에서 유지한다. S2의 `PlayerInput`에서 옮긴다. S1은 아직 서버가 공개 세계의 권한자가 되는 단계가 아니다. 공개 세계 전투와 진행 저장의 권한 이전은 S5, S6에서 적용한다.

검사 명령은 `pnpm test:sim`, `pnpm test:boss`, `pnpm test:engine`, `pnpm test:multiplayer`, `pnpm test:server`와 `node tools/playtest.mjs`다. 두 브라우저 검사는 `CC_QA_BASE=http://127.0.0.1:<preview-port> node tools/qa-mixed-combat-language.mjs`로 실행한다. 시작 안내를 확인하고 제작자 이동 fixture로 월드 II 전투를 준비한다.

2026-10-18 `dev`의 월드 IV와 300레벨 보레아스, 반복 보스 보상, 공개 세계 공유 전투, 새벽 퀘스트를 유지했다. 보레아스 경고도 같은 사건 경로를 쓰며, 푸른 광선 6방향과 눈보라 원 7개를 호스트와 손님이 같은 좌표로 그린다. Steam Blink의 10 HP 회복도 `Combat.heal()`에서 한 번만 계산한다. 재도전은 이전 공격을 취소하고 처치당 코인 청구 상태를 새로 연다.

`test:sim`은 33건이다. 보레아스의 호스트와 손님 경고 좌표, 재도전당 코인 1회 청구, Steam Blink 회복을 추가 확인한다. 브라우저의 `tools/playtest.mjs`는 솔라칸 이후 월드 IV로 이동하고 보레아스 처치 뒤 마지막 엔딩을 확인한다. 디버그 목표 완료가 생략한 처치 XP는 보스 기상 대기 전에 기존 3레벨 조건으로 맞춘다. 클래스별 결과와 마지막 게임 상태는 출력 폴더의 `<class>-result.json`에 저장한다.

공개 세계가 기본으로 전투를 공유하므로 서로 다른 QA를 같은 relay에 동시에 연결하면 fixture 상태가 섞인다. 브라우저 QA마다 새 relay 포트를 쓰거나 서버를 재시작한다. 전체 플레이테스트에는 실제 로컬 계정 서버와 Postgres를 켜 두어 `/api/account/session`의 proxy 502를 분리한다. 진행과 보스 상태를 준비하는 QA fixture는 서버 권한 이전이나 실제 모든 보스 전투 완주의 근거로 쓰지 않는다.
