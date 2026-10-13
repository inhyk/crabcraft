# World of Crabcraft 요구사항

정리일: 2026-10-13 (KST), /clarify 세션. 위키 기록: https://wiki.repact.ai.kr/doc/2026-10-13-world-of-crabcraft-M9rrnwveeg

## 원래 요청

> oldcraft를 crabcraft로 만들거야. world of crabcraft야. crab-robot-challenge의 캐릭터를 이용해서 oldcraft의 등장인물을 모두 crab으로 바꾸는거야. 이건 crab robot challenge에 출품할거야. 1등, 아니 영원히 1등할 수 있는 퀄리티로 달리는걸 목표로해. 사람도 크랩, 드워프도 크랩, 언데드도 크랩 다 크랩인데 그 특색을 살리는 디자인을 적용해줘. 디자인은 /Users/inkeun/Downloads/jumper-tvc-3-web.mp4를 참조하고, 크랩 애셋은 공개된걸 사용해줘.

## 목표

웹 브라우저에서 링크 하나로 플레이하는 World of Crabcraft를 만든다. 화면 구성은 World of OLDcraft를 따르고, 등장인물은 모두 KingKongRobotics Jumper 크랩으로 바꾼다. Crab Robot Open-source Challenge 2026(BE UNLIMITED)에 출품한다.

## 범위

포함:

- 캐릭터 생성 화면: 6종족(Human, Orc, Dwarf, Undead, Night Elf, Tauren), 성별, 직업, 색과 장식 옵션(oldcraft의 Skin Color, Hair Style, Hair Color 자리), Rotate, Name, Randomize
- 월드 한 구역. NPC와 적도 모두 크랩이다. 퀘스트 하나, 보스전, 엔딩으로 이어지는 10분 안팎의 한 판
- 모션: 평소 플레이는 절차적 6다리 보행과 키프레임 애니메이션으로 만든다. 로봇 모드에서는 브라우저 MuJoCo와 Jumper의 실제 policy로 보행, 점프, 댄스 중 일부를 재생한다

제외:

- oldcraft Unity 빌드 모딩
- 멀티플레이, 서버, 계정

## 제약

- 마감은 이번 주다. 2026-10-18(일)로 가정했고 정확한 날짜는 확인하지 않았다.
- 크랩 몸체는 Jumper visual STL을 쓴다(Apache-2.0). 질감은 TVC를 따른다. 광택 레드 셸, 검은 페이스 패널, 청록 LED 눈과 표정 변화.
- 월드와 UI는 oldcraft처럼 WoW풍 스타일라이즈드 판타지 톤으로 만든다.
- 서드파티 애셋은 공개 라이선스만 쓰고, 라이선스와 출처를 NOTICE에 적는다.

## 성공 기준

- 링크를 열면 캐릭터 생성, 퀘스트, 보스, 엔딩까지 막힘 없이 플레이된다.
- 로봇 모드에서 실제 Jumper policy 동작이 재생된다.
- 서드파티 애셋 전부가 NOTICE에 기록돼 있다.

## 사용자 결정

| 항목 | 원래 | 결정 |
|---|---|---|
| 구현 방식 | 불명확 (oldcraft는 소스 없는 Unity 빌드) | 웹으로 새로 제작 |
| 범위 | 불명확 | 캐릭터 생성 + 퀘스트 한 판(보스전, 엔딩) |
| 영상 참조 범위 | "디자인 참조" | 크랩은 TVC 제품 그대로 + 종족 장비, 월드와 UI는 판타지 |
| 모션 | 미정 | 기본은 게임 애니메이션, 로봇 모드에서 실제 policy |
| 마감 | 미정 | 이번 주 |

## 로제 제안 (사용자 확인 전)

- oldcraft의 모델, 텍스처, 로어 텍스트(Highcrest, Ambervale, Accord of Six Banners 등)는 가져오지 않고 화면 배치만 참고한다. 권리가 원작자 Stefan3DAI에 있어 공개 출품물에 넣기 어렵다. 로어는 크랩 패러디로 새로 쓴다.
- 종족별 구분 요소. 실루엣만 보고도 종족을 알 수 있게 하는 것이 목표다.

  | 종족 | 셸과 자세 | 장비와 LED |
  |---|---|---|
  | Human | 기본 레드 셸, 표준 자세 | 파란 tabard, 집게에 장검과 방패, 청록 LED |
  | Orc | 올리브 그린 셸 | 엄니형 집게 보호대, 가죽 견갑, 도끼 |
  | Dwarf | 다리를 낮춘 넓고 땅딸한 자세 | 페이스 패널 아래 케이블로 땋은 수염, 뿔 투구, 해머 |
  | Undead | 바랜 회색 셸, 균열과 구멍 | 드러난 서보와 배선, 외피 없는 다리 하나, 깜빡이는 녹색 LED |
  | Night Elf | 남보라 셸 | 긴 안테나 귀, 초승달 문양, 발광 문신 |
  | Tauren | 큰 체격 | 뿔, 토템 장식, 갈색 셸 |

- 작업 순서: 캐릭터 생성 화면, 월드와 퀘스트와 보스, 로봇 모드. 심사 첫인상을 좌우하는 화면부터 완성한다.
- 기술 후보: Three.js, Vite, MuJoCo WASM, onnxruntime-web. Jumper 쪽 export는 `assets/jumper/tools/export_web_robot.py`를 쓴다.
- 공개 레포와 호스팅(GitHub Pages 등)은 공개하기 전에 사용자에게 확인한다.

## 미확인

- 대회 규정: 제출 형식, 심사 기준, 정확한 마감. beunlimited.me 대회 페이지가 JS 렌더링이라 읽지 못했다.
- oldcraft 직업 목록. Warrior만 확인했다.

## 참고 경로

- oldcraft 빌드: `/Users/inkeun/projects/oldcraft` (Unity Mono, Wine 실행, `evidence/character-creation.png`)
- Jumper 원본: `/Users/inkeun/projects/crab-robot-challenge/.cache/jumper` (Apache-2.0)
  - visual STL: `assets/jumper/urdf/jumper/meshes/visual/`
  - MJCF: `assets/jumper/jumper.xml`
- 외형과 장면 라이브러리: https://github.com/KingKongRobotics/jumper-design
- 디자인 참조 영상: `/Users/inkeun/Downloads/jumper-tvc-3-web.mp4` (1920x1080, 30fps, 86.8초)
