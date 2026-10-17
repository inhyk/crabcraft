# Crabcraft 배포 전 확인

최신 상태: **2026-10-17 KST, 소스 `b42f6a6`의 개인 스킬 쿨타임·지형 경고·큰 지도·신규 보스 패턴을 프로덕션에 배포하고 공개 두 브라우저 검사를 완료했다.** `11d2742`에서 시작한 이전 로컬 검사와 최신 공개 검사 범위를 구분한다. 상세 개발 기록은 [world2-quality-worklog.md](world2-quality-worklog.md)에 있다.

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

## 2026-10-15 당시 공개 상태 · 아래 차단은 10월17일 해소

공개 중계 서버의 프로토콜 검사는 `server/cloudflare/smoke.mjs`로 다시 실행해 종료 코드 0을 확인했다(`release-public-relay-smoke.log`). 실제 인터넷 WebSocket 방 생성/참가·채팅·전투 메시지·호스트 이전·재참가·월드 II 체크포인트와 방 격리를 확인한 **프로토콜 fixture 검사**다. 최신 프런트엔드가 공개됐다는 증거는 아니다. 중계 서버의 브라우저 Origin 제한은 유지한다. `tools/qa-mixed-combat-language.mjs`의 `CC_QA_BASE`/`CC_QA_RELAY` 설정을 준비했으며, 최신 프런트엔드의 공개 중계 브라우저 검사는 실제 허용 도메인 배포 후 실행해야 한다. 해당 최신 공개 브라우저 검사는 아직 남아 있다.

`https://seonn.dev/games/crabcraft`의 공개 게임은 `fc0fee5` 수준이다. 이후 작업 브랜치 변경은 공개 버전이 아니다. 2026-10-15 16:51:30 UTC 프로덕션 배포가 Vercel `api-deployments-free-per-day` 한도로 거절되었으며 retry24h가 안내되었다. 새 프로젝트·계정·결제·우회나 반복 배포를 시도하지 않았다. 한도 해제 이후 실제 배포 성공과 공개 URL 검증이 필요하다.


## 2026-10-15 22:58 UTC · 당시 배포 차단 재개 기준 (10월17일 해소)

현재 검증/QA 커밋은 `072edcb`이며 원격 feat/multiplayer-rooms와 일치하고 작업 트리가 깨끗하다. 읽기 전용 `vercel inspect` 재확인도 종료 코드0이며 공개 alias는 여전히 `dpl_G2iUGtqSge21qVXcDfpNz8iGcVqB`다(`release-blocker-audit-inspect.log`). 16:51:30 UTC 최초 거절부터 연속된 여러 목표 작업에서 동일 일일 배포 한도를 기록했다. 실제10시간 개발/검증을 마친 현재 남은 단계는 최신판 배포와 허용 공개 도메인에서 두 브라우저 검증이다. 새 배포 재시도·계정/프로젝트 우회·구매는 실행하지 않았다.

재개 시 기존 `/Users/inkeun/projects/crabcraft`의 연결된 Vercel 프로젝트를 사용한다. 기존24시간 재시도 안내 시각은2026-10-16 16:51:30 UTC(한국시간10월17일01:51:30)이며 자동 실행 예약을 만들거나 배포 성공을 보장한 것은 아니다. 배포 성공 후 stable alias의 새 deployment/소스 일치, seonn.dev/games/crabcraft의 링크/페이지, 실제 KO/EN 두 브라우저의 공개 중계 방 생성·참가·피해·날씨·여행·파티·저장/복귀를 확인해야 한다. 공개 브라우저 검사기는 `tools/qa-mixed-combat-language.mjs`의 CC_QA_BASE/CC_QA_RELAY로 기존 허용 도메인과 공개 relay를 지정할 수 있다. 로컬 검사 성공이나 프로토콜 fixture만으로 이 단계를 완료 처리하지 않는다.


## 2026-10-17 KST · 최적화판 공개 검증 완료

기존 Vercel 프로젝트에서 프로덕션 배포가 성공했다. 소스는 `d4516ea`, deployment는 `dpl_E5ozHvN68kQD3Aq71hu15XvwYoSD`, stable alias는 https://inh-crabcraft-multiplayer.vercel.app 이다. `optimization-deploy.log` 종료0과 `optimization-public-inspect.log`의 Ready/production/alias 일치를 확인했다. https://seonn.dev/games/crabcraft HTTP200과 기존 플레이 링크도 확인했으며 허브 카드 중복 등록·별도 허브 변경은 하지 않았다. 공개 index.html은 로컬 프로덕션 빌드와 바이트 일치하며 모든 JS/CSS 파일도 각각 SHA256/바이트 일치를 확인했다(`optimization-public-assets.log`). 이전 일일 배포 한도는 안내된24시간 이후 기존 프로젝트의 정상 배포로 해소했으며 계정·Origin 보호·구매 설정을 바꾸지 않았다.

그래픽/해상도/전투 수치/전송 주기를 유지하면서 정지 상태3초의 레벨 DOM 갱신180회→0회, 파티 DOM 갱신11회→0회를 실제 전후 비교했다. 실제 레벨업/HP 변화/파티 변경/KO→EN→KO 시 표시는 갱신된다. 친구별 배열 복사·역탐색과 매 프레임 Vector3 할당도 제거했다. 고품질 월드II 네 장소는 전후 모두 약60fps였으며 전체 CPU/FPS 개선을 주장하지 않는다. 빌드/타입 및 방8+보스43+엔진4 회귀 검사55개가 통과했다. 세부 전후 수치/동결 기준은 작업 기록에 있다.

