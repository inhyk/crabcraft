# Crabcraft 배포 전 확인

기준: 작업 브랜치(`11d2742`에서 점검 시작), 2026-10-15 UTC. **이번 후보의 전체 검증과 배포는 아직 완료되지 않았다.** 이전 로컬 실행 증거, 현재 후보의 검사, 실제 공개 버전을 구분한다. 상세 개발 기록은 [world2-quality-worklog.md](world2-quality-worklog.md)에 있다.

## 요구 사항과 보관된 증거

아래 로그는 이 작업 공간의 `tmp/qa/`에 보관한다. 파일 이름의 `final`만으로 성공을 판단하지 않고 실제 결과와 검사 코드를 확인했다. 이전 실행 결과가 이번 후보의 전체 재검증을 대신하지는 않는다.

| 요구 사항 | 이전에 관찰한 로컬 결과 | 재현 검사 / 증거 |
| --- | --- | --- |
| 월드 II 퀘스트 수락 | 실제 F 수락, 개인 저널 갱신, 이동 중 낡은 대화 정리, KO/EN | `island-requests-browser-final.log`, `island-requests-shared-{ko,en}.log`; `tools/qa-island-requests.mjs`, `tools/qa-quest-chapter-handoff.mjs` |
| 두 월드의 양방향 포탈 | 게스트의 실제 F 이동, 도착 후 재진입 방지 | `party-portal-lifecycle-final.log`; `tools/qa-party-portal-lifecycle.mjs` |
| 이주한 주민과 탐험 | 주민 경로, 퀘스트 광석·등불·기억 장소, 길과 충돌 처리 | `star-alcoves-quest-route-final.log`; `tools/qa-world2-ground.mjs`, `tools/qa-starhaven-multiplayer.mjs` 및 관련 섬 탐험 검사들 |
| 제작자 모드 13570 | 실제 키 입력, 텍스트 입력 제외, 반복 키 방지, 월드 II 이동 | `creator-language-local.log`; `tools/qa-creator-language.mjs` |
| 레벨 20 이후 성장 | 레벨 100000 및 최대 안전 저장 XP, HUD 숫자와 재로드 | `unbounded-hud-final.log`; `tools/qa-unbounded-hud.mjs`. 수학적 무한 정밀도는 아니며 JS 안전 정수 저장 범위까지 검증 |
| 등대와 날씨 공유 | 게스트 실제 F 등대 조작, 공유 밤과 개인 퀘스트; 꺼진 등대에 낡은 밤 요청이 덮어쓰지 못함 | `creator-shared-beacon-local.log`, `shared-beacon-final.log`, `tests/battle.test.mjs` |
| 파티와 싸우기 모드 | 같은 파티 보호, 월드 이동·열 번 재참가·방장 교체 후 파티/PvP 유지 | `party-portal-lifecycle-final.log`, `room-reconnect-final.log`, 전투/방 테스트 |
| 춤추는 두 엔딩 | 챕터/최종 엔딩 각각 16명, 왕관·월드 저장, 실제 계속하기/재생, 두 언어·반응형 크레딧 | `endings-verified-local.log`, `ending-resume-full-local.log`; `tools/qa-dance-endings.mjs`. `endings-final-local.log`는 실패한 중간 실행이므로 성공 증거로 사용하지 않음 |
| 엔딩 도중 공유 이동 | 호스트 건너뛰기 후 게스트 춤·DOF·조작 잠금 정리, 월드 II 실제 이동 | `shared-ending-final-local.log`; `tools/qa-shared-chapter-ending.mjs` |
| 저장·복귀 | 등대 축복은 재로드/세계 이동에 유지되고 실제 보스 승리로 소비된 뒤 복원되지 않음 | `blessing-save-local.log`; `tools/qa-blessing-save.mjs` |
| KO/EN 전투 안내 | 실제 서로 다른 언어의 호스트/게스트, 전투 중 설정 변경, 공유 피해와 방장 교체 | `mixed-combat-language-final.log`; `tools/qa-mixed-combat-language.mjs` |
| 채팅/미니맵/보스 안내 | 48개 실제 기술·언어·화면 조합에서 경고와 주요 HUD 간 겹침 없음 | `compact-mechanics-final.log`; `tools/qa-compact-combat.mjs`. 검사하지 않은 모든 화면 크기의 보장은 아님 |

## 현재 후보의 검사 결과와 남은 항목

