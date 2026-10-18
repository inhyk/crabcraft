import {t} from '../i18n';

// Stable region keys also drive music and travel logic. Translate only their presentation.
const REGIONS:Record<string,readonly [string,string,string]>={
  'Snowfall Village':['눈꽃 마을','따뜻한 창빛과 눈 쌓인 지붕 아래의 쉼터','Warm windows and snow-covered rooftops'],
  'Frostpine Woods':['서리 소나무 숲','눈꽃이 내려앉은 침엽수 사이의 순찰길','Patrol beneath snow-laden evergreen boughs'],
  'Aurora Snowfields':['오로라 설원','서리 파수병을 물리치며 300레벨을 향해','Defeat frost sentinels and grow toward level 300'],
  'The Frozen Throne':['얼음 왕좌','300레벨 영원의 서리왕 보레아스가 기다립니다','Level 300 Boreas, King of Eternal Frost, awaits'],
  'Dawnharbor':['새벽 항구','돛과 등불 아래 다시 모인 친구들','Friends reunited beneath sails and lanterns'],
  'Twilight Citadel':['황혼 성채','성벽 너머, 빼앗긴 새벽과 친구를 되찾으세요','Reclaim your friend and the stolen dawn beyond the walls'],
  'The Dawn Ascent':['새벽으로 오르는 길','꽃이 핀 계단에서 황혼의 성문까지','From flowering terraces to the twilight gate'],
  'Dawnwatch Lighthouse':['새벽 등대','황금빛 등불이 돌아갈 항로를 밝힙니다','A golden beacon lights the way home'],
  'Seabreeze Gardens':['바닷바람 정원','바다를 내려다보는 꽃길과 과수원','Flower paths and an orchard overlooking the sea'],
  'Ashen Palm Coast':['잿빛 야자 해안','파도와 야자수 사이를 지나는 순찰길','A patrol route between palms and surf'],
  'Moonshard Isle':['달조각 섬','별빛 수정과 달의 고리를 찾아서','Discover starlit crystals and the moon ring'],
  'Amberwreck Isle':['노을 난파선 섬','모래에 잠든 배와 선장의 보물','A stranded ship and its captain’s treasure'],
  'Coralwind Isle':['산호바람 섬','바다를 건너 찾은 진주빛 쉼터','A pearl-lit refuge across the sea'],
  'Clawhaven':['클로헤이븐','여섯 종족이 함께 사는 항구 마을','Harbour town of six peoples'],
  'The Brine Shore':['소금물 해안','고철벌레들이 기어 다니는 해변','Where the Scraplings crawl'],
  'Saltmere Lighthouse':['솔트미어 등대','밤을 밝히는 해안의 길잡이','A guiding light for the shore'],
  'The Iron Wreck':['철의 난파선','녹과 폐허에 잠긴 배','Rust and ruin'],
  'Moonpool Grove':['달샘 숲','달빛이 귀 기울이는 숲','Where the moon listens'],
  'The Star Throne':['별의 왕좌','일식의 여왕이 지키는 마지막 왕관','The Eclipse Queen guards the final crown'],
  'Starhaven':['별빛 항구','두 세계의 주민들이 새로 세운 보금자리','A new home for the people of both worlds'],
  'Moonshade Crystalwood':['달그늘 수정 숲','수정 사이에 남겨진 별의 기억','Star memories among the crystals'],
  'The Fallen Star Ruins':['무너진 별의 유적','옛 천문대가 다시 별을 바라봅니다','The ancient observatory watches the stars again'],
  'The Pilgrim’s Starroad':['순례자의 별길','빛나는 길 끝에 남겨진 약속','A promise at the end of a shining path'],
  'The Forgotten Star':['잊힌 별의 섬','새로운 이웃과 잃어버린 별의 이야기','New neighbours and the story of a lost star'],
};
export const regionName=(key:string)=>REGIONS[key]?t(REGIONS[key][0],key):key;
export const regionSubtitle=(key:string)=>REGIONS[key]?t(REGIONS[key][1],REGIONS[key][2]):'';