다음은 stable alias와 공개 `wss://inh-crabcraft-rooms.seonn.workers.dev/multiplayer`를 사용한 실제 브라우저 검사이며 모두 종료0/페이지 오류0이다. 서로 다른 검사를 GPU 경합 없이 순차 실행했다. WebSocket Origin은 브라우저가 실제 공개 주소에서 보낸 값이며 덮어쓰지 않았다.

- `optimization-public-native-pvp.log`: 기본 레벨1 KO/EN 캐릭터의 실제 방 생성/참가, 기술로100→60피해, 파티2에서HP60보존, 혼자 전환 후60→0, 자연100HP부활 및 PvP/파티 유지, 협동/춤 송수신, 친구 이탈 시 파티 행 감소. 전투/HP/위치 주입 없음.
- `optimization-public-mixed.log`: KO/EN 보스·공격 안내, 정상 길이 Eclipse/Nova, 공유120피해, 전투 중 설정 언어 전환, 방장 교체/재참가 후HP3290·단계2·공격 시간 유지. 시작 세계/위치/레벨/보스 단계/피해와 생존 설정을 둔 **전투 fixture**이며 자연 보스 승리 검사로 계산하지 않는다.
- `optimization-public-portal.log`: 게스트 실제F로 두 월드 왕복, 도착 후3.3초 재진입 없음, 파티3/PvP 유지, 서로 다른10연결 재참가, 유효하고 참가자 수에 맞는 체크포인트, 방장 이탈 후 새 방장F복귀. 포탈 근처 위치/생존 설정을 둔 **여행 fixture**이며 전체 도보 여정의 증거는 아니다.
- `optimization-public-beacon.log`: 실제 등대F길게 누르기, 두 사람의 밤/축복/개인q3완료·q4시작/XP1730일치, 재전송 시 중복XP없음, 늦게 온 세 번째 참가자의 퀘스트 연결. 시작 위치/레벨/선행 퀘스트와 생존을 준비한 **퀘스트 fixture**다.

공개 첫 PvP 시도는 검사기 relay 치환이 URL의 mode/room query를 버려 방 생성 전 실패했다(`optimization-public-native-pvp-query-attempt.log`). 로컬 relay는 메시지에서도 방 정보를 받지만 공개 Worker는 upgrade query가 필요하다. 네 검사기의 relay 치환에서 원래 query를 보존하도록 수정하고 위 최종 실행을 완료했다. 게임/Worker 코드는 이 실패 때문에 변경하지 않았다. QA/문서 변경은 배포 산출물에 포함되지 않는다.

기존 실제 도보 퀘스트/솔로·협동 보스 자연 승리/저장·재로드/60분 지속 검사는 앞 절의 해당 소스·로컬 범위 그대로 유효하다. 공개에서 전체 레벨1→모든 퀘스트→엔딩을 다시 완주했다고 주장하지 않는다. 요청한10시간 개발, 필수 기능 로컬 검증, 최신 공개 배포와 공개 멀티플레이 검증을 완료했으며 알려진 배포 차단은 남아 있지 않다.


## 2026-10-17 08:00 UTC · 스킬/보스/큰 지도 배포

소스 `b42f6a6`를 기존 Vercel 프로젝트에 배포했다. `dpl_3eeUvipU5tGupuGVRF76SENu56Zh` Ready/production과 stable alias https://inh-crabcraft-multiplayer.vercel.app 일치(`boss-map-deploy.log`, `boss-map-public-inspect.log`). 먼저 기존 Cloudflare Worker의 패턴 허용 목록을 배포했고 버전은 `d83840a5-4b97-4bda-8017-02cd7bac68ea`다(`boss-map-worker-deploy.log`, 종료0). 설정/DO 바인딩/Origin 제한은 유지했다. 공개 index와 모든28개 JS/CSS를 로컬 dist와 SHA256 비교해29개 파일 모두 일치, seonn.dev/games/crabcraft HTTP200/기존 플레이 링크도 확인(`boss-map-public-assets.log`). 허브 카드를 중복 등록하거나 작업 중인 허브 소스를 변경하지 않았다.

- 모든12개 기술의 개인 회복 검사, 충분한 자원에서 연타/예약/레벨 복원/부활, 실제 시전 취소/자원/GCD를 포함한 보스/전투63·방8·엔진4, 총75개 통과. 타입/빌드/Worker 타입/dry-run 통과.
- 개인 쿨0이던 집게 강타/물거품 화살/성스러운 일격은 성공 발동 후3초, 껍질 치유10초. 시전은 별도다. 실제 연타 성공 간격3.017/4.518/4.517/12.016초, 두 성공 발동 사이 재발동 없음(`cooldowns-browser.log`). KO/EN48개 실제 툴팁과 설정 중 시전/취소 시간 보존 통과(`cooldowns-language.log`).
- 공개 stable alias와 실제 허용 공개 relay에서 큰 지도/G/Escape/줌/이동 잠금/시네마틱 자동 닫기를 양쪽 월드와1280×800/718×492에서 통과했다. 실제 지형 높이차33.04m/3.84m 위치에서 경고 정점이 약0.28m 위로 맞춰진다. 십자 해일/폭격의 공유 위치·방향·표시 수와 자연 예고 만료, 폭격 중 방장 교체도 통과했다. 페이지 오류0(`boss-map-public-browser.log`). 세계/레벨/보스 단계/위치/생존 fixture를 사용하므로 자연 최종 보스 승리 증거는 아니다. 별도 단위 검사가 각 패턴의 위험/안전 구역과1회 피해를 검증한다.
- 로컬 고품질1280×800/M3 Pro의 짧은 보스 구역 GPU 검사 평균60.50FPS/CPU3.54ms/페이지 오류0(`boss-map-perf.json`). 모든 기기/모든 패턴의 성능 보장이나 이전 버전보다 FPS 상승을 주장하지 않는다.