- 원격 끌어당김 잔류 결함은 `b569006`에서 수정했다. 기존 버전에서 실패하는 회귀 사례를 포함한 보스/전투/적/퀘스트 42개 검사가 통과했고 타입 검사와 프로덕션 빌드가 통과했다. `remote-push-unit-complete.log`, `remote-push-build-refined.log`.
- 15723b2 소스의 방 8개·보스/전투/적/퀘스트 43개·엔진 4개, 총 55개 검사가 21:16 UTC에 모두 통과했다. `release-rooms-current.log`, `release-boss-current.log`, `release-engine-current.log`. 이들은 아래 실제 브라우저 검사를 대체하지 않는다.
- **실제 두 클라이언트의 집중 이동 검사가 통과했다.** `candidate-b569006-movement.log`에서 짧은 힘은 0.16000000000000003m 이동 후 2초 이상 정지했고, 정상 길이 Undertow는 게스트를 약 7.41m 끌어당긴 뒤 2.4초 동안 위치가 유지됐다. 페이지 오류는 없었다. `tools/qa-remote-push.mjs`로 실행했다. 주입한 힘·보스 단계·생존 설정은 명시적 검사 fixture이며 자연스럽게 보스를 이긴 증거가 아니다.
- 수정 전 동결 빌드의 실제 60분 검사는 20:13:11.296–21:13:11.301 UTC, 3600.005초 실행을 마쳤다. 두 연결 유지, 컨텍스트 유실 0, 468회 공격 완료, geometry/texture/program 461/125/274와 효과 풀 14개 유지, errors 없음. `combat-endurance-final.json`과 `combat-endurance-live.log`. 게스트가 -110.12m까지 밀린 알려진 결함은 그대로 관찰되었으므로 **이전 버전의 자원/연결 지속 검사**만 뒷받침하며 이동 정상 증거가 아니다.
- 수정 후보 동결 빌드 `b569006`의 실제 60분 검사가 통과했다. 21:13:41.314–22:13:41.323 UTC, 3600.009초·120체크포인트·468회 공격. 두 연결 유지, 컨텍스트 유실 0, 준비 120초 후 위치 편차 각각 0m. geometry/texture 461/125, program 호스트273·게스트274, 효과 풀14가 각각 유지됐다. FPS 59.984–60.029 / 59.984–60.053, 강제 GC 없는 heap 169.00–197.26 / 168.46–196.55MB. `candidate-b569006-hour-summary.json`, `candidate-b569006-endurance-final.json`. 생존 무적/보스 단계 fixture를 둔 로컬 지속 검사이며 자연 승리 증거가 아니다.
- 순차 검사기 `tools/qa-candidate-sequence.mjs`는 이전 실제 프로세스 종료와 33개 동결 해시/서빙 HTML, 집중 이동, 수정 60분을 순서대로 확인하고 22:13:41.503 UTC에 종료 코드0으로 완료했다. `candidate-b569006-sequence-coordinated.log`, 상태 `candidate-b569006-sequence.json`. 이 동결 소스에는 이후 기술 표시 번역과 Nova 최소1.9초 변경이 포함되지 않는다.
- 실제 48개 KO/EN 기술 툴팁(세 직업×네 기술×두 언어×두 화면) 이름·설명·화면 경계 검사 통과. 실제 설정 KO→EN→KO에서 치유 시전 시작/종료/GCD/시계 보존, W/Escape 중단 문구와 기존 만료 시간 보존도 통과했다. `ability-language-current.log`; 동결 이전 빌드의 영어 잔류는 `ability-language-baseline.log`에 보관. 새 기술 설계 변경은 없다.
- 월드 II 폭주 Nova의 실제 비교: 이전1.3728초는 300ms 후 W 이동5.040m에도136피해, 현재1.9초는7.625m 이동해 피해0. 정지 양성 대조군은 두 버전 모두136피해였다. `nova-walking-baseline.log`, `nova-walking-current.log`. 단계/시작 위치를 둔 무적 없는 로컬 공격 fixture이며 전체 자연 승리 증거가 아니다. 최신 두 클라이언트 혼합 언어 검사도 공유120피해·정상 Nova·설정 전환·호스트 교체·재참가 통과(`mixed-combat-language-current.log`).
- 전체 HP6200의 레벨20 보스를 실제 도전 버튼 이후 키 입력만으로 쓰러뜨렸다. 무적 없음, 전투 중 위치·HP·피해·단계 조작 없음. 16명 최종 춤→크레딧→계속 모험하기에서 월드II/최종 왕관/보스 dead/무적false 복귀 통과. `real-boss-run-current.log`, `tools/qa-real-boss-run.mjs`. 제작자 UI로 시작 레벨/세계를 준비했으므로 레벨1부터 전체 퀘스트 진행한 증거는 아니다.
- 실제 걷기 광석 퀘스트 통과: F 수락→네 곳 수집→주민에게 복귀→보상1500 XP→재로드. 실제 전투 XP9492와 보상으로 레벨20→24, 총XP32992·퀘스트 done·월드II·무적false가 재로드 후 유지됐다. `ore-walk-current.log`, `tools/qa-walk-ore-quest.mjs`. 제작자 시작 레벨/세계 외에는 위치·HP·피해·퀘스트 진척을 주입하지 않았다. 이전 세 번의 자동 조작 실패는 별도 로그에 남겨 성공과 구분했다.
- 실제 설정 전환에서 지역/퀘스트/보스/레벨 배너는 같은 DOM의 문구만 바꾸고 원래 애니메이션과4.3초 만료를 유지한다. 일시정지된 솔로 설정에서도 보스 여정이 즉시 번역되며 시계/보스 상태가 바뀌지 않는다. 1월드 미니맵 canvas 시설명 KO/EN 전환과 다른 언어 잔류 없음도 실제 검사 통과. `banner-language-current.log`; 빌드/타입 검사 및43개 관련 회귀 검사 통과. `tools/qa-banner-language.mjs`.
- 실제 KO/EN 두 클라이언트의 전체 HP6200 최종 보스 협동 전투가 통과했다. 기본 방 생성/참가·월드II 공유 이동·도전/합류 후 실제 이동/기술 키만 사용했다. 두 화면의 체력/단계가 일치했고 각각16명 최종 춤과 왕관 저장·월드II 복귀를 확인했다. `real-coop-current.log`, `tools/qa-real-coop-run.mjs`. 로컬 relay/시작 레벨·세계만 제작자 UI로 준비했으며 자연 레벨1 성장이나 공개 최신판 검증은 아니다. 계속 모험하기 후 방은 종료되어 connectedfalse이며, 재접속 유지 증거로 쓰지 않는다.
- 세 등불 실제 길게F 입력·세 기억 장소 실제 탐험·수프 NPC 배달, 개별 보상1700/2000/1000 XP와 재로드가 통과했다(`walk-island-current.log`, `tools/qa-walk-island-requests.mjs`). 전투 포함 총XP40132/26레벨, 세 퀘스트 done·월드II·무적false 유지. 제작자 시작 레벨/세계 외 진척/위치/피해 주입 없음.
- 실제 순찰도 통과했다: 서쪽6/동쪽8 처치, NPC 보상1100/1800 XP, 총XP34036/24레벨·w1/w4 done·월드II·무적false 재로드 유지. 적 재생성은 화면 밖에서 기다리는 실제 이동으로 확인했다(`walk-patrol-current.log`). 실제 PvP 지연 검사도 통과했다(`native-pvp-delayed-current.log`): 레벨1 기본 캐릭터의 Bubble Bolt 시전/피해, 파티2에서 HP60 보존, 혼자로 바꾼 뒤 사망/기본100HP 부활·모드/파티 유지, 협동 전환 후 춤 전달. 시작 레벨/HP/위치/전투 fixture 없이 실제 버튼/키만 사용했다. 로컬 각 전달75ms(약150ms 편도)를 모사했으며 실제 공개 프런트엔드 검증은 아니다.
- 시작2026-10-15 12:56:12 UTC부터 실제 개발/검증을 계속했고 22:56:39 UTC 확인으로 요청한10시간을 넘겼다. 최신 배포와 공개 프런트엔드 검증이 남아 있으므로 전체 목표 완료로 처리하지 않는다.

