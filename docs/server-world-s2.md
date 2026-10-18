# S2 숫자 시뮬레이션 코어 준비

이 변경은 기존 전투 규칙을 Node에서 실행하는 새 `src/sim/` 모듈을 추가한다. 현재 브라우저의 `Game`, `Unit`, `Player` 실행 경로는 이 코어로 전환하지 않는다. 전체 S2 완료와 서버 세계 배포는 별도 검증 단계다.

의존 PR은 [S1 #26](https://github.com/inhyk/crabcraft/pull/26), [S3 #25](https://github.com/inhyk/crabcraft/pull/25)다. 두 PR의 소스를 추출 근거로 읽었으며, 해당 커밋이나 변경 파일을 이 준비 PR에 복사하지 않았다. 기존 브라우저 전환과 실제 baked query 연결은 두 의존성이 `dev`에 들어온 뒤 진행한다. [S4 #30](https://github.com/inhyk/crabcraft/pull/30)의 합성 네트워크 fixture도 아직 실제 코어에 연결하지 않는다.

## 코어 경계

`SimulationArea`는 입력, 시계, RNG, ID, timer, 전투, NPC와 적, 보스, 보상, action과 projectile을 소유한다. 고정 간격은 `1 / 30`초다. 한 tick은 입력 명령, 시계 증가와 due timer, 플레이어와 적 및 보스, 월드 규칙과 분리, pending hit와 projectile, action clock과 numeric pose 순으로 실행한다. 한 입력의 명령 순서를 보존하며 같은 seq를 다시 실행하지 않는다.

`snapshot()`과 `debugState()`는 복사한 불변 값을 반환한다. `drainEvents()`는 순서가 붙은 ID와 값으로 된 관측을 소비한다. 렌더러나 event sink가 피해와 진행을 계산하지 않는다. `AreaId / EntityId / life` 전체가 수명 참조이며, 재생성 후 예전 참조는 무효다. 전역 RNG, 실제 시계, DOM, THREE와 기존 browser game 모듈은 코어에서 금지한다. import guard와 Node 직접 import 검사가 이를 확인한다.

| 모듈 | 실제 동작 |
| --- | --- |
| `player`, `combat`, `abilities` | 세 클래스의 13종 기술과 15개 slot, GCD와 자원, 시전과 채널, 이동과 재생성 |
| `enemy`, `boss` | 일반 적 AI, 네 보스 profile, 일곱 mechanic, add pool과 reset 및 freed 연출 상태 |
| `areas`, `outcomes`, `interactions` | 서로 분리된 세 월드 배치, 퀘스트와 NPC, 보스 도전, 기여자별 전체 보상 |
| `transfer` | 이동 예약과 staging, 소유권 CAS, 시계 변환, 보상 mailbox와 재시도 |
| `actions`, `projectiles`, `pose` | 실제 clip 명중 시각, fade 또는 취소 시 root carry, canonical clawR에서 출발하는 실제 비행 |

월드 정의는 순수 `WorldQuery`와 명시적인 level 및 population 설정을 받는다. 테스트의 평면 지형과 level/count는 fixture 값이며 운영 밸런스가 아니다. 일반 적은 기존의 살아 있고 숨지 않은 플레이어가 22m 안에 없을 때 재생성하는 조건을 유지한다. 최종 운영용 근처 인원 대비 밀도와 재생성 속도 공식은 이 추출에서 새로 정하지 않는다.

이동을 사용하는 host는 각 Area의 `characters` 옵션과 `InMemoryTransferCoordinator`에 같은 `CharacterRegistry`를 주입해야 한다. 이 registry는 새 캐릭터 부착, respawn의 life 변경과 소유권 이동에 함께 참여한다. 별도 registry를 만드는 host는 respawn 뒤 소유권을 보장하지 못한다. 현재 구현은 메모리 registry와 mailbox이며 영속 저장이 아니다.

실패한 이동은 원래 actor, RNG, action, timer, event, context와 소유권을 복구한다. 이미 발급한 transaction token의 nonce는 소비한 채로 단조 증가한다. 이를 되감아 취소한 token을 재사용하면 예전 abort가 새 이동을 취소할 수 있다. rollback 검사는 이 nonce만 예외로 두며, 나머지 전체 상태와 stale token의 무효화를 검사한다.

## 실제 모션 데이터

`tools/bake-sim-motion.mjs`는 Chrome의 실제 `MotionLibrary`, GLB와 rig factory로 44개 clip과 14개 archetype을 읽는다. `src/sim/data/pose-data.json`에는 float32 sample, root curve, socket chain, collider와 scale 및 원본 SHA256이 들어간다. 누락된 clip과 archetype은 오류이며 대체 pose를 만들지 않는다. locomotion과 적용 pose cache는 unit마다 별도로 소유한다.

`tools/qa-sim-motion-data.mjs`는 production sampling 및 실제 rig의 socket과 numeric provider를 비교한다. 부모의 별도 재실행 결과는 다음과 같다.

원본 수치는 [evidence/s2-motion-parity.json](evidence/s2-motion-parity.json)에 보존한다. 실행한 provider version은 `shipped-motion-v1-3cf3d0e63efc06ed1e2c`다.

| 비교 | 표본 | 최대 차이 |
| --- | ---: | ---: |
| Clip sampling | 1,232 | 0 |
| ClawR 위치, 14종 rig와 36종 race/sex/class 조합 | 15,000 | 7.105427357601002e-15 world unit |
| 자연 종료, 취소와 중복 stop의 root carry | 91 | 0 |

기존 undead rig는 motion 갱신 후 시각 servo twitch에 `Math.random`을 쓴다. 숫자 authority는 이 시각 무작위를 제외한 canonical pose를 쓴다. 708개 pose씩 비교한 undead/eclipse의 최대 launch 위치 차이는 0.114521/0.515346 world unit, 비교한 target 구성에서 최대 도착 차이는 0.006708/0.030312초, 30Hz 기준 최대 1tick이었다. 원래 spawn collider는 twitch 갱신 전에 측정되므로 그 값은 유지한다. 이는 표본 결과이며 모든 연속 pose에 대한 수학적 상한은 아니다. 기존 view의 twitch를 바꾸지는 않는다.

원본 SHA256과 packed artifact의 content hash를 테스트한다. 원본 motion, rig 또는 추출 근거 파일이 바뀌면 실제 bake와 parity 검사를 다시 수행한다. hash 목록을 빼거나 허용 오차를 늘려 stale 검사를 우회하지 않는다.

## 검증 명령

Node 24와 pnpm 10.10.0을 사용한다.

```sh
pnpm install --frozen-lockfile
pnpm test:sim:core
pnpm build
pnpm build:server
pnpm test:boss
pnpm test:engine
pnpm test:multiplayer
pnpm test:server
node tools/qa-sim-motion-data.mjs --output /tmp/s2-motion-parity.json
```

마지막 명령은 로컬 Chrome과 비어 있는 5266 port가 필요하다. 전용 임시 페이지에서 실제 loader와 rig를 사용하고 종료 시 browser와 Vite를 닫는다. 일반 core 테스트에는 브라우저와 네트워크 서버가 필요하지 않다. `test:sim:core`는 `tests/core-*.test.mjs`를 이름 순서로 발견해 실행하며 테스트 파일이 없으면 실패한다. GitHub의 `Simulation core` workflow는 core와 기존 회귀 검사를 실행한다.

## 남은 연결

전체 S2 완료에는 S1/S3 반영 후 live Vector3 facade, `PlayerInput`, authority/replica adapter, 단일 browser orchestration으로의 전환이 필요하다. 배 탑승과 마을 놀이의 권한 있는 상태 변경도 아직 기존 브라우저 경로에 있다. 실제 두 브라우저 방, 전투 효과와 명중 시각, 사망과 재생성, recall과 dance, 세 월드 왕복 렌더 검사는 전환 뒤 수행한다.

실제 WebSocket host, Google 계정과 캐릭터 저장, VM 성능은 이 준비의 검증 범위가 아니다. S4의 네트워크 측정과 이 코어의 Node 검사는 서로 다른 근거다. 기본 branch push, merge, VM 배포는 수행하지 않는다.