사진으로 추가 전달된 새 섬/강화/이야기 관련 요구는 이 배포의 구현 완료에 포함하지 않는다. 불명확한 손글씨와 사진 확대/게임 구현 의도에 대한 확인 질문을 별도로 보냈다.


최신 공개 기본 레벨1 KO/EN PvP도 종료0으로 통과했다(`cooldowns-public-native-pvp.log`). 실제 방 생성/참가, 마법 피해100→60, 파티2에서 체력 감소 없이60→62.838 자연 회복, 파티 탈퇴 후 사망, 자연100HP 부활과 모드/파티 유지, 협동 전환/춤 전달/이탈까지 확인했다. 전투/HP/위치 주입이나 Origin 덮어쓰기 없이 페이지 오류0이다.

## 2026-10-17 · 세 번째 섬과 왕관 이동 잠금

사진은 게임 구현 요청이라는 사용자 확인을 반영했다. 난파선 옆 포탈, 10레벨 왕관을 얻기 전 월드2 잠금, 20레벨 왕관 이후 월드3 개방, 30레벨 솔라칸과 미라 구출/17명 춤 엔딩을 추가했다. 제작자 이동만 명시적으로 우회한다. 세 섬의 주민/상점/퀘스트/왕관·보스 상태를 전환·저장·네트워크에 연결했다. 월드2 별길 동쪽 언덕과 순찰/녹의 폭군 잔영, 얕은 물 순찰, Shift 달리기, 코인 드롭과 공격 강화(단계당8%, 최초100코인)를 포함한다.

후속 요청에 따라 월드2 입장 시 최소10레벨로 올리던 코드를 제거했다. 입장/귀환은 레벨·XP를 변경하지 않는다. 새 입장 잠금과 복원 순서가 충돌하던 문제도 수정했다. BossJourney를 game에 할당한 뒤 복원해 유효한 월드2/3 저장을 그대로 복원한다.

검증: 타입/배포 빌드, 보스·전투·퀘스트·쿨64, 방9, 엔진4 통과. Worker 타입/dry-run 통과. 로컬 실Chrome(`third-world-browser-final.log`)에서 실제 F 포탈/퀘스트 수락/대장간 구매·잔액 부족/Shift 달리기/G지도/저장·재로드/KO방장·EN참가/월드3 늦은 참가/실제30레벨 도전 버튼/폭격과 방장 교체/실제 전투 사망 알림에 따른 코인·퀘스트 진척/미라 포함17명 춤/3→2→1귀환을 확인했고 페이지 오류0. 1레벨137XP와37레벨90000XP가 이동 후 유지됐다. 진행/생존/위치/보스 단계/마지막 사망 피해는 명시적인 QA fixture이며 자연1→30레벨 완주나 무적 없는 최종 왕 승리를 주장하지 않는다. 초기 검사는 입구 집의 길 막힘과 재로드 시 월드1 복원을 발견해 수정 후 재검사했다.

공개 배포·확인 결과는 다음 메모에 기록한다.

### 공개 세 섬 검증 · 08:17 UTC

GitHub의 방문 통계 커밋 `32c9257`을 보존해 병합한 `0da0759`를 기존 프로젝트에 배포했다. 게임 배포 `dpl_7rD66Gr5hxfo6ZNNe98js99QySvn` Ready/production, stable alias 일치(`third-world-public-inspect.log`). Worker는 `795e2230-9793-468d-9bb1-6334c4eb08ce`; 기존 DO 바인딩/Origin/계정을 유지했다. 공개 index+모든 JS/CSS29개 파일이 로컬 dist와 SHA256 일치, seonn.dev 기존 카드 HTTP200와 stable playUrl 확인(`third-world-public-assets.log`).

공개 페이지/공개 Worker를 사용한 실Chrome 두 브라우저에서도 전체 `qa-third-world.mjs`가 종료0, 페이지 오류0으로 통과했다(`third-world-public-browser.log`). 10레벨 왕관 전 월드2 잠금, 20레벨 왕관 전 월드3 잠금, 실제F입장과3→2→1귀환, 1레벨137XP/37레벨90000XP 보존, 달리기4.109m→6.800m, 주민 퀘스트 수락/사망 진척1과89코인, 강화250→150코인/rank1 및 다음200코인 구매 거절, 큰 지도와718×492화면, 월드3/코인/강화/퀘스트 재로드, 영어 친구의 늦은 참가, 실제30레벨 도전 버튼과공유10500HP/폭격, 폭격 중 방장 이탈/자연 만료, 미라 포함17명 춤 엔딩을 확인했다. 이는 앞 절과 같은 진행·생존·위치·패턴·사망 피해 fixture 범위이며 자연30레벨 승리 주장이 아니다. 관련 단위/방/엔진 총77개 통과.