## 공개 상태

공개 중계 서버의 프로토콜 검사는 `server/cloudflare/smoke.mjs`로 다시 실행해 종료 코드 0을 확인했다(`release-public-relay-smoke.log`). 실제 인터넷 WebSocket 방 생성/참가·채팅·전투 메시지·호스트 이전·재참가·월드 II 체크포인트와 방 격리를 확인한 **프로토콜 fixture 검사**다. 최신 프런트엔드가 공개됐다는 증거는 아니다. 중계 서버의 브라우저 Origin 제한은 유지한다. `tools/qa-mixed-combat-language.mjs`의 `CC_QA_BASE`/`CC_QA_RELAY` 설정을 준비했으며, 최신 프런트엔드의 공개 중계 브라우저 검사는 실제 허용 도메인 배포 후 실행해야 한다. 해당 최신 공개 브라우저 검사는 아직 남아 있다.

`https://seonn.dev/games/crabcraft`의 공개 게임은 `fc0fee5` 수준이다. 이후 작업 브랜치 변경은 공개 버전이 아니다. 2026-10-15 16:51:30 UTC 프로덕션 배포가 Vercel `api-deployments-free-per-day` 한도로 거절되었으며 retry24h가 안내되었다. 새 프로젝트·계정·결제·우회나 반복 배포를 시도하지 않았다. 한도 해제 이후 실제 배포 성공과 공개 URL 검증이 필요하다.
