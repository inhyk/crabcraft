import {t} from '../i18n';

/** The same mechanic has the same instructions on the host and every follower. */
export function bossWarning(kind:'slam'|'spray'|'undertow'|'nova'|'eclipse'|'cross'|'barrage',level:number):string {
  if(level===500||level===750){const fire=level===500;const warnings={
    cross:fire?t('용광로 칼날! 비스듬히 겹치는 화염 길을 피하세요.','Furnace Blades! Leave the slanted fire lanes.'):t('바람 십자! 두 바람길 사이로 피하세요.','Windcross! Dodge between the two wind lanes.'),
    barrage:fire?t('용암 분출! 엇갈린 네 개의 원을 피하세요.','Magma Eruption! Leave the four staggered circles.'):t('별꽃 개화! 다섯 꽃잎 사이가 안전해요.','Starflower Bloom! The gaps between five petals are safe.'),
    slam:fire?t('화산의 망치! 표시된 원을 피하세요.','Caldera Hammer! Leave the marked circle.'):t('세계수의 뿌리! 표시된 원을 피하세요.','Worldroot Slam! Leave the marked circle.'),
    spray:fire?t('불꽃 숨결! 부채꼴 밖으로 피하세요.','Ember Breath! Leave the cone.'):t('가시 바람! 부채꼴 밖으로 피하세요.','Thornwind! Leave the cone.'),
    undertow:fire?t('분화구의 끌림! 원 밖으로 달리세요.','Caldera Pull! Run outside the circle.'):t('태풍의 눈! 끌려가기 전에 원 밖으로 달리세요.','Eye of the Storm! Run outside before the pull.'),
    nova:fire?t('용암 폭발! 큰 원 밖으로 피하세요.','Lava Nova! Leave the large circle.'):t('바람 폭발! 큰 원 밖으로 피하세요.','Wind Burst! Leave the large circle.'),
    eclipse:fire?t('잿불의 포위! 초록 원 안이 안전해요.','Ember Siege! The green inner circle is safe.'):t('세계수의 안식처! 넓은 초록 원 안으로 들어오세요.','Worldtree Refuge! Enter the wide green inner circle.'),
  };return warnings[kind];}
  if(level===300){const warnings={
    cross:t('빙결 광선! 여섯 방향의 푸른 길 사이로 피하세요.','Frozen Rays! Dodge between the six cyan lanes.'),
    barrage:t('일곱 겹 눈보라! 일곱 개의 표시된 원 밖으로 피하세요.','Sevenfold Blizzard! Leave all seven marked circles.'),
    slam:t('서리왕의 망치! 붉은 원을 벗어나세요.','Frost Hammer! Leave the red circle.'),
    spray:t('얼음 숨결! 부채꼴 밖으로 피하세요.','Ice Breath! Leave the cone.'),
    undertow:t('겨울의 소용돌이! 끌려가기 전에 원 밖으로 달리세요.','Winter Vortex! Run outside before the pull.'),
    nova:t('빙하 폭발! 표시된 원을 벗어나세요.','Glacial Burst! Leave the marked circle.'),
    eclipse:t('서리 감옥! 보스 곁의 초록 원 안이 안전해요.','Frost Prison! The green circle beside the boss is safe.'),
  };return warnings[kind];}
  switch(kind){
    case 'cross': return level===100?t('황혼의 십자화염! 여덟 방향 화염 사이의 빈 공간으로 피하세요.','Twilight Crossfire! Dodge between the eight fire rays.'):t('십자 해일! 교차하는 주황색 길 밖으로 피하세요.','Tidal Cross! Leave both orange lanes.');
    case 'barrage': return level===100?t('왕관 폭격! 다섯 개의 보라색 원을 피하세요.','Crown Barrage! Leave all five violet circles.'):level===20?t('별똥별 세례! 세 개의 보라색 원을 피하세요.','Starfall Barrage! Leave all three violet circles.'):t('심해 폭격! 세 개의 보라색 원을 피하세요.','Brine Barrage! Leave all three violet circles.');
    case 'slam': return level===100?t('왕의 내려찍기! 붉은 원을 피하세요.','King’s Hammer! Leave the red circle.'):level===20?t('별의 집게! 붉은 원을 피하세요.','Star Claw! Leave the red circle.'):level>=10?t('심해의 집게! 붉은 원을 피하세요.','Abyssal Claw! Leave the red circle.'):t('닻 내려찍기! 붉은 원을 피하세요.','Anchor Slam! Leave the red circle.');
    case 'spray': return t('녹 분사! 부채꼴 밖으로 피하세요.','Rust Spray! Move outside the cone.');
    case 'undertow': return t('끌어당기기! 원 밖으로 달리세요.','Undertow! Run outside the circle.');
    case 'nova': return level===100?t('황혼의 폭발! 표시된 원 밖으로 피하세요.','Twilight Nova! Leave the marked circle.'):level===20?t('별빛 붕괴! 보라색 원 밖으로 피하세요.','Starfall! Leave the purple circle.'):t('심해 파동! 푸른 원 밖으로 피하세요.','Tidal Nova! Leave the blue circle.');
    case 'eclipse': return t('검은 일식! 보스 곁의 초록 원 안으로 피하세요.','Black Eclipse! Enter the green circle beside the boss.');
  }
}

/** The banner a boss's phase change raises: its title, then what to do. */
export function bossPhaseBanner(level:number,phase:2|3):[()=>string,()=>string] {
  if(phase===2)return [() => (t('2단계','PHASE II')),() => (level===500?t('용암과 화염 칼날! 표시된 바닥을 피하세요.','Magma and furnace blades! Watch the marked ground.'):level===750?t('바람과 별꽃! 초록 안전지대를 찾아요.','Wind and starflowers! Find the green sanctuary.'):level === 300 ? t('얼음 감옥과 눈보라! 안전지대를 확인하세요.','Frost Prison and Blizzard! Find the safe zones.') : level === 100 ? t('황혼의 폭격 · 표시된 원과 길을 피하세요!','Twilight Barrage · Leave the marked circles and lanes!') : level === 20 ? t('검은 일식 · 초록 원 안쪽이 안전합니다!','Black Eclipse · Stay inside the green circle!') : level >= 10 ? t('심해 파동 · 푸른 원을 벗어나세요!','Tidal Nova · Leave the blue circle!') : t('녹의 하수인들이 깨어납니다!','The rustlings awaken!'))];
  return [() => (t('3단계 · 폭주','PHASE III · ENRAGE')),() => (level === 300 ? t('영원의 서리왕이 폭주합니다!','The King of Eternal Frost is enraged!') : level === 100 ? t('황혼의 왕관이 폭주합니다!','The Twilight Crown is enraged!') : level === 20 ? t('별의 왕관이 폭주합니다!','The Star Crown is enraged!') : level >= 10 ? t('심해의 왕관이 폭주합니다!','The Deep Crown is enraged!') : t('갑옷이 새하얗게 달아오릅니다!','The armour burns white-hot!'))];
}
