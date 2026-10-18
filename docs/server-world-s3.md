# 충돌 데이터 생성과 검증

`src/sim/world/`는 DOM, three.js, GLB 없이 충돌 JSON을 읽고 높이, 이동 충돌, 시야 차단을 계산한다. 브라우저의 `layoutClawhaven`, `layoutStarhaven`, `layoutDawnreach`, `layoutFrostlight` 등록 함수를 Node에서 실행해 `public/world/collision-w1.json`부터 `collision-w4.json`까지 만든다. 낮은 품질에서는 장식, 그림자와 LOD를 줄이고 고체 충돌은 유지한다.

World IV는 별도 `snow` 높이 공식과 섬 경계를 쓴다. 눈 덮인 마을의 집 6채, 얼음 분수, 소나무, 얼음 절벽과 보스 경기장 기둥을 원래 등록 순서로 생성한다. World III에서 제거된 마을 분수의 충돌도 제거했다. 빛, 눈, 오로라, 건물, 나무 메시와 경기장 높이는 현재 dev의 배치를 유지한다.

다시 만들기는 `node tools/bake-collision.mjs`, 최신 상태 검사는 `node tools/bake-collision.mjs --check`다. bake 입력 소스의 해시가 달라지면 CI가 실패하므로 관련 코드를 바꾼 PR에서 JSON도 다시 만든다. 순수 Node 로더의 경계 테스트는 렌더링, asset, Node 모듈 의존성을 거부한다. 알 수 없는 지형 종류는 오류를 낸다.

실제 Chrome과 Node 비교는 다음 명령으로 실행한다. `--out`에는 JSON 결과와 월드별 PNG가 저장된다.

```sh
node tools/qa-collision-bake.mjs --url http://127.0.0.1:5227/ --quality low --out tmp/qa/collision-current-dev
node tools/qa-collision-bake.mjs --url http://127.0.0.1:5227/ --quality high --out tmp/qa/collision-current-dev
```

2026-10-18 dev `60df24f462f032ca9a2db5e4abfe3c9fc37163c1`을 병합한 작업본에서 Node 24.22.0과 pnpm 10.10.0으로 다시 검사했다. bake 소스 해시는 `96bad46179aecc6303b48e9be64bc4e3ed2a62b7b47affa6f64fedacf0e7612e`다. 37개 bundle 입력과 추가 입력(GLB piece 이름, bake 도구, three 버전)을 해시에 포함한다.

| 월드 | 고체 | 표면 | 품질별 샘플 수 | 높이 최대 오차 | 이동 최대 오차 | ray 최대 오차 |
|---|---:|---:|---:|---:|---:|---:|
| I Clawhaven | 2,382 | 7 | 14,764 | 4.44e-16 | 2.84e-14 | 0 |
| II Starhaven | 219 | 0 | 10,438 | 0 | 6.53e-9 | 0 |
| III Dawnreach | 146 | 0 | 10,292 | 3.55e-15 | 1.85e-13 | 0 |
| IV Frostlight | 271 | 0 | 10,542 | 3.55e-15 | 2.84e-14 | 4.44e-16 |

low와 high 각각 46,036점, 합계 92,072점에서 허용 오차 1e-6 이내였고 ray hit 판정 차이는 0건이었다. 브라우저 오류도 0건이었다. 첫 high 실행은 여러 Chrome 검사 동시 실행 중 World III 화면 저장이 30초 제한에 걸렸다. 재실행은 네 월드 계산과 화면 저장을 모두 통과했다. 첫 실패 로그와 JSON도 `tmp/qa-collision-high-initial-timeout.log`, `tmp/qa/collision-current-dev/high-initial-timeout.json`에 남긴다.

Node 검증은 boss 106건, engine 4건, multiplayer 50건(충돌 bake 6건 포함), server 16건을 통과했다. 빌드와 bake 최신 상태 검사도 통과했다. 잘못된 source 해시, Snow 지형 종류, 집 위치를 파일에 각각 주입한 `--check`는 세 경우 모두 종료 코드 1로 거부했고 원본 복구 후 통과했다. 독립 landmark 검사로 Snow 경기장 19m, 마을 5m, Dawn 마을 4m, Snow 분수의 높이별 ray 차단과 해안 경계를 확인한다.

`tools/qa-snow300.mjs`는 이동 스킬, 설원 입장 잠금, NPC 퀘스트, 299레벨 도전 잠금, 저장과 재접속, III-IV 왕복, 300레벨 Boreas의 HP 620,000과 승리 저장을 확인했다. 화면은 `tmp/qa/snow-village.png`, `tmp/qa/snow-boss300.png`에 있다. 전체 playtest는 Solarkan 이후 설원으로 이동해 Boreas를 쓰러뜨린 다음 엔딩을 검사하도록 새 이야기 흐름에 맞췄다.

최종 dev 갱신은 `7c9e120cf9244df63bd8abf98feea5985daa398e`까지 반영했다. 이 갱신은 지형 입력을 바꾸지 않았고 소스 해시를 유지했다. 갱신 후 빌드, world network 22건, bake 최신 상태 검사를 통과했다.

Deploy workflow에도 의존성 설치 직후 `Verify collision bake before release` 단계를 둔다. stale bake는 release stage, 업로드, activate 이전에 배포를 중단한다. bake 도구가 아직 없는 예전 main에서는 `hashFiles` 조건으로 이 단계만 건너뛴다. Deploy의 pnpm도 10.10.0으로 고정했다. 위의 파일 주입 세 건이 배포 단계와 같은 checker의 실패 경로를 검증한다.

추출 전 dev의 `SnowIsland`를 따로 실행한 비교에서도 271개 고체가 일치했고 높이, 이동, ray 10,542점의 오차는 모두 0이었다. 원본과 현재 SnowIsland의 260개 scene object를 geometry, material, transform으로 비교한 해시도 일치했다. 이 Node 비교에서는 양쪽의 `StarPortal`과 `islandPaths` 렌더 helper를 제외했으며 실제 브라우저 화면은 별도로 확인했다. 증거는 `tmp/qa/collision-current-dev/original-geometry-proof.json`이다.

Dawn 퀘스트 오브젝트는 `BakedWorld.collision.resolve(x, z, 1, out)` 다음 `BakedWorld.heightAt(out.x, out.y)`로 배치한다. 실제 `DawnRequests.build()`의 21개 결과 좌표와 이 경로가 모두 일치했다. 섬 경계를 먼저 적용하는 `BakedWorld.resolveCollision`은 플레이어 이동용이므로 퀘스트 오브젝트 배치에 대신 사용하지 않는다. 같은 JSON에 21개 nominal 좌표와 resolved 좌표를 남겼다.