추가 복귀 확인: 엔딩 후 월드3를 불러올 때 구출된 미라를 항구(14,60)에 배치했다. 새 캐릭터의 완료 저장 fixture로 로드/재로드 모두 월드3·37레벨90000XP·finalCleared·미라 표시/항구 위치·빈 감옥을 확인했고 페이지 오류0(`third-world-mira-restore.log`).

### 최종 공개판 및 허브

구출 후 미라의 항구 배치를 포함한 `aa425e7`을 `dpl_Dj42uz4CMvdmw8oWzRThLKzXK4qu`에 배포했다. stable alias Ready/production과 로컬 최종 index/JS/CSS29개 SHA256 일치를 재확인했다(`third-world-final-public-inspect.log`, `third-world-final-public-assets.log`). 세 섬 소개/사진3장은 별도 깨끗한 허브 작업트리에서 최신 `359b5c9`를 보존한 `7769d91`로 반영했다. 허브 전체빌드가 통과했고 `dpl_DRhQePo12MTsz7nVKyBeEzXUoEBC` Ready 및 seonn.dev alias, 소개의 세 섬/30레벨 문구, 사진3장 SHA256 일치를 확인했다(`/tmp/crabcraft-third-world-hub-*.log`). 사용자의 작업 중인 원래 허브 작업트리는 변경하지 않았다.

최종 stable alias에서도 확장된 실브라우저 검사가 종료0으로 통과했다(`third-world-final-public-browser.log`). 배 옆 포탈 중심의 충돌 밀림0m, 모든 기존 이동/잠금/코인/퀘스트/대장간/재로드/공유30레벨 보스/방장 교체/17명 엔딩 검증을 유지했고, 엔딩 후 월드3로 돌아와 저장·재로드하면 구출한 미라가 항구에 표시되고37레벨90000XP와최종 왕관도 유지됐다(`RESCUED_MIRA_PERSISTS_IN_HARBOR`). 페이지 오류0이다. 허브 로그 사본도 `tmp/qa/third-world-hub-{build,deploy,inspect,public}.log`에 보존했다. 이 작업에서 소유한5205 미리보기만 종료했고 사용자 브라우저와 다른 포트의 프로세스는 유지했다.

2026-10-17 · 광장 귀환과 시작 안내

시작 전에 한국어/영어 안내 창을 표시한다. 최신 요청에 따라 문구는 “충전하면서 플레이해 주세요.”와 “컴퓨터로 실행해 주세요.”이며, 100% 충전 문구는 사용하지 않는다. 확인 버튼 뒤에 원래 시작 화면 또는 직접 게임 링크가 열린다. 퀘스트 → 멀티플레이 → 코인 순으로 오른쪽 패널을 배치하고 긴 내용은 스크롤한다. 코인도 화면에 따로 겹치지 않고 같은 흐름에 배치한다.

T를 2초 유지하면 현재 섬의 광장으로 귀환한다. 월드1은 원래 광장, 월드2는 (0,63), 월드3은 (0,60)이며 섬의 입장 포탈과 구분한다. 손 떼기/이동/점프/Esc/창 비활성화는 기존 채널 취소 동작을 사용한다. 메뉴/큰 지도/대화/퀘스트 창/죽음/연출 중에는 시작할 수 없다. HP·XP·레벨·스킬 쿨다운을 초기화하지 않는다.

`npm run build`, 기존 전투/스킬 검사64개, 실Chrome `tools/qa-square-recall.mjs`가 종료0으로 통과했다(`tmp/qa/square-{build,boss-tests,recall}.log`). 한국어/영어 시작 안내와 확인 버튼, 1280×800/834×600/718×492의 접힘·펼침6개 배치, 실제 T 유지/해제/이동 취소, 채팅 입력과 메뉴 중 차단, blur 취소, 세 월드의 광장 귀환을 확인했다. 레벨1/137XP/HP70 유지, 목적지 충돌 밀림0m, 페이지 오류0이다. 섬 잠금 해제를 위한 진행 상태·생존·출발 위치·전투 중 HP 자연 회복 차단을 명시적으로 주입한 기능 검사이며 자연 진행 승리 검사가 아니다. 작은 화면에서 넘친 패널은 오른쪽 스크롤로 접근한다.

배포 완료: 소스 `0460b27`, Vercel `dpl_DhFRvW2cbz32yTHQCHzJbmb9Z1xr`가 production/Ready이며 기존 플레이 alias에 연결됐다(`square-deploy.log`, `square-inspect-ready.log`). 공개 index와 JS/CSS 전체28개 SHA-256이 로컬 dist와 일치하고, seonn.dev/games/crabcraft는 HTTP200 및 같은 플레이 링크를 유지한다. 공개 alias의 실Chrome 검사도 같은 전체 항목으로 종료0/페이지 오류0을 확인했다(`square-public-browser.log`). 서버 변경이 없어 Worker는 재배포하지 않았다.

## 2026-10-17 · 등대 아래 비밀 무대와 해파리 드론

등대 기단 남쪽 (190,-120)에 게 문양을 추가했다. 가까이에서 F를1.5초 유지하면 작은 게3마리가12초간 춤추며 불꽃을 보여준다. 최초50코인과 발견 여부를 저장하고 이후에는 춤만 반복한다. 짧은 누름 취소, 등대 점등/퀘스트/XP 보존, 재로드 후 중복 보상 차단을 확인했다.

