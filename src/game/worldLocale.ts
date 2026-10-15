import {t} from '../i18n';

// Stable region keys also drive music and travel logic. Translate only their presentation.
const REGIONS:Record<string,readonly [string,string,string]>={
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
};
export const loadingLabel=(key:string)=>LOADING_LABELS[key]?t(LOADING_LABELS[key],key):key;
export function loadingTips(){return [
  t('게는 옆으로 걸어요. A·D로 옆걸음, Q·E로 회전하고 마우스 오른쪽 버튼으로 방향을 조절하세요.','Crabs walk sideways. A and D scuttle, Q and E turn, right mouse steers.'),
  t('Tab으로 앞쪽의 가까운 적을 선택한 뒤 1~4번 기술로 싸우세요.','Press Tab to target the nearest enemy in front of you, then 1 to 4 to fight.'),
  t('노란 !는 받을 수 있는 퀘스트, 노란 ?는 보상을 받을 수 있는 퀘스트예요.','A yellow ! means a crab has work for you. A yellow ? means it is ready to turn in.'),
  t('길을 잃었나요? 황금빛 기둥과 반짝이는 길 안내를 따라가세요.','Lost? Follow the golden beam and the glowing breadcrumbs.'),
  t('퀘스트 창에서 길 안내를 선택하면 원하는 퀘스트의 다음 목표로 안내해 줘요.','Choose Track this quest in the quest log to follow its next objective.'),
];}