const LOADING_LABELS:Record<string,string>={
  'Raising the tide':'밀려오는 파도 준비 중',
  'Shaping the Tidelands':'해안 지형 만드는 중',
  'Unpacking the village':'마을 자산 불러오는 중',
  'Painting the ground':'땅에 색을 입히는 중',
  'Raising Clawhaven':'클로헤이븐 세우는 중',
  'Casting the Pincer Fountain':'집게 분수 만드는 중',
  'Building Saltmere Lighthouse':'솔트미어 등대 세우는 중',
  'Sinking the Iron Wreck':'철의 난파선 배치 중',
  'Setting out the market':'시장 가판대 준비 중',
  'Growing the pine woods':'소나무 숲 가꾸는 중',
  'Ready':'준비 완료',
  'Building Starhaven':'숨겨진 별빛 항구 준비 중',
  'Waking the crabs of Clawhaven':'마을의 게 주민들을 깨우는 중',
  'Polishing shells':'게 로봇의 껍질을 닦는 중',
  'Rusting the Scraplings':'고철벌레 준비 중',
  'Something stirs in the Iron Wreck':'난파선의 수호자를 깨우는 중',
  'Painting the portraits':'초상화 그리는 중',
  'Lighting the lamps':'가로등 밝히는 중',
  'Welcome to Clawhaven':'클로헤이븐에 오신 걸 환영해요',
  'Welcome to Starhaven':'별빛 항구에 다시 오신 걸 환영해요',
};
export const loadingLabel=(key:string)=>LOADING_LABELS[key]?t(LOADING_LABELS[key],key):key;
export function loadingTips(chapter: 1 | 2 | 3 | 4 = 1){return chapter === 4 ? [
  t('눈꽃 마을의 주민들에게 말을 걸어 설원 퀘스트를 받아 보세요.','Speak to the people of Snowfall Village to accept snowfield quests.'),
  t('300레벨이 되면 얼음 왕좌의 보레아스에게 도전할 수 있어요.','Reach level 300 to challenge Boreas at the Frozen Throne.'),
  t('기술 위에 마우스를 올리면 바닥에서 실제 공격 범위를 확인할 수 있어요.','Hover over a skill to see its actual range on the ground.'),
] : chapter === 3 ? [
  t('새벽 항구의 주민들에게 말을 걸어 월드 3 퀘스트를 받아 보세요.','Speak to the people of Dawnharbor to accept World III quests.'),
  t('100레벨이 되면 황혼 성채의 솔라칸에게 도전할 수 있어요.','Reach level 100 to challenge Solarkan in the Twilight Citadel.'),
  t('솔라칸을 물리치면 눈 월드로 가는 길이 열려요.','Defeat Solarkan to open the way to the snow world.'),
] : chapter === 2 ? [
  t('별빛 항구로 이사 온 친구들에게 말을 걸어 월드 2 퀘스트를 받아 보세요.','Speak to the friends who moved to Starhaven to accept World II quests.'),
  t('보랏빛 포탈은 두 세계를 이어 줘요. 가까이 가서 F를 누르면 해안으로 돌아갈 수 있어요.','The violet portal joins both worlds. Approach it and press F to return to the shore.'),
  t('별 등불은 F를 누르고 있어야 켜져요. 등불 옆에서 잠시 멈춰 주세요.','Hold F beside a star lamp to light it. Stay close until its light awakens.'),
  t('달그늘 수정 숲과 별의 유적, 북쪽 별길에는 옛 세계의 기억이 남아 있어요.','The Crystalwood, the Fallen Star Ruins, and the northern Starroad hold memories of this world.'),
  t('20레벨이 되면 별의 왕좌에 도전하세요. 검은 일식이 오면 안쪽 안전지대로 피하세요.','Challenge the Star Throne at level 20. When the Black Eclipse falls, move into the inner sanctuary.'),
] : [
  t('게는 옆으로 걸어요. A·D로 옆걸음, Q·E로 회전하고 마우스 오른쪽 버튼으로 방향을 조절하세요.','Crabs walk sideways. A and D scuttle, Q and E turn, right mouse steers.'),
  t('Tab으로 앞쪽의 가까운 적을 선택한 뒤 1~4번 기술로 싸우세요.','Press Tab to target the nearest enemy in front of you, then 1 to 4 to fight.'),
  t('노란 !는 받을 수 있는 퀘스트, 노란 ?는 보상을 받을 수 있는 퀘스트예요.','A yellow ! means a crab has work for you. A yellow ? means it is ready to turn in.'),
  t('길을 잃었나요? 황금빛 기둥과 반짝이는 길 안내를 따라가세요.','Lost? Follow the golden beam and the glowing breadcrumbs.'),
  t('퀘스트 창에서 길 안내를 선택하면 원하는 퀘스트의 다음 목표로 안내해 줘요.','Choose Track this quest in the quest log to follow its next objective.'),
];}