해변의 실제 이동 가능한 물속5곳에 새 심해 해파리 드론을 배치했다. 반투명 발광 몸체/8개 촉수를 가진 절차적 모델이며 촉수24조각은 한 InstancedMesh로 그린다. 물 밖 추격을 막고0.9초 전기 공격 예고 후 고정된 원 안에 남은 대상만 타격한다. 회복3.8초, 최초 기준85HP/45XP/11코인이며 사망·기절은 예정 타격을 차단한다. 월드2/3에서는 숨기고 귀환 시 원래 물속 위치로 복원한다. 기존 고철 게/청소부 퀘스트 진척을 대신 올리지 않는다.

기존 host-authenticated world checkpoint의 선택 필드로 전기 예고 위치·남은 시간을 전달한다. 새 필드는 기존 relay의 확장 필드 전달과 호환되며 Worker 실행 로직은 변경하지 않았다(서버 파일 변경은 TS 타입뿐). 수신자는 좌표/시간/ID를 검증하고 같은 예고를 다시 만들지 않는다. 해파리 상태/XP도 공통 전투 체크포인트에 포함한다.

`npm run build`, 전투/스킬68개, 방9개가 통과했다. `tools/qa-lighthouse-sea.mjs`의 실Chrome 로컬 검사는 종료0/페이지 오류0이다(`tmp/qa/{secret-sea-build,secret-sea-tests,secret-sea-relay-tests,lighthouse-sea-browser}.log`). 실제 F 유지/취소·재로드 저장·AI 전기 피해·한 번의 XP/코인·세 월드 격리/귀환과 두 브라우저의 같은 예고/손님 공격7HP/공유 처치 보상을 확인했다. 위치·진행 잠금 해제·생존·처치 피해는 명시적 fixture이며 자연 진행 완주를 주장하지 않는다. 스크린샷에서 등대 아래 무대와 물속 발광 해파리 모델을 직접 확인했다.

공개 배포: 소스 `29c7a59`, Vercel `dpl_GPvwCnjyCzBHBeFDDEYcqqXLiEcH` production/Ready와 기존 stable alias를 확인했다(`secret-sea-deploy.log`, `secret-sea-inspect-ready.log`). 공개 index와 전체 JS/CSS28개 파일의 SHA256이 로컬 dist와 일치하고 seonn.dev/games/crabcraft HTTP200/기존 플레이 링크를 확인했다(`secret-sea-public-assets.log`). 공개 stable alias와 실제 공개 Worker에서도 위 실Chrome 전체 검사가 종료0/페이지 오류0으로 통과했다(`lighthouse-sea-public-browser.log`): 저장/재발견·전기 피해·한 번의 보상·월드 이동과 두 브라우저의 공유 예고·손님 공격·처치 XP를 확인했다. Worker는 호환되는 기존 버전을 유지했다. 소유한5205 미리보기만 종료했고 사용자 브라우저/다른 서버/작업 중인 허브는 변경하지 않았다.

## 2026-10-17 · 계정 로그인과 클라우드 진행 저장

시작 화면과 Esc 게임 메뉴에 한국어/영어 로그인·회원가입·계정 관리 창을 추가했다. 아이디(영문/숫자/밑줄3~24자, 대소문자 통합)와10~128자 비밀번호로 가입하며 현재 기기의 게스트 캐릭터를 최초 계정에 가져온다. 로그인은 해당 계정의 캐릭터/XP/코인/퀘스트/월드/등대 발견 기록을 불러온다. 기기 설정과 게스트 진행은 별도로 유지한다. 로그아웃은 게스트 진행으로 돌아간다. 비밀번호 재설정/이메일 로그인은 이번 범위에 포함하지 않는다.

기존 Worker에 사용자별 SQLite Durable Object `CrabAccount`/`ACCOUNTS`를 추가했다. 기존 방 바인딩과 v1 마이그레이션을 유지하고 v2-accounts 신규 클래스만 추가한다. 무작위 salt/PBKDF2-SHA256(100000회)/상수 시간 비교,256비트 무작위 세션(서버에는 SHA256만 저장),7일 HttpOnly/Secure/SameSite=Strict 쿠키, 로그아웃 시 세션 폐기, 계정/IP별 요청 제한을 사용한다. Vercel의 같은 출처 `/api/account/*` 프록시로 브라우저의 제3자 쿠키에 의존하지 않는다. JSON 크기·저장 키·캐릭터/XP 검증, Origin/사용자 지정 헤더 검사, no-store 응답을 적용했다. 비밀번호/세션 값은 로그·문서에 기록하지 않는다. [Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), [DO storage](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/), [Vercel rewrites](https://vercel.com/docs/routing/rewrites)를 확인했다.

계정마다 로컬 저장 영역을 나누고 변경된 진행을 자동 업로드한다. 서버 revision으로 동시 저장 충돌을 거부해 오래된 창이 새 저장을 덮지 않게 했다. 연결 실패 시 로컬을 유지/재시도하고, 재접속 시 같은 revision의 미전송 진행을 우선 업로드한다. 더 최신 계정 저장을 불러올 때 밀려나는 로컬 진행은 별도 backup 키에 보관한다.

빌드/Worker 타입 검사/배포 dry-run, 기존 전투68·방9·엔진4개 통과. 실제 로컬 workerd/SQLite에 대한 `server/cloudflare/account-smoke.mjs`가 가입 중복/동시 가입 경합·틀린 비밀번호·세션/로그아웃 폐기·계정 격리·저장 검증·동시 revision 충돌·출처/헤더 차단·요청 제한을 통과했다. 실Chrome `tools/qa-accounts.mjs`는 실제 가입/비밀번호 확인·718×492 스크롤 모달·HttpOnly·기존137XP/73코인 가져오기·487XP/99코인 자동 저장·영어 두 번째 기기에서 같은 진행 복원·700XP/123코인 새 저장에 대한 오래된 창의 충돌 보호·세션 재로드·게스트137XP/73코인 복귀를 확인했다. 페이지 오류0. 진행 변경은 명시적 fixture이며 자연 플레이 성장 검사가 아니다. 근거는 `tmp/qa/account-{build,worker-types,worker-dry,local-api,native-local,boss-tests,room-tests,engine-tests}.log` 및 모달 스크린샷이다.

공개 검증 완료: 소스 e66d334, Worker 07b6e933-b490-420e-beb1-d38c348d023a, Vercel dpl_47L9cJGLdcw3mGPPdLv4veGG5NJq production/Ready. 공개 index/JS/CSS27개 SHA256 일치 및 seonn.dev 기존 카드 HTTP200/플레이 링크를 확인했다. 공개 API 검사와 실Chrome 전체 계정 검사도 종료0/페이지 오류0으로 통과했다(account-public-api.log, account-native-public.log, account-public-assets.log). 기존 방 검사에서 누락되어 있던 chapter 요청 필드를 보완한 뒤 공개 방 검사도 통과했다(account-public-rooms.log).

## 2026-10-17 · 두 명이 함께 타는 항구 배

항구 첫 노젓는 배를 두 좌석의 청록색/나무/황동 배로 교체했다. 부두 끝 (144,19) 근처에서 F로 탑승하고 첫 탑승자가 W/S 전후진·A/D 방향을 조종한다. 동승자는 별도 좌석에 타며 세 번째 탑승은 거절한다. F로 부두 (143,23)에 안전하게 내린다. 조종자가 내리거나 연결이 끊기면 동승자가 조종을 이어받고 빈 배는 항구로 돌아온다. 탑승 중 일반 이동·스킬을 잠그고 HP/XP/코인/쿨다운을 초기화하지 않는다. 한국어/영어 탑승·조종·동승·정원 안내를 구분했다.

호스트가 좌석과 배 이동을 결정한다. 기존 월드 체크포인트에 선택 boat 필드를 추가하고 손님은 인증된 자기 ID로 탑승/하선/조종 입력만 보낸다. 두 좌석/유일한 ID/유한 좌표·속도/입력 범위를 relay에서 검증한다. 호스트는 부두 거리·챕터·생존·좌석·조종자 소유권을 재확인한다. 0.4초 입력 만료 시 감속, 선체 9점 지형 검사와 해역 경계로 육지 진입을 막는다. 월드2/3 이동 시 좌석을 비우며 해당 월드 입장 위치를 보존한다. 서버 바인딩/마이그레이션과 계정 기능을 유지했다.

최종 빌드·Worker 타입/dry-run·전투/스킬/배73개·방10개·엔진4개가 통과했다. `tools/qa-boats.mjs` 실Chrome 세 브라우저 로컬 검사도 종료0/페이지 오류0이다(boat-native-local.log): 실제 F 탑승·W 항해, 세 번째 거절, 동승자 조종 차단, 두 탑승자의 공유 배 위치, HP/XP/코인 보존 하선, 동승자 조종 승계, 방장 교체, 해역 경계 정지, 조종자 연결 끊김 후 승계, 월드2 입장 위치를 보존한 좌석 해제를 확인했다. 부두/경계 좌표와 무적/월드 잠금 해제는 명시적 검사 fixture이며 자연 진행 완주 검사가 아니다. two-seat-skiff.png에서 두 탑승자·선체·조종 안내 배치를 직접 확인했다. 새 입력마다 전체 월드를 중복 전송하지 않고 기존 10Hz 체크포인트를 이용한다.

소스 36a7565를 Vercel dpl_AfVfuMcyb2PM9aSTXeSwbjWGpYwA production/Ready 및 기존 stable alias에 배포했다. Worker 944c83d6-2f3c-4684-b6c1-87d5dd91e25f는 ROOMS/ACCOUNTS와 기존 마이그레이션을 유지했다. 공개 index/JS/CSS27개 SHA256 일치, seonn.dev/games/crabcraft HTTP200/기존 플레이 링크, 공개 방 전체 검사와 계정 API 회귀 검사가 통과했다(boat-{inspect-ready,public-assets,public-rooms,public-account-api}.log).

공개 stable alias/공개 Worker를 사용한 최종 실Chrome 세 브라우저 검사도 종료0/페이지 오류0으로 위 전체 항목을 통과했다(boat-native-public.log). 2/2 탑승·세 번째 거절·공유 항해·안전 하선·방장 및 조종자 이탈 승계·해역 경계·월드2 좌석 해제를 공개판에서 확인했다. 프롬프트 자동 기록 상태 pending/pending_results 모두0도 확인했다.

## 2026-10-17 · 해안 하선, 산호바람 섬과 업적

배 앞/주변의 안전한 땅을 찾아 F로 내린다. 선착장뿐 아니라 자연 해변도 이용하며 지형 높이·발밑 범위·벽 충돌·다른 플레이어를 확인한다. 호스트가 하선 위치를 결정하고 체크포인트의 검증된 exits로 손님도 같은 해안에 내린다. 두 사람이 내려도 배는 정박 위치에 남고 해변에서 다시 탈 수 있다. 땅이 없는 바다에서는 기존 부두 귀환을 유지한다. 빈 배만 원래 부두에서 호출할 수 있으며 탑승자가 있거나 멀리 있는 사람이 요청하면 거절한다. 항해 범위를 원래 해안과 새 섬까지 넓혔고 배/섬 지도 표식과 항해 안내를 추가했다.

부두 동북쪽 (230,-22)에 별도 산호바람 섬을 실제 월드1 지형 격자에 만들었다. 바다와 분리된 모래 해변/잔디 언덕/야자수5그루/바위/나무 벤치/깃발/진주 유적/발자국 길/보물상자가 있다. 기존 물 깊이·물거품·삼각형 높이·보행 충돌·지도 렌더를 같이 사용한다. F로 상자를 열면 캐릭터당75코인을 한 번만 지급하고 열린 뚜껑을 유지한다. 월드2/3에서는 해당 섬 장식과 배가 숨겨진다.

J 또는 Esc 메뉴의 업적 화면에10개 업적(첫10m 항해, 두 명 동승, 해안 하선, 섬 발견, 보물,3/10/20/30레벨 보스,등대 비밀)을 추가했다. 달성 안내와 진행을 표시한다. 기존 보스/비밀 진행도 인정한다. 업적/항해 거리는 캐릭터별 기존 journey에 저장하므로 로그인 계정 클라우드 저장·게스트 격리를 그대로 이용한다. 작은 화면에서는 목록만 스크롤되고 뒤로 버튼은 고정된다.

빌드, 전투/배76개·방11개·엔진4개, Worker 타입/dry-run 통과. 로컬 실Chrome에서 실제 W 왕복 항해/F 해안 하선·정박/재탑승·섬 보행/상자75코인 한 번·J 업적10개/718×492 화면·재로드 기록 보존·빈 배 호출을 확인했다. 두 브라우저의 동승 업적/손님 하선/공유 정박/재탑승 분리 검사도 종료0/페이지 오류0으로 통과했다(voyage-native-local.log, voyage-shared-local.log). 최초 부두 위치·출항 방위·무적 및 공유 하선 집중 검사의 배 위치는 명시적 fixture이며 자연 진행 완주 주장이 아니다. 즉시 위치 변경 fixture 후에는 호스트가 실제 위치 패킷을 받을 때까지 기다린다. 접근·보물·작은 업적 창 스크린샷을 직접 확인했다.

공개 배포 소스는 `8262a43`, Vercel `dpl_5TVYhR89dJo3rvCVRtUxKWCc3ujZ` production/Ready와 기존 stable alias를 확인했다. Worker `4025c81e-c32e-4668-afc9-b2a059061a4f`는 기존 ROOMS/ACCOUNTS 바인딩과 마이그레이션을 유지한다. 공개 index/JS/CSS27개 SHA256이 dist와 일치하고 seonn.dev/games/crabcraft HTTP200/기존 플레이 링크, 공개 방 회귀 검사도 통과했다(voyage-{inspect-ready,public-assets,public-rooms}.log).

공개 stable alias와 공개 Worker를 사용한 실Chrome 전체 항해 검사가 종료0/페이지 오류0으로 통과했다(voyage-native-public.log): 실제 왕복 항해/안전 하선/정박 재탑승, 섬 상자 한 번 보상,10개 업적과 작은 화면/재로드, 빈 배 호출 및 두 사람의 동승 업적/손님 하선/재탑승을 확인했다. 계정 실Chrome 공개 검사도 종료0/페이지 오류0이다(voyage-account-public.log). 회원가입·자동 저장·영어 두 번째 기기의 XP/코인과 업적4개 복원·오래된 창의 충돌 보호·세션 재로드·로그아웃 후 게스트 업적 격리를 확인했다. 저장 대기는 revision 번호만 보지 않고 실제 저장된 XP와 업적까지 확인하도록 검사 도구를 보강했다.

## 2026-10-17 · 달조각 섬과 노을 난파선 섬

월드1 바다에 달조각 섬(231,-61,반경12)과 노을 난파선 섬(222,65,반경18)을 추가했다. 기존 산호바람 섬과 떨어진 실제 지형이며 세 섬의 해안/물 깊이/거품/보행 충돌/지도 그림을 같은 높이 격자에서 처리한다. 기존 배의 해역 안에 배치해 두 명 동승·안전 하선·해변 재탑승을 그대로 사용한다. 지도에 세 섬을 색으로 표시하고 각 섬의 한국어/영어 지역명을 보여준다.

달조각 섬에는 수정9개·달 고리·돌 원형 유적, 노을 난파선 섬에는 부서진 선체/늑골·돛·보급통·야영지를 만들었다. 기하와 재질을 재사용하고 동적 광원은 추가하지 않았다. 각 보물상자는100/125코인을 캐릭터당 한 번 지급하며 열린 뚜껑을 저장된 업적으로 복원한다. 새 발견2·보물2·세 섬 모두 발견 업적1을 추가해 총15개다. 기존 업적 ID와 journey 저장 형식을 유지했다.

빌드와 전투/배76개 검사 통과. `tools/qa-archipelago.mjs` 실Chrome 로컬 검사가 종료0/페이지 오류0으로 두 새 섬의 실제 W 접근/F 안전 하선·걸어서 보물 획득·한 번씩225코인·배 재탑승·기존 저장 호환·15개 업적·작은 화면 뒤로 버튼·재로드 업적/코인 보존을 확인했다(archipelago-{build,tests,native-local}.log). 기존 산호바람 발견 기록과 각 섬 앞의 배 출발 위치/무적은 명시적 fixture이며 전체 자연 항로 완주를 주장하지 않는다. 재로드 fixture가 저장을 덮지 않도록 처음 한 번만 기록한다. 두 섬의 스크린샷을 직접 확인했다.

기존 섬 왕복 항해/상자/15개 업적/작은 화면/저장/빈 배 호출/두 브라우저 손님 하선·재탑승 회귀 검사도 로컬 종료0/페이지 오류0으로 통과했다(archipelago-regression-local.log). 최종 소스 `f8ef399`를 Vercel `dpl_J7NsawyqN7kTi8LHjBjub2PYhh8Q` production/Ready 및 기존 stable alias에 배포했다. 공개 index/JS/CSS27개 SHA256 일치와 seonn.dev/games/crabcraft HTTP200/기존 플레이 링크를 확인했다(archipelago-{inspect,public-assets}.log). 공개 실Chrome의 두 새 섬 전체 검사도 종료0/페이지 오류0으로 통과해 실제 접근·하선·각 보물 한 번·재탑승·225코인/새 업적 재로드를 확인했다(archipelago-native-public.log). 서버 프로토콜/Worker/계정 구조 변경은 없다.

GitHub 저장소가 `inhyk/crabcraft`로 이동했고 기존 feat/multiplayer-rooms 브랜치는 잠겨 있어 그 브랜치 push가 거절되었다. origin/dev와 origin/main이 기존 기준 커밋 a4c1e5a와 같은 것을 확인한 후 새 feat/archipelago-islands 브랜치로 정상 업로드했다. 보호 규칙은 변경하지 않았다.

공개 기존 섬 회귀 검사도 종료0/페이지 오류0으로 통과했다(archipelago-regression-public.log). 실제 왕복 항해·상자75코인 한 번·업적15개 화면·저장·빈 배 호출과 두 브라우저의 동승 업적/손님 하선/정박 재탑승을 확인했다.

## 2026-10-17 · 월드3 풍경과 월드별 음악

월드3에 부두/정박 선박, 새벽 등대와 회전하는 빛, 바닷바람 정원/과수원/꽃72개/벤치, 오르막 양쪽 화단, 전투장 바깥의 성벽/탑/열린 성문/깃발을 추가했다. 갈매기6마리와 해안 거품/구름/먼 해를 더해 풍경을 구분했다. 정적 소품은 기하/재질별 InstancedMesh로 묶으며 새 점광원은 없다. 기존 무그림자 태양을 기존 StarSun 방식의 플레이어 추적/스냅2048px 태양으로 교체해 입체감을 보강했다. 단 하나의 월드3 태양을 사용하고 월드2/3는 서로 숨긴다. 땅의 정점색을 흰 바탕에 표시해 원래 모래색과 중복 곱하지 않게 했다. 등대/성벽 충돌을 등록하면서 중앙 오르막과 보스 반경20m를 비웠다. 지역명/설명을 한국어·영어로 나누고 새 등대/정원을 지도에 표시했다.

월드1은 기존 마을/전투/보스 곡, 월드2는 별빛을 주제로 한 벨/패드, 월드3는 새벽 모험을 주제로 한 선율/호른으로 구분했다. 월드2·3 각각 탐험/일반 전투/보스의 원곡6개를 tools/art/world_music.py로 직접 작곡·합성했다(외부 샘플 없음, Apache-2.0, NOTICE/index에 기록). OGG/MP3 각각29~51초16마디 루프이며 필요한 곡만 기존 AudioManager가 디코딩/캐시하고 교차 페이드한다. 타이틀/춤추는 엔딩은 기존 음악을 유지한다. 월드 전환 시 이전 전투 음악 유지 시간을 초기화하고 현재 월드의 곡을 선택한다.

빌드/전투·배76개, ffprobe의 새 OGG/MP3 12개 전체 길이 검증 통과. tools/qa-dawn-music.mjs 로컬 실Chrome 검사는 종료0/페이지 오류0이다(dawn-{build,tests,music-generation,native-local}.log). 실제 WebAudio에서 세 월드×세 상황9개의 서로 다른 버퍼 ID·20초 이상 길이·유효 RMS·루프·실행 상태를 확인했다. 실제 M키 음악 껐다 켜기와 음량/음소거 버스도 확인했다. 월드3의 실제 W 오르막 통과, 등대 충돌, 새 지역/갈매기,12회 월드 왕복 후 XP/코인 보존과 GPU 메모리 안정(후반 geometry800/texture135)을 확인했다. 전투 상황은 engaged/lastCombat fixture, 월드 잠금 해제는 creatorTravel fixture, 시점/걷기 시작 위치는 teleport fixture이며 자연 보스전/퀘스트 완주를 주장하지 않는다. 첫 검사의 마을 내 전투 음악 예외와 원점과 정확히 겹치는 기존 원형 충돌의 특성을 반영해 해안 전투/등대 중심0.5m 옆에서 검증했다. 실제 화면을 보며 입구 깃발 가림을 수정했고 최종 항구/정원/등대/성채 그림자를 확인했다.
